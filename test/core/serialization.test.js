import assert from 'node:assert/strict';
import test from 'node:test';

import { toAgentSafeView, toSafeReceipt } from '../../src/core/serialization.js';

test('agent and audit serializers allowlist fields and exclude protected canaries', () => {
  const protectedCanary = 'PTF_CANARY_PAYMENT_9B7D';
  const canonical = {
    principalId: 'principal_demo',
    taskId: 'task_checkout',
    profile: 'synthetic_sandbox',
    personaClaims: [
      { key: 'purchase.budget_band', value: 'moderate', modelVisibility: 'shareable' },
      { key: 'payment.card_number', value: protectedCanary, modelVisibility: 'use_only' }
    ],
    availableCapabilityTypes: ['credential_presentation', 'payment'],
    approvalStatus: 'required',
    protectedValue: protectedCanary
  };
  const receipt = {
    id: 'receipt_1',
    correlationId: 'op_1',
    operationType: 'payment',
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    outcome: 'completed',
    occurredAt: '2026-09-02T08:00:00.000Z',
    protectedPayload: protectedCanary,
    debug: { providerRequest: protectedCanary }
  };

  const safeView = toAgentSafeView(canonical);
  const safeReceipt = toSafeReceipt(receipt);
  const observable = JSON.stringify({ safeView, safeReceipt });

  assert.deepEqual(safeView.persona, [{ key: 'purchase.budget_band', value: 'moderate' }]);
  assert.equal(observable.includes(protectedCanary), false);
  assert.equal(Object.hasOwn(safeReceipt, 'debug'), false);
});
