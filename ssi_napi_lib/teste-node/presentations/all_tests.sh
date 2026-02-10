#!/usr/bin/env bash
set -e

echo "🚀 SUÍTE PRESENTATIONS (Node) - VON local"

node teste-node/presentations/test_pres_01_e2e_create_verify.js
node teste-node/presentations/test_pres_02_negative_missing_cred.js
node teste-node/presentations/test_pres_03_negative_tamper_presentation.js
node teste-node/presentations/test_pres_04_negative_mismatch_request.js
node teste-node/presentations/test_pres_05_negative_missing_attribute.js
node teste-node/presentations/test_pres_08_negative_create_presentation_v2_bad_referent.js

# NOVO
node teste-node/presentations/test_pres_06_build_requested_credentials_v1.js
WALLET_PASS="minha_senha_teste" GENESIS_FILE=./genesis.txn node teste-node/presentations/teste_duas_credenciais_e_presentation.js 

echo "✅ SUÍTE PRESENTATIONS completa."
