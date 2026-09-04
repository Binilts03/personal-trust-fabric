import assert from 'node:assert/strict';
import test from 'node:test';

import { createPolicyAuthority } from '../../../src/core/policy.js';

const baseRequest = {
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

const paymentBase = {
  principalId: 'principal_demo',
  agentId: 'agent_demo',
  taskId: 'task_demo',
  recipientId: 'recipient_merchant_b',
  purpose: 'pay_invoice',
  operationType: 'payment',
  resourceId: 'payment_instrument_demo',
  action: 'pay',
  claimIds: [],
  transactionId: 'invoice_001',
  amountMinor: 3000,
  currency: 'USD',
  requestedUses: 1
};

test('policy-intersect: deny wins over allow', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_general_presentation',
      version: 1,
      effect: 'allow',
      match: { operationType: 'credential_presentation', action: 'present' },
      requireApproval: false
    },
    {
      id: 'policy_block_recipient',
      version: 3,
      effect: 'deny',
      match: { recipientId: 'recipient_verifier_a' }
    },
    {
      id: 'policy_another_allow',
      version: 1,
      effect: 'allow',
      match: { recipientId: 'recipient_verifier_a', purpose: 'verify_membership' },
      requireApproval: true,
      maxUses: 1
    }
  ]);

  const result = authority.evaluate(baseRequest);
  assert.equal(result.decision, 'deny');
  assert.deepEqual(result.policyIds, ['policy_block_recipient@3']);
  assert.equal(result.reason, 'matching deny policy');
});

test('policy-intersect: allow intersection is most restrictive - amount', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_allow_high',
      version: 1,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b', operationType: 'payment', action: 'pay' },
      maxAmountMinor: 5000,
      currencies: ['USD', 'EUR'],
      maxUses: 5,
      allowedModes: ['direct_delivery']
    },
    {
      id: 'policy_allow_low',
      version: 1,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b', operationType: 'payment', action: 'pay' },
      maxAmountMinor: 3000,
      currencies: ['USD'],
      maxUses: 2,
      allowedModes: ['direct_delivery', 'predicate_proof']
    }
  ]);

  // Within intersection: 3000 USD, 1 use should be allowed (or approval_required if any requires approval)
  const within = authority.evaluate({ ...paymentBase, amountMinor: 2500, currency: 'USD', requestedUses: 1 });
  assert.notEqual(within.decision, 'deny', '2500 USD should be within most restrictive intersection');

  // Exceeds most restrictive amount (3000) should deny even though 5000 would allow
  const exceedAmount = authority.evaluate({ ...paymentBase, amountMinor: 4000, currency: 'USD' });
  assert.equal(exceedAmount.decision, 'deny');
  assert.match(exceedAmount.reason, /exceeds policy amount|request exceeds/);

  // Currency EUR is in one but not intersection, should deny
  const eurRequest = authority.evaluate({ ...paymentBase, amountMinor: 1000, currency: 'EUR' });
  assert.equal(eurRequest.decision, 'deny');

  // Exceeds most restrictive maxUses
  const exceedUses = authority.evaluate({ ...paymentBase, amountMinor: 1000, currency: 'USD', requestedUses: 3 });
  assert.equal(exceedUses.decision, 'deny');

  // Check constraints reflect intersection
  const trace = authority.simulate({ ...paymentBase, amountMinor: 1000, currency: 'USD' });
  assert.equal(trace.constraints.maxAmountMinor, 3000);
  assert.deepEqual(trace.constraints.currencies, ['USD']);
  assert.equal(trace.constraints.maxUses, 2);
  // Allowed modes intersection: only direct_delivery is common
  assert.deepEqual(trace.constraints.allowedModes, ['direct_delivery']);
});

test('policy-intersect: allow intersection is most restrictive - time window and geography', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_time_a',
      version: 1,
      effect: 'allow',
      match: { operationType: 'payment', action: 'pay' },
      timeWindow: { notBefore: '2026-01-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' },
      geography: ['US', 'EU']
    },
    {
      id: 'policy_time_b',
      version: 1,
      effect: 'allow',
      match: { operationType: 'payment', action: 'pay' },
      timeWindow: { notBefore: '2026-06-01T00:00:00.000Z', expiresAt: '2026-09-01T00:00:00.000Z' },
      geography: ['US']
    }
  ]);

  const within = authority.evaluate({
    ...paymentBase,
    amountMinor: 1000,
    currency: 'USD',
    geography: 'US',
    occurredAt: '2026-07-01T00:00:00.000Z'
  });
  assert.notEqual(within.decision, 'deny');

  const outsideTime = authority.evaluate({
    ...paymentBase,
    amountMinor: 1000,
    currency: 'USD',
    geography: 'US',
    occurredAt: '2026-10-01T00:00:00.000Z'
  });
  // 2026-10-01 is after intersection expiresAt 2026-09-01
  assert.equal(outsideTime.decision, 'deny');

  const wrongGeo = authority.evaluate({
    ...paymentBase,
    amountMinor: 1000,
    currency: 'USD',
    geography: 'EU',
    occurredAt: '2026-07-01T00:00:00.000Z'
  });
  assert.equal(wrongGeo.decision, 'deny');

  const sim = authority.simulate({ ...paymentBase, geography: 'US', occurredAt: '2026-07-01T00:00:00.000Z' });
  assert.deepEqual(sim.constraints.geography, ['US']);
});

test('policy-intersect: order independence', () => {
  const policiesA = [
    {
      id: 'policy_allow_a',
      version: 2,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b', operationType: 'payment' },
      maxAmountMinor: 5000,
      currencies: ['USD']
    },
    {
      id: 'policy_allow_b',
      version: 1,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b', operationType: 'payment' },
      maxAmountMinor: 3000,
      currencies: ['USD', 'EUR']
    },
    {
      id: 'policy_deny_c',
      version: 1,
      effect: 'deny',
      match: { recipientId: 'recipient_attacker' }
    }
  ];

  const policiesB = [...policiesA].reverse();
  const policiesC = [policiesA[1], policiesA[2], policiesA[0]];

  const authA = createPolicyAuthority(policiesA);
  const authB = createPolicyAuthority(policiesB);
  const authC = createPolicyAuthority(policiesC);

  const requests = [
    { ...paymentBase, amountMinor: 1000, currency: 'USD' },
    { ...paymentBase, amountMinor: 4000, currency: 'USD' },
    { ...paymentBase, recipientId: 'recipient_attacker', amountMinor: 1000, currency: 'USD' },
    { ...paymentBase, amountMinor: 1000, currency: 'EUR' },
    { ...baseRequest }
  ];

  for (const req of requests) {
    const rA = authA.evaluate(req);
    const rB = authB.evaluate(req);
    const rC = authC.evaluate(req);
    assert.deepEqual(rA.decision, rB.decision, `order independence failed for ${JSON.stringify(req)}`);
    assert.deepEqual(rA.decision, rC.decision, `order independence failed for ${JSON.stringify(req)}`);
    assert.deepEqual(rA.policyIds, rB.policyIds, 'policyIds should be sorted deterministic');
    assert.deepEqual(rA.policyIds, rC.policyIds, 'policyIds should be deterministic regardless of input order');
    // Constraints should also be same
    assert.deepEqual(rA.constraints, rB.constraints);
    assert.deepEqual(rA.constraints, rC.constraints);
  }

  // Also verify that shuffling allow policies alone yields same intersection
  const allowShuffled = createPolicyAuthority([policiesA[1], policiesA[0]]);
  const allowOriginal = createPolicyAuthority([policiesA[0], policiesA[1]]);
  const testReq = { ...paymentBase, amountMinor: 2000, currency: 'USD' };
  assert.deepEqual(allowShuffled.evaluate(testReq), allowOriginal.evaluate(testReq));
});

test('policy-intersect: deny wins even when allow is more specific', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_specific_allow',
      version: 5,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b', purpose: 'pay_invoice', operationType: 'payment', action: 'pay' },
      maxAmountMinor: 5000,
      currencies: ['USD']
    },
    {
      id: 'policy_general_deny',
      version: 1,
      effect: 'deny',
      match: { operationType: 'payment' }
    }
  ]);

  const result = authority.evaluate(paymentBase);
  assert.equal(result.decision, 'deny');
  assert.equal(result.policyIds.includes('policy_general_deny@1'), true);
});

test('policy-intersect: empty intersection denies', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_usd_only',
      version: 1,
      effect: 'allow',
      match: { operationType: 'payment' },
      currencies: ['USD']
    },
    {
      id: 'policy_eur_only',
      version: 1,
      effect: 'allow',
      match: { operationType: 'payment' },
      currencies: ['EUR']
    }
  ]);

  const result = authority.evaluate({ ...paymentBase, currency: 'USD', amountMinor: 1000 });
  // No compatible currency across matching policies -> deny
  assert.equal(result.decision, 'deny');
});

test('policy-intersect: no matching allow denies', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_allow_cred',
      version: 1,
      effect: 'allow',
      match: { operationType: 'credential_presentation', action: 'present' },
      requireApproval: true
    }
  ]);

  const result = authority.evaluate(paymentBase);
  assert.equal(result.decision, 'deny');
  assert.equal(result.reason, 'no matching allow policy');
});
