# Guia de Testes de Esquemas, Busca e Paginação (`/schemas`)

Este documento descreve os procedimentos de teste e a finalidade dos scripts automatizados para homologação da página de esquemas (`http://localhost:3000/schemas`).

---

## 1. Visão Geral das Funcionalidades de Tela

A rota `/schemas` disponibiliza o gerenciamento e a navegação por esquemas de credenciais verificáveis na plataforma:

- **Busca em Tempo Real:** Permite pesquisar tanto por **Nome do Esquema** (ex: `Identidade`) quanto por **ID do Esquema** (ex: `cms61gaq80004xmxkuk3f4lcz`).
- **Filtro de Visibilidade e Posse:**
  - **Todos os Esquemas (`ALL`):** Exibe todos os esquemas aos quais o usuário tem acesso (seus próprios esquemas privados/públicos e esquemas públicos de terceiros).
  - **Meus Esquemas (`MINE`):** Exibe exclusivamente os esquemas criados pelo usuário logado (públicos e privados).
  - **Esquemas Públicos (`PUBLIC`):** Exibe todos os esquemas públicos disponíveis na plataforma.
  - **Meus Esquemas Privados (`PRIVATE`):** Exibe apenas os esquemas criados pelo usuário logado com visibilidade privada.
- **Paginação:** Agrupa a exibição em **9 itens por página** com navegação limpa ("Anterior", "Página X de Y", "Próximo").

---

## 2. Scripts Automatizados de Teste (`lib/`)

Para testar a eficiência da paginação, os seletores de filtros e a responsividade da busca sem a necessidade de criar dezenas de esquemas manualmente pela interface Web, disponibilizamos dois scripts utilitários em `lib/`:

### A. Geração de Esquemas Fakes (`lib/generate-fake-schemas.js`)

Este script cria um lote de esquemas de teste no banco de dados. Todos os esquemas gerados recebem obrigatoriamente o prefixo no nome: `"T1000T"`.

**Comando de Execução:**
```bash
# Criar 20 esquemas de teste para o primeiro usuário do banco:
node lib/generate-fake-schemas.js 20

# Criar 25 esquemas de teste para um usuário específico:
node lib/generate-fake-schemas.js 25 teste@gmail.com
```

**Comportamento:**
- Gera títulos variados (Diplomas, Certificados, Acreditações).
- Alterna aleatoriamente entre visibilidades `PUBLIC` e `PRIVATE`.
- Vincula o criador ao usuário especificado para validar os filtros "Meus Esquemas" e "Públicos".

---

### B. Limpeza de Esquemas Fakes (`lib/cleanup-fake-schemas.js`)

Este script remove do banco de dados PostgreSQL todos os esquemas cujos nomes comecem com o prefixo `"T1000T"`.

**Comando de Execução:**
```bash
node lib/cleanup-fake-schemas.js
```

**Vantagens:**
- Permite popular o banco com 50+ registros para homologar a paginação e depois limpar tudo com um único comando.
- Não afeta esquemas reais criados manualmente pelos usuários da aplicação.

---

## 3. Roteiro de Validação E2E

1. Execute o script de geração:
   ```bash
   node lib/generate-fake-schemas.js 25 teste@gmail.com
   ```
2. Acesse a rota: `http://localhost:3000/schemas`.
3. Verifique a paginação gerada (3 páginas). Navegue entre elas usando "Próximo" e "Anterior".
4. Alterne o seletor de filtro para "Meus Esquemas Privados" e confirme se apenas os esquemas privados criados por você permanecem visíveis.
5. Digitar `"T1000T"` ou um ID no campo de busca para atestar o filtro em tempo real.
6. Execute o script de limpeza:
   ```bash
   node lib/cleanup-fake-schemas.js
   ```
7. Recarregue a página `/schemas` e confirme que a base retornou ao estado original.
