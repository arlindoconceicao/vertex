#!/usr/bin/env bash
set -euo pipefail

echo "🚀 SUÍTE CREDDEF (Node) - VON local"
export WALLET_PASS="${WALLET_PASS:-minha_senha_teste}"
export WALLET_PATH="${WALLET_PATH:-teste-node/wallets/test_wallet_creddef_01.db}"

node teste-node/creddef/test_creddef_01_ledger_smoke.js
node teste-node/creddef/test_creddef_02_ledger_fetch_negative.js
node teste-node/creddef/test_creddef_03_idempotent_same_tag.js
node teste-node/creddef/test_creddef_04_id_format_seqno.js

echo "✅ SUÍTE CREDDEF completa."

