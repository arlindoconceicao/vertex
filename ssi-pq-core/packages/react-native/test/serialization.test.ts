import assert from 'node:assert/strict';
import test from 'node:test';

import {
  jsonToString,
  normalizeFileOperationResult,
  normalizeMobileError,
  optionalJsonToString,
  parseJson,
} from '../src/serialization';

test('jsonToString serializes object inputs for native JSON parameters', () => {
  const input = {
    createdAt: '2026-06-30T00:00:00Z',
    label: 'Issuer',
    nested: {visible: true},
  };

  assert.equal(
    jsonToString(input),
    '{"createdAt":"2026-06-30T00:00:00Z","label":"Issuer","nested":{"visible":true}}',
  );
});

test('jsonToString accepts already serialized JSON and rejects malformed text', () => {
  assert.equal(jsonToString('{"issuedAt":"2026-06-30T00:00:00Z"}'), '{"issuedAt":"2026-06-30T00:00:00Z"}');
  assert.throws(() => jsonToString('{bad json}', 'options'), /options must be valid JSON/);
});

test('optionalJsonToString maps nullish values to null for UniFFI optional strings', () => {
  assert.equal(optionalJsonToString(undefined), null);
  assert.equal(optionalJsonToString(null), null);
  assert.equal(optionalJsonToString({createdAt: '2026-06-30T00:00:00Z'}), '{"createdAt":"2026-06-30T00:00:00Z"}');
});

test('parseJson returns typed objects and wraps parse errors with field context', () => {
  const parsed = parseJson<{valid: boolean}>('{"valid":true}', 'verification result');

  assert.equal(parsed.valid, true);
  assert.throws(() => parseJson('{bad}', 'verification result'), /verification result must be valid JSON/);
});

test('normalizeFileOperationResult validates native file operation JSON', () => {
  assert.deepEqual(
    normalizeFileOperationResult('{"outputUri":"file:///tmp/out.pdf","bytesWritten":1234,"metadataJson":null}'),
    {
      outputUri: 'file:///tmp/out.pdf',
      bytesWritten: 1234,
      metadataJson: null,
    },
  );

  assert.throws(
    () => normalizeFileOperationResult('{"outputUri":"file:///tmp/out.pdf","bytesWritten":"1234"}'),
    /bytesWritten must be a number/,
  );
});

test('normalizeMobileError preserves native error message and classifies common categories', () => {
  assert.deepEqual(normalizeMobileError(new Error('wallet operation failed: bad password')).code, 'Wallet');
  assert.deepEqual(normalizeMobileError(new Error('PDF operation failed: malformed')).code, 'Pdf');
  assert.deepEqual(normalizeMobileError('plain failure').code, 'Unknown');
});
