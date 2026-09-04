import assert from 'node:assert/strict';
import test from 'node:test';

import { createPolicyAuthority } from '../../src/core/policy.js';

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

test('policy requires approval for an otherwise allowed consequential request', () => {
  const authority = createPolicyAuthority([
    {
      id: 'policy_membership',
      version: 1,
      effect: 'allow',
      match: {
        recipientId: 'recipient_verifier_a',
        purpose: 'verify_membership',
        operationType: 'credential_presentation',
        action: 'present'
      },
      requireApproval: true,
      maxUses: 1
    }
  ]);

  assert.deepEqual(authority.evaluate(baseRequest), {
    decision: 'approval_required',
    policyIds: ['policy_membership@1'],
    constraints: { maxUses: 1 },
    reason: 'matching policy requires human approval'
  });
});

test('explicit deny overrides a matching allow policy', () => {
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
    }
  ]);

  assert.deepEqual(authority.evaluate(baseRequest), {
    decision: 'deny',
    policyIds: ['policy_block_recipient@3'],
    constraints: {},
    reason: 'matching deny policy'
  });
});

test('all matching allow policies are intersected conservatively and order-independently', () => {
  const permissive = {
    id: 'global',
    version: 1,
    effect: 'allow',
    match: { operationType: 'credential_presentation' },
    requireApproval: false,
    maxUses: 5,
    allowedModes: ['selective_claim', 'predicate_proof']
  };
  const restrictive = {
    id: 'recipient',
    version: 2,
    effect: 'allow',
    match: { recipientId: 'recipient_verifier_a' },
    requireApproval: true,
    maxUses: 1,
    allowedModes: ['predicate_proof']
  };

  const expected = {
    decision: 'approval_required',
    policyIds: ['global@1', 'recipient@2'],
    constraints: { maxUses: 1, allowedModes: ['predicate_proof'] },
    reason: 'matching policy requires human approval'
  };

  assert.deepEqual(createPolicyAuthority([permissive, restrictive]).evaluate(baseRequest), expected);
  assert.deepEqual(createPolicyAuthority([restrictive, permissive]).evaluate(baseRequest), expected);
});

test('a stricter matching amount constraint cannot be bypassed by a broader allow', () => {
  const request = {
    ...baseRequest,
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    operationType: 'payment',
    action: 'pay',
    amountMinor: 2000,
    currency: 'USD'
  };
  const authority = createPolicyAuthority([
    {
      id: 'broad',
      version: 1,
      effect: 'allow',
      match: { operationType: 'payment' },
      requireApproval: false,
      maxAmountMinor: 5000,
      currencies: ['USD', 'EUR']
    },
    {
      id: 'strict',
      version: 1,
      effect: 'allow',
      match: { recipientId: 'recipient_merchant_b' },
      requireApproval: true,
      maxAmountMinor: 1000,
      currencies: ['USD']
    }
  ]);

  assert.deepEqual(authority.evaluate(request), {
    decision: 'deny',
    policyIds: ['broad@1', 'strict@1'],
    constraints: {},
    reason: 'request exceeds policy amount limit'
  });
});
