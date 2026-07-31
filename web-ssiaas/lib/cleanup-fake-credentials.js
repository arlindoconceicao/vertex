const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL || "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PREFIX = "T1000T";

async function main() {
  console.log(`🧹 Buscando credenciais de teste com o prefixo "${PREFIX}" para remoção...`);

  // Busca e remove credenciais que contenham o prefixo T1000T no pdfHash
  const result = await prisma.verifiableCredential.deleteMany({
    where: {
      pdfHash: {
        contains: PREFIX,
      },
    },
  });

  // Apaga também esquemas temporários criados para este teste
  await prisma.credentialSchema.deleteMany({
    where: {
      name: {
        startsWith: PREFIX,
      },
    },
  });

  console.log(`✅ Remoção concluída! ${result.count} credenciais de teste foram apagadas do banco.`);
}

main()
  .catch((e) => {
    console.error("❌ Erro ao apagar credenciais de teste:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
