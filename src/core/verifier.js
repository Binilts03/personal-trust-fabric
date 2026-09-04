import { createHmac, timingSafeEqual } from 'node:crypto';

// Independent verifier - does NOT hardcode secrets; fetches protected keys via ProtectedStore
// and verifies recipient auth via in-memory recipient secrets map.
// Uses node:crypto only.

export function createVerifier({ protectedStore, recipientSecrets }) {
  if (!protectedStore || typeof protectedStore.getProtectedRecord !== 'function') {
    throw new TypeError('protectedStore with getProtectedRecord is required');
  }
  if (!(recipientSecrets instanceof Map)) {
    throw new TypeError('recipientSecrets Map is required');
  }

  function safeEqualHex(aHex, bHex) {
    try {
      const a = Buffer.from(aHex, 'hex');
      const b = Buffer.from(bHex, 'hex');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  function verifyRecipientAuth({ reference, recipientId, recipientAuthToken }) {
    if (typeof reference !== 'string' || typeof recipientId !== 'string' || typeof recipientAuthToken !== 'string') return false;
    const secret = recipientSecrets.get(recipientId);
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(reference).digest('hex');
    return safeEqualHex(expected, recipientAuthToken);
  }

  function generateRecipientAuthToken(reference, recipientId) {
    const secret = recipientSecrets.get(recipientId);
    if (!secret) throw new Error('unknown recipient');
    return createHmac('sha256', secret).update(reference).digest('hex');
  }

  function verifyCredentialProof({ recipientId, purpose, transactionId, proof }) {
    if (typeof proof !== 'string' || typeof recipientId !== 'string' || typeof purpose !== 'string' || typeof transactionId !== 'string') return false;
    let key;
    try {
      key = protectedStore.getProtectedRecord({ handle: 'credential:membership_key', auth: { principalId: 'verifier', authenticated: true } });
    } catch {
      return false;
    }
    const expected = createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}`).digest('hex');
    return safeEqualHex(expected, proof);
  }

  function generateCredentialProof({ recipientId, purpose, transactionId }) {
    const key = protectedStore.getProtectedRecord({ handle: 'credential:membership_key', auth: { principalId: 'provider', authenticated: true } });
    return createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}`).digest('hex');
  }

  function verifyPaymentToken({ transactionId, amountMinor, recipientId, token }) {
    if (typeof token !== 'string' || typeof transactionId !== 'string' || typeof recipientId !== 'string' || !Number.isSafeInteger(amountMinor)) return false;
    let key;
    try {
      key = protectedStore.getProtectedRecord({ handle: 'payment:instrument_key', auth: { principalId: 'verifier', authenticated: true } });
    } catch {
      return false;
    }
    const expected = createHmac('sha256', key).update(`${transactionId}|${amountMinor}|${recipientId}`).digest('hex');
    return safeEqualHex(expected, token);
  }

  function generatePaymentToken({ transactionId, amountMinor, recipientId }) {
    const key = protectedStore.getProtectedRecord({ handle: 'payment:instrument_key', auth: { principalId: 'provider', authenticated: true } });
    return createHmac('sha256', key).update(`${transactionId}|${amountMinor}|${recipientId}`).digest('hex');
  }

  function verifySigningProof({ recipientId, purpose, transactionId, proof }) {
    if (typeof proof !== 'string' || typeof recipientId !== 'string' || typeof purpose !== 'string' || typeof transactionId !== 'string') return false;
    let key;
    try {
      key = protectedStore.getProtectedRecord({ handle: 'credential:signing_key', auth: { principalId: 'verifier', authenticated: true } });
    } catch {
      return false;
    }
    const expected = createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}`).digest('hex');
    return safeEqualHex(expected, proof);
  }

  function generateSigningProof({ recipientId, purpose, transactionId }) {
    const key = protectedStore.getProtectedRecord({ handle: 'credential:signing_key', auth: { principalId: 'provider', authenticated: true } });
    return createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}`).digest('hex');
  }

  function verifyActionProof({ recipientId, purpose, transactionId, action, proof }) {
    if (typeof proof !== 'string' || typeof recipientId !== 'string' || typeof purpose !== 'string' || typeof transactionId !== 'string' || typeof action !== 'string') return false;
    let key;
    try {
      key = protectedStore.getProtectedRecord({ handle: 'payment:action_key', auth: { principalId: 'verifier', authenticated: true } });
    } catch {
      return false;
    }
    const expected = createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}|${action}`).digest('hex');
    return safeEqualHex(expected, proof);
  }

  function generateActionProof({ recipientId, purpose, transactionId, action }) {
    const key = protectedStore.getProtectedRecord({ handle: 'payment:action_key', auth: { principalId: 'provider', authenticated: true } });
    return createHmac('sha256', key).update(`${recipientId}|${purpose}|${transactionId}|${action}`).digest('hex');
  }

  return {
    verifyRecipientAuth,
    generateRecipientAuthToken,
    verifyCredentialProof,
    generateCredentialProof,
    verifyPaymentToken,
    generatePaymentToken,
    verifySigningProof,
    generateSigningProof,
    verifyActionProof,
    generateActionProof
  };
}
