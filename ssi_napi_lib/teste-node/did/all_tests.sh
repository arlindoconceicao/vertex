#!/usr/bin/env bash
set -euo pipefail

RESET_WALLET=1 node ./teste-node/did/teste_did_01_local_basics.js
RESET_WALLET=1 node ./teste-node/did/teste_did_02_search_filters.js
RESET_WALLET=1 node ./teste-node/did/teste_did_03_export_import_batch.js
RESET_WALLET=1 node ./teste-node/did/teste_did_04_import_seed_v2.js
RESET_WALLET=1 node ./teste-node/did/teste_did_05_list_dids_legacy.js
RESET_WALLET=1 node ./teste-node/did/teste_did_06_resolve_v2_retry.js
RESET_WALLET=1 node ./teste-node/did/teste_did_07_register_updates_local_record.js
RESET_WALLET=1 node ./teste-node/did/teste_did_08_primary_did.js
