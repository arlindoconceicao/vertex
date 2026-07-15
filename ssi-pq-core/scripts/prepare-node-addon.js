const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const sourceByPlatform = {
  linux: path.join(root, 'target', 'debug', 'libssi_pq_node.so'),
  darwin: path.join(root, 'target', 'debug', 'libssi_pq_node.dylib'),
  win32: path.join(root, 'target', 'debug', 'ssi_pq_node.dll')
};

const source = sourceByPlatform[process.platform];

if (!source) {
  throw new Error(`Unsupported platform for local N-API build: ${process.platform}`);
}

const outputDir = path.join(root, 'npm');
const output = path.join(outputDir, 'ssi_pq_core.node');

fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(source, output);

console.log(`Prepared ${path.relative(root, output)}`);
