# Integração IPFS com Pinata

Este documento explica como a Plataforma SSI se integra ao IPFS (InterPlanetary File System) usando o serviço Pinata para hospedar Esquemas de Credenciais (Schemas).

## Visão Geral

Credenciais Verificáveis (VCs) dependem de esquemas de dados (JSON Schema) para definir sua estrutura. Para fins de interoperabilidade, esses esquemas são publicados na rede pública IPFS. A plataforma utiliza o SDK do Pinata para fazer o upload desses esquemas sem a necessidade de operar um nó IPFS próprio.

## Detalhes da Implementação

1. **Esquema de Banco de Dados:**
   O modelo `CredentialSchema` no Prisma armazena:
   - `ipfsCid`: O identificador de conteúdo (CID) usado para resolução criptográfica no ecossistema SSI.
   - `pinataFileId`: O ID administrativo usado para o gerenciamento do arquivo através da API do Pinata.
   - `storageLocation`: Um enum indicando se o arquivo está como `LOCAL` ou no `IPFS`.

2. **Server Action do Backend:**
   Em `src/app/actions/schema-actions.ts`, a função `publishSchema` utiliza `src/lib/pinata.ts` para enviar o objeto JSON ao gateway público do Pinata. O esquema é marcado como um arquivo público e anotado com metadados `keyvalues` (`resourceType: ssi-schema`).

3. **Integração no Frontend:**
   Quando um esquema é publicado, a interface do usuário (`SchemaDetailClientView.tsx`) exibe o Pinata File ID, o CID do IPFS e um botão para visualizar o schema JSON bruto diretamente pelo gateway dedicado (`https://{GATEWAY_URL}/ipfs/{CID}`).

## Configuração de Ambiente

A plataforma requer uma conta ativa no Pinata com chaves de API configuradas no arquivo `.env`.

Adicione as seguintes linhas ao seu `.env` (um template está disponível no `.env.example`):

```env
# --- PINATA IPFS ---
# URL do seu Gateway Dedicado do Pinata (ex: meu-gateway.mypinata.cloud)
GATEWAY_PINATA="seu-gateway.mypinata.cloud"
# Token JWT para autenticação na API
JWT_PINATA="eyJhbGciOiJIUzI1NiIsInR5cCI..."
```

## Como Configurar Sua Conta no Pinata

Para recuperar sua URL de Gateway e as credenciais JWT, siga os passos abaixo:

1. **Crie uma Conta:**
   Acesse o [Pinata](https://app.pinata.cloud/auth/signup) e crie uma conta gratuita. O plano gratuito oferece 1 GB de armazenamento e um gateway dedicado, o que é mais do que suficiente para pequenos esquemas JSON.

2. **Obtenha a URL do Gateway:**
   - No painel do Pinata, clique em **Gateways**.
   - Localize o gateway dedicado que foi criado automaticamente.
   - Copie apenas o domínio (por exemplo, `aquamarine-casual-tarantula-177.mypinata.cloud`). NÃO inclua `https://` ou `/ipfs/`. Cole esse valor na variável `GATEWAY_PINATA`.

3. **Gere uma Chave de API (JWT):**
   - No painel do Pinata, clique em **API Keys**.
   - Clique em **New Key** (Nova Chave).
   - Selecione as seguintes permissões para garantir segurança:
     - `org:files:read`
     - `org:files:write`
   - Dê um nome à chave (ex: "backend-plataforma-ssi").
   - Clique em **Create Key** (Criar Chave).
   - Copie a string longa que foi gerada (marcada como **JWT**) e cole na variável `JWT_PINATA`.
   - *Nota: Mantenha seu JWT seguro. Ele deve estar presente apenas no arquivo `.env` do backend e nunca ser exposto ao frontend ou repositórios públicos.*
