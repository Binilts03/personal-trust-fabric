import { randomUUID } from 'node:crypto';

const SOURCE_TYPES = new Set(['external', 'model', 'human']);
const MODEL_VISIBILITIES = new Set([
  'shareable',
  'abstractable',
  'selectively_disclosable',
  'use_only',
  'direct_delivery_only',
  'never_disclose'
]);

function assertKnownFields(input, fields) {
  for (const field of Object.keys(input)) {
    if (!fields.includes(field)) throw new TypeError(`unknown field: ${field}`);
  }
}

function assertNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function normalizeSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new TypeError('source must be an object');
  }
  assertKnownFields(source, ['type', 'id']);
  if (!SOURCE_TYPES.has(source.type)) throw new TypeError('source.type is unsupported');
  assertNonEmptyString(source.id, 'source.id');
  return Object.freeze({ type: source.type, id: source.id });
}

function normalizeTimestamp(value, field) {
  assertNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${field} must be a valid timestamp`);
  return value;
}

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { /* fallback */ }
  }
  return JSON.parse(JSON.stringify(value));
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

function freezeObservation(observation) {
  return deepFreeze({
    ...observation,
    source: deepFreeze(deepClone(observation.source)),
    content: deepFreeze(deepClone(observation.content))
  });
}

function freezeClaim(claim) {
  const base = {
    ...claim,
    value: deepFreeze(deepClone(claim.value)),
    contexts: Object.freeze([...claim.contexts]),
    evidenceIds: Object.freeze([...claim.evidenceIds]),
    provenance: Object.freeze(claim.provenance.map((item) => deepFreeze(deepClone(item))))
  };
  if (claim.contradictions !== undefined) base.contradictions = Object.freeze([...claim.contradictions]);
  if (claim.contradictionSet !== undefined) base.contradictionSet = Object.freeze([...claim.contradictionSet]);
  if (claim.rejectedReason !== undefined) base.rejectedReason = claim.rejectedReason;
  return deepFreeze(base);
}

function toTaskClaim(claim) {
  const out = {
    id: claim.id,
    key: claim.key,
    value: deepFreeze(deepClone(claim.value)),
    contexts: Object.freeze([...claim.contexts]),
    confidence: claim.confidence,
    sensitivity: claim.sensitivity,
    modelVisibility: claim.modelVisibility,
    status: claim.status,
    supersedes: claim.supersedes,
    provenance: Object.freeze(claim.provenance.map((item) => deepFreeze(deepClone(item))))
  };
  if (claim.contradictions !== undefined) out.contradictions = Object.freeze([...claim.contradictions]);
  if (claim.contradictionSet !== undefined) out.contradictionSet = Object.freeze([...claim.contradictionSet]);
  return deepFreeze(out);
}

export function createPersonaStore({
  now = Date.now,
  idFactory = () => randomUUID()
} = {}) {
  const observations = new Map();
  const claims = new Map();

  return {
    addObservation(input) {
      assertKnownFields(input, ['source', 'observedAt', 'sensitivity', 'content']);
      const source = normalizeSource(input.source);
      const observedAt = normalizeTimestamp(input.observedAt, 'observedAt');
      assertNonEmptyString(input.sensitivity, 'sensitivity');
      if (!input.content || typeof input.content !== 'object' || Array.isArray(input.content)) {
        throw new TypeError('content must be an object');
      }

      const observation = freezeObservation({
        id: idFactory(),
        source,
        observedAt,
        trust: 'untrusted',
        sensitivity: input.sensitivity,
        content: input.content,
        status: 'evidence'
      });
      observations.set(observation.id, observation);
      return observation;
    },

    proposeClaim(input) {
      assertKnownFields(input, [
        'key',
        'value',
        'contexts',
        'evidenceIds',
        'inferred',
        'confidence',
        'sensitivity',
        'modelVisibility'
      ]);
      assertNonEmptyString(input.key, 'key');
      if (input.value === undefined) throw new TypeError('value is required');
      if (!Array.isArray(input.contexts) || input.contexts.length === 0) {
        throw new TypeError('contexts must be a non-empty array');
      }
      input.contexts.forEach((context) => assertNonEmptyString(context, 'context'));
      if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length === 0) {
        throw new TypeError('evidenceIds must be a non-empty array');
      }
      input.evidenceIds.forEach((id) => {
        assertNonEmptyString(id, 'evidenceId');
        if (!observations.has(id)) throw new Error(`unknown observation: ${id}`);
      });
      if (typeof input.inferred !== 'boolean') throw new TypeError('inferred must be a boolean');
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new TypeError('confidence must be between 0 and 1');
      }
      assertNonEmptyString(input.sensitivity, 'sensitivity');
      if (!MODEL_VISIBILITIES.has(input.modelVisibility)) {
        throw new TypeError('modelVisibility is unsupported');
      }

      const evidenceIds = [...new Set(input.evidenceIds)];
      const newId = idFactory();
      // Contradiction detection: same key, different value among non-superseded/non-rejected claims
      const contradictions = [];
      const contradictionSet = new Set();
      for (const existing of claims.values()) {
        if (existing.key !== input.key) continue;
        if (existing.status === 'superseded' || existing.status === 'rejected' || existing.status === 'expired') continue;
        // Use JSON stringify for deep value comparison (handles objects)
        const existingVal = typeof existing.value === 'object' ? JSON.stringify(existing.value) : String(existing.value);
        const newVal = typeof input.value === 'object' ? JSON.stringify(input.value) : String(input.value);
        if (existingVal !== newVal) {
          contradictions.push(existing.id);
          contradictionSet.add(existing.id);
          // also include any contradictions that existing already had
          if (existing.contradictions) {
            for (const cid of existing.contradictions) contradictionSet.add(cid);
          }
          if (existing.contradictionSet) {
            for (const cid of existing.contradictionSet) contradictionSet.add(cid);
          }
        }
      }
      const baseClaim = {
        id: newId,
        key: input.key,
        value: input.value,
        contexts: [...new Set(input.contexts)],
        evidenceIds,
        inferred: input.inferred,
        confidence: input.confidence,
        sensitivity: input.sensitivity,
        modelVisibility: input.modelVisibility,
        status: 'candidate',
        createdAt: new Date(now()).toISOString(),
        supersedes: null,
        provenance: evidenceIds.map((observationId) => {
          const observation = observations.get(observationId);
          return {
            kind: 'observation',
            observationId,
            source: observation.source,
            trust: observation.trust,
            observedAt: observation.observedAt
          };
        })
      };
      if (contradictions.length > 0) {
        baseClaim.contradictions = contradictions;
        baseClaim.contradictionSet = [...contradictionSet];
      }
      const claim = freezeClaim(baseClaim);
      claims.set(claim.id, claim);
      return claim;
    },

    rejectClaim(input) {
      assertKnownFields(input, ['claimId', 'source', 'reason']);
      assertNonEmptyString(input.claimId, 'claimId');
      const source = normalizeSource(input.source);
      if (source.type !== 'human') throw new Error('explicit Human rejection is required');
      const claim = claims.get(input.claimId);
      if (!claim) throw new Error('claim not found');
      if (claim.status !== 'candidate' && claim.status !== 'confirmed' && claim.status !== 'contextual') throw new Error('claim is not rejectable');
      const rejected = freezeClaim({
        ...claim,
        status: 'rejected',
        rejectedReason: input.reason ?? null,
        provenance: [
          ...claim.provenance,
          {
            kind: 'rejection',
            source,
            occurredAt: new Date(now()).toISOString(),
            reason: input.reason ?? null
          }
        ]
      });
      claims.set(rejected.id, rejected);
      return rejected;
    },

    // Alias for backward compat: some callers may use rejectClaim without reason
    // Ensure contextual status handling: mark claim as contextual if needed
    markContextual(input) {
      assertKnownFields(input, ['claimId', 'source', 'context']);
      assertNonEmptyString(input.claimId, 'claimId');
      const source = normalizeSource(input.source);
      const claim = claims.get(input.claimId);
      if (!claim) throw new Error('claim not found');
      const contextual = freezeClaim({
        ...claim,
        status: 'contextual',
        provenance: [
          ...claim.provenance,
          {
            kind: 'contextual',
            source,
            occurredAt: new Date(now()).toISOString(),
            context: input.context
          }
        ]
      });
      claims.set(contextual.id, contextual);
      return contextual;
    },

    confirmClaim(input) {
      assertKnownFields(input, ['claimId', 'source']);
      assertNonEmptyString(input.claimId, 'claimId');
      const source = normalizeSource(input.source);
      if (source.type !== 'human') throw new Error('explicit Human confirmation is required');

      const claim = claims.get(input.claimId);
      if (!claim || claim.status !== 'candidate') throw new Error('claim is not a candidate');
      const confirmed = freezeClaim({
        ...claim,
        status: 'confirmed',
        provenance: [
          ...claim.provenance,
          {
            kind: 'confirmation',
            source,
            occurredAt: new Date(now()).toISOString()
          }
        ]
      });
      claims.set(confirmed.id, confirmed);
      return confirmed;
    },

    correctClaim(input) {
      assertKnownFields(input, ['claimId', 'value', 'confidence', 'source']);
      assertNonEmptyString(input.claimId, 'claimId');
      if (input.value === undefined) throw new TypeError('value is required');
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new TypeError('confidence must be between 0 and 1');
      }
      const source = normalizeSource(input.source);
      if (source.type !== 'human') throw new Error('explicit Human correction is required');

      const claim = claims.get(input.claimId);
      if (!claim || claim.status !== 'confirmed') throw new Error('claim is not active');
      claims.set(claim.id, freezeClaim({ ...claim, status: 'superseded' }));

      const corrected = freezeClaim({
        ...claim,
        id: idFactory(),
        value: input.value,
        inferred: false,
        confidence: input.confidence,
        status: 'confirmed',
        createdAt: new Date(now()).toISOString(),
        supersedes: claim.id,
        provenance: [
          ...claim.provenance,
          {
            kind: 'correction',
            source,
            occurredAt: new Date(now()).toISOString(),
            supersededClaimId: claim.id
          }
        ]
      });
      claims.set(corrected.id, corrected);
      return corrected;
    },

    queryTaskClaims(input) {
      assertKnownFields(input, ['contexts']);
      if (!Array.isArray(input.contexts) || input.contexts.length === 0) {
        throw new TypeError('contexts must be a non-empty array');
      }
      input.contexts.forEach((context) => assertNonEmptyString(context, 'context'));
      const requestedContexts = new Set(input.contexts);

      return Object.freeze([...claims.values()]
        .filter((claim) => claim.status === 'confirmed')
        .filter((claim) => claim.modelVisibility === 'shareable')
        .filter((claim) => claim.contexts.includes('*') || claim.contexts.some((context) => requestedContexts.has(context)))
        .map(toTaskClaim));
    }
  };
}
