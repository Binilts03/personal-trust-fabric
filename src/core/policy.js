const MATCH_FIELDS = [
  'recipientId',
  'purpose',
  'operationType',
  'resourceId',
  'action'
];

function policyId(policy) {
  return `${policy.id}@${policy.version}`;
}

function minimumDefined(policies, field) {
  const values = policies
    .map((policy) => policy[field])
    .filter((value) => value !== undefined);
  return values.length === 0 ? undefined : Math.min(...values);
}

function intersectDefinedArrays(policies, field) {
  const arrays = policies
    .map((policy) => policy[field])
    .filter((value) => value !== undefined);
  if (arrays.length === 0) return undefined;

  const [first, ...rest] = arrays;
  return [...new Set(first)]
    .filter((value) => rest.every((array) => array.includes(value)))
    .sort();
}

export function createPolicyAuthority(policies) {
  return {
    evaluate(request) {
      const matching = policies.filter((policy) =>
        MATCH_FIELDS.every((field) =>
          policy.match[field] === undefined || policy.match[field] === request[field]
        )
      );
      const denies = matching.filter((policy) => policy.effect === 'deny');

      if (denies.length > 0) {
        return {
          decision: 'deny',
          policyIds: denies.map(policyId).sort(),
          constraints: {},
          reason: 'matching deny policy'
        };
      }

      const allows = matching.filter((policy) => policy.effect === 'allow');
      if (allows.length === 0) {
        return {
          decision: 'deny',
          policyIds: [],
          constraints: {},
          reason: 'no matching allow policy'
        };
      }

      const policyIds = allows.map(policyId).sort();
      const maxUses = minimumDefined(allows, 'maxUses');
      const maxAmountMinor = minimumDefined(allows, 'maxAmountMinor');
      const currencies = intersectDefinedArrays(allows, 'currencies');
      const allowedModes = intersectDefinedArrays(allows, 'allowedModes');

      if (maxAmountMinor !== undefined && request.amountMinor > maxAmountMinor) {
        return {
          decision: 'deny',
          policyIds,
          constraints: {},
          reason: 'request exceeds policy amount limit'
        };
      }
      if (currencies !== undefined && !currencies.includes(request.currency)) {
        return {
          decision: 'deny',
          policyIds,
          constraints: {},
          reason: 'request currency is not allowed'
        };
      }

      const constraints = {};
      if (maxUses !== undefined) constraints.maxUses = maxUses;
      if (maxAmountMinor !== undefined) constraints.maxAmountMinor = maxAmountMinor;
      if (currencies !== undefined) constraints.currencies = currencies;
      if (allowedModes !== undefined) constraints.allowedModes = allowedModes;

      const requireApproval = allows.some((policy) => policy.requireApproval === true);
      return {
        decision: requireApproval ? 'approval_required' : 'allow',
        policyIds,
        constraints,
        reason: requireApproval
          ? 'matching policy requires human approval'
          : 'matching policy allows operation'
      };
    }
  };
}
