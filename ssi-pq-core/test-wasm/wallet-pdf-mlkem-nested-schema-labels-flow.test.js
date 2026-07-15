/**
 * Este teste reproduz no WebAssembly o fluxo Node:
 * wallet cifrada, DID do remetente e destinatario, schema aninhado,
 * credencial assinada, PDF com labels PT-BR, encapsulamento ML-KEM,
 * cifragem AES-256-GCM, decifragem e verificacao final.
 *
 * Ele nao usa o addon Node npm/ssi_pq_core.node.
 *
 * Comando para rodar:
 *   npm run test:wasm
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const outputDir = path.join(__dirname, '..', 'test-output', 'wasm-nested-labels-platform-flow');
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

test('WASM-only Plataforma flow: PDF cifrado com schema aninhado e labels PT-BR', async () => {
  const { createMemorySnapshotStore, createPersistentWebWallet } = await import(
    '../packages/web/ssi-pq-indexeddb-wallet.mjs'
  );

  wasm.webWalletClearMemory();

  const snapshotStore = createMemorySnapshotStore();
  let wallet = createPersistentWebWallet(wasm, snapshotStore);
  const runId = crypto.randomUUID();
  const senderWallet = `sender-${runId}`;
  const senderPassword = 'senha-remetente-labels-123';
  const recipientWallet = `recipient-${runId}`;
  const recipientPassword = 'senha-destinatario-labels-456';

  await wallet.createWallet(senderWallet, senderPassword, { createdAt });
  const senderDid = await wallet.createDid(senderWallet, senderPassword, {
    label: 'Remetente',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });

  await wallet.createWallet(recipientWallet, recipientPassword, { createdAt });
  const recipientDid = await wallet.createDid(recipientWallet, recipientPassword, {
    label: 'Destinatario',
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt
  });

  writeJson(`sender-wallet-snapshot-${runId}.json`, fromJson(await wallet.exportWalletSnapshot(senderWallet)));
  writeJson(
    `recipient-wallet-snapshot-${runId}.json`,
    fromJson(await wallet.exportWalletSnapshot(recipientWallet))
  );

  wasm.webWalletClearMemory();
  wallet = createPersistentWebWallet(wasm, snapshotStore);

  const senderDidDocument = await wallet.getDidDocument(
    senderWallet,
    senderPassword,
    senderDid.did
  );
  const recipientDidDocument = await wallet.getDidDocument(
    recipientWallet,
    recipientPassword,
    recipientDid.did
  );

  assert.deepEqual(senderDidDocument, senderDid.did_document);
  assert.deepEqual(recipientDidDocument, recipientDid.did_document);
  assert.deepEqual(fromJson(wasm.verifyDidDocumentJson(toJson(senderDidDocument))), {
    valid: true,
    fingerprintMatchesKeys: true
  });
  assert.deepEqual(fromJson(wasm.verifyDidDocumentJson(toJson(recipientDidDocument))), {
    valid: true,
    fingerprintMatchesKeys: true
  });

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

  const schema = fromJson(
    wasm.createSchemaFromAttributesJson(
      toJson(credentialData),
      toJson({ version: '1', createdAt })
    )
  );
  const signedCredential = await wallet.issueCredentialFromSchema(
    senderWallet,
    senderPassword,
    senderDid.did,
    schema,
    credentialData,
    {
      credentialId: 'cred_wasm_nested_wallet_pdf_labels_test',
      issuedAt,
      visiblePaths
    }
  );

  assert.equal(signedCredential.type, 'ssi_signed_credential_v2');
  assert.deepEqual(
    fromJson(wasm.verifySignedCredentialJson(toJson(signedCredential), toJson(senderDidDocument))),
    { valid: true }
  );

  writeJson(`credential-data-${runId}.json`, credentialData);
  writeJson(`schema-${runId}.json`, schema);
  writeJson(`signed-credential-${runId}.json`, signedCredential);

  const pdfBase = wasm.signedCredentialToPdfBytes(
    toJson(signedCredential),
    toJson({ labels: pdfLabels })
  );
  const pdfBaseText = Buffer.from(pdfBase).toString('latin1');

  assert.equal(Buffer.from(pdfBase).subarray(0, 5).toString('latin1'), '%PDF-');
  assert.equal(pdfBaseText.includes(winAnsiHex('Endere\u00e7o')), true);
  assert.equal(pdfBaseText.includes(winAnsiHex('Forma\u00e7\u00e3o')), true);
  assert.equal(
    pdfBaseText.includes(winAnsiHex('Documento > Numero: 123.456.789-00')),
    true
  );
  assert.equal(pdfBaseText.includes(winAnsiHex('Documento > Tipo: CPF')), true);
  assert.equal(
    pdfBaseText.includes(winAnsiHex('Institui\u00e7\u00e3o > Nome: SSI-PQ Academy')),
    true
  );
  assert.equal(pdfBaseText.includes(winAnsiHex('N\u00edvel: Avan\u00e7ado')), true);
  assert.equal(pdfBaseText.includes(winAnsiHex('Cidade: S\u00e3o Paulo')), true);

  fs.writeFileSync(path.join(outputDir, `credencial-labels-base-${runId}.pdf`), Buffer.from(pdfBase));

  const finalPdf = await wallet.embedSignedCredentialInPdf(
    senderWallet,
    senderPassword,
    senderDid.did,
    pdfBase,
    signedCredential,
    { createdAt }
  );
  assert.equal(Buffer.from(finalPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  fs.writeFileSync(
    path.join(outputDir, `credencial-labels-assinada-${runId}.pdf`),
    Buffer.from(finalPdf)
  );

  const mlkemKey = recipientDidDocument.keys.find((key) => key.id === '#mlkem-1');
  assert.ok(mlkemKey, 'recipient DID document must contain #mlkem-1');
  assert.equal(mlkemKey.type, 'ML-KEM-768');

  const recipientPubKeyBytes = wasm.multibaseBase58btcDecode(mlkemKey.public_key_multibase);
  const recipientPubKeyBase64url = wasm.base64urlEncode(recipientPubKeyBytes);
  const encapsulation = wasm.mlkemEncapsulate('ML-KEM-768', recipientPubKeyBase64url);
  const sharedSecretSender = wasm.base64urlDecode(encapsulation.sharedSecret);

  const encrypted = wasm.aes256GcmEncrypt(sharedSecretSender, finalPdf);
  const encryptedPdf = Buffer.from(encrypted.ciphertext);
  const iv = encrypted.nonce;
  const authTag = encrypted.authTag;
  const encryptedPdfPath = path.join(outputDir, `credencial-labels-${runId}.pdf.enc`);

  fs.writeFileSync(encryptedPdfPath, encryptedPdf);
  writeJson(`credencial-labels-encryption-${runId}.json`, {
    mlkemProfile: encapsulation.profile,
    mlkemCiphertext: encapsulation.ciphertext,
    aesNonce: wasm.base64urlEncode(iv),
    aesAuthTag: wasm.base64urlEncode(authTag)
  });

  const diskEncryptedBytes = fs.readFileSync(encryptedPdfPath);
  assert.notEqual(diskEncryptedBytes.subarray(0, 5).toString('latin1'), '%PDF-');

  const recoveredSecretBase64url = await wallet.mlkemDecapsulate(
    recipientWallet,
    recipientPassword,
    recipientDid.did,
    encapsulation.ciphertext
  );
  const sharedSecretRecipient = wasm.base64urlDecode(recoveredSecretBase64url);
  assert.deepEqual(Buffer.from(sharedSecretSender), Buffer.from(sharedSecretRecipient));

  const decryptedPdf = wasm.aes256GcmDecrypt(
    sharedSecretRecipient,
    diskEncryptedBytes,
    iv,
    authTag
  );
  assert.deepEqual(Buffer.from(decryptedPdf), Buffer.from(finalPdf));
  assert.equal(Buffer.from(decryptedPdf).subarray(0, 5).toString('latin1'), '%PDF-');
  fs.writeFileSync(
    path.join(outputDir, `credencial-labels-decifrada-${runId}.pdf`),
    Buffer.from(decryptedPdf)
  );

  const verification = fromJson(
    wasm.verifySignedCredentialPdfJson(decryptedPdf, toJson(senderDidDocument))
  );
  const manifest = fromJson(wasm.extractCredentialManifestFromPdfBytes(decryptedPdf));
  const extractedCredential = manifest.signed_credential;
  const extractedDisclosures = extractedCredential.attribute_disclosures;

  writeJson(`credencial-labels-verification-${runId}.json`, verification);
  writeJson(`credencial-labels-manifest-${runId}.json`, manifest);

  assert.equal(verification.valid, true);
  assert.equal(verification.pdf_base_hash_valid, true);
  assert.equal(verification.credential_signature_valid, true);
  assert.equal(verification.document_binding_signature_valid, true);
  assert.equal(extractedCredential.type, 'ssi_signed_credential_v2');
  assert.equal(
    extractedCredential.credential.credential_id,
    'cred_wasm_nested_wallet_pdf_labels_test'
  );
  assert.deepEqual(
    extractedDisclosures.map((disclosure) => [disclosure.path, disclosure.value]),
    [
      ['subject.endereco.cidade', 'S\u00e3o Paulo'],
      ['subject.formacao.curso', 'Criptografia P\u00f3s-Qu\u00e2ntica'],
      ['subject.formacao.instituicao.nome', 'SSI-PQ Academy'],
      ['subject.nivel', 'Avan\u00e7ado'],
      ['subject.titular.documento.numero', '123.456.789-00'],
      ['subject.titular.documento.tipo', 'CPF'],
      ['subject.titular.nome', 'Alice Silva']
    ]
  );
});
