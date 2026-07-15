/**
 * Este teste valida o fluxo de plataforma com schema aninhado: o
 * remetente emite uma credencial com atributos hierárquicos e
 * revelação seletiva, gera o PDF, cifra para o destinatário com
 * ML-KEM e AES-256-GCM, e o destinatário decifra, verifica e
 * inspeciona as divulgações extraídas.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-mlkem-nested-schema-flow.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'nested-platform-flow');
fs.mkdirSync(outputDir, { recursive: true });

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

function winAnsiHex(text) {
  return [...text.normalize('NFC')]
    .map((char) => {
      const codePoint = char.codePointAt(0);

      if (codePoint >= 0x20 && codePoint <= 0x7e) {
        return codePoint;
      }
      if (codePoint >= 0xa0 && codePoint <= 0xff) {
        return codePoint;
      }
      return 0x3f;
    })
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

test('Fluxo Plataforma: Remetente envia PDF cifrado com credencial de Schema aninhado', () => {
  const runId = crypto.randomUUID();
  const senderWallet = path.join(outputDir, `sender-${runId}.db`);
  const senderPassword = 'senha-remetente-nested-123';
  const recipientWallet = path.join(outputDir, `recipient-${runId}.db`);
  const recipientPassword = 'senha-destinatario-nested-456';

  console.log('1. Criando Wallets e DIDs do remetente e destinatário...');
  core.walletCreate(senderWallet, senderPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDid.did);

  core.walletCreate(recipientWallet, recipientPassword, {
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatário',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipientDidDocument = core.walletGetDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );

  console.log('2. Remetente emitindo credencial com atributos aninhados...');
  const credentialData = {
    titular: {
      nome: 'Alice Silva',
      documento: {
        tipo: 'CPF',
        numero: '123.456.789-00'
      }
    },
    formacao: {
      curso: 'Criptografia Pós-Quântica',
      instituicao: {
        nome: 'SSI-PQ Academy',
        cidade: 'São Paulo'
      }
    },
    endereco: {
      rua: 'Rua São José',
      numero: 42,
      cidade: 'São Paulo'
    },
    nivel: 'Avançado'
  };
  const visiblePaths = [
    'titular.nome',
    'titular.documento.tipo',
    'formacao.curso',
    'formacao.instituicao.nome',
    'endereco.cidade',
    'nivel'
  ];

  const schema = core.createSchemaFromAttributes(credentialData, {
    version: '1',
    createdAt: '2026-05-27T00:00:00Z'
  });
  assert.deepEqual(
    schema.attributes.map((attribute) => attribute.path),
    [
      'subject.endereco.cidade',
      'subject.endereco.numero',
      'subject.endereco.rua',
      'subject.formacao.curso',
      'subject.formacao.instituicao.cidade',
      'subject.formacao.instituicao.nome',
      'subject.nivel',
      'subject.titular.documento.numero',
      'subject.titular.documento.tipo',
      'subject.titular.nome'
    ]
  );

  const signedCredential = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_nested_wallet_pdf_mlkem_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths
    }
  );
  assert.equal(core.verifySignedCredential(signedCredential, senderDidDocument), true);

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
  const finalPdfText = finalPdf.toString('latin1');
  assert.equal(finalPdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(finalPdfText.includes(winAnsiHex('São Paulo')), true);
  assert.equal(finalPdfText.includes(winAnsiHex('Criptografia Pós-Quântica')), true);
  assert.equal(finalPdfText.includes(winAnsiHex('Avançado')), true);

  console.log('3. Remetente encapsulando segredo ML-KEM para o destinatário...');
  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  assert.ok(mlkemKey, 'recipient DID document must contain #mlkem-1');
  assert.equal(mlkemKey.type, 'ML-KEM-768');

  const recipientPubKeyBytes = decodeBase58Btc(mlkemKey.public_key_multibase);
  const recipientPubKeyBase64url = core.base64urlEncode(recipientPubKeyBytes);
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);

  console.log('4. Remetente cifrando o PDF final com AES-256-GCM...');
  const encrypted = core.aes256GcmEncrypt(sharedSecretSender, finalPdf);
  const encryptedPdf = Buffer.from(encrypted.ciphertext);
  const iv = Buffer.from(encrypted.nonce);
  const authTag = Buffer.from(encrypted.authTag);

  const encryptedPdfPath = path.join(outputDir, `credencial-aninhada-${runId}.pdf.enc`);
  fs.writeFileSync(encryptedPdfPath, encryptedPdf);
  const diskEncryptedBytes = fs.readFileSync(encryptedPdfPath);

  assert.notEqual(diskEncryptedBytes.subarray(0, 5).toString(), '%PDF-');

  console.log('5. Destinatário descapsulando segredo com a Wallet e decifrando PDF...');
  const recoveredSecretBase64url = core.walletMlkemDecapsulate(
    recipientWallet,
    recipientPassword,
    recipientDid.did,
    encapsulation.ciphertext
  );
  const sharedSecretRecipient = core.base64urlDecode(recoveredSecretBase64url);
  assert.deepEqual(sharedSecretSender, sharedSecretRecipient);

  const decryptedPdf = Buffer.from(
    core.aes256GcmDecrypt(sharedSecretRecipient, diskEncryptedBytes, iv, authTag)
  );
  assert.equal(decryptedPdf.subarray(0, 5).toString(), '%PDF-');

  const decryptedPdfPath = path.join(outputDir, `credencial-aninhada-decifrada-${runId}.pdf`);
  fs.writeFileSync(decryptedPdfPath, decryptedPdf);

  console.log('6. Destinatário verificando PDF e inspecionando atributos revelados...');
  const verification = core.verifySignedCredentialPdf(decryptedPdf, senderDidDocument);
  assert.equal(verification.valid, true);

  const extractedManifest = core.extractCredentialManifestFromPdf(decryptedPdf);
  const extractedCredential = extractedManifest.signed_credential;
  const extractedDisclosures = extractedCredential.attribute_disclosures;

  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(extractedCredential.credential.credential_id, 'cred_nested_wallet_pdf_mlkem_test');
  assert.equal(extractedCredential.attribute_multiproof.alg, 'Merkle-SHA3-256-Multiproof-V1');
  assert.equal(extractedCredential.attribute_multiproof.leaf_count, schema.attributes.length);
  assert.deepEqual(
    extractedDisclosures.map((disclosure) => [disclosure.path, disclosure.value]),
    [
      ['subject.endereco.cidade', 'São Paulo'],
      ['subject.formacao.curso', 'Criptografia Pós-Quântica'],
      ['subject.formacao.instituicao.nome', 'SSI-PQ Academy'],
      ['subject.nivel', 'Avançado'],
      ['subject.titular.documento.tipo', 'CPF'],
      ['subject.titular.nome', 'Alice Silva']
    ]
  );
  assert.equal(
    extractedDisclosures.every(
      (disclosure) => disclosure.proof === undefined && disclosure.leaf_hash === undefined
    ),
    true
  );

  const manifestPath = path.join(outputDir, `credencial-aninhada-manifest-${runId}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(extractedManifest, null, 2));
  assert.equal(fs.existsSync(manifestPath), true);
});
