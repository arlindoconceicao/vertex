/**
 * Este teste manual simula um ataque de merge/concatenação entre
 * dois PDFs SSI-PQ válidos, mostrando que cada PDF isolado verifica
 * corretamente, mas o arquivo juntado é rejeitado por alterar os
 * bytes visuais protegidos pelo vínculo criptográfico.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/manual/simulate-pdf-merge-attack.test.js
 */

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'pdf');
fs.mkdirSync(outputDir, { recursive: true });

test('Simula ataque de junção (merge) de dois PDFs válidos', () => {
  console.log('1. Gerando chaves do emissor...');
  const sender = core.createDid({ mldsa: 'ML-DSA-65', mlkem: 'ML-KEM-768' });

  console.log('\n2. Gerando PDF 1 (João Silva)...');
  const schema1 = core.createSchemaFromAttributes({ nome: 'João Silva', curso: 'Matemática' }, { version: '1' });
  const cred1 = core.issueCredentialFromSchema(schema1, { nome: 'João Silva', curso: 'Matemática' }, sender.didDocument, sender.privateKeys.mldsaPrivateKey, { visiblePaths: ['nome', 'curso'] });
  const pdfBase1 = Buffer.from(core.signedCredentialToPdf(cred1));
  const finalPdf1 = Buffer.from(core.embedSignedCredentialInPdf(pdfBase1, cred1, sender.didDocument, sender.privateKeys.mldsaPrivateKey));

  console.log('3. Gerando PDF 2 (Maria Souza)...');
  const schema2 = core.createSchemaFromAttributes({ nome: 'Maria Souza', curso: 'História' }, { version: '1' });
  const cred2 = core.issueCredentialFromSchema(schema2, { nome: 'Maria Souza', curso: 'História' }, sender.didDocument, sender.privateKeys.mldsaPrivateKey, { visiblePaths: ['nome', 'curso'] });
  const pdfBase2 = Buffer.from(core.signedCredentialToPdf(cred2));
  const finalPdf2 = Buffer.from(core.embedSignedCredentialInPdf(pdfBase2, cred2, sender.didDocument, sender.privateKeys.mldsaPrivateKey));

  console.log('\n4. Verificando ambos os PDFs isoladamente...');
  const verif1 = core.verifySignedCredentialPdf(finalPdf1, sender.didDocument);
  const verif2 = core.verifySignedCredentialPdf(finalPdf2, sender.didDocument);
  console.log(`   PDF 1 Válido? ${verif1.valid ? 'SIM' : 'NÃO'}`);
  console.log(`   PDF 2 Válido? ${verif2.valid ? 'SIM' : 'NÃO'}`);

  console.log('\n5. Simulando o ataque: Juntando os dois arquivos (Merge/Concatenação)...');
  // Uma concatenação binária simples é a forma mais crua de juntar arquivos.
  // Mesmo que um atacante use uma ferramenta comercial (como pdftk ou Adobe Acrobat) 
  // para fundir as páginas perfeitamente, a ferramenta reescreverá a tabela de objetos (xref) e o /Catalog, 
  // alterando completamente a estrutura de bytes visuais (o pdf_base_bytes original) e 
  // disparando exatamente a mesma rejeição criptográfica.
  const mergedPdf = Buffer.concat([finalPdf1, finalPdf2]);

  const mergedPdfPath = path.join(outputDir, 'simulate-merged-attack.pdf');
  fs.writeFileSync(mergedPdfPath, mergedPdf);
  console.log(`   [Arquivo] PDF Juntado (Ataque) salvo em: ${mergedPdfPath}`);

  console.log('\n6. Vítima tenta verificar o PDF juntado...');
  // Passamos o DID Document, mas o PDF foi adulterado ao ser juntado com outro.
  const mergedVerif = core.verifySignedCredentialPdf(mergedPdf, sender.didDocument);

  console.log('\n7. Resultado da Verificação:');
  console.log(`   Válida? ${mergedVerif.valid ? 'SIM (Falha na segurança)' : 'NÃO (Ataque Detectado com Sucesso)'}`);
  console.log(`   Status: ${mergedVerif.status}`);
  console.log(`   Erros encontrados: ${JSON.stringify(mergedVerif.errors)}`);
});
