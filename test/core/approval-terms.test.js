import assert from 'node:assert/strict';
import test from 'node:test';

import {
  digestApprovalTerms,
  encodeApprovalTerms,
  normalizeApprovalTerms
} from '../../src/core/approval-terms.js';

const paymentRequest = {
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
  currency: 'usd',
  requestedUses: 1
};

test('approval encoding normalizes transport representation and binds material terms', () => {
  const normalized = normalizeApprovalTerms(paymentRequest);

  assert.equal(
    encodeApprovalTerms(normalized),
    '{"version":1,"principalId":"principal_demo","agentId":"agent_demo","taskId":"task_checkout","recipientId":"recipient_merchant_b","purpose":"pay_invoice","operationType":"payment","resourceId":"payment_instrument_demo","action":"pay","claimIds":[],"transactionId":"invoice_2048","amountMinor":4250,"currency":"USD","requestedUses":1}'
  );
  assert.notEqual(
    digestApprovalTerms(normalized),
    digestApprovalTerms(normalizeApprovalTerms({ ...paymentRequest, amountMinor: 4251 }))
  );
  assert.throws(
    () => normalizeApprovalTerms({ ...paymentRequest, unboundField: 'ignored?' }),
    /unknown field: unboundField/
  );
});
