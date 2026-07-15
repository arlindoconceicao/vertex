/**
 * Este teste cobre os helpers puros expostos pelo WASM para aproximar a
 * paridade com o addon Node: hashes, random, ML-DSA, ML-KEM e hashes
 * derivados de schema/DID Document.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

function toJson(value) {
  return JSON.stringify(value);
}

function fromJson(text) {
  return JSON.parse(text);
}

test('WASM pure helpers expose SHA3, canonical JSON hash and secure random', () => {
  const left = '{"z":1,"a":{"b":2,"a":1}}';
  const right = '{"a":{"a":1,"b":2},"z":1}';

  assert.equal(wasm.canonicalJson(left), right);
  assert.equal(wasm.canonicalJsonHashBase64url(left), wasm.canonicalJsonHashBase64url(right));
  assert.equal(
    wasm.sha3_256Hex(new Uint8Array()),
    'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'
  );
  assert.equal(typeof wasm.sha3_256Base64url(Buffer.from('ssi-pq-core', 'utf8')), 'string');

  const key16 = wasm.secureRandomKey(16);
  const key32 = wasm.secureRandomKey(32);
  const key64 = wasm.secureRandomKey(64);
  const anotherKey64 = wasm.secureRandomKey(64);

  assert.equal(key16.length, 16);
  assert.equal(key32.length, 32);
  assert.equal(key64.length, 64);
  assert.notDeepEqual(Buffer.from(key64), Buffer.from(anotherKey64));
  assert.throws(() => wasm.secureRandomKey(0), /greater than zero/);
});

test('WASM pure helpers expose schema and issuer hashes', () => {
  const attributes = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    nivel: 'Avancado'
  };
  const schema = fromJson(
    wasm.createSchemaFromAttributesJson(
      toJson(attributes),
      toJson({ version: '1', createdAt: '2026-05-27T00:00:00Z' })
    )
  );
  const did = fromJson(
    wasm.createDidJson(
      toJson({
        mldsa: 'ML-DSA-65',
        mlkem: 'ML-KEM-768',
        createdAt: '2026-05-27T00:00:00Z'
      })
    )
  );

  const schemaHash = wasm.schemaHashBase64(schema);
  const issuerIdentifier = wasm.issuerIdentifierBase64(did.didDocument);

  assert.equal(typeof schemaHash, 'string');
  assert.equal(schemaHash.length > 0, true);
  assert.equal(wasm.schemaHashBase64(schema), schemaHash);
  assert.equal(typeof issuerIdentifier, 'string');
  assert.equal(issuerIdentifier.length > 0, true);
  assert.equal(wasm.issuerIdentifierBase64(did.didDocument), issuerIdentifier);
});

test('WASM pure helpers expose ML-DSA keygen, sign and verify', () => {
  const keyPair = wasm.mldsaGenerateKeypair('ML-DSA-65');
  const context = 'SSI_CREDENTIAL_SIGNATURE_V1';
  const message = Buffer.from('credential payload', 'utf8');
  const signature = wasm.mldsaSign('ML-DSA-65', keyPair.privateKey, message, context);

  assert.equal(keyPair.profile, 'ML-DSA-65');
  assert.equal(typeof keyPair.publicKey, 'string');
  assert.equal(typeof keyPair.privateKey, 'string');
  assert.equal(
    wasm.mldsaVerify('ML-DSA-65', keyPair.publicKey, message, context, signature),
    true
  );
  assert.equal(
    wasm.mldsaVerify(
      'ML-DSA-65',
      keyPair.publicKey,
      Buffer.from('changed payload', 'utf8'),
      context,
      signature
    ),
    false
  );
});

test('WASM pure helpers expose ML-KEM keygen, encapsulate and decapsulate', () => {
  const keyPair = wasm.mlkemGenerateKeypair('ML-KEM-768');
  const encapsulation = wasm.mlkemEncapsulate('ML-KEM-768', keyPair.publicKey);
  const decapsulated = wasm.mlkemDecapsulate(
    'ML-KEM-768',
    keyPair.privateKey,
    encapsulation.ciphertext
  );

  assert.equal(keyPair.profile, 'ML-KEM-768');
  assert.equal(typeof keyPair.publicKey, 'string');
  assert.equal(typeof keyPair.privateKey, 'string');
  assert.equal(encapsulation.profile, 'ML-KEM-768');
  assert.equal(encapsulation.sharedSecret, decapsulated);
});
