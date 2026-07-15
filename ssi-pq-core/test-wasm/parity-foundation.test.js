/**
 * Paridade Node x WASM: foundation helpers.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createWasmCore, nodeCore, toBuffer } = require('./parity-helpers.js');

test('foundation helpers produce equivalent Node and WASM behavior', async () => {
  const wasmCore = await createWasmCore();
  const unorderedJson = '{"z":1,"a":{"b":2,"a":1},"list":[3,2,1]}';
  const canonicalJson = '{"a":{"a":1,"b":2},"list":[3,2,1],"z":1}';
  const message = Buffer.from('ssi-pq parity foundation', 'utf8');

  assert.equal(nodeCore.canonicalJson(unorderedJson), canonicalJson);
  assert.equal(wasmCore.canonicalJson(unorderedJson), canonicalJson);
  assert.equal(
    wasmCore.canonicalJsonHashBase64url(unorderedJson),
    nodeCore.canonicalJsonHashBase64url(unorderedJson)
  );
  assert.equal(wasmCore.sha3_256Hex(message), nodeCore.sha3_256Hex(message));
  assert.equal(wasmCore.sha3_256Base64url(message), nodeCore.sha3_256Base64url(message));
  assert.deepEqual(wasmCore.supportedProfiles(), nodeCore.supportedProfiles());

  const encoded = nodeCore.base64urlEncode(message);
  assert.equal(wasmCore.base64urlEncode(message), encoded);
  assert.deepEqual(toBuffer(wasmCore.base64urlDecode(encoded)), toBuffer(nodeCore.base64urlDecode(encoded)));

  const randomKey = wasmCore.secureRandomKey(32);
  assert.equal(randomKey.length, nodeCore.secureRandomKey(32).length);

  const plaintext = Buffer.from('mensagem cifrada para teste de paridade', 'utf8');
  const encryptedByNode = nodeCore.aes256GcmEncrypt(randomKey, plaintext);
  const decryptedByWasm = wasmCore.aes256GcmDecrypt(
    randomKey,
    encryptedByNode.ciphertext,
    encryptedByNode.nonce,
    encryptedByNode.authTag
  );
  assert.deepEqual(toBuffer(decryptedByWasm), plaintext);

  const encryptedByWasm = wasmCore.aes256GcmEncrypt(randomKey, plaintext);
  const decryptedByNode = nodeCore.aes256GcmDecrypt(
    randomKey,
    encryptedByWasm.ciphertext,
    encryptedByWasm.nonce,
    encryptedByWasm.authTag
  );
  assert.deepEqual(toBuffer(decryptedByNode), plaintext);
});
