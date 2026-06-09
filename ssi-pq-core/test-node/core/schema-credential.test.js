/**
 * Este teste valida a criação determinística de schemas a partir
 * de atributos JSON, a emissão e verificação de credenciais
 * assinadas com revelação seletiva, atributos aninhados,
 * multiprova v2, compatibilidade com provas legadas v1 e
 * rejeição de mutações, salt adulterado ou documento DID de
 * emissor incorreto.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/schema-credential.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

function createIssuer() {
  return core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
}

test('createSchemaFromAttributes builds a stable schema from plain JSON', () => {
  const left = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const right = core.createSchemaFromAttributes(
    { email: 'ana@example.com', idade: 30, nome: 'Ana' },
    { version: '1', createdAt: '2026-05-28T00:00:00Z' }
  );

  assert.equal(left.type, 'ssi_schema_v1');
  assert.equal(left.schema_id.startsWith('schema_z'), true);
  assert.equal(left.schema_id, right.schema_id);
  assert.match(core.schemaHashBase64(left), /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(Buffer.from(core.schemaHashBase64(left), 'base64').length, 32);
  assert.equal(core.schemaHashBase64(left), core.schemaHashBase64(right));
  assert.deepEqual(
    left.attributes.map((attribute) => [attribute.path, attribute.type, attribute.required]),
    [
      ['subject.email', 'string', true],
      ['subject.idade', 'integer', true],
      ['subject.nome', 'string', true]
    ]
  );
});

test('issueCredentialFromSchema signs credential and verifies disclosed attributes', () => {
  const issuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_node_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'email']
    }
  );

  assert.equal(signed.type, 'ssi_signed_credential_v2');
  assert.equal(signed.credential.type, 'ssi_credential_v1');
  assert.equal(signed.credential.credential_id, 'cred_node_test');
  assert.equal(signed.credential.schema_id, schema.schema_id);
  assert.equal(signed.credential.schema_hash, core.schemaHashBase64(schema));
  assert.equal(signed.credential.issuer_did, issuer.did);
  assert.equal(signed.credential.issuer_identifier, core.issuerIdentifierBase64(issuer.didDocument));
  assert.equal(signed.credential.attributes_commitment.alg, 'Merkle-SHA3-256');
  assert.equal(typeof signed.credential.attributes_commitment.root, 'string');
  assert.equal(signed.credential_signature.alg, 'ML-DSA-65');
  assert.equal(signed.credential_signature.key_id, '#mldsa-1');
  assert.equal(
    signed.credential_signature.public_key_multibase,
    issuer.didDocument.keys.find((key) => key.id === '#mldsa-1').public_key_multibase
  );
  assert.deepEqual(
    signed.attribute_disclosures.map((disclosure) => disclosure.path),
    ['subject.email', 'subject.nome']
  );
  assert.equal(signed.attribute_multiproof.alg, 'Merkle-SHA3-256-Multiproof-V1');
  assert.equal(signed.attribute_multiproof.leaf_count, 3);
  assert.equal(Array.isArray(signed.attribute_multiproof.proof_nodes), true);
  assert.equal(
    signed.attribute_disclosures.every(
      (disclosure) => disclosure.leaf_hash === undefined && disclosure.proof === undefined
    ),
    true
  );
  assert.equal(core.verifySignedCredential(signed, issuer.didDocument), true);
});

test('issueCredentialFromSchema generates a 256-bit credential id from issuer, schema, attributes and timestamp', () => {
  const issuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const attributes = { nome: 'Ana', idade: 30, email: 'ana@example.com' };
  const options = {
    issuedAt: '2026-06-01T12:00:00Z',
    visiblePaths: ['nome', 'email']
  };
  const signed = core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    options
  );
  const signedAgain = core.issueCredentialFromSchema(
    schema,
    { email: 'ana@example.com', idade: 30, nome: 'Ana' },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    options
  );
  const signedLater = core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      ...options,
      issuedAt: '2026-06-01T12:00:01Z'
    }
  );

  assert.match(signed.credential.credential_id, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(Buffer.from(signed.credential.credential_id, 'base64').length, 32);
  assert.equal(signed.credential.credential_id, signedAgain.credential.credential_id);
  assert.notEqual(signed.credential.credential_id, signedLater.credential.credential_id);
  assert.equal(core.verifySignedCredential(signed, issuer.didDocument), true);
});

test('issueCredentialFromSchema supports nested attributes through flattened paths', () => {
  const issuer = createIssuer();
  const attributes = {
    nome: 'Ana',
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
      credentialId: 'cred_nested_node_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['endereco.rua']
    }
  );

  assert.deepEqual(
    schema.attributes.map((attribute) => attribute.path),
    ['subject.endereco.cidade', 'subject.endereco.rua', 'subject.nome']
  );
  assert.deepEqual(
    signed.attribute_disclosures.map((disclosure) => [disclosure.path, disclosure.value]),
    [['subject.endereco.rua', 'Rua A']]
  );
  assert.equal(core.verifySignedCredential(signed, issuer.didDocument), true);
});

test('issueCredentialFromSchema can still emit legacy v1 per-attribute proofs', () => {
  const issuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30, email: 'ana@example.com' },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_node_legacy_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome'],
      credentialVersion: 'v1'
    }
  );

  assert.equal(signed.type, 'ssi_signed_credential_v1');
  assert.equal(signed.attribute_multiproof, undefined);
  assert.equal(signed.attribute_disclosures.length, 1);
  assert.equal(typeof signed.attribute_disclosures[0].leaf_hash, 'string');
  assert.equal(Array.isArray(signed.attribute_disclosures[0].proof), true);
  assert.equal(core.verifySignedCredential(signed, issuer.didDocument), true);
});

test('verifySignedCredential rejects credential mutation after signing', () => {
  const issuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30 },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30 },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    { credentialId: 'cred_node_test', issuedAt: '2026-05-27T00:00:00Z' }
  );
  const changed = structuredClone(signed);

  changed.credential.credential_id = 'cred_changed';

  assert.equal(core.verifySignedCredential(changed, issuer.didDocument), false);
});

test('verifySignedCredential rejects changed signer public key in JSON signature', () => {
  const issuer = createIssuer();
  const otherIssuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30 },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30 },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    { credentialId: 'cred_node_test', issuedAt: '2026-05-27T00:00:00Z' }
  );
  const changed = structuredClone(signed);

  changed.credential_signature.public_key_multibase =
    otherIssuer.didDocument.keys.find((key) => key.id === '#mldsa-1').public_key_multibase;

  assert.equal(core.verifySignedCredential(changed, issuer.didDocument), false);
});

test('verifySignedCredential rejects changed disclosure salt', () => {
  const issuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30 },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30 },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    { credentialId: 'cred_node_test', issuedAt: '2026-05-27T00:00:00Z' }
  );
  const changed = structuredClone(signed);

  changed.attribute_disclosures[0].salt = core.base64urlEncode(Buffer.alloc(32, 7));

  assert.equal(core.verifySignedCredential(changed, issuer.didDocument), false);
});

test('verifySignedCredential rejects the wrong issuer DID document', () => {
  const issuer = createIssuer();
  const otherIssuer = createIssuer();
  const schema = core.createSchemaFromAttributes(
    { nome: 'Ana', idade: 30 },
    { version: '1', createdAt: '2026-05-27T00:00:00Z' }
  );
  const signed = core.issueCredentialFromSchema(
    schema,
    { nome: 'Ana', idade: 30 },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    { credentialId: 'cred_node_test', issuedAt: '2026-05-27T00:00:00Z' }
  );

  assert.equal(core.verifySignedCredential(signed, otherIssuer.didDocument), false);
});
