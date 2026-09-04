import assert from 'node:assert/strict';
import test from 'node:test';

import { toAgentSafeView, toSafeReceipt } from '../../../src/core/serialization.js';
import { createSandbox, CANARIES } from '../../../src/sandbox/fixtures.js';
import { normalizeApprovalTerms } from '../../../src/core/approval-terms.js';
import { createAuditLog } from '../../../src/core/audit-log.js';
import { createTrustRuntime } from '../../../src/core/trust-runtime.js';

const ALL_CANARIES = Object.values(CANARIES);
const CANARY_PATTERN = /PTF_CANARY_/;

function containsCanary(value) {
  const str = JSON.stringify(value);
  return CANARY_PATTERN.test(str) || ALL_CANARIES.some((c) => str.includes(c));
}

test('serialization: agent safe view never contains canary', () => {
  const sandbox = createSandbox();
  const { safeView, assuranceLabel } = sandbox.state();

  const observable = JSON.stringify({ safeView, assuranceLabel });
  for (const canary of ALL_CANARIES) {
    assert.equal(observable.includes(canary), false, `safeView must not contain ${canary}`);
  }
  assert.equal(CANARY_PATTERN.test(observable), false);

  // Also test via raw trust runtime safe view
  const runtime = sandbox.getRuntime();
  const rawSafe = runtime.getSafeView({ principalId: 'principal_demo', taskId: 'task_dashboard' });
  const rawStr = JSON.stringify(rawSafe);
  for (const canary of ALL_CANARIES) {
    assert.equal(rawStr.includes(canary), false);
  }

  // Direct toAgentSafeView must also filter use_only claims
  const canonical = {
    principalId: 'principal_demo',
    taskId: 'task_test',
    profile: 'synthetic_sandbox',
    personaClaims: [
      { key: 'purchase.budget_band', value: 'moderate', modelVisibility: 'shareable' },
      { key: 'payment.instrument', value: CANARIES.payment, modelVisibility: 'use_only' },
      { key: 'signing.key_ref', value: CANARIES.signing, modelVisibility: 'use_only' },
      { key: 'account.control', value: CANARIES.action, modelVisibility: 'use_only' }
    ],
    availableCapabilityTypes: ['credential_presentation', 'payment', 'signing', 'bounded_action'],
    approvalStatus: 'required',
    protectedValue: CANARIES.payment
  };
  const safeView2 = toAgentSafeView(canonical);
  const safeStr2 = JSON.stringify(safeView2);
  for (const canary of ALL_CANARIES) {
    assert.equal(safeStr2.includes(canary), false, `toAgentSafeView must not expose ${canary}`);
  }
  assert.deepEqual(safeView2.persona, [{ key: 'purchase.budget_band', value: 'moderate' }]);
});

test('serialization: receipt never contains protectedPayload', async () => {
  const sandbox = createSandbox();
  // Test each capability class produces safe receipt without protected
  const scenarios = [
    { scenario: 'credential' },
    { scenario: 'payment', amountMinor: 100, currency: 'USD' },
    { scenario: 'signing', payloadHash: 'a'.repeat(64) },
    { scenario: 'bounded_action', action: 'update_visibility' },
    { scenario: 'action', action: 'submit_form' }
  ];

  for (const input of scenarios) {
    const sb = createSandbox();
    const proposal = sb.request(input);
    // signing/bounded should be approval_required, not deny
    assert.equal(proposal.decision, 'approval_required', `scenario ${input.scenario} should require approval`);

    const decideResult = await sb.decide(proposal.approvalId, 'approved');
    // New flow: decide returns operationReference, requires independent redeem
    let completion;
    if (decideResult.receipt) {
      completion = decideResult;
    } else {
      assert.ok(decideResult.operationReference, `operationReference should exist for ${input.scenario}`);
      const recipientId = proposal.displayedTerms.recipientId;
      const token = sb.generateRecipientAuthToken(decideResult.operationReference, recipientId);
      completion = await sb.redeemCapability({ reference: decideResult.operationReference, recipientId, recipientAuthToken: token });
    }
    assert.ok(completion.receipt, `receipt should exist for ${input.scenario}`);
    const receiptStr = JSON.stringify(completion.receipt);
    for (const canary of ALL_CANARIES) {
      assert.equal(receiptStr.includes(canary), false, `receipt for ${input.scenario} must not contain ${canary}`);
    }
    assert.equal(Object.hasOwn(completion.receipt, 'protectedPayload'), false);
    assert.equal(Object.hasOwn(completion.receipt, 'protected'), false);
    assert.equal(CANARY_PATTERN.test(receiptStr), false);

    // Also test toSafeReceipt directly strips protectedPayload
    const rawReceipt = {
      id: 'receipt_test',
      correlationId: 'op_test',
      operationType: input.scenario === 'credential' ? 'credential_presentation' : input.scenario === 'payment' ? 'payment' : input.scenario === 'signing' ? 'signing' : 'bounded_action',
      recipientId: 'recipient_test',
      purpose: 'test',
      outcome: 'completed',
      occurredAt: new Date().toISOString(),
      protectedPayload: CANARIES.payment,
      debug: { secret: CANARIES.credential }
    };
    const safe = toSafeReceipt(rawReceipt);
    const safeStr = JSON.stringify(safe);
    for (const canary of ALL_CANARIES) assert.equal(safeStr.includes(canary), false);
    assert.equal(Object.hasOwn(safe, 'protectedPayload'), false);
    assert.equal(Object.hasOwn(safe, 'debug'), false);
  }

  // Ensure sandbox state activity never contains canary
  const sandbox2 = createSandbox();
  const prop = sandbox2.request({ scenario: 'payment', amountMinor: 4250, currency: 'USD' });
  const dr2 = await sandbox2.decide(prop.approvalId, 'approved');
  if (dr2.operationReference && !dr2.receipt) {
    const tok2 = sandbox2.generateRecipientAuthToken(dr2.operationReference, prop.displayedTerms.recipientId);
    await sandbox2.redeemCapability({ reference: dr2.operationReference, recipientId: prop.displayedTerms.recipientId, recipientAuthToken: tok2 });
  }
  const state = sandbox2.state();
  const activityStr = JSON.stringify(state.activity);
  for (const canary of ALL_CANARIES) assert.equal(activityStr.includes(canary), false);
});

test('serialization: unknown fields rejected', () => {
  const sandbox = createSandbox();

  // sandbox.request must reject unknown fields
  assert.throws(() => sandbox.request({ scenario: 'payment', amountMinor: 100, currency: 'USD', smuggled: 'x' }), /unknown field/);
  assert.throws(() => sandbox.request({ scenario: 'payment', unknownField: 1 }), /unknown field/);
  assert.throws(() => sandbox.request({ scenario: 'signing', payloadHash: 'a'.repeat(64), extra: 'x' }), /unknown field/);

  // normalizeApprovalTerms must reject unknown fields
  const baseTerms = {
    principalId: 'principal_demo',
    agentId: 'agent_demo',
    taskId: 'task_demo',
    recipientId: 'recipient_verifier_a',
    purpose: 'verify_membership',
    operationType: 'credential_presentation',
    resourceId: 'credential_membership',
    action: 'present',
    claimIds: ['membership.active'],
    transactionId: 'txn_001',
    amountMinor: null,
    currency: null,
    requestedUses: 1
  };
  assert.throws(() => normalizeApprovalTerms({ ...baseTerms, unknownField: 'evil' }), /unknown field/);
  assert.throws(() => normalizeApprovalTerms({ ...baseTerms, smuggledRecipient: 'recipient_attacker' }), /unknown field/);

  // toSafeReceipt and toAgentSafeView should not leak unknown fields even if passed
  const receipt = {
    id: 'r1', correlationId: 'c1', operationType: 'payment', recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice', outcome: 'paid', occurredAt: new Date().toISOString(),
    protectedPayload: CANARIES.payment, unknownExtra: 'should be stripped', debug: 'x'
  };
  const safeReceipt = toSafeReceipt(receipt);
  assert.equal(Object.hasOwn(safeReceipt, 'unknownExtra'), false);
  assert.equal(Object.hasOwn(safeReceipt, 'protectedPayload'), false);

  // audit log must reject unknown/protected fields
  const audit = createAuditLog();
  assert.throws(() => audit.append({
    eventType: 'action_completed',
    correlationId: 'c1',
    occurredAt: new Date().toISOString(),
    outcome: 'completed',
    recipientId: 'recipient_merchant_b',
    purpose: 'test',
    scope: ['payment', 'pay'],
    protectedPayload: CANARIES.payment
  }), /protected|unknown audit/);
  assert.throws(() => audit.append({
    eventType: 'action_completed',
    correlationId: 'c1',
    occurredAt: new Date().toISOString(),
    outcome: 'completed',
    recipientId: 'recipient_merchant_b',
    purpose: 'test',
    scope: ['payment', 'pay'],
    unknownField: 'evil'
  }), /unknown audit/);
});

test('serialization: safe view and receipt are allowlisted and deterministic', () => {
  // Ensure safe serializers produce stable shape
  const canonical = {
    principalId: 'principal_demo',
    taskId: 'task_checkout',
    profile: 'synthetic_sandbox',
    personaClaims: [
      { key: 'purchase.budget_band', value: 'moderate', modelVisibility: 'shareable' },
      { key: 'purchase.budget_band', value: 'conservative', modelVisibility: 'shareable' }
    ],
    availableCapabilityTypes: ['payment', 'signing'],
    approvalStatus: 'required'
  };
  const safeView = toAgentSafeView(canonical);
  const keys = Object.keys(safeView).sort();
  assert.deepEqual(keys, ['approvalStatus', 'assurance', 'availableCapabilityTypes', 'persona', 'principalId', 'taskId', 'version'].sort());
  assert.equal(safeView.version, 1);

  const receipt = {
    id: 'receipt_1',
    correlationId: 'op_1',
    operationType: 'payment',
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    outcome: 'paid',
    occurredAt: '2026-09-02T08:00:00.000Z',
    protectedPayload: 'PTF_CANARY_PAYMENT_9B7D',
    extra: 'should be stripped'
  };
  const safe = toSafeReceipt(receipt);
  // Only allowlisted fields should exist
  assert.deepEqual(Object.keys(safe).sort(), ['correlationId', 'id', 'occurredAt', 'operationType', 'outcome', 'purpose', 'recipientId', 'version'].sort());
  assert.equal(containsCanary(safe), false);
});
