# Documentação do Fluxo de Revogação de Credenciais

Este documento descreve a arquitetura, as regras de segurança, o registro de carimbo de data/hora (`revokedAt`) e a experiência de usuário para a revogação de Credenciais Verificáveis na plataforma SSI.

---

## 1. Regras de Negócio e Permissões

- **Apenas o Emissor (`Issuer`):** A ação de revogar uma credencial só pode ser iniciada pelo usuário que a emitiu (`credential.issuerId === session.user.id`).
- **Apenas Credenciais Ativas (`ACTIVE`):** Credenciais em estado `PENDING` ou que já foram `REVOKED` não exibem a opção de revogação.
- **Operação Irreversível com Registro Temporal:** Uma vez revogada, o status no banco de dados muda permanentemente para `REVOKED` e o campo `revokedAt` registra a data e o horário exatos (`new Date()`) da operação.

---

## 2. Experiência de Usuário (Pop-up Modal de Confirmação)

Ao navegar até os detalhes da credencial enviada (`/credentials/[id]?view=issued`), o emissor visualiza o botão **Revogar Credencial**.

1. **Clique no Botão de Revogação:**
   - Um **Pop-up Modal estendido** é renderizado na tela com backdrop escurecido (`backdrop-blur-md`).
2. **Alertas Visuais e de Segurança:**
   - Exibe um ícone vermelho de atenção/perigo.
   - Apresenta o ID da credencial que está sendo revogada.
   - Exibe o aviso destacado em fonte ampliada: *"Tem certeza de que deseja revogar esta credencial? Esta ação não pode ser desfeita e invalidará permanentemente a credencial para o titular."*
3. **Decisão:**
   - **Cancelar:** Fecha o modal imediatamente sem realizar chamadas ao servidor.
   - **Sim, Revogar Credencial:** Dispara a Server Action `revokeCredential(credentialId)` via React `startTransition`. Durante o processamento, o botão exibe um indicador de carregamento (spinner) e é desabilitado.

---

## 3. Arquitetura do Backend e Banco de Dados

- **Prisma Schema (`prisma/schema.prisma`):**
  A tabela `verifiable_credentials` registra o status e a data/hora da revogação:
  ```prisma
  enum VCStatus {
    PENDING
    ACTIVE
    REVOKED
  }

  model VerifiableCredential {
    id        String    @id
    status    VCStatus  @default(PENDING)
    revokedAt DateTime?
    // ...
  }
  ```
- **Server Action (`src/app/actions/credential-actions.ts`):**
  A função `revokeCredential(credentialId)` executa as seguintes etapas:
  1. Autentica a sessão ativa do usuário via `@/auth`.
  2. Valida se `credential.issuerId === session.user.id`.
  3. Altera a coluna `status` para `REVOKED` e grava `revokedAt: new Date()`.
  4. Executa `revalidatePath` nas rotas `/credentials/[id]` e `/dashboard`.

---

## 4. Exibição na Interface e no Verificador Público (`/verify`)

1. **Página de Detalhes da Credencial (`/credentials/[id]`):**
   - Quando a credencial estiver revogada, a interface exibe a badge vermelha: `Revogada em: DD/MM/AAAA às HH:mm:ss`.
2. **Verificador Público (`/verify`):**
   - Se qualquer pessoa submeter o PDF ou o Hash de uma credencial revogada na rota pública de verificação (`http://localhost:3000/verify`), a API retorna o erro `REVOKED_CREDENTIAL` com o timestamp `revokedAt`.
   - O formulário exibe o aviso em destaque: *"Esta credencial foi REVOGADA pelo emissor em DD/MM/AAAA às HH:mm:ss e não é mais válida."*
