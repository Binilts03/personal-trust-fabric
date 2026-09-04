import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustRuntime } from '../../src/core/trust-runtime.js';

test('capability use count is narrowed to the Human-requested uses when policy allows more', () => {
  const ids = ['approval', 'operation'];
  const runtime = createTrustRuntime({
    now: () => 1_800_000_000_000,
    idFactory: () => ids.shift(),
    profile: 'synthetic_sandbox',
    personaClaims: [],
    policies: [
      {
        id: 'broad_use_limit',
        version: 1,
        effect: 'allow',
        match: {
          operationType: 'credential_presentation',
          recipientId: 'recipient_verifier_a'
        },
        requireApproval: false,
        maxUses: 5,
        allowedModes: ['predicate_proof']
      }
    ],
    providers: {
      credential_presentation: {
        publicOutcome: 'verified',
        recipientModes: ['predicate_proof'],
        candidates: [{ mode: 'predicate_proof', representationId: 'membership_active_proof' }],
        execute: async () => ({ outcome: 'verified' })
      }
    }
  });

  const result = runtime.requestOperation({
    principalId: 'principal_demo',
    agentId: 'agent_demo',
    taskId: 'task_demo',
    recipientId: 'recipient_verifier_a',
    purpose: 'verify_membership',
    operationType: 'credential_presentation',
    resourceId: 'credential_membership',
    action: 'present',
    claimIds: ['membership.active'],
    transactionId: 'verification_001',
    amountMinor: null,
    currency: null,
    requestedUses: 1
  });

  assert.equal(result.decision, 'allow');
  assert.equal(runtime.getOperationStatus(result.operationReference).remainingUses, 1);
});
