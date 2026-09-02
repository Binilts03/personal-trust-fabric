import { createHash } from 'node:crypto';

const FIELDS = [
  'principalId',
  'agentId',
  'taskId',
  'recipientId',
  'purpose',
  'operationType',
  'resourceId',
  'action',
  'claimIds',
  'transactionId',
  'amountMinor',
  'currency',
  'requestedUses'
];

export function normalizeApprovalTerms(input) {
  for (const field of Object.keys(input)) {
    if (!FIELDS.includes(field)) throw new TypeError(`unknown field: ${field}`);
  }

  for (const field of FIELDS.slice(0, 9).filter((field) => field !== 'claimIds')) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(input.claimIds) || input.claimIds.some((claim) => typeof claim !== 'string')) {
    throw new TypeError('claimIds must be an array of strings');
  }
  if (typeof input.transactionId !== 'string' || input.transactionId.length === 0) {
    throw new TypeError('transactionId must be a non-empty string');
  }
  if (!Number.isSafeInteger(input.requestedUses) || input.requestedUses < 1) {
    throw new TypeError('requestedUses must be a positive safe integer');
  }

  const amountMinor = input.amountMinor;
  const currency = input.currency === null ? null : input.currency?.toUpperCase();
  if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0)) {
    throw new TypeError('amountMinor must be null or a non-negative safe integer');
  }
  if ((amountMinor === null) !== (currency === null) || (currency !== null && !/^[A-Z]{3}$/.test(currency))) {
    throw new TypeError('amountMinor and three-letter currency must both be present or both be null');
  }

  return Object.freeze({
    version: 1,
    principalId: input.principalId,
    agentId: input.agentId,
    taskId: input.taskId,
    recipientId: input.recipientId,
    purpose: input.purpose,
    operationType: input.operationType,
    resourceId: input.resourceId,
    action: input.action,
    claimIds: Object.freeze([...new Set(input.claimIds)].sort()),
    transactionId: input.transactionId,
    amountMinor,
    currency,
    requestedUses: input.requestedUses
  });
}

export function encodeApprovalTerms(terms) {
  return JSON.stringify(terms);
}

export function digestApprovalTerms(terms) {
  return createHash('sha256').update(encodeApprovalTerms(terms)).digest('hex');
}
