/**
 * Este teste manual analisa um PDF SSI-PQ existente e seu DID
 * Document público, extraindo o manifesto embutido, executando a
 * verificação criptográfica e gravando um relatório JSON em
 * `test-output/pdf-analysis` ou no caminho informado pelo usuário.
 *
 * Comando para rodar com caminhos padrão:
 *   npm run build && \
 *   node --test test-node/manual/verify-pdf-file.test.js
 *
 * Comando para informar arquivos:
 *   npm run build && \
 *   node --test test-node/manual/verify-pdf-file.test.js \
 *     caminho/credencial.pdf caminho/did-document.json
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

function defaultPdfPath() {
  return path.join(
    __dirname,
    '..',
    '..',
    'test-output',
    'pdf',
    'ssi-pq-credential-with-manifest.pdf'
  );
}

function defaultDidDocumentPath(pdfPath) {
  return pdfPath.replace(/\.pdf$/i, '.did-document.json');
}

function defaultOutputPath(pdfPath) {
  const outputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf-analysis');
  const baseName = path.basename(pdfPath).replace(/\.pdf$/i, '');

  return path.join(outputDir, `${baseName}.manifest.txt`);
}

function inputPaths() {
  const pdfPath = process.env.SSI_PQ_PDF_PATH || process.argv[2] || defaultPdfPath();
  const didDocumentPath =
    process.env.SSI_PQ_DID_DOCUMENT_PATH ||
    process.argv[3] ||
    defaultDidDocumentPath(pdfPath);
  const outputPath =
    process.env.SSI_PQ_EXTRACTED_JSON_PATH || process.argv[4] || defaultOutputPath(pdfPath);

  return {
    pdfPath: path.resolve(pdfPath),
    didDocumentPath: path.resolve(didDocumentPath),
    outputPath: path.resolve(outputPath)
  };
}

function writeReport(outputPath, payload) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));
}

test('manual PDF credential verification and manifest extraction', (context) => {
  const { pdfPath, didDocumentPath, outputPath } = inputPaths();

  if (!fs.existsSync(pdfPath) || !fs.existsSync(didDocumentPath)) {
    context.skip(
      [
        'Informe um PDF e um DID Document para analisar.',
        `PDF esperado: ${pdfPath}`,
        `DID Document esperado: ${didDocumentPath}`,
        'Exemplo:',
        'node test-node/manual/verify-pdf-file.test.js test-output/pdf/ssi-pq-credential-with-manifest.pdf test-output/pdf/ssi-pq-credential-with-manifest.did-document.json'
      ].join('\n')
    );
    return;
  }

  const pdfBytes = fs.readFileSync(pdfPath);
  const didDocument = JSON.parse(fs.readFileSync(didDocumentPath, 'utf8'));
  let manifest = null;
  let manifestExtractionError = null;

  try {
    manifest = core.extractCredentialManifestFromPdf(pdfBytes);
  } catch (error) {
    manifestExtractionError = error.message;
  }

  const verification = core.verifySignedCredentialPdf(pdfBytes, didDocument);
  const report = {
    analyzed_at: new Date().toISOString(),
    pdf_path: pdfPath,
    did_document_path: didDocumentPath,
    valid: verification.valid,
    status: verification.status,
    checks: {
      pdf_base_hash_valid: verification.pdf_base_hash_valid,
      credential_signature_valid: verification.credential_signature_valid,
      document_binding_signature_valid: verification.document_binding_signature_valid,
      manifest_is_final_revision: verification.manifest_is_final_revision,
      did_key_match: verification.did_key_match
    },
    errors: verification.errors,
    manifest_extraction_error: manifestExtractionError,
    extracted_manifest: manifest
  };

  writeReport(outputPath, report);

  console.log(
    JSON.stringify(
      {
        pdf: pdfPath,
        didDocument: didDocumentPath,
        extractedJsonTxt: outputPath,
        valid: verification.valid,
        status: verification.status,
        errors: verification.errors,
        checks: report.checks
      },
      null,
      2
    )
  );

  assert.equal(typeof verification.valid, 'boolean');
  assert.equal(typeof verification.status, 'string');
});
