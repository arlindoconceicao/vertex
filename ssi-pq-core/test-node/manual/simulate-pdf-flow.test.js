/**
 * Este teste manual simula o fluxo de emissão, envio e verificação
 * de PDF SSI-PQ: primeiro gera um PDF íntegro com credencial
 * embutida e confirma que ele é válido; depois altera um byte
 * seguro do PDF e confirma que a verificação detecta a fraude.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/manual/simulate-pdf-flow.test.js
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf');
fs.mkdirSync(outputDir, { recursive: true });

test('Simula o fluxo completo de emissão, envio e adulteração de PDF', () => {
  console.log('1. Gerando DIDs do remetente (emissor) e destinatário (verificador)...');
  const sender = core.createDid({ mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768' });
  const recipient = core.createDid({ mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768' });

  console.log(`   Remetente DID: ${sender.did}`);
  console.log(`   Destinatário DID: ${recipient.did}\n`);

  // ==========================================
  // FASE 1: PDF Válido
  // ==========================================
  console.log('--- FASE 1: Testando um PDF Íntegro ---');
  console.log('2. Gerando um Schema...');
  const schema1 = core.createSchemaFromAttributes(
    { nome: 'João Silva', acesso: 'Total' },
    { version: '1' }
  );

  console.log('3. Gerando uma credencial assinada JSON...');
  const signedCredential1 = core.issueCredentialFromSchema(
    schema1,
    { nome: 'João Silva', acesso: 'Total' },
    sender.didDocument,
    sender.privateKeys.mldsaPrivateKey,
    { visiblePaths: ['nome', 'acesso'] }
  );

  console.log('4. Gerando PDF visual e embutindo a credencial...');
  const pdfBase1 = Buffer.from(core.signedCredentialToPdf(signedCredential1));
  const finalPdf1 = Buffer.from(
    core.embedSignedCredentialInPdf(
      pdfBase1,
      signedCredential1,
      sender.didDocument,
      sender.privateKeys.mldsaPrivateKey
    )
  );

  const validPdfPath = path.join(outputDir, 'simulate-valid.pdf');
  fs.writeFileSync(validPdfPath, finalPdf1);
  console.log(`   [Arquivo] PDF Íntegro salvo em: ${validPdfPath}\n`);

  console.log('5. Destinatário abrindo e verificando o PDF (usando o DID Document do remetente)...');
  const verification1 = core.verifySignedCredentialPdf(finalPdf1, sender.didDocument);

  console.log('6. Resultado da Fase 1:');
  console.log(`   Válida? ${verification1.valid ? 'SIM (Credencial Autêntica)' : 'NÃO'}`);
  console.log(`   Status: ${verification1.status}\n`);

  // ==========================================
  // FASE 2: PDF Adulterado
  // ==========================================
  console.log('--- FASE 2: Testando um PDF Adulterado ---');
  console.log('Repetindo passos 2 a 4 para um novo documento...');

  const schema2 = core.createSchemaFromAttributes(
    { nome: 'Maria Souza', acesso: 'Restrito' },
    { version: '1' }
  );

  const signedCredential2 = core.issueCredentialFromSchema(
    schema2,
    { nome: 'Maria Souza', acesso: 'Restrito' },
    sender.didDocument,
    sender.privateKeys.mldsaPrivateKey,
    { visiblePaths: ['nome', 'acesso'] }
  );

  const pdfBase2 = Buffer.from(core.signedCredentialToPdf(signedCredential2));
  const finalPdf2 = Buffer.from(
    core.embedSignedCredentialInPdf(
      pdfBase2,
      signedCredential2,
      sender.didDocument,
      sender.privateKeys.mldsaPrivateKey
    )
  );

  console.log('Alterando um byte de comentário no cabeçalho do PDF (sem quebrar a renderização visual)...');
  const tamperedPdf = Buffer.from(finalPdf2);
  // O PDF gerado começa com: %PDF-1.4\n%\xFF\xFF\xFF\xFF\n
  // O byte no índice 10 faz parte de um comentário seguro. Alterá-lo muda o hash da base, mas mantém o PDF 100% legível.
  tamperedPdf[10] = tamperedPdf[10] ^ 0xFF;

  const tamperedPdfPath = path.join(outputDir, 'simulate-tampered.pdf');
  fs.writeFileSync(tamperedPdfPath, tamperedPdf);
  console.log(`   [Arquivo] PDF Adulterado salvo em: ${tamperedPdfPath}\n`);

  console.log('5 (Repetido). Destinatário abrindo e verificando o PDF adulterado...');
  const verification2 = core.verifySignedCredentialPdf(tamperedPdf, sender.didDocument);

  console.log('7. Resultado da Fase 2:');
  console.log(`   Válida? ${verification2.valid ? 'SIM' : 'NÃO (Detecção de Fraude Funcionou)'}`);
  console.log(`   Status: ${verification2.status}`);
  console.log(`   Erros encontrados: ${JSON.stringify(verification2.errors)}`);
});
