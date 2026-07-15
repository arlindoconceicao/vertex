# Geração das bibliotecas

Este documento resume como gerar as bibliotecas locais do projeto SSI-PQ e onde
encontrar os artefatos finais para consumo por aplicações Node.js, WASM e
Android/React Native.

## Visão geral

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Alvo</th>
      <th>Comando principal</th>
      <th>Artefato principal</th>
      <th>Uso esperado</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><strong>Node.js N-API</strong></td>
      <td><code>npm run build</code></td>
      <td><code>npm/ssi_pq_core.node</code></td>
      <td>Addon nativo carregado por <code>require()</code> em Node.js.</td>
    </tr>
    <tr>
      <td><strong>WASM web</strong></td>
      <td><code>npm run build:wasm</code></td>
      <td><code>packages/web/pkg/ssi_pq_wasm.js</code> + <code>ssi_pq_wasm_bg.wasm</code></td>
      <td>Pacote WASM para navegador/bundlers web.</td>
    </tr>
    <tr>
      <td><strong>WASM Node/testes</strong></td>
      <td><code>npm run build:wasm:test</code></td>
      <td><code>packages/wasm-node/pkg/ssi_pq_wasm.js</code> + <code>ssi_pq_wasm_bg.wasm</code></td>
      <td>Pacote WASM gerado com target <code>nodejs</code>, usado pelos testes e validadores WASM.</td>
    </tr>
    <tr>
      <td><strong>Android / React Native</strong></td>
      <td><code>scripts/build-mobile-android.sh</code></td>
      <td><code>packages/react-native/android/src/main/jniLibs/*/libssi_pq_mobile_ffi.so</code></td>
      <td>Bibliotecas nativas por ABI e bindings Kotlin UniFFI para app Android/RN.</td>
    </tr>
  </tbody>
</table>

## Pré-requisitos por alvo

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Alvo</th>
      <th>Ferramentas necessárias</th>
      <th>Observações</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Node.js</td>
      <td>Rust/Cargo, Node.js</td>
      <td>O script compila o crate <code>ssi-pq-node</code> em modo debug e copia a biblioteca nativa para <code>npm/</code>.</td>
    </tr>
    <tr>
      <td>WASM web</td>
      <td>Rust/Cargo, <code>wasm-pack</code>, target <code>wasm32-unknown-unknown</code></td>
      <td>O CI instala <code>wasm-pack</code> via <code>taiki-e/install-action@wasm-pack</code>.</td>
    </tr>
    <tr>
      <td>WASM Node/testes</td>
      <td>Rust/Cargo, <code>wasm-pack</code>, target <code>wasm32-unknown-unknown</code></td>
      <td>Gera um pacote separado para execução em Node.js.</td>
    </tr>
    <tr>
      <td>Android / React Native</td>
      <td>Rust/Cargo, <code>rustup</code>, <code>cargo-ndk</code>, Android SDK/NDK</td>
      <td>O NDK esperado é <code>27.1.12297006</code>. O script aceita <code>ANDROID_NDK_HOME</code>, <code>ANDROID_NDK_ROOT</code>, <code>ANDROID_HOME</code> ou <code>ANDROID_SDK_ROOT</code>.</td>
    </tr>
  </tbody>
</table>

## Node.js

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Etapa</th>
      <th>Comando ou caminho</th>
      <th>Resultado</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gerar addon local</td>
      <td><code>npm run build</code></td>
      <td>Executa <code>cargo build -p ssi-pq-node</code> e depois <code>node scripts/prepare-node-addon.js</code>.</td>
    </tr>
    <tr>
      <td>Biblioteca Rust intermediária no Linux</td>
      <td><code>target/debug/libssi_pq_node.so</code></td>
      <td>Arquivo produzido pelo Cargo antes da cópia para o formato consumido pelo Node.</td>
    </tr>
    <tr>
      <td>Biblioteca Rust intermediária no macOS</td>
      <td><code>target/debug/libssi_pq_node.dylib</code></td>
      <td>Mesmo papel do <code>.so</code>, mas para macOS.</td>
    </tr>
    <tr>
      <td>Biblioteca Rust intermediária no Windows</td>
      <td><code>target/debug/ssi_pq_node.dll</code></td>
      <td>Mesmo papel do <code>.so</code>, mas para Windows.</td>
    </tr>
    <tr>
      <td>Artefato final para aplicação Node</td>
      <td><code>npm/ssi_pq_core.node</code></td>
      <td>Arquivo carregado diretamente pelos testes e scripts Node.</td>
    </tr>
  </tbody>
</table>

Exemplo de consumo em Node.js:

```js
const core = require('./npm/ssi_pq_core.node');
```

Ao distribuir uma aplicação Node que consome o addon local, associe o arquivo
<code>ssi_pq_core.node</code> ao código JavaScript que faz o <code>require()</code>.
O caminho relativo pode mudar, mas o arquivo precisa estar disponível no
ambiente de execução.

## WASM

O projeto gera dois pacotes WASM diferentes: um para web e outro para Node.js.
Em ambos os casos, o arquivo JavaScript gerado depende do arquivo
<code>.wasm</code> ao lado dele. Portanto, os dois devem ser copiados/publicados
juntos.

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Alvo</th>
      <th>Comando</th>
      <th>Diretório de saída</th>
      <th>Arquivos principais</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Web/browser</td>
      <td><code>npm run build:wasm</code></td>
      <td><code>packages/web/pkg/</code></td>
      <td><code>ssi_pq_wasm.js</code>, <code>ssi_pq_wasm_bg.wasm</code>, <code>ssi_pq_wasm.d.ts</code></td>
    </tr>
    <tr>
      <td>Node.js/testes</td>
      <td><code>npm run build:wasm:test</code></td>
      <td><code>packages/wasm-node/pkg/</code></td>
      <td><code>ssi_pq_wasm.js</code>, <code>ssi_pq_wasm_bg.wasm</code>, <code>ssi_pq_wasm.d.ts</code></td>
    </tr>
  </tbody>
</table>

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Cenário de consumo</th>
      <th>Arquivos que devem ir juntos</th>
      <th>Motivo</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Aplicação web com bundler ou publicação do pacote <code>packages/web/pkg</code></td>
      <td><code>ssi_pq_wasm.js</code><br><code>ssi_pq_wasm_bg.wasm</code><br><code>ssi_pq_wasm.d.ts</code> se usar TypeScript</td>
      <td>O JS é a camada de inicialização/glue; o <code>.wasm</code> contém o binário compilado; o <code>.d.ts</code> fornece tipos.</td>
    </tr>
    <tr>
      <td>Aplicação Node.js usando o pacote WASM de testes</td>
      <td><code>ssi_pq_wasm.js</code><br><code>ssi_pq_wasm_bg.wasm</code><br><code>ssi_pq_wasm.d.ts</code> se usar TypeScript</td>
      <td>O arquivo JS carrega o módulo WASM gerado para target <code>nodejs</code>; o <code>.wasm</code> precisa permanecer acessível no mesmo pacote.</td>
    </tr>
    <tr>
      <td>Publicação npm do pacote gerado pelo <code>wasm-pack</code></td>
      <td><code>package.json</code><br><code>ssi_pq_wasm.js</code><br><code>ssi_pq_wasm_bg.wasm</code><br><code>ssi_pq_wasm.d.ts</code></td>
      <td>O <code>package.json</code> aponta <code>main</code> para <code>ssi_pq_wasm.js</code> e <code>types</code> para <code>ssi_pq_wasm.d.ts</code>.</td>
    </tr>
  </tbody>
</table>

Exemplo de consumo do pacote WASM Node gerado:

```js
const wasm = require('./packages/wasm-node/pkg/ssi_pq_wasm.js');
```

Para web, importe o pacote gerado em <code>packages/web/pkg</code> conforme o
padrão do bundler usado. O ponto importante é manter
<code>ssi_pq_wasm.js</code> e <code>ssi_pq_wasm_bg.wasm</code> no mesmo conjunto
de artefatos publicados.

## Android / React Native

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Etapa</th>
      <th>Comando ou caminho</th>
      <th>Resultado</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Gerar bibliotecas Android e bindings Kotlin</td>
      <td><code>scripts/build-mobile-android.sh</code></td>
      <td>Compila a FFI mobile, gera bindings Kotlin UniFFI e cria bibliotecas nativas por ABI.</td>
    </tr>
    <tr>
      <td>Atalho via pacote React Native</td>
      <td><code>npm run build:android --prefix packages/react-native</code></td>
      <td>Executa o mesmo script a partir do pacote React Native.</td>
    </tr>
    <tr>
      <td>Host library usada para gerar bindings</td>
      <td><code>target/release/libssi_pq_mobile_ffi.so</code></td>
      <td>Biblioteca local usada pelo UniFFI para gerar os bindings Kotlin.</td>
    </tr>
    <tr>
      <td>Binding Kotlin UniFFI</td>
      <td><code>packages/react-native/android/src/main/java/uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt</code></td>
      <td>API Kotlin gerada automaticamente para chamar a FFI.</td>
    </tr>
    <tr>
      <td>Wrapper React Native Android</td>
      <td><code>packages/react-native/android/src/main/java/com/ssipq/reactnative/NativeSsiPqModule.kt</code></td>
      <td>Módulo Android manual que expõe a API para React Native.</td>
    </tr>
    <tr>
      <td>Package React Native Android</td>
      <td><code>packages/react-native/android/src/main/java/com/ssipq/reactnative/SsiPqPackage.kt</code></td>
      <td>Registro do módulo nativo no React Native.</td>
    </tr>
  </tbody>
</table>

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>ABI Android</th>
      <th>Biblioteca gerada</th>
      <th>Destino esperado no app</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>arm64-v8a</code></td>
      <td><code>packages/react-native/android/src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so</code></td>
      <td><code>src/main/jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so</code></td>
    </tr>
    <tr>
      <td><code>x86_64</code></td>
      <td><code>packages/react-native/android/src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so</code></td>
      <td><code>src/main/jniLibs/x86_64/libssi_pq_mobile_ffi.so</code></td>
    </tr>
  </tbody>
</table>

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Cenário de consumo Android</th>
      <th>Arquivos/pastas a associar</th>
      <th>Observação</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>App React Native usando este pacote como módulo nativo</td>
      <td><code>packages/react-native/android/</code><br><code>packages/react-native/src/</code><br><code>packages/react-native/react-native.config.js</code></td>
      <td>Inclui wrappers Android, bindings Kotlin gerados, bibliotecas <code>.so</code> e superfície TypeScript.</td>
    </tr>
    <tr>
      <td>App Android/Kotlin consumindo a FFI diretamente</td>
      <td><code>uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt</code><br><code>jniLibs/arm64-v8a/libssi_pq_mobile_ffi.so</code><br><code>jniLibs/x86_64/libssi_pq_mobile_ffi.so</code></td>
      <td>Use a classe Kotlin gerada pelo UniFFI e mantenha as bibliotecas nativas nas ABIs que o app vai suportar.</td>
    </tr>
    <tr>
      <td>App Android que usa o wrapper React Native manual</td>
      <td><code>NativeSsiPqModule.kt</code><br><code>SsiPqPackage.kt</code><br><code>uniffi/ssi_pq_mobile_ffi/ssi_pq_mobile_ffi.kt</code><br><code>jniLibs/*/libssi_pq_mobile_ffi.so</code></td>
      <td>O wrapper manual depende do binding UniFFI e das bibliotecas nativas por ABI.</td>
    </tr>
  </tbody>
</table>

## Checks úteis depois da geração

<table border="1" cellpadding="6" cellspacing="0">
  <thead>
    <tr>
      <th>Alvo</th>
      <th>Comando de verificação</th>
      <th>O que valida</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Node.js</td>
      <td><code>node --test test-node/core/wallet-pdf-mlkem-nested-schema-labels-flow.test.js</code></td>
      <td>Executa um fluxo Node real usando <code>npm/ssi_pq_core.node</code>.</td>
    </tr>
    <tr>
      <td>WASM</td>
      <td><code>npm run test:wasm</code></td>
      <td>Recompila Node/WASM de teste e roda os testes em <code>test-wasm/*.test.js</code>.</td>
    </tr>
    <tr>
      <td>Android</td>
      <td><code>scripts/check-mobile-android-artifacts.sh</code></td>
      <td>Confere a presença das bibliotecas Android geradas.</td>
    </tr>
    <tr>
      <td>Android instrumentado</td>
      <td><code>scripts/test-mobile-android-flow.sh</code></td>
      <td>Compila Android e roda o fluxo instrumentado em emulador/aparelho conectado.</td>
    </tr>
    <tr>
      <td>Android nested labels</td>
      <td><code>scripts/test-mobile-android-nested-labels-flow.sh</code></td>
      <td>Roda apenas o fluxo Android equivalente ao teste Node de schema aninhado e labels em português.</td>
    </tr>
  </tbody>
</table>
