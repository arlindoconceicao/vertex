# Fluxo de Verificação de Credenciais (`/verify`)

A página de Verificação (Verifier) é a porta de entrada pública do sistema, onde entidades externas podem auditar a autenticidade e validade de credenciais pós-quânticas emitidas pela plataforma. Esta tela está acessível sem necessidade de autenticação (login) e foca 100% na segurança, privacidade e controle de abusos.

## 1. Modos de Verificação

A página suporta dois métodos distintos de auditoria, garantindo versatilidade dependendo de quem detém o arquivo PDF.

### A. Upload de PDF (Decifrado)
Nesta aba, o verificador faz o upload do arquivo PDF (em claro) que foi apresentado pelo Destinatário. 
- O arquivo é enviado via `multipart/form-data`.
- **Privacidade Extrema (In-Memory Processing):** O servidor Node.js recebe o arquivo diretamente em um Buffer na memória RAM. O arquivo **nunca** é salvo no disco do servidor.
- **Integração SSI-PQ:** O Buffer é passado para a biblioteca C++ nativa (`core.extractCredentialManifestFromPdf`), que localiza o marcador binário `%SSI-PQ-MANIFEST-V1` (inserido pela função `core.walletEmbedSignedCredentialInPdf`) e extrai o JSON embutido.
- **Validação:** A plataforma extrai o `issuer_did`, busca a chave pública do emissor no banco de dados e invoca `core.verifySignedCredentialPdf` para checar as assinaturas matemáticas Pós-Quânticas.
- Após o processamento (e retorno de sucesso ou falha para a interface web), o Garbage Collector do Node se encarrega de expurgar a memória, mantendo 0 rastros.

### B. PDF Hash (Proof of Existence)
Para casos em que o verificador não possui o PDF completo ou o destinatário não quer compartilhar o documento inteiro, a verificação pode ocorrer apenas pelo **Hash (SHA-256)** gerado a partir dos bytes do PDF original.
- O auditor cola o hash da credencial na tela.
- A API `/api/verifier/verify` procura por esse hash na coluna `pdfHash` da tabela de Credenciais.
- Se existir, a credencial é considerada autêntica (Proof of Existence), pois a plataforma só armazena hashes de credenciais validadas e emitidas.
- A plataforma retorna as informações de *metadata* armazenadas.

---

## 2. Proteção Anti-Abuso (CAPTCHA)

Por ser uma rota pública e realizar cálculos criptográficos complexos (ML-DSA), o endpoint é um potencial alvo de ataques de Força Bruta e Negação de Serviço (DDoS). 

Para precaver isso, implementamos um **Math CAPTCHA local** (`MathCaptcha.tsx`).
- O usuário deve resolver uma conta matemática simples na interface (ex: `7 + 4 = ?`).
- O botão `Verificar assinatura da credencial` fica bloqueado até a resolução.
- **Auto-reset:** Sempre que uma validação termina (com sucesso ou erro), o formulário sofre um `reset`. O CAPTCHA sorteia uma nova conta e o botão é desabilitado novamente. Isso impossibilita validações em lote usando a mesma prova CAPTCHA.

---

## 3. Retorno e Exibição de Dados (Estrutura do Esquema)

Para preservar a privacidade de quem detém a credencial, a plataforma foi ajustada para remover as informações sensíveis (PII) dos metadados extraídos. 
O retorno da API exibe dois grandes blocos de informação na tela:

1. **Proof of Existence Metadata:** Apresenta o JSON da `credential` limpo (excluindo os detalhados `attribute_hashes`), e adicionando a chave `revealed_attributes` (que contém o caminho e valor das características liberadas na assinatura).
2. **Schema Structure:** Exibe o esquema de dados (`schema_id`) original que balizou a criação da credencial (ex: Campos obrigatórios do "Certificado de Formação"). Assim, o auditor pode ver não só o que foi provado, mas qual o escopo total possível daquela credencial, garantindo o contexto da verificação.
