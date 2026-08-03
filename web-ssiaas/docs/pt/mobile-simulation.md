# Simulação Mobile e Scripts de Apoio (`lib/`)

> [!WARNING]
> **ATENÇÃO (AMBIENTE DE PRODUÇÃO):** Todos os scripts de simulação Node (`.js` e `.ts`) localizados na pasta `lib/` operam com acesso direto ao banco de dados e devem ser usados apenas em Desenvolvimento/Testes. Em um ambiente de **Produção**, esses scripts DEVEM ser apagados. A pasta `lib/` em produção deve conter apenas a biblioteca binária `ssi_pq_core.node` e módulos estritamente necessários para a aplicação web.

Este documento descreve os scripts criados na pasta `lib/` para simular o comportamento do aplicativo móvel de assinaturas (Mobile Signer App) e o fluxo de comunicação ponta a ponta com a plataforma Web SSIaaS.

Estes scripts interagem com a biblioteca nativa `ssi_pq_core.node` (Criptografia Pós-Quântica), o banco de dados cifrado do SQLite (`mobile_wallet.db`) e o backend Next.js local.

## 1. Geração de PDFs de Credenciais Pendentes

**Script:** `lib/generate-pending-pdfs.js`

Este script simula o App Mobile buscando as credenciais que o emissor solicitou gerar na plataforma, validando a posse das chaves por meio de um desafio (Prova de Posse), e finalmente emitindo um arquivo PDF local da credencial assinada contendo o payload e suas etiquetas visíveis.

### Fluxo de Execução do Script:
1. **Desbloqueio da Wallet Cifrada**: Lê a chave de decifragem em `lib/keys.txt` e abre o banco local SQLite (`lib/mobile_wallet.db`). Extrai o DID ativo (ex: `did:ssipq:zHzcq...`).
2. **Autenticação (Proof-of-Possession)**: Emite instantaneamente e em memória uma `Verifiable Credential` (VC) de autenticação que funciona como um "desafio" temporário para provar a posse da chave primária (ML-DSA) daquele DID.
3. **Consulta na Plataforma**: Envia essa credencial codificada em Base64 através do header `x-signer-auth-credential` para o endpoint `GET /api/signer/requests/pending`.
4. **Filtro de Dados Sensíveis**: Recebe o array de credenciais pendentes. Varre dinamicamente o objeto `credentialSubject`, excluindo a propriedade interna `id` para não sujar o documento final. Extrai todos os caminhos do JSON (ex: `formacao.curso`, `endereco.cidade`) mapeando seus rótulos (*labels*).
5. **Assinatura e Geração do PDF**:
   - Cria um schema estrutural sob medida via `core.createSchemaFromAttributes()`.
   - Executa a assinatura da VC com a chave do titular via `core.walletIssueCredentialFromSchema()`.
   - Gera um arquivo `.pdf` formatado usando a função interna `core.signedCredentialToPdf()` e salva o resultado como `lib/credential_<requestId>.pdf`.

### Como rodar:
```bash
node lib/generate-pending-pdfs.js
```

## 2. Upload de PDFs Criptografados (Callback)

**Script:** `lib/upload-pdfs.js`

Após gerar os PDFs em claro (pelo script anterior), este script simula a etapa final onde o App Mobile cifra o PDF para os olhos exclusivos do destinatário e envia para a plataforma (Callback).

### Fluxo de Execução do Script:
1. **Autenticação no Backend**: Utiliza o DID e a assinatura ML-DSA para criar uma Prova de Posse (Proof-of-Possession).
2. **Busca de DIDs**: Lê a lista de credenciais pendentes. Para cada uma, descobre qual é o DID do destinatário (Holder).
3. **Resolução de Chave Pública**: Faz uma chamada a `GET /api/signer/recipient-key/:did` para buscar a chave **ML-KEM** pública do destinatário.
4. **Cifragem Híbrida Pós-Quântica**:
   - Usa a chave pública ML-KEM do destinatário para encapsular um segredo compartilhado e gerar uma chave AES-256 simétrica.
   - Cifra o conteúdo do PDF usando AES-256-GCM.
5. **Callback Multipart**: Embala o PDF cifrado, o material criptográfico (ciphertext ML-KEM, nonce, authTag) e os metadados (resumo sem PII) em um pacote `multipart/form-data`.
6. **Upload Final**: Envia via `POST /api/signer/callback`. A plataforma armazena o PDF cifrado, converte o status de PENDING para ACTIVE e apaga os dados pessoais do payload JSON no banco. Em seguida, o script exclui o PDF local para segurança.

### Exemplo de Saída:
```bash
node lib/upload-pdfs.js
=================================================
📤 ENVIANDO PDFs CRIPTOGRAFADOS PARA A PLATAFORMA
=================================================
🔑 Autenticando com DID: did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf
📡 Buscando requisições pendentes para obter os IDs e DIDs...

📄 Processando upload para requisição: cms7ffgtn0001ikxkdhkbucld
🔍 Buscando chave pública do destinatário: did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf
🔒 Criptografando o PDF...
🚀 Fazendo upload via POST multipart/form-data...
✅ Upload da credencial cms7ffgtn0001ikxkdhkbucld concluído com sucesso!
```

## 3. Download e Decifragem de PDFs

**Script:** `lib/simulate-mobile-download.js`

Este script simula o App Mobile do Destinatário (Holder) baixando o PDF criptografado e decifrando-o com sua chave privada Pós-Quântica.

### Fluxo de Execução do Script:
1. **Desbloqueio da Wallet Cifrada**: Lê a chave e abre o banco local SQLite (`lib/mobile_wallet.db`). Extrai o DID ativo.
2. **Autenticação (Proof-of-Possession)**: Emite e assina uma credencial temporária para consultar e baixar os arquivos destinados ao seu DID.
3. **Consulta na Plataforma**: Chama `GET /api/signer/credentials/available` e retorna os IDs das credenciais aguardando download pelo titular.
4. **Download e Deleção Automática de PII**: Para cada arquivo disponível, o script faz a requisição em `GET /api/signer/download-pdf/[id]`. Neste exato momento, a **plataforma apaga as informações confidenciais (PII)** do banco de dados na nuvem para manter o sigilo, deixando apenas os metadados e marcando a data `pdfDownloadedAt`.
5. **Decifragem Híbrida**:
   - Lê o arquivo PDF binário baixado.
   - Extrai a cápsula ML-KEM, nonce, authTag e o ciphertext AES.
   - Desencapsula a chave usando sua própria carteira via `core.walletMlkemDecapsulate()`.
   - Decifra o PDF de volta para a sua versão legível usando `core.aes256GcmDecrypt()`.
   - Salva o PDF localmente em claro como `lib/decrypted_<credentialId>.pdf`.

### Como rodar:
```bash
node lib/simulate-mobile-download.js
```

## 4. Identificador do Emissor vs. DID

Ao observar o PDF gerado ou a página de configurações da plataforma, você notará dois identificadores distintos. É crucial entender a finalidade criptográfica de cada um deles:

### Identidade Descentralizada (DID)
**Exemplo:** `did:ssipq:zHzcqWj9c21JqCYdKGGoeVDSXtjaTMdVowavVstxGuEYf`
- O DID é o endereço primário legível utilizado para encaminhamento e registro em ambientes distribuídos.
- Ele aponta publicamente para o **Documento DID (DID Document)**, que por sua vez, carrega as chaves públicas (ML-DSA para assinatura e ML-KEM para pareamento).
- É a identidade que os usuários e sistemas trocam para iniciar requisições de credenciais.

### Identificador do Emissor (Issuer Identifier)
**Exemplo:** `zv2BZBG5bBPLB4UITTtEyTl8Q3ZLZr7KxNHpf2s4Nww=`
- Diferente do endereço lógico (DID), o Identificador do Emissor é uma **impressão digital criptográfica em Base64 (Hash/Fingerprint)** gerada unicamente em cima do Documento DID e da **chave pública bruta**.
- **Propósito de Segurança**: Ele é exibido fisicamente dentro do arquivo PDF da Credencial (e agora também na tela de Configurações da plataforma). 
- Ao vincular o documento PDF à *Hash* real e matemática da chave em vez do mero endereço textual (DID), a biblioteca `ssi_pq_core` protege o PDF de adulterações triviais (como alguém apenas trocar a string do DID editando o PDF sem possuir a chave privada verdadeira correspondente à assinatura atrelada ao documento).

Dessa forma, o **DID** identifica *onde encontrar* as chaves, e o **Identificador do Emissor** comprova *matematicamente que as chaves coincidem* com a assinatura presente.

## 5. Limpeza de Credenciais (Ambiente de Testes)

**Script:** `lib/clear-user-credentials.ts`

Durante o desenvolvimento e testes do fluxo de emissão, geração de PDFs e uploads de PDFs criptografados, pode ser necessário limpar o banco de dados das credenciais que já passaram pelo fluxo de assinatura. Como a plataforma visa não possuir um botão para "deletar" um registro permanentemente através da interface do usuário normal (dada a natureza imutável dos registros de SSI, exceto pela revogação), criamos um script para atuar diretamente no banco.

### Comportamento do Script:
1. Ele conecta no banco de dados através da URL do ambiente (`DATABASE_URL` via `.env`).
2. Pesquisa pelo usuário do sistema usando o **E-mail**.
3. Conta quantas credenciais aquele e-mail Emitiu (como `Issuer`) e Recebeu (como `Holder`).
4. Apresenta o resultado na tela e realiza um prompt de verificação de segurança (Sim/Não).
5. Se confirmado, aciona o `deleteMany` do Prisma eliminando definitivamente as credenciais e seus PDFs associados.

### Como rodar:
Execute o script passando o e-mail do usuário entre aspas:
```bash
npx tsx lib/clear-user-credentials.ts "email@exemplo.com"
```
