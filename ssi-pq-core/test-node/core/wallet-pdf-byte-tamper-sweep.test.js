/**
 * Este teste cria um PDF SSI-PQ válido com credencial embutida e
 * depois altera um byte aleatório em cada bloco de 100 bytes,
 * garantindo que qualquer adulteração binária seja rejeitada pela
 * verificação e gravando um relatório dos blocos testados.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-byte-tamper-sweep.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'byte-tamper-sweep');
fs.mkdirSync(outputDir, { recursive: true });

const BLOCK_SIZE = 100;

function randomDifferentByte(originalByte) {
  const candidate = crypto.randomInt(256);

  if (candidate === originalByte) {
    return (candidate + 1) % 256;
  }

  return candidate;
}

test('PDF SSI-PQ rejeita adulteracao binaria em qualquer bloco de 100 bytes', () => {
  const runId = crypto.randomUUID();
  const senderWallet = path.join(outputDir, `sender-${runId}.db`);
  const senderPassword = 'senha-remetente-byte-sweep-123';
  const recipientWallet = path.join(outputDir, `recipient-${runId}.db`);
  const recipientPassword = 'senha-destinatario-byte-sweep-456';

  console.log('1. Criando Wallets e DIDs do remetente e destinatário...');
  core.walletCreate(senderWallet, senderPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente Byte Sweep',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDid.did);

  core.walletCreate(recipientWallet, recipientPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatário Byte Sweep',
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

  console.log('2. Criando e assinando a credencial...');
  const credentialData = {
    nome: 'Alice Silva',
    curso: 'Criptografia Pós-Quântica',
    nivel: 'Avançado'
  };
  const schema = core.createSchemaFromAttributes(credentialData, {
    version: '1',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const signedCredential = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_byte_tamper_sweep_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'curso', 'nivel']
    }
  );

  console.log('3. Verificando a assinatura da credencial...');
  assert.equal(core.verifySignedCredential(signedCredential, senderDidDocument), true);

  console.log('4. Criando PDF correto com a credencial embutida...');
  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase,
      signedCredential,
      { createdAt: '2026-05-27T00:00:00Z' }
    )
  );

  const validPdfPath = path.join(outputDir, `credencial-valida-${runId}.pdf`);
  fs.writeFileSync(validPdfPath, finalPdf);

  console.log('5. Validando que o PDF original é íntegro...');
  const validVerification = core.verifySignedCredentialPdf(finalPdf, senderDidDocument);
  assert.equal(validVerification.valid, true);
  assert.equal(validVerification.status, 'VALID');

  console.log('6. Adulterando um byte aleatório em cada bloco de 100 bytes...');
  const tamperResults = [];
  const blockCount = Math.ceil(finalPdf.length / BLOCK_SIZE);

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex++) {
    const blockStart = blockIndex * BLOCK_SIZE;
    const blockEnd = Math.min(blockStart + BLOCK_SIZE, finalPdf.length);
    const offset = blockStart + crypto.randomInt(blockEnd - blockStart);
    const tamperedPdf = Buffer.from(finalPdf);
    const originalByte = tamperedPdf[offset];
    const replacementByte = randomDifferentByte(originalByte);

    tamperedPdf[offset] = replacementByte;

    const verification = core.verifySignedCredentialPdf(tamperedPdf, senderDidDocument);

    assert.equal(
      verification.valid,
      false,
      `bloco ${blockIndex} offset ${offset} deveria ser rejeitado`
    );
    assert.notEqual(verification.status, 'VALID');
    assert.equal(verification.errors.length > 0, true);

    tamperResults.push({
      block_index: blockIndex,
      block_start: blockStart,
      block_end_exclusive: blockEnd,
      changed_offset: offset,
      original_byte: originalByte,
      replacement_byte: replacementByte,
      status: verification.status,
      errors: verification.errors
    });
  }

  const reportPath = path.join(outputDir, `byte-tamper-sweep-${runId}.json`);
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        pdf_length: finalPdf.length,
        block_size: BLOCK_SIZE,
        block_count: blockCount,
        tested_blocks: tamperResults.length,
        results: tamperResults
      },
      null,
      2
    )
  );

  assert.equal(tamperResults.length, blockCount);
  assert.equal(fs.existsSync(reportPath), true);
});
