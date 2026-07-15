/**
 * Este teste cobre o fluxo de assinatura genérica de PDF com
 * wallet, assinando um PDF base, conferindo a estrutura de
 * assinatura e manifesto embutidos, verificando o documento com o
 * DID correto, extraindo o manifesto e garantindo rejeição de PDF
 * base alterado, revisão incremental posterior, manifesto
 * corrompido, DID incorreto e entrada que não é PDF.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-generic-signature-flow.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const walletOutputDir = path.join(__dirname, '..', '..', 'test-output', 'wallet');
const pdfOutputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf');

fs.mkdirSync(walletOutputDir, { recursive: true });
fs.mkdirSync(pdfOutputDir, { recursive: true });

test('Fluxo completo Assinatura Genérica de PDF: Wallet, Assinatura, Verificação e Extração', () => {
  const runId = crypto.randomUUID();
  const walletPath = path.join(walletOutputDir, `generic-sign-wallet-${runId}.db`);
  const password = 'senha super forte 123';
  const createdAt = '2026-05-28T00:00:00Z';

  // ==========================================
  // 1. Cria a Wallet e o DID do assinante nela
  // ==========================================
  core.walletCreate(walletPath, password, { createdAt });
  const didResult = core.walletCreateDid(walletPath, password, {
    label: 'Assinante de Documento Genérico',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const otherDidResult = core.walletCreateDid(walletPath, password, {
    label: 'Assinante Incorreto',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  
  assert.equal(didResult.did.startsWith('did:ssipq:z'), true);

  // ==========================================
  // 2. Exporte a chave pública do DID num arquivo JSON
  // ==========================================
  const exportedDidDocument = core.walletGetDidDocument(walletPath, password, didResult.did);
  const otherDidDocument = core.walletGetDidDocument(walletPath, password, otherDidResult.did);
  const didDocumentPath = path.join(pdfOutputDir, `wallet-generic-sign-did-document-${runId}.json`);
  
  fs.writeFileSync(didDocumentPath, JSON.stringify(exportedDidDocument, null, 2));
  assert.equal(fs.existsSync(didDocumentPath), true);

  // ==========================================
  // 3. Crie ou carregue um PDF Genérico base (simulando um contrato/relatório)
  // ==========================================
  const dummyPdfBase = Buffer.from(
    '%PDF-1.4\n%ABCD\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
    'xref\n0 4\n' +
    '0000000000 65535 f \n' +
    '0000000015 00000 n \n' +
    '0000000064 00000 n \n' +
    '0000000121 00000 n \n' +
    'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
    'startxref\n192\n' +
    '%%EOF\n'
  );

  // ==========================================
  // 4. Assine o PDF usando a chave protegida na Wallet
  // ==========================================
  const finalPdf = Buffer.from(
    core.walletSignGenericPdf(walletPath, password, didResult.did, dummyPdfBase, { createdAt })
  );
  
  const pdfPath = path.join(pdfOutputDir, `wallet-generic-signed-document-${runId}.pdf`);
  fs.writeFileSync(pdfPath, finalPdf);
  assert.equal(fs.existsSync(pdfPath), true);
  assert.equal(finalPdf.length > dummyPdfBase.length, true);
  assert.deepEqual(finalPdf.subarray(0, dummyPdfBase.length), dummyPdfBase);

  const finalPdfText = finalPdf.toString('latin1');
  assert.equal(finalPdfText.includes('/Type /Sig'), true);
  assert.equal(finalPdfText.includes('/ByteRange ['), true);
  assert.equal(finalPdfText.includes('/Contents <'), true);
  assert.equal(finalPdfText.includes('/AcroForm'), true);
  assert.equal(finalPdfText.includes('/EmbeddedFiles'), true);

  // ==========================================
  // 5. Verifique o PDF assinado usando a chave pública exportada
  // ==========================================
  const diskPdfBytes = fs.readFileSync(pdfPath);
  const diskDidDocument = JSON.parse(fs.readFileSync(didDocumentPath, 'utf8'));
  
  const verification = core.verifySignedGenericPdf(diskPdfBytes, diskDidDocument);
  
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.signature_valid, true);
  assert.equal(verification.manifest_is_final_revision, true);
  assert.equal(verification.did_key_match, true);
  assert.equal(verification.status, 'VALID');

  // ==========================================
  // 6. Extraia a assinatura embutida no PDF gerando um arquivo JSON para inspeção
  // ==========================================
  const extractedManifest = core.extractGenericSignatureManifestFromPdf(diskPdfBytes);
  const manifestPath = path.join(pdfOutputDir, `wallet-generic-extracted-signature-${runId}.json`);
  
  fs.writeFileSync(manifestPath, JSON.stringify(extractedManifest, null, 2));
  assert.equal(fs.existsSync(manifestPath), true);

  // Validações no objeto JSON extraído
  assert.equal(extractedManifest.type, 'ssi_generic_pdf_signature_v1');
  assert.equal(extractedManifest.signer_did, didResult.did);
  assert.equal(extractedManifest.created_at, createdAt);
  assert.equal(extractedManifest.pdf_base_length, dummyPdfBase.length);
  assert.equal(extractedManifest.signature.alg, 'ML-DSA-65');
  assert.equal(extractedManifest.signature.key_id, '#mldsa-1');
  assert.equal(extractedManifest.signature.byte_range_hash_alg, 'SHA3-256');
  assert.equal(extractedManifest.signature.manifest_hash_alg, 'SHA3-256');
  assert.equal(typeof extractedManifest.signature.byte_range_hash, 'string');
  assert.equal(typeof extractedManifest.signature.manifest_hash, 'string');
  assert.equal(typeof extractedManifest.signature.signature, 'string');

  // ==========================================
  // 7. Rejeite adulterações e verificações com DID incorreto
  // ==========================================
  const tamperedBasePdf = Buffer.from(finalPdf);
  tamperedBasePdf[20] ^= 1;
  const tamperedBaseVerification = core.verifySignedGenericPdf(tamperedBasePdf, diskDidDocument);
  assert.equal(tamperedBaseVerification.valid, false);
  assert.equal(tamperedBaseVerification.errors.includes('PDF_BASE_HASH_MISMATCH'), true);
  assert.equal(tamperedBaseVerification.errors.includes('INVALID_SIGNATURE'), true);

  const appendedPdf = Buffer.concat([finalPdf, Buffer.from('\n% incremental update after signature\n')]);
  const appendedVerification = core.verifySignedGenericPdf(appendedPdf, diskDidDocument);
  assert.equal(appendedVerification.valid, false);
  assert.equal(appendedVerification.signature_valid, true);
  assert.equal(appendedVerification.errors.includes('MANIFEST_NOT_FINAL_REVISION'), true);

  const tamperedManifestPdf = Buffer.from(finalPdf);
  const manifestTypeOffset = tamperedManifestPdf.indexOf(Buffer.from('ssi_generic_pdf_signature_v1'));
  assert.notEqual(manifestTypeOffset, -1);
  tamperedManifestPdf[manifestTypeOffset] = 'x'.charCodeAt(0);
  const tamperedManifestVerification = core.verifySignedGenericPdf(tamperedManifestPdf, diskDidDocument);
  assert.equal(tamperedManifestVerification.valid, false);
  assert.equal(tamperedManifestVerification.errors.includes('MALFORMED_MANIFEST'), true);
  assert.equal(tamperedManifestVerification.errors.includes('INVALID_SIGNATURE'), true);

  const wrongDidVerification = core.verifySignedGenericPdf(finalPdf, otherDidDocument);
  assert.equal(wrongDidVerification.valid, false);
  assert.equal(wrongDidVerification.errors.includes('DID_KEY_MISMATCH'), true);
  assert.equal(wrongDidVerification.errors.includes('INVALID_SIGNATURE'), true);

  assert.throws(
    () => core.walletSignGenericPdf(walletPath, password, didResult.did, Buffer.from('not a pdf'), { createdAt }),
    /PDF base must start with a PDF header/
  );
});
