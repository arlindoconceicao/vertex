import { prisma } from "./src/lib/prisma";
import fs from "fs";
import path from "path";
const core = require("./lib/ssi_pq_core.node");

async function main() {
  const walletPath = path.join(__dirname, "lib", "mobile_wallet.db");
  const keysFilePath = path.join(__dirname, "lib", "keys.txt");
  
  // Excluir a wallet existente
  if (fs.existsSync(walletPath)) {
    fs.unlinkSync(walletPath);
    console.log("🗑️ Wallet antiga excluída (mobile_wallet.db)");
  }

  // Garantir que temos uma senha
  let walletPassword = "default_password_123";
  if (fs.existsSync(keysFilePath)) {
    walletPassword = fs.readFileSync(keysFilePath, "utf-8").trim();
  } else {
    fs.writeFileSync(keysFilePath, walletPassword);
  }

  // Criar uma nova wallet
  console.log("📦 Criando nova wallet...");
  core.walletCreate(walletPath, walletPassword, {
    createdAt: new Date().toISOString()
  });

  // Criar um ÚNICO DID dentro da wallet
  console.log("🔑 Gerando um novo DID único na wallet...");
  const newDidRecord = core.walletCreateDid(walletPath, walletPassword, {
    label: `Mobile DID (yugi386.2014@gmail.com)`,
    mldsa: "ML-DSA-65",
    mlkem: "ML-KEM-768",
    createdAt: new Date().toISOString(),
  });

  const targetDid = newDidRecord.did;
  const didDocument = core.walletGetDidDocument(walletPath, walletPassword, targetDid);

  console.log("✔ DID Único Gerado:", targetDid);

  // Extrair chaves
  const mlDsaKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-DSA-65") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-DSA-65" || k.type === "ML-DSA") : null;
  const mlKemKeyObj = didDocument.keys ? didDocument.keys.find((k: any) => k.type === "ML-KEM-768") :
                      didDocument.verificationMethod ? didDocument.verificationMethod.find((k: any) => k.type === "ML-KEM-768" || k.type === "ML-KEM") : null;

  // Atualizar o banco da plataforma (Prisma)
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
    console.log(`✅ Banco de dados atualizado. Usuário atrelado ao novo DID: ${targetDid}`);

    // Update pending credentials to belong to this new DID
    await prisma.verifiableCredential.updateMany({
      where: { status: "PENDING", issuerId: mainUser.id },
      data: {
        issuerId: mainUser.id
      }
    });
    console.log("✅ Credenciais pendentes atreladas ao novo DID.");
  } else {
    console.error("❌ Usuário yugi386.2014@gmail.com não encontrado!");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
