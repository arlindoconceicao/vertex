# Arquitetura multiplataforma: Node.js, Android, iOS e navegador

## Objetivo

Manter uma única implementação auditável em Rust para a criptografia SSI-PQ, a emissão e verificação de credenciais e a assinatura de PDFs, distribuindo-a por adaptadores adequados a cada ambiente:

```text
                         +-----------------------+
                         |    ssi-pq-core Rust    |
                         | ML-DSA, ML-KEM, PDF,   |
                         | DID, credencial, JSON  |
                         +-----------+-----------+
                                     |
             +-----------------------+-----------------------+
             |                       |                       |
       +-----v------+          +-----v------+          +-----v------+
       | Node N-API |          | Mobile FFI |          |  Web WASM   |
       |    .node   |          | UniFFI/C   |          | wasm-bindgen|
       +-----+------+          +-----+------+          +-----+------+
             |                       |                       |
        Node.js atual          Android e iOS           Navegador
                              Kotlin/Java/RN           e RN Web
```

O código de negócio e os formatos criptográficos são compartilhados. Os binários e as pontes de linguagem não são: cada ambiente precisa do seu adaptador.

## A distinção essencial: Node.js não é navegador

O addon atual usa N-API (`napi-rs`) e produz um arquivo `.node`. Node-API é a API de addons nativos mantida pelo próprio Node.js; portanto esse artefato deve ser carregado por um runtime Node.js compatível.

Consequências práticas:

- Um backend Node.js, uma CLI, Electron com Node integrado ou testes Node podem consumir a biblioteca atual.
- Um navegador não executa `require()`, não fornece os módulos nativos `node:*` e não carrega arquivos `.node`.
- React Native padrão também não é Node.js. Ele executa JavaScript em Hermes ou JavaScriptCore e acessa código nativo por Native Modules/TurboModules.
- Compilar o addon N-API para Android somente faz sentido se o aplicativo embutir um runtime Node.js. Essa não é a arquitetura normal de um app Kotlin/Java ou React Native.

Assim, `@ssi-pq/core` continua sendo o pacote Node.js; para browser e mobile há pacotes/artefatos próprios, todos derivados do mesmo núcleo Rust.

Referências: [Node-API](https://nodejs.org/api/n-api.html) e [React Native Native Platform](https://reactnative.dev/docs/native-platform).

## Estado atual do repositório

O projeto já está separado em um Cargo workspace com crates por responsabilidade:

- `crates/ssi-pq-core`: núcleo Rust puro com DID, credenciais, schemas, canonicalização, hashes, ML-DSA, ML-KEM, AES-GCM, PDF, assinatura genérica de PDF e wallets;
- `crates/ssi-pq-node`: adaptador N-API para Node.js, com `build.rs` e exports compatíveis com o pacote `@ssi-pq/core`;
- `crates/ssi-pq-wasm`: adaptador `wasm-bindgen`, gerando pacotes para browser em `packages/web/pkg` e para testes Node.js em `packages/wasm-node/pkg`;
- `crates/ssi-pq-mobile-ffi`: adaptador UniFFI usado por Android/iOS.

Também existem pacotes e facades JavaScript específicos:

- `packages/web/ssi-pq-node-compatible.mjs`: facade Node-compatible sobre o WASM;
- `packages/web/ssi-pq-indexeddb-wallet.mjs`: wallet persistente browser-like sobre snapshot cifrado;
- `packages/react-native`: pacote `@ssi-pq/react-native`, com API TypeScript segura, facade `node-compatible`, TurboModule Android e ponte iOS.

A wallet Node continua usando SQLCipher em arquivo local. WASM e mobile usam o backend portátil `wallet_storage`, com estado cifrado por senha/KDF e persistência delegada ao ambiente: IndexedDB/snapshot no browser, diretório privado do app no Android/iOS.

## Revisão técnica do relatório “Rust para Mobile: N-API a FFI”

O relatório anexado confirma as decisões centrais deste documento: separar o workspace, manter o adaptador N-API para Node.js, usar uma FFI móvel, empacotar Android/iOS por ABI e preferir TurboModules a uma integração React Native legada. Também reforça corretamente o uso de URI nativa e `Promise` para PDFs grandes e operações criptográficas demoradas.

Há, contudo, quatro ajustes importantes para que a estratégia seja segura e atual:

- `callback_interface` do UniFFI é compatível, mas está *soft-deprecated*. Para uma futura chamada Rust → Kotlin/Swift, usar foreign traits (`#[uniffi::export(foreign)]` ou `#[uniffi::export(rust, foreign)]`) em vez de criar novas callback interfaces.
- TurboModules/JSI não tornam toda passagem de dados automaticamente “zero-copy”. A FFI pode receber bytes sem uma cópia específica, mas PDF grande ainda pode ser copiado entre runtimes; a API pública deve preferir arquivos/URIs nativos.
- Um signer P-256/ECDSA do Android Keystore ou Secure Enclave **não é substituto** para a assinatura ML-DSA que o core atual declara e verifica. Trocar o algoritmo silenciosamente invalidaria a interoperabilidade de DID, credencial e PDF.
- O relatório trata o Secure Enclave como apenas P-256. A documentação da Apple referenciada também lista `SecureEnclave.MLDSA65` e `SecureEnclave.MLDSA87`. Isso é uma oportunidade futura para iOS, mas não pode ser premissa do produto sem validar versão mínima de iOS, disponibilidade de hardware e compatibilidade de serialização com `libcrux`.

Referências: [foreign traits e callback interfaces do UniFFI](https://mozilla.github.io/uniffi-rs/next/proc_macro/traits.html), [SecureEnclave.MLDSA65](https://developer.apple.com/documentation/cryptokit/secureenclave/mldsa65) e [SecureEnclave.MLDSA87](https://developer.apple.com/documentation/cryptokit/secureenclave/mldsa87).

## Estrutura atual

```text
ssi-pq-core/
├── crates/
│   ├── ssi-pq-core/          # Rust puro: regras, modelos e criptografia
│   ├── ssi-pq-node/          # napi-rs; produz o addon .node
│   ├── ssi-pq-wasm/          # wasm-bindgen; browser e testes Node.js
│   └── ssi-pq-mobile-ffi/    # UniFFI; Android/iOS
├── packages/
│   ├── web/                  # WASM web, IndexedDB wallet e facade Node-compatible
│   ├── wasm-node/            # WASM nodejs usado pela suite test-wasm
│   └── react-native/         # TurboModule, tipos TypeScript, Android/iOS
├── npm/                      # addon Node preparado por scripts/prepare-node-addon.js
├── test-node/                # testes Node/core
├── test-wasm/                # testes WASM e paridade Node/WASM
└── test-vectors/             # vetores de interoperabilidade Node/WASM/mobile
```

### `ssi-pq-core`

Depende apenas de Rust e das bibliotecas criptográficas necessárias. Não importa `napi`, `napi-derive`, APIs JNI, Swift, React Native ou tipos `Buffer`.

É responsável por:

- geração e verificação de DID;
- emissão e verificação de credenciais;
- ML-DSA, ML-KEM, AES-GCM, SHA3 e canonicalização;
- geração, assinatura e verificação de PDFs;
- serialização canônica e validações de segurança.

### `ssi-pq-node`

Contém o adaptador N-API em `crates/ssi-pq-node/src/lib.rs`, `build.rs` com `napi_build::setup()` e os tipos específicos de Node. Mantém os nomes públicos usados pelos testes e pela plataforma, por exemplo `walletSignGenericPdf`, `verifySignedGenericPdf` e `signedCredentialToPdf`.

O resultado continua sendo um `.node` distribuído pelo pacote npm para ambientes Node.js.

### `ssi-pq-wasm`

Expõe o core para WebAssembly com `wasm-bindgen`. O build web gera `packages/web/pkg`; o build `nodejs` gera `packages/wasm-node/pkg` e é usado pela suite `test-wasm`.

Os exports diretos usam contratos próprios de WASM, como `createDidJson`, `signedCredentialToPdfBytes`, `verifySignedCredentialPdfJson` e `webWalletCreateJson`. Para código migrado de Node, a camada `packages/web/ssi-pq-node-compatible.mjs` oferece nomes equivalentes aos exports Node compatíveis com browser. A exceção intencional continua sendo `canonicalJsonFile`, porque depende de path local do Node.

### `ssi-pq-mobile-ffi`

Expõe a API móvel e funções técnicas nativas usando [UniFFI](https://mozilla.github.io/uniffi-rs/latest/) para gerar bindings Kotlin e Swift a partir de uma interface Rust. UniFFI permite reutilizar o mesmo contrato em Android e iOS, evitando JNI manual para cada função e uma FFI C escrita duas vezes.

O adaptador usa UniFFI por proc-macros: `uniffi::setup_scaffolding!()` no `lib.rs`, `#[uniffi::export]` nas funções e os derives apropriados — `#[derive(uniffi::Record)]`, `#[derive(uniffi::Enum)]` ou `#[derive(uniffi::Error)]` — nos tipos expostos. Assim não há arquivo UDL duplicado nem `build.rs` para o crate móvel. O `build.rs` do `ssi-pq-node` continua existindo, pois é específico de `napi-rs`. [Scaffolding UniFFI](https://mozilla.github.io/uniffi-rs/next/tutorial/Rust_scaffolding.html).

A interface inicial deve privilegiar tipos fáceis de transportar e de versionar:

- `String` para documentos JSON, opções e resultados JSON;
- `Vec<u8>` para assinaturas, ciphertext e outros dados binários pequenos ou médios;
- records/enums UniFFI para resultados estáveis quando a API amadurecer;
- erros tipados, mapeados para exceções Kotlin e `throws` no Swift.

O UniFFI consegue representar bytes de entrada como uma visualização de memória estrangeira em determinadas chamadas, mas isso não é uma garantia de zero cópia ponta a ponta, principalmente quando há Kotlin/Swift, TurboModule, Hermes e leitura de arquivo envolvidos. Para PDF, a API React Native segura recebe `inputUri` e produz `outputUri`; a camada nativa lê/grava os bytes uma vez e chama o core Rust. [ForeignBytes do UniFFI](https://mozilla.github.io/uniffi-rs/0.27/internals/api/uniffi/ffi/struct.ForeignBytes.html).

Kotlin gerado é consumível por um app Kotlin. Java também pode chamá-lo, mas é recomendável publicar uma fachada Java pequena se Java for uma API de primeira classe para clientes externos.

Para iOS, o script atual gera bindings Swift e, em macOS com Xcode, empacota a `staticlib` em `SsiPqMobile.xcframework` com slices de device e simulator. [Pré-requisitos UniFFI](https://mozilla.github.io/uniffi-rs/0.27/tutorial/Prerequisites.html) e [XCFramework da Apple](https://developer.apple.com/documentation/xcode/creating-a-multi-platform-binary-framework-bundle?changes=_7).

## React Native

O pacote `packages/react-native` fornece uma API TypeScript segura e um TurboModule próprio e fino:

```text
TypeScript
    ↓ especificação tipada e Codegen
TurboModule Android (Kotlin) ───→ bindings Kotlin UniFFI ───→ Rust
TurboModule iOS (Swift + cola ObjC++) → bindings Swift UniFFI ─→ Rust
```

O TurboModule não deve reimplementar regras criptográficas. Suas responsabilidades são:

- converter os tipos TypeScript para os tipos da ponte;
- abrir/salvar PDFs usando as APIs nativas de arquivos;
- executar operações pesadas fora da thread de UI;
- converter erros para uma API TypeScript previsível.

No Android, `NativeSsiPqModule.kt` usa um executor em background e instancia `SsiPq.newWithStorageDir()` apontando para `noBackupFilesDir`. No iOS, `SsiPqReactNative.swift` usa uma `DispatchQueue` e persiste em `Application Support`, excluído de backup. A API pública TypeScript fica em `src/index.ts`; a facade de migração Node-like fica em `src/node-compatible.ts`; a especificação do TurboModule fica em `src/NativeSsiPq.ts`.

React Native usa uma especificação TypeScript/Flow e Codegen para produzir as interfaces de Android e iOS. Essa é a ponte recomendada para integrar Kotlin, Java, Swift ou Objective-C++ ao JavaScript do app. [Turbo Native Modules](https://reactnative.dev/docs/turbo-native-modules-introduction).

JSI permite métodos síncronos, mas isso não é motivo para tornar síncrona uma rotina de assinatura, leitura/gravação de PDF ou processamento criptográfico de custo não previsível. Na implementação atual, inclusive consultas pequenas como `supportedProfiles()` retornam `Promise`, mantendo uma superfície assíncrona uniforme.

### Por que não adotar diretamente `uniffi-bindgen-react-native`?

O projeto gera bindings JSI/TurboModule e é interessante como prova de conceito ou para acompanhar sua evolução. Porém, sua própria documentação informa que ele ainda está em desenvolvimento inicial e não recomenda uso em produção. Para uma biblioteca de chaves, credenciais e assinaturas de PDF, a opção mais prudente é UniFFI oficial para Kotlin/Swift e um TurboModule pequeno que a equipe controla. [Aviso do projeto](https://jhugman.github.io/uniffi-bindgen-react-native/).

## Android

O artefato Rust para Android é uma biblioteca compartilhada chamada `libssi_pq_mobile_ffi.so`.

Alvos Android atuais:

| Uso | ABI Android | Target Rust |
| --- | --- | --- |
| aparelhos reais | `arm64-v8a` | `aarch64-linux-android` |
| emulador moderno | `x86_64` | `x86_64-linux-android` |

`armeabi-v7a` só deve ser incluído se o produto realmente precisar de aparelhos ARM de 32 bits. Caso seja incluído, a versão `arm64-v8a` correspondente também é necessária para publicação no Google Play. [Requisito de 64 bits do Android](https://developer.android.com/google/play/requirements/64-bit).

O fluxo de build usa Android NDK e `cargo-ndk`. O resultado precisa chegar ao AAR/app em `jniLibs/<abi>/libssi_pq_mobile_ffi.so` ou ser integrado ao processo Gradle equivalente.

O script de build instala os targets `aarch64-linux-android` e `x86_64-linux-android` e então constrói ambos com `cargo-ndk`. O comando central é:

```bash
cargo ndk -t arm64-v8a -t x86_64 \
  -o packages/react-native/android/src/main/jniLibs \
  build -p ssi-pq-mobile-ffi --release
```

O artefato deve ser inspecionado no AAB/APK final, não apenas no diretório de build, para confirmar `lib/arm64-v8a/` e `lib/x86_64/` quando o emulador fizer parte da distribuição de desenvolvimento.

No repositório atual, `scripts/build-mobile-android.sh` gera os `.so` e os bindings Kotlin UniFFI em `packages/react-native/android/src/main/java/uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt`; `scripts/check-mobile-android-artifacts.sh` valida os `.so` e também inspeciona AAR/APK quando existirem. O app instrumentado de teste fica em `packages/react-native/example/android`.

## iOS

O artefato deve ser distribuído como `SsiPqMobile.xcframework`, contendo ao menos:

- iPhone/iPad físico: `aarch64-apple-ios`;
- Simulator em Apple Silicon: `aarch64-apple-ios-sim`;
- Simulator Intel, enquanto houver máquinas de desenvolvimento que o usem: `x86_64-apple-ios`.

Os binários de device e simulator devem ficar em slices separados no XCFramework. É correto usar `lipo` para unir **somente** as duas arquiteturas de simulator (`aarch64-apple-ios-sim` e `x86_64-apple-ios`) em uma biblioteca simulator universal; não se deve combinar essa biblioteca com o slice de iOS físico. Depois, `xcodebuild -create-xcframework` recebe uma biblioteca de device e uma biblioteca de simulator, junto com os headers/modulemap gerados pelo UniFFI.

No repositório atual, `scripts/build-mobile-ios.sh` sempre gera os bindings Swift UniFFI em `packages/react-native/ios/Sources/Generated`. Em Linux, o script para após essa etapa e informa que o XCFramework requer macOS/Xcode. Em macOS, ele cria `packages/react-native/ios/Frameworks/SsiPqMobile.xcframework`. O podspec em `packages/react-native/ios/SsiPqReactNative.podspec` declara esse XCFramework como `vendored_frameworks`.

## Navegador e React Native Web

Para código que roda dentro do navegador, existem duas arquiteturas válidas e com modelos de confiança diferentes.

### Opção A — WebAssembly local

O projeto já possui um binding WebAssembly em `crates/ssi-pq-wasm`, usando `wasm-bindgen`. Ele gera `.wasm` e JavaScript/TypeScript para `packages/web/pkg` e um pacote `nodejs` para testes em `packages/wasm-node/pkg`.

Vantagens:

- verificação de credenciais e PDFs inteiramente local;
- mesma implementação de formatos e criptografia do Rust;
- pode funcionar offline.

Cuidados atuais:

- o bundler precisa servir `.wasm` como asset e inicializá-lo de forma assíncrona;
- `getrandom` e dependências precisam ser testados para o target `wasm32-unknown-unknown`;
- PDF grande não deve ser copiado repetidamente entre JavaScript e WASM;
- chaves privadas no navegador exigem um desenho próprio de armazenamento e autenticação. A implementação atual usa snapshot cifrado via `wallet_storage`, persistido por IndexedDB ou por um `walletStore` fornecido pelo app; nunca se deve assumir que `localStorage` é um cofre de chaves.

Essa opção é indicada para verificação local e, após análise de ameaça, para assinaturas locais. A facade `packages/web/ssi-pq-node-compatible.mjs` cobre os exports Node compatíveis com browser, enquanto `packages/web/ssi-pq-indexeddb-wallet.mjs` oferece persistência browser-like para wallet.

### Opção B — serviço Node.js

Manter a biblioteca N-API em um backend Node.js e expor uma API HTTPS para o browser. O navegador envia PDF/dados ao serviço, que assina ou verifica no servidor.

Vantagens:

- reaproveita diretamente o addon Node atual;
- chaves privadas podem ficar fora do browser;
- simplifica atualização de algoritmos e políticas.

Cuidados:

- a chave deixa de ser autocustodial pelo usuário: ela passa a ser custodiada pelo servidor;
- exige autenticação, autorização, auditoria, limites de tamanho e proteção do endpoint;
- não funciona offline e transfere PDFs/documentos ao backend.

Essa opção é mais adequada para serviços de emissão ou assinatura institucional.

### Escolha recomendada para Web

| Necessidade | Opção recomendada |
| --- | --- |
| verificar PDF/credencial no browser, inclusive offline | WebAssembly |
| assinatura institucional com chave do emissor | backend Node.js |
| app React Native rodando em Android/iOS | TurboModule + biblioteca móvel nativa |
| React Native Web | binding WebAssembly, não `.node` nem `.so` móvel |

## Wallet e proteção de chaves no mobile

As funções atuais que retornam `privateKey` ou recebem uma senha/caminho são úteis para testes e Node, mas não devem formar a API normal de React Native. No mobile, a API pública deve trabalhar com um identificador de chave ou DID:

```text
signGenericPdf({ walletName, password, did, inputUri, outputUri, options })
  → TurboModule encontra a chave protegida no armazenamento nativo
  → Rust ou hardware compatível assina sem expor a chave ao heap JavaScript
  → retorna outputUri, bytesWritten e metadados públicos
```

### Modelo atual, compatível com Android e iOS

O core atual assina com ML-DSA-44, ML-DSA-65 ou ML-DSA-87 via `libcrux`.
Para manter a biblioteca mobile igual ao modelo Node/WASM, o modelo atual
multiplataforma é:

1. A wallet mobile usa o mesmo conceito de wallet cifrada pelo core, por senha/KDF.
2. Android persiste o estado cifrado em diretório privado do app, usando `noBackupFilesDir`.
3. iOS persiste o estado cifrado em diretório privado do app, em `Application Support`, excluído de backup.
4. Na assinatura, o core abre a wallet, usa a chave ML-DSA apenas internamente e executa a assinatura com o mesmo perfil e contexto já usados em Node/WASM.
5. O material transitório é mantido pelo menor tempo possível e apagado com `zeroize` onde a linguagem/runtime permitir.

Este modelo prioriza paridade operacional e interoperabilidade. Keystore,
Keychain, biometria e Secure Enclave podem ser adicionados depois como hardening
opcional local, mas não são requisito da baseline RN atual.

### Assinatura diretamente no hardware: caminho opcional, não substituição automática

Uma chamada reversa Rust → Kotlin/Swift para um signer nativo pode ser adicionada posteriormente, mas somente sob todas estas condições:

- o hardware e o sistema expõem **o mesmo perfil ML-DSA** do documento (`ML-DSA-65` ou `ML-DSA-87`, por exemplo);
- o formato de chave pública, assinatura, contexto e mensagem é comprovadamente interoperável com `libcrux` por vetores de teste;
- a disponibilidade é consultada em runtime e tem fallback para o modelo atual;
- a assinatura recebe o payload canônico e o contexto de domínio definidos pelo core, não um digest genérico trocado sem especificação de protocolo.

A documentação CryptoKit da Apple referenciada lista ML-DSA-65 e ML-DSA-87 no Secure Enclave, mas isso precisa ser validado contra a versão exata de Xcode/iOS adotada e em aparelho físico. As APIs legadas `SecKey`/Security que tratam Secure Enclave P-256 não devem ser tomadas como prova de suporte ML-DSA. ML-DSA-44 continua sem esse caminho descrito. Já uma assinatura `SHA256withECDSA`/P-256 do Keystore é uma assinatura diferente: ela pode servir para atestado de dispositivo ou para proteger a wallet, mas não pode ocupar o campo de uma assinatura ML-DSA em DID, credencial ou PDF.

Se esta inversão de controle for necessária, implementar uma **foreign trait** UniFFI, não `callback_interface`, e mantê-la assíncrona. Foreign traits existem justamente para o código Kotlin/Swift fornecer capacidades do dispositivo ao Rust. [Foreign traits do UniFFI](https://mozilla.github.io/uniffi-rs/next/foreign_traits.html), [MLDSA65 no Secure Enclave](https://developer.apple.com/documentation/cryptokit/secureenclave/mldsa65/privatekey).

Recomendações gerais:

- manter a wallet cifrada do core como formato primário e compatível com Node/WASM;
- avaliar Keystore/Keychain/biometria apenas como hardening opcional futuro;
- manter chaves PQ descriptografadas apenas pelo menor tempo possível em memória Rust e usar `zeroize`;
- não enviar chave privada, senha de wallet ou segredo compartilhado a logs, analytics ou JavaScript;
- usar URI/arquivo nativo para PDFs grandes, em vez de serializar todo PDF como Base64 no JavaScript.

Se o Android Keystore for adotado no futuro, ele permite chaves não exportáveis e políticas de uso/autenticação, quando suportadas pelo hardware. Não presumir StrongBox: testar a capacidade, aceitar o fallback TEE/software conforme a política e registrar o nível de proteção, se necessário. [Android Keystore](https://developer.android.com/privacy-and-security/keystore?hl=it).

## Testes e interoperabilidade

O objetivo não é apenas compilar para as plataformas, mas garantir que um artefato criado em uma delas seja validado em todas as outras.

O repositório já possui `test-vectors/` versionado com vetores Node e verificadores Node/WASM. A estratégia de vetores cobre:

- DID Documents e credenciais assinadas;
- PDFs-base e PDFs assinados;
- casos de adulteração de bytes, manifesto, credencial e chave pública;
- entradas e saídas de ML-DSA, ML-KEM, AES-GCM e canonicalização;
- resultados esperados em JSON e hashes de arquivos.

Se o signer de hardware opcional for implementado, acrescentar vetores bidirecionais: uma assinatura criada pelo Secure Enclave deve ser verificada por `libcrux`, e uma assinatura `libcrux` deve ser aceita pela implementação nativa, para cada perfil e contexto suportados. Esses testes precisam rodar em aparelho iOS físico; simulador não é evidência de proteção do Secure Enclave.

A matriz de CI e validação atual usa scripts npm e shell:

| Ambiente | Validação |
| --- | --- |
| Linux/Node | `cargo test --workspace`, `npm test`, `npm run security:audit` |
| WASM/browser-like | `npm run build:wasm`, `npm run test:wasm`, `npm run vectors:verify:wasm` |
| Vetores Node | `npm run vectors:generate:node`, `npm run vectors:verify:node` |
| React Native TypeScript | `npm run ci:react-native` |
| Android `arm64-v8a` e `x86_64` | `scripts/build-mobile-android.sh`, `scripts/check-mobile-android-artifacts.sh` |
| Android instrumentado | `scripts/test-mobile-android-flow.sh`, `scripts/test-mobile-android-nested-labels-flow.sh` |
| iOS device/simulator | `scripts/build-mobile-ios.sh`, `REQUIRE_XCFRAMEWORK=1 scripts/check-mobile-ios-artifacts.sh` em macOS |

Ainda não há app iOS exemplo completo versionado; `scripts/ci-ios-example.sh` está preparado para um futuro `packages/react-native/example/ios`.

## Estado de implementação e próximos passos

1. Workspace Rust separado: **concluído** (`ssi-pq-core`, `ssi-pq-node`, `ssi-pq-wasm`, `ssi-pq-mobile-ffi`).
2. API móvel segura sem private keys no JavaScript: **concluída** em `packages/react-native/src/index.ts`.
3. Wallet móvel cifrada pelo core em diretório privado do app: **concluída** para Android/iOS via `wallet_storage`.
4. UniFFI Kotlin/Swift por proc-macros: **concluído**, com bindings gerados em `packages/react-native/android/src/main/java/uniffi/...` e `packages/react-native/ios/Sources/Generated`.
5. Pacote React Native com TurboModule, URIs para PDFs e app Android instrumentado: **concluído** para Android; iOS possui ponte/podspec, mas não app exemplo completo.
6. WASM para browser e facade Node-compatible: **concluído** em `crates/ssi-pq-wasm` e `packages/web`.
7. Vetores e testes de interoperabilidade Node/WASM: **concluídos**; vetores mobile dedicados ainda podem ser ampliados.
8. Foreign traits para assinatura ML-DSA direta em hardware: **futuro/POC condicionado**, sem impacto na baseline atual.

## Decisão resumida

| Alternativa | Decisão | Motivo |
| --- | --- | --- |
| Compilar o addon N-API para Android/iOS | Não usar para RN comum | continua exigindo Node embutido |
| JNI manual no Android + FFI manual no iOS | Viável | maior manutenção e duplicação de ponte |
| UniFFI Kotlin/Swift + TurboModule próprio | Escolhida | núcleo único, bindings móveis gerados e ponte RN controlada |
| `uniffi-bindgen-react-native` direto | Apenas POC | ferramenta promissora, porém ainda não indicada pelo projeto para produção |
| ECDSA P-256 do Keystore como assinatura SSI-PQ | Não usar | não é compatível com a assinatura ML-DSA declarada pelo protocolo |
| ML-DSA no Secure Enclave, por foreign trait | POC condicionado | somente para perfis, versões e serializações comprovadamente compatíveis |
| Keystore/Keychain como wrapping obrigatório da wallet RN atual | Não usar na baseline | a baseline é wallet cifrada pelo core para manter paridade com Node/WASM; hardware store pode ser hardening opcional futuro |
| `.node` no navegador | Não é possível | addon é destinado a Node.js |
| WebAssembly no navegador | Escolhida para o alvo browser | executa Rust no browser sem depender de Node |
