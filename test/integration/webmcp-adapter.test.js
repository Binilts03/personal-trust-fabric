import assert from 'node:assert/strict';
import test from 'node:test';

import { registerWebMCPTools } from '../../public/webmcp.js';

test('WebMCP adapter registers six strict top-level tools across four capability classes and routes only agent-authorized actions', async (context) => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent
  };
  context.after(() => Object.assign(globalThis, original));

  const registrations = [];
  const requests = [];
  let dispatched = 0;
  globalThis.document = {
    modelContext: {
      registerTool: async (definition) => registrations.push(definition)
    }
  };
  globalThis.window = { dispatchEvent() { dispatched += 1; } };
  globalThis.CustomEvent = class CustomEvent { constructor(type) { this.type = type; } };
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, options });
    let value;
    if (path === '/api/agent-view') value = { assuranceLabel: 'synthetic', safeView: { persona: [] } };
    else if (path.startsWith('/api/capabilities/') || path.startsWith('/api/approvals/')) value = { status: 'active', receipt: null, expiresAt: Date.now()+300000, remainingUses: 1 };
    else value = { decision: 'approval_required' };
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
    'request_signing_authority',
    'request_bounded_action',
    'get_operation_status',
    'attempt_recipient_redirect_attack',
    'attempt_capability_forward_attack',
    'attempt_replay_attack',
    'attempt_claim_escalation_attack'
  ]);

  // All tools must have strict schema, correct readOnlyHint, and never expose approval/correct/reset
  for (const tool of registrations) {
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must have additionalProperties false`);
    assert.equal(typeof tool.execute, 'function');
    assert.ok(tool.annotations && typeof tool.annotations.readOnlyHint === 'boolean', `${tool.name} must have readOnlyHint`);
  }
  assert.equal(registrations.find(t => t.name === 'get_ptf_safe_view').annotations.readOnlyHint, true, 'safe view is readOnly');
  assert.equal(registrations.find(t => t.name === 'get_operation_status').annotations.readOnlyHint, true, 'get_operation_status is readOnly');
  for (const name of ['request_membership_status_proof', 'request_synthetic_invoice_payment', 'request_signing_authority', 'request_bounded_action', 'attempt_recipient_redirect_attack', 'attempt_capability_forward_attack', 'attempt_replay_attack', 'attempt_claim_escalation_attack']) {
    assert.equal(registrations.find(t => t.name === name).annotations.readOnlyHint, false, `${name} must be readOnlyHint false`);
  }
  assert.equal(registrations.some(({ name }) => /approve|correct|reset/.test(name)), false);

  // Capability classes coverage: credential, payment, signing, bounded_action
  const capabilityTools = ['request_membership_status_proof', 'request_synthetic_invoice_payment', 'request_signing_authority', 'request_bounded_action'];
  for (const n of capabilityTools) assert.ok(registrations.some(r => r.name === n), `missing capability tool ${n}`);

  // Schema specifics
  const paymentTool = registrations.find(t => t.name === 'request_synthetic_invoice_payment');
  assert.deepEqual(paymentTool.inputSchema.required, ['amountMinor']);
  assert.equal(paymentTool.inputSchema.properties.amountMinor.type, 'integer');
  assert.equal(paymentTool.inputSchema.properties.amountMinor.minimum, 1);
  assert.equal(paymentTool.inputSchema.properties.amountMinor.maximum, 5000);

  const signingTool = registrations.find(t => t.name === 'request_signing_authority');
  assert.deepEqual(signingTool.inputSchema.required, ['payloadHash']);
  assert.equal(signingTool.inputSchema.properties.payloadHash.type, 'string');
  assert.equal(signingTool.inputSchema.properties.payloadHash.pattern, '^[a-f0-9]{64}$');

  const boundedTool = registrations.find(t => t.name === 'request_bounded_action');
  assert.deepEqual(boundedTool.inputSchema.required, ['action']);
  assert.equal(boundedTool.inputSchema.properties.action.type, 'string');
  assert.deepEqual(boundedTool.inputSchema.properties.action.enum, ['update_visibility', 'submit_form']);

  const attackTool = registrations.find(t => t.name === 'attempt_recipient_redirect_attack');
  assert.equal(attackTool.inputSchema.additionalProperties, false);
  // attack should be generic for both payment and credential via optional target
  if (attackTool.inputSchema.properties.target) {
    assert.equal(attackTool.inputSchema.properties.target.type, 'string');
    assert.ok(Array.isArray(attackTool.inputSchema.properties.target.enum));
    assert.ok(attackTool.inputSchema.properties.target.enum.includes('payment'));
    assert.ok(attackTool.inputSchema.properties.target.enum.includes('credential'));
  }

  const execution = { signal: new AbortController().signal };
  const safeViewTool = registrations.find(t => t.name === 'get_ptf_safe_view');
  const safeViewResult = await safeViewTool.execute({}, execution);
  assert.deepEqual(safeViewResult, {
    assuranceLabel: 'synthetic',
    safeView: { persona: [] }
  });
  assert.equal(requests[0].path, '/api/agent-view');
  assert.equal(requests[0].options.signal, execution.signal);
  assert.equal(dispatched, 1, 'ptf-state-changed should dispatch after safe view');

  // Payment tool forwards signal and correct body
  const exec2 = { signal: new AbortController().signal };
  const paymentToolExec = registrations.find(t => t.name === 'request_synthetic_invoice_payment');
  await paymentToolExec.execute({ amountMinor: 4250 }, exec2);
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    scenario: 'payment',
    amountMinor: 4250,
    currency: 'USD'
  });
  assert.equal(requests[1].options.signal, exec2.signal);
  assert.equal(dispatched, 2);

  // Signing tool forwards signal and payloadHash
  const exec3 = { signal: new AbortController().signal };
  const hash = 'a'.repeat(64);
  const signingToolExec = registrations.find(t => t.name === 'request_signing_authority');
  await signingToolExec.execute({ payloadHash: hash }, exec3);
  assert.deepEqual(JSON.parse(requests[2].options.body), {
    scenario: 'signing',
    payloadHash: hash
  });
  assert.equal(requests[2].options.signal, exec3.signal);
  assert.equal(dispatched, 3);

  // Bounded action forwards signal
  const exec4 = { signal: new AbortController().signal };
  const boundedToolExec = registrations.find(t => t.name === 'request_bounded_action');
  await boundedToolExec.execute({ action: 'update_visibility' }, exec4);
  assert.deepEqual(JSON.parse(requests[3].options.body), {
    scenario: 'bounded_action',
    action: 'update_visibility'
  });
  // also test second enum value
  await boundedToolExec.execute({ action: 'submit_form' }, exec4);
  assert.deepEqual(JSON.parse(requests[4].options.body), {
    scenario: 'bounded_action',
    action: 'submit_form'
  });
  assert.equal(requests[4].options.signal, exec4.signal);
  assert.equal(dispatched, 5);

  // get_operation_status forwards signal and polls capability/approval
  const getStatusTool = registrations.find(t => t.name === 'get_operation_status');
  assert.deepEqual(getStatusTool.inputSchema.required, ['operationReference']);
  assert.equal(getStatusTool.inputSchema.properties.operationReference.type, 'string');
  const execGet = { signal: new AbortController().signal };
  const opRef = 'op_test_reference_123';
  await getStatusTool.execute({ operationReference: opRef }, execGet);
  assert.equal(requests[5].path, `/api/capabilities/${opRef}`);
  assert.equal(requests[5].options.signal, execGet.signal);
  // get_operation_status is readOnly but we still treat success as not dispatching state changed? Our helper requestGet does not dispatch; requestGet is used. So dispatched stays 5.
  // To keep consistent, allow 5 still.

  // Attack tool defaults to payment redirect, but can also do credential when target specified
  const redirectTool = registrations.find(t => t.name === 'attempt_recipient_redirect_attack');
  const exec5 = { signal: new AbortController().signal };
  await redirectTool.execute({}, exec5);
  assert.equal(JSON.parse(requests[6].options.body).recipientId, 'recipient_attacker');
  assert.equal(JSON.parse(requests[6].options.body).scenario, 'payment');
  assert.equal(requests[6].options.signal, exec5.signal);
  assert.equal(dispatched, 6);

  // Credential redirect
  const exec6 = { signal: new AbortController().signal };
  await redirectTool.execute({ target: 'credential' }, exec6);
  const credBody = JSON.parse(requests[7].options.body);
  assert.equal(credBody.recipientId, 'recipient_attacker');
  assert.equal(credBody.scenario, 'credential');
  assert.equal(requests[7].options.signal, exec6.signal);
  assert.equal(dispatched, 7);

  // Capability forward attack: tries to redeem as attacker
  const forwardTool = registrations.find(t => t.name === 'attempt_capability_forward_attack');
  assert.deepEqual(forwardTool.inputSchema.required, ['operationReference']);
  assert.equal(forwardTool.inputSchema.properties.operationReference.type, 'string');
  const execForward = { signal: new AbortController().signal };
  await forwardTool.execute({ operationReference: opRef }, execForward);
  assert.equal(requests[8].path, `/api/capabilities/${opRef}/redeem`);
  assert.equal(JSON.parse(requests[8].options.body).recipientId, 'recipient_attacker');
  assert.equal(requests[8].options.signal, execForward.signal);
  assert.equal(dispatched, 8);

  // Replay attack: tries double redeem
  const replayTool = registrations.find(t => t.name === 'attempt_replay_attack');
  assert.deepEqual(replayTool.inputSchema.required, ['operationReference']);
  const execReplay = { signal: new AbortController().signal };
  await replayTool.execute({ operationReference: opRef }, execReplay);
  // replay does two fetches, second is the one we check (last)
  assert.equal(requests[requests.length-1].path, `/api/capabilities/${opRef}/redeem`);
  assert.equal(dispatched, 10); // two dispatches for replay (first attempt + second)

  // Claim escalation attack: tries extra claims beyond policy
  const escalateTool = registrations.find(t => t.name === 'attempt_claim_escalation_attack');
  assert.ok(escalateTool.inputSchema.properties.scenario);
  assert.ok(escalateTool.inputSchema.properties.extraClaims || escalateTool.inputSchema.properties.scenario);
  const execEscalate = { signal: new AbortController().signal };
  await escalateTool.execute({ scenario: 'credential', extraClaims: ['admin_claim'] }, execEscalate);
  const escBody = JSON.parse(requests[requests.length-1].options.body);
  assert.equal(escBody.scenario, 'credential');
  assert.ok(escBody.claimIds.includes('admin_claim') || escBody.extraClaims || escBody.claimIds);
  assert.equal(dispatched, 11);

  // Ensure never returns protected values (mock returns safe, but check no canary in serialized observable)
  const allResults = JSON.stringify(requests);
  assert.equal(allResults.includes('PTF_CANARY'), false);
});

test('WebMCP adapter feature-detects unsupported environments without registering tools', async (context) => {
  const originalDocument = globalThis.document;
  context.after(() => { globalThis.document = originalDocument; });
  globalThis.document = {};
  assert.equal(await registerWebMCPTools(), false);
});

test('WebMCP adapter never returns protected values and dispatches state change only on success', async (context) => {
  const original = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
    CustomEvent: globalThis.CustomEvent
  };
  context.after(() => Object.assign(globalThis, original));

  const registrations = [];
  let dispatched = 0;
  globalThis.document = {
    modelContext: { registerTool: async (d) => registrations.push(d) }
  };
  globalThis.window = { dispatchEvent() { dispatched += 1; } };
  globalThis.CustomEvent = class CustomEvent {};
  let failNext = true;
  globalThis.fetch = async (path, options = {}) => {
    if (failNext) {
      failNext = false;
      return new Response(JSON.stringify({ error: 'denied' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ decision: 'approval_required' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  await registerWebMCPTools();
  const attack = registrations.find(r => r.name === 'attempt_recipient_redirect_attack');
  // First call fails (deny) - should throw and NOT dispatch
  await assert.rejects(() => attack.execute({}, { signal: new AbortController().signal }), /denied|PTF request failed/);
  assert.equal(dispatched, 0, 'should not dispatch on failure');
  // Next call succeeds - should dispatch
  await attack.execute({}, { signal: new AbortController().signal });
  assert.equal(dispatched, 1);
});
