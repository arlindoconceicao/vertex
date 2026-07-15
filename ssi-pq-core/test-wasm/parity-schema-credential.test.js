/**
 * Paridade Node x WASM: schema, DID e credenciais assinadas.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createWasmCore,
  credentialDisclosurePairs,
  nodeCore
} = require('./parity-helpers.js');

test('schema and credential helpers keep equivalent semantics in Node and WASM', async () => {
  const wasmCore = await createWasmCore();
  const createdAt = '2026-05-27T00:00:00Z';
  const issuedAt = '2026-05-27T00:00:00Z';
  const attributes = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    curso: 'Criptografia Pos-Quantica',
    nivel: 'Avancado'
  };
  const visiblePaths = ['titular.nome', 'titular.documento.tipo', 'curso'];
  const schemaOptions = { version: '1', createdAt };
  const issueOptions = {
    credentialId: 'cred_parity_schema_credential',
    issuedAt,
    visiblePaths
  };

  const nodeSchema = nodeCore.createSchemaFromAttributes(attributes, schemaOptions);
  const wasmSchema = wasmCore.createSchemaFromAttributes(attributes, schemaOptions);

  assert.deepEqual(wasmSchema, nodeSchema);
  assert.equal(wasmCore.schemaHashBase64(wasmSchema), nodeCore.schemaHashBase64(nodeSchema));

  const nodeDid = nodeCore.createDid({ mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt });
  const wasmDid = wasmCore.createDid({ mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768', createdAt });

  assert.equal(nodeCore.didVerify(nodeDid.didDocument), true);
  assert.equal(wasmCore.didVerify(wasmDid.didDocument), true);
  assert.equal(nodeCore.didFingerprintMatchesKeys(nodeDid.didDocument), true);
  assert.equal(wasmCore.didFingerprintMatchesKeys(wasmDid.didDocument), true);

  const nodeSigned = nodeCore.issueCredentialFromSchema(
    nodeSchema,
    attributes,
    nodeDid.didDocument,
    nodeDid.privateKeys.mldsaPrivateKey,
    issueOptions
  );
  const wasmSigned = wasmCore.issueCredentialFromSchema(
    wasmSchema,
    attributes,
    wasmDid.didDocument,
    wasmDid.privateKeys.mldsaPrivateKey,
    issueOptions
  );

  assert.equal(nodeCore.verifySignedCredential(nodeSigned, nodeDid.didDocument), true);
  assert.equal(wasmCore.verifySignedCredential(wasmSigned, wasmDid.didDocument), true);
  assert.equal(nodeSigned.type, wasmSigned.type);
  assert.equal(nodeSigned.credential.credential_id, wasmSigned.credential.credential_id);
  assert.equal(nodeSigned.credential.schema_hash, wasmSigned.credential.schema_hash);
  assert.deepEqual(credentialDisclosurePairs(wasmSigned), credentialDisclosurePairs(nodeSigned));

  const changedNodeCredential = structuredClone(nodeSigned);
  changedNodeCredential.credential.credential_id = 'cred_tampered';
  const changedWasmCredential = structuredClone(wasmSigned);
  changedWasmCredential.credential.credential_id = 'cred_tampered';

  assert.equal(nodeCore.verifySignedCredential(changedNodeCredential, nodeDid.didDocument), false);
  assert.equal(wasmCore.verifySignedCredential(changedWasmCredential, wasmDid.didDocument), false);
});
