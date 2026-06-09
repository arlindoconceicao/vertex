/**
 * Este teste executa o fluxo básico de credencial em PDF com
 * wallet: cria wallet e DID, gera schema, emite uma credencial
 * assinada, exporta o DID Document, embute a credencial no PDF,
 * verifica o PDF assinado e extrai o manifesto JSON para inspeção.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-flow.test.js
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

test('Fluxo completo: Wallet, Emissão, PDF, Verificação e Extração', () => {
  const walletPath = path.join(walletOutputDir, `flow-wallet-${crypto.randomUUID()}.db`);
  const password = 'senha super forte 123';

  // ==========================================
  // 1. Cria a Wallet e o DID nela
  // ==========================================
  core.walletCreate(walletPath, password);
  const didResult = core.walletCreateDid(walletPath, password, {
    label: 'Emissor PDF Flow',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768'
  });
  
  assert.equal(didResult.did.startsWith('did:ssipq:z'), true);

  // ==========================================
  // 2. Crie o Schema
  // ==========================================
  const schema = core.createSchemaFromAttributes(
    { nome: 'Carlos Souza', profissao: 'Desenvolvedor', nivel: 'Sênior' },
    { version: '1' }
  );

  // ==========================================
  // 3. Transforme o Schema em uma credencial assinada (usando a Wallet)
  // ==========================================
  const signedCredential = core.walletIssueCredentialFromSchema(
    walletPath,
    password,
    didResult.did,
    schema,
    { nome: 'Carlos Souza', profissao: 'Desenvolvedor', nivel: 'Sênior' },
    { visiblePaths: ['nome', 'profissao'] }
  );

  // ==========================================
  // 4. Exporte a chave publica do DID num arquivo JSON
  // ==========================================
  const exportedDidDocument = core.walletGetDidDocument(walletPath, password, didResult.did);
  const didDocumentPath = path.join(pdfOutputDir, 'wallet-flow-did-document.json');
  
  fs.writeFileSync(didDocumentPath, JSON.stringify(exportedDidDocument, null, 2));
  assert.equal(fs.existsSync(didDocumentPath), true);

  // ==========================================
  // 5. Crie o PDF para a credencial assinada e coloque a credencial dentro
  // ==========================================
  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      walletPath,
      password,
      didResult.did,
      pdfBase,
      signedCredential
    )
  );
  
  const pdfPath = path.join(pdfOutputDir, 'wallet-flow-credential.pdf');
  fs.writeFileSync(pdfPath, finalPdf);
  assert.equal(fs.existsSync(pdfPath), true);

  // ==========================================
  // 6. Verifique a credencial (PDF) usando a chave pública exportada
  // ==========================================
  const diskPdfBytes = fs.readFileSync(pdfPath);
  const diskDidDocument = JSON.parse(fs.readFileSync(didDocumentPath, 'utf8'));
  
  const verification = core.verifySignedCredentialPdf(diskPdfBytes, diskDidDocument);
  
  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);

  // ==========================================
  // 7. Extraia a credencial do PDF gerando um arquivo JSON
  // ==========================================
  const extractedManifest = core.extractCredentialManifestFromPdf(diskPdfBytes);
  const manifestPath = path.join(pdfOutputDir, 'wallet-flow-extracted-manifest.json');
  
  fs.writeFileSync(manifestPath, JSON.stringify(extractedManifest, null, 2));
  assert.equal(fs.existsSync(manifestPath), true);

  // ==========================================
  // 8. Verifique criptograficamente a credencial extraída
  // ==========================================
  const extractedCredential = extractedManifest.signed_credential;
  const isExtractedCredentialValid = core.verifySignedCredential(extractedCredential, diskDidDocument);
  assert.equal(isExtractedCredentialValid, true);
});
