/**
 * Este teste valida a facade Node-compatible sobre o pacote WASM para as APIs
 * core de alto nivel: DID, schema, credencial e PDF.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

async function createCore() {
  const { createNodeCompatibleCore } = await import(
    '../packages/web/ssi-pq-node-compatible.mjs'
  );
  return createNodeCompatibleCore(wasm);
}

test('WASM Node-compatible facade exposes DID helpers with Node-like objects', async () => {
  const core = await createCore();
  const result = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });

  assert.equal(result.did.startsWith('did:ssipq:z'), true);
  assert.equal(result.fingerprint.startsWith('z'), true);
  assert.equal(result.didDocument.id, result.did);
  assert.equal(result.didDocument.created_at, '2026-05-27T00:00:00Z');
  assert.equal(typeof result.privateKeys.mldsaPrivateKey, 'string');
  assert.equal(typeof result.privateKeys.mlkemPrivateKey, 'string');
  assert.equal(core.didFingerprintMatchesKeys(result.didDocument), true);
  assert.equal(core.didVerify(result.didDocument), true);

  const changedDocument = structuredClone(result.didDocument);
  changedDocument.status = 'revoked';

  assert.equal(core.didFingerprintMatchesKeys(changedDocument), true);
  assert.equal(core.didVerify(changedDocument), false);
});

test('WASM Node-compatible facade exposes schema and credential helpers', async () => {
  const core = await createCore();
  const issuer = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const attributes = {
    nome: 'Ana',
    idade: 30,
    endereco: {
      cidade: 'Sao Paulo',
      rua: 'Rua A'
    }
  };
  const schema = core.createSchemaFromAttributes(attributes, {
    version: '1',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const signed = core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_wasm_facade_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'endereco.rua']
    }
  );

  assert.equal(schema.type, 'ssi_schema_v1');
  assert.equal(schema.schema_id.startsWith('schema_z'), true);
  assert.equal(core.schemaHashBase64(schema), signed.credential.schema_hash);
  assert.equal(core.issuerIdentifierBase64(issuer.didDocument), signed.credential.issuer_identifier);
  assert.equal(signed.type, 'ssi_signed_credential_v2');
  assert.equal(signed.credential.credential_id, 'cred_wasm_facade_test');
  assert.deepEqual(
    signed.attribute_disclosures.map((disclosure) => [disclosure.path, disclosure.value]),
    [
      ['subject.endereco.rua', 'Rua A'],
      ['subject.nome', 'Ana']
    ]
  );
  assert.equal(core.verifySignedCredential(signed, issuer.didDocument), true);

  const changed = structuredClone(signed);
  changed.credential.credential_id = 'cred_changed';
  assert.equal(core.verifySignedCredential(changed, issuer.didDocument), false);
});

test('WASM Node-compatible facade exposes PDF helpers', async () => {
  const core = await createCore();
  const issuer = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const attributes = {
    titular: {
      nome: 'Alice Silva'
    },
    curso: 'Criptografia Pos-Quantica'
  };
  const schema = core.createSchemaFromAttributes(attributes, {
    version: '1',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const signed = core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_wasm_facade_pdf_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['titular.nome', 'curso']
    }
  );
  const pdfBase = core.signedCredentialToPdf(signed, {
    labels: {
      titular: 'Titular',
      'titular.nome': 'Nome',
      curso: 'Curso'
    }
  });
  const finalPdf = core.embedSignedCredentialInPdf(
    pdfBase,
    signed,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    { createdAt: '2026-05-27T00:00:00Z' }
  );
  const manifest = core.extractCredentialManifestFromPdf(finalPdf);
  const verification = core.verifySignedCredentialPdf(finalPdf, issuer.didDocument);

  assert.equal(Buffer.from(pdfBase).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(finalPdf.length > pdfBase.length, true);
  assert.equal(manifest.signed_credential.credential.credential_id, 'cred_wasm_facade_pdf_test');
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
});
