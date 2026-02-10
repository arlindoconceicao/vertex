const path = require("path");

function envBool(name, def = false) {
  const v = process.env[name];
  if (v === undefined) return def;
  return v === "1" || v.toLowerCase() === "true";
}

module.exports = {
  RUN_SUITE: envBool("RUN_SUITE", true),
  RESET_WALLET: envBool("RESET_WALLET", false),
  TEST_LEDGER: envBool("TEST_LEDGER", false),

  WALLET_PASS: process.env.WALLET_PASS || "minha_senha_teste",

  // Ajuste conforme seu padrão atual
  GENESIS_FILE: process.env.GENESIS_FILE || "./genesis.txn",

  // Paths locais para testes
  WALLET_PATH: process.env.WALLET_PATH || "./wallets/test_wallet.db",

  // Onde está seu binding (pelo seu comentário no lib.rs, normalmente é ./index.node)
  BINDING_PATH: process.env.BINDING_PATH || path.resolve(process.cwd(), "index.node"),

  WALLET_PATH_A: process.env.WALLET_PATH_A || "./wallets/test_wallet_A.db",
  WALLET_PATH_B: process.env.WALLET_PATH_B || "./wallets/test_wallet_B.db",
};
