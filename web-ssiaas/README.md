# Vertex Web SSIaaS

# Vertex Web SSIaaS

O Vertex Web SSIaaS é uma plataforma de Identidade como Serviço (Identity-as-a-Service) de código aberto, projetada para simplificar a criação, emissão e gestão de Identidades Auto-Soberanas (SSI) e Credenciais Verificáveis (VCs).

O sistema abstrai as complexidades subjacentes de assinaturas criptográficas e redes descentralizadas. Ele permite que os emissores (Issuers) foquem no design e na distribuição de credenciais por meio de uma interface intuitiva (No-Code), enquanto embute VCs criptográficas diretamente em arquivos PDF padrão. Essa abordagem híbrida permite a verificação offline e utiliza OIDC (Google) para uma autenticação segura de usuários.

Desenvolvida como pesquisa de Iniciação Científica financiada pela **FAPESP**, na **UNIFESP**.

---

## Stack Tecnológica

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Banco de Dados:** PostgreSQL 16 (via Docker)
- **ORM:** Prisma 7
- **Autenticação:** Auth.js v5 (Google OIDC)
- **Estilização:** Tailwind CSS

---

## Pré-requisitos

Antes de rodar o projeto, você precisa ter instalado:

- [Node.js](https://nodejs.org/) (versão 18 ou superior)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Uma conta no [Google Cloud Console](https://console.cloud.google.com/) para gerar as credenciais OAuth

---

## Como rodar localmente

### 1. Clone o repositório

```bash
git clone [https://github.com/](https://github.com/)[arlindoconceicao]/[vertex].git

cd [arlindoconceicao]/vertex/web-ssiaas
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Copie o arquivo de exemplo e preencha com seus valores:

```bash
cp .env.example .env
```

Edite o `.env`:

```env
DATABASE_URL="postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db"
AUTH_SECRET="gere com: openssl rand -base64 32"
AUTH_GOOGLE_ID="seu_google_client_id"
AUTH_GOOGLE_SECRET="seu_google_client_secret"
NEXTAUTH_URL="http://localhost:3000"
```

#### Como gerar as credenciais Google OAuth:
1. Acesse o [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um projeto novo
3. Vá em **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
4. Tipo: **Web Application**
5. Em **Authorized redirect URIs**, adicione: `http://localhost:3000/api/auth/callback/google`
6. Copie o **Client ID** e **Client Secret** para o `.env`


### 4. Suba a Infraestrutura (PostgreSQL)
O projeto utiliza Docker Compose para orquestrar o banco de dados de forma isolada.
Abra o **Docker Desktop** e aguarde inicializar. Depois rode:


```bash
docker compose up -d
```

> **Nas próximas vezes**, basta abrir o Docker Desktop e rodar `docker start vertex_postgres`.

### 5. Rode as migrações do banco

```bash
npx prisma migrate deploy
```

### 6. Gere o Prisma Client

```bash
npx prisma generate
```

### 7. Inicie o servidor de desenvolvimento

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

---

## Estrutura do Projeto
src/
├── app/
│   ├── actions/          # Server Actions (lógica de negócio)
│   ├── api/auth/         # Rota do Auth.js
│   ├── complete-registration/
│   ├── credentials/
│   ├── dashboard/
│   ├── login/
│   └── schemas/
├── components/           # Componentes React reutilizáveis
├── lib/
│   └── prisma.ts         # Singleton do Prisma Client
├── types/
│   └── next-auth.d.ts    # Extensão de tipos do Auth.js
└── auth.ts               # Configuração central do Auth.js
prisma/
├── schema.prisma         # Modelagem do banco de dados
└── migrations/           # Histórico de migrações

---

## Fluxo de Autenticação (Sprint 0)
Usuário → /login → Google OIDC → Callback → Verifica CPF?
├── Não → /complete-registration → Salva CPF → /dashboard
└── Sim → /dashboard

---

## Papéis SSI Implementados

| Papel | Descrição |
|---|---|
| **Issuer** | Cria schemas e emite credenciais para outros usuários |
| **Holder** | Recebe e armazena credenciais emitidas por Issuers |
| **Verifier** | (Sprint futura) Valida a autenticidade de uma credencial |

---

## Licença

Projeto acadêmico — UNIFESP · FAPESP.