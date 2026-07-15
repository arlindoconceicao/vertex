/**
 * Paridade Node x WASM: wallet, credencial e PDF assinado.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertPdfHeader,
  createWasmCore,
  credentialDisclosurePairs,
  newRunId,
  nodeCore,
  tempWalletPath,
  toBuffer
} = require('./parity-helpers.js');

test('wallet credential PDF flow has equivalent behavior in Node and WASM', async () => {
  const wasmCore = await createWasmCore({ wallet: true });
  const nodeResult = await runWalletPdfFlow(nodeCore, tempWalletPath('node-wallet-pdf'));
  const wasmResult = await runWalletPdfFlow(wasmCore, `wasm-wallet-pdf-${newRunId()}`);

  assert.deepEqual(commonWalletInfo(wasmResult.walletInfo), commonWalletInfo(nodeResult.walletInfo));
  assert.equal(wasmResult.walletInfo.backend, 'storage');
  assert.equal(nodeResult.didDocument.id.startsWith('did:ssipq:z'), true);
  assert.equal(wasmResult.didDocument.id.startsWith('did:ssipq:z'), true);
  assert.equal(nodeResult.credentialId, wasmResult.credentialId);
  assert.deepEqual(wasmResult.disclosures, nodeResult.disclosures);
  assert.equal(nodeResult.verification.valid, true);
  assert.equal(wasmResult.verification.valid, true);
  assert.equal(nodeResult.verification.pdf_base_hash_valid, wasmResult.verification.pdf_base_hash_valid);
  assert.equal(
    nodeResult.verification.document_binding_signature_valid,
    wasmResult.verification.document_binding_signature_valid
  );
});

async function runWalletPdfFlow(core, walletId) {
  const password = 'senha-wallet-pdf-parity-123';
  const createdAt = '2026-05-27T00:00:00Z';
  const issuedAt = '2026-05-27T00:00:00Z';
  const attributes = {
    titular: {
      nome: 'Alice Silva'
    },
    curso: 'Criptografia Pos-Quantica',
    nivel: 'Avancado'
  };
  const labels = {
    titular: 'Titular',
    'titular.nome': 'Nome',
    curso: 'Curso',
    nivel: 'Nivel'
  };

  const walletInfo = await core.walletCreate(walletId, password, { createdAt });
  const did = await core.walletCreateDid(walletId, password, {
    label: 'Wallet PDF Parity',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const didDocument = await core.walletGetDidDocument(walletId, password, did.did);
  const schema = core.createSchemaFromAttributes(attributes, { version: '1', createdAt });
  const signedCredential = await core.walletIssueCredentialFromSchema(
    walletId,
    password,
    did.did,
    schema,
    attributes,
    {
      credentialId: 'cred_parity_wallet_pdf',
      issuedAt,
      visiblePaths: ['titular.nome', 'curso', 'nivel']
    }
  );
  const pdfBase = core.signedCredentialToPdf(signedCredential, { labels });
  const finalPdf = await core.walletEmbedSignedCredentialInPdf(
    walletId,
    password,
    did.did,
    pdfBase,
    signedCredential,
    { createdAt }
  );
  const manifest = core.extractCredentialManifestFromPdf(finalPdf);
  const verification = core.verifySignedCredentialPdf(finalPdf, didDocument);

  assertPdfHeader(assert, pdfBase);
  assertPdfHeader(assert, finalPdf);
  assert.equal(toBuffer(finalPdf).length > toBuffer(pdfBase).length, true);

  return {
    credentialId: manifest.signed_credential.credential.credential_id,
    didDocument,
    disclosures: credentialDisclosurePairs(manifest.signed_credential),
    verification,
    walletInfo
  };
}

function commonWalletInfo(walletInfo) {
  return {
    created_at: walletInfo.created_at,
    did_count: walletInfo.did_count
  };
}
