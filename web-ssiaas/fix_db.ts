import { prisma } from "./src/lib/prisma";
import fs from "fs";
import path from "path";
const core = require("./lib/ssi_pq_core.node");

async function main() {
  const walletPath = path.join(__dirname, "lib", "mobile_wallet.db");
  const keysFilePath = path.join(__dirname, "lib", "keys.txt");
  const walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();

  // Obter o DID da wallet
  core.walletOpen(walletPath, walletPassword);
  const dids = core.walletListDids(walletPath, walletPassword);
  const targetDid = dids[dids.length - 1].did;
  const didDocument = core.walletGetDidDocument(walletPath, walletPassword, targetDid);
  
  const mlDsaKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-DSA-65") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-DSA-65" || k.type === "ML-DSA") : null;
  const mlKemKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-KEM-768") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-KEM-768" || k.type === "ML-KEM") : null;

  // 1. Excluir a credencial problemática
  try {
    await prisma.verifiableCredential.delete({
      where: { id: "cms61hlcq0005xmxkbmok4hyz" }
    });
    console.log("Credencial cms61hlcq0005xmxkbmok4hyz excluída com sucesso.");
  } catch (err) {
    console.log("Credencial já estava excluída ou erro:", (err as Error).message);
  }

  // 2. Excluir usuários de teste que foram criados pelos scripts de injeção
  await prisma.user.deleteMany({
    where: { email: { startsWith: "test-" } }
  });
  console.log("Usuários de teste (test-*) excluídos.");

  // 3. Atualizar o usuário real (yugi386) com os dados da wallet simulada
  const mainUser = await prisma.user.findFirst({
    where: { email: "yugi386.2014@gmail.com" }
  });

  if (mainUser) {
    await prisma.user.update({
      where: { id: mainUser.id },
      data: {
        did: targetDid,
        didDocument: didDocument,
        didPublicKey: mlDsaKeyObj ? (mlDsaKeyObj.public_key_multibase || mlDsaKeyObj.publicKeyMultibase) : null,
        didMlkemKey: mlKemKeyObj ? (mlKemKeyObj.public_key_multibase || mlKemKeyObj.publicKeyMultibase) : null,
      }
    });
    console.log(`Usuário ${mainUser.email} atualizado para o DID da wallet simulada: ${targetDid}`);
  } else {
    console.log("Usuário yugi386.2014@gmail.com não encontrado!");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
