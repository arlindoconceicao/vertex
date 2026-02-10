#!/usr/bin/env bash
set -euo pipefail

echo "🚀 SUÍTE CREDENTIALS (Node) - VON local"
export WALLET_PASS="${WALLET_PASS:-minha_senha_teste}"

export WALLET_ISSUER="${WALLET_ISSUER:-teste-node/wallets/test_wallet_cred_issuer.db}"
export WALLET_HOLDER="${WALLET_HOLDER:-teste-node/wallets/test_wallet_cred_holder.db}"

node teste-node/credentials/test_cred_03_offers_crud.js
node teste-node/credentials/test_cred_04_link_secret_idempotent.js
node teste-node/credentials/test_cred_01_issue_store_e2e.js
node teste-node/credentials/test_cred_02_store_negative_missing_metadata.js
node teste-node/credentials/test_cred_05_offers_range.js

echo "✅ SUÍTE CREDENTIALS completa."
