const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL || "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: node lib/reset-download-status.js <credential_id ou email_do_emissor>");
    process.exit(1);
  }

  try {
    let updated;
    if (arg.includes("@")) {
      // É um email, acha as credenciais do emissor e reseta todas
      const user = await prisma.user.findUnique({ where: { email: arg } });
      if (!user) {
        console.error("Usuário não encontrado.");
        return;
      }
      updated = await prisma.verifiableCredential.updateMany({
        where: { issuerId: user.id },
        data: { pdfDownloadedAt: null }
      });
      console.log(`✅ ${updated.count} credencial(is) emitidas pelo usuário ${arg} foram marcadas como NÃO BAIXADAS.`);
    } else {
      // É um ID de credencial
      updated = await prisma.verifiableCredential.update({
        where: { id: arg },
        data: { pdfDownloadedAt: null }
      });
      console.log(`✅ Credencial ${arg} marcada como NÃO BAIXADA.`);
    }
  } catch (e) {
    console.error("❌ Erro ao resetar status de download:", e.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
