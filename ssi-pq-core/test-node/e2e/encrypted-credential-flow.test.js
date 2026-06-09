/**
 * Este teste cobre um fluxo ponta a ponta de credencial cifrada:
 * o remetente cria e assina uma credencial, cifra o JSON para o
 * destinatário usando ML-KEM-768 e AES-256-GCM, e o destinatário
 * decifra, compara o conteúdo recuperado e verifica a assinatura.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/e2e/encrypted-credential-flow.test.js
 */

const assert = require('node:assert/strict');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_VALUES = new Map([...BASE58_ALPHABET].map((char, index) => [char, index]));

function decodeBase58btcMultibase(value) {
  assert.equal(value.startsWith('z'), true);

  const encoded = value.slice(1);
  const bytes = [0];

  for (const char of encoded) {
    const value = BASE58_VALUES.get(char);

    assert.notEqual(value, undefined, `invalid base58btc character: ${char}`);

    let carry = value;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (const char of encoded) {
    if (char !== '1') {
      break;
    }
    bytes.push(0);
  }

  return Buffer.from(bytes.reverse());
}

function base64urlToBuffer(value) {
  return Buffer.from(core.base64urlDecode(value));
}

function recipientKemPublicKeyBase64url(didDocument) {
  const key = didDocument.keys.find((candidate) => candidate.id === '#mlkem-1');

  assert.ok(key, 'recipient DID document must contain #mlkem-1');
  assert.equal(key.type, 'ML-KEM-768');

  return core.base64urlEncode(decodeBase58btcMultibase(key.public_key_multibase));
}

function encryptJsonForRecipient(jsonPayload, recipientDidDocument) {
  const kem = core.mlkemEncapsulate(
    'ML-KEM-768',
    recipientKemPublicKeyBase64url(recipientDidDocument)
  );
  const aesKey = base64urlToBuffer(kem.sharedSecret);
  const aad = Buffer.from(
    JSON.stringify({
      type: 'ssi_test_encrypted_credential_v1',
      to: recipientDidDocument.id,
      kem: 'ML-KEM-768',
      aead: 'AES-256-GCM'
    }),
    'utf8'
  );
  const plaintext = Buffer.from(JSON.stringify(jsonPayload), 'utf8');
  const encrypted = core.aes256GcmEncrypt(aesKey, plaintext, aad);
  const nonce = Buffer.from(encrypted.nonce);
  const ciphertext = Buffer.from(encrypted.ciphertext);
  const tag = Buffer.from(encrypted.authTag);

  return {
    type: 'ssi_test_encrypted_credential_v1',
    to: recipientDidDocument.id,
    alg: {
      kem: 'ML-KEM-768',
      aead: 'AES-256-GCM'
    },
    kid: {
      recipient_kem_key_id: '#mlkem-1'
    },
    encapsulated_key: kem.ciphertext,
    nonce: core.base64urlEncode(nonce),
    aad: core.base64urlEncode(aad),
    ciphertext: core.base64urlEncode(ciphertext),
    tag: core.base64urlEncode(tag)
  };
}

function decryptJsonForRecipient(envelope, recipientPrivateKeyBase64url) {
  const sharedSecret = core.mlkemDecapsulate(
    envelope.alg.kem,
    recipientPrivateKeyBase64url,
    envelope.encapsulated_key
  );
  const aesKey = base64urlToBuffer(sharedSecret);
  const plaintext = Buffer.from(
    core.aes256GcmDecrypt(
      aesKey,
      base64urlToBuffer(envelope.ciphertext),
      base64urlToBuffer(envelope.nonce),
      base64urlToBuffer(envelope.tag),
      base64urlToBuffer(envelope.aad)
    )
  );

  return JSON.parse(plaintext.toString('utf8'));
}

test('sender signs credential, encrypts it to recipient, and recipient decrypts and verifies it', (t) => {
  const sender = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });
  const recipient = core.createDid({
    mldsa: 'ML-DSA-65',
    mlkem: 'ML-KEM-768',
    createdAt: '2026-05-27T00:00:00Z'
  });

  const schema = core.createSchemaFromAttributes(
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      nivel: 'Avancado',
      carga_horaria: 40
    },
    {
      version: '1',
      createdAt: '2026-05-27T00:00:00Z'
    }
  );

  const signedCredential = core.issueCredentialFromSchema(
    schema,
    {
      nome: 'Ana Silva',
      curso: 'Criptografia Aplicada',
      nivel: 'Avancado',
      carga_horaria: 40
    },
    sender.didDocument,
    sender.privateKeys.mldsaPrivateKey,
    {
      credentialId: 'cred_encrypted_flow_test',
      issuedAt: '2026-05-27T00:00:00Z',
      visiblePaths: ['nome', 'curso', 'carga_horaria']
    }
  );

  assert.equal(core.verifySignedCredential(signedCredential, sender.didDocument), true);

  const encryptedEnvelope = encryptJsonForRecipient(signedCredential, recipient.didDocument);
  const decryptedCredential = decryptJsonForRecipient(
    encryptedEnvelope,
    recipient.privateKeys.mlkemPrivateKey
  );

  assert.deepEqual(decryptedCredential, signedCredential);
  assert.equal(core.verifySignedCredential(decryptedCredential, sender.didDocument), true);

  const visibleAttributes = Object.fromEntries(
    decryptedCredential.attribute_disclosures.map((disclosure) => [
      disclosure.path.replace(/^subject\./, ''),
      disclosure.value
    ])
  );

  t.diagnostic(
    JSON.stringify(
      {
        decryptedCredential: decryptedCredential.credential,
        visibleAttributes
      },
      null,
      2
    )
  );

  assert.deepEqual(visibleAttributes, {
    carga_horaria: 40,
    curso: 'Criptografia Aplicada',
    nome: 'Ana Silva'
  });
});
