#!/usr/bin/env bash
# teste-node/message/all_tests.sh
#
# Executar:
#   WALLET_PASS="minha_senha_teste" ./teste-node/message/all_tests.sh
#
# Variáveis suportadas:
# - WALLET_PASS (default: minha_senha_teste)
#
# Observação:
# - Cada teste usa wallets diferentes (msg_sender_01/02/03, msg_receiver_01/02/03),
#   então rodamos sempre com RESET_WALLET=1 para garantir isolamento e reprodutibilidade.

set -euo pipefail

WALLET_PASS="${WALLET_PASS:-minha_senha_teste}"
export WALLET_PASS

MSG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "🚀 SUÍTE MESSAGE: encrypt/decrypt + tamper + file roundtrip (offline)"
echo "Dir: ${MSG_DIR}"
echo "Env: WALLET_PASS=***"
echo "============================================================"
echo

echo "🚀 TESTE MESSAGE 01: encrypt→decrypt (happy path)"
RESET_WALLET=1 node "${MSG_DIR}/test_message_01_encrypt_decrypt.js"
echo "✅ OK: TESTE MESSAGE 01 passou."
echo

echo "🚀 TESTE MESSAGE 02: tamper (ciphertext/nonce/sender_verkey)"
RESET_WALLET=1 node "${MSG_DIR}/test_message_02_tamper.js"
echo "✅ OK: TESTE MESSAGE 02 passou."
echo

echo "🚀 TESTE MESSAGE 03: file roundtrip (encrypt→save→load→decrypt)"
RESET_WALLET=1 node "${MSG_DIR}/test_message_03_file_roundtrip.js"
echo "✅ OK: TESTE MESSAGE 03 passou."
echo

echo "============================================================"
echo "✅ RESULTADO: todos os testes MESSAGE passaram."
echo "============================================================"
