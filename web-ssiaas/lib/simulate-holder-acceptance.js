/**
 * Script de Simulação: Aceite do Holder
 *
 * Simula o Holder (titular) aceitando todas as credenciais que estão como OFFERED,
 * movendo-as para PENDING para que o aplicativo móvel do emissor possa assiná-las.
 */

require("dotenv").config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const connectionString = process.env.DATABASE_URL;
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=================================================");
  console.log("🚀 SIMULANDO ACEITE DO HOLDER");
  console.log("=================================================");

  const offeredCredentials = await prisma.verifiableCredential.findMany({
    where: { status: "OFFERED" },
    include: { holder: true, issuer: true }
  });

  if (offeredCredentials.length === 0) {
    console.log("ℹ️  Nenhuma credencial aguardando aceite (OFFERED).");
    process.exit(0);
  }

  console.log(`Encontradas ${offeredCredentials.length} credenciais OFFERED.`);

  for (const vc of offeredCredentials) {
    console.log(`\n📋 Aceitando credencial ID: ${vc.id}`);
    console.log(`   Emissor: ${vc.issuer.email}`);
    console.log(`   Holder:  ${vc.holder.email}`);
    
    // Atualiza para PENDING
    await prisma.verifiableCredential.update({
      where: { id: vc.id },
      data: { status: "PENDING" }
    });
    
    console.log(`✅ Status atualizado para PENDING (Aguardando assinatura mobile).`);
  }

  console.log("\n=================================================");
  console.log("✅ Fim da simulação. Agora você pode rodar 'node lib/get-pending-signatures.js'");
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
