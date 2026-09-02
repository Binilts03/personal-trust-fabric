import assert from 'node:assert/strict';
import test from 'node:test';

import { registerWebMCPTools } from '../../public/webmcp.js';

test('WebMCP adapter registers four strict top-level tools and routes only agent-authorized actions', async (context) => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent
  };
  context.after(() => Object.assign(globalThis, original));

  const registrations = [];
  const requests = [];
  globalThis.document = {
    modelContext: {
      registerTool: async (definition) => registrations.push(definition)
    }
  };
  globalThis.window = { dispatchEvent() {} };
  globalThis.CustomEvent = class CustomEvent {};
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    const value = path === '/api/agent-view'
      ? { assuranceLabel: 'synthetic', safeView: { persona: [] } }
      : { decision: 'approval_required' };
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  assert.equal(await registerWebMCPTools(), true);
  assert.deepEqual(registrations.map(({ name }) => name), [
    'get_ptf_safe_view',
    'request_membership_status_proof',
    'request_synthetic_invoice_payment',
    'attempt_recipient_redirect_attack'
  ]);
  for (const tool of registrations) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(typeof tool.execute, 'function');
  }
  assert.equal(registrations.some(({ name }) => /approve|correct|reset/.test(name)), false);

  const execution = { signal: new AbortController().signal };
  assert.deepEqual(await registrations[0].execute({}, execution), {
    assuranceLabel: 'synthetic',
    safeView: { persona: [] }
  });
  await registrations[2].execute({ amountMinor: 4250 });
  await registrations[3].execute();

  assert.equal(requests[0].path, '/api/agent-view');
  assert.equal(requests[0].options.signal, execution.signal);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    scenario: 'payment',
    amountMinor: 4250,
    currency: 'USD'
  });
  assert.equal(JSON.parse(requests[2].options.body).recipientId, 'recipient_attacker');
});

test('WebMCP adapter feature-detects unsupported environments without registering tools', async (context) => {
  const originalDocument = globalThis.document;
  context.after(() => { globalThis.document = originalDocument; });
  globalThis.document = {};
  assert.equal(await registerWebMCPTools(), false);
});
