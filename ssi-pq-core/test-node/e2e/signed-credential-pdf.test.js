/**
 * Este teste verifica a geração de um PDF visual a partir de uma
 * credencial assinada, conferindo cabeçalho PDF, textos principais,
 * atributos revelados, ocultação de atributo não revelado e
 * gravação do arquivo em `test-output/pdf` para inspeção manual.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/e2e/signed-credential-pdf.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

function winAnsiHex(text) {
  return [...text]
    .map((char) => {
      const codePoint = char.codePointAt(0);

      if (codePoint >= 0x20 && codePoint <= 0x7e) {
        return codePoint;
      }
      if (codePoint >= 0xa0 && codePoint <= 0xff) {
        return codePoint;
      }
      return 0x3f;
    })
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

test('signedCredentialToPdf renders a simple visual credential PDF', () => {
  const issuer = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const schema = core.createSchemaFromAttributes(
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      carga_horaria: 40,
      nivel: 'Avançado'
    },
    {
      version: '1',
      createdAt: '2026-05-27T00:00:00Z'
    }
  );
  const signedCredential = core.issueCredentialFromSchema(
    schema,
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      carga_horaria: 40,
      nivel: 'Avançado'
    },
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_pdf_node_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'curso', 'carga_horaria']
    }
  );

  assert.equal(core.verifySignedCredential(signedCredential, issuer.didDocument), true);

  const pdf = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const pdfText = pdf.toString('latin1');
  const outputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf');
  const outputPath = path.join(outputDir, 'ssi-pq-credential-test.pdf');

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, pdf);

  assert.equal(pdf.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  assert.equal(pdfText.includes(winAnsiHex('Credencial SSI-PQ')), true);
  assert.equal(pdfText.includes(winAnsiHex('cred_pdf_node_test')), true);
  assert.equal(pdfText.includes(winAnsiHex(core.schemaHashBase64(schema))), true);
  assert.equal(pdfText.includes(winAnsiHex(core.issuerIdentifierBase64(issuer.didDocument))), true);
  assert.equal(pdfText.includes(winAnsiHex('sem expiração')), true);
  assert.equal(pdfText.includes(winAnsiHex('Atributos visíveis')), true);
  assert.equal(pdfText.includes(winAnsiHex('Assinatura criptográfica')), true);
  assert.equal(pdfText.includes(winAnsiHex('chave pública')), true);
  assert.equal(pdfText.includes(winAnsiHex('Ana Silva')), true);
  assert.equal(pdfText.includes(winAnsiHex('Criptografia Aplicada')), true);
  assert.equal(pdfText.includes(winAnsiHex('Carga Horária: 40')), true);
  assert.equal(pdfText.includes(winAnsiHex('Nível: Avançado')), false);

  console.log(`PDF gerado em: ${outputPath}`);
});
