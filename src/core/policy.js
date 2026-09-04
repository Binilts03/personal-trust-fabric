const MATCH_FIELDS = [
  'principalId',
  'agentId',
  'recipientId',
  'purpose',
  'operationType',
  'resourceId',
  'action'
];

const POLICY_FIELDS = new Set([
  'id',
  'version',
  'effect',
  'match',
  'requireApproval',
  'maxUses',
  'maxAmountMinor',
  'currencies',
  'allowedModes',
  'allowedClaims'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new TypeError(`${field} must be an array of non-empty strings`);
  }
  return Object.freeze([...new Set(value)].sort());
}

function normalizePolicy(policy) {
  if (!isPlainObject(policy)) throw new TypeError('policy must be a plain object');
  for (const field of Object.keys(policy)) {
    if (!POLICY_FIELDS.has(field)) throw new TypeError(`unknown policy field: ${field}`);
  }

  assertNonEmptyString(policy.id, 'policy.id');
  if (!Number.isSafeInteger(policy.version) || policy.version < 1) {
    throw new TypeError('policy.version must be a positive safe integer');
  }
  if (!['allow', 'deny'].includes(policy.effect)) {
    throw new TypeError('policy.effect must be allow or deny');
  }
  if (!isPlainObject(policy.match)) throw new TypeError('policy.match must be a plain object');

  const match = {};
  for (const [field, value] of Object.entries(policy.match)) {
    if (!MATCH_FIELDS.includes(field)) throw new TypeError(`unknown policy match field: ${field}`);
    assertNonEmptyString(value, `policy.match.${field}`);
    match[field] = value;
  }

  if (policy.requireApproval !== undefined && typeof policy.requireApproval !== 'boolean') {
    throw new TypeError('policy.requireApproval must be a boolean');
  }
  if (policy.maxUses !== undefined && (!Number.isSafeInteger(policy.maxUses) || policy.maxUses < 1)) {
    throw new TypeError('policy.maxUses must be a positive safe integer');
  }
  if (policy.maxAmountMinor !== undefined && (!Number.isSafeInteger(policy.maxAmountMinor) || policy.maxAmountMinor < 0)) {
    throw new TypeError('policy.maxAmountMinor must be a non-negative safe integer');
  }

  const currencies = policy.currencies === undefined
    ? undefined
    : normalizeStringArray(policy.currencies, 'policy.currencies');
  if (currencies?.some((currency) => !/^[A-Z]{3}$/.test(currency))) {
    throw new TypeError('policy.currencies must contain three-letter uppercase currency codes');
  }
  const allowedModes = policy.allowedModes === undefined
    ? undefined
    : normalizeStringArray(policy.allowedModes, 'policy.allowedModes');
  const allowedClaims = policy.allowedClaims === undefined
    ? undefined
    : normalizeStringArray(policy.allowedClaims, 'policy.allowedClaims');

  return Object.freeze({
    id: policy.id,
    version: policy.version,
    effect: policy.effect,
    match: Object.freeze(match),
    requireApproval: policy.requireApproval ?? false,
    ...(policy.maxUses === undefined ? {} : { maxUses: policy.maxUses }),
    ...(policy.maxAmountMinor === undefined ? {} : { maxAmountMinor: policy.maxAmountMinor }),
    ...(currencies === undefined ? {} : { currencies }),
    ...(allowedModes === undefined ? {} : { allowedModes }),
    ...(allowedClaims === undefined ? {} : { allowedClaims })
  });
}

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
  return [...first]
    .filter((value) => rest.every((array) => array.includes(value)))
    .sort();
}

function matchesPolicy(policy, request) {
  return MATCH_FIELDS.every((field) => {
    const expected = policy.match[field];
    return expected === undefined || expected === '*' || expected === request[field];
  });
}

export function createPolicyAuthority(policies) {
  if (!Array.isArray(policies)) throw new TypeError('policies must be an array');
  const normalizedPolicies = Object.freeze(policies.map(normalizePolicy));
  const identities = new Set();
  for (const policy of normalizedPolicies) {
    const identity = policyId(policy);
    if (identities.has(identity)) throw new TypeError(`duplicate policy identity: ${identity}`);
    identities.add(identity);
  }

  return {
    evaluate(request) {
      const matching = normalizedPolicies.filter((policy) => matchesPolicy(policy, request));
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
      const allowedClaims = intersectDefinedArrays(allows, 'allowedClaims');

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
      if (allowedClaims !== undefined && request.claimIds.some((claim) => !allowedClaims.includes(claim))) {
        return {
          decision: 'deny',
          policyIds,
          constraints: {},
          reason: 'request includes claims not allowed by policy'
        };
      }

      const constraints = {};
      if (maxUses !== undefined) constraints.maxUses = maxUses;
      if (maxAmountMinor !== undefined) constraints.maxAmountMinor = maxAmountMinor;
      if (currencies !== undefined) constraints.currencies = currencies;
      if (allowedModes !== undefined) constraints.allowedModes = allowedModes;
      if (allowedClaims !== undefined) constraints.allowedClaims = allowedClaims;

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
