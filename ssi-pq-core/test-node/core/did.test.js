/**
 * Este teste valida a criação de documentos DID SSI-PQ
 * assinados, conferindo identificador, fingerprint, chaves
 * públicas, ausência de chaves privadas no documento exportado
 * e verificação criptográfica. Também garante que alterações
 * posteriores no documento ou transplante de chaves sejam
 * rejeitados.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/did.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

test('createDid builds a signed SSI-PQ DID document', () => {
  const result = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });

  assert.equal(result.did.startsWith('did:ssipq:z'), true);
  assert.equal(result.fingerprint.startsWith('z'), true);

  const document = result.didDocument;
  assert.equal(document.type, 'ssi_pq_did_document_v1');
  assert.equal(document.id, result.did);
  assert.equal(document.controller, result.did);
  assert.equal(document.created_at, '2026-05-27T00:00:00Z');
  assert.equal(document.status, 'active');

  assert.deepEqual(document.keys.map((key) => key.id), ['#mldsa-1', '#mlkem-1']);
  assert.equal(document.keys[0].type, 'ML-DSA-65');
  assert.deepEqual(document.keys[0].usage, ['authentication', 'assertionMethod']);
  assert.equal(document.keys[0].public_key_multibase.startsWith('z'), true);
  assert.equal(document.keys[1].type, 'ML-KEM-768');
  assert.deepEqual(document.keys[1].usage, ['keyAgreement']);
  assert.equal(document.keys[1].public_key_multibase.startsWith('z'), true);

  assert.deepEqual(Object.keys(document.signature), ['alg', 'key_id', 'value']);
  assert.equal(document.signature.alg, 'ML-DSA-65');
  assert.equal(document.signature.key_id, '#mldsa-1');
  assert.equal(typeof document.signature.value, 'string');

  assert.equal(typeof result.privateKeys.mldsaPrivateKey, 'string');
  assert.equal(typeof result.privateKeys.mlkemPrivateKey, 'string');
  assert.equal(JSON.stringify(document).includes(result.privateKeys.mldsaPrivateKey), false);
  assert.equal(JSON.stringify(document).includes(result.privateKeys.mlkemPrivateKey), false);

  assert.equal(core.didFingerprintMatchesKeys(document), true);
  assert.equal(core.didVerify(document), true);
});

test('didVerify rejects document changes after signing', () => {
  const result = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const document = structuredClone(result.didDocument);

  document.status = 'revoked';

  assert.equal(core.didFingerprintMatchesKeys(document), true);
  assert.equal(core.didVerify(document), false);
});

test('didFingerprintMatchesKeys rejects key transplantation', () => {
  const first = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const second = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const document = structuredClone(first.didDocument);

  document.keys[0].public_key_multibase = second.didDocument.keys[0].public_key_multibase;

  assert.equal(core.didFingerprintMatchesKeys(document), false);
  assert.equal(core.didVerify(document), false);
});
