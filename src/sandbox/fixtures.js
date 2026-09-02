import { randomUUID } from 'node:crypto';

import { createAuditLog } from '../core/audit-log.js';
import { createPersonaStore } from '../core/persona-store.js';
import { createTrustRuntime } from '../core/trust-runtime.js';

const CREDENTIAL_CANARY = 'PTF_CANARY_CREDENTIAL_17AE';
const PAYMENT_CANARY = 'PTF_CANARY_PAYMENT_9B7D';

export function createSandbox() {
  const pending = new Map();
  const audit = createAuditLog();
  const persona = createPersonaStore();
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
  const agentPersonaClaims = [...persona.queryTaskClaims({ contexts: ['dashboard'] })];

  const runtime = createTrustRuntime({
    profile: 'synthetic_sandbox',
    policies: [
      {
        id: 'policy_membership_proof',
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
        allowedModes: ['predicate_proof']
      },
      {
        id: 'policy_invoice_payment',
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
        allowedModes: ['direct_delivery']
      }
    ],
    personaClaims: agentPersonaClaims,
    providers: {
      credential_presentation: {
        publicOutcome: 'verified',
        recipientModes: ['predicate_proof'],
        candidates: [{ mode: 'predicate_proof', representationId: 'membership_active_proof' }],
        execute: async () => ({
          outcome: 'verified',
          detail: 'Active membership verified without releasing the member record.',
          protected: CREDENTIAL_CANARY
        })
      },
      payment: {
        publicOutcome: 'paid',
        recipientModes: ['direct_delivery'],
        candidates: [{ mode: 'direct_delivery', representationId: 'payment_authorization' }],
        execute: async () => ({
          outcome: 'paid',
          detail: 'Synthetic invoice paid without exposing a reusable payment credential.',
          protected: PAYMENT_CANARY
        })
      }
    }
  });

  function assertInput(input, allowedFields) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('request must be an object');
    }
    for (const field of Object.keys(input)) {
      if (!allowedFields.includes(field)) throw new TypeError(`unknown field: ${field}`);
    }
  }

  function appendAudit(eventType, terms, outcome, extra = {}) {
    return audit.append({
      eventType,
      correlationId: extra.correlationId ?? terms.transactionId,
      occurredAt: new Date().toISOString(),
      outcome,
      recipientId: terms.recipientId,
      purpose: terms.purpose,
      scope: [terms.operationType, terms.action],
      ...extra
    });
  }

  function termsFor(input) {
    assertInput(input, ['scenario', 'amountMinor', 'currency', 'recipientId']);
    const { scenario, amountMinor = 4250, currency = 'USD', recipientId } = input;
    const common = {
      principalId: 'principal_demo',
      agentId: 'agent_webmcp_demo',
      taskId: `task_${scenario}`,
      requestedUses: 1
    };
    if (scenario === 'credential') {
      return {
        ...common,
        recipientId: recipientId ?? 'recipient_verifier_a',
        purpose: 'verify_membership',
        operationType: 'credential_presentation',
        resourceId: 'credential_membership',
        action: 'present',
        claimIds: ['membership.active'],
        transactionId: `verification_${randomUUID()}`,
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
        action: 'pay',
        claimIds: [],
        transactionId: `invoice_${randomUUID()}`,
        amountMinor,
        currency
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
          { id: 'payment_instrument_demo', type: 'payment instrument', handling: 'use only', status: 'synthetic' }
        ],
        policies: [
          { id: 'policy_membership_proof', summary: 'Verifier A · active membership proof · one use · approval required' },
          { id: 'policy_invoice_payment', summary: 'Merchant B · invoice payment · USD 50 max · one use · approval required' }
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
        return approval;
      }

      const recipient = recipientFixtures.get(record.terms.recipientId);
      if (!recipient) throw new Error('recipient fixture is unavailable');
      const completion = await runtime.executeOperation({
        reference: approval.operationReference,
        terms: record.terms,
        recipientProof: {
          recipientId: record.terms.recipientId,
          authenticated: true,
          assurance: recipient.assurance,
          fixtureId: recipient.fixtureId
        }
      });
      appendAudit('action_completed', record.terms, completion.receipt.outcome, {
        correlationId: completion.receipt.correlationId,
        representation: record.proposal.disclosure.mode,
        assurance: 'synthetic_server_recipient_fixture'
      });
      return completion;
    },

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
      return corrected;
    }
  };
}
