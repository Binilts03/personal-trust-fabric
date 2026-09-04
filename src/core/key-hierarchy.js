import { randomBytes, createCipheriv, createDecipheriv, hkdfSync } from 'node:crypto';

const NAMESPACE_SALT = Buffer.from('ptf-namespace-v1', 'utf8');
const WRAP_ALG = 'aes-256-gcm';
const IV_LENGTH = 12;

function assertBuffer32(buf, name) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) {
    throw new TypeError(`${name} must be a 32-byte Buffer`);
  }
}

function toBuffer(ab) {
  if (Buffer.isBuffer(ab)) return Buffer.from(ab);
  // hkdfSync returns ArrayBuffer
  return Buffer.from(ab);
}

export class KeyHierarchy {
  constructor(masterKey) {
    if (masterKey !== undefined) {
      assertBuffer32(masterKey, 'masterKey');
      this.masterKey = Buffer.from(masterKey);
    } else {
      this.masterKey = randomBytes(32);
    }
    this.namespaceVersions = new Map();
    this.namespaceCache = new Map();
  }

  static generateMasterKey() {
    return randomBytes(32);
  }

  static zeroize(buffer) {
    if (Buffer.isBuffer(buffer)) {
      buffer.fill(0);
    }
  }

  deriveNamespaceKey(namespace) {
    if (typeof namespace !== 'string' || namespace.length === 0) {
      throw new TypeError('namespace must be non-empty string');
    }
    const version = this.namespaceVersions.get(namespace) ?? 0;
    const info = version === 0 ? namespace : `${namespace}:v${version}`;
    // Use hkdfSync with fixed salt and info
    const derived = hkdfSync('sha256', this.masterKey, NAMESPACE_SALT, Buffer.from(info, 'utf8'), 32);
    const key = toBuffer(derived);
    // Cache
    this.namespaceCache.set(namespace, Buffer.from(key));
    return Buffer.from(key);
  }

  getNamespaceKey(namespace) {
    const cached = this.namespaceCache.get(namespace);
    if (cached) return Buffer.from(cached);
    return this.deriveNamespaceKey(namespace);
  }

  rotateNamespaceKey(namespace) {
    if (typeof namespace !== 'string' || namespace.length === 0) {
      throw new TypeError('namespace must be non-empty string');
    }
    const current = this.namespaceVersions.get(namespace) ?? 0;
    const next = current + 1;
    this.namespaceVersions.set(namespace, next);
    this.namespaceCache.delete(namespace);
    const newKey = this.deriveNamespaceKey(namespace);
    return { namespace, version: next, key: Buffer.from(newKey) };
  }

  rotateAll(namespaces) {
    const result = [];
    for (const ns of namespaces) {
      result.push(this.rotateNamespaceKey(ns));
    }
    return result;
  }

  wrapKey(keyToWrap, wrappingKey) {
    assertBuffer32(keyToWrap, 'keyToWrap');
    assertBuffer32(wrappingKey, 'wrappingKey');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(WRAP_ALG, wrappingKey, iv);
    const ciphertext = Buffer.concat([cipher.update(keyToWrap), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      authTag: authTag.toString('base64url'),
      alg: WRAP_ALG
    };
  }

  unwrapKey(wrapped, wrappingKey) {
    if (!wrapped || typeof wrapped !== 'object') throw new TypeError('wrapped key must be object');
    if (typeof wrapped.iv !== 'string' || typeof wrapped.ciphertext !== 'string' || typeof wrapped.authTag !== 'string') {
      throw new TypeError('wrapped key is malformed');
    }
    assertBuffer32(wrappingKey, 'wrappingKey');
    const iv = Buffer.from(wrapped.iv, 'base64url');
    const ciphertext = Buffer.from(wrapped.ciphertext, 'base64url');
    const authTag = Buffer.from(wrapped.authTag, 'base64url');
    const decipher = createDecipheriv(WRAP_ALG, wrappingKey, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length !== 32) {
      throw new Error('unwrapped key has invalid length');
    }
    return plaintext;
  }

  generateDataKey() {
    return randomBytes(32);
  }

  exportMasterKey() {
    // Return copy; caller must handle secrecy
    return Buffer.from(this.masterKey);
  }

  // Utility to derive directly without instance
  static derive(namespace, masterKey) {
    const hk = new KeyHierarchy(masterKey);
    return hk.deriveNamespaceKey(namespace);
  }
}

// Convenience standalone functions for dependency-free usage
export function generateMasterKey() {
  return KeyHierarchy.generateMasterKey();
}

export function deriveNamespaceKey(masterKey, namespace) {
  const hk = new KeyHierarchy(masterKey);
  return hk.deriveNamespaceKey(namespace);
}

export function wrapKey(keyToWrap, wrappingKey) {
  const hk = new KeyHierarchy();
  return hk.wrapKey(keyToWrap, wrappingKey);
}

export function unwrapKey(wrapped, wrappingKey) {
  const hk = new KeyHierarchy();
  return hk.unwrapKey(wrapped, wrappingKey);
}
