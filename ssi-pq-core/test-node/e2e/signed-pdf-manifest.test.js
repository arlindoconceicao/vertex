/**
 * Este teste valida o manifesto SSI-PQ embutido em um PDF assinado:
 * gera PDF visual, embute a credencial e o vínculo criptográfico,
 * extrai o manifesto, verifica o PDF final e garante rejeição de
 * alterações no visual, no manifesto, no PDF transplantado e em
 * revisões posteriores anexadas ao arquivo.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/e2e/signed-pdf-manifest.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

function issueCredential(issuer, credentialId, attributes) {
  const schema = core.createSchemaFromAttributes(
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      carga_horaria: 40
    },
    {
      version: '1',
      createdAt: '2026-05-27T00:00:00Z'
    }
  );

  return core.issueCredentialFromSchema(
    schema,
    attributes,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId,
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'curso', 'carga_horaria']
    }
  );
}

test('PDF manifest binds the signed credential to the visual PDF bytes', () => {
  const issuer = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const signedCredential = issueCredential(issuer, 'cred_pdf_bind_test', {
    nome: 'Ana Silva',
    curso: 'Criptografia Aplicada',
    carga_horaria: 40
  });
  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.embedSignedCredentialInPdf(
      pdfBase,
      signedCredential,
      issuer.didDocument,
      issuer.privateKeys.mldsaPrivateKey,
      {
        createdAt: '2026-05-27T00:00:00Z'
      }
    )
  );
  const outputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf');
  const outputPath = path.join(outputDir, 'ssi-pq-credential-with-manifest.pdf');
  const didDocumentPath = path.join(
    outputDir,
    'ssi-pq-credential-with-manifest.did-document.json'
  );

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, finalPdf);
  fs.writeFileSync(didDocumentPath, JSON.stringify(issuer.didDocument, null, 2));

  const manifest = core.extractCredentialManifestFromPdf(finalPdf);
  assert.equal(manifest.type, 'ssi_pdf_signature_v1');
  assert.equal(manifest.signed_credential.credential.credential_id, 'cred_pdf_bind_test');
  assert.equal(manifest.document_binding.pdf_base_length, pdfBase.length);
  assert.equal(manifest.document_binding.credential_hash_scope, 'signed_credential_canonical_json');
  assert.equal(
    manifest.document_binding.signing_public_key_multibase,
    issuer.didDocument.keys.find((key) => key.id === '#mldsa-1').public_key_multibase
  );
  assert.equal(
    manifest.signed_credential.credential_signature.public_key_multibase,
    issuer.didDocument.keys.find((key) => key.id === '#mldsa-1').public_key_multibase
  );
  assert.equal(finalPdf.subarray(0, pdfBase.length).equals(pdfBase), true);

  const verification = core.verifySignedCredentialPdf(finalPdf, issuer.didDocument);
  assert.equal(verification.valid, true);
  assert.equal(verification.status, 'VALID');
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(verification.manifest_is_final_revision, true);
  assert.equal(verification.did_key_match, true);

  const changedVisualPdf = Buffer.from(finalPdf);
  const visualNeedle = Buffer.from('416E612053696C7661', 'latin1');
  const visualOffset = changedVisualPdf.indexOf(visualNeedle);
  assert.notEqual(visualOffset, -1);
  changedVisualPdf[visualOffset] = changedVisualPdf[visualOffset] === 0x34 ? 0x35 : 0x34;
  const changedVisualVerification = core.verifySignedCredentialPdf(
    changedVisualPdf,
    issuer.didDocument
  );
  assert.equal(changedVisualVerification.valid, false);
  assert.equal(changedVisualVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);

  const changedManifestPdf = Buffer.from(finalPdf);
  const originalCredentialId = Buffer.from('"credential_id":"cred_pdf_bind_test"', 'utf8');
  const changedCredentialId = Buffer.from('"credential_id":"cred_pdf_bind_fake"', 'utf8');
  const manifestCredentialOffset = changedManifestPdf.indexOf(
    originalCredentialId,
    pdfBase.length
  );
  assert.notEqual(manifestCredentialOffset, -1);
  changedCredentialId.copy(changedManifestPdf, manifestCredentialOffset);
  const changedManifestVerification = core.verifySignedCredentialPdf(
    changedManifestPdf,
    issuer.didDocument
  );
  assert.equal(changedManifestVerification.valid, false);
  assert.equal(
    changedManifestVerification.errors.includes('INVALID_CREDENTIAL_SIGNATURE'),
    true
  );

  const otherSignedCredential = issueCredential(issuer, 'cred_pdf_bind_fake', {
    nome: 'Eva Souza',
    curso: 'Criptografia Aplicada',
    carga_horaria: 40
  });
  const otherPdfBase = Buffer.from(core.signedCredentialToPdf(otherSignedCredential));
  assert.equal(otherPdfBase.length, pdfBase.length);
  const transplantedPdf = Buffer.concat([otherPdfBase, finalPdf.subarray(pdfBase.length)]);
  const transplantedVerification = core.verifySignedCredentialPdf(
    transplantedPdf,
    issuer.didDocument
  );
  assert.equal(transplantedVerification.valid, false);
  assert.equal(transplantedVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);

  const appendedPdf = Buffer.concat([
    finalPdf,
    Buffer.from('\n% appended after signed SSI-PQ manifest\n', 'utf8')
  ]);
  const appendedVerification = core.verifySignedCredentialPdf(appendedPdf, issuer.didDocument);
  assert.equal(appendedVerification.valid, false);
  assert.equal(appendedVerification.errors.includes('MANIFEST_NOT_FINAL_REVISION'), true);

  console.log(`PDF com manifesto gerado em: ${outputPath}`);
});
