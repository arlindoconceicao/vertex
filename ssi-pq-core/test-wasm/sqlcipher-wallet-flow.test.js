/**
 * Este teste cobre o fluxo de producao com wallets SQLCipher geradas pelo
 * adapter Node e verificacao final pelo WebAssembly. Ele existe porque o
 * crate WASM atual ainda nao compila rusqlite/SQLCipher para browser.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const nodeCore = require('../npm/ssi_pq_core.node');
const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const outputDir = path.join(__dirname, '..', 'test-output', 'wasm-sqlcipher-wallet-flow');
fs.mkdirSync(outputDir, { recursive: true });

const createdAt = '2026-05-27T00:00:00Z';
const issuedAt = '2026-05-27T00:00:00Z';

function toJson(value) {
  return JSON.stringify(value);
}

function fromJson(text) {
  return JSON.parse(text);
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(outputDir, name), JSON.stringify(value, null, 2));
}

function decodeBase58Btc(str) {
  if (str[0] !== 'z') throw new Error('Not base58btc multibase');
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let d = 0n;
  const strData = str.slice(1);

  for (let i = 0; i < strData.length; i++) {
    d = d * 58n + BigInt(alphabet.indexOf(strData[i]));
  }

  let hex = d.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;

  const buf = Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  while (strData[leadingZeros] === '1') leadingZeros++;

  return Buffer.concat([Buffer.alloc(leadingZeros), buf]);
}

function assertSqlcipherWalletFile(pathname, did) {
  const rawFile = fs.readFileSync(pathname);

  assert.equal(
    rawFile.includes(Buffer.from('SQLite format 3', 'ascii')),
    false,
    'SQLCipher wallet must not expose a plaintext SQLite header'
  );
  assert.equal(
    rawFile.includes(Buffer.from(did, 'utf8')),
    false,
    'SQLCipher wallet must not expose the DID in plaintext bytes'
  );
}

test('WASM interop flow persists SQLCipher wallets and verifies final PDF', () => {
  const runId = crypto.randomUUID();
  const senderWallet = path.join(outputDir, `sender-${runId}.db`);
  const senderPassword = 'senha-remetente-wasm-sqlcipher-123';
  const recipientWallet = path.join(outputDir, `recipient-${runId}.db`);
  const recipientPassword = 'senha-destinatario-wasm-sqlcipher-456';

  const senderWalletInfo = nodeCore.walletCreate(senderWallet, senderPassword, { createdAt });
  const senderDid = nodeCore.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente WASM interop',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const senderDidDocument = nodeCore.walletGetDidDocument(
    senderWallet,
    senderPassword,
    senderDid.did
  );

  const recipientWalletInfo = nodeCore.walletCreate(recipientWallet, recipientPassword, {
    createdAt
  });
  const recipientDid = nodeCore.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatario WASM interop',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });
  const recipientDidDocument = nodeCore.walletGetDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );

  assertSqlcipherWalletFile(senderWallet, senderDid.did);
  assertSqlcipherWalletFile(recipientWallet, recipientDid.did);

  writeJson(`sender-wallet-info-${runId}.json`, senderWalletInfo);
  writeJson(`recipient-wallet-info-${runId}.json`, recipientWalletInfo);
  writeJson(`sender-did-document-${runId}.json`, senderDidDocument);
  writeJson(`recipient-did-document-${runId}.json`, recipientDidDocument);

  const credentialData = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    formacao: {
      curso: 'Criptografia P\u00f3s-Qu\u00e2ntica',
      instituicao: {
        nome: 'SSI-PQ Academy',
        cidade: 'S\u00e3o Paulo'
      }
    },
    endereco: {
      rua: 'Rua S\u00e3o Jos\u00e9',
      numero: 42,
      cidade: 'S\u00e3o Paulo'
    },
    nivel: 'Avan\u00e7ado'
  };
  const visiblePaths = [
    'titular.nome',
    'titular.documento.tipo',
    'titular.documento.numero',
    'formacao.curso',
    'formacao.instituicao.nome',
    'endereco.cidade',
    'nivel'
  ];
  const pdfLabels = {
    endereco: 'Endere\u00e7o',
    'endereco.cidade': 'Cidade',
    formacao: 'Forma\u00e7\u00e3o',
    'formacao.curso': 'Curso',
    'formacao.instituicao': 'Institui\u00e7\u00e3o',
    'formacao.instituicao.nome': 'Nome',
    nivel: 'N\u00edvel',
    titular: 'Titular',
    'titular.documento': 'Documento',
    'titular.documento.tipo': 'Tipo',
    'titular.nome': 'Nome'
  };

  const schema = nodeCore.createSchemaFromAttributes(credentialData, {
    version: '1',
    createdAt
  });
  const signedCredential = nodeCore.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_wasm_sqlcipher_wallet_test',
      issuedAt,
      visiblePaths
    }
  );

  writeJson(`credential-data-${runId}.json`, credentialData);
  writeJson(`schema-${runId}.json`, schema);
  writeJson(`signed-credential-${runId}.json`, signedCredential);

  assert.deepEqual(
    fromJson(
      wasm.verifySignedCredentialJson(toJson(signedCredential), toJson(senderDidDocument))
    ),
    { valid: true }
  );

  const pdfBase = Buffer.from(
    nodeCore.signedCredentialToPdf(signedCredential, { labels: pdfLabels })
  );
  fs.writeFileSync(path.join(outputDir, `credencial-labels-base-${runId}.pdf`), pdfBase);

  const finalPdf = Buffer.from(
    nodeCore.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase,
      signedCredential,
      { createdAt }
    )
  );
  fs.writeFileSync(path.join(outputDir, `credencial-labels-assinada-${runId}.pdf`), finalPdf);

  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  const recipientPubKeyBytes = decodeBase58Btc(mlkemKey.public_key_multibase);
  const recipientPubKeyBase64url = nodeCore.base64urlEncode(recipientPubKeyBytes);
  const encapsulation = nodeCore.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecretSender = nodeCore.base64urlDecode(encapsulation.sharedSecret);
  const encrypted = nodeCore.aes256GcmEncrypt(sharedSecretSender, finalPdf);
  const encryptedPdf = Buffer.from(encrypted.ciphertext);
  const encryptedPdfPath = path.join(outputDir, `credencial-labels-${runId}.pdf.enc`);

  fs.writeFileSync(encryptedPdfPath, encryptedPdf);
  writeJson(`credencial-labels-encryption-${runId}.json`, {
    mlkemProfile: encapsulation.profile,
    mlkemCiphertext: encapsulation.ciphertext,
    aesNonce: nodeCore.base64urlEncode(Buffer.from(encrypted.nonce)),
    aesAuthTag: nodeCore.base64urlEncode(Buffer.from(encrypted.authTag))
  });
  assert.notEqual(encryptedPdf.subarray(0, 5).toString('latin1'), '%PDF-');

  const recoveredSecretBase64url = nodeCore.walletMlkemDecapsulate(
    recipientWallet,
    recipientPassword,
    recipientDid.did,
    encapsulation.ciphertext
  );
  const sharedSecretRecipient = nodeCore.base64urlDecode(recoveredSecretBase64url);
  const decryptedPdf = Buffer.from(
    nodeCore.aes256GcmDecrypt(
      sharedSecretRecipient,
      encryptedPdf,
      Buffer.from(encrypted.nonce),
      Buffer.from(encrypted.authTag)
    )
  );
  fs.writeFileSync(path.join(outputDir, `credencial-labels-decifrada-${runId}.pdf`), decryptedPdf);

  assert.deepEqual(decryptedPdf, finalPdf);
  const verification = fromJson(
    wasm.verifySignedCredentialPdfJson(new Uint8Array(decryptedPdf), toJson(senderDidDocument))
  );
  const manifest = fromJson(wasm.extractCredentialManifestFromPdfBytes(new Uint8Array(decryptedPdf)));

  writeJson(`credencial-labels-verification-${runId}.json`, verification);
  writeJson(`credencial-labels-manifest-${runId}.json`, manifest);

  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(
    manifest.signed_credential.credential.credential_id,
    'cred_wasm_sqlcipher_wallet_test'
  );
});
