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
  providers
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

  function issueFromApproval(approval) {
    const issued = capabilityRuntime.issue({
      grantId: `grant:${approval.id}`,
      authorityState: 'active',
      terms: approval.terms,
      expiresAt: now() + 5 * 60 * 1000,
      maxUses: approval.constraints.maxUses ?? approval.terms.requestedUses
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
      const approval = {
        id: approvalId,
        principalId: terms.principalId,
        terms,
        digest: digestApprovalTerms(terms),
        constraints: policy.constraints,
        disclosure,
        status: policy.decision === 'approval_required' ? 'pending' : 'approved'
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
          validForSeconds: 300,
          amountMinor: terms.amountMinor,
          currency: terms.currency
        },
        disclosure,
        policyIds: policy.policyIds
      };
    },

    decideApproval({ approvalId, principalId, decision }) {
      const approval = approvals.get(approvalId);
      if (!approval || approval.status !== 'pending') throw new Error('approval is not pending');
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
      const terms = normalizeApprovalTerms(input);
      const result = await capabilityRuntime.execute({ reference, terms, recipientProof });
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
      return { status: 'completed', receipt };
    },

    getOperationStatus(reference) {
      return { ...capabilityRuntime.getStatus(reference), receipt: receipts.get(reference) ?? null };
    },

    revokeOperation(reference) {
      return capabilityRuntime.revoke(reference);
    }
  };
}
