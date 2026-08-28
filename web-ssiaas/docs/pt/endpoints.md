# Endpoints da Aplicação (API REST)

Este documento registra os endpoints disponíveis na plataforma SSI, organizados por domínio de negócio. Todos os endpoints abaixo foram conferidos na base de código (`src/app/api`) e encontram-se implementados e ativos.

## Schemas (Modelos de Credenciais)
- **`GET /api/schemas`**: Retorna uma lista de todos os schemas cadastrados. Opcionalmente inclui informações de gravação no IPFS (`ipfsCid` e `ipfsUrl`) se o schema tiver sido publicado.
- **`POST /api/schemas`**: Cria um novo schema, inicialmente em estado de rascunho (draft).
- **`GET /api/schemas/[id]`**: Retorna os detalhes de um schema específico através do seu ID. Inclui informações de IPFS (`ipfsCid` e `ipfsUrl`) se disponível.
- **`PATCH /api/schemas/[id]`**: Atualiza as informações de um schema existente.
- **`POST /api/schemas/[id]/publish`**: Publica um schema que estava em rascunho, tornando-o imutável e pronto para emissão de credenciais.

## DIDs (Identificadores Descentralizados)
- **`POST /api/dids`**: Cria um novo Identificador Descentralizado (DID).
- **`GET /api/dids/[id]`**: Resolve um DID e retorna o seu respectivo Documento DID (W3C DID Document) no formato JSON, apresentando as chaves públicas. Adicionalmente, retorna as propriedades de IPFS (`ipfsCid`, `ipfsUrl`) se o DID estiver gravado na rede descentralizada.
- **`POST /api/dids/search/challenge`**: (Integração M2M) **[Autenticação: BEARER]** Gera um desafio criptográfico (nonce) associado ao DID do App Mobile (`requesterId`) para prova de identidade.
- **`GET /api/dids/search`**: (Integração M2M) **[Autenticação: BEARER + DESAFIO (PoP)]** Busca um Documento DID a partir do `cpf`, `email` ou `did` informados como Query Parameter. Exige os headers `x-requester-id`, `x-challenge-id` e `x-signer-auth-credential` (Credencial Verificável PoP contendo o nonce gerado). Este fluxo imita exatamente o processo do SDK mobile, atestando a propriedade do DID pós-quântico sem expor chaves brutas. Retorna as propriedades de IPFS (`ipfsCid`, `ipfsUrl`) caso existam.

## Usuários
- **`GET /api/users/search`**: Realiza uma busca estrita por um usuário no sistema (frequentemente utilizado para busca exata por CPF ao selecionar um destinatário para uma credencial).

## Credenciais Verificáveis (VCs)
- **`GET /api/credentials`**: Retorna a lista de credenciais emitidas ou recebidas, dependendo de quem faz a requisição.
- **`POST /api/credentials`**: Inicia o processo de emissão de uma nova credencial.
- **`GET /api/credentials/stats`**: Retorna as estatísticas consolidadas das credenciais (por exemplo: quantidade total, pendentes, emitidas e revogadas).
- **`GET /api/credentials/[id]`**: Busca e retorna os dados de uma credencial específica pelo seu ID.
- **`PATCH /api/credentials/[id]/accept`**: Registra que o destinatário aceitou a credencial (fase do ciclo de vida da credencial).
- **`PATCH /api/credentials/[id]/revoke`**: Revoga (cancela a validade de) uma credencial emitida.

## Assinatura Digital (Integração com App Mobile)
- **`GET /api/signer/requests/pending`**: **[Autenticação: BEARER + DESAFIO (PoP)]** Endpoint para integrações (Aplicativo Móvel) consultar quais credenciais estão aguardando assinatura. Requer autenticação baseada em Prova de Posse (PoP) pós-quântica via header `x-signer-auth-credential` com a ação `pending_credentials_auth`. Filtra e retorna exclusivamente as credenciais pendentes pertencentes ao DID autenticado.
- **`GET /api/signer/credentials/available`**: **[Autenticação: BEARER + DESAFIO (PoP)]** Retorna as credenciais com status ACTIVE que possuem arquivo PDF e aguardam download pelo Holder. Requer PoP com ação `available_credentials_auth`.
- **`GET /api/signer/download-pdf/[id]`**: **[Autenticação: BEARER]** Permite baixar o arquivo PDF criptografado de uma credencial ativa.
- **`GET /api/signer/recipient-key/[did]`**: **[Autenticação: BEARER + DESAFIO (PoP)]** Busca a chave pública ML-KEM de um destinatário para cifragem assimétrica. Requer PoP com ação `recipient_key_auth`.
- **`POST /api/signer/callback`**: **[Autenticação: BEARER]** Endpoint para integrações (M2M / Aplicativo Móvel) retornar o arquivo da credencial já assinada pelo proprietário usando criptografia pós-quântica.

## Verificação Pública (Verifier)
- **`POST /api/verifier/verify`**: Endpoint público em que um terceiro pode enviar uma credencial apresentada e receber de volta o resultado da verificação criptográfica (integridade, autoria e status de revogação).

---

## Autenticação Mobile (Integração M2M)

Os endpoints de integração com o aplicativo móvel (`/api/signer/*` e `/api/dids/search*`) são protegidos. O grau de proteção depende da sensibilidade do endpoint:

1. **[Autenticação: BEARER]**
   Requer apenas o envio de um token HMAC gerado localmente usando o `SIGNER_SECRET` e o DID do usuário.
2. **[Autenticação: BEARER + DESAFIO (PoP)]**
   Além do token Bearer, o aplicativo precisa provar matematicamente que possui a chave privada do DID. Ele faz isso gerando uma **Credencial Verificável Efêmera** assinada pela própria carteira e enviando-a em Base64 através do cabeçalho HTTP `x-signer-auth-credential`.

### Exemplos de Acesso (JavaScript / Node.js)

Estes exemplos ilustram como a lógica deve ser codificada (e podem ser adaptados para o SDK do Android/Kotlin).

**Exemplo 1: Consumindo endpoint BEARER (`/api/signer/download-pdf`)**
```javascript
const crypto = require("crypto");

const signerSecret = "SEU_SIGNER_SECRET";
const userDid = "did:ssipq:zHz..."; // DID do dono da carteira

// Gera o token M2M usando HMAC SHA-256
const bearerToken = crypto.createHmac("sha256", signerSecret).update(userDid).digest("hex");

const response = await fetch("https://plataforma/api/signer/download-pdf/123", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${bearerToken}`
  }
});
```

**Exemplo 2: Consumindo endpoint BEARER + DESAFIO (`/api/signer/requests/pending`)**
```javascript
const crypto = require("crypto");
// (Supondo que você tenha instanciado a biblioteca baseada na ssi_pq_core.node ou SDK nativo)
const core = require('./lib/ssi_pq_core.node'); 

const signerSecret = "SEU_SIGNER_SECRET";
const userDid = "did:ssipq:zHz...";
const bearerToken = crypto.createHmac("sha256", signerSecret).update(userDid).digest("hex");

// 1. O App Mobile gera um payload local de desafio com o timestamp atual
const authPayload = { 
  action: "pending_credentials_auth", 
  timestamp: new Date().toISOString() 
};

// 2. Prepara o schema temporário
const authSchema = core.createSchemaFromAttributes(authPayload, { 
  version: "1", 
  createdAt: authPayload.timestamp 
});

// 3. Emite a credencial verificável (Assinando com a chave da carteira)
const authCredential = core.walletIssueCredentialFromSchema(
  walletPath,       // Caminho da carteira local
  walletPassword,   // Senha da carteira
  userDid,          // O DID ativo
  authSchema,
  authPayload,
  {
    credentialId: `auth-req-${Date.now()}`,
    issuedAt: authPayload.timestamp,
    visiblePaths: ["action", "timestamp"]
  }
);

// 4. Converte a credencial assinada (PoP) para Base64
const authCredentialBase64 = Buffer.from(JSON.stringify(authCredential)).toString("base64");

// 5. Envia a requisição contendo o Bearer Token e a PoP
const response = await fetch("https://plataforma/api/signer/requests/pending", {
  method: "GET",
  headers: {
    "Authorization": `Bearer ${bearerToken}`,
    "x-signer-auth-credential": authCredentialBase64
  }
});
```

## Verificação Pública (Verifier)
- **`POST /api/verifier/verify`**: Endpoint público em que um terceiro pode enviar uma credencial apresentada e receber de volta o resultado da verificação criptográfica (integridade, autoria e status de revogação).
