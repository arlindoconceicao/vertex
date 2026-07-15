/**
 * Este teste congela a superficie da facade Node-compatible: ela deve expor
 * todos os nomes do addon Node que fazem sentido no browser. A excecao
 * documentada e canonicalJsonFile, porque depende de path local.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const nodeCore = require('../npm/ssi_pq_core.node');
const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

test('WASM Node-compatible facade exposes Node API names where browser-compatible', async () => {
  const { createMemorySnapshotStore, createPersistentWebWallet } = await import(
    '../packages/web/ssi-pq-indexeddb-wallet.mjs'
  );
  const { createNodeCompatibleCore } = await import(
    '../packages/web/ssi-pq-node-compatible.mjs'
  );
  const walletStore = createPersistentWebWallet(wasm, createMemorySnapshotStore());
  const facade = createNodeCompatibleCore(wasm, { walletStore });
  const unsupportedInBrowser = ['canonicalJsonFile'];
  const nodeExports = Object.keys(nodeCore).sort();
  const missing = nodeExports.filter(
    (name) => !unsupportedInBrowser.includes(name) && typeof facade[name] !== 'function'
  );

  assert.deepEqual(missing, []);
  assert.equal(typeof facade.canonicalJsonFile, 'undefined');
});
