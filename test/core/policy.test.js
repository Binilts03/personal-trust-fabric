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
      maxUses: 1,
      allowedClaims: ['membership.active']
    }
  ]);

  const result = authority.evaluate(baseRequest);
  assert.equal(result.decision, 'approval_required');
  assert.deepEqual(result.policyIds, ['policy_membership@1']);
  assert.equal(result.constraints.maxUses, 1);
  // new claimIds authorization adds allowedClaims
  assert.deepEqual(result.constraints.allowedClaims, ['membership.active']);
  assert.equal(result.reason, 'matching policy requires human approval');
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
