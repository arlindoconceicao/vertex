#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const findings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function walkFiles(relativeDir, predicate = () => true) {
  const base = path.join(root, relativeDir);
  const out = [];

  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const relative = path.relative(root, full);
      if (entry.isDirectory()) {
        if (
          relative.includes('node_modules') ||
          relative.includes('/Generated') ||
          relative.includes('/uniffi/')
        ) {
          continue;
        }
        visit(full);
        continue;
      }
      if (entry.isFile() && predicate(relative)) {
        out.push(relative);
      }
    }
  }

  visit(base);
  return out;
}

function pass(label) {
  findings.push({ status: 'PASS', label });
}

function fail(label, detail) {
  findings.push({ status: 'FAIL', label, detail });
}

function assertContains(file, pattern, label) {
  const content = read(file);
  if (pattern.test(content)) {
    pass(label);
  } else {
    fail(label, `${file} does not match ${pattern}`);
  }
}

function assertNotContains(file, pattern, label) {
  const content = read(file);
  if (!pattern.test(content)) {
    pass(label);
  } else {
    fail(label, `${file} unexpectedly matches ${pattern}`);
  }
}

function assertNoProductionLogs() {
  const files = [
    ...walkFiles('packages/react-native/src', (file) => file.endsWith('.ts')),
    ...walkFiles('packages/react-native/android/src/main/java/com', (file) => file.endsWith('.kt')),
    ...walkFiles('packages/react-native/ios/Sources', (file) => /\.(swift|m|mm)$/.test(file)),
    ...walkFiles('crates/ssi-pq-mobile-ffi/src', (file) => file.endsWith('.rs')),
  ];
  const logPattern = /\b(console\.(log|debug|info|warn|error)|Log\.(d|i|w|e|v)|println!|eprintln!|dbg!)\b/;
  const offenders = files.filter((file) => logPattern.test(read(file)));
  if (offenders.length === 0) {
    pass('production mobile code does not log secrets or operational data');
  } else {
    fail('production mobile code does not log secrets or operational data', offenders.join(', '));
  }
}

function assertPublicRnApiSafe() {
  const forbidden = [
    'mldsaGenerateKeypair',
    'mldsaSign',
    'mlkemGenerateKeypair',
    'mlkemEncapsulate',
    'mldsaPrivateKey',
    'mlkemPrivateKey',
    'privateKeys',
    'testOnlyPrivateKey',
  ];
  for (const file of ['packages/react-native/src/index.ts', 'packages/react-native/src/NativeSsiPq.ts']) {
    const content = read(file);
    const present = forbidden.filter((name) => content.includes(name));
    if (present.length === 0) {
      pass(`${file} omits unsafe/private-key API names`);
    } else {
      fail(`${file} omits unsafe/private-key API names`, present.join(', '));
    }
  }

  const nodeCompatible = read('packages/react-native/src/node-compatible.ts');
  if (
    nodeCompatible.includes('export const unsafe') &&
    nodeCompatible.includes('private keys stay native')
  ) {
    pass('node-compatible facade isolates unsafe Node aliases');
  } else {
    fail('node-compatible facade isolates unsafe Node aliases', 'missing unsafe namespace guard');
  }
}

function assertBackgroundExecution() {
  assertContains(
    'packages/react-native/android/src/main/java/com/ssipq/reactnative/NativeSsiPqModule.kt',
    /ExecutorService[\s\S]*executor\.execute/,
    'Android wallet/PDF work runs on a background executor'
  );
  assertContains(
    'packages/react-native/ios/Sources/SsiPqReactNative.swift',
    /DispatchQueue[\s\S]*workQueue\.async/,
    'iOS wallet/PDF work runs on a background queue'
  );
}

function assertPrivateStorageAndTempCleanup() {
  assertContains(
    'packages/react-native/android/src/main/java/com/ssipq/reactnative/NativeSsiPqModule.kt',
    /noBackupFilesDir/,
    'Android wallet state uses app-private no-backup storage'
  );
  assertContains(
    'packages/react-native/android/src/main/java/com/ssipq/reactnative/NativeSsiPqModule.kt',
    /finally[\s\S]*target\.delete\(\)/,
    'Android content URI temporary files are deleted'
  );
  assertContains(
    'packages/react-native/ios/Sources/SsiPqReactNative.swift',
    /applicationSupportDirectory[\s\S]*isExcludedFromBackup/,
    'iOS wallet state uses app-private application support storage excluded from backup'
  );
}

function assertWalletAndZeroize() {
  assertContains(
    'crates/ssi-pq-core/src/wallet_storage.rs',
    /Zeroizing::new\(plaintext\)/,
    'wallet storage plaintext state is zeroized after parsing'
  );
  assertContains(
    'crates/ssi-pq-core/src/wallet_storage.rs',
    /row_key\.zeroize\(\)/,
    'wallet storage row keys are zeroized'
  );
  assertContains(
    'crates/ssi-pq-core/src/wallet.rs',
    /PRAGMA temp_store = MEMORY/,
    'SQLCipher wallet temp store stays in memory'
  );
  assertNotContains(
    'crates/ssi-pq-core/src/wallet_storage.rs',
    /password is invalid or .*corrupt/i,
    'storage wallet invalid-password error does not reveal corruption details'
  );
  assertNotContains(
    'crates/ssi-pq-core/src/wallet.rs',
    /password is invalid or .*corrupt/i,
    'SQLCipher wallet invalid-password error does not reveal corruption details'
  );
}

function assertVectorsStillVerify() {
  const manifest = JSON.parse(read('test-vectors/node/manifest.json'));
  const allVectorsHaveVerifiers = manifest.vectors.every((vector) =>
    ['node', 'wasm', 'android', 'ios'].every((platform) => vector.verifyWith.includes(platform))
  );
  if (manifest.vectors.length >= 10 && allVectorsHaveVerifiers) {
    pass('generated documents remain covered by Node/WASM/Android/iOS vector contract');
  } else {
    fail('generated documents remain covered by Node/WASM/Android/iOS vector contract');
  }
}

assertPublicRnApiSafe();
assertNoProductionLogs();
assertBackgroundExecution();
assertPrivateStorageAndTempCleanup();
assertWalletAndZeroize();
assertVectorsStillVerify();

for (const finding of findings) {
  const suffix = finding.detail ? `: ${finding.detail}` : '';
  console.log(`${finding.status}: ${finding.label}${suffix}`);
}

const failures = findings.filter((finding) => finding.status === 'FAIL');
if (failures.length > 0) {
  process.exit(1);
}
