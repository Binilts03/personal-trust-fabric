import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrustRuntime } from '../../src/core/trust-runtime.js';

const credentialCanary = 'PTF_CANARY_CREDENTIAL_17AE';
const paymentCanary = 'PTF_CANARY_PAYMENT_9B7D';

const shared = {
  principalId: 'principal_demo',
  agentId: 'agent_demo',
  taskId: 'task_demo',
  requestedUses: 1
};

function createFixtureRuntime() {
  const ids = ['approval_credential', 'operation_credential', 'approval_payment', 'operation_payment'];
  return createTrustRuntime({
    now: () => 1_800_000_000_000,
    idFactory: () => ids.shift(),
    profile: 'synthetic_sandbox',
    policies: [
      {
        id: 'allow_credential',
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
        allowedModes: ['predicate_proof'],
        allowedClaims: ['membership.active']
      },
      {
        id: 'allow_payment',
        version: 1,
        effect: 'allow',
        match: {
          recipientId: 'recipient_merchant_b',
          purpose: 'pay_invoice',
          operationType: 'payment',
          action: 'pay'
        },
        requireApproval: true,
        maxUses: 1,
        maxAmountMinor: 5000,
        currencies: ['USD'],
        allowedModes: ['direct_delivery'],
        allowedClaims: []
      }
    ],
    personaClaims: [
      { key: 'purchase.budget_band', value: 'moderate', modelVisibility: 'shareable' },
      { key: 'payment.instrument', value: paymentCanary, modelVisibility: 'use_only' }
    ],
    providers: {
      credential_presentation: {
        publicOutcome: 'verified',
        recipientModes: ['predicate_proof'],
        candidates: [{ mode: 'predicate_proof', representationId: 'membership_active_proof' }],
        execute: async () => ({ outcome: credentialCanary, detail: credentialCanary, protected: credentialCanary })
      },
      payment: {
        publicOutcome: 'paid',
        recipientModes: ['direct_delivery'],
        candidates: [{ mode: 'direct_delivery', representationId: 'payment_authorization' }],
        execute: async () => ({ outcome: 'paid', detail: 'invoice settled', protected: paymentCanary })
      }
    }
  });
}

test('two protected operation classes use one policy/capability pipeline without leaking protected values', async () => {
  const runtime = createFixtureRuntime();
  const safeView = runtime.getSafeView({ principalId: 'principal_demo', taskId: 'task_demo' });
  assert.deepEqual(safeView.persona, [{ key: 'purchase.budget_band', value: 'moderate' }]);

  const credentialTerms = {
    ...shared,
    recipientId: 'recipient_verifier_a',
    purpose: 'verify_membership',
    operationType: 'credential_presentation',
    resourceId: 'credential_membership',
    action: 'present',
    claimIds: ['membership.active'],
    transactionId: 'verification_001',
    amountMinor: null,
    currency: null
  };
  const credentialProposal = runtime.requestOperation(credentialTerms);
  assert.equal(credentialProposal.decision, 'approval_required');
  assert.deepEqual(credentialProposal.displayedTerms, {
    principalId: credentialTerms.principalId,
    agentId: credentialTerms.agentId,
    taskId: credentialTerms.taskId,
    recipientId: credentialTerms.recipientId,
    purpose: credentialTerms.purpose,
    operationType: credentialTerms.operationType,
    resourceId: credentialTerms.resourceId,
    action: credentialTerms.action,
    claimIds: credentialTerms.claimIds,
    transactionId: credentialTerms.transactionId,
    requestedUses: 1,
    validForSeconds: 300,
    amountMinor: null,
    currency: null
  });
  const credentialApproval = runtime.decideApproval({
    approvalId: credentialProposal.approvalId,
    principalId: 'principal_demo',
    decision: 'approved'
  });
  const credentialResult = await runtime.executeOperation({
    reference: credentialApproval.operationReference,
    terms: credentialTerms,
    recipientProof: { recipientId: 'recipient_verifier_a', authenticated: true }
  });
  assert.equal(credentialResult.receipt.outcome, 'verified');

  const paymentTerms = {
    ...shared,
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    operationType: 'payment',
    resourceId: 'payment_instrument_demo',
    action: 'pay',
    claimIds: [],
    transactionId: 'invoice_2048',
    amountMinor: 4250,
    currency: 'USD'
  };
  const paymentProposal = runtime.requestOperation(paymentTerms);
  const paymentApproval = runtime.decideApproval({
    approvalId: paymentProposal.approvalId,
    principalId: 'principal_demo',
    decision: 'approved'
  });
  await assert.rejects(
    runtime.executeOperation({
      reference: paymentApproval.operationReference,
      terms: { ...paymentTerms, amountMinor: 4251 },
      recipientProof: { recipientId: 'recipient_merchant_b', authenticated: true }
    }),
    /approval terms mismatch/
  );
  const paymentResult = await runtime.executeOperation({
    reference: paymentApproval.operationReference,
    terms: paymentTerms,
    recipientProof: { recipientId: 'recipient_merchant_b', authenticated: true }
  });

  const observable = JSON.stringify({ safeView, credentialProposal, credentialApproval, credentialResult, paymentProposal, paymentApproval, paymentResult });
  assert.equal(observable.includes(credentialCanary), false);
  assert.equal(observable.includes(paymentCanary), false);
  assert.equal(paymentResult.receipt.outcome, 'paid');
});

test('policy rejects payment beyond approved amount profile before creating approval', () => {
  const runtime = createFixtureRuntime();
  const result = runtime.requestOperation({
    ...shared,
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    operationType: 'payment',
    resourceId: 'payment_instrument_demo',
    action: 'pay',
    claimIds: [],
    transactionId: 'invoice_overspend',
    amountMinor: 5001,
    currency: 'USD'
  });

  assert.deepEqual(result, {
    decision: 'deny',
    reason: 'request exceeds policy amount limit',
    policyIds: ['allow_payment@1']
  });
});
