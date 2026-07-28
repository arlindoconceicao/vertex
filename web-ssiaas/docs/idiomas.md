# Guia de Internacionalização (i18n) e Gerenciamento de Idiomas

Este documento descreve a arquitetura de internacionalização (i18n) da plataforma SSI, explicando o funcionamento da **auto-descoberta dinâmica de dicionários**, o **arquivo de controle de rotas**, o **script de detecção de telas não traduzidas** e o fluxo de trabalho ao adicionar novas telas ao projeto.

---

## 1. Visão Geral da Arquitetura

A plataforma adota uma **abordagem híbrida de alta performance**:
* **Preferência do Usuário:** Salva no banco de dados PostgreSQL (modelo `User.language` via Prisma) e sincronizada nos cookies de sessão (`NEXT_LOCALE`).
* **Idioma Padrão (Default):** **Inglês (`en`)**. Caso o usuário não tenha definido uma preferência ou se uma chave de tradução estiver ausente no idioma selecionado, o sistema aplica o fallback automático para o Inglês.
* **Provedor Global:** O `AppLanguageProvider` envolve a aplicação no `RootLayout` (`src/app/layout.tsx`), tornando a troca de idioma **instantânea em tempo real em todas as telas**.
* **Dicionários JSON:** Armazenados no diretório `src/locales/messages/` (`en.json`, `pt.json`, `es.json`).
* **Auto-Descoberta:** O sistema varre automaticamente a pasta `src/locales/messages/` ao iniciar, registrando todos os idiomas disponíveis sem necessidade de alterar o código TypeScript.

---

## 2. Controle de Cobertura de Telas (`routes-manifest.json`)

Para evitar que novas telas sejam criadas na aplicação sem o suporte a i18n, mantemos um arquivo de controle em:
`src/locales/routes-manifest.json`

Este arquivo lista todas as rotas/telas da aplicação que possuem cobertura de tradução:

```json
{
  "$schema": "Manifest of application routes covered by i18n translations",
  "coveredRoutes": [
    {
      "route": "/dashboard",
      "file": "src/app/dashboard/page.tsx",
      "description": "Painel de controle principal com estatísticas e lista de credenciais",
      "namespace": "dashboard"
    },
    {
      "route": "/schemas/new",
      "file": "src/app/schemas/new/page.tsx",
      "description": "Formulário de criação e publicação de novos esquemas",
      "namespace": "schemas"
    }
  ]
}
```

---

## 3. Scripts CLI de Manutenção e Validação

Disponibilizamos três comandos essenciais no `package.json`:

### A. Verificar Telas Sem Tradução (`npm run i18n:check-routes`)
* **Comando:** `npm run i18n:check-routes`
* **Script:** `scripts/check-route-coverage.ts`
* **Funcionamento:** Varre o diretório `src/app/` procurando por páginas Next.js (`page.tsx`) e compara contra o manifesto `routes-manifest.json`. Se houver alguma tela nova criada na aplicação que não foi cadastrada no controle de traduções, o script exibirá um aviso detalhado e retornará erro.

### B. Validar Paridade de Chaves de Tradução (`npm run i18n:validate`)
* **Comando:** `npm run i18n:validate`
* **Script:** `scripts/validate-i18n.ts`
* **Funcionamento:** Compara todos os dicionários secundários (`pt.json`, `es.json`, etc.) contra o dicionário canônico (`en.json`). Se faltar alguma chave em algum idioma, o script acusa com precisão quais chaves precisam ser traduzidas.

### C. Sincronizar Chaves Faltantes (`npm run i18n:sync`)
* **Comando:** `npm run i18n:sync`
* **Script:** `scripts/validate-i18n.ts --fix`
* **Funcionamento:** Preenche automaticamente nos dicionários secundários as chaves faltantes copiando o texto padrão em inglês, facilitando o trabalho de tradução.

---

## 4. Fluxo de Trabalho: Como Adicionar uma Nova Tela no Projeto

Ao desenvolver um novo recurso ou criar uma nova tela na aplicação (exemplo: `src/app/relatorios/page.tsx`):

1. **Criar a Página na Aplicação:**
   Crie a rota `src/app/relatorios/page.tsx` utilizando o hook `useTranslation()` em seus componentes para renderizar textos, títulos, botões e avisos.

2. **Adicionar as Novas Chaves em `en.json` (Canônico):**
   Abra `src/locales/messages/en.json` e adicione o bloco de tradução para a nova tela.

3. **Sincronizar os Outros Idiomas:**
   Rode no terminal:
   ```bash
   npm run i18n:sync
   ```
   Isso atualizará `pt.json` e `es.json` com as novas chaves para que você faça a tradução.

4. **Registrar a Rota no Manifesto de Controle:**
   Abra `src/locales/routes-manifest.json` e adicione o registro da nova tela:
   ```json
   {
     "route": "/relatorios",
     "file": "src/app/relatorios/page.tsx",
     "description": "Tela de relatórios e exportação de dados",
     "namespace": "relatorios"
   }
   ```

5. **Verificar a Aprovacão dos Scripts:**
   Execute no terminal:
   ```bash
   npm run i18n:check-routes
   npm run i18n:validate
   ```
   Se ambos passarem com sucesso (`✨ 100% das telas possuem cobertura`), sua nova tela está pronta e 100% integrada ao sistema de idiomas!

---

## 5. Como Adicionar um Novo Idioma (ex: Espanhol, Francês)

Para adicionar o suporte a um novo idioma (exemplo: **Francês - `fr`**):

1. Crie o arquivo `src/locales/messages/fr.json`.
2. Adicione os metadados `_meta`:
   ```json
   {
     "_meta": {
       "code": "fr",
       "name": "Français",
       "flag": "🇫🇷"
     }
   }
   ```
3. Execute `npm run i18n:sync` para popular todas as chaves existentes.
4. Traduza os textos e pronto! O novo idioma aparecerá **automaticamente** no menu de configurações em `http://localhost:3000/settings`.
