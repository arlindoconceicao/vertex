/**
 * Script de Limpeza / Reset de DID para Testes
 *
 * Remove o DID, DID Document, chaves públicas (ML-DSA e ML-KEM) e timestamp de pareamento
 * do usuário especificado pelo e-mail, além de apagar os desafios de pareamento anteriores.
 * Isso permite repetições ilimitadas de teste com a mesma conta.
 *
 * Uso:
 *   node lib/reset-did.js <email_do_usuario>
 *
 * Exemplo:
 *   node lib/reset-did.js teste@gmail.com
 */

require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const targetEmail = process.argv[2];

  if (!targetEmail) {
    console.log("\n[AVISO] Nenhum e-mail especificado no argumento.");
    console.log("Uso: node lib/reset-did.js <email_do_usuario>\n");

    const firstUser = await prisma.user.findFirst({
      select: { email: true, name: true, did: true },
    });

    if (firstUser) {
      console.log(`Usuário encontrado no banco: ${firstUser.email} (DID: ${firstUser.did || "Nenhum"})`);
      console.log(`Exemplo de execução:\n  node lib/reset-did.js ${firstUser.email}\n`);
    }

    await prisma.$disconnect();
    process.exit(1);
  }

  console.log("=================================================");
  console.log(`🔄 RESETANDO DADOS DE DID E CHAVES DO USUÁRIO: ${targetEmail}`);
  console.log("=================================================");

  try {
    const user = await prisma.user.findUnique({
      where: { email: targetEmail },
    });

    if (!user) {
      console.error(`❌ Usuário com e-mail '${targetEmail}' não foi encontrado no banco de dados.`);
      await prisma.$disconnect();
      process.exit(1);
    }

    await prisma.$transaction(async (tx) => {
      const deletedChallenges = await tx.didPairingChallenge.deleteMany({
        where: { userId: user.id },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          did: null,
          didPublicKey: null,
          didMlkemKey: null,
          didDocument: null,
          didPairedAt: null,
        },
      });

      console.log(`✔ ${deletedChallenges.count} desafio(s) de pareamento removido(s).`);
      console.log(`✔ DID, DID Document, chave ML-DSA e chave ML-KEM limpos para o usuário ${user.email} (ID: ${user.id}).`);
    });

    console.log("=================================================");
    console.log("✅ RESET CONCLUÍDO COM SUCESSO!");
    console.log("👉 Agora você pode recarregar a página web ou iniciar um novo pareamento!");
    console.log("=================================================");
  } catch (error) {
    console.error("❌ Erro ao resetar dados do usuário:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
