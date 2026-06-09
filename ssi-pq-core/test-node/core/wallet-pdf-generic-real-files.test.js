/**
 * Este teste assina e verifica PDFs reais presentes em
 * `test-output/pdf_tests`, cobrindo assinatura invisível,
 * assinatura visual no rodapé e assinatura visual na margem
 * direita para todos os arquivos, preservação do PDF base,
 * estrutura incremental correta, extração de manifesto e
 * rejeição de adulterações ou revisões posteriores não
 * autorizadas.
 *
 * Comando isolado para rodar:
 *   npm run test:real-pdfs
 *
 * Ou, depois do build:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-generic-real-files.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const testOutputDir = path.join(__dirname, '..', '..', 'test-output');
const realPdfInputDir = path.join(testOutputDir, 'pdf_tests');
const signedPdfOutputDir = path.join(testOutputDir, 'pdf-real-signatures');

fs.mkdirSync(signedPdfOutputDir, { recursive: true });

function listPdfFiles(inputDir) {
  return fs
    .readdirSync(inputDir)
    .filter((fileName) => fileName.toLowerCase().endsWith('.pdf'))
    .map((fileName) => path.join(inputDir, fileName))
    .sort();
}

function assertHasPdfSignatureStructure(pdfBytes, label) {
  const pdfText = pdfBytes.toString('latin1');

  assert.equal(pdfText.includes('/Type /Sig'), true, `${label}: campo /Sig ausente`);
  assert.equal(pdfText.includes('/ByteRange ['), true, `${label}: /ByteRange ausente`);
  assert.equal(pdfText.includes('/Contents <'), true, `${label}: /Contents ausente`);
  assert.equal(pdfText.includes('/AcroForm'), true, `${label}: /AcroForm ausente`);
  assert.equal(pdfText.includes('/EmbeddedFiles'), true, `${label}: manifesto nao anexado ao catalogo`);
}

function pdfTrailerSizes(pdfBytes) {
  return [...pdfBytes.toString('latin1').matchAll(/\/Size\s+(\d+)/g)].map((match) => Number(match[1]));
}

function signatureWidgetObject(pdfBytes, label) {
  const pdfText = pdfBytes.toString('latin1');
  const match = pdfText.match(/<< \/Type \/Annot[\s\S]*?\/T \(SSI-PQ Generic Signature\)[\s\S]*?endobj/);
  assert.notEqual(match, null, `${label}: widget de assinatura nao encontrado`);
  return match[0];
}

function signatureWidgetRect(pdfBytes, label) {
  const widget = signatureWidgetObject(pdfBytes, label);
  const match = widget.match(/\/Rect \[([^\]]+)\]/);
  assert.notEqual(match, null, `${label}: /Rect do widget nao encontrado`);
  return match[1].split(/\s+/).map(Number);
}

function assertInvisibleSignature(pdfBytes, label) {
  const widget = signatureWidgetObject(pdfBytes, label);
  assert.equal(widget.includes('/Rect [0 0 0 0]'), true, `${label}: assinatura deveria ser invisivel`);
  assert.equal(widget.includes('/AP << /N'), false, `${label}: assinatura invisivel nao deve ter appearance`);
}

function assertVisibleSignature(pdfBytes, label, placement) {
  const pdfText = pdfBytes.toString('latin1');
  const widget = signatureWidgetObject(pdfBytes, label);
  const rect = signatureWidgetRect(pdfBytes, label);
  const width = rect[2] - rect[0];
  const height = rect[3] - rect[1];

  assert.equal(widget.includes('/AP << /N'), true, `${label}: assinatura visivel precisa de appearance`);
  assert.equal(pdfText.includes('Documento assinado digitalmente'), true, `${label}: texto visual ausente`);
  assert.equal(pdfText.includes('/ExtGState'), true, `${label}: transparencia visual ausente`);
  assert.equal(pdfText.includes('/ca 0.62 /CA 0.62'), true, `${label}: opacidade visual inesperada`);

  if (placement === 'firstPageFooter') {
    assert.equal(
      Math.max(width, height) > Math.min(width, height) * 4,
      true,
      `${label}: rodape deve ser retangulo estreito`
    );
    assert.equal(pdfText.includes('SSI-PQ / ML-DSA'), true, `${label}: texto de rodape inesperado`);
  } else {
    assert.equal(
      Math.max(width, height) > Math.min(width, height) * 4,
      true,
      `${label}: margem direita deve ser retangulo estreito`
    );
    assert.equal(
      pdfText.includes('Documento assinado digitalmente SSI-PQ / SSI'),
      true,
      `${label}: texto vertical da margem direita ausente`
    );
    assert.match(
      pdfText,
      /(?:-?\d+(?:\.\d+)?\s+){6}Tm\n\(Documento assinado digitalmente SSI-PQ \/ SSI\) Tj/,
      `${label}: texto da margem direita deve ter matriz de desenho`
    );
  }
}

test('Assinatura Genérica de PDF assina e verifica PDFs reais de test-output/pdf_tests', () => {
  const inputPdfPaths = listPdfFiles(realPdfInputDir);
  assert.equal(inputPdfPaths.length > 0, true, 'nenhum PDF real encontrado em test-output/pdf_tests');

  const runId = crypto.randomUUID();
  const walletPath = path.join(signedPdfOutputDir, `real-pdf-sign-wallet-${runId}.db`);
  const password = 'senha forte para pdf real 123';
  const createdAt = '2026-05-28T00:00:00Z';

  core.walletCreate(walletPath, password, { createdAt });
  const didResult = core.walletCreateDid(walletPath, password, {
    label: 'Assinante de PDFs Reais',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const didDocument = core.walletGetDidDocument(walletPath, password, didResult.did);

  for (const inputPdfPath of inputPdfPaths) {
    const inputLabel = path.relative(testOutputDir, inputPdfPath);
    const pdfBase = fs.readFileSync(inputPdfPath);

    assert.equal(pdfBase.subarray(0, 5).toString('latin1'), '%PDF-', `${inputLabel}: header PDF invalido`);

    const allSignatureModes = [
      { suffix: 'invisible', options: { createdAt }, assertVisual: assertInvisibleSignature },
      {
        suffix: 'footer-visible',
        options: { createdAt, visualSignature: { mode: 'visible', placement: 'firstPageFooter' } },
        assertVisual: (signedPdf, label) => assertVisibleSignature(signedPdf, label, 'firstPageFooter')
      },
      {
        suffix: 'right-margin-visible',
        options: { createdAt, visualSignature: { mode: 'visible', placement: 'firstPageRightMargin' } },
        assertVisual: (signedPdf, label) => assertVisibleSignature(signedPdf, label, 'firstPageRightMargin')
      }
    ];
    for (const mode of allSignatureModes) {
      const signedPdf = Buffer.from(
        core.walletSignGenericPdf(walletPath, password, didResult.did, pdfBase, mode.options)
      );
      const outputBaseName = `${path.basename(inputPdfPath, '.pdf')}-${mode.suffix}-${runId}`;
      const signedPdfPath = path.join(signedPdfOutputDir, `${outputBaseName}.signed.pdf`);
      const manifestPath = path.join(signedPdfOutputDir, `${outputBaseName}.manifest.json`);

      fs.writeFileSync(signedPdfPath, signedPdf);
      assert.equal(fs.existsSync(signedPdfPath), true);

      const modeLabel = `${inputLabel} (${mode.suffix})`;
      assert.equal(signedPdf.length > pdfBase.length, true, `${modeLabel}: PDF assinado nao cresceu`);
      assert.deepEqual(signedPdf.subarray(0, pdfBase.length), pdfBase, `${modeLabel}: PDF-base foi alterado`);
      assertHasPdfSignatureStructure(signedPdf, modeLabel);
      mode.assertVisual(signedPdf, modeLabel);

      const originalMaxSize = Math.max(...pdfTrailerSizes(pdfBase));
      const signedTrailerSizes = pdfTrailerSizes(signedPdf);
      const signedFinalSize = signedTrailerSizes[signedTrailerSizes.length - 1];
      assert.equal(
        signedFinalSize >= originalMaxSize + 5,
        true,
        `${modeLabel}: /Size final nao pode colidir com objetos existentes`
      );

      const verification = core.verifySignedGenericPdf(signedPdf, didDocument);
      assert.equal(verification.valid, true, `${modeLabel}: assinatura deveria ser valida`);
      assert.equal(verification.status, 'VALID');
      assert.equal(verification.pdf_base_hash_valid, true);
      assert.equal(verification.signature_valid, true);
      assert.equal(verification.manifest_is_final_revision, true);
      assert.equal(verification.did_key_match, true);

      const extractedManifest = core.extractGenericSignatureManifestFromPdf(signedPdf);
      fs.writeFileSync(manifestPath, JSON.stringify(extractedManifest, null, 2));

      assert.equal(extractedManifest.type, 'ssi_generic_pdf_signature_v1');
      assert.equal(extractedManifest.signer_did, didResult.did);
      assert.equal(extractedManifest.created_at, createdAt);
      assert.equal(extractedManifest.pdf_base_length, pdfBase.length);
      assert.equal(extractedManifest.signature.alg, 'ML-DSA-65');
      assert.equal(extractedManifest.signature.key_id, '#mldsa-1');
      assert.equal(extractedManifest.signature.byte_range_hash_alg, 'SHA3-256');
      assert.equal(extractedManifest.signature.manifest_hash_alg, 'SHA3-256');

      if (mode.suffix === 'invisible') {
        const tamperedBasePdf = Buffer.from(signedPdf);
        tamperedBasePdf[Math.min(64, pdfBase.length - 1)] ^= 1;
        const tamperedBaseVerification = core.verifySignedGenericPdf(tamperedBasePdf, didDocument);
        assert.equal(tamperedBaseVerification.valid, false, `${modeLabel}: PDF-base adulterado deveria falhar`);
        assert.equal(tamperedBaseVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);
        assert.equal(tamperedBaseVerification.errors.includes('INVALID_SIGNATURE'), true);

        const appendedPdf = Buffer.concat([signedPdf, Buffer.from('\n% unauthorized revision after signature\n')]);
        const appendedVerification = core.verifySignedGenericPdf(appendedPdf, didDocument);
        assert.equal(appendedVerification.valid, false, `${modeLabel}: revisao posterior deveria falhar`);
        assert.equal(appendedVerification.signature_valid, true);
        assert.equal(appendedVerification.errors.includes('MANIFEST_NOT_FINAL_REVISION'), true);
      }
    }
  }
});
