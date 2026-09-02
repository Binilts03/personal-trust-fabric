const MATCH_FIELDS = [
  'recipientId',
  'purpose',
  'operationType',
  'resourceId',
  'action'
];

export function createPolicyAuthority(policies) {
  return {
    evaluate(request) {
      const matching = policies.filter((policy) =>
        MATCH_FIELDS.every((field) =>
          policy.match[field] === undefined || policy.match[field] === request[field]
        )
      );
      const deny = matching.find((policy) => policy.effect === 'deny');

      if (deny) {
        return {
          decision: 'deny',
          policyIds: [`${deny.id}@${deny.version}`],
          constraints: {},
          reason: 'matching deny policy'
        };
      }

      const policy = matching.find((candidate) => candidate.effect === 'allow');

      if (!policy || policy.effect !== 'allow') {
        return {
          decision: 'deny',
          policyIds: policy ? [`${policy.id}@${policy.version}`] : [],
          constraints: {},
          reason: 'no matching allow policy'
        };
      }

      if (policy.maxAmountMinor !== undefined && request.amountMinor > policy.maxAmountMinor) {
        return {
          decision: 'deny',
          policyIds: [`${policy.id}@${policy.version}`],
          constraints: {},
          reason: 'request exceeds policy amount limit'
        };
      }
      if (policy.currencies && !policy.currencies.includes(request.currency)) {
        return {
          decision: 'deny',
          policyIds: [`${policy.id}@${policy.version}`],
          constraints: {},
          reason: 'request currency is not allowed'
        };
      }

      const constraints = {};
      if (policy.maxUses !== undefined) constraints.maxUses = policy.maxUses;
      if (policy.maxAmountMinor !== undefined) constraints.maxAmountMinor = policy.maxAmountMinor;
      if (policy.currencies !== undefined) constraints.currencies = [...policy.currencies];
      if (policy.allowedModes !== undefined) constraints.allowedModes = [...policy.allowedModes];

      return {
        decision: policy.requireApproval ? 'approval_required' : 'allow',
        policyIds: [`${policy.id}@${policy.version}`],
        constraints,
        reason: policy.requireApproval
          ? 'matching policy requires human approval'
          : 'matching policy allows operation'
      };
    }
  };
}
