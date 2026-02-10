#!/usr/bin/env bash
# teste-node/attrib/all_tests.sh
#
# Executar:
#   WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn ./teste-node/attrib/all_tests.sh
#
# Variáveis suportadas:
# - WALLET_PASS (default: minha_senha_teste)
# - GENESIS_FILE (default: ./genesis.txn)
# - TRUSTEE_SEED (opcional)
# - TRUSTEE_DID  (opcional)
#
# Observação:
# - O primeiro teste roda com RESET_WALLET=1 para começar limpo.
# - Os demais rodam com RESET_WALLET=1 também (cada teste usa um db diferente),
#   então fica totalmente determinístico e isolado.

set -euo pipefail

WALLET_PASS="${WALLET_PASS:-minha_senha_teste}"
GENESIS_FILE="${GENESIS_FILE:-./genesis.txn}"

export WALLET_PASS GENESIS_FILE
export TRUSTEE_SEED="${TRUSTEE_SEED:-000000000000000000000000Trustee1}"
export TRUSTEE_DID="${TRUSTEE_DID:-V4SGRU86Z58d6TV7PBUe6f}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ATTRIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "============================================================"
echo "🚀 SUÍTE ATTRIB: write / read / check"
echo "Root:   ${ROOT_DIR}"
echo "Attrib: ${ATTRIB_DIR}"
echo "Env:    GENESIS_FILE=${GENESIS_FILE} WALLET_PASS=***"
echo "============================================================"
echo

echo "🚀 TESTE ATTRIB 01: write"
RESET_WALLET=1 node "${ATTRIB_DIR}/test_attrib_01_write.js"
echo "✅ OK: TESTE ATTRIB 01 passou."
echo

echo "🚀 TESTE ATTRIB 02: read (write→read→assert)"
RESET_WALLET=1 node "${ATTRIB_DIR}/test_attrib_02_read.js"
echo "✅ OK: TESTE ATTRIB 02 passou."
echo

echo "🚀 TESTE ATTRIB 03: check exists (true/false)"
RESET_WALLET=1 node "${ATTRIB_DIR}/test_attrib_03_check.js"
echo "✅ OK: TESTE ATTRIB 03 passou."
echo

echo "============================================================"
echo "✅ RESULTADO: todos os testes ATTRIB passaram."
echo "============================================================"
