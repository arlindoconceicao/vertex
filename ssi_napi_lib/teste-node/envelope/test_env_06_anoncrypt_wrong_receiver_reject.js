// PARA RODAR USE:
// WALLET_PASS="minha_senha_teste" node teste-node/envelope/test_env_06_anoncrypt_wrong_receiver_reject.js

/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const { IndyAgent } = require(path.join(__dirname, "..", "..", "index.node"));

function rmIfExists(walletDbPath) {
  const sidecar = `${walletDbPath}.kdf.json`;
  try { fs.unlinkSync(walletDbPath); } catch (_) {}
  try { fs.unlinkSync(sidecar); } catch (_) {}
  try { fs.unlinkSync(`${sidecar}.tmp`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${walletDbPath}-wal`); } catch (_) {}
}

(async () => {
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";
  const walletsDir = path.join(__dirname, "..", "wallets");
  fs.mkdirSync(walletsDir, { recursive: true });

  const walletPath = path.join(walletsDir, "env_test_06_anoncrypt_wrong_receiver.db");
  rmIfExists(walletPath);

  const agent = new IndyAgent();

  try {
    console.log("1) Criando wallet...");
    await agent.walletCreate(walletPath, WALLET_PASS);

    console.log("2) Abrindo wallet...");
    await agent.walletOpen(walletPath, WALLET_PASS);

    console.log("3) Criando DID receiver correto (R1)...");
    const [didR1, verkeyR1] = await agent.createOwnDid();

    console.log("4) Criando DID receiver incorreto (R2)...");
    const [didR2] = await agent.createOwnDid();

    console.log("5) Criando Envelope anoncrypt para R1...");
    const plaintext = JSON.stringify({ msg: "anoncrypt-wrong-receiver", ts: Date.now() });
    const threadId = `th_env06_${Date.now()}`;

    const envJson = agent.envelopePackAnoncrypt(
      verkeyR1,
      "test/env06/anoncrypt_wrong_receiver",
      threadId,
      plaintext,
      null,
      JSON.stringify({ test: 6 })
    );

    console.log("6) Tentando unpack com R2 (deve falhar)...");
    let ok = false;
    try {
      await agent.envelopeUnpackAuto(didR2, envJson);
      ok = true; // não deveria chegar aqui
    } catch (e) {
      const msg = e?.message || String(e);
      // Aceita qualquer erro esperado:
      // - recipient_verkey mismatch (ideal)
      // - chave privada não encontrada (dependendo do caminho)
      if (
        /recipient_verkey/i.test(msg) ||
        /não corresponde/i.test(msg) ||
        /Chave Privada/i.test(msg) ||
        /not found/i.test(msg)
      ) {
        console.log("✅ Rejeição OK:", msg);
      } else {
        throw new Error(`Falha inesperada: ${msg}`);
      }
    }

    if (ok) throw new Error("❌ Unpack com receiver errado NÃO foi rejeitado.");

    console.log("✅ test_env_06_anoncrypt_wrong_receiver_reject OK");
  } finally {
    try { await agent.walletClose(); } catch (_) {}
  }
})().catch((e) => {
  console.error("❌ test_env_06_anoncrypt_wrong_receiver_reject FAIL:", e?.message || e);
  console.error(e?.stack || "");
  process.exit(1);
});
