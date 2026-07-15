const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const nodeCore = require('../npm/ssi_pq_core.node');
const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

async function createWasmCore(options = {}) {
  const { createNodeCompatibleCore } = await import('../packages/web/ssi-pq-node-compatible.mjs');

  if (!options.wallet) {
    return createNodeCompatibleCore(wasm);
  }

  const { createMemorySnapshotStore, createPersistentWebWallet } = await import(
    '../packages/web/ssi-pq-indexeddb-wallet.mjs'
  );
  const snapshotStore = createMemorySnapshotStore();
  const walletStore = createPersistentWebWallet(wasm, snapshotStore);

  wasm.webWalletClearMemory();
  return createNodeCompatibleCore(wasm, { walletStore });
}

function toBuffer(value) {
  return Buffer.from(value);
}

function newRunId() {
  return crypto.randomUUID();
}

function tempWalletPath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ssi-pq-${prefix}-`));
  return path.join(dir, 'wallet.db');
}

function dummyPdfBase() {
  return Buffer.from(
    '%PDF-1.4\n%ABCD\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
      'xref\n0 4\n' +
      '0000000000 65535 f \n' +
      '0000000015 00000 n \n' +
      '0000000064 00000 n \n' +
      '0000000121 00000 n \n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
      'startxref\n192\n' +
      '%%EOF\n'
  );
}

function credentialDisclosurePairs(signedCredential) {
  return signedCredential.attribute_disclosures.map((disclosure) => [
    disclosure.path,
    disclosure.value
  ]);
}

function assertPdfHeader(assert, pdfBytes) {
  assert.equal(toBuffer(pdfBytes).subarray(0, 5).toString('latin1'), '%PDF-');
}

module.exports = {
  assertPdfHeader,
  createWasmCore,
  credentialDisclosurePairs,
  dummyPdfBase,
  newRunId,
  nodeCore,
  tempWalletPath,
  toBuffer,
  wasm
};
