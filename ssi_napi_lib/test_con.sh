#!/usr/bin/env bash
set -euo pipefail

WALLET_PATH="./wallets/test_wallet.db"
WALLET_PASS="SUA_SENHA_REAL"   # <-- coloque a senha REAL aqui

echo "== wrong pass =="
WALLET_PATH="$WALLET_PATH" WALLET_PASS="$WALLET_PASS" TEST_WRONG_PASS=1 \
  node teste_test_connection.js

echo "== missing sidecar =="
WALLET_PATH="$WALLET_PATH" WALLET_PASS="$WALLET_PASS" TEST_MISSING_SIDECAR=1 \
  node teste_test_connection.js

echo "== invalid genesis =="
WALLET_PATH="$WALLET_PATH" WALLET_PASS="$WALLET_PASS" TEST_INVALID_GENESIS=1 \
  node teste_test_connection.js

