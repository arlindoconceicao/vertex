/**
 * Paridade Node x WASM: primitivas pos-quanticas.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const { createWasmCore, nodeCore } = require('./parity-helpers.js');

test('ML-DSA and ML-KEM primitives interoperate between Node and WASM', async () => {
  const wasmCore = await createWasmCore();
  const message = Buffer.from('payload para assinatura de paridade', 'utf8');
  const changedMessage = Buffer.from('payload alterado', 'utf8');
  const context = 'SSI_PARITY_TEST_V1';

  const nodeMldsa = nodeCore.mldsaGenerateKeypair('ML-DSA-65');
  const wasmMldsa = wasmCore.mldsaGenerateKeypair('ML-DSA-65');
  const nodeSignature = nodeCore.mldsaSign(
    'ML-DSA-65',
    nodeMldsa.privateKey,
    message,
    context
  );
  const wasmSignature = wasmCore.mldsaSign(
    'ML-DSA-65',
    wasmMldsa.privateKey,
    message,
    context
  );

  assert.equal(wasmCore.mldsaVerify('ML-DSA-65', nodeMldsa.publicKey, message, context, nodeSignature), true);
  assert.equal(nodeCore.mldsaVerify('ML-DSA-65', wasmMldsa.publicKey, message, context, wasmSignature), true);
  assert.equal(wasmCore.mldsaVerify('ML-DSA-65', nodeMldsa.publicKey, changedMessage, context, nodeSignature), false);
  assert.equal(nodeCore.mldsaVerify('ML-DSA-65', wasmMldsa.publicKey, changedMessage, context, wasmSignature), false);

  const nodeMlkem = nodeCore.mlkemGenerateKeypair('ML-KEM-768');
  const wasmMlkem = wasmCore.mlkemGenerateKeypair('ML-KEM-768');
  const encapsulatedByWasm = wasmCore.mlkemEncapsulate('ML-KEM-768', nodeMlkem.publicKey);
  const decapsulatedByNode = nodeCore.mlkemDecapsulate(
    'ML-KEM-768',
    nodeMlkem.privateKey,
    encapsulatedByWasm.ciphertext
  );
  const encapsulatedByNode = nodeCore.mlkemEncapsulate('ML-KEM-768', wasmMlkem.publicKey);
  const decapsulatedByWasm = wasmCore.mlkemDecapsulate(
    'ML-KEM-768',
    wasmMlkem.privateKey,
    encapsulatedByNode.ciphertext
  );

  assert.equal(encapsulatedByWasm.sharedSecret, decapsulatedByNode);
  assert.equal(encapsulatedByNode.sharedSecret, decapsulatedByWasm);
});
