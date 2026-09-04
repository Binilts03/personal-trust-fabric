import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const files = [
  'conformance/core/tests/serialization.test.js',
  'conformance/core/tests/policy-intersect.test.js',
  'conformance/security-canaries/tests/canary-leak.test.js',
  'conformance/security-canaries/tests/tenant-isolation.test.js'
];

const absoluteFiles = files.map((f) => resolve(root, f));

console.log('PTF Conformance: running node --test on:');
for (const f of files) console.log(`  - ${f}`);

const child = spawn(process.execPath, ['--test', ...absoluteFiles], {
  cwd: root,
  stdio: 'inherit'
});

child.on('close', (code) => {
  if (code === 0) {
    console.log('\n✓ Conformance: all 4 suites passed');
    console.log('  - serialization: agent safe view never contains canary, receipt never contains protectedPayload, unknown fields rejected');
    console.log('  - policy-intersect: deny wins, allow intersection is most restrictive, order independence');
    console.log('  - canary-leak: scan all agent/UI/audit surfaces for PTF_CANARY_* pattern, must be absent');
    console.log('  - tenant-isolation: cross-tenant access rejected, composite keys');
  } else {
    console.error(`\n✗ Conformance failed with exit code ${code}`);
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error('Failed to spawn conformance tests:', err);
  process.exit(1);
});
