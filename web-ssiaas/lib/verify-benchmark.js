const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('perf_hooks');
const crypto = require('node:crypto');
const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const core = require('./ssi_pq_core.node');

function getCpuSnapshot() {
  return os.cpus().map(cpu => {
    const total = Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0);
    return { idle: cpu.times.idle, total };
  });
}

const PARAMETER_SETS = [
  { id: 'Level 1 (128-bit)', mldsa: 'ML-DSA-44', mlkem: 'ML-KEM-512' },
  { id: 'Level 3 (192-bit)', mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768' },
  { id: 'Level 5 (256-bit)', mldsa: 'ML-DSA-87', mlkem: 'ML-KEM-1024' }
];

const credentialData = {
  titular: { nome: 'Alice Silva', documento: { tipo: 'CPF', numero: '123.456.789-00' } },
  formacao: { curso: 'Criptografia Pós-Quântica', instituicao: { nome: 'SSI-PQ Academy', cidade: 'São Paulo' } },
  endereco: { rua: 'Rua São José', numero: 42, cidade: 'São Paulo' },
  nivel: 'Avançado'
};

const visiblePaths = [
  'titular.nome', 'titular.documento.tipo', 'titular.documento.numero',
  'formacao.curso', 'formacao.instituicao.nome', 'endereco.cidade', 'nivel'
];

const pdfLabels = {
  endereco: 'Endereço', 'endereco.cidade': 'Cidade', formacao: 'Formação',
  'formacao.curso': 'Curso', 'formacao.instituicao': 'Instituição',
  'formacao.instituicao.nome': 'Nome', nivel: 'Nível', titular: 'Titular',
  'titular.documento': 'Documento', 'titular.documento.tipo': 'Tipo', 'titular.nome': 'Nome'
};

if (isMainThread) {
  const ITERATIONS = parseInt(process.env.ITERATIONS || '10', 10);
  const THREADS = parseInt(process.env.THREADS || '1', 10);
  const WARMUP = parseInt(process.env.WARMUP_ITERATIONS || '0', 10);

  // Informações da máquina
  const cpuModel = os.cpus()[0]?.model || 'Desconhecido';
  const cpuSpeed = os.cpus()[0]?.speed || 0;
  const cpuCores = os.cpus().length;
  const totalRAM = Math.round(os.totalmem() / (1024 ** 3));
  const osInfo = `${os.type()} ${os.release()} (${os.arch()})`;
  
  const sysInfo = {
    cpu: `${cpuModel} (${cpuCores} cores, ${cpuSpeed}MHz)`,
    ram: `${totalRAM} GB`,
    os: osInfo
  };

  console.log(`=================================================`);
  console.log(`🚀 Iniciando Stress Test de Verificação (Multi-Thread)`);
  console.log(`🔄 Iterações de verificação por nível: ${ITERATIONS}`);
  console.log(`🔥 Iterações de WARMUP (por thread): ${WARMUP}`);
  console.log(`🧵 Threads: ${THREADS}`);
  console.log(`💻 CPU: ${sysInfo.cpu}`);
  console.log(`=================================================\n`);

  const outputDir = path.join(__dirname, 'metrics_output');
  fs.mkdirSync(outputDir, { recursive: true });

  const workers = [];
  const itersPerThread = Math.floor(ITERATIONS / THREADS);
  let remainingIters = ITERATIONS % THREADS;

  console.log('Executando operações de verificação em paralelo...');

  const cpuUsageHistory = [];
  const memoryHistory = [];
  let lastCpuSnapshot = getCpuSnapshot();

  const monitorInterval = setInterval(() => {
    const currentSnapshot = getCpuSnapshot();
    const coresUsage = currentSnapshot.map((core, i) => {
      const prev = lastCpuSnapshot[i];
      const idleDiff = core.idle - prev.idle;
      const totalDiff = core.total - prev.total;
      return totalDiff === 0 ? 0 : 100 - (100 * idleDiff / totalDiff);
    });
    cpuUsageHistory.push(coresUsage);
    lastCpuSnapshot = currentSnapshot;

    const usedMemMb = (os.totalmem() - os.freemem()) / (1024 * 1024);
    memoryHistory.push(usedMemMb);
  }, 250);

  const globalStart = performance.now();

  for (let i = 0; i < THREADS; i++) {
    const iters = itersPerThread + (remainingIters > 0 ? 1 : 0);
    remainingIters--;
    
    if (iters > 0 || WARMUP > 0) {
      workers.push(new Promise((resolve, reject) => {
        const worker = new Worker(__filename, { workerData: { iters, warmupIters: WARMUP, threadId: i, outputDir } });
        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
          if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
      }));
    }
  }

  Promise.all(workers).then((workerResults) => {
    clearInterval(monitorInterval);
    const globalTime = (performance.now() - globalStart) / 1000; // in seconds
    const combined = {};
    for (const params of PARAMETER_SETS) {
      combined[params.id] = { t_verifyPdf: [] };
      
      for (const res of workerResults) {
        if (!res) continue;
        const paramStats = res[params.id];
        if (!paramStats) continue;
        combined[params.id].t_verifyPdf.push(...paramStats.t_verifyPdf);
      }
    }

    const finalResults = {};
    for (const params of PARAMETER_SETS) {
      const allVerifications = combined[params.id].t_verifyPdf;
      const totalVerifications = allVerifications.length;
      
      // Acha o tempo real de parede mais longo (thread mais lenta) para esse nível específico
      let maxWallClock = 0;
      for (const res of workerResults) {
        if (!res) continue;
        const paramStats = res[params.id];
        if (paramStats && paramStats.wallClockTime > maxWallClock) {
          maxWallClock = paramStats.wallClockTime;
        }
      }
      
      // O throughput desse nível específico leva em conta apenas o tempo dele
      const throughput = totalVerifications > 0 && maxWallClock > 0 ? (totalVerifications / maxWallClock) : 0;
      
      finalResults[params.id] = {
        t_verifyPdf: getStats(allVerifications),
        throughput: throughput,
        wallClockTime: maxWallClock
      };
    }
    
    const memStats = getStats(memoryHistory);
    memStats.min = memoryHistory.length > 0 ? Math.min(...memoryHistory) : 0;
    memStats.max = memoryHistory.length > 0 ? Math.max(...memoryHistory) : 0;

    const cpuCoresCount = os.cpus().length;
    const coreAverages = [];
    for (let c = 0; c < cpuCoresCount; c++) {
      const coreHistory = cpuUsageHistory.map(snapshot => snapshot[c]);
      coreAverages.push(getStats(coreHistory).avg);
    }

    generateHtmlReport(finalResults, ITERATIONS, THREADS, WARMUP, sysInfo, globalTime, memStats, coreAverages);
  }).catch(console.error);

  function getStats(arr) {
    if (arr.length === 0) return { avg: 0, stdDev: 0 };
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = sum / arr.length;
    const sqDiffs = arr.map(val => Math.pow(val - avg, 2));
    const avgSqDiff = sqDiffs.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = Math.sqrt(avgSqDiff);
    return { avg, stdDev };
  }
} else {
  // WORKER THREAD LOGIC
  const { iters, warmupIters, threadId, outputDir } = workerData;
  const runId = crypto.randomUUID();
  const workerResults = {};

  for (const params of PARAMETER_SETS) {
    let stats = { t_verifyPdf: [] };

    // Setup Phase (One-time generation of the credential to verify)
    const senderWallet = path.join(outputDir, `sender-${params.mldsa}-${threadId}-${runId}.db`);
    const senderPassword = 'senha-remetente';
    core.walletCreate(senderWallet, senderPassword, { createdAt: '2026-05-27T00:00:00Z' });
    const senderDidInfo = core.walletCreateDid(senderWallet, senderPassword, {
      label: 'Remetente', mldsa: params.mldsa, mlkem: params.mlkem, createdAt: '2026-05-27T00:00:00Z'
    });
    const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDidInfo.did);

    const schema = core.createSchemaFromAttributes(credentialData, { version: '1', createdAt: '2026-05-27T00:00:00Z' });
    const signedCredential = core.walletIssueCredentialFromSchema(
      senderWallet, senderPassword, senderDidInfo.did,
      schema, credentialData,
      { credentialId: `cred-verify`, issuedAt: '2026-05-27T00:00:00Z', visiblePaths }
    );
    const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential, { labels: pdfLabels }));
    const finalPdf = Buffer.from(
      core.walletEmbedSignedCredentialInPdf(senderWallet, senderPassword, senderDidInfo.did, pdfBase, signedCredential, { createdAt: '2026-05-27T00:00:00Z' })
    );

    // Measurement Phase
    const totalIters = warmupIters + iters;
    let startLevel = performance.now(); // Fallback caso não haja iterações reais
    for (let iter = 0; iter < totalIters; iter++) {
      const isWarmup = iter < warmupIters;
      
      // Reseta o cronômetro exatamente quando acaba o warmup e começam as iterações reais
      if (iter === warmupIters) {
        startLevel = performance.now();
      }

      const start = performance.now();
      core.verifySignedCredentialPdf(finalPdf, senderDidDocument);
      const tVerifyPdf = performance.now() - start;
      
      if (!isWarmup) {
        stats.t_verifyPdf.push(tVerifyPdf);
      }
    }
    const endLevel = performance.now();
    stats.wallClockTime = (endLevel - startLevel) / 1000; // time elapsed in seconds for this level

    try {
      fs.unlinkSync(senderWallet);
    } catch (e) {}
    
    workerResults[params.id] = stats;
  }
  parentPort.postMessage(workerResults);
}

function f(val) { return val.toFixed(3); }

function generateHtmlReport(res, iters, threads, warmup, sysInfo, globalTime, memStats, coreAverages) {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SSI-PQ Verify Stress Test</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 20px; color: #333; }
    h1, h2 { text-align: center; color: #2c3e50; }
    .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th, td { padding: 12px 15px; text-align: center; border-bottom: 1px solid #ddd; }
    th { background-color: #34495e; color: #fff; text-transform: uppercase; font-size: 14px; }
    tr:hover { background-color: #f1f1f1; }
    .col-header { text-align: left; font-weight: bold; }
    .desc { font-size: 0.85em; color: #666; display: block; }
    .info-bar { background-color: #eef; padding: 15px; border-radius: 8px; margin-bottom: 20px; text-align: left; }
    .info-bar ul { list-style: none; padding-left: 0; margin: 5px 0 0; }
    .info-bar li { margin-bottom: 5px; }
    .highlight { font-size: 1.2em; font-weight: bold; color: #27ae60; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Resultados de Stress Test: Verificação de PDF (SSI-PQ)</h1>
    <div class="info-bar">
      <strong>💻 Informações da Máquina:</strong>
      <ul>
        <li><strong>Sistema Operacional:</strong> ${sysInfo.os}</li>
        <li><strong>Processador:</strong> ${sysInfo.cpu}</li>
        <li><strong>Memória RAM:</strong> ${sysInfo.ram}</li>
      </ul>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <strong>⚙️ Parâmetros do Teste:</strong>
      <ul>
        <li><strong>Iterações de Verificação:</strong> ${iters}</li>
        <li><strong>Iterações de Warmup:</strong> ${warmup}</li>
        <li><strong>Threads simultâneas:</strong> ${threads}</li>
        <li><strong>Tempo Total (Wall-clock):</strong> ${f(globalTime)} segundos</li>
      </ul>
      <hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">
      <strong>📊 Recursos do Sistema (Monitoramento Ativo):</strong>
      <ul>
        <li><strong>Memória RAM Utilizada:</strong> Média: ${f(memStats.avg)} MB | Min: ${f(memStats.min)} MB | Max: ${f(memStats.max)} MB | Desvio: ± ${f(memStats.stdDev)} MB</li>
        <li><strong>Uso de CPU por Núcleo:</strong><br>
          <div style="font-size: 0.9em; margin-top: 5px; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 5px;">
            ${coreAverages.map((avg, idx) => `<span>Núcleo ${idx}: <b>${f(avg)}%</b></span>`).join('')}
          </div>
        </li>
      </ul>
      <p style="font-size: 0.85em; color: #555; margin-top: 15px;"><i>* Os tempos listados estão em milissegundos (ms) e o throughput em verificações por segundo (vps).</i></p>
    </div>
    
    <h2>Métricas de Verificação (verifySignedCredentialPdf)</h2>
    <table>
      <thead>
        <tr>
          <th>Nível de Segurança</th>
          <th>Tempo Médio por PDF (ms)</th>
          <th>Tempo Total por Nível (s)</th>
          <th>Throughput (Verificações / seg)</th>
        </tr>
      </thead>
      <tbody>
        ${PARAMETER_SETS.map(p => `
        <tr>
          <td class="col-header">
            ${p.id}<br><span class="desc">${p.mldsa} / ${p.mlkem}</span>
          </td>
          <td>${f(res[p.id].t_verifyPdf.avg)} ± ${f(res[p.id].t_verifyPdf.stdDev)}</td>
          <td>${f(res[p.id].wallClockTime)}</td>
          <td class="highlight">${f(res[p.id].throughput)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
  
  const reportPath = path.join(__dirname, 'metrics-verify-report.html');
  fs.writeFileSync(reportPath, html, 'utf8');
  console.log(`✅ Relatório gerado em: ${reportPath}`);
}
