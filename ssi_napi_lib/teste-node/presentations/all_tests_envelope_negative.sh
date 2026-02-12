# PARA RODAR ESTE TESTE
# TRUSTEE_SEED="000000000000000000000000Trustee1" TRUSTEE_DID="V4SGRU86Z58d6TV7PBUe6f" WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn ./teste-node/presentations/all_tests_envelope_negative.sh

#!/usr/bin/env bash
set -euo pipefail

# Executa a suíte negativa de envelopes. Usa as mesmas env vars dos testes.
# Exemplo:
# TRUSTEE_SEED="000..." TRUSTEE_DID="V4S..." WALLET_PASS="minha_senha_teste" \
# GENESIS_FILE=./genesis.txn ./teste-node/presentations/all_tests_envelope_negative.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tests=(
  "test_env_neg_01_expired.js"
  "test_env_neg_02_recipient_mismatch.js"
  "test_env_neg_03_invalid_mode.js"
  "test_env_neg_04_empty_kind_thread.js"
  "test_env_neg_05_tampered_payload.js"
  "test_env_neg_06_missing_sender_verkey.js"
)

echo "🚀 SUÍTE ENVELOPES NEGATIVA"
echo "Dir: ${ROOT_DIR}"
echo

for t in "${tests[@]}"; do
  echo "=============================================="
  echo "▶ Rodando: ${t}"
  node "${ROOT_DIR}/${t}"
  echo "✅ OK: ${t}"
  echo
done

echo "🎉 SUÍTE COMPLETA: todos os testes passaram."

