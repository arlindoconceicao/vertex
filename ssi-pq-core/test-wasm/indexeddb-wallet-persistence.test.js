/**
 * Este teste valida a camada de persistencia browser-like para o wallet_storage
 * do WASM. O teste usa um snapshot store em memoria, com o mesmo contrato
 * assinc que o IndexedDB real usa no browser.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const outputDir = path.join(__dirname, '..', 'test-output', 'wasm-indexeddb-wallet-flow');
fs.mkdirSync(outputDir, { recursive: true });

const createdAt = '2026-05-27T00:00:00Z';
const issuedAt = '2026-05-27T00:00:00Z';

function toJson(value) {
  return JSON.stringify(value);
}

function fromJson(text) {
  return JSON.parse(text);
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2));
}

test('persistent WASM web wallet restores encrypted snapshot after reload', async () => {
  const { createMemorySnapshotStore, createPersistentWebWallet } = await import(
    '../packages/web/ssi-pq-indexeddb-wallet.mjs'
  );

  wasm.webWalletClearMemory();

  const snapshotStore = createMemorySnapshotStore();
  const runId = crypto.randomUUID();
  const walletName = `issuer-indexeddb-${runId}`;
  const password = 'senha-indexeddb-wallet-123';
  const newPassword = 'senha-indexeddb-wallet-456';
  const walletA = createPersistentWebWallet(wasm, snapshotStore);

  const createdWallet = await walletA.createWallet(walletName, password, { createdAt });
  assert.equal(createdWallet.backend, 'storage');
  assert.equal(createdWallet.did_count, 0);

  const didResult = await walletA.createDid(walletName, password, {
    label: 'Emissor IndexedDB',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });

  assert.equal(didResult.did.startsWith('did:ssipq:z'), true);
  assert.equal(didResult.did_document.id, didResult.did);
  assert.equal(didResult.privateKeys, undefined);

  const snapshotJson = await walletA.exportWalletSnapshot(walletName);
  const snapshotEntries = fromJson(snapshotJson);
  assert.equal(Array.isArray(snapshotEntries), true);
  assert.ok(snapshotEntries.length >= 1);
  assert.equal(snapshotJson.includes(password), false);
  assert.equal(snapshotJson.includes('privateKey'), false);

  const didDocumentBeforeReload = await walletA.getDidDocument(
    walletName,
    password,
    didResult.did
  );
  assert.deepEqual(didDocumentBeforeReload, didResult.did_document);

  wasm.webWalletClearMemory();

  const walletB = createPersistentWebWallet(wasm, snapshotStore);
  await assert.rejects(
    () => walletB.openWallet(walletName, 'senha-errada'),
    /wallet password is invalid/
  );

  const openedWallet = await walletB.openWallet(walletName, password);
  const dids = await walletB.listDids(walletName, password);
  const didDocument = await walletB.getDidDocument(walletName, password, didResult.did);

  assert.equal(openedWallet.did_count, 1);
  assert.equal(dids.length, 1);
  assert.equal(dids[0].did, didResult.did);
  assert.deepEqual(didDocument, didResult.did_document);
  assert.deepEqual(fromJson(wasm.verifyDidDocumentJson(toJson(didDocument))), {
    valid: true,
    fingerprintMatchesKeys: true
  });

  const credentialData = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    formacao: {
      curso: 'Criptografia Pos-Quantica',
      instituicao: {
        nome: 'SSI-PQ Academy',
        cidade: 'Sao Paulo'
      }
    },
    endereco: {
      cidade: 'Sao Paulo'
    },
    nivel: 'Avancado'
  };
  const visiblePaths = [
    'titular.nome',
    'titular.documento.tipo',
    'titular.documento.numero',
    'formacao.curso',
    'formacao.instituicao.nome',
    'endereco.cidade',
    'nivel'
  ];
  const pdfLabels = {
    endereco: 'Endereco',
    'endereco.cidade': 'Cidade',
    formacao: 'Formacao',
    'formacao.curso': 'Curso',
    'formacao.instituicao': 'Instituicao',
    'formacao.instituicao.nome': 'Nome',
    nivel: 'Nivel',
    titular: 'Titular',
    'titular.documento': 'Documento',
    'titular.documento.tipo': 'Tipo',
    'titular.nome': 'Nome'
  };

  const schema = fromJson(
    wasm.createSchemaFromAttributesJson(
      toJson(credentialData),
      toJson({ version: '1', createdAt })
    )
  );
  const signedCredential = await walletB.issueCredentialFromSchema(
    walletName,
    password,
    didResult.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_wasm_indexeddb_wallet_test',
      issuedAt,
      visiblePaths
    }
  );

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.deepEqual(
    fromJson(wasm.verifySignedCredentialJson(toJson(signedCredential), toJson(didDocument))),
    { valid: true }
  );

  const pdfBase = wasm.signedCredentialToPdfBytes(
    toJson(signedCredential),
    toJson({ labels: pdfLabels })
  );
  const finalPdf = await walletB.embedSignedCredentialInPdf(
    walletName,
    password,
    didResult.did,
    pdfBase,
    signedCredential,
    { createdAt, didDocCid: 'bafy-indexeddb-wallet-did-doc' }
  );
  const verification = fromJson(wasm.verifySignedCredentialPdfJson(finalPdf, toJson(didDocument)));
  const manifest = fromJson(wasm.extractCredentialManifestFromPdfBytes(finalPdf));

  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(
    manifest.signed_credential.credential.credential_id,
    'cred_wasm_indexeddb_wallet_test'
  );

  const changedWallet = await walletB.changePassword(walletName, password, newPassword);
  assert.equal(changedWallet.did_count, 1);

  wasm.webWalletClearMemory();

  const walletC = createPersistentWebWallet(wasm, snapshotStore);
  await assert.rejects(
    () => walletC.openWallet(walletName, password),
    /wallet password is invalid/
  );
  const reopenedWallet = await walletC.openWallet(walletName, newPassword);
  assert.equal(reopenedWallet.did_count, 1);

  writeJson(`wallet-info-${runId}.json`, reopenedWallet);
  writeJson(`wallet-snapshot-${runId}.json`, fromJson(await walletC.exportWalletSnapshot(walletName)));
  writeJson(`did-document-${runId}.json`, didDocument);
  writeJson(`schema-${runId}.json`, schema);
  writeJson(`signed-credential-${runId}.json`, signedCredential);
  writeJson(`credencial-labels-manifest-${runId}.json`, manifest);
  writeJson(`credencial-labels-verification-${runId}.json`, verification);
  fs.writeFileSync(path.join(outputDir, `credencial-labels-base-${runId}.pdf`), Buffer.from(pdfBase));
  fs.writeFileSync(path.join(outputDir, `credencial-labels-${runId}.pdf`), Buffer.from(finalPdf));
});
