# Privacidade da Plataforma e Verificação (SSIaaS)

A plataforma SSIaaS foi desenhada sob os pilares da **Self-Sovereign Identity (SSI)** e da **Minimização de Dados**. Este documento descreve as políticas de privacidade implementadas, especialmente relacionadas aos ciclos de vida dos PDFs gerados e da exclusão dos Dados Pessoais (PII).

## 1. Zero Conhecimento Permanente de PII
A plataforma opera apenas como um conduíte entre o Emissor (Issuer) e o Destinatário (Holder).

1. Durante a fase de solicitação (**PENDING**), a plataforma armazena o PII (JSON `vcPayload`) provisoriamente, apenas para exibição até que o Emissor conclua a assinatura no aplicativo móvel.
2. Quando o PDF (assinado e criptografado via ML-KEM) sobe para a plataforma, ele fica armazenado temporariamente ao lado do PII original, para que o Emissor possa conferir os dados emitidos.
3. **Deleção Automática**: Assim que o Destinatário realiza o download do PDF criptografado (seja pela Web ou pelo App Mobile), a API registra a data de download (`pdfDownloadedAt`), extrai e substitui imediata e permanentemente todo o PII sensível por um **Metadata (Sumário de Identificadores)**.
4. O banco de dados passa a armazenar unicamente:
   - DID do Emissor
   - DID do Destinatário
   - Timestamp da Assinatura
   - ID do Schema
   - Hash (SHA-256) do PDF em claro

Assim, caso a plataforma sofra uma invasão, nenhum dado pessoal de cidadãos/entidades estará exposto no banco de dados.

## 2. Configuração de Retenção de PDFs
Como os PDFs armazenados estão duplamente protegidos (AES-256-GCM + ML-KEM da chave pública do destinatário), eles permanecem seguros no banco da nuvem. No entanto, para fins de políticas rigorosas de retenção e economia de disco, introduzimos o **Controle de Retenção**.

- O **Emissor** pode configurar, na tela de Configurações do seu perfil, o número de dias que um PDF permanecerá disponível para download (entre **1 e 15 dias**).
- O padrão é de 7 dias.
- Futuramente, será habilitado um Cronjob diário na plataforma que excluirá a coluna de buffer binário (`pdfFile`) das credenciais em que a data (`issuedAt`) ultrapasse essa janela, conservando apenas os Metadados da transação.

## 3. Verificação por Prova de Existência (Proof of Existence via Hash)
Um pilar essencial da identidade descentralizada é a capacidade de um terceiro validar uma credencial.

Normalmente, o W3C exige que o JSON seja validado em sua estrutura de assinatura (`proof`). No entanto, no modelo de **Credencial PDF Seguro**, quem atesta a posse do dado em claro é o Hash SHA-256.

### Como funciona:
1. O destinatário extrai e lê o seu PDF local (decifrado pelo App Mobile).
2. O destinatário envia este PDF de forma off-line para o Verificador (Terceiro).
3. O Verificador (ou a própria plataforma, usando o script `lib/get-pdf-hash.js`) gera o Hash SHA-256 deste PDF em claro.
4. Na tela pública `/verify` da plataforma, o Verificador seleciona a aba **"PDF Hash (Proof of Existence)"** e cola o código SHA-256.
5. A plataforma SSIaaS responde afirmativamente, informando o DID de quem emitiu, o schema utilizado, e quando foi assinado (resgatando os metadados do banco, atrelando a validade do arquivo).
