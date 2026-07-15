/**
 * Este teste avalia a segurança da revelação parcial em um fluxo
 * cifrado com ML-KEM e AES-GCM, confirmando que apenas atributos
 * visíveis são divulgados, que atributos ocultos não aparecem no
 * manifesto, que um atacante não consegue decifrar com outra
 * wallet e que adulterações no ciphertext ou no manifesto são
 * rejeitadas.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-mlkem-partial-disclosure-security.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(__dirname, '..', '..', 'test-output', 'platform-flow-partial');
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

function recipientMlkemPublicKeyBase64url(didDocument) {
  const mlkemKey = didDocument.keys.find((key) => key.type === 'ML-KEM-768');
  assert.notEqual(mlkemKey, undefined);
  return core.base64urlEncode(decodeBase58Btc(mlkemKey.public_key_multibase));
}

function encryptAesGcm(plaintext, sharedSecret) {
  const encrypted = core.aes256GcmEncrypt(sharedSecret, plaintext);
  return {
    ciphertext: Buffer.from(encrypted.ciphertext),
    iv: Buffer.from(encrypted.nonce),
    authTag: Buffer.from(encrypted.authTag)
  };
}

function decryptAesGcm(ciphertext, sharedSecret, iv, authTag) {
  return Buffer.from(core.aes256GcmDecrypt(sharedSecret, ciphertext, iv, authTag));
}

function replaceManifestBytes(pdfBytes, pdfBaseLength, originalText, replacementText) {
  assert.equal(Buffer.byteLength(originalText), Buffer.byteLength(replacementText));

  const tampered = Buffer.from(pdfBytes);
  const original = Buffer.from(originalText, 'utf8');
  const replacement = Buffer.from(replacementText, 'utf8');
  const offset = tampered.indexOf(original, pdfBaseLength);

  assert.notEqual(offset, -1);
  replacement.copy(tampered, offset);
  return tampered;
}

test('Fluxo Plataforma parcial: multiprova v2, decifragem autorizada e rejeicao de adulteracoes', () => {
  const senderWallet = path.join(outputDir, `sender-${crypto.randomUUID()}.db`);
  const senderPassword = 'senha-remetente-parcial-123';

  const recipientWallet = path.join(outputDir, `recipient-${crypto.randomUUID()}.db`);
  const recipientPassword = 'senha-destinatario-parcial-456';

  const attackerWallet = path.join(outputDir, `attacker-${crypto.randomUUID()}.db`);
  const attackerPassword = 'senha-atacante-789';

  core.walletCreate(senderWallet, senderPassword);
  const senderDid = core.walletCreateDid(senderWallet, senderPassword, {
    label: 'Remetente Parcial',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768'
  });
  const senderDidDocument = core.walletGetDidDocument(senderWallet, senderPassword, senderDid.did);

  core.walletCreate(recipientWallet, recipientPassword);
  const recipientDid = core.walletCreateDid(recipientWallet, recipientPassword, {
    label: 'Destinatario Parcial',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768'
  });
  const recipientDidDocument = core.walletGetDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );

  core.walletCreate(attackerWallet, attackerPassword);
  const attackerDid = core.walletCreateDid(attackerWallet, attackerPassword, {
    label: 'Atacante',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768'
  });

  const credentialData = {
    nome: 'Alice',
    cargo: 'Engenheira',
    departamento: 'Pesquisa',
    matricula: 'PQ-00042',
    salario: 'R$ 25.000,00',
    cpf: '123.456.789-00',
    email: 'alice@example.test',
    certificacao_extra_01: 'Certificado de Criptografia Pos-Quantica Nivel 01',
    certificacao_extra_02: 'Certificado de Criptografia Pos-Quantica Nivel 02',
    certificacao_extra_03: 'Certificado de Criptografia Pos-Quantica Nivel 03',
    certificacao_extra_04: 'Certificado de Criptografia Pos-Quantica Nivel 04',
    observacao_interna: 'Atributo confidencial que nao deve ser revelado'
  };
  const visiblePaths = ['nome', 'cargo', 'certificacao_extra_03'];
  const hiddenPaths = ['salario', 'cpf', 'observacao_interna', 'certificacao_extra_04'];

  const schema = core.createSchemaFromAttributes(credentialData, { version: '1' });
  const signedCredential = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_partial_mlkem_flow_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths
    }
  );

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(core.verifySignedCredential(signedCredential, senderDidDocument), true);

  const pdfBase = Buffer.from(core.signedCredentialToPdf(signedCredential));
  const finalPdf = Buffer.from(
    core.walletEmbedSignedCredentialInPdf(
      senderWallet,
      senderPassword,
      senderDid.did,
      pdfBase,
      signedCredential,
      {
        createdAt: '2026-05-27T00:00:00Z'
      }
    )
  );

  const encapsulation = core.mlkemEncapsulate(
    'ML-KEM-768',
    recipientMlkemPublicKeyBase64url(recipientDidDocument)
  );
  const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);
  const encrypted = encryptAesGcm(finalPdf, sharedSecretSender);

  const recoveredSecretBase64url = core.walletMlkemDecapsulate(
    recipientWallet,
    recipientPassword,
    recipientDid.did,
    encapsulation.ciphertext
  );
  const sharedSecretRecipient = core.base64urlDecode(recoveredSecretBase64url);
  assert.deepEqual(sharedSecretRecipient, sharedSecretSender);

  const decryptedPdf = decryptAesGcm(
    encrypted.ciphertext,
    sharedSecretRecipient,
    encrypted.iv,
    encrypted.authTag
  );
  assert.equal(decryptedPdf.subarray(0, 5).toString(), '%PDF-');

  const verification = core.verifySignedCredentialPdf(decryptedPdf, senderDidDocument);
  assert.equal(verification.valid, true);
  assert.equal(verification.status, 'VALID');

  const manifest = core.extractCredentialManifestFromPdf(decryptedPdf);
  const extractedCredential = manifest.signed_credential;
  const disclosures = extractedCredential.attribute_disclosures;
  const disclosedPaths = disclosures.map((disclosure) => disclosure.path);

  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(disclosures.length, visiblePaths.length);
  assert.deepEqual(disclosedPaths, [
    'subject.cargo',
    'subject.certificacao_extra_03',
    'subject.nome'
  ]);
  assert.equal(extractedCredential.attribute_multiproof.alg, 'Merkle-SHA3-256-Multiproof-V1');
  assert.equal(extractedCredential.attribute_multiproof.leaf_count, Object.keys(credentialData).length);
  assert.equal(extractedCredential.attribute_multiproof.proof_nodes.length > 0, true);
  assert.equal(
    disclosures.every(
      (disclosure) => disclosure.proof === undefined && disclosure.leaf_hash === undefined
    ),
    true
  );
  assert.equal(
    hiddenPaths.every((pathName) => !disclosedPaths.includes(`subject.${pathName}`)),
    true
  );
  assert.equal(JSON.stringify(disclosures).includes(credentialData.salario), false);
  assert.equal(JSON.stringify(disclosures).includes(credentialData.cpf), false);

  const attackerSecretBase64url = core.walletMlkemDecapsulate(
    attackerWallet,
    attackerPassword,
    attackerDid.did,
    encapsulation.ciphertext
  );
  const attackerSecret = core.base64urlDecode(attackerSecretBase64url);
  assert.notDeepEqual(attackerSecret, sharedSecretSender);
  assert.throws(() =>
    decryptAesGcm(encrypted.ciphertext, attackerSecret, encrypted.iv, encrypted.authTag)
  );

  const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
  tamperedCiphertext[Math.floor(tamperedCiphertext.length / 2)] ^= 0x01;
  assert.throws(() =>
    decryptAesGcm(tamperedCiphertext, sharedSecretRecipient, encrypted.iv, encrypted.authTag)
  );

  const tamperedManifestPdf = replaceManifestBytes(
    decryptedPdf,
    pdfBase.length,
    '"value":"Alice"',
    '"value":"Alicx"'
  );
  const tamperedVerification = core.verifySignedCredentialPdf(
    tamperedManifestPdf,
    senderDidDocument
  );
  assert.equal(tamperedVerification.valid, false);
  assert.equal(
    tamperedVerification.errors.includes('INVALID_CREDENTIAL_SIGNATURE') ||
      tamperedVerification.errors.includes('CREDENTIAL_HASH_MISMATCH'),
    true
  );

  fs.writeFileSync(path.join(outputDir, 'credencial-parcial-decifrada.pdf'), decryptedPdf);
  fs.writeFileSync(
    path.join(outputDir, 'credencial-parcial-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
});
