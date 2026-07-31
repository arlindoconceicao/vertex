const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL || "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PREFIX = "T1000T";

async function main() {
  console.log(`🧹 Buscando esquemas de teste com o prefixo "${PREFIX}" para remoção...`);

  // Busca todos os esquemas que começam com o prefixo T1000T
  const fakeSchemas = await prisma.credentialSchema.findMany({
    where: {
      name: {
        startsWith: PREFIX,
      },
    },
    select: { id: true, name: true },
  });

  if (fakeSchemas.length === 0) {
    console.log(`ℹ️ Nenhum esquema de teste com o prefixo "${PREFIX}" foi encontrado no banco de dados.`);
    return;
  }

  const result = await prisma.credentialSchema.deleteMany({
    where: {
      name: {
        startsWith: PREFIX,
      },
    },
  });

  console.log(`✅ Remoção concluída! ${result.count} esquemas de teste (prefixo "${PREFIX}") foram apagados do banco.`);
}

main()
  .catch((e) => {
    console.error("❌ Erro ao apagar esquemas de teste:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
