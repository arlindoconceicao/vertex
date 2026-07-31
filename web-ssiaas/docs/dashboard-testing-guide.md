# Guia de Testes do Dashboard (`/dashboard`) - Busca, Filtros e Paginação

Este documento descreve os procedimentos de teste e a utilidade dos scripts para homologação das abas de **Credenciais Recebidas** e **Credenciais Emitidas** na página do Dashboard (`http://localhost:3000/dashboard`).

---

## 1. Visão Geral das Funcionalidades

No Dashboard, tanto o Destinatário quanto o Emissor possuem ferramentas avançadas para gerenciar e filtrar seus volumes de credenciais:

- **Busca em Tempo Real:** Permite filtrar instantaneamente por:
  - Nome ou e-mail da contraparte (Emissor ou Destinatário).
  - Nome do Esquema de origem.
  - ID do Esquema ou ID da Credencial.
  - Tipo da Credencial (ex: `Identidade`, `Diploma`).
- **Filtro de Status:** Permite refinar a busca por estado da credencial (`Todos os Status`, `Ativa`, `Pendente`, `Revogada`).
- **Paginação:** Agrupa a exibição em **6 credenciais por página** com controles de navegação ("Anterior", "Página X de Y", "Próximo").

---

## 2. Scripts de Teste Automatizado em `lib/`

Para testar a busca e a paginação sem precisar criar e assinar dezenas de credenciais manualmente, utilize os scripts auxiliares:

### A. Geração de Credenciais Fakes (`lib/generate-fake-credentials.js`)

Cria um lote de credenciais de teste vinculadas à sua conta. Todas as credenciais geradas contêm o prefixo `"T1000T"`.

```bash
# Gerar 15 credenciais de teste para o e-mail padrão:
node lib/generate-fake-credentials.js 15 teste@gmail.com
```

- Alterna os status entre `ACTIVE`, `PENDING` e `REVOKED`.
- Atribui títulos e dados realistas para testar os filtros de busca.

---

### B. Limpeza de Credenciais Fakes (`lib/cleanup-fake-credentials.js`)

Remove do banco de dados todas as credenciais e esquemas de teste criados com o prefixo `"T1000T"`.

```bash
node lib/cleanup-fake-credentials.js
```

---

## 3. Roteiro de Homologação E2E

1. Gerar 15 credenciais de teste no banco:
   ```bash
   node lib/generate-fake-credentials.js 15 teste@gmail.com
   ```
2. Acesse `http://localhost:3000/dashboard`.
3. Navegue entre as páginas na aba "Credenciais Recebidas".
4. Experimente filtrar por status (ex: selecionar "Pendente").
5. Digite um termo de busca (ex: `"Identidade"` ou o e-mail de um emissor) para testar a busca reativa.
6. Limpe as credenciais temporárias do banco:
   ```bash
   node lib/cleanup-fake-credentials.js
   ```
