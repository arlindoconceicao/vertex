# Recomendações para pareamento de DID com o aplicativo assinador

Este documento resume sugestões e precauções para aplicar o plano descrito em `Pareamento do aplicativo com a plataforma.pdf` nesta plataforma web. O objetivo é ligar a conta autenticada no Auth.js/Google a um aplicativo móvel que gera a DID, mantém a chave privada e assina credenciais.

## Estado atual do projeto

- A identidade interna do usuário é `users.id`, gerada por `cuid()`.
- `email`, `cpf` e `did` são campos únicos, mas não são chave primária.
- A tela `/settings` hoje registra DID e chave pública diretamente via formulário.
- O endpoint `POST /api/dids` também aceita `did` e `publicKey` diretamente, sem desafio criptográfico.
- O fluxo de assinatura de credenciais já existe em `/api/signer/*`, mas usa `SIGNER_SECRET` máquina-a-máquina e ainda não está ligado a um pareamento individual por usuário/dispositivo.

## Direção recomendada

Tratar o pareamento como uma etapa anterior e obrigatória ao uso do assinador:

1. Usuário entra na web com Google e completa CPF.
2. Usuário entra no app com a mesma conta Google.
3. Plataforma cria um desafio de curta duração para aquele usuário.
4. App gera DID e par de chaves.
5. App assina o desafio incluindo DID e chaves públicas.
6. Plataforma valida a assinatura e associa DID/chaves ao `users.id`.
7. A partir daí, o app pode assinar credenciais apenas para aquela conta pareada.

A associação principal deve continuar sendo com `users.id`. CPF e email podem ser gravados no desafio como evidência/auditoria do contexto do pareamento, mas não devem substituir a chave interna.

## Modelo de dados sugerido

Adicionar uma tabela para desafios de pareamento:

```prisma
model DidPairingChallenge {
  id        String   @id @default(cuid())
  userId    String
  cpf       String
  email     String
  pairingId String   @unique
  nonce     String
  status    String   @default("PENDING")
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
  @@index([expiresAt])
  @@map("did_pairing_challenges")
}
```

Precauções:

- Use `userId` como vínculo real com a conta.
- Mantenha `cpf` e `email` como snapshot do momento do pareamento, úteis para auditoria.
- Modele `status` como enum Prisma se possível: `PENDING`, `COMPLETED`, `EXPIRED`, `CANCELLED`.
- `pairingId` deve ser imprevisível e único. Prefira UUID v4 ou bytes aleatórios codificados em base64url/hex.
- `nonce` deve ter pelo menos 256 bits de entropia. Exemplo: 32 bytes aleatórios em base64url.
- `expiresAt` deve ser curto, como 10 minutos.

Também será necessário evoluir `User`. O plano fala em ML-DSA e ML-KEM; hoje o projeto tem apenas `didPublicKey`. Evite misturar chaves diferentes no mesmo campo sem formato claro.

Sugestão:

```prisma
model User {
  // campos atuais...
  did             String? @unique
  didPublicKey    String?
  didMldsaKey     String?
  didMlkemKey     String?
  didPairedAt     DateTime?
}
```

Outra opção melhor para longo prazo é criar uma tabela separada `DidKey` ou `DidPairing`, porque isso facilita rotação de chaves, múltiplos dispositivos e revogação.

## Endpoints sugeridos

### `POST /api/v1/did-pairings`

Cria o desafio para o usuário logado.

Requisitos:

- Exigir sessão Auth.js válida.
- Exigir `session.user.id`.
- Exigir CPF já cadastrado.
- Se o usuário já tem DID pareada, retornar `409 Conflict` ou exigir fluxo explícito de rotação.
- Cancelar ou expirar desafios antigos pendentes antes de criar um novo.
- Retornar apenas os campos que o app precisa assinar.

Resposta exemplo:

```json
{
  "id": "challenge_cuid",
  "pairingId": "uuid-ou-token-aleatorio",
  "nonce": "base64url-32-bytes",
  "expiresAt": "2026-07-22T12:05:00.000Z"
}
```

### `POST /api/v1/did-pairings/:pairingId/complete`

Recebe o payload assinado pelo app e conclui o pareamento.

O payload assinado deve conter, no mínimo:

```json
{
  "id": "challenge_cuid",
  "pairingId": "uuid-ou-token-aleatorio",
  "nonce": "base64url-32-bytes",
  "expiresAt": "2026-07-22T12:05:00.000Z",
  "did": "did:ssipq:...",
  "mlDsaPublicKey": "...",
  "mlKemPublicKey": "...",
  "proof": {
    "type": "ML-DSA",
    "created": "2026-07-22T12:02:14.000Z",
    "verificationMethod": "did:ssipq:...#key-1",
    "proofValue": "..."
  }
}
```

Validações obrigatórias:

- O desafio existe.
- O status é `PENDING`.
- O desafio ainda não expirou.
- O usuário autenticado é o dono do desafio, via `userId`.
- O `nonce` recebido é igual ao armazenado.
- O `pairingId` do payload é igual ao `pairingId` da URL.
- Os quatro primeiros campos do desafio não foram alterados.
- A assinatura ML-DSA é válida usando a chave pública enviada.
- A DID do payload corresponde ao material de chave esperado pela biblioteca.
- A DID ainda não está vinculada a outra conta.
- A conta ainda não possui DID, salvo fluxo explícito de rotação.

Na conclusão, use transação:

1. Releia o desafio com bloqueio lógico pelo status.
2. Atualize o desafio para `COMPLETED` e grave `usedAt`.
3. Atualize `users.did`, `users.didMldsaKey`, `users.didMlkemKey` e `users.didPairedAt`.

Se houver erro de validação, marque o desafio como `CANCELLED` quando fizer sentido. Se estiver expirado, marque como `EXPIRED`.

## Canonicalização do JSON

Este ponto é crítico. A plataforma e o app precisam assinar/verificar exatamente os mesmos bytes.

Precauções:

- Defina uma forma canônica de serialização JSON antes de implementar.
- Não dependa de `JSON.stringify` comum se a biblioteca do app ordenar campos de outro jeito.
- Use a mesma função de canonicalização usada para assinar schemas/credenciais, se ela já existir na biblioteca criptográfica.
- Documente se os campos usam `DID`/`ML-DSA`/`ML-KEM` ou nomes JSON convencionais como `did`, `mlDsaPublicKey`, `mlKemPublicKey`.
- Padronize datas em ISO 8601 UTC com milissegundos ou sem milissegundos, mas sempre do mesmo modo.

## Segurança e abuso

- O desafio deve ser de uso único.
- O desafio deve expirar rapidamente.
- Gere `pairingId` e `nonce` com `crypto.randomBytes` ou API equivalente segura.
- Adicione rate limit por usuário, IP e conta Google.
- Não registre chaves privadas, payloads sensíveis ou `proofValue` completo em logs.
- Use comparação constante para segredos compartilhados, especialmente em `SIGNER_SECRET`.
- Evite mensagens de erro que revelem se uma DID pertence a outra conta.
- Não permita reaproveitar um desafio concluído ou cancelado.
- Em caso de concorrência, garanta que duas chamadas simultâneas não consigam parear duas DIDs.
- Registre trilha de auditoria mínima: `userId`, `pairingId`, status, timestamps e motivo genérico de falha.

## Ajustes no fluxo de assinatura de credenciais

Depois do pareamento, o app assinador não deve enxergar todas as credenciais pendentes globalmente.

Hoje `GET /api/signer/requests/pending` retorna todas as VCs `PENDING` para qualquer app com `SIGNER_SECRET`. Para uma integração pareada, prefira:

- autenticação por usuário/dispositivo pareado, não apenas segredo global;
- retorno apenas das solicitações onde `issuerId = userId` da conta pareada;
- validação de que o `issuer` do payload é a DID pareada daquele usuário;
- rejeição do callback se a assinatura não verificar contra a chave pública pareada;
- separação clara entre `PENDING_SIGNATURE` e `PENDING_ACCEPTANCE`, porque hoje `VCStatus.PENDING` mistura os dois momentos.

Uma melhoria importante seria criar `SigningRequest` como tabela própria, em vez de usar `VerifiableCredential` como pedido de assinatura. Isso evita salvar uma VC sem assinatura como se já fosse uma credencial.

## Impacto na tela `/settings`

Trocar o formulário manual de DID por um fluxo de pareamento:

- Mostrar estado: sem DID, aguardando app, pareado, expirado ou erro.
- Botão "Iniciar pareamento" cria o desafio.
- Exibir QR Code ou código curto contendo `pairingId`/URL, se o app precisar iniciar pelo telefone.
- Atualizar a tela por polling curto ou server refresh enquanto o app conclui.
- Depois de pareado, exibir DID e chaves públicas somente leitura.
- Não permitir edição manual da DID sem fluxo de rotação/revogação.

## Compatibilidade com o plano do PDF

O plano fala em gravar DID associada a CPF e email. Nesta base, faça essa associação por meio de `users.id`, mantendo CPF e email como atributos únicos e snapshots de auditoria.

Motivo:

- `users.id` é imutável e interno.
- Email pode mudar no provedor ou na conta.
- CPF é dado pessoal sensível e não deve ser usado como chave técnica de integração.
- `email + cpf` não é chave primária no schema atual.

## Checklist antes de implementar

- Confirmar o formato exato exportado pela biblioteca criptográfica para chave pública completa.
- Confirmar se a assinatura ML-DSA será feita sobre JSON canônico ou bytes pré-montados.
- Definir se o app chama os endpoints com sessão Google própria, token do backend, ou fluxo OAuth/OIDC específico.
- Definir se a plataforma web também terá DID própria para validar a chave de cifragem ML-KEM.
- Adicionar migração Prisma e testes de transição de status.
- Testar desafio expirado, desafio reutilizado, DID duplicada, nonce alterado, payload alterado e assinatura inválida.
- Revisar os endpoints `/api/dids` e action `registerDid`; idealmente eles devem ser substituídos pelo fluxo de pareamento ou ficar restritos a ambiente de desenvolvimento.

## Ordem de implementação sugerida

1. Criar enum/modelo `DidPairingChallenge` e campos de chave no usuário.
2. Implementar geração segura de desafio.
3. Implementar endpoint de conclusão com validações sem ainda salvar DID.
4. Integrar verificação real da assinatura ML-DSA.
5. Salvar DID/chaves em transação.
6. Atualizar `/settings` para iniciar e acompanhar o pareamento.
7. Restringir os endpoints `/api/signer/*` para operar por usuário pareado.
8. Adicionar testes automatizados para os casos de ataque e expiração.

## Resposta esperada para o app

Ao concluir com sucesso:

```json
{
  "paired": true,
  "did": "did:ssipq:71c7d5ae...",
  "status": "ACTIVE",
  "pairedAt": "2026-07-22T12:02:14.000Z"
}
```

O app deve mudar seu estado local para autorizado apenas após receber essa resposta e deve guardar a associação local entre conta Google, DID e chaves geradas.
