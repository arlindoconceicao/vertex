# Endpoints da Aplicação (API REST)

Este documento registra os endpoints disponíveis na plataforma SSI, organizados por domínio de negócio. Todos os endpoints abaixo foram conferidos na base de código (`src/app/api`) e encontram-se implementados e ativos.

## Schemas (Modelos de Credenciais)
- **`GET /api/schemas`**: Retorna uma lista de todos os schemas cadastrados.
- **`POST /api/schemas`**: Cria um novo schema, inicialmente em estado de rascunho (draft).
- **`GET /api/schemas/[id]`**: Retorna os detalhes de um schema específico através do seu ID.
- **`PATCH /api/schemas/[id]`**: Atualiza as informações de um schema existente.
- **`POST /api/schemas/[id]/publish`**: Publica um schema que estava em rascunho, tornando-o imutável e pronto para emissão de credenciais.

## DIDs (Identificadores Descentralizados)
- **`POST /api/dids`**: Cria um novo Identificador Descentralizado (DID).
- **`GET /api/dids/[id]`**: Resolve um DID e retorna o seu respectivo Documento DID (W3C DID Document) no formato JSON, apresentando as chaves públicas.
- **`POST /api/dids/search/challenge`**: (Integração M2M) Gera um desafio criptográfico (nonce) associado ao DID do App Mobile (`requesterId`) para prova de identidade. Requer autenticação por token Bearer `SIGNER_SECRET`.
- **`GET /api/dids/search`**: (Integração M2M) Busca um Documento DID a partir do `cpf` ou `email` informado como Query Parameter. Exige os headers `x-requester-id`, `x-challenge-id` e `x-challenge-signature` para validar que o aplicativo mobile resolveu o desafio emitido anteriormente e tem a posse da chave privada correta.

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
- **`GET /api/signer/requests/pending`**: Endpoint para integrações (Aplicativo Móvel) consultar quais credenciais estão aguardando assinatura. Requer autenticação baseada em Prova de Posse (PoP) pós-quântica via header `x-signer-auth-credential` (credencial de desafio gerada localmente pelo banco SQLite cifrado da wallet e verificada com a chave pública ML-DSA do DID registrado na plataforma). Filtra e retorna exclusivamente as credenciais pendentes pertencentes ao DID autenticado.
- **`POST /api/signer/callback`**: Endpoint para integrações (M2M / Aplicativo Móvel) retornar o arquivo da credencial já assinada pelo proprietário usando criptografia pós-quântica.

## Verificação Pública (Verifier)
- **`POST /api/verifier/verify`**: Endpoint público em que um terceiro pode enviar uma credencial apresentada e receber de volta o resultado da verificação criptográfica (integridade, autoria e status de revogação).
