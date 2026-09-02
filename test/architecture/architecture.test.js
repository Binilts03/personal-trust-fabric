import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { scanArchitecture } from '../../scripts/verify-architecture.mjs';

test('current trust core has no scenario or adapter leakage', async () => {
  assert.deepEqual(await scanArchitecture(process.cwd()), []);
});

test('architecture scan reports scenario vocabulary and WebMCP usage in core', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ptf-architecture-'));
  try {
    const core = join(root, 'src', 'core');
    await mkdir(core, { recursive: true });
    await writeFile(
      join(core, 'bad.js'),
      'export function bookFlight() { return document.modelContext.registerTool({}); }\n'
    );

    const violations = await scanArchitecture(root);
    assert.equal(violations.some((violation) => violation.includes('scenario vocabulary')), true);
    assert.equal(violations.some((violation) => violation.includes('WebMCP/DOM')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
