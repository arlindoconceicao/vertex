# Plano: Aceite de Credenciais (Consentimento do Holder)

## 1. Contexto e Problema
Atualmente, no sistema VeriFile, o emissor pode emitir credenciais que são assinadas pelo aplicativo mobile. No entanto, sem uma etapa de consentimento explícito, o emissor pode emitir credenciais "a esmo" para qualquer usuário, enviando dados indesejados (spam de credenciais) ou vinculando informações a um usuário sem que ele concorde.

Para resolver isso, é necessário implementar um fluxo de **Oferta e Aceite** (Credential Offer & Acceptance), onde a credencial só é ativada e efetivamente vinculada à carteira do usuário (Holder) após a sua aprovação explícita.

---

## 2. Algoritmo Proposto (Fluxo de Aceite)

### Passo 1: Oferta de Credencial (Emissor)
1. O Emissor (Issuer) preenche os dados da credencial com base no `CredentialSchema`.
2. O Emissor solicita a emissão e realiza a assinatura da credencial no aplicativo mobile.
3. O backend armazena a `VerifiableCredential` no banco de dados, mas ela é salva com o status inicial `PENDING` (Oferta enviada, aguardando aceite).
4. O sistema (opcionalmente) notifica o Holder (via email ou push) que uma nova credencial foi oferecida.

### Passo 2: Revisão (Holder)
1. O Holder faz login no sistema Web (ou App) e acessa uma nova seção chamada **"Credenciais Pendentes"** ou **"Ofertas de Credenciais"**.
2. O sistema recupera todas as VCs do Holder que estão com status `PENDING`.
3. O Holder visualiza os dados completos da credencial: 
   - Nome do Emissor (DID / Nome)
   - Schema utilizado
   - Dados preenchidos

### Passo 3: Decisão (Aceitar ou Rejeitar)
O Holder toma uma decisão explícita sobre a credencial:

**Se o Holder REJEITAR:**
1. O Holder clica em "Rejeitar".
2. O backend atualiza o status da credencial para `REJECTED` (um novo status no ciclo de vida).
3. A credencial não aparecerá na carteira ativa do Holder.
4. Opcional: O Emissor pode ser notificado da rejeição.

**Se o Holder ACEITAR:**
1. O Holder clica em "Aceitar".
2. Para garantir segurança e não-repúdio (opcional mas recomendado no contexto SSI), o aplicativo Mobile do Holder assina um "comprovante de aceite" (payload ou hash da VC) usando a sua chave privada ML-DSA.
3. O backend recebe a requisição de aceite (junto com a assinatura criptográfica, se aplicável).
4. O backend verifica a validade do aceite.
5. O status da credencial (`VerifiableCredential`) é atualizado de `PENDING` para `ACTIVE`.
6. Somente a partir deste momento a credencial é exibida na "Carteira" oficial do Holder.

---

## 3. Impacto Técnico e Mudanças Necessárias

### 3.1. Banco de Dados (Prisma Schema)
- Atualizar o `enum VCStatus` para incluir a rejeição:
  ```prisma
  enum VCStatus {
    PENDING   // Oferta enviada, aguardando aceite do Holder
    ACTIVE    // Aceita e válida
    REVOKED   // Revogada pelo Issuer
    REJECTED  // Rejeitada pelo Holder (NOVO)
  }
  ```
- Opcional: Adicionar campos no modelo `VerifiableCredential` para guardar logs da transação de aceite, como `acceptedAt DateTime?` e a assinatura gerada pelo Holder.

### 3.2. Novos Endpoints na API Backend
- `GET /api/credentials/pending`: Retorna as credenciais com status `PENDING` vinculadas ao `holderId` do usuário logado.
- `POST /api/credentials/[id]/accept`: Endpoint consumido pelo frontend/mobile do Holder. Valida a assinatura de aceite do Holder e atualiza o status para `ACTIVE`. Adiciona o timestamp `acceptedAt`.
- `POST /api/credentials/[id]/reject`: Atualiza o status da credencial para `REJECTED`.

### 3.3. Frontend (Web / Mobile)
- **UI do Titular (Holder):**
  - Criar interface para listar "Ofertas Recebidas" separadamente das "Minhas Credenciais".
  - Criar tela de detalhes da oferta com os botões "Aceitar" e "Rejeitar".
- **Integração Mobile:**
  - O aplicativo mobile precisa ser capaz de receber a notificação de aceite e gerar a assinatura de confirmação usando a DID do Holder.

---

## 4. Conclusão
Com a implementação desse algoritmo, garantimos o princípio básico da Identidade Auto-Soberana (SSI): **o controle do usuário sobre seus dados**. Nenhuma credencial será vinculada ou imposta à carteira do titular sem que ele tenha previamente inspecionado o emissor e os dados e dado seu consentimento criptográfico explícito.
