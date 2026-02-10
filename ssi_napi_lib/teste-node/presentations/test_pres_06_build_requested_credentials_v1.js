// teste-node/presentations/test_pres_06_build_requested_credentials_v1.js
const path = require("path");
const {
  assert,
  loadIndyAgent,
  fn,
  parseJsonSafe,
} = require("./_helpers");

(async () => {
  console.log("🚀 TESTE PRES 06: build_requested_credentials_v1 (spec -> requested_credentials_json)");

  const holderDb = path.resolve("teste-node/wallets/test_wallet_pres_holder.db");
  console.log("Config:", { holderDb });

  const IndyAgent = loadIndyAgent();
  const agent = new IndyAgent();

  try {
    const buildRequestedCredentialsV1 = fn(agent, "buildRequestedCredentialsV1", "build_requested_credentials_v1");

    // ✅ ESTE é o formato correto conforme seus structs:
    // RequestedCredsSpecV1 { selection: Vec<...>, self_attested: HashMap<...> }
    const spec = {
      selection: [
        {
          cred_id: "cred-FAKE-001",
          timestamp: 1770312882,
          attributes: [
            { referent: "attr1", revealed: true },
            { referent: "attr2", revealed: false },
          ],
          predicates: [
            { referent: "pred1" },
          ],
        },
        {
          cred_id: "cred-FAKE-002",
          // sem timestamp aqui (opcional)
          attributes: [
            { referent: "attr3", revealed: true },
          ],
          predicates: [
            { referent: "pred2" },
          ],
        },
      ],
      self_attested: {
        self1: "valor-self-attested",
      },
    };

    console.log('1) build_requested_credentials_v1(spec)...');
    const outStr = await buildRequestedCredentialsV1(JSON.stringify(spec));

    const out = parseJsonSafe(outStr, "requested_credentials_json");
    console.log("🧾 Output requested_credentials_json:");
    console.log(JSON.stringify(out, null, 2));

    // --- asserts fortes ---
    assert(out && typeof out === "object", "output inválido");
    assert(out.requested_attributes && typeof out.requested_attributes === "object", "requested_attributes ausente");
    assert(out.requested_predicates && typeof out.requested_predicates === "object", "requested_predicates ausente");
    assert(out.self_attested_attributes && typeof out.self_attested_attributes === "object", "self_attested_attributes ausente");

    assert(out.requested_attributes.attr1, "requested_attributes.attr1 ausente");
    assert(out.requested_attributes.attr2, "requested_attributes.attr2 ausente");
    assert(out.requested_attributes.attr3, "requested_attributes.attr3 ausente");

    assert(out.requested_attributes.attr1.cred_id === "cred-FAKE-001", "attr1 cred_id errado");
    assert(out.requested_attributes.attr2.cred_id === "cred-FAKE-001", "attr2 cred_id errado");
    assert(out.requested_attributes.attr3.cred_id === "cred-FAKE-002", "attr3 cred_id errado");

    assert(out.requested_attributes.attr1.revealed === true, "attr1 revealed esperado true");
    assert(out.requested_attributes.attr2.revealed === false, "attr2 revealed esperado false");
    assert(out.requested_attributes.attr3.revealed === true, "attr3 revealed esperado true");

    assert(out.requested_attributes.attr1.timestamp === 1770312882, "attr1 timestamp errado");
    assert(out.requested_attributes.attr2.timestamp === 1770312882, "attr2 timestamp errado");
    assert(out.requested_attributes.attr3.timestamp === undefined, "attr3 timestamp deveria ser undefined");

    assert(out.requested_predicates.pred1, "requested_predicates.pred1 ausente");
    assert(out.requested_predicates.pred2, "requested_predicates.pred2 ausente");

    assert(out.requested_predicates.pred1.cred_id === "cred-FAKE-001", "pred1 cred_id errado");
    assert(out.requested_predicates.pred2.cred_id === "cred-FAKE-002", "pred2 cred_id errado");

    assert(out.requested_predicates.pred1.timestamp === 1770312882, "pred1 timestamp errado");
    assert(out.requested_predicates.pred2.timestamp === undefined, "pred2 timestamp deveria ser undefined");

    assert(out.self_attested_attributes.self1 === "valor-self-attested", "self1 errado");

    console.log("✅ OK: TESTE PRES 06 passou.");
  } catch (e) {
    console.error("❌ FALHA TESTE PRES 06:", e);
    process.exitCode = 1;
  } finally {
    try { agent.walletClose && (await agent.walletClose()); } catch {}
  }
})();
