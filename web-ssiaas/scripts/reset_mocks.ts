import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const result = await prisma.credentialSchema.updateMany({
    data: {
      ipfsCid: null,
      publishedAt: null,
      storageLocation: "LOCAL",
      pinataFileId: null,
    },
  });
  console.log(`Reset ${result.count} schemas.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
