import assert from 'node:assert/strict';
import test from 'node:test';

test('detected Vercel Node entrypoint exports a request handler', async () => {
  const serverModule = await import('../../src/server.js');
  assert.equal(typeof serverModule.default, 'function');
});
