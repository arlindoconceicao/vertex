/**
 * Este teste verifica as primitivas pós-quânticas principais:
 * geração de chaves e assinatura ML-DSA-65 com rejeição de
 * mensagens alteradas, além de encapsulamento e desencapsulamento
 * ML-KEM-768 produzindo o mesmo segredo compartilhado.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/pq-primitives.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

test('ML-DSA-65 signs and rejects changed messages', () => {
  const keyPair = core.mldsaGenerateKeypair('ML-DSA-65');
  const context = 'SSI_CREDENTIAL_SIGNATURE_V1';
  const message = Buffer.from('credential payload', 'utf8');
  const signature = core.mldsaSign('ML-DSA-65', keyPair.privateKey, message, context);

  assert.equal(
    core.mldsaVerify('ML-DSA-65', keyPair.publicKey, message, context, signature),
    true
  );
  assert.equal(
    core.mldsaVerify(
      'ML-DSA-65',
      keyPair.publicKey,
      Buffer.from('changed payload', 'utf8'),
      context,
      signature
    ),
    false
  );
});

test('ML-KEM-768 encapsulates and decapsulates the same shared secret', () => {
  const keyPair = core.mlkemGenerateKeypair('ML-KEM-768');
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', keyPair.publicKey);
  const decapsulated = core.mlkemDecapsulate(
    'ML-KEM-768',
    keyPair.privateKey,
    encapsulation.ciphertext
  );

  assert.equal(encapsulation.sharedSecret, decapsulated);
});

test('AES-256-GCM encrypts and decrypts bytes in Rust', () => {
  const key = Buffer.alloc(32, 7);
  const plaintext = Buffer.from('credential payload', 'utf8');
  const aad = Buffer.from('ssi-pq-aad', 'utf8');

  const encrypted = core.aes256GcmEncrypt(key, plaintext, aad);
  const decrypted = Buffer.from(
    core.aes256GcmDecrypt(
      key,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
      aad
    )
  );

  assert.deepEqual(decrypted, plaintext);
  assert.notDeepEqual(Buffer.from(encrypted.ciphertext), plaintext);
  assert.equal(Buffer.from(encrypted.nonce).length, 12);
  assert.equal(Buffer.from(encrypted.authTag).length, 16);
  assert.throws(() =>
    core.aes256GcmDecrypt(
      key,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
      Buffer.from('changed-aad', 'utf8')
    )
  );
});
