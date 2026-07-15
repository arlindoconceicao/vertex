/**
 * Este teste valida assinatura generica de PDF na facade Node-compatible
 * sobre o WASM: walletSignGenericPdf, extractGenericSignatureManifestFromPdf
 * e verifySignedGenericPdf.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

async function createCore(snapshotStore) {
  const { createPersistentWebWallet } = await import('../packages/web/ssi-pq-indexeddb-wallet.mjs');
  const { createNodeCompatibleCore } = await import('../packages/web/ssi-pq-node-compatible.mjs');
  const walletStore = createPersistentWebWallet(wasm, snapshotStore);

  return createNodeCompatibleCore(wasm, { walletStore });
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

test('WASM Node-compatible facade signs and verifies generic PDF with wallet', async () => {
  const { createMemorySnapshotStore } = await import('../packages/web/ssi-pq-indexeddb-wallet.mjs');
  const snapshotStore = createMemorySnapshotStore();
  const runId = crypto.randomUUID();
  const walletName = `generic-pdf-facade-${runId}`;
  const password = 'senha-generic-pdf-facade-123';
  const createdAt = '2026-05-28T00:00:00Z';

  wasm.webWalletClearMemory();

  let core = await createCore(snapshotStore);
  await core.walletCreate(walletName, password, { createdAt });
  const signerDid = await core.walletCreateDid(walletName, password, {
    label: 'Assinante de Documento Generico',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const wrongDid = await core.walletCreateDid(walletName, password, {
    label: 'Assinante Incorreto',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });

  wasm.webWalletClearMemory();
  core = await createCore(snapshotStore);

  const signerDidDocument = await core.walletGetDidDocument(walletName, password, signerDid.did);
  const wrongDidDocument = await core.walletGetDidDocument(walletName, password, wrongDid.did);
  const basePdf = dummyPdfBase();
  const finalPdf = await core.walletSignGenericPdf(
    walletName,
    password,
    signerDid.did,
    basePdf,
    { createdAt }
  );
  const finalPdfText = Buffer.from(finalPdf).toString('latin1');

  assert.equal(finalPdf.length > basePdf.length, true);
  assert.deepEqual(Buffer.from(finalPdf).subarray(0, basePdf.length), basePdf);
  assert.equal(finalPdfText.includes('/Type /Sig'), true);
  assert.equal(finalPdfText.includes('/ByteRange ['), true);
  assert.equal(finalPdfText.includes('/Contents <'), true);

  const verification = core.verifySignedGenericPdf(finalPdf, signerDidDocument);
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.signature_valid, true);
  assert.equal(verification.manifest_is_final_revision, true);
  assert.equal(verification.did_key_match, true);
  assert.equal(verification.status, 'VALID');

  const manifest = core.extractGenericSignatureManifestFromPdf(finalPdf);
  assert.equal(manifest.type, 'ssi_generic_pdf_signature_v1');
  assert.equal(manifest.signer_did, signerDid.did);
  assert.equal(manifest.created_at, createdAt);
  assert.equal(manifest.pdf_base_length, basePdf.length);
  assert.equal(manifest.signature.alg, 'ML-DSA-65');
  assert.equal(manifest.signature.key_id, '#mldsa-1');

  const tamperedBasePdf = Buffer.from(finalPdf);
  tamperedBasePdf[20] ^= 1;
  const tamperedVerification = core.verifySignedGenericPdf(tamperedBasePdf, signerDidDocument);
  assert.equal(tamperedVerification.valid, false);
  assert.equal(tamperedVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);
  assert.equal(tamperedVerification.errors.includes('INVALID_SIGNATURE'), true);

  const wrongDidVerification = core.verifySignedGenericPdf(finalPdf, wrongDidDocument);
  assert.equal(wrongDidVerification.valid, false);
  assert.equal(wrongDidVerification.errors.includes('DID_KEY_MISMATCH'), true);
  assert.equal(wrongDidVerification.errors.includes('INVALID_SIGNATURE'), true);

  await assert.rejects(
    () =>
      core.walletSignGenericPdf(
        walletName,
        password,
        signerDid.did,
        Buffer.from('not a pdf'),
        { createdAt }
      ),
    /PDF base must start with a PDF header/
  );
});
