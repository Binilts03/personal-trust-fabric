import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuditLog } from '../../src/core/audit-log.js';

const decisionEvent = {
  eventType: 'decision_recorded',
  correlationId: 'operation_1',
  occurredAt: '2026-09-02T08:00:00.000Z',
  outcome: 'allow',
  recipientId: 'recipient_verifier_a',
  purpose: 'verify_eligibility',
  scope: ['eligibility_over_18'],
  representation: 'predicate'
};

test('append records an allowed lifecycle event and query returns isolated safe copies', () => {
  const audit = createAuditLog();

  audit.append(decisionEvent);
  const firstQuery = audit.query({ correlationId: 'operation_1' });

  assert.equal(firstQuery.length, 1);
  assert.deepEqual(firstQuery[0].event, decisionEvent);

  firstQuery[0].event.scope[0] = 'mutated_by_caller';
  assert.deepEqual(audit.query({ correlationId: 'operation_1' })[0].event.scope, [
    'eligibility_over_18'
  ]);
});

test('append rejects event types and fields outside the closed audit schema', () => {
  const audit = createAuditLog();

  assert.throws(
    () => audit.append({ ...decisionEvent, eventType: 'arbitrary_debug_dump' }),
    /unsupported audit event type/
  );
  assert.throws(
    () => audit.append({ ...decisionEvent, debugMessage: 'not in the audit schema' }),
    /unknown audit event field/
  );
  assert.throws(
    () => audit.append(Object.create(decisionEvent)),
    /audit event must be a plain object/
  );
  assert.deepEqual(audit.query(), []);
});

test('append rejects protected payload fields and canary-like protected values without echoing them', () => {
  const audit = createAuditLog();
  const protectedCanary = 'PTF_CANARY_PAYMENT_9B7D';

  for (const protectedField of ['protectedPayload', 'rawPayload']) {
    assert.throws(
      () => audit.append({ ...decisionEvent, [protectedField]: protectedCanary }),
      (error) =>
        /protected or raw payload field/.test(error.message) &&
        !error.message.includes(protectedCanary)
    );
  }
  assert.throws(
    () => audit.append({ ...decisionEvent, purpose: protectedCanary }),
    (error) => /canary-like protected value/.test(error.message) && !error.message.includes(protectedCanary)
  );
  assert.deepEqual(audit.export(), []);
});

test('export produces a SHA-256 chain and integrity verification detects a mutated copy', () => {
  const audit = createAuditLog();
  audit.append(decisionEvent);
  audit.append({
    eventType: 'capability_issued',
    correlationId: 'operation_1',
    occurredAt: '2026-09-02T08:00:01.000Z',
    outcome: 'issued',
    recipientId: 'recipient_verifier_a',
    purpose: 'verify_eligibility',
    scope: ['eligibility_over_18'],
    representation: 'predicate'
  });

  const exported = audit.export();

  assert.equal(exported[0].sequence, 1);
  assert.equal(exported[0].previousHash, '0'.repeat(64));
  assert.equal(exported[0].hash, 'd0b4b334cbf58b05bc64209fdc5fa841273f6ac72709abce5f06b4ab1bbf2139');
  assert.equal(exported[1].previousHash, exported[0].hash);
  assert.equal(audit.verifyIntegrity(exported), true);

  exported[0].event.outcome = 'deny';
  assert.equal(audit.verifyIntegrity(exported), false);
  assert.equal(audit.verifyIntegrity(), true);
  assert.equal(audit.export()[0].event.outcome, 'allow');
});
