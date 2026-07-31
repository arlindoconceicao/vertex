const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL || "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PREFIX = "T1000T";

async function main() {
  const countArg = parseInt(process.argv[2], 10) || 15;
  const emailArg = process.argv[3] || "teste@gmail.com";

  let user = await prisma.user.findUnique({ where: { email: emailArg } });
  if (!user) {
    user = await prisma.user.findFirst();
    if (!user) {
      console.error("❌ Nenhum usuário encontrado no banco.");
      process.exit(1);
    }
  }

  // Busca ou cria um esquema base para os testes
  let schema = await prisma.credentialSchema.findFirst({
    where: { name: { startsWith: PREFIX } }
  });

  if (!schema) {
    schema = await prisma.credentialSchema.create({
      data: {
        name: `${PREFIX} Esquema de Teste Dashboard`,
        description: "Esquema temporário para teste de busca e paginação de credenciais",
        version: "1.0",
        visibility: "PUBLIC",
        storageLocation: "LOCAL",
        jsonSchema: {
          title: "Credencial Fake",
          type: "object",
          fields: [{ name: "Nome", type: "string", required: true }]
        },
        creatorId: user.id
      }
    });
  }

  console.log(`🚀 Criando ${countArg} credenciais de teste (prefixo "${PREFIX}") para o usuário: ${user.email}...`);

  const statuses = ["ACTIVE", "PENDING", "REVOKED"];
  const sampleTitles = ["Identidade Digital", "Diploma de Bacharelado", "Certificado SSI", "Licença de Condução"];

  const createdCredentials = [];
  for (let i = 1; i <= countArg; i++) {
    const status = statuses[(i - 1) % statuses.length];
    const title = sampleTitles[(i - 1) % sampleTitles.length];
    const isIssued = i % 2 === 0;

    const vcPayload = {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", `${PREFIX}_${title.replace(/\s+/g, "")}`],
      issuer: user.did || "did:ssipq:fake_issuer",
      issuanceDate: new Date().toISOString(),
      credentialSchema: {
        id: schema.id,
        name: `${PREFIX} ${title} #${i}`,
        version: "1.0"
      },
      credentialSubject: {
        id: user.did || "did:ssipq:fake_holder",
        Nome: `${PREFIX} Titular Teste #${i}`
      }
    };

    const vc = await prisma.verifiableCredential.create({
      data: {
        vcPayload,
        status,
        issuerId: isIssued ? user.id : user.id, // Para testes locais, vinculamos o mesmo usuário ou parceiro
        holderId: user.id,
        pdfHash: `hash_${PREFIX}_${i}_${Date.now()}`
      }
    });

    createdCredentials.push(vc);
  }

  console.log(`✅ ${createdCredentials.length} credenciais de teste criadas com sucesso!`);
  console.log(`🧹 Para remover estas credenciais a qualquer momento, execute: node lib/cleanup-fake-credentials.js`);
}

main()
  .catch((e) => {
    console.error("❌ Erro ao criar credenciais de teste:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
