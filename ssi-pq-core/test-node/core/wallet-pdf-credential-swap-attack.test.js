/**
 * Este teste simula um ataque de troca entre o PDF visual e a
 * credencial JSON embutida, criando duas credenciais válidas
 * parecidas, invertendo os manifestos nos PDFs e confirmando que a
 * verificação detecta a divergência entre o conteúdo renderizado
 * e a credencial assinada.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-credential-swap-attack.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'credential-swap-attack');
fs.mkdirSync(outputDir, { recursive: true });

function assertSwapDetected(verification) {
  assert.equal(verification.valid, false);
  assert.equal(verification.status, 'PDF_CREDENTIAL_RENDER_MISMATCH');
  assert.equal(verification.errors.includes('PDF_CREDENTIAL_RENDER_MISMATCH'), true);

  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(verification.manifest_is_final_revision, true);
  assert.equal(verification.did_key_match, true);
}

test('PDF SSI-PQ rejeita troca entre PDF visual e credencial embutida', () => {
  const runId = crypto.randomUUID();
  const senderWallet = path.join(outputDir, `sender-${runId}.db`);
  const senderPassword = 'senha-remetente-swap-123';
  const recipientWallet = path.join(outputDir, `recipient-${runId}.db`);
  const recipientPassword = 'senha-destinatario-swap-456';

  console.log('1. Criando Wallets e DIDs do remetente e destinatário...');
  core.walletCreate(senderWallet, senderPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente Swap',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDid.did);

  core.walletCreate(recipientWallet, recipientPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatário Swap',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDidDocument = core.walletGetDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );
  assert.equal(recipientDidDocument.keys.some((key) => key.id === '#mlkem-1'), true);

  console.log('2. Criando duas credenciais distintas com o mesmo Schema, conteúdo e labels...');
  const credentialData = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    formacao: {
      curso: 'Criptografia Pós-Quântica',
      instituicao: {
        nome: 'SSI-PQ Academy',
        cidade: 'São Paulo'
      }
    },
    nivel: 'Avançado'
  };
  const visiblePaths = [
    'titular.nome',
    'titular.documento.tipo',
    'formacao.curso',
    'formacao.instituicao.nome',
    'nivel'
  ];
  const pdfLabels = {
    formacao: 'Formação',
    'formacao.curso': 'Curso',
    'formacao.instituicao': 'Instituição',
    'formacao.instituicao.nome': 'Nome',
    nivel: 'Nível',
    titular: 'Titular',
    'titular.documento': 'Documento',
    'titular.documento.tipo': 'Tipo',
    'titular.nome': 'Nome'
  };
  const schema = core.createSchemaFromAttributes(credentialData, {
    version: '1',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const signedCredential1 = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_swap_visual_1',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths
    }
  );
  const signedCredential2 = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_swap_visual_2',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths
    }
  );

  assert.equal(core.verifySignedCredential(signedCredential1, senderDidDocument), true);
  assert.equal(core.verifySignedCredential(signedCredential2, senderDidDocument), true);
  assert.notDeepEqual(signedCredential1, signedCredential2);

  console.log('3. Criando PDFs visuais a partir das credenciais corretas...');
  const pdfBase1 = Buffer.from(
    core.signedCredentialToPdf(signedCredential1, { labels: pdfLabels })
  );
  const pdfBase2 = Buffer.from(
    core.signedCredentialToPdf(signedCredential2, { labels: pdfLabels })
  );
  assert.notDeepEqual(pdfBase1, pdfBase2);

  const validPdf1 = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase1,
      signedCredential1,
      { createdAt: '2026-05-27T00:00:00Z' }
    )
  );
  const validPdf2 = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase2,
      signedCredential2,
      { createdAt: '2026-05-27T00:00:00Z' }
    )
  );
  assert.equal(core.verifySignedCredentialPdf(validPdf1, senderDidDocument).valid, true);
  assert.equal(core.verifySignedCredentialPdf(validPdf2, senderDidDocument).valid, true);

  console.log('4. Embutindo a credencial invertida em cada PDF visual...');
  const swappedPdf1 = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase1,
      signedCredential2,
      { createdAt: '2026-05-27T00:00:00Z' }
    )
  );
  const swappedPdf2 = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase2,
      signedCredential1,
      { createdAt: '2026-05-27T00:00:00Z' }
    )
  );

  fs.writeFileSync(path.join(outputDir, `swap-pdf1-com-cred2-${runId}.pdf`), swappedPdf1);
  fs.writeFileSync(path.join(outputDir, `swap-pdf2-com-cred1-${runId}.pdf`), swappedPdf2);

  console.log('5. Verificando que a troca é denunciada pela verificação do PDF...');
  const swappedVerification1 = core.verifySignedCredentialPdf(swappedPdf1, senderDidDocument);
  const swappedVerification2 = core.verifySignedCredentialPdf(swappedPdf2, senderDidDocument);

  assertSwapDetected(swappedVerification1);
  assertSwapDetected(swappedVerification2);
});
