import assert from 'node:assert/strict';
import test from 'node:test';

import { createDisclosurePlanner } from '../../src/core/disclosure-planner.js';

test('planner chooses the least revealing candidate and cannot override denial', () => {
  const planner = createDisclosurePlanner();
  const candidates = [
    { mode: 'raw_plaintext', representationId: 'raw_membership_record' },
    { mode: 'selective_claim', representationId: 'membership_claim_only' },
    { mode: 'predicate_proof', representationId: 'active_membership_proof' }
  ];

  assert.deepEqual(
    planner.plan({
      authorized: true,
      candidates,
      allowedModes: ['predicate_proof', 'selective_claim'],
      recipientModes: ['predicate_proof', 'selective_claim', 'raw_plaintext']
    }),
    {
      status: 'planned',
      mode: 'predicate_proof',
      representationId: 'active_membership_proof',
      assurance: 'synthetic_sandbox',
      downgrade: false
    }
  );
  assert.deepEqual(planner.plan({ authorized: false, candidates }), {
    status: 'denied',
    reason: 'authorization denied'
  });
});

test('use-only signing and bounded-action modes are valid non-plaintext candidates', () => {
  const planner = createDisclosurePlanner();
  assert.deepEqual(planner.plan({
    authorized: true,
    candidates: [{ mode: 'enclave_sign', representationId: 'payload_signature' }],
    allowedModes: ['enclave_sign'],
    recipientModes: ['enclave_sign']
  }), {
    status: 'planned',
    mode: 'enclave_sign',
    representationId: 'payload_signature',
    assurance: 'synthetic_sandbox',
    downgrade: false
  });
  assert.deepEqual(planner.plan({
    authorized: true,
    candidates: [{ mode: 'bounded_write', representationId: 'account_change_authorization' }],
    allowedModes: ['bounded_write'],
    recipientModes: ['bounded_write']
  }), {
    status: 'planned',
    mode: 'bounded_write',
    representationId: 'account_change_authorization',
    assurance: 'synthetic_sandbox',
    downgrade: false
  });
});
