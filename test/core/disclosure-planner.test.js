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
