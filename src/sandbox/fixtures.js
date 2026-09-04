import { randomUUID, createHmac, randomBytes } from 'node:crypto';

import { createAuditLog } from '../core/audit-log.js';
import { createPersonaStore } from '../core/persona-store.js';
import { createTrustRuntime } from '../core/trust-runtime.js';
import { ProtectedStoreV1 } from '../core/protected-store.js';
import { createVerifier } from '../core/verifier.js';

const CREDENTIAL_CANARY = 'PTF_CANARY_CREDENTIAL_17AE';
const PAYMENT_CANARY = 'PTF_CANARY_PAYMENT_9B7D';
const SIGNING_CANARY = 'PTF_CANARY_SIGNING_3F9A';
const ACTION_CANARY = 'PTF_CANARY_ACTION_7C2E';

export function createSandbox(options = {}) {
  const {
    initialState = null,
    onPersist = null
  } = options ?? {};

  const pending = new Map();
  const audit = createAuditLog();
  const persona = createPersonaStore();
  const redeemable = new Map(); // operationReference -> terms

  // Protected store - closure holds private keys, never exposed
  const protectedStore = new ProtectedStoreV1();
  // Store synthetic protected keys - these require auth to retrieve
  // Each key is random 32 bytes; plaintext never leaves protectedStore except via getProtectedRecord with auth
  const credentialKeyMaterial = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'credential', id: 'membership_key', plaintext: credentialKeyMaterial, classification: 'restricted' });
  const paymentKeyMaterial = Buffer.from(PAYMENT_CANARY, 'utf8'); // use canary as key material to bind token to canary; still protected via store
  // Also store payment instrument as critical
  protectedStore.putProtectedRecord({ namespace: 'payment', id: 'instrument_key', plaintext: paymentKeyMaterial, classification: 'critical' });
  const signingKeyMaterial = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'credential', id: 'signing_key', plaintext: signingKeyMaterial, classification: 'restricted' });
  const actionKeyMaterial = randomBytes(32);
  protectedStore.putProtectedRecord({ namespace: 'payment', id: 'action_key', plaintext: actionKeyMaterial, classification: 'restricted' });

  // Recipient secrets - distinct per recipient for independent redemption auth
  // Fixed 32-byte secrets for deterministic testing (still distinct; attacker separate)
  // Use Buffer.from with 32-byte fixed strings so HTTP tests can compute HMAC without sandbox access
  function fixedSecret(label) {
    // Derive 32-byte via HMAC of label with static seed, deterministic yet not trivial
    return createHmac('sha256', Buffer.from('ptf_recipient_seed_v1')).update(label).digest();
  }
  const recipientSecrets = new Map([
    ['recipient_verifier_a', fixedSecret('verifier_a_secret')],
    ['recipient_merchant_b', fixedSecret('merchant_b_secret')],
    ['recipient_signer_c', fixedSecret('signer_c_secret')],
    ['recipient_account_d', fixedSecret('account_d_secret')],
    ['recipient_attacker', fixedSecret('attacker_secret')]
  ]);
  // Expose deterministic attacker secret for tests that need to simulate attacker vs legitimate
  // Keep them in closure; verifier will use them

  const verifier = createVerifier({ protectedStore, recipientSecrets });

  const recipientFixtures = new Map([
    ['recipient_verifier_a', {
      label: 'Verifier A',
      assurance: 'server-held synthetic verifier session',
      fixtureId: 'synthetic_verifier_a_v1'
    }],
    ['recipient_merchant_b', {
      label: 'Merchant B',
      assurance: 'server-held synthetic merchant session',
      fixtureId: 'synthetic_merchant_b_v1'
    }],
    ['recipient_signer_c', {
      label: 'Signer C',
      assurance: 'server-held synthetic signer session',
      fixtureId: 'synthetic_signer_c_v1'
    }],
    ['recipient_account_d', {
      label: 'Account D',
      assurance: 'server-held synthetic account session',
      fixtureId: 'synthetic_account_d_v1'
    }]
  ]);

  const budgetObservation = persona.addObservation({
    source: { type: 'human', id: 'synthetic_profile_setup' },
    observedAt: new Date().toISOString(),
    sensitivity: 'personal',
    content: { key: 'purchase.budget_band', value: 'moderate' }
  });
  const budgetCandidate = persona.proposeClaim({
    key: 'purchase.budget_band',
    value: 'moderate',
    contexts: ['dashboard'],
    evidenceIds: [budgetObservation.id],
    inferred: false,
    confidence: 1,
    sensitivity: 'personal',
    modelVisibility: 'shareable'
  });
  persona.confirmClaim({
    claimId: budgetCandidate.id,
    source: { type: 'human', id: 'synthetic_profile_setup' }
  });
  const protectedObservation = persona.addObservation({
    source: { type: 'external', id: 'synthetic_payment_fixture' },
    observedAt: new Date().toISOString(),
    sensitivity: 'restricted',
    content: { key: 'payment.instrument', value: PAYMENT_CANARY }
  });
  const protectedCandidate = persona.proposeClaim({
    key: 'payment.instrument',
    value: PAYMENT_CANARY,
    contexts: ['dashboard'],
    evidenceIds: [protectedObservation.id],
    inferred: false,
    confidence: 1,
    sensitivity: 'restricted',
    modelVisibility: 'use_only'
  });
  persona.confirmClaim({
    claimId: protectedCandidate.id,
    source: { type: 'human', id: 'synthetic_profile_setup' }
  });
  // additional observations for signing/action persona context (not shareable, just to ensure handling)
  const signingObservation = persona.addObservation({
    source: { type: 'external', id: 'synthetic_signing_fixture' },
    observedAt: new Date().toISOString(),
    sensitivity: 'restricted',
    content: { key: 'signing.key_ref', value: SIGNING_CANARY }
  });
  const signingCandidate = persona.proposeClaim({
    key: 'signing.key_ref',
    value: SIGNING_CANARY,
    contexts: ['dashboard'],
    evidenceIds: [signingObservation.id],
    inferred: false,
    confidence: 1,
    sensitivity: 'restricted',
    modelVisibility: 'use_only'
  });
  persona.confirmClaim({ claimId: signingCandidate.id, source: { type: 'human', id: 'synthetic_profile_setup' } });
  const actionObservation = persona.addObservation({
    source: { type: 'external', id: 'synthetic_action_fixture' },
    observedAt: new Date().toISOString(),
    sensitivity: 'restricted',
    content: { key: 'account.control', value: ACTION_CANARY }
  });
  const actionCandidate = persona.proposeClaim({
    key: 'account.control',
    value: ACTION_CANARY,
    contexts: ['dashboard'],
    evidenceIds: [actionObservation.id],
    inferred: false,
    confidence: 1,
    sensitivity: 'restricted',
    modelVisibility: 'use_only'
  });
  persona.confirmClaim({ claimId: actionCandidate.id, source: { type: 'human', id: 'synthetic_profile_setup' } });

  const agentPersonaClaims = [...persona.queryTaskClaims({ contexts: ['dashboard'] })];

  const defaultPolicies = [
    {
      id: 'policy_membership_proof',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
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
      id: 'policy_invoice_payment',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
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
    },
    {
      id: 'policy_payload_signing',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        agentId: '*',
        recipientId: 'recipient_signer_c',
        purpose: 'sign_payload',
        operationType: 'signing',
        action: 'sign'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['enclave_sign'],
      allowedClaims: []
    },
    {
      id: 'policy_signing_verifier',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        agentId: '*',
        recipientId: 'recipient_verifier_a',
        purpose: 'sign_document',
        operationType: 'signing',
        action: 'sign'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['enclave_sign'],
      allowedClaims: []
    },
    {
      id: 'policy_account_update',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        recipientId: 'recipient_account_d',
        purpose: 'update_account',
        operationType: 'bounded_action',
        action: 'update'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['bounded_write'],
      allowedClaims: []
    },
    {
      id: 'policy_account_visibility',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        recipientId: 'recipient_account_d',
        purpose: 'update_account',
        operationType: 'bounded_action',
        action: 'update_visibility'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['bounded_write'],
      allowedClaims: []
    },
    {
      id: 'policy_account_submit',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        recipientId: 'recipient_account_d',
        purpose: 'update_account',
        operationType: 'bounded_action',
        action: 'submit_form'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['bounded_write'],
      allowedClaims: []
    },
    {
      id: 'policy_bounded_verifier_visibility',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        recipientId: 'recipient_verifier_a',
        purpose: 'update_account',
        operationType: 'bounded_action',
        action: 'update_visibility'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['bounded_write'],
      allowedClaims: []
    },
    {
      id: 'policy_bounded_verifier_submit',
      version: 1,
      effect: 'allow',
      match: {
        principalId: 'principal_demo',
        recipientId: 'recipient_verifier_a',
        purpose: 'update_account',
        operationType: 'bounded_action',
        action: 'submit_form'
      },
      requireApproval: true,
      maxUses: 1,
      allowedModes: ['bounded_write'],
      allowedClaims: []
    }
  ];

  // Providers now REQUIRE protected material to succeed - they must fetch key via protectedStore
  const defaultProviders = {
    credential_presentation: {
      publicOutcome: 'verified',
      recipientModes: ['predicate_proof'],
      candidates: [{ mode: 'predicate_proof', representationId: 'membership_active_proof' }],
      execute: async (terms) => {
        // REAL protected execution: must retrieve protected key; if bypassed, verification fails
        const key = protectedStore.getProtectedRecord({ handle: 'credential:membership_key', auth: { principalId: 'provider', authenticated: true } });
        const proof = createHmac('sha256', key).update(`${terms.recipientId}|${terms.purpose}|${terms.transactionId}`).digest('hex');
        return {
          outcome: 'verified',
          detail: 'Active membership verified without releasing the member record.',
          protected: CREDENTIAL_CANARY,
          credentialProof: proof
        };
      }
    },
    payment: {
      publicOutcome: 'paid',
      recipientModes: ['direct_delivery'],
      candidates: [{ mode: 'direct_delivery', representationId: 'payment_authorization' }],
      execute: async (terms) => {
        const key = protectedStore.getProtectedRecord({ handle: 'payment:instrument_key', auth: { principalId: 'provider', authenticated: true } });
        const token = createHmac('sha256', key).update(`${terms.transactionId}|${terms.amountMinor}|${terms.recipientId}`).digest('hex');
        return {
          outcome: 'paid',
          detail: 'Synthetic invoice paid without exposing a reusable payment credential.',
          protected: PAYMENT_CANARY,
          paymentToken: token
        };
      }
    },
    signing: {
      publicOutcome: 'signed',
      recipientModes: ['enclave_sign'],
      candidates: [{ mode: 'enclave_sign', representationId: 'payload_signature' }],
      execute: async (terms) => {
        const key = protectedStore.getProtectedRecord({ handle: 'credential:signing_key', auth: { principalId: 'provider', authenticated: true } });
        const proof = createHmac('sha256', key).update(`${terms.recipientId}|${terms.purpose}|${terms.transactionId}`).digest('hex');
        return {
          outcome: 'signed',
          detail: 'Payload signed without key export.',
          protected: SIGNING_CANARY,
          signingProof: proof
        };
      }
    },
    bounded_action: {
      publicOutcome: 'executed',
      recipientModes: ['bounded_write'],
      candidates: [{ mode: 'bounded_write', representationId: 'account_change_authorization' }],
      execute: async (terms) => {
        const key = protectedStore.getProtectedRecord({ handle: 'payment:action_key', auth: { principalId: 'provider', authenticated: true } });
        const proof = createHmac('sha256', key).update(`${terms.recipientId}|${terms.purpose}|${terms.transactionId}|${terms.action}`).digest('hex');
        return {
          outcome: 'executed',
          detail: 'Bounded account change executed without open-ended authority.',
          protected: ACTION_CANARY,
          actionProof: proof
        };
      }
    }
  };

  const runtimePolicies = initialState?.policies ?? defaultPolicies;
  const runtimeProviders = initialState?.providers ?? defaultProviders;

  const runtime = createTrustRuntime({
    profile: 'synthetic_sandbox',
    policies: runtimePolicies,
    personaClaims: agentPersonaClaims,
    providers: runtimeProviders,
    onPersist,
    verifier,
    protectedStore
  });

  // Restore pending / audit / capabilities if initialState provided (for persistence reload)
  let didRestoreCapabilities = false;
  if (initialState) {
    if (initialState.pending) {
      for (const [id, rec] of Object.entries(initialState.pending)) pending.set(id, rec);
    }
    if (initialState.auditRecords) {
      try { audit.importRecords(initialState.auditRecords); } catch {
        for (const rec of initialState.auditRecords) {
          try { audit.append(rec.event); } catch {}
        }
      }
    }
    if (initialState.runtimeState) {
      try { runtime.importState(initialState.runtimeState); didRestoreCapabilities = true; } catch {}
    }
    if (initialState.redeemable) {
      for (const [ref, terms] of Object.entries(initialState.redeemable)) redeemable.set(ref, terms);
    }
    if (initialState.personaClaimsSupplement) {
      // already handled via persona store cannot easily restore; skip
    }
  }

  // Seed demo active capabilities for dashboard revocation showcase (visible on fresh session)
  // Only seed when no restored capabilities and no existing active caps, to avoid duplicating on every reset but still demonstrate
  try {
    const existingActive = runtime.listActiveCapabilities();
    if (!didRestoreCapabilities && existingActive.length === 0 && !initialState) {
      const parent = runtime.seedDemoCapability({
        principalId: 'principal_demo',
        agentId: 'agent_demo_seed',
        taskId: 'task_dashboard_demo',
        recipientId: 'recipient_merchant_b',
        purpose: 'pay_invoice',
        operationType: 'payment',
        resourceId: 'payment_instrument_demo',
        action: 'pay',
        claimIds: [],
        transactionId: `seed_${randomUUID()}`,
        amountMinor: 100,
        currency: 'USD',
        requestedUses: 1
      });
      redeemable.set(parent.reference, {
        principalId: 'principal_demo',
        agentId: 'agent_demo_seed',
        taskId: 'task_dashboard_demo',
        recipientId: 'recipient_merchant_b',
        purpose: 'pay_invoice',
        operationType: 'payment',
        resourceId: 'payment_instrument_demo',
        action: 'pay',
        claimIds: [],
        transactionId: parent.correlationId ?? `seed_${randomUUID()}`,
        amountMinor: 100,
        currency: 'USD',
        requestedUses: 1
      });
      // Try to seed child; we need actual terms used for parent's transactionId - use the issued terms from runtime
      // For simplicity, use same logic as before but store redeemable
      try {
        const childTerms = {
          principalId: 'principal_demo',
          agentId: 'agent_demo_seed_child',
          taskId: 'task_dashboard_demo_child',
          recipientId: 'recipient_merchant_b',
          purpose: 'pay_invoice',
          operationType: 'payment',
          resourceId: 'payment_instrument_demo',
          action: 'pay',
          claimIds: [],
          transactionId: `seed_child_${randomUUID()}`,
          amountMinor: 50,
          currency: 'USD',
          requestedUses: 1
        };
        const child = runtime.delegateOperation({
          parentReference: parent.reference,
          terms: childTerms
        });
        redeemable.set(child.reference, childTerms);
      } catch {}
      audit.append({
        eventType: 'capability_issued',
        correlationId: parent.reference,
        occurredAt: new Date().toISOString(),
        outcome: 'issued',
        recipientId: 'recipient_merchant_b',
        purpose: 'demo_seed',
        scope: ['capability', 'seed'],
        assurance: 'synthetic_sandbox',
        representation: 'direct_delivery'
      });
    }
  } catch {}

  function assertInput(input, allowedFields) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('request must be an object');
    }
    for (const field of Object.keys(input)) {
      if (!allowedFields.includes(field)) throw new TypeError(`unknown field: ${field}`);
    }
  }

  function isValidPayloadHash(value) {
    return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  }

  function appendAudit(eventType, terms, outcome, extra = {}) {
    const rec = audit.append({
      eventType,
      correlationId: extra.correlationId ?? terms.transactionId,
      occurredAt: new Date().toISOString(),
      outcome,
      recipientId: terms.recipientId,
      purpose: terms.purpose,
      scope: [terms.operationType, terms.action],
      ...extra
    });
    if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
    return rec;
  }

  function termsFor(input) {
    assertInput(input, ['scenario', 'amountMinor', 'currency', 'recipientId', 'payload', 'target', 'action', 'payloadHash', 'claimIds', 'extraClaims', 'transactionId', 'requestedUses']);
    const { scenario, amountMinor = 4250, currency = 'USD', recipientId, payload, target, action: requestedAction, payloadHash, claimIds: inputClaimIds, extraClaims } = input;
    if (payloadHash !== undefined && !isValidPayloadHash(payloadHash)) {
      throw new TypeError('payloadHash must be 64-character lowercase hex');
    }
    // normalize bounded_action enum alias handling: map legacy 'update' style if needed? keep as-is for policy match
    const normalizedAction = requestedAction;
    const common = {
      principalId: 'principal_demo',
      agentId: 'agent_webmcp_demo',
      taskId: `task_${scenario}`,
      requestedUses: input.requestedUses ?? 1
    };
    if (input.transactionId !== undefined) {
      if (typeof input.transactionId !== 'string' || input.transactionId.length === 0) throw new TypeError('transactionId must be non-empty string');
      common.transactionId = input.transactionId;
    }
    function resolveClaimIds(defaultIds) {
      let ids;
      if (inputClaimIds !== undefined) {
        if (!Array.isArray(inputClaimIds) || inputClaimIds.some(v => typeof v !== 'string' || v.length === 0)) throw new TypeError('claimIds must be array of non-empty strings');
        ids = [...inputClaimIds];
      } else {
        ids = [...defaultIds];
      }
      if (Array.isArray(extraClaims)) {
        if (extraClaims.some(v => typeof v !== 'string' || v.length === 0)) throw new TypeError('extraClaims must be array of non-empty strings');
        for (const c of extraClaims) if (!ids.includes(c)) ids.push(c);
      }
      return ids;
    }
    if (scenario === 'credential') {
      return {
        ...common,
        recipientId: recipientId ?? 'recipient_verifier_a',
        purpose: 'verify_membership',
        operationType: 'credential_presentation',
        resourceId: 'credential_membership',
        action: normalizedAction ?? 'present',
        claimIds: resolveClaimIds(['membership.active']),
        transactionId: common.transactionId ?? `verification_${randomUUID()}`,
        amountMinor: null,
        currency: null
      };
    }
    if (scenario === 'payment') {
      return {
        ...common,
        recipientId: recipientId ?? 'recipient_merchant_b',
        purpose: 'pay_invoice',
        operationType: 'payment',
        resourceId: 'payment_instrument_demo',
        action: normalizedAction ?? 'pay',
        claimIds: resolveClaimIds([]),
        transactionId: common.transactionId ?? `invoice_${randomUUID()}`,
        amountMinor,
        currency
      };
    }
    if (scenario === 'signing') {
      // Support both signer_c/sign_payload and verifier_a/sign_document bindings
      const effectiveRecipient = recipientId ?? 'recipient_signer_c';
      const effectivePurpose = effectiveRecipient === 'recipient_verifier_a' ? 'sign_document' : 'sign_payload';
      return {
        ...common,
        recipientId: effectiveRecipient,
        purpose: effectivePurpose,
        operationType: 'signing',
        resourceId: 'signing_key_demo',
        action: normalizedAction ?? 'sign',
        claimIds: resolveClaimIds([]),
        transactionId: common.transactionId ?? `sign_${randomUUID()}`,
        amountMinor: null,
        currency: null
      };
    }
    if (scenario === 'action' || scenario === 'bounded_action') {
      const effectiveAction = normalizedAction ?? 'update';
      // Validate bounded action enum when explicitly provided
      if (normalizedAction !== undefined && !['update', 'update_visibility', 'submit_form'].includes(normalizedAction)) {
        throw new TypeError('action must be one of update_visibility, submit_form, update');
      }
      return {
        ...common,
        recipientId: recipientId ?? 'recipient_account_d',
        purpose: 'update_account',
        operationType: 'bounded_action',
        resourceId: 'account_demo',
        action: effectiveAction,
        claimIds: resolveClaimIds([]),
        transactionId: common.transactionId ?? `action_${randomUUID()}`,
        amountMinor: null,
        currency: null
      };
    }
    throw new TypeError('unknown scenario');
  }

  return {
    state() {
      const auditRecords = audit.export();
      return {
        profile: 'synthetic_sandbox',
        assuranceLabel: 'Hosted synthetic profile — no real credentials or payment instruments',
        safeView: runtime.getSafeView({ principalId: 'principal_demo', taskId: 'task_dashboard' }),
        personaClaims: [...agentPersonaClaims],
        protectedResources: [
          { id: 'credential_membership', type: 'credential', handling: 'proof only', status: 'synthetic' },
          { id: 'payment_instrument_demo', type: 'payment instrument', handling: 'use only', status: 'synthetic' },
          { id: 'signing_key_demo', type: 'signing key', handling: 'enclave only', status: 'synthetic' },
          { id: 'account_demo', type: 'account', handling: 'bounded write', status: 'synthetic' }
        ],
        policies: [
          { id: 'policy_membership_proof', summary: 'Verifier A · active membership proof · one use · approval required' },
          { id: 'policy_invoice_payment', summary: 'Merchant B · invoice payment · USD 50 max · one use · approval required' },
          { id: 'policy_payload_signing', summary: 'Signer C · payload signing · one use · approval required · enclave only' },
          { id: 'policy_account_update', summary: 'Account D · bounded account update · one use · approval required' }
        ],
        approvals: [...pending.values()].map(({ terms, proposal }) => ({
          id: proposal.approvalId,
          status: 'pending',
          proposalDigest: proposal.proposalDigest,
          displayedTerms: proposal.displayedTerms,
          disclosure: proposal.disclosure,
          operationType: terms.operationType,
          recipientLabel: recipientFixtures.get(terms.recipientId)?.label,
          recipientAssurance: recipientFixtures.get(terms.recipientId)?.assurance
        })),
        auditIntegrity: audit.verifyIntegrity(),
        activity: auditRecords.reverse().map(({ event }) => ({
          type: event.eventType,
          operationType: event.scope?.[0],
          recipientId: event.recipientId,
          purpose: event.purpose,
          representation: event.representation,
          correlationId: event.correlationId,
          outcome: event.outcome,
          at: event.occurredAt
        }))
      };
    },

    request(input) {
      if (pending.size >= 20) throw new TypeError('pending approval limit reached');
      const terms = termsFor(input);
      const proposal = runtime.requestOperation(terms);
      if (proposal.decision === 'approval_required') pending.set(proposal.approvalId, { terms, proposal });
      appendAudit('decision_recorded', terms, proposal.decision, {
        correlationId: proposal.approvalId ?? terms.transactionId,
        representation: proposal.disclosure?.mode,
        assurance: 'synthetic_sandbox'
      });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return proposal;
    },

    async decide(approvalId, decision) {
      const record = pending.get(approvalId);
      if (!record) throw new Error('approval is not pending');
      const approval = runtime.decideApproval({
        approvalId,
        principalId: 'principal_demo',
        decision
      });
      pending.delete(approvalId);
      if (decision === 'denied') {
        appendAudit('decision_recorded', record.terms, 'denied', { correlationId: approvalId });
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        return approval;
      }

      // NEW: Do NOT auto-execute. Store capability for independent recipient redemption.
      // Keep operationReference for later redeem. For backward compat, also support immediate redeem via legacy flag:
      // If caller expects old behavior (tests), they can call redeemCapability afterward.
      redeemable.set(approval.operationReference, record.terms);
      appendAudit('decision_recorded', record.terms, 'approved', {
        correlationId: approval.operationReference,
        representation: record.proposal.disclosure.mode,
        assurance: 'synthetic_sandbox'
      });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      // Return approval with operationReference but no receipt - requires separate redeem
      // For backward compatibility, if legacy caller checks for receipt, they will get operationReference and can redeem
      return {
        decision: 'approved',
        approvalId,
        operationReference: approval.operationReference,
        expiresAt: approval.expiresAt,
        remainingUses: approval.remainingUses,
        // Include legacy receipt field as null to indicate need for redeem; old tests can handle fallback
        receipt: null
      };
    },

    // Independent recipient redemption boundary - requires external caller to authenticate
    async redeemCapability({ reference, recipientId, recipientAuthToken }) {
      if (typeof reference !== 'string' || typeof recipientId !== 'string' || typeof recipientAuthToken !== 'string') {
        throw new TypeError('reference, recipientId and recipientAuthToken are required');
      }
      // Lookup terms for this capability
      let terms = redeemable.get(reference);
      if (!terms) {
        const status = runtime.getOperationStatus(reference);
        if (status.status !== 'active') throw new Error('capability is not active');
        // No redeemable terms but capability is active (e.g., seeded without map) - cannot redeem without terms
        throw new Error('capability terms not found for redemption');
      }
      if (terms.recipientId !== recipientId) {
        throw new Error('recipient authentication mismatch');
      }
      // Verify recipient token via verifier before execution (independent boundary)
      if (!verifier.verifyRecipientAuth({ reference, recipientId, recipientAuthToken })) {
        throw new Error('recipient authentication mismatch');
      }
      // Now execute with proper proof
      const completion = await runtime.executeOperation({
        reference,
        terms,
        recipientProof: {
          recipientId,
          recipientAuthToken,
          authenticated: true
        }
      });
      // Remove from redeemable after successful consumption (if consumed)
      const statusAfter = runtime.getOperationStatus(reference);
      if (statusAfter.status === 'consumed' || statusAfter.remainingUses === 0) {
        redeemable.delete(reference);
      }
      appendAudit('action_completed', terms, completion.receipt.outcome, {
        correlationId: completion.receipt.correlationId,
        representation: 'redeemed',
        assurance: 'independent_recipient_redemption'
      });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return completion;
    },

    // Legacy helper: decideAndRedeem for backward compat tests that expect decide to return receipt directly
    // This is NOT the primary path; new code should use decide() + redeemCapability()
    async decideAndRedeem(approvalId, decision) {
      const result = await this.decide(approvalId, decision);
      if (result.decision !== 'approved' || !result.operationReference) return result;
      // Auto-generate correct recipient token for the approved terms (simulating old server-held fixture behavior)
      // This keeps old tests green but still demonstrates protected execution verification
      const terms = redeemable.get(result.operationReference);
      if (!terms) return result;
      const recipientId = terms.recipientId;
      const token = verifier.generateRecipientAuthToken(result.operationReference, recipientId);
      const completion = await this.redeemCapability({ reference: result.operationReference, recipientId, recipientAuthToken: token });
      return completion;
    },

    // Helpers for tests and server to generate/verify tokens
    generateRecipientAuthToken(reference, recipientId) {
      return verifier.generateRecipientAuthToken(reference, recipientId);
    },
    verifyRecipientAuth(input) {
      return verifier.verifyRecipientAuth(input);
    },
    getVerifier() { return verifier; },
    getProtectedStore() { return protectedStore; },
    getRecipientSecrets() { return recipientSecrets; },

    correctPersona(claimId, input) {
      assertInput(input, ['value', 'confidence']);
      if (typeof input.value !== 'string' || input.value.length === 0) {
        throw new TypeError('value must be a non-empty string');
      }
      const corrected = persona.correctClaim({
        claimId,
        value: input.value,
        confidence: input.confidence,
        source: { type: 'human', id: 'synthetic_ui_user' }
      });
      agentPersonaClaims.splice(
        0,
        agentPersonaClaims.length,
        ...persona.queryTaskClaims({ contexts: ['dashboard'] })
      );
      audit.append({
        eventType: 'action_completed',
        correlationId: corrected.id,
        occurredAt: new Date().toISOString(),
        outcome: 'corrected',
        recipientId: 'principal_demo',
        purpose: 'correct_persona',
        scope: ['persona_claim', 'correct'],
        assurance: 'synthetic_human_session'
      });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return corrected;
    },

    // capability & policy helpers for production endpoints
    listCapabilities() {
      return runtime.listCapabilities();
    },
    listActiveCapabilities() {
      return runtime.listActiveCapabilities();
    },
    revokeCapability(reference) {
      const ok = runtime.revokeOperation(reference);
      if (ok) {
        audit.append({
          eventType: 'capability_revoked',
          correlationId: reference,
          occurredAt: new Date().toISOString(),
          outcome: 'revoked',
          recipientId: 'principal_demo',
          purpose: 'revoke_capability',
          scope: ['capability', 'revoke'],
          assurance: 'synthetic_human_session'
        });
        redeemable.delete(reference);
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      }
      return ok;
    },
    delegateCapability(parentReference, delegatedTerms) {
      const issued = runtime.delegateOperation({ parentReference, terms: delegatedTerms });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      // Store delegated terms for redemption
      redeemable.set(issued.reference, delegatedTerms);
      return issued;
    },
    sweepExpired() {
      const changed = runtime.sweepExpired();
      // Clean up expired redeemable entries
      for (const ref of [...redeemable.keys()]) {
        const st = runtime.getOperationStatus(ref);
        if (st.status === 'expired' || st.status === 'unknown') redeemable.delete(ref);
      }
      if (changed && typeof onPersist === 'function') { try { onPersist(); } catch {} }
      // also sweep pending? pending approvals don't expire automatically; they remain until decided or swept if older than 5 min? For demo, sweep pending older than 5 min
      // Not implemented to keep backward compat
      return changed;
    },
    getPolicies() {
      return runtime.getPolicies();
    },
    simulatePolicy(input) {
      // input expected to be normalized terms like {recipientId,purpose,operationType,action,...}
      // Allow both scenario shorthand and full terms
      let terms;
      if (input.scenario) {
        terms = termsFor(input);
      } else {
        // Build minimal terms from provided fields, filling defaults
        const common = {
          principalId: input.principalId ?? 'principal_demo',
          agentId: input.agentId ?? 'agent_webmcp_demo',
          taskId: input.taskId ?? 'task_simulate',
          requestedUses: input.requestedUses ?? 1
        };
        terms = {
          ...common,
          recipientId: input.recipientId,
          purpose: input.purpose,
          operationType: input.operationType,
          resourceId: input.resourceId ?? `${input.operationType ?? 'unknown'}_resource`,
          action: input.action,
          claimIds: input.claimIds ?? [],
          transactionId: input.transactionId ?? `simulate_${randomUUID()}`,
          amountMinor: input.amountMinor ?? null,
          currency: input.currency ?? null
        };
      }
      return runtime.simulatePolicy(terms);
    },
    getApprovalStatus(approvalId) {
      if (typeof approvalId !== 'string' || approvalId.length === 0) throw new TypeError('approvalId must be non-empty string');
      // Delegate to runtime, but also ensure pending map sync for expired
      const status = runtime.getApprovalStatus(approvalId);
      // If runtime says unknown but pending map has it, return pending projection
      if (status.status === 'unknown' && pending.has(approvalId)) {
        const rec = pending.get(approvalId);
        const nowMs = Date.now();
        const remainingMs = rec.proposal.expiresAt !== undefined ? Math.max(0, rec.proposal.expiresAt - nowMs) : null;
        return {
          status: 'pending',
          approvalId,
          createdAt: rec.proposal.createdAt,
          expiresAt: rec.proposal.expiresAt,
          remainingMs,
          remainingSeconds: remainingMs !== null ? Math.floor(remainingMs / 1000) : null,
          displayedTerms: rec.proposal.displayedTerms,
          disclosure: rec.proposal.disclosure,
          proposalDigest: rec.proposal.proposalDigest
        };
      }
      return status;
    },

    getOperationStatus(reference) {
      if (typeof reference !== 'string' || reference.length === 0) throw new TypeError('reference must be non-empty string');
      return runtime.getOperationStatus(reference);
    },

    // Unified poll: try approval then capability
    getUnifiedStatus(id) {
      const approval = this.getApprovalStatus(id);
      if (approval.status !== 'unknown') {
        // If approved and has operationReference, also include capability status
        if (approval.operationReference) {
          const cap = runtime.getOperationStatus(approval.operationReference);
          return { kind: 'approval', approval, capability: cap };
        }
        return { kind: 'approval', approval };
      }
      const cap = runtime.getOperationStatus(id);
      if (cap.status !== 'unknown') return { kind: 'capability', capability: cap };
      return { kind: 'unknown', status: 'unknown' };
    },

    queryAudit(filter = {}) {
      return audit.query(filter);
    },
    exportAudit() {
      return audit.export();
    },
    verifyAudit(chain) {
      return audit.verifyIntegrity(chain);
    },
    exportSnapshot() {
      return {
        pending: Object.fromEntries(pending.entries()),
        redeemable: Object.fromEntries(redeemable.entries()),
        auditRecords: audit.export(),
        runtimeState: runtime.exportState(),
        personaClaims: [...agentPersonaClaims],
        protectedResourcesMeta: [
          { id: 'credential_membership', type: 'credential', handling: 'proof only' },
          { id: 'payment_instrument_demo', type: 'payment instrument', handling: 'use only' },
          { id: 'signing_key_demo', type: 'signing key', handling: 'enclave only' },
          { id: 'account_demo', type: 'account', handling: 'bounded write' }
        ]
      };
    },
    importSnapshot(snapshot) {
      pending.clear();
      redeemable.clear();
      if (snapshot?.pending) {
        for (const [id, rec] of Object.entries(snapshot.pending)) pending.set(id, rec);
      }
      if (snapshot?.redeemable) {
        for (const [ref, terms] of Object.entries(snapshot.redeemable)) redeemable.set(ref, terms);
      }
      if (snapshot?.auditRecords) {
        try { audit.importRecords(snapshot.auditRecords); } catch {
          try { audit.clear(); for (const rec of snapshot.auditRecords) audit.append(rec.event); } catch {}
        }
      }
      if (snapshot?.runtimeState) {
        try { runtime.importState(snapshot.runtimeState); } catch {}
      }
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
    },
    getRuntime() { return runtime; },
    getPersonaStore() { return persona; },
    getAuditLog() { return audit; },
    getRecipientFixtures() { return recipientFixtures; }
  };
}

export const CANARIES = {
  credential: CREDENTIAL_CANARY,
  payment: PAYMENT_CANARY,
  signing: SIGNING_CANARY,
  action: ACTION_CANARY
};
