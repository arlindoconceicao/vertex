const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
require("dotenv").config();

const connectionString = process.env.DATABASE_URL || "postgresql://vertex_user:vertex_pass@localhost:5432/vertex_db";
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const PREFIX = "T1000T";

async function main() {
  const countArg = parseInt(process.argv[2], 10) || 20;
  const emailArg = process.argv[3];

  let creator;
  if (emailArg) {
    creator = await prisma.user.findUnique({ where: { email: emailArg } });
    if (!creator) {
      console.error(`❌ Usuário com o e-mail "${emailArg}" não foi encontrado.`);
      process.exit(1);
    }
  } else {
    creator = await prisma.user.findFirst();
    if (!creator) {
      console.error("❌ Nenhum usuário cadastrado no banco de dados.");
      process.exit(1);
    }
  }

  console.log(`🚀 Criando ${countArg} esquemas de teste (prefixo "${PREFIX}") para o usuário: ${creator.email}...`);

  const sampleTypes = ["Diploma de Graduação", "Certificado de Curso", "Identidade Estudantil", "Licença Profissional", "Acreditação SSI"];

  const createdSchemas = [];
  for (let i = 1; i <= countArg; i++) {
    const randomTitle = sampleTypes[(i - 1) % sampleTypes.length];
    const visibility = i % 2 === 0 ? "PUBLIC" : "PRIVATE";
    const name = `${PREFIX} ${randomTitle} #${i}`;

    const jsonSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: name,
      type: "object",
      fields: [
        { name: "Nome Completo", type: "string", required: true },
        { name: "Código de Registro", type: "string", required: true },
        { name: "Data de Emissão", type: "date", required: false },
        { name: "Ativo", type: "boolean", required: false }
      ]
    };

    const schema = await prisma.credentialSchema.create({
      data: {
        name,
        description: `Esquema de teste automatizado #${i} para validação de paginação e filtros.`,
        version: "1.0",
        visibility,
        storageLocation: "LOCAL",
        jsonSchema,
        creatorId: creator.id,
      }
    });

    createdSchemas.push(schema);
  }

  console.log(`✅ ${createdSchemas.length} esquemas de teste criados com sucesso!`);
  console.log(`💡 Exemplo de ID criado: ${createdSchemas[0].id}`);
  console.log(`🧹 Para remover estes esquemas a qualquer momento, execute: node lib/cleanup-fake-schemas.js`);
}

main()
  .catch((e) => {
    console.error("❌ Erro ao criar esquemas de teste:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
