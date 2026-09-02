import { randomUUID } from 'node:crypto';

import { digestApprovalTerms } from './approval-terms.js';

export function createCapabilityRuntime({
  now = Date.now,
  referenceFactory = () => randomUUID(),
  executors
}) {
  const capabilities = new Map();

  return {
    issue({ grantId, authorityState, terms, expiresAt, maxUses }) {
      if (authorityState !== 'active') throw new Error('authority grant is not active');
      if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > terms.requestedUses) {
        throw new Error('capability use count exceeds approved terms');
      }

      const reference = referenceFactory();
      capabilities.set(reference, {
        grantId,
        termsDigest: digestApprovalTerms(terms),
        operationType: terms.operationType,
        recipientId: terms.recipientId,
        expiresAt,
        remainingUses: maxUses,
        status: 'active'
      });
      return { reference, status: 'active', expiresAt, remainingUses: maxUses };
    },

    async execute({ reference, terms, recipientProof }) {
      const capability = capabilities.get(reference);
      if (!capability || capability.status !== 'active') throw new Error('capability is not active');
      if (now() >= capability.expiresAt) {
        capability.status = 'expired';
        throw new Error('capability is expired');
      }
      if (!recipientProof?.authenticated || recipientProof.recipientId !== capability.recipientId) {
        throw new Error('recipient authentication mismatch');
      }
      if (digestApprovalTerms(terms) !== capability.termsDigest) {
        throw new Error('approval terms mismatch');
      }

      const executor = executors[capability.operationType];
      if (!executor) throw new Error('unsupported operation type');

      capability.remainingUses -= 1;
      capability.status = capability.remainingUses === 0 ? 'consumed' : 'active';
      const result = await executor(terms);
      return { status: 'completed', ...result };
    },

    getStatus(reference) {
      const capability = capabilities.get(reference);
      if (!capability) return { status: 'unknown' };
      return {
        status: capability.status,
        expiresAt: capability.expiresAt,
        remainingUses: capability.remainingUses
      };
    },

    revoke(reference) {
      const capability = capabilities.get(reference);
      if (!capability) return false;
      capability.status = 'revoked';
      return true;
    }
  };
}
