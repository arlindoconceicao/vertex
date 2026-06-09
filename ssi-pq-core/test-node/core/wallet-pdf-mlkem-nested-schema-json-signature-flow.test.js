/**
 * Este teste valida o fluxo de plataforma com schema aninhado: o
 * remetente emite uma credencial com atributos hierárquicos e
 * revelação seletiva, usa a biblioteca para criar um arquivo JSON
 * com a chave pública ML-KEM do destinatário, gera o PDF, cifra para o
 * destinatário com ML-KEM e AES-256-GCM, e o destinatário
 * decifra, verifica o PDF, inspeciona as divulgações extraídas e
 * valida a assinatura da credencial JSON extraída no final.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/wallet-pdf-mlkem-nested-schema-json-signature-flow.test.js
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const outputDir = path.join(
  __dirname,
  '..',
  '..',
  'test-output',
  'nested-platform-json-signature-flow'
);
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
  const senderSigningKey = senderDidDocument.keys.find((key) => key.id === '#mldsa-1');
  assert.ok(senderSigningKey, 'sender DID document must contain #mldsa-1');
  const senderIdentifier = core.issuerIdentifierBase64(senderDidDocument);

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
  assert.equal(core.didVerify(recipientDidDocument), true);

  console.log('2. Criando arquivo com a chave pública ML-KEM do destinatário pela biblioteca...');
  const recipientPublicKeyPath = path.join(
    outputDir,
    `recipient-mlkem-public-key-${runId}.json`
  );

  const recipientMlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  assert.ok(recipientMlkemKey, 'recipient DID document must contain #mlkem-1');
  fs.writeFileSync(
    recipientPublicKeyPath,
    JSON.stringify(
      {
        type: 'ssi_pq_recipient_mlkem_public_key_v1',
        did: recipientDidDocument.id,
        key_id: recipientMlkemKey.id,
        alg: recipientMlkemKey.type,
        public_key_multibase: recipientMlkemKey.public_key_multibase
      },
      null,
      2
    )
  );
  assert.equal(fs.existsSync(recipientPublicKeyPath), true);

  const recipientPublicKey = JSON.parse(fs.readFileSync(recipientPublicKeyPath, 'utf8'));
  assert.equal(recipientPublicKey.type, 'ssi_pq_recipient_mlkem_public_key_v1');
  assert.equal(recipientPublicKey.did, recipientDid.did);
  assert.equal(recipientPublicKey.key_id, '#mlkem-1');
  assert.equal(recipientPublicKey.alg, 'ML-KEM-768');
  assert.equal(recipientPublicKey.public_key_multibase.startsWith('z'), true);

  console.log('3. Remetente emitindo credencial com atributos aninhados...');
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
  const schemaHash = core.schemaHashBase64(schema);
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

  const issueStartedAt = Date.now();
  const signedCredential = core.walletIssueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      visiblePaths
    }
  );
  const issueFinishedAt = Date.now();
  const issuedAt = signedCredential.credential.issued_at;
  const issuedAtMs = Date.parse(issuedAt);

  assert.equal(Number.isNaN(issuedAtMs), false);
  assert.equal(issuedAtMs >= issueStartedAt - 1000 && issuedAtMs <= issueFinishedAt + 1000, true);
  assert.match(
    signedCredential.credential.credential_id,
    /^[A-Za-z0-9+/]{43}=$/
  );
  assert.equal(signedCredential.credential.schema_hash, schemaHash);
  assert.equal(signedCredential.credential.issuer_identifier, senderIdentifier);
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
  assert.equal(finalPdfText.includes(winAnsiHex(schemaHash)), true);
  assert.equal(finalPdfText.includes(winAnsiHex(senderIdentifier)), true);
  assert.equal(finalPdfText.includes(winAnsiHex(issuedAt)), true);
  assert.equal(finalPdfText.includes(winAnsiHex('Chave Pública do Assinante')), true);
  assert.equal(
    finalPdfText.includes(winAnsiHex(senderSigningKey.public_key_multibase.slice(0, 48))),
    true
  );

  console.log('4. Remetente encapsulando segredo ML-KEM para o destinatário...');
  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === recipientPublicKey.key_id);
  assert.ok(mlkemKey, 'recipient DID document must contain #mlkem-1');
  assert.equal(mlkemKey.type, recipientPublicKey.alg);
  assert.equal(mlkemKey.public_key_multibase, recipientPublicKey.public_key_multibase);

  const recipientPubKeyBytes = decodeBase58Btc(recipientPublicKey.public_key_multibase);
  const recipientPubKeyBase64url = core.base64urlEncode(recipientPubKeyBytes);
  const encapsulation = core.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecretSender = core.base64urlDecode(encapsulation.sharedSecret);

  console.log('5. Remetente cifrando o PDF final com AES-256-GCM...');
  const encrypted = core.aes256GcmEncrypt(sharedSecretSender, finalPdf);
  const encryptedPdf = Buffer.from(encrypted.ciphertext);
  const iv = Buffer.from(encrypted.nonce);
  const authTag = Buffer.from(encrypted.authTag);

  const encryptedPdfPath = path.join(outputDir, `credencial-aninhada-${runId}.pdf.enc`);
  fs.writeFileSync(encryptedPdfPath, encryptedPdf);
  const diskEncryptedBytes = fs.readFileSync(encryptedPdfPath);

  assert.notEqual(diskEncryptedBytes.subarray(0, 5).toString(), '%PDF-');

  console.log('6. Destinatário descapsulando segredo com a Wallet e decifrando PDF...');
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

  console.log('7. Destinatário verificando PDF e inspecionando atributos revelados...');
  const verification = core.verifySignedCredentialPdf(decryptedPdf, senderDidDocument);
  assert.equal(verification.valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);

  const extractedManifest = core.extractCredentialManifestFromPdf(decryptedPdf);
  const extractedCredential = extractedManifest.signed_credential;
  const extractedDisclosures = extractedCredential.attribute_disclosures;

  assert.equal(
    extractedManifest.document_binding.signing_public_key_multibase,
    senderSigningKey.public_key_multibase
  );
  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(
    extractedCredential.credential.credential_id,
    signedCredential.credential.credential_id
  );
  assert.equal(extractedCredential.credential.schema_hash, schemaHash);
  assert.equal(extractedCredential.credential.issuer_identifier, senderIdentifier);
  assert.equal(extractedCredential.credential.issued_at, issuedAt);
  assert.equal(
    extractedCredential.credential_signature.public_key_multibase,
    senderSigningKey.public_key_multibase
  );
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

  console.log('8. Verificando a assinatura da credencial JSON extraída...');
  const diskExtractedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const diskExtractedCredential = diskExtractedManifest.signed_credential;
  assert.equal(core.verifySignedCredential(diskExtractedCredential, senderDidDocument), true);

  const tamperedJsonCredential = JSON.parse(JSON.stringify(diskExtractedCredential));
  tamperedJsonCredential.credential.credential_id = 'cred_nested_wallet_pdf_mlkem_tampered';
  assert.equal(core.verifySignedCredential(tamperedJsonCredential, senderDidDocument), false);
});
