/**
 * Este teste valida a camada wallet Node-compatible sobre o WASM.
 * No Node, walletCreate recebe path SQLCipher; aqui o mesmo primeiro argumento
 * representa walletName persistido por IndexedDB/OPFS ou snapshot store.
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

test('WASM Node-compatible wallet facade persists and signs like the Node wallet API', async () => {
  const { createMemorySnapshotStore } = await import('../packages/web/ssi-pq-indexeddb-wallet.mjs');
  const snapshotStore = createMemorySnapshotStore();
  const runId = crypto.randomUUID();
  const senderWallet = `sender-facade-${runId}`;
  const senderPassword = 'senha-sender-facade-123';
  const recipientWallet = `recipient-facade-${runId}`;
  const recipientPassword = 'senha-recipient-facade-456';
  const createdAt = '2026-05-27T00:00:00Z';
  const issuedAt = '2026-05-27T00:00:00Z';

  wasm.webWalletClearMemory();

  let core = await createCore(snapshotStore);
  const senderInfo = await core.walletCreate(senderWallet, senderPassword, { createdAt });
  const senderDid = await core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente Facade',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const recipientInfo = await core.walletCreate(recipientWallet, recipientPassword, { createdAt });
  const recipientDid = await core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatario Facade',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });

  assert.equal(senderInfo.backend, 'storage');
  assert.equal(senderInfo.did_count, 0);
  assert.equal(recipientInfo.backend, 'storage');
  assert.equal(recipientInfo.did_count, 0);
  assert.equal(senderDid.did.startsWith('did:ssipq:z'), true);
  assert.equal(recipientDid.did.startsWith('did:ssipq:z'), true);
  assert.equal(senderDid.privateKeys, undefined);
  assert.equal(recipientDid.privateKeys, undefined);

  wasm.webWalletClearMemory();
  core = await createCore(snapshotStore);

  await assert.rejects(
    () => core.walletOpen(senderWallet, 'senha-incorreta'),
    /wallet password is invalid/
  );

  const openedSender = await core.walletOpen(senderWallet, senderPassword);
  const senderDids = await core.walletListDids(senderWallet, senderPassword);
  const senderDidDocument = await core.walletGetDidDocument(
    senderWallet,
    senderPassword,
    senderDid.did
  );
  const recipientDidDocument = await core.walletGetDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );

  assert.equal(openedSender.did_count, 1);
  assert.equal(senderDids.length, 1);
  assert.equal(senderDids[0].did, senderDid.did);
  assert.deepEqual(senderDidDocument, senderDid.did_document);
  assert.equal(core.didVerify(senderDidDocument), true);
  assert.equal(core.didFingerprintMatchesKeys(senderDidDocument), true);

  const attributes = {
    titular: {
      nome: 'Alice Silva'
    },
    curso: 'Criptografia Pos-Quantica'
  };
  const schema = core.createSchemaFromAttributes(attributes, { version: '1', createdAt });
  const signedCredential = await core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    attributes,
    {
      credentialId: 'cred_wasm_wallet_facade_test',
      issuedAt,
      visiblePaths: ['titular.nome', 'curso']
    }
  );

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(core.verifySignedCredential(signedCredential, senderDidDocument), true);

  const pdfBase = core.signedCredentialToPdf(signedCredential, {
    labels: {
      titular: 'Titular',
      'titular.nome': 'Nome',
      curso: 'Curso'
    }
  });
  const finalPdf = await core.walletEmbedSignedCredentialInPdf(
    senderWallet,
    senderPassword,
    senderDid.did,
    pdfBase,
    signedCredential,
    { createdAt }
  );
  const verification = core.verifySignedCredentialPdf(finalPdf, senderDidDocument);
  const manifest = core.extractCredentialManifestFromPdf(finalPdf);

  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(verification.valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(manifest.signed_credential.credential.credential_id, 'cred_wasm_wallet_facade_test');

  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  const recipientPublicKey = core.base64urlEncode(
    core.multibaseBase58btcDecode(mlkemKey.public_key_multibase)
  );
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPublicKey);
  const senderSecret = core.base64urlDecode(encapsulation.sharedSecret);
  const recoveredSecretBase64url = await core.walletMlkemDecapsulate(
    recipientWallet,
    recipientPassword,
    recipientDid.did,
    encapsulation.ciphertext
  );
  const recipientSecret = core.base64urlDecode(recoveredSecretBase64url);

  assert.deepEqual(Buffer.from(senderSecret), Buffer.from(recipientSecret));
});
