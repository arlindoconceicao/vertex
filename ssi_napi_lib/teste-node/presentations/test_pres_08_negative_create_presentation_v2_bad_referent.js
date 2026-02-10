const path = require("path");
const {
  assert,
  loadIndyAgent,
  fn,
  walletCreateOpenIdempotent,
} = require("./_helpers");

(async () => {
  console.log("🚀 TESTE PRES 08: negativo (create_presentation_v2 com referent inválido)");

  const holderDb = path.resolve("teste-node/wallets/test_wallet_pres_holder.db");
  const WALLET_PASS = process.env.WALLET_PASS || "minha_senha_teste";

  console.log("Config:", { holderDb });

  const IndyAgent = loadIndyAgent();
  const holder = new IndyAgent();

  try {
    await walletCreateOpenIdempotent(holder, holderDb, WALLET_PASS);

    const createPresentationV2 = fn(holder, "createPresentationV2", "create_presentation_v2");

    const presentationRequest = {
      nonce: String(Date.now()),
      name: "Negativo Referent",
      version: "1.0",
      requested_attributes: {
        attr1: { name: "cpf", restrictions: [{ cred_def_id: "DUMMY" }] },
      },
      requested_predicates: {},
    };

    // ❌ referent inválido: "attrX" não existe no request
    const selectionSpec = {
      selection: [
        {
          cred_id: "cred-qualquer",
          attributes: [{ referent: "attrX", revealed: true }],
          predicates: [],
        },
      ],
      self_attested: {},
    };

    console.log("1) create_presentation_v2 com referent inválido...");
    let failed = false;

    try {
      await createPresentationV2(
        JSON.stringify(presentationRequest),
        JSON.stringify(selectionSpec),
        JSON.stringify({}), // schemas
        JSON.stringify({})  // credDefs
      );
    } catch (e) {
      failed = true;
      const msg = String(e && e.message ? e.message : e);
      console.log("✅ OK: erro capturado:", msg);
      assert(
        msg.includes("não existe em presentationRequest.requested_attributes") ||
        msg.includes("requested_attributes") ||
        msg.includes("selection.attributes.referent"),
        "mensagem inesperada no erro"
      );
    }

    assert(failed, "create_presentation_v2 deveria falhar com referent inválido");
    console.log("✅ OK: TESTE PRES 08 passou.");
  } catch (e) {
    console.error("❌ FALHA TESTE PRES 08:", e);
    process.exitCode = 1;
  } finally {
    try { holder.walletClose && (await holder.walletClose()); } catch {}
  }
})();
