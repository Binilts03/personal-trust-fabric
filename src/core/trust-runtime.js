import { randomUUID } from 'node:crypto';

import { digestApprovalTerms, normalizeApprovalTerms } from './approval-terms.js';
import { createCapabilityRuntime } from './capability-runtime.js';
import { createDisclosurePlanner } from './disclosure-planner.js';
import { createPolicyAuthority } from './policy.js';
import { toAgentSafeView, toSafeReceipt } from './serialization.js';

export function createTrustRuntime({
  now = Date.now,
  idFactory = () => randomUUID(),
  profile,
  policies,
  personaClaims,
  providers,
  onPersist = null,
  capabilityOptions = {},
  verifier = null,
  protectedStore = null
}) {
  for (const [operationType, provider] of Object.entries(providers)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(provider.publicOutcome ?? '')) {
      throw new TypeError(`provider ${operationType} must declare a safe publicOutcome token`);
    }
  }
  const approvals = new Map();
  const receipts = new Map();
  const authority = createPolicyAuthority(policies);
  const planner = createDisclosurePlanner({ assurance: profile });
  const capabilityRuntime = createCapabilityRuntime({
    now,
    referenceFactory: idFactory,
    onPersist,
    ...capabilityOptions,
    verifier,
    executors: Object.fromEntries(
      Object.entries(providers).map(([operationType, provider]) => [operationType, async (input) => {
        try {
          return await provider.execute(input);
        } catch {
          throw new Error('protected provider execution failed');
        }
      }])
    )
  });

  function sweepPendingApprovals() {
    const t = now();
    let changed = false;
    for (const approval of approvals.values()) {
      if (approval.status === 'pending' && approval.expiresAt !== undefined && t >= approval.expiresAt) {
        approval.status = 'denied';
        approval.deniedReason = 'approval expired';
        changed = true;
      }
    }
    if (changed && typeof onPersist === 'function') { try { onPersist(); } catch {} }
    return changed;
  }

  function issueFromApproval(approval, parentReference = null) {
    // Capability expiry is 5min from now, but constrained by approval's expiry or policy window?
    const expiresAt = now() + 5 * 60 * 1000;
    const maxUses = approval.constraints.maxUses ?? approval.terms.requestedUses;
    const issued = capabilityRuntime.issue({
      grantId: `grant:${approval.id}`,
      authorityState: 'active',
      terms: approval.terms,
      expiresAt: parentReference ? Math.min(expiresAt, capabilityRuntime.getStatus(parentReference).expiresAt ?? expiresAt) : expiresAt,
      maxUses,
      parentReference,
      constraints: approval.constraints
    });
    approval.operationReference = issued.reference;
    return issued;
  }

  return {
    getSafeView({ principalId, taskId }) {
      return toAgentSafeView({
        principalId,
        taskId,
        profile,
        personaClaims,
        availableCapabilityTypes: Object.keys(providers),
        approvalStatus: 'available'
      });
    },

    requestOperation(input) {
      sweepPendingApprovals();
      const terms = normalizeApprovalTerms(input);
      const policy = authority.evaluate(terms);
      if (policy.decision === 'deny') {
        return { decision: 'deny', reason: policy.reason, policyIds: policy.policyIds };
      }

      const provider = providers[terms.operationType];
      if (!provider) return { decision: 'deny', reason: 'unsupported operation type', policyIds: [] };
      const disclosure = planner.plan({
        authorized: true,
        candidates: provider.candidates,
        allowedModes: policy.constraints.allowedModes ?? [],
        recipientModes: provider.recipientModes
      });
      if (disclosure.status === 'denied') {
        return { decision: 'deny', reason: disclosure.reason, policyIds: policy.policyIds };
      }

      const approvalId = idFactory();
      const createdAt = now();
      const expirySeconds = policy.constraints.approvalExpirySeconds ?? 300;
      const expiresAt = createdAt + expirySeconds * 1000;
      const approval = {
        id: approvalId,
        principalId: terms.principalId,
        terms,
        digest: digestApprovalTerms(terms),
        constraints: policy.constraints,
        disclosure,
        status: policy.decision === 'approval_required' ? 'pending' : 'approved',
        createdAt,
        expiresAt
      };
      approvals.set(approvalId, approval);

      if (approval.status === 'approved') {
        const issued = issueFromApproval(approval);
        return {
          decision: 'allow',
          operationReference: issued.reference,
          disclosure,
          policyIds: policy.policyIds
        };
      }

      return {
        decision: 'approval_required',
        approvalId,
        proposalDigest: approval.digest,
        displayedTerms: {
          principalId: terms.principalId,
          agentId: terms.agentId,
          taskId: terms.taskId,
          recipientId: terms.recipientId,
          purpose: terms.purpose,
          operationType: terms.operationType,
          resourceId: terms.resourceId,
          action: terms.action,
          claimIds: [...terms.claimIds],
          transactionId: terms.transactionId,
          requestedUses: terms.requestedUses,
          validForSeconds: expirySeconds,
          amountMinor: terms.amountMinor,
          currency: terms.currency
        },
        disclosure,
        policyIds: policy.policyIds,
        createdAt,
        expiresAt
      };
    },

    decideApproval({ approvalId, principalId, decision }) {
      const approval = approvals.get(approvalId);
      if (!approval) throw new Error('approval is not pending');
      // Check expiry before pending status so expired pendings throw 'approval expired' not 'not pending'
      if (approval.expiresAt !== undefined && now() >= approval.expiresAt) {
        if (approval.status === 'pending') {
          approval.status = 'denied';
          approval.deniedReason = 'approval expired';
          if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        }
        throw new Error('approval expired');
      }
      if (approval.status !== 'pending') throw new Error('approval is not pending');
      if (approval.principalId !== principalId) throw new Error('approval principal mismatch');
      if (!['approved', 'denied'].includes(decision)) throw new Error('invalid approval decision');

      approval.status = decision;
      if (decision === 'denied') return { decision: 'denied', approvalId };
      const issued = issueFromApproval(approval);
      return {
        decision: 'approved',
        approvalId,
        operationReference: issued.reference,
        expiresAt: issued.expiresAt,
        remainingUses: issued.remainingUses
      };
    },

    async executeOperation({ reference, terms: input, recipientProof }) {
      sweepPendingApprovals();
      const terms = normalizeApprovalTerms(input);
      if (verifier) {
        if (!recipientProof?.recipientAuthToken || typeof recipientProof.recipientAuthToken !== 'string') {
          throw new Error('recipient authentication mismatch');
        }
        if (recipientProof.recipientId !== terms.recipientId) {
          throw new Error('recipient authentication mismatch');
        }
        const ok = verifier.verifyRecipientAuth({ reference, recipientId: terms.recipientId, recipientAuthToken: recipientProof.recipientAuthToken });
        if (!ok) throw new Error('recipient authentication mismatch');
      } else {
        if (!recipientProof?.authenticated || recipientProof.recipientId !== terms.recipientId) {
          throw new Error('recipient authentication mismatch');
        }
      }
      const result = await capabilityRuntime.execute({ reference, terms, recipientProof });
      if (verifier) {
        try {
          if (terms.operationType === 'credential_presentation') {
            if (!result.credentialProof || typeof result.credentialProof !== 'string') throw new Error('missing credential proof');
            if (!verifier.verifyCredentialProof({ recipientId: terms.recipientId, purpose: terms.purpose, transactionId: terms.transactionId, proof: result.credentialProof })) {
              throw new Error('credential proof verification failed');
            }
          } else if (terms.operationType === 'payment') {
            if (!result.paymentToken || typeof result.paymentToken !== 'string') throw new Error('missing payment token');
            if (!verifier.verifyPaymentToken({ transactionId: terms.transactionId, amountMinor: terms.amountMinor, recipientId: terms.recipientId, token: result.paymentToken })) {
              throw new Error('payment token verification failed');
            }
          } else if (terms.operationType === 'signing') {
            if (!result.signingProof || typeof result.signingProof !== 'string') throw new Error('missing signing proof');
            if (!verifier.verifySigningProof({ recipientId: terms.recipientId, purpose: terms.purpose, transactionId: terms.transactionId, proof: result.signingProof })) {
              throw new Error('signing proof verification failed');
            }
          } else if (terms.operationType === 'bounded_action') {
            if (!result.actionProof || typeof result.actionProof !== 'string') throw new Error('missing action proof');
            if (!verifier.verifyActionProof({ recipientId: terms.recipientId, purpose: terms.purpose, transactionId: terms.transactionId, action: terms.action, proof: result.actionProof })) {
              throw new Error('action proof verification failed');
            }
          }
        } catch (e) {
          if (e.message.includes('proof verification failed') || e.message.includes('token verification failed') || e.message.includes('missing')) {
            throw new Error('protected provider execution failed');
          }
          throw e;
        }
      }
      const rawReceipt = {
        id: `receipt:${reference}`,
        correlationId: reference,
        operationType: terms.operationType,
        recipientId: terms.recipientId,
        purpose: terms.purpose,
        outcome: providers[terms.operationType].publicOutcome,
        occurredAt: new Date(now()).toISOString(),
        protectedPayload: result.protected
      };
      const receipt = toSafeReceipt(rawReceipt);
      receipts.set(reference, receipt);
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return { status: 'completed', receipt };
    },

    getOperationStatus(reference) {
      sweepPendingApprovals();
      const capStatus = capabilityRuntime.getStatus(reference);
      // capStatus may be unknown
      if (capStatus.status === 'unknown') {
        // Check if it's a pending approval that hasn't been issued yet? Approvals map holds approvalId, not reference
        // For pending approvals, we look up by approvalId? But spec says getOperationStatus(reference) should return status for operation reference
        // If unknown, still return status unknown with receipt null
        return { status: 'unknown', receipt: receipts.get(reference) ?? null, expiresAt: null, remainingUses: 0, parentReference: null, derivedFrom: null };
      }
      return {
        status: capStatus.status,
        receipt: receipts.get(reference) ?? null,
        expiresAt: capStatus.expiresAt ?? null,
        remainingUses: capStatus.remainingUses ?? 0,
        parentReference: capStatus.parentReference ?? null,
        derivedFrom: capStatus.derivedFrom ?? capStatus.parentReference ?? null,
        error: capStatus.error ?? null,
        derivationChain: capStatus.derivationChain ?? []
      };
    },

    getApprovalStatus(approvalId) {
      sweepPendingApprovals();
      const approval = approvals.get(approvalId);
      if (!approval) return { status: 'unknown', reason: 'approval not found' };
      const nowMs = now();
      const remainingMs = approval.expiresAt !== undefined ? Math.max(0, approval.expiresAt - nowMs) : null;
      const remainingSeconds = remainingMs !== null ? Math.floor(remainingMs / 1000) : null;
      // If pending and expired, already marked denied
      if (approval.status === 'pending' && approval.expiresAt !== undefined && nowMs >= approval.expiresAt) {
        return {
          status: 'expired',
          reason: 'approval expired',
          approvalId,
          createdAt: approval.createdAt,
          expiresAt: approval.expiresAt,
          remainingMs: 0,
          remainingSeconds: 0,
          displayedTerms: {
            principalId: approval.terms.principalId,
            agentId: approval.terms.agentId,
            taskId: approval.terms.taskId,
            recipientId: approval.terms.recipientId,
            purpose: approval.terms.purpose,
            operationType: approval.terms.operationType,
            resourceId: approval.terms.resourceId,
            action: approval.terms.action,
            claimIds: [...approval.terms.claimIds],
            transactionId: approval.terms.transactionId,
            requestedUses: approval.terms.requestedUses,
            amountMinor: approval.terms.amountMinor,
            currency: approval.terms.currency
          },
          disclosure: approval.disclosure,
          policyIds: approval.constraints ? [] : []
        };
      }
      const base = {
        status: approval.status,
        approvalId,
        createdAt: approval.createdAt,
        expiresAt: approval.expiresAt,
        remainingMs,
        remainingSeconds,
        displayedTerms: {
          principalId: approval.terms.principalId,
          agentId: approval.terms.agentId,
          taskId: approval.terms.taskId,
          recipientId: approval.terms.recipientId,
          purpose: approval.terms.purpose,
          operationType: approval.terms.operationType,
          resourceId: approval.terms.resourceId,
          action: approval.terms.action,
          claimIds: [...approval.terms.claimIds],
          transactionId: approval.terms.transactionId,
          requestedUses: approval.terms.requestedUses,
          amountMinor: approval.terms.amountMinor,
          currency: approval.terms.currency
        },
        disclosure: approval.disclosure,
        proposalDigest: approval.digest,
        constraints: approval.constraints
      };
      if (approval.operationReference) {
        base.operationReference = approval.operationReference;
        // Also include capability status if available
        const capStatus = capabilityRuntime.getStatus(approval.operationReference);
        if (capStatus.status !== 'unknown') {
          base.capabilityStatus = capStatus.status;
          base.remainingUses = capStatus.remainingUses;
          base.capabilityExpiresAt = capStatus.expiresAt;
          const receipt = receipts.get(approval.operationReference);
          if (receipt) base.receipt = receipt;
        }
      }
      if (approval.deniedReason) base.deniedReason = approval.deniedReason;
      return base;
    },

    revokeOperation(reference) {
      const ok = capabilityRuntime.revoke(reference);
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return ok;
    },

    delegateOperation({ parentReference, terms: input, recipientProof }) {
      sweepPendingApprovals();
      const parentStatus = capabilityRuntime.getStatus(parentReference);
      if (parentStatus.status !== 'active') throw new Error('parent capability is not active');
      const terms = normalizeApprovalTerms(input);
      const issued = capabilityRuntime.issue({
        grantId: `grant:delegated:${parentReference}`,
        authorityState: 'active',
        terms,
        expiresAt: Math.min(parentStatus.expiresAt, now() + 5 * 60 * 1000),
        maxUses: terms.requestedUses,
        parentReference,
        constraints: {}
      });
      return issued;
    },

    deriveOperation({ parentReference, constraints }) {
      // Expose capabilityRuntime.derive via trust layer for narrower derivation
      return capabilityRuntime.derive(parentReference, constraints);
    },

    listCapabilities() {
      return capabilityRuntime.listAll();
    },

    listActiveCapabilities() {
      return capabilityRuntime.listActive();
    },

    sweepExpired() {
      const capChanged = capabilityRuntime.sweepExpired();
      const pendingChanged = sweepPendingApprovals();
      return capChanged || pendingChanged;
    },

    getPolicies() {
      return authority.listPolicies();
    },

    simulatePolicy(input) {
      const terms = normalizeApprovalTerms(input);
      return authority.simulate(terms);
    },

    exportState() {
      return {
        approvals: [...approvals.entries()].map(([id, a]) => [id, {
          id: a.id,
          principalId: a.principalId,
          terms: a.terms,
          digest: a.digest,
          constraints: a.constraints,
          disclosure: a.disclosure,
          status: a.status,
          operationReference: a.operationReference ?? null,
          createdAt: a.createdAt ?? null,
          expiresAt: a.expiresAt ?? null,
          deniedReason: a.deniedReason ?? null
        }]),
        receipts: [...receipts.entries()],
        capabilities: capabilityRuntime.exportState(),
        policies: authority.listPolicies()
      };
    },

    importState(state) {
      approvals.clear();
      receipts.clear();
      if (state?.approvals) {
        for (const [id, a] of state.approvals) approvals.set(id, a);
      }
      if (state?.receipts) {
        for (const [ref, r] of state.receipts) receipts.set(ref, r);
      }
      if (state?.capabilities) capabilityRuntime.importState(state.capabilities);
    },

    seedDemoCapability(input) {
      const terms = normalizeApprovalTerms(input);
      const issued = capabilityRuntime.issue({
        grantId: `grant:seed_demo:${terms.transactionId}`,
        authorityState: 'active',
        terms,
        expiresAt: now() + 5 * 60 * 1000,
        maxUses: terms.requestedUses,
        parentReference: null,
        constraints: {}
      });
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return issued;
    },

    getAuthority() { return authority; },
    getCapabilityRuntime() { return capabilityRuntime; }
  };
}
