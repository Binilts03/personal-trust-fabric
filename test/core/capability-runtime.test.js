import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeApprovalTerms } from '../../src/core/approval-terms.js';
import { createCapabilityRuntime } from '../../src/core/capability-runtime.js';

const terms = normalizeApprovalTerms({
  principalId: 'principal_demo',
  agentId: 'agent_demo',
  taskId: 'task_checkout',
  recipientId: 'recipient_merchant_b',
  purpose: 'pay_invoice',
  operationType: 'payment',
  resourceId: 'payment_instrument_demo',
  action: 'pay',
  claimIds: [],
  transactionId: 'invoice_2048',
  amountMinor: 4250,
  currency: 'USD',
  requestedUses: 1
});

test('opaque reference requires recipient proof and single-use execution is atomic', async () => {
  let executions = 0;
  const runtime = createCapabilityRuntime({
    now: () => 1_800_000_000_000,
    referenceFactory: () => 'op_test_reference',
    executors: {
      payment: async () => {
        executions += 1;
        await Promise.resolve();
        return { outcome: 'paid', providerReference: 'synthetic_payment_1' };
      }
    }
  });
  const issued = runtime.issue({
    grantId: 'grant_1',
    authorityState: 'active',
    terms,
    expiresAt: 1_800_000_060_000,
    maxUses: 1
  });

  assert.deepEqual(issued, {
    reference: 'op_test_reference',
    status: 'active',
    expiresAt: 1_800_000_060_000,
    remainingUses: 1
  });
  await assert.rejects(
    runtime.execute({
      reference: issued.reference,
      terms,
      recipientProof: { recipientId: 'recipient_attacker', authenticated: true }
    }),
    /recipient authentication mismatch/
  );

  const attempts = await Promise.allSettled([
    runtime.execute({
      reference: issued.reference,
      terms,
      recipientProof: { recipientId: 'recipient_merchant_b', authenticated: true }
    }),
    runtime.execute({
      reference: issued.reference,
      terms,
      recipientProof: { recipientId: 'recipient_merchant_b', authenticated: true }
    })
  ]);

  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(attempts.filter(({ status }) => status === 'rejected').length, 1);
  assert.equal(executions, 1);
  assert.equal(runtime.getStatus(issued.reference).status, 'consumed');
});
