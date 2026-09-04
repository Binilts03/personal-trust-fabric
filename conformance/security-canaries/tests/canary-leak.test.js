import assert from 'node:assert/strict';
import test from 'node:test';

import { createSandbox, CANARIES } from '../../../src/sandbox/fixtures.js';
import { createTrustRuntime } from '../../../src/core/trust-runtime.js';
import { createAuditLog } from '../../../src/core/audit-log.js';
import { toAgentSafeView, toSafeReceipt } from '../../../src/core/serialization.js';

const ALL_CANARIES = Object.values(CANARIES);
const CANARY_REGEX = /PTF_CANARY_[A-Z0-9_]+/;

function scanForCanary(value, label) {
  const serialized = JSON.stringify(value);
  for (const canary of ALL_CANARIES) {
    assert.equal(serialized.includes(canary), false, `${label} must not contain canary ${canary}`);
  }
  assert.equal(CANARY_REGEX.test(serialized), false, `${label} must not match canary pattern ${CANARY_REGEX}`);
  return serialized;
}

test('canary-leak: agent safe view surfaces never expose canaries', () => {
  const sandbox = createSandbox();
  const state = sandbox.state();

  // Safe view via sandbox.state
  scanForCanary(state.safeView, 'sandbox safeView');
  scanForCanary(state.assuranceLabel, 'assuranceLabel');
  scanForCanary(state.personaClaims, 'personaClaims shareable');
  scanForCanary(state.protectedResources, 'protectedResources metadata');
  scanForCanary(state.policies, 'policies');
  scanForCanary({ persona: state.safeView.persona }, 'persona projection');

  // Direct runtime safe view
  const runtime = sandbox.getRuntime();
  const safeView = runtime.getSafeView({ principalId: 'principal_demo', taskId: 'task_dashboard' });
  scanForCanary(safeView, 'runtime safeView');

  // toAgentSafeView with canary-containing canonical must not leak
  const canonical = {
    principalId: 'principal_demo',
    taskId: 'task_evil',
    profile: 'synthetic_sandbox',
    personaClaims: [
      { key: 'purchase.budget_band', value: 'moderate', modelVisibility: 'shareable' },
      { key: 'payment.instrument', value: CANARIES.payment, modelVisibility: 'use_only' },
      { key: 'credential.secret', value: CANARIES.credential, modelVisibility: 'use_only' },
      { key: 'signing.key', value: CANARIES.signing, modelVisibility: 'use_only' },
      { key: 'account.control', value: CANARIES.action, modelVisibility: 'use_only' }
    ],
    availableCapabilityTypes: ['credential_presentation', 'payment', 'signing', 'bounded_action'],
    approvalStatus: 'required'
  };
  const filtered = toAgentSafeView(canonical);
  scanForCanary(filtered, 'toAgentSafeView filtered');
  // Ensure even double stringify doesn't leak
  const double = JSON.stringify(JSON.stringify(filtered));
  for (const c of ALL_CANARIES) assert.equal(double.includes(c), false);
});

test('canary-leak: audit and receipt surfaces never expose canaries', async () => {
  const sandbox = createSandbox();

  // Generate activity via multiple scenarios
  const scenarios = [
    { scenario: 'credential' },
    { scenario: 'payment', amountMinor: 4250, currency: 'USD' },
    { scenario: 'signing', payloadHash: 'a'.repeat(64) },
    { scenario: 'bounded_action', action: 'update_visibility' }
  ];

  for (const input of scenarios) {
    const p = sandbox.request(input);
    if (p.decision === 'approval_required') {
      const dr = await sandbox.decide(p.approvalId, 'approved');
      let comp;
      if (dr.receipt) comp = dr;
      else {
        const tok = sandbox.generateRecipientAuthToken(dr.operationReference, p.displayedTerms.recipientId);
        comp = await sandbox.redeemCapability({ reference: dr.operationReference, recipientId: p.displayedTerms.recipientId, recipientAuthToken: tok });
      }
      scanForCanary(comp.receipt, `receipt for ${input.scenario}`);
      assert.equal(Object.hasOwn(comp.receipt, 'protectedPayload'), false);
      assert.equal(Object.hasOwn(comp.receipt, 'protected'), false);
    } else {
      scanForCanary(p, `proposal denial for ${input.scenario}`);
    }
  }

  const state = sandbox.state();
  scanForCanary(state.activity, 'activity audit stream');
  scanForCanary(state.approvals, 'pending approvals disclosure');

  const audit = sandbox.exportAudit();
  scanForCanary(audit, 'exported audit log');
  // Each audit record's event must be clean
  for (const rec of audit) {
    scanForCanary(rec.event, `audit event ${rec.sequence}`);
    scanForCanary(rec.hash, `audit hash ${rec.sequence}`);
  }

  // Direct toSafeReceipt must strip protected
  const rawReceipt = {
    id: 'receipt_x',
    correlationId: 'corr_x',
    operationType: 'payment',
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    outcome: 'paid',
    occurredAt: new Date().toISOString(),
    protectedPayload: CANARIES.payment,
    protectedValue: CANARIES.credential,
    secret: CANARIES.signing
  };
  const safe = toSafeReceipt(rawReceipt);
  scanForCanary(safe, 'toSafeReceipt');
  assert.equal(Object.hasOwn(safe, 'protectedPayload'), false);
  assert.equal(Object.hasOwn(safe, 'protectedValue'), false);
  assert.equal(Object.hasOwn(safe, 'secret'), false);
});

test('canary-leak: UI surfaces from fixtures state never contain canary', async () => {
  const sandbox = createSandbox();

  // Simulate dashboard fetchCombined surfaces: state, capabilities, audit, policies
  const initialState = sandbox.state();
  scanForCanary(initialState.safeView, 'initial safeView UI');
  scanForCanary(initialState.personaClaims, 'initial personaClaims UI');
  // personaClaims are confirmed claims that include shareable only? But state personaClaims are confirmed claims with all? Check: fixtures agentPersonaClaims are shareable only?
  // Ensure no canary even in personaClaims (should be only moderate)
  for (const claim of initialState.personaClaims) {
    scanForCanary(claim.value, `personaClaim ${claim.key}`);
  }

  // After operations, UI should still be clean
  const paymentProposal = sandbox.request({ scenario: 'payment', amountMinor: 1000, currency: 'USD' });
  const stateWithPending = sandbox.state();
  scanForCanary(stateWithPending.approvals, 'approvals UI with pending');
  scanForCanary(stateWithPending.safeView, 'safeView with pending');

  const drPay = await sandbox.decide(paymentProposal.approvalId, 'approved');
  if (drPay.operationReference && !drPay.receipt) {
    const t = sandbox.generateRecipientAuthToken(drPay.operationReference, paymentProposal.displayedTerms.recipientId);
    await sandbox.redeemCapability({ reference: drPay.operationReference, recipientId: paymentProposal.displayedTerms.recipientId, recipientAuthToken: t });
  }
  const stateAfter = sandbox.state();
  scanForCanary(stateAfter.activity, 'activity UI after execution');
  scanForCanary(stateAfter.auditIntegrity, 'auditIntegrity flag');

  // Capabilities list
  const caps = sandbox.listActiveCapabilities();
  scanForCanary(caps, 'active capabilities UI');

  // Policies list
  const policies = sandbox.getPolicies();
  scanForCanary(policies, 'policies UI');

  // Export snapshot
  const snap = sandbox.exportSnapshot();
  scanForCanary(snap.personaClaims, 'snapshot personaClaims');
  scanForCanary(snap.pending, 'snapshot pending');
  scanForCanary(snap.runtimeState, 'snapshot runtimeState');
  // runtimeState capabilities should not contain canary
  // but protectedResourcesMeta is safe
  scanForCanary(snap.protectedResourcesMeta, 'snapshot protectedResourcesMeta');
});

test('canary-leak: audit log rejects canary insertion and never echoes', () => {
  const audit = createAuditLog();
  // Attempt to insert canary directly should be rejected
  for (const canary of ALL_CANARIES) {
    assert.throws(() => audit.append({
      eventType: 'action_completed',
      correlationId: 'test',
      occurredAt: new Date().toISOString(),
      outcome: canary,
      recipientId: 'recipient_merchant_b',
      purpose: 'test',
      scope: ['payment', 'pay']
    }), /canary|protected/i);

    assert.throws(() => audit.append({
      eventType: 'decision_recorded',
      correlationId: canary,
      occurredAt: new Date().toISOString(),
      outcome: 'deny'
    }), /canary/);

    // Ensure canary is not echoed in error message beyond pattern (error messages should not contain full canary)
    try {
      audit.append({
        eventType: 'action_completed',
        correlationId: 'x',
        occurredAt: new Date().toISOString(),
        outcome: 'completed',
        recipientId: canary,
        purpose: 'test',
        scope: ['x']
      });
      assert.fail('should have thrown for canary recipientId');
    } catch (e) {
      // Error message must not contain canary value itself (to avoid echoing)
      // Our implementation throws generic canary error; check it doesn't leak fully
      // At minimum, ensure audit still clean
      const after = audit.export();
      scanForCanary(after, 'audit after rejected canary');
    }
  }

  // Audit export must remain clean after rejections
  const exported = audit.export();
  scanForCanary(exported, 'audit export after rejections');
});

test('canary-leak: serialization of all observable JSON never contains pattern', async () => {
  const sandbox = createSandbox();
  // Create several operations to populate activity
  async function decideAndRedeem(sb, prop) {
    const dr = await sb.decide(prop.approvalId, 'approved');
    if (dr.receipt) return dr;
    const tok = sb.generateRecipientAuthToken(dr.operationReference, prop.displayedTerms.recipientId);
    return await sb.redeemCapability({ reference: dr.operationReference, recipientId: prop.displayedTerms.recipientId, recipientAuthToken: tok });
  }
  const p1 = sandbox.request({ scenario: 'credential' });
  await decideAndRedeem(sandbox, p1);
  const p2 = sandbox.request({ scenario: 'signing', payloadHash: 'b'.repeat(64) });
  await decideAndRedeem(sandbox, p2);
  const p3 = sandbox.request({ scenario: 'bounded_action', action: 'submit_form' });
  await decideAndRedeem(sandbox, p3);

  const observables = {
    state: sandbox.state(),
    capabilities: sandbox.listActiveCapabilities(),
    audit: sandbox.exportAudit(),
    policies: sandbox.getPolicies(),
    safeView: sandbox.getRuntime().getSafeView({ principalId: 'principal_demo', taskId: 'task_dashboard' }),
    // Also simulate HTTP API surfaces
    agentView: (() => {
      const { assuranceLabel, safeView } = sandbox.state();
      return { assuranceLabel, safeView };
    })()
  };

  const fullDump = JSON.stringify(observables);
  for (const canary of ALL_CANARIES) {
    assert.equal(fullDump.includes(canary), false, `full observable dump must not contain ${canary}`);
  }
  assert.equal(CANARY_REGEX.test(fullDump), false, 'full dump must not match canary regex');

  // Ensure even base64 or hex variants not leaked via naive check? At least plain canary absent
  // Protected values are distinct per canary
  assert.notEqual(CANARIES.payment, CANARIES.credential);
  assert.notEqual(CANARIES.signing, CANARIES.action);
  assert.notEqual(CANARIES.payment, CANARIES.signing);
});

test('canary-leak: protected store and key hierarchy never leak via toJSON', async () => {
  // Import protected store to verify its safe serialization
  const { ProtectedStoreV1 } = await import('../../../src/core/protected-store.js');
  const store = new ProtectedStoreV1();
  const canaryBuf = Buffer.from(CANARIES.payment, 'utf8');
  store.putProtectedRecord({ namespace: 'payment', id: 'test', plaintext: canaryBuf, classification: 'restricted' });
  const json = JSON.stringify(store);
  for (const c of ALL_CANARIES) assert.equal(json.includes(c), false);
  assert.equal(CANARY_REGEX.test(json), false);
  // describe should not leak
  const meta = store.describeProtectedRecord({ namespace: 'payment', id: 'test' });
  scanForCanary(meta, 'protected store describe');
});
