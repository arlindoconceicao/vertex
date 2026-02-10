#!/usr/bin/env bash
set -euo pipefail

echo "🚀 SUÍTE SCHEMAS (Node) - VON local"

# ✅ Senha padrão para TODOS os testes
export WALLET_PASS="${WALLET_PASS:-minha_senha_teste}"

# ✅ Wallets dedicadas (evita efeitos colaterais)
export WALLET_PATH_LOCAL="${WALLET_PATH_LOCAL:-teste-node/wallets/test_wallet_schema_local.db}"
export WALLET_PATH_LEDGER="${WALLET_PATH_LEDGER:-teste-node/wallets/test_wallet_schema_ledger.db}"

# Teste 01 (local)
echo "🧪 SCHEMA 01 (local basics)"
WALLET_PATH="$WALLET_PATH_LOCAL" node teste-node/schemas/test_schema_01_local_basics.js
echo "✅ PASSOU SCHEMA 01"

# Teste 04 (local filters)
echo "🧪 SCHEMA 04 (local filters)"
WALLET_PATH="$WALLET_PATH_LOCAL" node teste-node/schemas/test_schema_04_local_filters.js
echo "✅ PASSOU SCHEMA 04"

# Teste 02 (ledger)
echo "🧪 SCHEMA 02 (ledger smoke)"
WALLET_PATH="$WALLET_PATH_LEDGER" node teste-node/schemas/test_schema_02_ledger_smoke.js
echo "✅ PASSOU SCHEMA 02"

# Teste 03 (ledger negative)
echo "🧪 SCHEMA 03 (ledger fetch negative)"
WALLET_PATH="$WALLET_PATH_LEDGER" node teste-node/schemas/test_schema_03_ledger_fetch_negative.js
echo "✅ PASSOU SCHEMA 03"

echo "✅ SUÍTE SCHEMAS completa."

