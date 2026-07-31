# Tutorial de Teste E2E (Emissão, Assinatura e Verificação)

Este tutorial descreve o passo a passo completo e ordenado para testar o ciclo de vida de uma Credencial Verificável na plataforma, simulando as ações do Emissor (App Mobile), do Destinatário (App Mobile/Web) e do Verificador (Plataforma Pública) partindo **exatamente do zero**.

Utilize este roteiro para homologar o fluxo Pós-Quântico ponta a ponta.

---

## 1. Limpeza e Reset do Ambiente (Partindo do Zero)

Para garantir que não haja conflitos com testes anteriores, limpamos o banco de dados desvinculando os DIDs antigos e apagando credenciais de testes passados. (Neste exemplo usaremos `teste@gmail.com`).

**Limpar o Pareamento DID:**
Este script remove o DID, as chaves públicas e os desafios de pareamento anteriores do usuário no banco.
```bash
node lib/reset-did.js teste@gmail.com
```

**Limpar as Credenciais Antigas:**
```bash
npx tsx lib/clear-user-credentials.ts "teste@gmail.com"
```

---

## 2. Testes Iniciais de Pareamento (Opcionais)

Antes de parear oficialmente o seu usuário para o fluxo principal, você pode rodar os seguintes scripts que validam a integridade do sistema de pareamento:

**A. Teste de Pareamento Forjado (Negativo):**
Simula um ataque onde alguém tenta responder ao desafio de pareamento usando chaves forjadas (assinatura ML-DSA inválida). A plataforma **deve rejeitar**.
```bash
node lib/complete-pairing-forged.js
```

**B. Teste Automatizado de Pareamento:**
Roda o fluxo inteiro automaticamente (cria desafio, assina com chave real, envia e aprova) sem intervenção manual.
```bash
node lib/did-pairing-flow.test.js
```

---

## 3. Pareamento Manual Simulando o Aplicativo

Para que as suas credenciais emitidas via Web sejam assinadas corretamente, você deve associar o seu usuário à Mobile Wallet local.
1. Acesse a plataforma web (`/settings`) e inicie o pareamento.
2. Copie o Payload JSON gerado na tela.
3. Execute o script passando o payload entre aspas simples para simular o App Mobile concluindo o pareamento:
```bash
node lib/complete-pairing.js '{"pairingId":"...", "nonce":"...", ...}'
```
*O script criará o `mobile_wallet.db` com sua nova identidade DID e chaves pós-quânticas, vinculando-o com sucesso ao banco.*

---

## 4. Emissão da Credencial (Interface Web)

1. Acesse o **Dashboard** da plataforma.
2. Clique em **Emitir Nova Credencial**.
3. Preencha os formulários com os dados do titular (Destinatário) e submeta. 
4. A credencial ficará no estado `PENDING` aguardando a assinatura da Mobile Wallet.
   - **Regra de Privacidade & Segurança:** Enquanto estiver `PENDING`, a credencial fica visível **exclusivamente para o Emissor** em sua aba "Credenciais Emitidas". O Destinatário **nunca** visualiza credenciais pendentes até que o processo de assinatura pós-quântica seja concluído.

---

## 5. Simulação da Assinatura (Mobile Wallet do Emissor)

O App do Emissor busca a credencial pendente e assina os dados injetando o Manifesto SSI Pós-Quântico no PDF.

Execute:
```bash
node lib/generate-pending-pdfs.js
```
*Gera o arquivo local `.pdf` em claro assinado.*

---

## 6. Geração do Proof of Existence (Opcional - Hash do PDF)

Se quiser testar a validação via Hash mais tarde na tela pública, você pode extrair o SHA-256 exato deste PDF em claro agora.
```bash
node lib/get-pdf-hash.js lib/credential_XXXXXXXX.pdf
```
*Guarde o hash retornado para colar na aba "PDF Hash" da página de Verificação.*

---

## 7. Envio Criptografado para a Plataforma (Mobile Wallet do Emissor)

O App do Emissor criptografa o PDF usando a chave pública (ML-KEM) do Destinatário antes de enviá-lo para a web.
```bash
node lib/upload-pdfs.js
```
*Após a conclusão deste envio, o status da credencial muda automaticamente para `ACTIVE`, tornando-a finalmente visível e disponível na aba "Credenciais Recebidas" do Destinatário.*

---

## 8. Download e Decifragem

O Destinatário quer ler a sua credencial recém-emitida. Ele pode fazer isso de duas formas na simulação:

**A. Simulação via App Mobile (Automática):**
Este script simula o App fazendo a chamada API de download do arquivo `.enc`, abrindo a `mobile_wallet.db` e realizando a decapsulação (ML-KEM + AES-GCM) para gerar o PDF em claro localmente.
```bash
node lib/simulate-mobile-download.js
```

**B. Simulação via Interface Web (Manual):**
Você acessa o Dashboard Web com a conta do destinatário e baixa manualmente o `.enc`. Para decifrar este arquivo no seu PC local usando a sua Wallet de testes:
```bash
node lib/decrypt-local-pdf.js ~/Downloads/credential_XXXXXXXX.pdf.enc
```

Ambos os passos gerarão um PDF lido (terminando em `_decifrado.pdf`).

---

## 9. Validação Criptográfica Pública (Verificador)

Para atestar o ciclo completo, utilize o arquivo decifrado ou o hash gerado no Passo 6.

1. Acesse a rota pública: `http://localhost:3000/verify`
2. **Via PDF**: Na aba "Upload de PDF", envie o `_decifrado.pdf`. A plataforma lerá as chaves in-memory e dará o "Valid".
3. **Via Hash**: Na aba "PDF Hash", cole o hash do Passo 6 para atestar a existência na base de dados.

---

## 10. Dinâmica de Privacidade no Dashboard (Holder vs Issuer)

O Dashboard (`/credentials/[id]`) trata dinamicamente a visibilidade e o apagamento (Zero-Knowledge) de dados:

- **Visão do Destinatário (Holder):**
  Aba "Credenciais Recebidas". Exibe credenciais nos status `ACTIVE` ou `REVOKED` (credenciais `PENDING` não são exibidas). Você terá a opção de baixar o PDF criptografado. Após o primeiro download, a plataforma **apagará definitivamente os dados PII do banco**, substituindo as chaves com `"Ocultado (PII removido)"`.

- **Visão do Emissor (Issuer):**
  Aba "Credenciais Emitidas". Exibe emissões em todos os status (`PENDING`, `ACTIVE`, `REVOKED`).
  - **Enquanto PENDING**: Aguardando assinatura pelo App Assinador.
  - **Depois de ACTIVE (antes do download pelo Holder)**: Exibe o botão **Mostrar Dados**, permitindo ver os dados emitidos.
  - **Depois do Holder fazer o download**: O botão "Mostrar Dados" desaparece e a tela exibirá apenas as chaves (ex: `Nome`, `CPF`) com os valores marcados como "Ocultado (PII removido)".

> **Importante para testes unificados:** 
> Se você usou o **mesmo usuário** (mesmo e-mail/DID) para atuar como Emissor e Destinatário no teste, ao clicar no card da credencial lá na tela principal, a plataforma enviará um parâmetro interno (`?view=received` ou `?view=issued`) forçando a perspectiva correta daquela aba para que os botões não se sobreponham.

### Script de Reset para Testes Visuais

Caso você já tenha rodado a simulação de download do Destinatário e deseje testar a visualização dos dados puros novamente na visão do Emissor **sem precisar emitir uma credencial nova**, basta utilizar o script de reset.

```bash
# Resetar uma credencial específica:
node lib/reset-download-status.js "ID_DA_CREDENCIAL"

# Resetar todas as credenciais de um emissor de uma vez:
node lib/reset-download-status.js "teste@gmail.com"
```
