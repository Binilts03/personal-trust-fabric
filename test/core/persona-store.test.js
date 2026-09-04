import assert from 'node:assert/strict';
import test from 'node:test';

import { createPersonaStore } from '../../src/core/persona-store.js';

function createTestStore() {
  const ids = [
    'observation_1',
    'claim_1',
    'claim_2',
    'observation_2',
    'claim_3',
    'observation_3',
    'claim_4'
  ];
  return createPersonaStore({
    now: () => Date.parse('2026-09-02T08:00:00.000Z'),
    idFactory: () => ids.shift()
  });
}

test('external observations remain untrusted evidence for inferred candidate claims', () => {
  const store = createTestStore();
  const observation = store.addObservation({
    source: { type: 'external', id: 'travel_site' },
    observedAt: '2026-09-01T09:30:00.000Z',
    sensitivity: 'personal',
    content: { key: 'travel.seat', value: 'aisle' }
  });
  const claim = store.proposeClaim({
    key: 'travel.seat',
    value: 'aisle',
    contexts: ['flight_booking'],
    evidenceIds: [observation.id],
    inferred: true,
    confidence: 0.65,
    sensitivity: 'personal',
    modelVisibility: 'shareable'
  });

  assert.deepEqual(observation, {
    id: 'observation_1',
    source: { type: 'external', id: 'travel_site' },
    observedAt: '2026-09-01T09:30:00.000Z',
    trust: 'untrusted',
    sensitivity: 'personal',
    content: { key: 'travel.seat', value: 'aisle' },
    status: 'evidence'
  });
  assert.deepEqual(claim, {
    id: 'claim_1',
    key: 'travel.seat',
    value: 'aisle',
    contexts: ['flight_booking'],
    evidenceIds: ['observation_1'],
    inferred: true,
    confidence: 0.65,
    sensitivity: 'personal',
    modelVisibility: 'shareable',
    status: 'candidate',
    createdAt: '2026-09-02T08:00:00.000Z',
    supersedes: null,
    provenance: [{
      kind: 'observation',
      observationId: 'observation_1',
      source: { type: 'external', id: 'travel_site' },
      trust: 'untrusted',
      observedAt: '2026-09-01T09:30:00.000Z'
    }]
  });
  assert.deepEqual(store.queryTaskClaims({ contexts: ['flight_booking'] }), []);
});

test('only explicit Human confirmation promotes a candidate claim', () => {
  const store = createTestStore();
  const observation = store.addObservation({
    source: { type: 'model', id: 'planner_summary' },
    observedAt: '2026-09-01T09:30:00.000Z',
    sensitivity: 'personal',
    content: { key: 'travel.seat', value: 'aisle' }
  });
  const claim = store.proposeClaim({
    key: 'travel.seat',
    value: 'aisle',
    contexts: ['flight_booking'],
    evidenceIds: [observation.id],
    inferred: true,
    confidence: 0.65,
    sensitivity: 'personal',
    modelVisibility: 'shareable'
  });

  assert.throws(
    () => store.confirmClaim({
      claimId: claim.id,
      source: { type: 'model', id: 'planner' }
    }),
    /explicit Human confirmation is required/
  );
  assert.throws(
    () => store.confirmClaim({
      claimId: claim.id,
      source: { type: 'external', id: 'travel_site' }
    }),
    /explicit Human confirmation is required/
  );
  assert.throws(
    () => store.proposeClaim({
      key: 'travel.seat',
      value: 'aisle',
      contexts: ['flight_booking'],
      evidenceIds: [observation.id],
      inferred: false,
      confidence: 1,
      sensitivity: 'personal',
      modelVisibility: 'shareable',
      status: 'confirmed'
    }),
    /unknown field: status/
  );

  const confirmed = store.confirmClaim({
    claimId: claim.id,
    source: { type: 'human', id: 'principal_demo' }
  });
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.provenance.at(-1), {
    kind: 'confirmation',
    source: { type: 'human', id: 'principal_demo' },
    occurredAt: '2026-09-02T08:00:00.000Z'
  });
});

test('Human correction supersedes the prior claim and task query returns only relevant model-shareable active claims', () => {
  const store = createTestStore();
  const human = { type: 'human', id: 'principal_demo' };
  const observation = store.addObservation({
    source: { type: 'external', id: 'travel_site' },
    observedAt: '2026-09-01T09:30:00.000Z',
    sensitivity: 'personal',
    content: { key: 'travel.seat', value: 'aisle' }
  });
  const original = store.confirmClaim({
    claimId: store.proposeClaim({
      key: 'travel.seat',
      value: 'aisle',
      contexts: ['flight_booking'],
      evidenceIds: [observation.id],
      inferred: true,
      confidence: 0.65,
      sensitivity: 'personal',
      modelVisibility: 'shareable'
    }).id,
    source: human
  });

  assert.throws(
    () => store.correctClaim({
      claimId: original.id,
      value: 'window',
      confidence: 1,
      source: { type: 'model', id: 'planner' }
    }),
    /explicit Human correction is required/
  );
  const corrected = store.correctClaim({
    claimId: original.id,
    value: 'window',
    confidence: 1,
    source: human
  });

  const hiddenObservation = store.addObservation({
    source: { type: 'external', id: 'identity_site' },
    observedAt: '2026-09-01T10:00:00.000Z',
    sensitivity: 'high',
    content: { key: 'identity.private_trait', value: 'PTF_PERSONA_CANARY_7F2D' }
  });
  store.confirmClaim({
    claimId: store.proposeClaim({
      key: 'identity.private_trait',
      value: 'PTF_PERSONA_CANARY_7F2D',
      contexts: ['flight_booking'],
      evidenceIds: [hiddenObservation.id],
      inferred: true,
      confidence: 0.8,
      sensitivity: 'high',
      modelVisibility: 'use_only'
    }).id,
    source: human
  });

  const unrelatedObservation = store.addObservation({
    source: { type: 'external', id: 'food_site' },
    observedAt: '2026-09-01T11:00:00.000Z',
    sensitivity: 'personal',
    content: { key: 'food.spice', value: 'mild' }
  });
  store.confirmClaim({
    claimId: store.proposeClaim({
      key: 'food.spice',
      value: 'mild',
      contexts: ['meal_ordering'],
      evidenceIds: [unrelatedObservation.id],
      inferred: true,
      confidence: 0.7,
      sensitivity: 'personal',
      modelVisibility: 'shareable'
    }).id,
    source: human
  });

  assert.equal(corrected.supersedes, original.id);
  assert.equal(corrected.status, 'confirmed');
  assert.deepEqual(corrected.provenance.at(-1), {
    kind: 'correction',
    source: human,
    occurredAt: '2026-09-02T08:00:00.000Z',
    supersededClaimId: original.id
  });

  const taskClaims = store.queryTaskClaims({ contexts: ['flight_booking'] });
  assert.deepEqual(taskClaims.map((claim) => ({
    id: claim.id,
    key: claim.key,
    value: claim.value,
    contexts: claim.contexts,
    confidence: claim.confidence,
    sensitivity: claim.sensitivity,
    modelVisibility: claim.modelVisibility,
    status: claim.status
  })), [{
    id: 'claim_2',
    key: 'travel.seat',
    value: 'window',
    contexts: ['flight_booking'],
    confidence: 1,
    sensitivity: 'personal',
    modelVisibility: 'shareable',
    status: 'confirmed'
  }]);
  assert.deepEqual(taskClaims[0].provenance, corrected.provenance);
  assert.equal(JSON.stringify(taskClaims).includes('PTF_PERSONA_CANARY_7F2D'), false);
});

test('persona store exposes no Hard Policy or authority mutation operation', () => {
  assert.deepEqual(Object.keys(createTestStore()).sort(), [
    'addObservation',
    'confirmClaim',
    'correctClaim',
    'markContextual',
    'proposeClaim',
    'queryTaskClaims',
    'rejectClaim'
  ]);
});
