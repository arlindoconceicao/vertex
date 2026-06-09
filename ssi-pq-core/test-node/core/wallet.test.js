/**
 * Este teste exercita a wallet SQLCipher ponta a ponta: criação
 * e abertura da base cifrada, criação e listagem de DID,
 * exportação segura do DID Document, emissão de credencial
 * assinada sem expor chaves privadas, geração/verificação de PDF
 * com credencial embutida e troca de senha da wallet.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

function walletPath(name) {
  return path.join(
    __dirname,
    '..',
    '..',
    'test-output',
    'wallet',
    `${name}-${crypto.randomUUID()}.db`
  );
}

test('SQLCipher wallet stores DID keys and signs credentials without exporting private keys', () => {
  const pathToWallet = walletPath('issuer');
  const password = 'senha forte para teste local';
  const newPassword = 'senha nova forte para teste local';
  const created = core.walletCreate(pathToWallet, password, {
    createdAt: '2026-05-27T00:00:00Z'
  });

  assert.equal(created.version, 2);
  assert.equal(created.did_count, 0);
  assert.equal(typeof created.sqlcipher_version, 'string');
  assert.equal(created.sqlcipher_version.length > 0, true);

  const didResult = core.walletCreateDid(pathToWallet, password, {
    label: 'emissor principal',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });

  assert.equal(didResult.did.startsWith('did:ssipq:z'), true);
  assert.equal(didResult.label, 'emissor principal');
  assert.equal(didResult.privateKeys, undefined);
  assert.equal(core.didVerify(didResult.did_document), true);

  const opened = core.walletOpen(pathToWallet, password);
  assert.equal(opened.did_count, 1);

  const dids = core.walletListDids(pathToWallet, password);
  assert.equal(dids.length, 1);
  assert.equal(dids[0].did, didResult.did);
  assert.equal(dids[0].label, 'emissor principal');
  assert.equal(dids[0].mldsa_alg, 'ML-DSA-65');
  assert.equal(dids[0].mlkem_alg, 'ML-KEM-768');

  const exportedDidDocument = core.walletGetDidDocument(pathToWallet, password, didResult.did);
  assert.equal(exportedDidDocument.id, didResult.did);
  assert.equal(core.didVerify(exportedDidDocument), true);

  const rawWallet = fs.readFileSync(pathToWallet);
  assert.equal(rawWallet.includes(Buffer.from('SQLite format 3', 'utf8')), false);
  assert.equal(rawWallet.includes(Buffer.from(didResult.did, 'utf8')), false);
  assert.equal(rawWallet.includes(Buffer.from(password, 'utf8')), false);

  const schema = core.createSchemaFromAttributes(
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      carga_horaria: 40
    },
    {
      version: '1',
      createdAt: '2026-05-27T00:00:00Z'
    }
  );
  const signedCredential = core.walletIssueCredentialFromSchema(
    pathToWallet,
    password,
    didResult.did,
    schema,
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      carga_horaria: 40
    },
    {
      credentialId: 'cred_wallet_node_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'curso', 'carga_horaria']
    }
  );

  assert.equal(core.verifySignedCredential(signedCredential, exportedDidDocument), true);

  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      pathToWallet,
      password,
      didResult.did,
      pdfBase,
      signedCredential,
      {
        createdAt: '2026-05-27T00:00:00Z'
      }
    )
  );
  const outputPdf = path.join(
    __dirname,
    '..',
    '..',
    'test-output',
    'pdf',
    'ssi-pq-wallet-signed-credential.pdf'
  );
  const outputDidDocument = path.join(
    __dirname,
    '..',
    '..',
    'test-output',
    'pdf',
    'ssi-pq-wallet-signed-credential.did-document.json'
  );

  fs.mkdirSync(path.dirname(outputPdf), { recursive: true });
  fs.writeFileSync(outputPdf, finalPdf);
  fs.writeFileSync(outputDidDocument, JSON.stringify(exportedDidDocument, null, 2));

  const verification = core.verifySignedCredentialPdf(finalPdf, exportedDidDocument);
  assert.equal(verification.valid, true);
  assert.equal(verification.credential_id, 'cred_wallet_node_test');
  assert.throws(() => core.walletOpen(pathToWallet, 'senha errada'));

  const changed = core.walletChangePassword(pathToWallet, password, newPassword);
  assert.equal(changed.did_count, 1);
  assert.throws(() => core.walletOpen(pathToWallet, password));
  assert.equal(core.walletOpen(pathToWallet, newPassword).did_count, 1);
  assert.equal(
    core.walletGetDidDocument(pathToWallet, newPassword, didResult.did).id,
    didResult.did
  );
});
