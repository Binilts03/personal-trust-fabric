const MATCH_FIELDS = [
  'principalId',
  'agentId',
  'taskId',
  'recipientId',
  'recipient',
  'purpose',
  'operationType',
  'resourceId',
  'action',
  'claimIds',
  'transactionId',
  'amountMinor',
  'currency',
  'requestedUses',
  'useCount',
  'delegationDepth',
  'assurance',
  'geography',
  'timeWindow',
  'representationMode'
];

const EXTENDED_MATCH_FIELDS = [
  'principalId',
  'agentId',
  'taskId',
  'recipientId',
  'recipient',
  'purpose',
  'operationType',
  'resourceId',
  'action',
  'claimIds',
  'transactionId',
  'amountMinor',
  'currency',
  'requestedUses',
  'useCount',
  'delegationDepth',
  'assurance',
  'geography',
  'timeWindow',
  'representationMode',
  'allowedClaims',
  'allowedClaimIds'
];

const CONSTRAINT_KEYS = new Set([
  'maxAmountMinor',
  'amountMinor',
  'currencies',
  'currency',
  'maxUses',
  'useCount',
  'maxUseCount',
  'requestedUses',
  'delegationDepth',
  'maxDelegationDepth',
  'allowedModes',
  'representationMode',
  'representationModes',
  'assurance',
  'assuranceLevels',
  'geography',
  'geographies',
  'timeWindow',
  'notBefore',
  'expiresAt',
  'cumulative',
  'cumulativeDisclosure',
  'claimIds',
  'allowedClaims',
  'allowedClaimIds',
  'transactionId',
  'approvalExpirySeconds'
]);

const ALLOWED_TOP_FIELDS = new Set([
  'id',
  'version',
  'effect',
  'match',
  'requireApproval',
  'constraints',
  // constraints as top-level aliases
  'maxAmountMinor',
  'amountMinor',
  'currencies',
  'currency',
  'maxUses',
  'useCount',
  'maxUseCount',
  'requestedUses',
  'delegationDepth',
  'maxDelegationDepth',
  'allowedModes',
  'representationMode',
  'representationModes',
  'assurance',
  'assuranceLevels',
  'geography',
  'geographies',
  'timeWindow',
  'notBefore',
  'expiresAt',
  'cumulative',
  'cumulativeDisclosure',
  'claimIds',
  'allowedClaims',
  'allowedClaimIds',
  'transactionId',
  'approvalExpirySeconds',
  // also allow principal etc as top-level constraints? For forward compat, allow but not used
  'principalId',
  'agentId',
  'taskId',
  'recipientId',
  'recipient',
  'purpose',
  'operationType',
  'resourceId',
  'action'
]);

const ALLOWED_MATCH_FIELDS = new Set([
  'principalId',
  'agentId',
  'taskId',
  'recipientId',
  'recipient',
  'purpose',
  'operationType',
  'resourceId',
  'action',
  'claimIds',
  'transactionId',
  'amountMinor',
  'currency',
  'requestedUses',
  'useCount',
  'delegationDepth',
  'assurance',
  'geography',
  'timeWindow',
  'representationMode',
  'allowedClaims',
  'allowedClaimIds'
]);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isSafeNonNegativeInt(v) {
  return Number.isSafeInteger(v) && v >= 0;
}

function isSafePositiveInt(v) {
  return Number.isSafeInteger(v) && v >= 1;
}

function toSortedId(policy) {
  return `${policy.id}@${policy.version}`;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const val = obj[key];
      if (val && typeof val === 'object') deepFreeze(val);
    }
  }
  return obj;
}

function cloneArray(arr) {
  return arr ? [...arr] : arr;
}

function normalizeCurrency(c) {
  if (c === null || c === undefined) return null;
  return String(c).toUpperCase();
}

function parseTime(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function isWildcard(value) {
  return value === '*' || (Array.isArray(value) && value.length === 1 && value[0] === '*');
}

// Validate a single policy, throw on invalid, return {valid:true}
export function validatePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError('policy must be a plain object');
  }
  for (const k of Object.keys(policy)) {
    if (!ALLOWED_TOP_FIELDS.has(k)) {
      errors.push(`unknown policy field: ${k}`);
    }
  }
  if (!isNonEmptyString(policy.id) || !/^[A-Za-z0-9_-]+$/.test(policy.id)) {
    errors.push('id must be non-empty string matching [A-Za-z0-9_-]');
  }
  if (!isSafePositiveInt(policy.version)) {
    errors.push('version must be positive safe integer');
  }
  if (policy.effect !== 'allow' && policy.effect !== 'deny') {
    errors.push('effect must be allow or deny');
  }
  if (policy.match !== undefined) {
    if (!policy.match || typeof policy.match !== 'object' || Array.isArray(policy.match)) {
      errors.push('match must be an object');
    } else {
      for (const [field, value] of Object.entries(policy.match)) {
        if (!ALLOWED_MATCH_FIELDS.has(field)) {
          errors.push(`unknown match field: ${field}`);
          continue;
        }
        if (field === 'claimIds' || field === 'allowedClaims' || field === 'allowedClaimIds') {
          if (!Array.isArray(value) || value.some(v => !isNonEmptyString(v) && v !== '*')) errors.push(`match.${field} must be array of non-empty strings`);
          // allow ['*'] wildcard
          if (Array.isArray(value) && value.includes('*') && value.length !== 1) {
            errors.push(`match.${field} wildcard '*' must be sole element`);
          }
        } else if (field === 'geography') {
          if (typeof value === 'string') {
            if (!isNonEmptyString(value)) errors.push('match.geography must be non-empty string or array');
          } else if (Array.isArray(value)) {
            if (value.some(v => !isNonEmptyString(v))) errors.push('match.geography array must contain non-empty strings');
          } else {
            errors.push('match.geography must be string or array');
          }
        } else if (field === 'timeWindow') {
          if (!value || typeof value !== 'object') errors.push('match.timeWindow must be object');
          else {
            if (value.notBefore !== undefined && parseTime(value.notBefore) === null) errors.push('match.timeWindow.notBefore must be valid timestamp');
            if (value.expiresAt !== undefined && parseTime(value.expiresAt) === null) errors.push('match.timeWindow.expiresAt must be valid timestamp');
          }
        } else if (field === 'amountMinor' ) {
          if (value !== null && value !== '*' && !isSafeNonNegativeInt(value)) errors.push(`match.${field} must be non-negative safe integer, null or '*'`);
        } else if (field === 'requestedUses' || field === 'useCount' || field === 'delegationDepth') {
          if (value !== null && value !== '*' && !isSafeNonNegativeInt(value) && !isSafePositiveInt(value)) {
            // requestedUses is positive, delegationDepth non-negative, but allow both
            if (!isSafeNonNegativeInt(value)) errors.push(`match.${field} must be non-negative safe integer or '*'`);
          }
          if (value === '*' ) { /* allow wildcard */ }
        } else if (field === 'currency') {
          if (value !== null && value !== '*' && !/^[A-Z]{3}$/.test(String(value).toUpperCase()) && value !== '*') errors.push('match.currency must be 3-letter code, null or "*"');
        } else if (field === 'transactionId') {
          if (value !== null && value !== '*' && !isNonEmptyString(String(value))) errors.push('match.transactionId must be non-empty string or "*"');
        } else if (field === 'principalId' || field === 'agentId' || field === 'taskId' || field === 'recipientId' || field === 'recipient' || field === 'purpose' || field === 'operationType' || field === 'resourceId' || field === 'action' || field === 'representationMode' || field === 'assurance') {
          if (value !== '*' && !isNonEmptyString(String(value)) && !Array.isArray(value)) {
            errors.push(`match.${field} must be non-empty string, array or '*'`);
          }
          if (Array.isArray(value) && value.some(v => !isNonEmptyString(v) && v !== '*')) {
            errors.push(`match.${field} array must contain non-empty strings`);
          }
        } else {
          if (value !== null && value !== undefined && !isNonEmptyString(String(value)) && typeof value !== 'number' && !Array.isArray(value) && typeof value !== 'object') {
            if (typeof value !== 'string') errors.push(`match.${field} must be string`);
          }
        }
      }
    }
  }
  if (policy.requireApproval !== undefined && typeof policy.requireApproval !== 'boolean') {
    errors.push('requireApproval must be boolean');
  }
  if (policy.effect === 'deny' && policy.requireApproval === true) {
    errors.push('deny policy cannot require approval');
  }
  if (policy.maxAmountMinor !== undefined && !isSafeNonNegativeInt(policy.maxAmountMinor)) errors.push('maxAmountMinor must be non-negative safe integer');
  if (policy.amountMinor !== undefined && policy.amountMinor !== null && policy.amountMinor !== '*' && !isSafeNonNegativeInt(policy.amountMinor)) errors.push('amountMinor must be non-negative safe integer, null or "*"');
  if (policy.currencies !== undefined) {
    if (!Array.isArray(policy.currencies) || policy.currencies.some(c => c !== '*' && !/^[A-Z]{3}$/.test(String(c).toUpperCase()))) errors.push('currencies must be array of 3-letter codes');
  }
  if (policy.currency !== undefined && policy.currency !== null && policy.currency !== '*' && !/^[A-Z]{3}$/.test(String(policy.currency).toUpperCase())) errors.push('currency must be 3-letter code, null or "*"');
  if (policy.maxUses !== undefined && !isSafePositiveInt(policy.maxUses)) errors.push('maxUses must be positive safe integer');
  if (policy.maxUseCount !== undefined && !isSafePositiveInt(policy.maxUseCount)) errors.push('maxUseCount must be positive safe integer');
  if (policy.useCount !== undefined && !isSafePositiveInt(policy.useCount)) errors.push('useCount must be positive safe integer');
  if (policy.requestedUses !== undefined && !isSafePositiveInt(policy.requestedUses)) errors.push('requestedUses must be positive safe integer');
  if (policy.delegationDepth !== undefined && !isSafeNonNegativeInt(policy.delegationDepth)) errors.push('delegationDepth must be non-negative safe integer');
  if (policy.maxDelegationDepth !== undefined && !isSafeNonNegativeInt(policy.maxDelegationDepth)) errors.push('maxDelegationDepth must be non-negative safe integer');
  if (policy.allowedModes !== undefined) {
    if (!Array.isArray(policy.allowedModes) || policy.allowedModes.some(m => !isNonEmptyString(m) && m !== '*')) errors.push('allowedModes must be array of non-empty strings');
  }
  if (policy.representationMode !== undefined && policy.representationMode !== '*' && !isNonEmptyString(policy.representationMode)) errors.push('representationMode must be non-empty string or "*"');
  if (policy.representationModes !== undefined && (!Array.isArray(policy.representationModes) || policy.representationModes.some(m => !isNonEmptyString(m) && m !== '*'))) errors.push('representationModes must be array of non-empty strings');
  if (policy.assurance !== undefined && policy.assurance !== '*' && !isNonEmptyString(String(policy.assurance))) errors.push('assurance must be non-empty string or "*"');
  if (policy.assuranceLevels !== undefined && (!Array.isArray(policy.assuranceLevels) || policy.assuranceLevels.some(a => !isNonEmptyString(a) && a !== '*'))) errors.push('assuranceLevels must be array of non-empty strings');
  if (policy.geography !== undefined) {
    const g = policy.geography;
    if (g === '*') { /* wildcard */ }
    else if (typeof g === 'string') { if (!isNonEmptyString(g)) errors.push('geography must be non-empty string, array or "*"');}
    else if (Array.isArray(g)) { if (g.some(v=>!isNonEmptyString(v) && v !== '*')) errors.push('geography array must contain non-empty strings');}
    else errors.push('geography must be string, array or "*"');
  }
  if (policy.geographies !== undefined && (!Array.isArray(policy.geographies) || policy.geographies.some(v=>!isNonEmptyString(v) && v !== '*'))) errors.push('geographies must be array of non-empty strings');
  if (policy.timeWindow !== undefined) {
    if (!policy.timeWindow || typeof policy.timeWindow !== 'object' || Array.isArray(policy.timeWindow)) errors.push('timeWindow must be object');
    else {
      if (policy.timeWindow.notBefore !== undefined && parseTime(policy.timeWindow.notBefore) === null) errors.push('timeWindow.notBefore must be valid timestamp');
      if (policy.timeWindow.expiresAt !== undefined && parseTime(policy.timeWindow.expiresAt) === null) errors.push('timeWindow.expiresAt must be valid timestamp');
      const nb = parseTime(policy.timeWindow.notBefore);
      const ea = parseTime(policy.timeWindow.expiresAt);
      if (nb !== null && ea !== null && nb > ea) errors.push('timeWindow.notBefore must be before expiresAt');
    }
  }
  if (policy.notBefore !== undefined && parseTime(policy.notBefore) === null) errors.push('notBefore must be valid timestamp');
  if (policy.expiresAt !== undefined && parseTime(policy.expiresAt) === null) errors.push('expiresAt must be valid timestamp');
  if (policy.cumulative !== undefined) {
    if (!policy.cumulative || typeof policy.cumulative !== 'object' || Array.isArray(policy.cumulative)) errors.push('cumulative must be object');
    else {
      if (policy.cumulative.maxAmountMinor !== undefined && !isSafeNonNegativeInt(policy.cumulative.maxAmountMinor)) errors.push('cumulative.maxAmountMinor must be non-negative safe integer');
      if (policy.cumulative.maxDisclosures !== undefined && !isSafePositiveInt(policy.cumulative.maxDisclosures)) errors.push('cumulative.maxDisclosures must be positive safe integer');
      if (policy.cumulative.maxUseCount !== undefined && !isSafePositiveInt(policy.cumulative.maxUseCount)) errors.push('cumulative.maxUseCount must be positive safe integer');
      if (policy.cumulative.windowMs !== undefined && !isSafePositiveInt(policy.cumulative.windowMs)) errors.push('cumulative.windowMs must be positive safe integer');
    }
  }
  if (policy.cumulativeDisclosure !== undefined) {
    if (!policy.cumulativeDisclosure || typeof policy.cumulativeDisclosure !== 'object') errors.push('cumulativeDisclosure must be object');
  }
  if (policy.allowedClaims !== undefined) {
    if (!Array.isArray(policy.allowedClaims) || policy.allowedClaims.some(v => !isNonEmptyString(v) && v !== '*')) errors.push('allowedClaims must be array of non-empty strings');
    if (Array.isArray(policy.allowedClaims) && policy.allowedClaims.includes('*') && policy.allowedClaims.length !== 1) errors.push('allowedClaims wildcard "*" must be sole element');
  }
  if (policy.allowedClaimIds !== undefined) {
    if (!Array.isArray(policy.allowedClaimIds) || policy.allowedClaimIds.some(v => !isNonEmptyString(v) && v !== '*')) errors.push('allowedClaimIds must be array of non-empty strings');
  }
  if (policy.claimIds !== undefined && !Array.isArray(policy.claimIds)) {
    // claimIds as top-level constraint alias
    if (!Array.isArray(policy.claimIds) || policy.claimIds.some(v => !isNonEmptyString(v) && v !== '*')) errors.push('claimIds must be array of non-empty strings');
  }
  if (policy.approvalExpirySeconds !== undefined && !isSafePositiveInt(policy.approvalExpirySeconds)) errors.push('approvalExpirySeconds must be positive safe integer');
  if (policy.transactionId !== undefined && policy.transactionId !== '*' && !isNonEmptyString(String(policy.transactionId))) errors.push('transactionId must be non-empty string or "*"');
  if (policy.constraints !== undefined) {
    if (!policy.constraints || typeof policy.constraints !== 'object' || Array.isArray(policy.constraints)) errors.push('constraints must be object');
    else {
      for (const [k,v] of Object.entries(policy.constraints)) {
        if (!CONSTRAINT_KEYS.has(k)) {
          errors.push(`unknown constraints field: ${k}`);
          continue;
        }
        if (k === 'maxAmountMinor' && v !== undefined && !isSafeNonNegativeInt(v)) errors.push('constraints.maxAmountMinor must be non-negative safe integer');
        if ((k === 'currencies' || k === 'currency') && v !== undefined) {
          const arr = Array.isArray(v) ? v : [v];
          if (arr.some(c=> c !== '*' && !/^[A-Z]{3}$/.test(String(c).toUpperCase()))) errors.push('constraints currency must be 3-letter code');
        }
        if ((k === 'maxUses' || k==='useCount' || k==='maxUseCount' || k==='requestedUses') && v!==undefined && !isSafePositiveInt(v)) errors.push(`constraints.${k} must be positive safe integer`);
        if ((k==='delegationDepth' || k==='maxDelegationDepth') && v!==undefined && !isSafeNonNegativeInt(v)) errors.push(`constraints.${k} must be non-negative safe integer`);
        if ((k==='allowedModes' || k==='representationModes' || k==='representationMode') && v!==undefined) {
          const arr = Array.isArray(v) ? v : [v];
          if (arr.some(m=>!isNonEmptyString(m) && m !== '*')) errors.push(`constraints.${k} must be non-empty string(s)`);
        }
        if ((k==='assurance' || k==='assuranceLevels') && v!==undefined) {
          const arr = Array.isArray(v) ? v : [v];
          if (arr.some(a=>!isNonEmptyString(a) && a !== '*')) errors.push(`constraints.${k} must be non-empty string(s)`);
        }
        if ((k==='geography' || k==='geographies') && v!==undefined) {
          const arr = Array.isArray(v) ? v : [v];
          if (arr.some(g=>!isNonEmptyString(g) && g !== '*')) errors.push(`constraints.${k} must be non-empty string(s)`);
        }
        if (k==='timeWindow' && v!==undefined) {
          if (!v || typeof v!=='object') errors.push('constraints.timeWindow must be object');
          else {
            if (v.notBefore!==undefined && parseTime(v.notBefore)===null) errors.push('constraints.timeWindow.notBefore must be valid timestamp');
            if (v.expiresAt!==undefined && parseTime(v.expiresAt)===null) errors.push('constraints.timeWindow.expiresAt must be valid timestamp');
          }
        }
        if ((k==='cumulative' || k==='cumulativeDisclosure') && v!==undefined) {
          if (!v || typeof v!=='object') errors.push(`constraints.${k} must be object`);
        }
        if ((k==='allowedClaims' || k==='allowedClaimIds' || k==='claimIds') && v!==undefined) {
          if (!Array.isArray(v) || v.some(x=>!isNonEmptyString(x) && x !== '*')) errors.push(`constraints.${k} must be array of non-empty strings`);
          if (Array.isArray(v) && v.includes('*') && v.length !== 1) errors.push(`constraints.${k} wildcard '*' must be sole element`);
        }
        if (k==='transactionId' && v!==undefined && v !== '*' && !isNonEmptyString(String(v))) errors.push('constraints.transactionId must be non-empty string');
        if (k==='approvalExpirySeconds' && v!==undefined && !isSafePositiveInt(v)) errors.push('constraints.approvalExpirySeconds must be positive safe integer');
        if (k==='amountMinor' && v!==undefined && v !== null && v !== '*' && !isSafeNonNegativeInt(v)) errors.push('constraints.amountMinor must be non-negative safe integer or null');
      }
    }
  }
  if (errors.length>0) {
    const err = new TypeError(`invalid policy ${policy.id ?? '?'}: ${errors.join('; ')}`);
    err.details = errors;
    throw err;
  }
  return { valid: true, errors: [] };
}

export function explainPolicy(policy) {
  if (!policy || typeof policy !== 'object') throw new TypeError('policy must be an object');
  try { validatePolicy(policy); } catch (e) { /* still explain */ }
  const id = `${policy.id}@${policy.version}`;
  const effect = policy.effect;
  const match = policy.match ? { ...policy.match } : {};
  const topConstraints = {};
  for (const k of ['maxAmountMinor','amountMinor','currencies','currency','maxUses','useCount','maxUseCount','requestedUses','delegationDepth','maxDelegationDepth','allowedModes','representationMode','representationModes','assurance','assuranceLevels','geography','geographies','timeWindow','notBefore','expiresAt','cumulative','cumulativeDisclosure','allowedClaims','allowedClaimIds','claimIds','transactionId','approvalExpirySeconds']) {
    if (policy[k] !== undefined) topConstraints[k] = policy[k];
  }
  const mergedConstraints = { ...topConstraints, ...(policy.constraints ?? {}) };
  const parts = [];
  parts.push(`${effect.toUpperCase()} ${id}`);
  if (Object.keys(match).length>0) parts.push(`match=${JSON.stringify(match)}`);
  if (Object.keys(mergedConstraints).length>0) parts.push(`constraints=${JSON.stringify(mergedConstraints)}`);
  if (policy.requireApproval) parts.push('requires human approval');
  const summary = parts.join(' | ');
  return {
    policyId: id,
    id: policy.id,
    version: policy.version,
    effect,
    match: Object.freeze({ ...match }),
    constraints: Object.freeze({ ...mergedConstraints }),
    requireApproval: !!policy.requireApproval,
    summary,
    description: effect === 'deny' ? `Denies ${id} when ${JSON.stringify(match)}` : `Allows ${id} when ${JSON.stringify(match)} with ${JSON.stringify(mergedConstraints)}`,
    reason: effect === 'deny' ? 'explicit deny' : (policy.requireApproval ? 'allow with approval' : 'allow')
  };
}

function getPolicyConstraints(policy) {
  const c = policy.constraints ?? {};
  const m = policy.match ?? {};
  const out = {};
  const pick = (...keys) => {
    for (const k of keys) {
      if (policy[k] !== undefined) return policy[k];
      if (c[k] !== undefined) return c[k];
      if (m[k] !== undefined) return m[k];
    }
    return undefined;
  };
  const maxAmountMinor = pick('maxAmountMinor','amountMinor');
  if (maxAmountMinor !== undefined) out.maxAmountMinor = maxAmountMinor;
  const currencies = pick('currencies','currency');
  if (currencies !== undefined) out.currencies = Array.isArray(currencies) ? [...currencies] : [currencies];
  if (out.currencies) out.currencies = out.currencies.map(x=>String(x).toUpperCase());
  const maxUses = pick('maxUses','maxUseCount','useCount','requestedUses');
  if (maxUses !== undefined) out.maxUses = maxUses;
  const delegationDepth = pick('delegationDepth','maxDelegationDepth');
  if (delegationDepth !== undefined) out.delegationDepth = delegationDepth;
  const allowedModes = pick('allowedModes','representationModes','representationMode');
  if (allowedModes !== undefined) out.allowedModes = Array.isArray(allowedModes) ? [...allowedModes] : [allowedModes];
  const assurance = pick('assurance','assuranceLevels');
  if (assurance !== undefined) out.assurance = Array.isArray(assurance) ? [...assurance] : [assurance];
  const geography = pick('geography','geographies');
  if (geography !== undefined) out.geography = Array.isArray(geography) ? [...geography] : [geography];
  const timeWindow = pick('timeWindow');
  if (timeWindow !== undefined) out.timeWindow = { ...timeWindow };
  else {
    const nb = pick('notBefore');
    const ea = pick('expiresAt');
    if (nb !== undefined || ea !== undefined) out.timeWindow = { ...(nb!==undefined?{notBefore:nb}:{}), ...(ea!==undefined?{expiresAt:ea}:{}) };
  }
  const cumulative = pick('cumulative','cumulativeDisclosure');
  if (cumulative !== undefined) out.cumulative = { ...cumulative };
  // claimIds / allowedClaims handling: prefer allowedClaims, fallback to claimIds
  const allowedClaims = pick('allowedClaims','allowedClaimIds','claimIds');
  if (allowedClaims !== undefined) {
    if (Array.isArray(allowedClaims) && allowedClaims.length === 1 && allowedClaims[0] === '*') {
      out.allowedClaims = ['*'];
    } else {
      out.allowedClaims = Array.isArray(allowedClaims) ? [...allowedClaims] : [allowedClaims];
    }
  }
  const transactionId = pick('transactionId');
  if (transactionId !== undefined) out.transactionId = transactionId;
  const approvalExpirySeconds = pick('approvalExpirySeconds');
  if (approvalExpirySeconds !== undefined) out.approvalExpirySeconds = approvalExpirySeconds;
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesPattern(expected, actual) {
  if (expected === '*') return true;
  if (typeof expected === 'string' && expected.includes('*')) {
    const parts = expected.split('*').map(escapeRegExp);
    const re = new RegExp(`^${parts.join('.*')}$`);
    return re.test(String(actual));
  }
  return String(actual) === String(expected);
}

function isMatch(policy, request) {
  const match = policy.match ?? {};
  for (const [field, expected] of Object.entries(match)) {
    if (expected === undefined) continue;
    // wildcard for entire field already handled inside
    if (expected === '*') continue;
    if (Array.isArray(expected) && expected.length === 1 && expected[0] === '*') continue;

    switch (field) {
      case 'principalId':
      case 'agentId':
      case 'taskId':
      case 'recipientId':
      case 'recipient':
      case 'purpose':
      case 'operationType':
      case 'resourceId':
      case 'action':
      case 'representationMode': {
        let actual = request[field];
        if (field === 'recipient' && actual === undefined) actual = request.recipientId;
        if (field === 'recipientId' && actual === undefined && request.recipient !== undefined) actual = request.recipient;
        if (Array.isArray(expected)) {
          if (expected.includes('*')) break;
          // expected is array of allowed values, request actual must be one of them
          // If request actual is array, check actual subset of expected? For these fields it's single string, so check includes
          if (Array.isArray(actual)) {
            if (!actual.every(v => expected.includes(v) || expected.includes('*'))) return false;
          } else {
            if (!expected.includes(actual)) return false;
          }
        } else {
          // expected is string (maybe with pattern)
          if (typeof expected === 'string' && expected.includes('*')) {
            if (!matchesPattern(expected, actual)) return false;
          } else {
            if (actual !== expected) return false;
          }
        }
        break;
      }
      case 'claimIds':
      case 'allowedClaims':
      case 'allowedClaimIds': {
        const reqIds = Array.isArray(request.claimIds) ? request.claimIds : [];
        // expected is array of allowed claimIds, req must be subset
        if (Array.isArray(expected)) {
          if (expected.length === 1 && expected[0] === '*') break;
          if (expected.includes('*')) break;
          if (!reqIds.every(id => expected.includes(id))) return false;
        } else if (expected === '*') {
          break;
        } else {
          // unexpected type
          return false;
        }
        break;
      }
      case 'transactionId': {
        const actual = request.transactionId;
        if (actual === undefined) return false;
        if (Array.isArray(expected)) {
          if (expected.includes('*')) break;
          if (!expected.includes(actual)) return false;
        } else if (typeof expected === 'string' && expected.includes('*')) {
          if (!matchesPattern(expected, actual)) return false;
        } else {
          if (actual !== expected) return false;
        }
        break;
      }
      case 'amountMinor': {
        const actual = request.amountMinor;
        if (expected === null) {
          if (actual !== null) return false;
        } else if (expected === '*') {
          break;
        } else {
          if (actual !== expected) return false;
        }
        break;
      }
      case 'currency': {
        const actual = normalizeCurrency(request.currency);
        const exp = normalizeCurrency(expected);
        if (exp === '*') break;
        if (actual !== exp) return false;
        break;
      }
      case 'requestedUses':
      case 'useCount': {
        const actual = request.requestedUses ?? request.useCount;
        if (expected === '*') break;
        if (actual !== expected) return false;
        break;
      }
      case 'delegationDepth': {
        const actual = request.delegationDepth;
        if (actual === undefined) break;
        if (expected === '*') break;
        if (actual !== expected) return false;
        break;
      }
      case 'assurance': {
        const actual = request.assurance;
        if (actual === undefined) break;
        if (Array.isArray(expected)) {
          if (expected.includes('*')) break;
          if (Array.isArray(actual)) {
            if (!actual.every(v => expected.includes(v))) return false;
          } else {
            if (!expected.includes(actual)) return false;
          }
        } else {
          if (expected === '*') break;
          if (typeof expected === 'string' && expected.includes('*')) {
            if (!matchesPattern(expected, actual)) return false;
          } else if (actual !== expected) return false;
        }
        break;
      }
      case 'geography': {
        const actual = request.geography;
        if (actual === undefined) break;
        const expArr = Array.isArray(expected) ? expected : [expected];
        if (expArr.includes('*')) break;
        const actArr = Array.isArray(actual) ? actual : [actual];
        if (!actArr.every(v => expArr.includes(v))) return false;
        break;
      }
      case 'timeWindow': {
        const reqTime = parseTime(request.occurredAt ?? request.timestamp ?? request.notBefore) ?? Date.now();
        const nb = parseTime(expected.notBefore);
        const ea = parseTime(expected.expiresAt);
        if (nb !== null && reqTime < nb) return false;
        if (ea !== null && reqTime > ea) return false;
        break;
      }
      default: {
        // generic exact match with wildcard support
        const actual = request[field];
        if (Array.isArray(expected)) {
          if (expected.includes('*')) break;
          const actualArr = Array.isArray(actual) ? actual : (actual !== undefined ? [actual] : []);
          if (expected.length !== actualArr.length || !expected.every(v => actualArr.includes(v))) return false;
        } else if (expected !== null && typeof expected === 'object') {
          // object comparison not supported, skip
          continue;
        } else {
          if (typeof expected === 'string' && expected.includes('*')) {
            if (!matchesPattern(expected, actual)) return false;
          } else if (actual !== expected) return false;
        }
        break;
      }
    }
  }
  return true;
}

function intersectConstraints(allowPolicies) {
  let maxAmountMinor;
  let currencies;
  let maxUses;
  let delegationDepth;
  let allowedModes;
  let assurance;
  let geography;
  let timeWindow;
  let cumulative;
  let allowedClaims;
  let transactionId;
  let approvalExpirySeconds;

  let hasCurrency = false;
  let hasModes = false;
  let hasGeography = false;
  let hasAssurance = false;
  let hasTimeWindow = false;
  let hasCumulative = false;
  let hasAllowedClaims = false;

  // Sort deterministically to ensure order independence; though intersection is commutative, sorting guarantees stable logic for tie handling
  const sortedPolicies = [...allowPolicies].sort((a,b) => toSortedId(a).localeCompare(toSortedId(b)));

  for (const policy of sortedPolicies) {
    const c = getPolicyConstraints(policy);
    if (c.maxAmountMinor !== undefined && c.maxAmountMinor !== '*') {
      maxAmountMinor = maxAmountMinor === undefined ? c.maxAmountMinor : Math.min(maxAmountMinor, c.maxAmountMinor);
    }
    if (c.currencies !== undefined) {
      hasCurrency = true;
      // handle wildcard '*' in currencies means any currency
      const set = new Set(c.currencies);
      if (set.has('*')) {
        // wildcard means no restriction from this policy; skip intersection unless all are wildcard
        // If currencies already set, keep as is; if not set, we shouldn't set to wildcard exclusive; treat as unrestricted
        if (currencies === undefined) {
          // first wildcard means unrestricted so far, but need to track that we have seen wildcard
          // To keep determinism, we treat wildcard as not narrowing; we keep currencies undefined until a concrete set appears
          // If all policies are wildcard, then currencies stays undefined (means any)
          // So we don't set currencies for wildcard
        } else {
          // already have concrete set, wildcard doesn't narrow
        }
      } else {
        if (currencies === undefined) currencies = [...set];
        else currencies = currencies.filter(x => set.has(x));
      }
    }
    if (c.maxUses !== undefined) {
      maxUses = maxUses === undefined ? c.maxUses : Math.min(maxUses, c.maxUses);
    }
    if (c.delegationDepth !== undefined) {
      delegationDepth = delegationDepth === undefined ? c.delegationDepth : Math.min(delegationDepth, c.delegationDepth);
    }
    if (c.allowedModes !== undefined) {
      hasModes = true;
      const set = new Set(c.allowedModes);
      if (set.has('*')) {
        if (allowedModes === undefined) {
          // unrestricted so far
        }
      } else {
        if (allowedModes === undefined) allowedModes = [...set];
        else allowedModes = allowedModes.filter(x => set.has(x));
      }
    }
    if (c.assurance !== undefined) {
      hasAssurance = true;
      const set = new Set(c.assurance);
      if (set.has('*')) {
        if (assurance === undefined) { /* unrestricted */ }
      } else {
        if (assurance === undefined) assurance = [...set];
        else assurance = assurance.filter(x => set.has(x));
      }
    }
    if (c.geography !== undefined) {
      hasGeography = true;
      const set = new Set(c.geography);
      if (set.has('*')) {
        if (geography === undefined) { /* unrestricted */ }
      } else {
        if (geography === undefined) geography = [...set];
        else geography = geography.filter(x => set.has(x));
      }
    }
    if (c.timeWindow !== undefined) {
      hasTimeWindow = true;
      const nb = parseTime(c.timeWindow.notBefore);
      const ea = parseTime(c.timeWindow.expiresAt);
      const curNb = parseTime(timeWindow?.notBefore);
      const curEa = parseTime(timeWindow?.expiresAt);
      let newNb = null;
      let newEa = null;
      if (nb !== null && curNb !== null) newNb = Math.max(nb, curNb);
      else newNb = nb !== null ? nb : curNb;
      if (ea !== null && curEa !== null) newEa = Math.min(ea, curEa);
      else newEa = ea !== null ? ea : curEa;
      if (timeWindow === undefined) timeWindow = {};
      if (newNb !== null) timeWindow.notBefore = new Date(newNb).toISOString();
      else delete timeWindow.notBefore;
      if (newEa !== null) timeWindow.expiresAt = new Date(newEa).toISOString();
      else delete timeWindow.expiresAt;
      if (Object.keys(timeWindow).length===0) timeWindow = undefined;
      if (newNb !== null && newEa !== null && newNb > newEa) {
        timeWindow = timeWindow ?? {};
        timeWindow._invalid = true;
      }
    }
    if (c.cumulative !== undefined) {
      hasCumulative = true;
      if (cumulative === undefined) cumulative = { ...c.cumulative };
      else {
        if (c.cumulative.maxAmountMinor !== undefined) {
          cumulative.maxAmountMinor = cumulative.maxAmountMinor === undefined ? c.cumulative.maxAmountMinor : Math.min(cumulative.maxAmountMinor, c.cumulative.maxAmountMinor);
        }
        if (c.cumulative.maxDisclosures !== undefined) {
          cumulative.maxDisclosures = cumulative.maxDisclosures === undefined ? c.cumulative.maxDisclosures : Math.min(cumulative.maxDisclosures, c.cumulative.maxDisclosures);
        }
        if (c.cumulative.maxUseCount !== undefined) {
          cumulative.maxUseCount = cumulative.maxUseCount === undefined ? c.cumulative.maxUseCount : Math.min(cumulative.maxUseCount, c.cumulative.maxUseCount);
        }
        if (c.cumulative.windowMs !== undefined) {
          cumulative.windowMs = cumulative.windowMs === undefined ? c.cumulative.windowMs : Math.min(cumulative.windowMs, c.cumulative.windowMs);
        }
        for (const k of Object.keys(c.cumulative)) {
          if (cumulative[k] === undefined) cumulative[k] = c.cumulative[k];
        }
      }
    }
    if (c.allowedClaims !== undefined) {
      hasAllowedClaims = true;
      const claimsSet = c.allowedClaims;
      const isWildcard = claimsSet.length === 1 && claimsSet[0] === '*';
      if (isWildcard) {
        if (allowedClaims === undefined) {
          // wildcard means unrestricted so far; don't set
          // But if later a concrete set appears, it will become that set
          // If all are wildcard, allowedClaims stays undefined meaning any
        }
      } else {
        const set = new Set(claimsSet);
        if (allowedClaims === undefined) allowedClaims = [...set];
        else if (allowedClaims.length === 1 && allowedClaims[0] === '*') {
          // previous was wildcard, now concrete
          allowedClaims = [...set];
        } else {
          allowedClaims = allowedClaims.filter(x => set.has(x));
        }
      }
    } else {
      // Policy has no allowedClaims: per spec, only empty claimIds allowed => treat as empty set
      // For backward compat, if no policy defines allowedClaims at all, we handle via hasAllowedClaims flag
      // If at least one policy defines allowedClaims, and this policy has none, then intersection should be empty
      // We mark hasAllowedClaims true and intersect with empty set
      hasAllowedClaims = true;
      if (allowedClaims === undefined) allowedClaims = [];
      else allowedClaims = []; // empty intersection
    }
    if (c.transactionId !== undefined) {
      if (transactionId === undefined) transactionId = c.transactionId;
      else if (transactionId !== c.transactionId) transactionId = null;
    }
    if (c.approvalExpirySeconds !== undefined) {
      approvalExpirySeconds = approvalExpirySeconds === undefined ? c.approvalExpirySeconds : Math.min(approvalExpirySeconds, c.approvalExpirySeconds);
    }
  }

  // If hasAllowedClaims but allowedClaims stayed undefined (all wildcards), treat as wildcard unrestricted -> don't include in constraints
  const constraints = {};
  if (maxAmountMinor !== undefined) constraints.maxAmountMinor = maxAmountMinor;
  if (hasCurrency) {
    // if all were wildcards, currencies will be undefined -> means any, so don't set
    if (currencies !== undefined) constraints.currencies = currencies ?? [];
    else {
      // all wildcard, no restriction -> don't set currencies constraint
    }
  }
  if (maxUses !== undefined) constraints.maxUses = maxUses;
  if (delegationDepth !== undefined) constraints.delegationDepth = delegationDepth;
  if (hasModes) {
    if (allowedModes !== undefined) constraints.allowedModes = allowedModes ?? [];
    // if all wildcard, no constraint
  }
  if (hasAssurance) {
    if (assurance !== undefined) constraints.assurance = assurance ?? [];
  }
  if (hasGeography) {
    if (geography !== undefined) constraints.geography = geography ?? [];
  }
  if (hasTimeWindow) {
    if (timeWindow && timeWindow._invalid) {
      constraints.timeWindow = { ...timeWindow, _invalid: true };
    } else if (timeWindow) {
      constraints.timeWindow = { ...timeWindow };
      delete constraints.timeWindow._invalid;
      if (Object.keys(constraints.timeWindow).length===0) delete constraints.timeWindow;
    } else if (hasTimeWindow) {
      // all timeWindows were wildcards? Not possible, but handle
    }
  }
  if (hasCumulative) constraints.cumulative = cumulative;
  if (hasAllowedClaims) {
    if (allowedClaims !== undefined) {
      // if allowedClaims is ['*'] wildcard unrestricted, don't set constraint? But we already handled wildcard as undefined
      // However if single wildcard originally, allowedClaims is undefined, we shouldn't set
      constraints.allowedClaims = allowedClaims ?? [];
      // also expose as claimIds for backward compat
      constraints.claimIds = allowedClaims ?? [];
    } else {
      // all wildcards -> no restriction, don't set
    }
  }
  if (transactionId !== undefined) constraints.transactionId = transactionId;
  if (approvalExpirySeconds !== undefined) constraints.approvalExpirySeconds = approvalExpirySeconds;
  return constraints;
}

function checkRequestAgainstConstraints(request, constraints) {
  if (constraints.maxAmountMinor !== undefined) {
    const reqAmount = request.amountMinor;
    if (reqAmount !== null && reqAmount !== undefined && reqAmount > constraints.maxAmountMinor) {
      return { denied: true, reason: 'request exceeds policy amount limit' };
    }
  }
  if (constraints.currencies !== undefined) {
    if (constraints.currencies.length === 0) {
      return { denied: true, reason: 'no compatible currency across matching policies' };
    }
    if (request.currency !== null && request.currency !== undefined && !constraints.currencies.includes(normalizeCurrency(request.currency))) {
      return { denied: true, reason: 'request currency is not allowed' };
    }
  }
  if (constraints.maxUses !== undefined) {
    const uses = request.requestedUses ?? request.useCount;
    if (uses !== undefined && uses > constraints.maxUses) {
      return { denied: true, reason: 'requested uses exceed policy limit' };
    }
    if (request.requestedUses !== undefined && request.requestedUses > constraints.maxUses) {
      return { denied: true, reason: 'requested uses exceed policy limit' };
    }
    if (request.useCount !== undefined && request.useCount > constraints.maxUses) {
      return { denied: true, reason: 'use count exceeds policy limit' };
    }
  }
  if (constraints.delegationDepth !== undefined && request.delegationDepth !== undefined) {
    if (request.delegationDepth > constraints.delegationDepth) {
      return { denied: true, reason: 'delegation depth exceeds policy limit' };
    }
  }
  if (constraints.allowedModes !== undefined) {
    if (constraints.allowedModes.length === 0) {
      return { denied: true, reason: 'no compatible disclosure mode across matching policies' };
    }
    if (request.representationMode !== undefined && !constraints.allowedModes.includes(request.representationMode)) {
      return { denied: true, reason: 'representation mode is not allowed' };
    }
  }
  if (constraints.assurance !== undefined) {
    if (constraints.assurance.length === 0) {
      return { denied: true, reason: 'no compatible assurance level across matching policies' };
    }
    if (request.assurance !== undefined) {
      const reqAss = Array.isArray(request.assurance) ? request.assurance : [request.assurance];
      // request assurance must be subset of allowed? For single string, check included
      if (Array.isArray(request.assurance)) {
        if (!reqAss.every(a => constraints.assurance.includes(a))) return { denied: true, reason: 'assurance level is not allowed' };
      } else {
        if (!constraints.assurance.includes(request.assurance)) return { denied: true, reason: 'assurance level is not allowed' };
      }
    }
  }
  if (constraints.geography !== undefined) {
    if (constraints.geography.length === 0) {
      return { denied: true, reason: 'no compatible geography across matching policies' };
    }
    if (request.geography !== undefined) {
      const reqGeo = Array.isArray(request.geography) ? request.geography : [request.geography];
      if (!reqGeo.every(g => constraints.geography.includes(g))) {
        return { denied: true, reason: 'geography is not allowed' };
      }
    }
  }
  // claimIds / allowedClaims authorization
  const allowedClaims = constraints.allowedClaims ?? constraints.claimIds;
  if (allowedClaims !== undefined) {
    if (allowedClaims.length === 1 && allowedClaims[0] === '*') {
      // wildcard allows any
    } else {
      if (allowedClaims.length === 0 && (request.claimIds && request.claimIds.length > 0)) {
        return { denied: true, reason: 'no compatible claim set across matching policies' };
      }
      if (request.claimIds !== undefined) {
        const reqIds = Array.isArray(request.claimIds) ? request.claimIds : [];
        // Handle wildcard in allowedClaims already
        if (!reqIds.every(id => allowedClaims.includes(id))) {
          return { denied: true, reason: 'claim is not allowed by policy' };
        }
      }
    }
  }
  if (constraints.transactionId !== undefined) {
    if (constraints.transactionId === null) {
      return { denied: true, reason: 'no compatible transaction across matching policies' };
    }
    if (request.transactionId !== undefined && constraints.transactionId !== '*' && !matchesPattern(constraints.transactionId, request.transactionId)) {
      // if constraint is pattern, check pattern match
      if (typeof constraints.transactionId === 'string' && constraints.transactionId.includes('*')) {
        if (!matchesPattern(constraints.transactionId, request.transactionId)) return { denied: true, reason: 'transaction id mismatch' };
      } else if (request.transactionId !== constraints.transactionId) {
        return { denied: true, reason: 'transaction id mismatch' };
      }
    }
  }
  if (constraints.timeWindow !== undefined) {
    if (constraints.timeWindow._invalid) {
      return { denied: true, reason: 'no compatible time window across matching policies' };
    }
    const nb = parseTime(constraints.timeWindow.notBefore);
    const ea = parseTime(constraints.timeWindow.expiresAt);
    const reqTime = parseTime(request.occurredAt ?? request.timestamp ?? request.notBefore) ?? Date.now();
    if (nb !== null && reqTime < nb) {
      return { denied: true, reason: 'request is before allowed time window' };
    }
    if (ea !== null && reqTime > ea) {
      return { denied: true, reason: 'request is outside allowed time window' };
    }
  }
  if (constraints.cumulative !== undefined) {
    const cum = constraints.cumulative;
    if (cum.maxAmountMinor !== undefined && request.amountMinor !== null && request.cumulativeAmount !== undefined) {
      if (request.cumulativeAmount + (request.amountMinor ?? 0) > cum.maxAmountMinor) {
        return { denied: true, reason: 'cumulative amount exceeds policy limit' };
      }
    }
    if (cum.maxDisclosures !== undefined && request.cumulativeDisclosures !== undefined) {
      if (request.cumulativeDisclosures + 1 > cum.maxDisclosures) {
        return { denied: true, reason: 'cumulative disclosure count exceeds policy limit' };
      }
    }
    if (cum.maxUseCount !== undefined && request.cumulativeUses !== undefined) {
      if (request.cumulativeUses + (request.requestedUses ?? 1) > cum.maxUseCount) {
        return { denied: true, reason: 'cumulative use count exceeds policy limit' };
      }
    }
  }
  return { denied: false };
}

export function createPolicyAuthority(policies) {
  if (!Array.isArray(policies)) throw new TypeError('policies must be an array');
  const frozenPolicies = policies.map((p) => {
    validatePolicy(p);
    const clone = JSON.parse(JSON.stringify(p));
    if (!clone.match) clone.match = {};
    deepFreeze(clone);
    return clone;
  });
  const effectMap = new Map(frozenPolicies.map(p => [`${p.id}@${p.version}`, p.effect]));
  deepFreeze(frozenPolicies);

  function evaluate(request) {
    if (!request || typeof request !== 'object') throw new TypeError('request must be an object');
    const normalizedRequest = { ...request };
    if (normalizedRequest.currency !== undefined && normalizedRequest.currency !== null) {
      normalizedRequest.currency = normalizeCurrency(normalizedRequest.currency);
    }
    // Ensure claimIds normalized to array for consistent handling
    if (normalizedRequest.claimIds !== undefined && !Array.isArray(normalizedRequest.claimIds)) {
      normalizedRequest.claimIds = [normalizedRequest.claimIds];
    }
    const matching = frozenPolicies.filter((policy) => isMatch(policy, normalizedRequest));
    const denyMatches = matching.filter(p => effectMap.get(`${p.id}@${p.version}`) === 'deny' || p.effect === 'deny');
    if (denyMatches.length > 0) {
      const sortedDeny = [...denyMatches].sort((a,b) => toSortedId(a).localeCompare(toSortedId(b)));
      return {
        decision: 'deny',
        policyIds: sortedDeny.map(toSortedId),
        constraints: {},
        reason: 'matching deny policy'
      };
    }
    const allowMatches = matching.filter(p => p.effect === 'allow');
    if (allowMatches.length === 0) {
      return {
        decision: 'deny',
        policyIds: [],
        constraints: {},
        reason: 'no matching allow policy'
      };
    }
    const intersected = intersectConstraints(allowMatches);
    const check = checkRequestAgainstConstraints(normalizedRequest, intersected);
    if (check.denied) {
      const sortedAllow = [...allowMatches].sort((a,b)=>toSortedId(a).localeCompare(toSortedId(b)));
      return {
        decision: 'deny',
        policyIds: sortedAllow.map(toSortedId),
        constraints: {},
        reason: check.reason
      };
    }
    const requiresApproval = allowMatches.some(p => p.requireApproval === true);
    const resultConstraints = {};
    if (intersected.maxUses !== undefined) resultConstraints.maxUses = intersected.maxUses;
    if (intersected.maxAmountMinor !== undefined) resultConstraints.maxAmountMinor = intersected.maxAmountMinor;
    if (intersected.currencies !== undefined) resultConstraints.currencies = [...intersected.currencies];
    if (intersected.allowedModes !== undefined) resultConstraints.allowedModes = [...intersected.allowedModes];
    if (intersected.delegationDepth !== undefined) resultConstraints.delegationDepth = intersected.delegationDepth;
    if (intersected.assurance !== undefined) resultConstraints.assurance = [...intersected.assurance];
    if (intersected.geography !== undefined) resultConstraints.geography = [...intersected.geography];
    if (intersected.timeWindow !== undefined) resultConstraints.timeWindow = { ...intersected.timeWindow };
    if (intersected.cumulative !== undefined) resultConstraints.cumulative = { ...intersected.cumulative };
    if (intersected.allowedClaims !== undefined) {
      resultConstraints.allowedClaims = [...intersected.allowedClaims];
      // backward compat expose as claimIds as well
      resultConstraints.claimIds = [...intersected.allowedClaims];
    } else if (intersected.claimIds !== undefined) {
      resultConstraints.claimIds = [...intersected.claimIds];
      resultConstraints.allowedClaims = [...intersected.claimIds];
    }
    if (intersected.transactionId !== undefined && intersected.transactionId !== null) resultConstraints.transactionId = intersected.transactionId;
    if (intersected.approvalExpirySeconds !== undefined) resultConstraints.approvalExpirySeconds = intersected.approvalExpirySeconds;

    const sortedAllowIds = [...allowMatches].sort((a,b)=>toSortedId(a).localeCompare(toSortedId(b))).map(toSortedId);
    return {
      decision: requiresApproval ? 'approval_required' : 'allow',
      policyIds: sortedAllowIds,
      constraints: resultConstraints,
      reason: requiresApproval ? 'matching policy requires human approval' : 'matching policy allows operation'
    };
  }

  function simulate(request) {
    const result = evaluate(request);
    const matching = frozenPolicies.filter(p => isMatch(p, request));
    const trace = {
      matchingPolicyIds: matching.map(toSortedId).sort(),
      matchingPolicies: matching.map(p => ({ id: p.id, version: p.version, effect: p.effect, match: { ...p.match } })),
      allowPolicyIds: matching.filter(p=>p.effect==='allow').map(toSortedId).sort(),
      denyPolicyIds: matching.filter(p=>p.effect==='deny').map(toSortedId).sort(),
      intersectedConstraints: result.constraints,
      wouldRequireApproval: result.decision === 'approval_required'
    };
    return { ...result, trace };
  }

  function authorityExplainPolicy(policyOrId) {
    if (typeof policyOrId === 'string') {
      const found = frozenPolicies.find(p => toSortedId(p) === policyOrId || p.id === policyOrId);
      if (!found) throw new Error(`policy not found: ${policyOrId}`);
      return explainPolicy(found);
    }
    return explainPolicy(policyOrId);
  }

  function authorityValidatePolicy(policy) {
    return validatePolicy(policy);
  }

  return {
    evaluate,
    simulate,
    explainPolicy: authorityExplainPolicy,
    validatePolicy: authorityValidatePolicy,
    listPolicies() {
      return frozenPolicies.map(p => ({ ...p, match: { ...p.match } }));
    }
  };
}

export function simulate(request, policies) {
  if (policies) {
    const auth = createPolicyAuthority(policies);
    return auth.simulate(request);
  }
  throw new TypeError('simulate requires policies array as second argument');
}
