#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wasm = require('../packages/wasm-node/pkg/ssi_pq_wasm.js');

const repoRoot = path.join(__dirname, '..');
const manifestPath = path.join(repoRoot, 'test-vectors', 'node', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const baseDir = path.dirname(manifestPath);

function asBuffer(value) {
  return Buffer.from(value);
}

function fromB64u(value) {
  return Buffer.from(core.base64urlDecode(value));
}

function fileBytes(record) {
  return fs.readFileSync(path.join(baseDir, record.path));
}

function assertFile(record) {
  const bytes = fileBytes(record);
  assert.equal(bytes.length, record.size, record.path);
  assert.equal(core.sha3_256Base64url(bytes), record.sha3_256_base64url, record.path);
  assert.equal(core.sha3_256Hex(bytes), record.sha3_256_hex, record.path);
  return bytes;
}

function vector(id) {
  const found = manifest.vectors.find((entry) => entry.id === id);
  assert.ok(found, `Missing vector ${id}`);
  return found;
}

function validOrFalse(fn) {
  try {
    return fn();
  } catch (_error) {
    return { valid: false };
  }
}

let core;

async function main() {
  const { createNodeCompatibleCore } = await import('../packages/web/ssi-pq-node-compatible.mjs');
  core = createNodeCompatibleCore(wasm, { disableWalletPersistence: true });

  verifyCanonicalJson();
  verifyHelpers();
  verifyMldsa();
  verifyMlkem();
  verifyAes();
  verifyDidDocument();
  verifyCredential();
  verifyCredentialPdf();
  verifyGenericPdf();
  verifyWalletFlowPublicArtifacts();

  console.log(`WASM verified ${manifest.vectors.length} Node vectors from test-vectors/node/manifest.json`);
}

function verifyCanonicalJson() {
  const item = vector('canonical-json-node-001');
  assert.equal(core.canonicalJson(item.input.json), item.expected.canonicalJson);
  assert.equal(
    core.canonicalJsonHashBase64url(item.input.json),
    item.expected.sha3_256_base64url
  );
}

function verifyHelpers() {
  const item = vector('sha3-base64url-node-001');
  const bytes = fromB64u(item.input.bytes_base64url);
  assert.equal(core.base64urlEncode(bytes), item.expected.base64url);
  assert.equal(bytes.toString('utf8'), item.expected.decoded_utf8);
  assert.equal(core.sha3_256Base64url(bytes), item.expected.sha3_256_base64url);
  assert.equal(core.sha3_256Hex(bytes), item.expected.sha3_256_hex);
}

function verifyMldsa() {
  const item = vector('mldsa-sign-verify-node-001');
  assert.equal(
    core.mldsaVerify(
      item.input.profile,
      item.input.publicKey,
      fromB64u(item.input.message_base64url),
      item.input.context,
      item.input.signature
    ),
    item.expected.valid
  );
  assert.equal(
    core.mldsaVerify(
      item.input.profile,
      item.input.publicKey,
      fromB64u(item.input.tamperedMessage_base64url),
      item.input.context,
      item.input.signature
    ),
    item.expected.tamperedValid
  );
}

function verifyMlkem() {
  const item = vector('mlkem-encapsulate-decapsulate-node-001');
  assert.equal(
    core.mlkemDecapsulate(item.input.profile, item.input.testOnlyPrivateKey, item.input.ciphertext),
    item.expected.sharedSecret
  );
}

function verifyAes() {
  const item = vector('aes256-gcm-node-001');
  const plaintext = core.aes256GcmDecrypt(
    fromB64u(item.input.key_base64url),
    fromB64u(item.expected.ciphertext_base64url),
    fromB64u(item.expected.nonce_base64url),
    fromB64u(item.expected.authTag_base64url),
    fromB64u(item.input.aad_base64url)
  );
  assert.equal(core.base64urlEncode(asBuffer(plaintext)), item.expected.decrypted_plaintext_base64url);
  assert.equal(item.input.plaintext_base64url, item.expected.decrypted_plaintext_base64url);
}

function verifyDidDocument() {
  const item = vector('did-document-node-001');
  assert.equal(core.didVerify(item.input.validDidDocument), item.expected.valid);
  assert.equal(core.didVerify(item.input.tamperedDidDocument), item.expected.tamperedValid);
  assert.equal(
    core.didFingerprintMatchesKeys(item.input.validDidDocument),
    item.expected.fingerprintMatchesKeys
  );
  assert.equal(core.issuerIdentifierBase64(item.input.validDidDocument), item.expected.issuerIdentifier);
}

function verifyCredential() {
  const item = vector('signed-credential-node-001');
  assert.equal(core.schemaHashBase64(item.input.schema), item.expected.schemaHash);
  assert.equal(
    core.verifySignedCredential(item.input.signedCredential, item.input.issuerDidDocument),
    item.expected.valid
  );
  assert.equal(
    core.verifySignedCredential(item.input.tamperedCredential, item.input.issuerDidDocument),
    item.expected.tamperedValid
  );
}

function verifyCredentialPdf() {
  const item = vector('credential-pdf-node-001');
  assertFile(item.files.basePdf);
  const validPdf = assertFile(item.files.validPdf);
  const tamperedPdf = assertFile(item.files.tamperedPdf);
  assert.equal(core.extractCredentialManifestFromPdf(validPdf).type, item.expected.manifestType);
  assert.equal(
    core.verifySignedCredentialPdf(validPdf, item.input.issuerDidDocument).valid,
    item.expected.validVerification.valid
  );
  assert.equal(
    validOrFalse(() => core.verifySignedCredentialPdf(tamperedPdf, item.input.issuerDidDocument))
      .valid,
    item.expected.tamperedVerification.valid
  );
}

function verifyGenericPdf() {
  const item = vector('generic-pdf-node-001');
  assertFile(item.files.basePdf);
  const validPdf = assertFile(item.files.validPdf);
  const tamperedPdf = assertFile(item.files.tamperedPdf);
  assert.equal(core.extractGenericSignatureManifestFromPdf(validPdf).type, item.expected.manifestType);
  assert.equal(
    core.verifySignedGenericPdf(validPdf, item.input.signerDidDocument).valid,
    item.expected.validVerification.valid
  );
  assert.equal(
    validOrFalse(() => core.verifySignedGenericPdf(tamperedPdf, item.input.signerDidDocument)).valid,
    item.expected.tamperedVerification.valid
  );
}

function verifyWalletFlowPublicArtifacts() {
  const item = vector('wallet-flow-node-001');
  const credentialPdf = assertFile(item.files.credentialPdf);
  const genericPdf = assertFile(item.files.genericPdf);
  assertFile(item.files.credentialPdfBase);
  assertFile(item.files.genericPdfBase);
  assert.equal(core.didVerify(item.expected.walletDidDocument), true);
  assert.equal(
    core.verifySignedCredential(item.expected.walletSignedCredential, item.expected.walletDidDocument),
    item.expected.credentialValid
  );
  assert.equal(item.expected.walletDids.length, item.expected.walletDidCount);
  assert.equal(
    core.verifySignedCredentialPdf(credentialPdf, item.expected.walletDidDocument).valid,
    item.expected.credentialPdfValid
  );
  assert.equal(
    core.verifySignedGenericPdf(genericPdf, item.expected.walletDidDocument).valid,
    item.expected.genericPdfValid
  );
  assert.equal(item.expected.walletDid.privateKeys, null);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
