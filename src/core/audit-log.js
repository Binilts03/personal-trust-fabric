import { createHash } from 'node:crypto';

const GENESIS_HASH = '0'.repeat(64);

const EVENT_TYPES = new Set([
  'decision_recorded',
  'capability_issued',
  'capability_used',
  'capability_revoked',
  'disclosure_planned',
  'disclosure_completed',
  'action_completed'
]);

const EVENT_FIELDS = new Set([
  'eventType',
  'correlationId',
  'occurredAt',
  'outcome',
  'recipientId',
  'purpose',
  'scope',
  'representation',
  'assurance',
  'downgrade'
]);

const PROTECTED_FIELDS = new Set([
  'protectedpayload',
  'protectedvalue',
  'protecteddata',
  'rawpayload',
  'rawvalue',
  'rawdata',
  'secret',
  'password',
  'token',
  'privatekey',
  'cardnumber',
  'credentialpayload'
]);

const PROTECTED_CANARY = /\b(?:PTF[_-])?CANARY[_:-][A-Z0-9_-]+\b/i;

const STRING_FIELDS = [
  'eventType',
  'correlationId',
  'occurredAt',
  'outcome',
  'recipientId',
  'purpose',
  'representation',
  'assurance'
];

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeEvent(input) {
  if (!isPlainObject(input)) {
    throw new TypeError('audit event must be a plain object');
  }
  for (const field of Reflect.ownKeys(input)) {
    if (typeof field !== 'string') throw new Error('unknown audit event field');
    if (PROTECTED_FIELDS.has(field.toLowerCase())) {
      throw new Error('protected or raw payload field is not allowed in audit events');
    }
    if (!EVENT_FIELDS.has(field)) throw new Error('unknown audit event field');
  }
  if (!EVENT_TYPES.has(input.eventType)) throw new Error('unsupported audit event type');
  for (const field of ['eventType', 'correlationId', 'occurredAt', 'outcome']) {
    if (typeof input[field] !== 'string' || input[field].length === 0) {
      throw new TypeError(`audit event ${field} must be a non-empty string`);
    }
  }
  for (const field of STRING_FIELDS.slice(4)) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || input[field].length === 0)) {
      throw new TypeError(`audit event ${field} must be a non-empty string`);
    }
  }
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new TypeError('audit event occurredAt must be a timestamp');
  }
  if (
    input.scope !== undefined &&
    (!Array.isArray(input.scope) ||
      input.scope.some((value) => typeof value !== 'string' || value.length === 0))
  ) {
    throw new TypeError('audit event scope must be an array of non-empty strings');
  }
  if (input.downgrade !== undefined && typeof input.downgrade !== 'boolean') {
    throw new TypeError('audit event downgrade must be a boolean');
  }

  const event = {};
  for (const field of EVENT_FIELDS) {
    if (input[field] !== undefined) {
      event[field] = field === 'scope' ? [...input[field]] : input[field];
    }
  }
  if (
    Object.values(event).some((value) =>
      Array.isArray(value)
        ? value.some((item) => PROTECTED_CANARY.test(item))
        : typeof value === 'string' && PROTECTED_CANARY.test(value)
    )
  ) {
    throw new Error('canary-like protected value is not allowed in audit events');
  }
  return event;
}

function copyEvent(event) {
  return {
    ...event,
    ...(event.scope === undefined ? {} : { scope: [...event.scope] })
  };
}

function copyRecord(record) {
  return {
    ...record,
    event: copyEvent(record.event)
  };
}

function hashRecord(sequence, previousHash, event) {
  return createHash('sha256')
    .update(JSON.stringify([sequence, previousHash, event]))
    .digest('hex');
}

function hasOnlyRecordFields(record) {
  const fields = Reflect.ownKeys(record);
  return (
    fields.length === 4 &&
    fields.every((field) =>
      ['sequence', 'previousHash', 'hash', 'event'].includes(field)
    )
  );
}

// ponytail: This unkeyed, in-memory SHA-256 chain proves only consistency relative to a
// trusted head; it cannot stop an attacker who can rewrite and rehash the whole chain.
// Upgrade when audit data leaves this process by signing or independently anchoring the head.
function verifyChain(chain) {
  if (!Array.isArray(chain)) return false;

  let previousHash = GENESIS_HASH;
  try {
    return chain.every((record, index) => {
      if (!isPlainObject(record) || !hasOnlyRecordFields(record)) return false;
      if (record.sequence !== index + 1 || record.previousHash !== previousHash) return false;
      if (typeof record.hash !== 'string' || !/^[a-f0-9]{64}$/.test(record.hash)) return false;

      const event = normalizeEvent(record.event);
      if (hashRecord(record.sequence, record.previousHash, event) !== record.hash) return false;
      previousHash = record.hash;
      return true;
    });
  } catch {
    return false;
  }
}

export function createAuditLog(initialRecords = null) {
  const records = [];
  if (Array.isArray(initialRecords) && initialRecords.length > 0) {
    // import verified chain if provided
    if (verifyChain(initialRecords)) {
      for (const rec of initialRecords) records.push(copyRecord(rec));
    } else {
      // fallback to appending events
      for (const rec of initialRecords) {
        try { records.push(copyRecord(rec)); } catch {}
      }
    }
  }

  return {
    append(event) {
      const normalizedEvent = normalizeEvent(event);
      const sequence = records.length + 1;
      const previousHash = records.at(-1)?.hash ?? GENESIS_HASH;
      const record = {
        sequence,
        previousHash,
        hash: hashRecord(sequence, previousHash, normalizedEvent),
        event: normalizedEvent
      };
      records.push(record);
      return copyRecord(record);
    },

    query({ correlationId } = {}) {
      return records
        .filter(({ event }) => correlationId === undefined || event.correlationId === correlationId)
        .map(copyRecord);
    },

    export() {
      return records.map(copyRecord);
    },

    verifyIntegrity(chain = records) {
      return verifyChain(chain);
    },

    importRecords(chain) {
      if (!Array.isArray(chain)) throw new TypeError('chain must be array');
      if (!verifyChain(chain)) throw new Error('audit chain integrity check failed');
      records.length = 0;
      for (const rec of chain) records.push(copyRecord(rec));
    },

    clear() {
      records.length = 0;
    }
  };
}
