# para rodar use:
# WALLET_PASS="minha_senha_teste" RESET_WALLET=1 bash teste-node/test_wallet/all_tests.sh

#!/usr/bin/env bash
set -euo pipefail

echo "🧪 SUÍTE WALLET: iniciando..."
echo "Config env:"
echo "  WALLET_PASS=${WALLET_PASS:-minha_senha_teste}"
echo "  RESET_WALLET=${RESET_WALLET:-0}"
echo

node teste-node/test_wallet/test_wallet_01_create_open_close.js
node teste-node/test_wallet/test_wallet_02_create_existing_must_fail.js
node teste-node/test_wallet/test_wallet_03_open_wrong_pass_must_fail.js
node teste-node/test_wallet/test_wallet_04_open_missing_db_must_fail.js
node teste-node/test_wallet/test_wallet_05_open_missing_sidecar_must_fail.js
node teste-node/test_wallet/test_wallet_06_backup_create_and_recover_ok.js
node teste-node/test_wallet/test_wallet_07_backup_wrong_pass_must_fail.js
node teste-node/test_wallet/test_wallet_08_backup_format_errors_must_fail.js
node teste-node/test_wallet/test_wallet_09_change_pass_ok.js
node teste-node/test_wallet/test_wallet_10_change_pass_wrong_old_must_fail.js
node teste-node/test_wallet/test_wallet_11_verify_pass.js

echo "✅ SUÍTE WALLET: tudo OK."

