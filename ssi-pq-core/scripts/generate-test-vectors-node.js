#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const core = require('../npm/ssi_pq_core.node');
const packageJson = require('../package.json');

const repoRoot = path.join(__dirname, '..');
const outRoot = path.join(repoRoot, 'test-vectors', 'node');
const filesDir = path.join(outRoot, 'files');

const createdAt = '2026-06-30T00:00:00Z';
const issuedAt = '2026-06-30T00:00:00Z';
const verifyWith = ['node', 'wasm', 'android', 'ios'];
const generatedBy = {
  platform: 'node',
  packageName: packageJson.name,
  packageVersion: packageJson.version,
  runtime: process.version,
  addon: 'npm/ssi_pq_core.node'
};

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(filesDir, { recursive: true });

function asBuffer(value) {
  return Buffer.from(value);
}

function b64u(bytes) {
  return core.base64urlEncode(asBuffer(bytes));
}

function fromB64u(value) {
  return Buffer.from(core.base64urlDecode(value));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fileRecord(fileName, bytes) {
  const data = asBuffer(bytes);
  fs.writeFileSync(path.join(filesDir, fileName), data);
  return {
    path: `files/${fileName}`,
    size: data.length,
    sha3_256_base64url: core.sha3_256Base64url(data),
    sha3_256_hex: core.sha3_256Hex(data)
  };
}

function tamperByte(bytes, offset) {
  const out = Buffer.from(bytes);
  out[offset] ^= 1;
  return out;
}

function decodeBase58Btc(multibaseValue) {
  if (multibaseValue[0] !== 'z') {
    throw new Error('Not base58btc multibase');
  }

  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const value = multibaseValue.slice(1);
  let decoded = 0n;

  for (const char of value) {
    const index = alphabet.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base58btc character: ${char}`);
    }
    decoded = decoded * 58n + BigInt(index);
  }

  let hex = decoded.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  const bytes = Buffer.from(hex, 'hex');
  let leadingZeros = 0;
  while (value[leadingZeros] === '1') {
    leadingZeros += 1;
  }

  return Buffer.concat([Buffer.alloc(leadingZeros), bytes]);
}

function mlkemPublicKeyBase64urlFromDidDocument(didDocument) {
  const mlkemKey = didDocument.keys.find((key) => key.id === '#mlkem-1');
  if (!mlkemKey) {
    throw new Error('DID Document must contain #mlkem-1');
  }
  return b64u(decodeBase58Btc(mlkemKey.public_key_multibase));
}

function minimalPdfBase() {
  return Buffer.from(
    '%PDF-1.4\n%ABCD\n' +
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n' +
      'xref\n0 4\n' +
      '0000000000 65535 f \n' +
      '0000000015 00000 n \n' +
      '0000000064 00000 n \n' +
      '0000000121 00000 n \n' +
      'trailer\n<< /Size 4 /Root 1 0 R >>\n' +
      'startxref\n192\n' +
      '%%EOF\n',
    'latin1'
  );
}

function withMetadata(vector) {
  return {
    ...vector,
    generatedBy,
    verifyWith
  };
}

const vectors = [];

const canonicalInput = '{"z":2,"a":{"b":2,"a":1},"list":[3,{"y":true,"x":null}]}';
const canonicalJson = core.canonicalJson(canonicalInput);
vectors.push(
  withMetadata({
    id: 'canonical-json-node-001',
    category: 'canonical-json',
    input: {
      json: canonicalInput
    },
    expected: {
      canonicalJson,
      sha3_256_base64url: core.canonicalJsonHashBase64url(canonicalInput)
    },
    files: {}
  })
);

const helperBytes = Buffer.from('SSI-PQ interoperability vector\n', 'utf8');
const helperEncoded = b64u(helperBytes);
vectors.push(
  withMetadata({
    id: 'sha3-base64url-node-001',
    category: 'helpers',
    input: {
      bytes_base64url: helperEncoded,
      text_utf8: helperBytes.toString('utf8')
    },
    expected: {
      base64url: helperEncoded,
      decoded_utf8: fromB64u(helperEncoded).toString('utf8'),
      sha3_256_base64url: core.sha3_256Base64url(helperBytes),
      sha3_256_hex: core.sha3_256Hex(helperBytes)
    },
    files: {}
  })
);

const mldsaKeyPair = core.mldsaGenerateKeypair('ML-DSA-65');
const mldsaMessage = Buffer.from('ML-DSA interoperability message', 'utf8');
const mldsaContext = 'SSI_PQ_TEST_VECTOR_ML_DSA_V1';
const mldsaSignature = core.mldsaSign(
  'ML-DSA-65',
  mldsaKeyPair.privateKey,
  mldsaMessage,
  mldsaContext
);
vectors.push(
  withMetadata({
    id: 'mldsa-sign-verify-node-001',
    category: 'mldsa',
    input: {
      profile: 'ML-DSA-65',
      publicKey: mldsaKeyPair.publicKey,
      message_base64url: b64u(mldsaMessage),
      tamperedMessage_base64url: b64u(Buffer.from('ML-DSA tampered message', 'utf8')),
      context: mldsaContext,
      signature: mldsaSignature
    },
    expected: {
      valid: true,
      tamperedValid: false
    },
    files: {}
  })
);

const mlkemKeyPair = core.mlkemGenerateKeypair('ML-KEM-768');
const mlkemEncapsulation = core.mlkemEncapsulate('ML-KEM-768', mlkemKeyPair.publicKey);
vectors.push(
  withMetadata({
    id: 'mlkem-encapsulate-decapsulate-node-001',
    category: 'mlkem',
    input: {
      profile: 'ML-KEM-768',
      publicKey: mlkemKeyPair.publicKey,
      testOnlyPrivateKey: mlkemKeyPair.privateKey,
      ciphertext: mlkemEncapsulation.ciphertext
    },
    expected: {
      sharedSecret: mlkemEncapsulation.sharedSecret
    },
    files: {}
  })
);

const aesKey = Buffer.alloc(32, 7);
const aesPlaintext = Buffer.from('credential payload encrypted for a vector', 'utf8');
const aesAad = Buffer.from('ssi-pq-vector-aad', 'utf8');
const aesEncrypted = core.aes256GcmEncrypt(aesKey, aesPlaintext, aesAad);
vectors.push(
  withMetadata({
    id: 'aes256-gcm-node-001',
    category: 'aes256-gcm',
    input: {
      key_base64url: b64u(aesKey),
      plaintext_base64url: b64u(aesPlaintext),
      aad_base64url: b64u(aesAad)
    },
    expected: {
      ciphertext_base64url: b64u(aesEncrypted.ciphertext),
      nonce_base64url: b64u(aesEncrypted.nonce),
      authTag_base64url: b64u(aesEncrypted.authTag),
      decrypted_plaintext_base64url: b64u(aesPlaintext)
    },
    files: {}
  })
);

const issuer = core.createDid({
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt,
  didDocCid: 'bafy-test-vector-node-issuer'
});
const tamperedDidDocument = clone(issuer.didDocument);
tamperedDidDocument.status = 'revoked';
vectors.push(
  withMetadata({
    id: 'did-document-node-001',
    category: 'did-document',
    input: {
      validDidDocument: issuer.didDocument,
      tamperedDidDocument
    },
    expected: {
      valid: true,
      tamperedValid: false,
      fingerprintMatchesKeys: true,
      did: issuer.did,
      issuerIdentifier: core.issuerIdentifierBase64(issuer.didDocument)
    },
    files: {}
  })
);

const attributes = {
  holder: {
    name: 'Ana Silva',
    document: {
      type: 'CPF',
      number: '123.456.789-00'
    }
  },
  course: 'Applied Cryptography',
  level: 'advanced',
  workload_hours: 40
};
const schema = core.createSchemaFromAttributes(attributes, {
  version: '1',
  createdAt
});
const signedCredential = core.issueCredentialFromSchema(
  schema,
  attributes,
  issuer.didDocument,
  issuer.privateKeys.mldsaPrivateKey,
  {
    credentialId: 'urn:ssi-pq:test-vector:credential:node:001',
    issuedAt,
    visiblePaths: ['holder.name', 'course', 'level']
  }
);
const tamperedCredential = clone(signedCredential);
tamperedCredential.credential.credential_id = 'urn:ssi-pq:test-vector:credential:tampered';
vectors.push(
  withMetadata({
    id: 'signed-credential-node-001',
    category: 'signed-credential',
    input: {
      schema,
      attributes,
      issuerDidDocument: issuer.didDocument,
      signedCredential,
      tamperedCredential
    },
    expected: {
      schemaHash: core.schemaHashBase64(schema),
      valid: true,
      tamperedValid: false
    },
    files: {}
  })
);

const pdfLabels = {
  'holder.name': 'Holder name',
  course: 'Course',
  level: 'Level'
};
const credentialPdfBase = Buffer.from(
  core.signedCredentialToPdf(signedCredential, {
    labels: pdfLabels
  })
);
const credentialPdf = Buffer.from(
  core.embedSignedCredentialInPdf(
    credentialPdfBase,
    signedCredential,
    issuer.didDocument,
    issuer.privateKeys.mldsaPrivateKey,
    {
      createdAt,
      didDocCid: 'bafy-test-vector-node-issuer'
    }
  )
);
const tamperedCredentialPdf = tamperByte(credentialPdf, 20);
vectors.push(
  withMetadata({
    id: 'credential-pdf-node-001',
    category: 'credential-pdf',
    input: {
      issuerDidDocument: issuer.didDocument,
      signedCredential,
      renderOptions: {
        labels: pdfLabels
      }
    },
    expected: {
      validVerification: core.verifySignedCredentialPdf(credentialPdf, issuer.didDocument),
      tamperedVerification: core.verifySignedCredentialPdf(tamperedCredentialPdf, issuer.didDocument),
      manifestType: core.extractCredentialManifestFromPdf(credentialPdf).type
    },
    files: {
      basePdf: fileRecord('credential-base-node.pdf', credentialPdfBase),
      validPdf: fileRecord('credential-valid-node.pdf', credentialPdf),
      tamperedPdf: fileRecord('credential-tampered-node.pdf', tamperedCredentialPdf)
    }
  })
);

const walletPath = path.join(outRoot, '.wallet-flow-node.db');
const walletPassword = 'test-vector wallet password 123';
const walletInfo = core.walletCreate(walletPath, walletPassword, { createdAt });
const walletDid = core.walletCreateDid(walletPath, walletPassword, {
  label: 'Node test vector issuer',
  mldsa: 'ML-DSA-65',
  mlkem: 'ML-KEM-768',
  createdAt,
  didDocCid: 'bafy-test-vector-node-wallet'
});
const walletDids = core.walletListDids(walletPath, walletPassword);
const walletDidDocument = core.walletGetDidDocument(walletPath, walletPassword, walletDid.did);
const walletSignedCredential = core.walletIssueCredentialFromSchema(
  walletPath,
  walletPassword,
  walletDid.did,
  schema,
  attributes,
  {
    credentialId: 'urn:ssi-pq:test-vector:wallet-credential:node:001',
    issuedAt,
    visiblePaths: ['holder.name', 'course', 'level']
  }
);
const walletCredentialPdfBase = Buffer.from(
  core.signedCredentialToPdf(walletSignedCredential, { labels: pdfLabels })
);
const walletCredentialPdf = Buffer.from(
  core.walletEmbedSignedCredentialInPdf(
    walletPath,
    walletPassword,
    walletDid.did,
    walletCredentialPdfBase,
    walletSignedCredential,
    {
      createdAt,
      didDocCid: 'bafy-test-vector-node-wallet'
    }
  )
);
const genericPdfBase = minimalPdfBase();
const genericPdf = Buffer.from(
  core.walletSignGenericPdf(walletPath, walletPassword, walletDid.did, genericPdfBase, {
    createdAt,
    visualSignature: {
      mode: 'visible',
      placement: 'firstPageFooter',
      text: 'SSI-PQ test vector'
    }
  })
);
const tamperedGenericPdf = tamperByte(genericPdf, 20);
const walletMlkemPublicKey = mlkemPublicKeyBase64urlFromDidDocument(walletDidDocument);
const walletEncapsulation = core.mlkemEncapsulate('ML-KEM-768', walletMlkemPublicKey);
const walletSharedSecret = core.walletMlkemDecapsulate(
  walletPath,
  walletPassword,
  walletDid.did,
  walletEncapsulation.ciphertext
);
fs.rmSync(walletPath, { force: true });

vectors.push(
  withMetadata({
    id: 'generic-pdf-node-001',
    category: 'generic-pdf',
    input: {
      signerDidDocument: walletDidDocument,
      signOptions: {
        createdAt,
        visualSignature: {
          mode: 'visible',
          placement: 'firstPageFooter',
          text: 'SSI-PQ test vector'
        }
      }
    },
    expected: {
      validVerification: core.verifySignedGenericPdf(genericPdf, walletDidDocument),
      tamperedVerification: core.verifySignedGenericPdf(tamperedGenericPdf, walletDidDocument),
      manifestType: core.extractGenericSignatureManifestFromPdf(genericPdf).type
    },
    files: {
      basePdf: fileRecord('generic-base-node.pdf', genericPdfBase),
      validPdf: fileRecord('generic-valid-node.pdf', genericPdf),
      tamperedPdf: fileRecord('generic-tampered-node.pdf', tamperedGenericPdf)
    }
  })
);

vectors.push(
  withMetadata({
    id: 'wallet-flow-node-001',
    category: 'wallet-flow',
    input: {
      walletOptions: {
        createdAt
      },
      didOptions: {
        label: 'Node test vector issuer',
        mldsa: 'ML-DSA-65',
        mlkem: 'ML-KEM-768',
        createdAt,
        didDocCid: 'bafy-test-vector-node-wallet'
      },
      schema,
      attributes,
      credentialOptions: {
        credentialId: 'urn:ssi-pq:test-vector:wallet-credential:node:001',
        issuedAt,
        visiblePaths: ['holder.name', 'course', 'level']
      },
      walletPrivateKeysExported: false
    },
    expected: {
      walletInfo,
      walletDid: {
        did: walletDid.did,
        label: walletDid.label,
        privateKeys: null
      },
      walletDids,
      walletDidDocument,
      walletSignedCredential,
      walletDidCount: 1,
      credentialValid: true,
      credentialPdfValid: true,
      genericPdfValid: true,
      mlkem: {
        ciphertext: walletEncapsulation.ciphertext,
        sharedSecret: walletSharedSecret,
        matchesEncapsulation: walletSharedSecret === walletEncapsulation.sharedSecret
      }
    },
    files: {
      credentialPdfBase: fileRecord('wallet-credential-base-node.pdf', walletCredentialPdfBase),
      credentialPdf: fileRecord('wallet-credential-valid-node.pdf', walletCredentialPdf),
      genericPdfBase: fileRecord('wallet-generic-base-node.pdf', genericPdfBase),
      genericPdf: fileRecord('wallet-generic-valid-node.pdf', genericPdf)
    }
  })
);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedBy,
  description: 'Node-generated SSI-PQ interoperability vectors.',
  vectors
};

fs.writeFileSync(path.join(outRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Generated ${vectors.length} vectors at ${path.relative(repoRoot, outRoot)}`);
