# Scripts Utilitários (Testes & Simulações)

Esta pasta contém scripts criados para interagir localmente com as APIs da plataforma Vertex SSIaaS, ideais para testar integrações mobile, testar provas criptográficas e disparar rotinas de manutenção manualmente.

## Pré-requisitos
Certifique-se de que o servidor Next.js está rodando localmente (normalmente em `http://localhost:3000`) e que o arquivo `.env` na raiz do projeto está devidamente configurado com as chaves corretas.

> [!WARNING]
> **Ambiente de Produção**: Esta pasta (`lib/`) possui diversos scripts de automação que acessam o banco de dados diretamente via Prisma. **Em um ambiente de produção real, todos estes scripts `.js` e `.ts` devem ser removidos.** A pasta `lib/` em produção deve conter estritamente a biblioteca nativa compilada `ssi_pq_core.node`.

Para usar os scripts, certifique-se de instalar qualquer dependência (se necessário) e executá-los via Node.js:
```bash
node nome-do-script.js
```

## Scripts Disponíveis

### `trigger-cron.js`
Este script aciona manualmente o endpoint Cron Job `/api/cron/cleanup-pdfs`. Ele serve para varrer a base de dados e excluir o binário do PDF das credenciais cujo prazo de retenção (`pdfRetentionDays`) expirou.
- **Autorização**: Lê e utiliza a variável `CRON_SECRET` do arquivo `.env` para aprovar o disparo.
- **Quando usar**: Sempre que desejar forçar a rotina de exclusão de PDFs retidos, útil para não ter que aguardar a hora agendada no `vercel.json` ou no Crontab.

### Outros scripts
*(Demais scripts para simulação mobile, DIDs e upload/download de PDFs...)*
