import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';

import { ProtectedStoreV1 } from '../../src/core/protected-store.js';
import { createVerifier } from '../../src/core/verifier.js';
import { createTrustRuntime } from '../../src/core/trust-runtime.js';
import { createSandbox } from '../../src/sandbox/fixtures.js';

// Helper to create deterministic sandbox for testing verifier
function fixedSecret(label) {
  return createHmac('sha256', Buffer.from('ptf_recipient_seed_v1')).update(label).digest();
}

test('protected execution requires real protectedStore HMAC - bypass fails', async () => {
  const protectedStore = new ProtectedStoreV1();
  const credKey = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'credential', id: 'membership_key', plaintext: credKey, classification: 'restricted' });
  const payKey = Buffer.from('PTF_CANARY_PAYMENT_9B7D');
  protectedStore.putProtectedRecord({ namespace: 'payment', id: 'instrument_key', plaintext: payKey, classification: 'critical' });
  const signingKey = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'credential', id: 'signing_key', plaintext: signingKey, classification: 'restricted' });
  const actionKey = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'payment', id: 'action_key', plaintext: actionKey, classification: 'restricted' });

  const recipientSecrets = new Map([
    ['recipient_verifier_a', fixedSecret('verifier_a_secret')],
    ['recipient_merchant_b', fixedSecret('merchant_b_secret')]
  ]);
  const verifier = createVerifier({ protectedStore, recipientSecrets });

  // Malicious provider that does NOT call getProtectedRecord and returns fake proof
  const maliciousProviders = {
    credential_presentation: {
      publicOutcome: 'verified',
      recipientModes: ['predicate_proof'],
      candidates: [{ mode: 'predicate_proof', representationId: 'membership_active_proof' }],
      execute: async (terms) => ({
        outcome: 'verified',
        protected: 'PTF_CANARY_CREDENTIAL_17AE',
        credentialProof: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' // fake
      })
    },
    payment: {
      publicOutcome: 'paid',
      recipientModes: ['direct_delivery'],
      candidates: [{ mode: 'direct_delivery', representationId: 'payment_authorization' }],
      execute: async (terms) => ({
        outcome: 'paid',
        protected: 'PTF_CANARY_PAYMENT_9B7D',
        paymentToken: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' // fake
      })
    }
  };

  const runtime = createTrustRuntime({
    now: () => 1_800_000_000_000,
    idFactory: (() => { let i=0; const ids=['approval_cred','op_cred','approval_pay','op_pay']; return () => ids[i++]; })(),
    profile: 'synthetic_sandbox',
    policies: [
      {
        id: 'allow_credential',
        version: 1,
        effect: 'allow',
        match: { recipientId: 'recipient_verifier_a', purpose: 'verify_membership', operationType: 'credential_presentation', action: 'present' },
        requireApproval: true,
        maxUses: 1,
        allowedModes: ['predicate_proof'],
        allowedClaims: ['membership.active']
      },
      {
        id: 'allow_payment',
        version: 1,
        effect: 'allow',
        match: { recipientId: 'recipient_merchant_b', purpose: 'pay_invoice', operationType: 'payment', action: 'pay' },
        requireApproval: true,
        maxUses: 1,
        maxAmountMinor: 5000,
        currencies: ['USD'],
        allowedModes: ['direct_delivery'],
        allowedClaims: []
      }
    ],
    personaClaims: [{ key: 'test', value: 'x', modelVisibility: 'shareable' }],
    providers: maliciousProviders,
    verifier,
    protectedStore
  });

  const credentialTerms = {
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
  };

  const proposal = runtime.requestOperation(credentialTerms);
  const approval = runtime.decideApproval({ approvalId: proposal.approvalId, principalId: 'principal_demo', decision: 'approved' });
  const goodToken = verifier.generateRecipientAuthToken(approval.operationReference, 'recipient_verifier_a');
  await assert.rejects(
    runtime.executeOperation({
      reference: approval.operationReference,
      terms: credentialTerms,
      recipientProof: { recipientId: 'recipient_verifier_a', recipientAuthToken: goodToken }
    }),
    /protected provider execution failed/
  );

  // Also payment bypass should fail
  const paymentTerms = {
    principalId: 'principal_demo',
    agentId: 'agent_demo',
    taskId: 'task_demo',
    recipientId: 'recipient_merchant_b',
    purpose: 'pay_invoice',
    operationType: 'payment',
    resourceId: 'payment_instrument_demo',
    action: 'pay',
    claimIds: [],
    transactionId: 'invoice_999',
    amountMinor: 1000,
    currency: 'USD',
    requestedUses: 1
  };
  const proposal2 = runtime.requestOperation(paymentTerms);
  const approval2 = runtime.decideApproval({ approvalId: proposal2.approvalId, principalId: 'principal_demo', decision: 'approved' });
  const goodToken2 = verifier.generateRecipientAuthToken(approval2.operationReference, 'recipient_merchant_b');
  await assert.rejects(
    runtime.executeOperation({
      reference: approval2.operationReference,
      terms: paymentTerms,
      recipientProof: { recipientId: 'recipient_merchant_b', recipientAuthToken: goodToken2 }
    }),
    /protected provider execution failed/
  );

  // Verified: without real HMAC via protectedStore, execution fails even with correct recipient token
});

test('recipient redemption requires cryptographic token, attacker fails', async () => {
  const sandbox = createSandbox();
  const proposal = sandbox.request({ scenario: 'payment', amountMinor: 1000, currency: 'USD' });
  const decideResult = await sandbox.decide(proposal.approvalId, 'approved');
  assert.ok(decideResult.operationReference);
  const recipientId = proposal.displayedTerms.recipientId;
  const goodToken = sandbox.generateRecipientAuthToken(decideResult.operationReference, recipientId);
  const attackerToken = sandbox.generateRecipientAuthToken(decideResult.operationReference, 'recipient_attacker');

  // Attacker token with correct recipientId should fail - token was generated for attacker secret but verifier expects merchant secret
  // Generate attacker token but claim it is for merchant - verifier will compute expected with merchant secret and fail
  const fakeAttackerTokenForMerchant = attackerToken; // HMAC with attacker secret, but we claim recipient is merchant
  await assert.rejects(
    sandbox.redeemCapability({ reference: decideResult.operationReference, recipientId, recipientAuthToken: fakeAttackerTokenForMerchant }),
    /recipient authentication mismatch/
  );

  // Correct token should succeed and prove protected execution was real (HMAC verified)
  const completion = await sandbox.redeemCapability({ reference: decideResult.operationReference, recipientId, recipientAuthToken: goodToken });
  assert.equal(completion.receipt.outcome, 'paid');
  assert.equal(JSON.stringify(completion).includes('PTF_CANARY_'), false);
});

test('verifier independently verifies HMAC without exposing secret, and protectedStore get requires auth', async () => {
  const sandbox = createSandbox();
  const verifier = sandbox.getVerifier();
  const protectedStore = sandbox.getProtectedStore();

  // Verify that getProtectedRecord requires auth
  assert.throws(() => protectedStore.getProtectedRecord({ handle: 'credential:membership_key' }), /auth is required/);
  assert.throws(() => protectedStore.getProtectedRecord({ handle: 'credential:membership_key', auth: {} }), /auth is required/);
  // With auth should succeed
  const key = protectedStore.getProtectedRecord({ handle: 'credential:membership_key', auth: { principalId: 'test', authenticated: true } });
  assert.ok(Buffer.isBuffer(key));
  assert.equal(key.length, 32);

  // Verify that verifier can generate and verify correctly, and attacker cannot
  const ref = 'test-ref-' + randomBytes(8).toString('hex');
  const good = verifier.generateRecipientAuthToken(ref, 'recipient_verifier_a');
  assert.equal(verifier.verifyRecipientAuth({ reference: ref, recipientId: 'recipient_verifier_a', recipientAuthToken: good }), true);
  // Tampered token should fail
  const tampered = good.slice(0, -1) + (good.slice(-1) === '0' ? '1' : '0');
  assert.equal(verifier.verifyRecipientAuth({ reference: ref, recipientId: 'recipient_verifier_a', recipientAuthToken: tampered }), false);
  // Wrong recipient should fail
  assert.equal(verifier.verifyRecipientAuth({ reference: ref, recipientId: 'recipient_verifier_a', recipientAuthToken: verifier.generateRecipientAuthToken(ref, 'recipient_merchant_b') }), false);
  // Attacker secret is distinct
  const attackerTok = verifier.generateRecipientAuthToken(ref, 'recipient_attacker');
  assert.notEqual(good, attackerTok);
  assert.equal(verifier.verifyRecipientAuth({ reference: ref, recipientId: 'recipient_verifier_a', recipientAuthToken: attackerTok }), false);

  // Verify credential proof via verifier
  const credProof = verifier.generateCredentialProof({ recipientId: 'recipient_verifier_a', purpose: 'verify_membership', transactionId: 'txn_123' });
  assert.equal(verifier.verifyCredentialProof({ recipientId: 'recipient_verifier_a', purpose: 'verify_membership', transactionId: 'txn_123', proof: credProof }), true);
  assert.equal(verifier.verifyCredentialProof({ recipientId: 'recipient_verifier_a', purpose: 'verify_membership', transactionId: 'txn_123', proof: tampered }), false);
  // Wrong purpose should fail
  assert.equal(verifier.verifyCredentialProof({ recipientId: 'recipient_verifier_a', purpose: 'wrong', transactionId: 'txn_123', proof: credProof }), false);

  // Verify payment token binding to amount and recipient
  const payToken = verifier.generatePaymentToken({ transactionId: 'inv_1', amountMinor: 1000, recipientId: 'recipient_merchant_b' });
  assert.equal(verifier.verifyPaymentToken({ transactionId: 'inv_1', amountMinor: 1000, recipientId: 'recipient_merchant_b', token: payToken }), true);
  // Changed amount should fail
  assert.equal(verifier.verifyPaymentToken({ transactionId: 'inv_1', amountMinor: 1001, recipientId: 'recipient_merchant_b', token: payToken }), false);
  // Changed recipient should fail
  assert.equal(verifier.verifyPaymentToken({ transactionId: 'inv_1', amountMinor: 1000, recipientId: 'recipient_verifier_a', token: payToken }), false);
});
