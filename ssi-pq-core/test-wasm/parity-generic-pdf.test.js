/**
 * Paridade Node x WASM: assinatura generica de PDF.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertPdfHeader,
  createWasmCore,
  dummyPdfBase,
  newRunId,
  nodeCore,
  tempWalletPath,
  toBuffer
} = require('./parity-helpers.js');

test('generic PDF signing has equivalent wallet behavior in Node and WASM', async () => {
  const wasmCore = await createWasmCore({ wallet: true });
  const nodeResult = await runGenericPdfFlow(nodeCore, tempWalletPath('node-generic-pdf'));
  const wasmResult = await runGenericPdfFlow(wasmCore, `wasm-generic-pdf-${newRunId()}`);

  assert.equal(nodeResult.manifest.type, wasmResult.manifest.type);
  assert.equal(nodeResult.manifest.created_at, wasmResult.manifest.created_at);
  assert.equal(nodeResult.manifest.pdf_base_length, wasmResult.manifest.pdf_base_length);
  assert.equal(nodeResult.manifest.signature.alg, wasmResult.manifest.signature.alg);
  assert.equal(nodeResult.manifest.signature.key_id, wasmResult.manifest.signature.key_id);
  assert.equal(nodeResult.verification.valid, true);
  assert.equal(wasmResult.verification.valid, true);
  assert.equal(nodeResult.verification.status, wasmResult.verification.status);
  assert.equal(nodeResult.verification.pdf_base_hash_valid, wasmResult.verification.pdf_base_hash_valid);
  assert.equal(nodeResult.verification.signature_valid, wasmResult.verification.signature_valid);
  assert.equal(
    nodeResult.verification.manifest_is_final_revision,
    wasmResult.verification.manifest_is_final_revision
  );
});

async function runGenericPdfFlow(core, walletId) {
  const password = 'senha-generic-pdf-parity-123';
  const createdAt = '2026-05-28T00:00:00Z';
  const basePdf = dummyPdfBase();

  await core.walletCreate(walletId, password, { createdAt });
  const did = await core.walletCreateDid(walletId, password, {
    label: 'Generic PDF Parity',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const didDocument = await core.walletGetDidDocument(walletId, password, did.did);
  const finalPdf = await core.walletSignGenericPdf(walletId, password, did.did, basePdf, {
    createdAt
  });
  const manifest = core.extractGenericSignatureManifestFromPdf(finalPdf);
  const verification = core.verifySignedGenericPdf(finalPdf, didDocument);

  assertPdfHeader(assert, finalPdf);
  assert.deepEqual(toBuffer(finalPdf).subarray(0, basePdf.length), basePdf);
  assert.equal(manifest.signer_did, did.did);

  const tamperedPdf = toBuffer(finalPdf);
  tamperedPdf[20] ^= 1;
  const tamperedVerification = core.verifySignedGenericPdf(tamperedPdf, didDocument);
  assert.equal(tamperedVerification.valid, false);
  assert.equal(tamperedVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);

  return { manifest, verification };
}
