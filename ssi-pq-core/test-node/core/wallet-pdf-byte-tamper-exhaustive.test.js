/**
 * Este teste faz uma varredura exaustiva opcional de adulteração
 * byte a byte em um PDF SSI-PQ com credencial embutida, podendo
 * limitar a quantidade de bytes ou paralelizar com workers, e falha
 * se qualquer alteração passar despercebida pela verificação.
 *
 * Comando para rodar a varredura completa:
 *   npm run build && \
 *   env \
 *     SSI_PQ_RUN_EXHAUSTIVE_PDF_TAMPER=1 node --test test-node/core/wallet-pdf-byte-tamper-exhaustive.test.js
 *
 * Execução curta:
 *   npm run build && \
 *   env \
 *     SSI_PQ_RUN_EXHAUSTIVE_PDF_TAMPER=1 SSI_PQ_EXHAUSTIVE_TAMPER_MAX_BYTES=500 node --test test-node/core/wallet-pdf-byte-tamper-exhaustive.test.js
 *
 * Execução paralela:
 *   npm run build && \
 *   env \
 *     SSI_PQ_RUN_EXHAUSTIVE_PDF_TAMPER=1 SSI_PQ_EXHAUSTIVE_TAMPER_THREADS=10 node --test test-node/core/wallet-pdf-byte-tamper-exhaustive.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'byte-tamper-exhaustive');
fs.mkdirSync(outputDir, { recursive: true });

function parseOptionalPositiveInteger(envName) {
  const rawValue = process.env[envName];

  if (rawValue === undefined || rawValue === '') {
    return undefined;
  }

  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${envName} must be a positive integer`);
  }

  return value;
}

function randomDifferentByte(originalByte) {
  const candidate = crypto.randomInt(256);

  if (candidate === originalByte) {
    return (candidate + 1) % 256;
  }

  return candidate;
}

function createOffsetRanges(byteCount, threadCount) {
  const rangeCount = Math.min(threadCount, byteCount);
  const baseRangeSize = Math.floor(byteCount / rangeCount);
  const extraOffsets = byteCount % rangeCount;
  const ranges = [];
  let startOffset = 0;

  for (let workerIndex = 0; workerIndex < rangeCount; workerIndex++) {
    const rangeSize = baseRangeSize + (workerIndex < extraOffsets ? 1 : 0);
    const endOffset = startOffset + rangeSize;

    ranges.push({
      workerIndex,
      startOffset,
      endOffset
    });
    startOffset = endOffset;
  }

  return ranges;
}

function mergeErrorCounts(target, source) {
  for (const [error, count] of Object.entries(source)) {
    target[error] = (target[error] ?? 0) + count;
  }
}

function runTamperRange({
  pdfBytes,
  didDocument,
  startOffset,
  endOffset,
  workerIndex,
  progressEvery
}) {
  const finalPdf = Buffer.from(pdfBytes);
  const tamperResults = [];
  const errorCounts = {};
  const total = endOffset - startOffset;
  let processed = 0;

  for (let offset = startOffset; offset < endOffset; offset++) {
    const tamperedPdf = Buffer.from(finalPdf);
    const originalByte = tamperedPdf[offset];
    const replacementByte = randomDifferentByte(originalByte);

    tamperedPdf[offset] = replacementByte;

    const verification = core.verifySignedCredentialPdf(tamperedPdf, didDocument);

    const unexpectedlyValid = verification.valid || verification.status === 'VALID' || verification.errors.length === 0;

    for (const error of verification.errors) {
      errorCounts[error] = (errorCounts[error] ?? 0) + 1;
    }

    tamperResults.push({
      byte_position: offset + 1,
      offset,
      original_byte: originalByte,
      replacement_byte: replacementByte,
      status: verification.status,
      errors: verification.errors,
      unexpectedly_valid: unexpectedlyValid
    });

    processed += 1;

    if (
      parentPort &&
      progressEvery > 0 &&
      (processed % progressEvery === 0 || processed === total)
    ) {
      parentPort.postMessage({
        type: 'progress',
        worker_index: workerIndex,
        processed,
        total
      });
    }
  }

  return {
    worker_index: workerIndex,
    start_offset: startOffset,
    end_offset_exclusive: endOffset,
    tested_bytes: tamperResults.length,
    error_counts: errorCounts,
    results: tamperResults
  };
}

function runTamperWorker() {
  try {
    const result = runTamperRange(workerData);
    parentPort.postMessage({ type: 'result', result });
  } catch (error) {
    parentPort.postMessage({
      type: 'failure',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
}

function runWorkerRange(range, pdfBytes, didDocument) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, {
      workerData: {
        pdfBytes,
        didDocument,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        workerIndex: range.workerIndex,
        progressEvery: 1000
      }
    });
    let settled = false;

    worker.on('message', (message) => {
      if (message.type === 'progress') {
        console.log(
          `   worker ${message.worker_index + 1}: ${message.processed}/${message.total} bytes testados...`
        );
        return;
      }

      if (message.type === 'result') {
        settled = true;
        resolve(message.result);
        return;
      }

      if (message.type === 'failure') {
        settled = true;
        const error = new Error(message.error.message);
        error.stack = message.error.stack;
        reject(error);
      }
    });

    worker.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });

    worker.on('exit', (code) => {
      if (!settled && code !== 0) {
        settled = true;
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

async function runTamperRangesInParallel(pdfBytes, didDocument, byteCount, threadCount) {
  const ranges = createOffsetRanges(byteCount, threadCount);
  const workerResults = await Promise.all(
    ranges.map((range) => runWorkerRange(range, pdfBytes, didDocument))
  );
  const tamperResults = workerResults
    .flatMap((workerResult) => workerResult.results)
    .sort((a, b) => a.offset - b.offset);
  const errorCounts = {};

  for (const workerResult of workerResults) {
    mergeErrorCounts(errorCounts, workerResult.error_counts);
  }

  return {
    thread_count: ranges.length,
    worker_summaries: workerResults
      .map((workerResult) => ({
        worker_index: workerResult.worker_index,
        start_offset: workerResult.start_offset,
        end_offset_exclusive: workerResult.end_offset_exclusive,
        tested_bytes: workerResult.tested_bytes
      }))
      .sort((a, b) => a.worker_index - b.worker_index),
    error_counts: errorCounts,
    results: tamperResults
  };
}

if (!isMainThread) {
  runTamperWorker();
} else {
  const shouldRunExhaustive = process.env.SSI_PQ_RUN_EXHAUSTIVE_PDF_TAMPER === '1';
  const maxBytes = parseOptionalPositiveInteger('SSI_PQ_EXHAUSTIVE_TAMPER_MAX_BYTES');
  const requestedThreadCount =
    parseOptionalPositiveInteger('SSI_PQ_EXHAUSTIVE_TAMPER_THREADS') ?? 1;
  const exhaustiveTest = shouldRunExhaustive ? test : test.skip;

  exhaustiveTest('PDF SSI-PQ rejeita adulteracao binaria byte a byte', async () => {
    const runId = crypto.randomUUID();
    const senderWallet = path.join(outputDir, `sender-${runId}.db`);
    const senderPassword = 'senha-remetente-byte-exhaustive-123';
    const recipientWallet = path.join(outputDir, `recipient-${runId}.db`);
    const recipientPassword = 'senha-destinatario-byte-exhaustive-456';

    console.log('1. Criando Wallets e DIDs do remetente e destinatário...');
    core.walletCreate(senderWallet, senderPassword, {
      createdAt: '2026-05-27T00:00:00Z'
    });
    const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
      label: 'Remetente Byte Exhaustive',
      mldsa: 'ML-DSA-65',
      mlkem: 'ML-KEM-768',
      createdAt: '2026-05-27T00:00:00Z'
    });
    const senderDidDocument = core.walletGetDidDocument(
      senderWallet,
      senderPassword,
      senderDid.did
    );

    core.walletCreate(recipientWallet, recipientPassword, {
      createdAt: '2026-05-27T00:00:00Z'
    });
    const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
      label: 'Destinatário Byte Exhaustive',
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
        credentialId: 'cred_byte_tamper_exhaustive_test',
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

    const byteCount = Math.min(finalPdf.length, maxBytes ?? finalPdf.length);
    const threadCount = Math.min(requestedThreadCount, byteCount);

    console.log(
      `6. Adulterando byte a byte em memória: ${byteCount}/${finalPdf.length} bytes em ${threadCount} thread(s)...`
    );

    const tamperRun = await runTamperRangesInParallel(
      finalPdf,
      senderDidDocument,
      byteCount,
      threadCount
    );

    const reportPath = path.join(outputDir, `byte-tamper-exhaustive-${runId}.json`);
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          pdf_length: finalPdf.length,
          tested_bytes: tamperRun.results.length,
          full_file_tested: byteCount === finalPdf.length,
          requested_threads: requestedThreadCount,
          thread_count: tamperRun.thread_count,
          worker_summaries: tamperRun.worker_summaries,
          error_counts: tamperRun.error_counts,
          results: tamperRun.results
        },
        null,
        2
      )
    );

    assert.equal(tamperRun.results.length, byteCount);
    assert.equal(fs.existsSync(reportPath), true);

    const failures = tamperRun.results.filter((r) => r.unexpectedly_valid);

    console.log('\n7. Conclusão:');
    if (failures.length > 0) {
      console.error(
        '   Um PDF adulterado foi considerado válido, o que seria um alerta para corrigir a função criptográfica que liga o PDF visual a verdadeira credencial JSON que está embutida nele.'
      );
      assert.fail(`Segurança comprometida: ${failures.length} alterações em bytes passaram despercebidas.`);
    } else {
      console.log('   O PDF adulterado foi reconhecido como falso.');
    }
  });
}
