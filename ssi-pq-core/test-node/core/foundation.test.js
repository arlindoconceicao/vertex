/**
 * Este teste cobre as primitivas de base expostas para Node.js,
 * incluindo JSON canônico com ordenação recursiva de chaves,
 * hash SHA3-256, codificação base64url sem padding, lista de
 * perfis ML-DSA/ML-KEM suportados e tratamento de JSON inválido.
 *
 * Comando para rodar:
 *   npm run build && \
 *   node --test test-node/core/foundation.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const core = require('../../npm/ssi_pq_core.node');

test('canonical JSON sorts object keys recursively', () => {
  const left = '{"z":1,"a":{"b":2,"a":1}}';
  const right = '{"a":{"a":1,"b":2},"z":1}';

  assert.equal(core.canonicalJson(left), right);
  assert.equal(core.canonicalJsonHashBase64url(left), core.canonicalJsonHashBase64url(right));
});

test('canonical JSON keeps array order', () => {
  assert.equal(core.canonicalJson('[{"b":2,"a":1},3]'), '[{"a":1,"b":2},3]');
});

test('canonical JSON follows RFC 8785 primitive serialization samples', () => {
  const input = JSON.stringify({
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
    string: "\u20ac$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false]
  });

  assert.equal(
    core.canonicalJson(input),
    "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}"
  );
});

test('canonical JSON sorts object keys with RFC 8785 UTF-16 ordering', () => {
  const input = '{"€":"Euro Sign","\\r":"Carriage Return","דּ":"Hebrew Letter Dalet With Dagesh","1":"One","😀":"Emoji: Grinning Face","":"Control","ö":"Latin Small Letter O With Diaeresis"}';

  assert.equal(
    core.canonicalJson(input),
    '{"\\r":"Carriage Return","1":"One","":"Control","ö":"Latin Small Letter O With Diaeresis","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}'
  );
});

test('canonical JSON can be generated directly from a JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssi-pq-core-jcs-'));
  const file = path.join(dir, 'sample.json');
  fs.writeFileSync(file, '{ "z": 1, "a": { "b": 2, "a": 1 } }\n', 'utf8');

  assert.equal(core.canonicalJsonFile(file), '{"a":{"a":1,"b":2},"z":1}');
});

test('SHA3-256 matches the empty-string test vector', () => {
  assert.equal(
    core.sha3_256Hex(Buffer.alloc(0)),
    'a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a'
  );
});

test('base64url roundtrip omits padding', () => {
  const original = Buffer.from('ssi-pq-core', 'utf8');
  const encoded = core.base64urlEncode(original);

  assert.equal(encoded, 'c3NpLXBxLWNvcmU');
  assert.equal(encoded.includes('='), false);
  assert.deepEqual(Buffer.from(core.base64urlDecode(encoded)), original);
});

test('secureRandomKey returns fresh key material with the requested size', () => {
  const key16 = Buffer.from(core.secureRandomKey(16));
  const key32 = Buffer.from(core.secureRandomKey(32));
  const expandedKey64 = Buffer.from(core.secureRandomKey(64));
  const anotherExpandedKey64 = Buffer.from(core.secureRandomKey(64));

  assert.equal(key16.length, 16);
  assert.equal(key32.length, 32);
  assert.equal(expandedKey64.length, 64);
  assert.notDeepEqual(expandedKey64, anotherExpandedKey64);
});

test('secureRandomKey output can be consumed by AES-256-GCM', () => {
  const key = core.secureRandomKey(32);
  const plaintext = Buffer.from('chave gerada no core rust', 'utf8');
  const aad = Buffer.from('secureRandomKey test', 'utf8');

  const encrypted = core.aes256GcmEncrypt(key, plaintext, aad);
  const decrypted = Buffer.from(
    core.aes256GcmDecrypt(key, encrypted.ciphertext, encrypted.nonce, encrypted.authTag, aad)
  );

  assert.deepEqual(decrypted, plaintext);
});

test('secureRandomKey rejects zero-length keys', () => {
  assert.throws(() => core.secureRandomKey(0), /greater than zero/);
});

test('supported profiles include every planned ML-DSA and ML-KEM size', () => {
  assert.deepEqual(core.supportedProfiles(), [
    'ML-DSA-44',
    'ML-DSA-65',
    'ML-DSA-87',
    'ML-KEM-512',
    'ML-KEM-768',
    'ML-KEM-1024'
  ]);
});

test('invalid JSON becomes a JavaScript error', () => {
  assert.throws(() => core.canonicalJson('{"a":'), /invalid JSON/);
});

test('duplicate JSON object property names are rejected for JCS input', () => {
  assert.throws(() => core.canonicalJson('{"a":1,"a":2}'), /duplicate JSON property name: a/);
});
