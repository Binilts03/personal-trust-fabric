/**
 * Personal State vault compatibility facade.
 *
 * Record lifecycle lives in vault-store.ts, the protected-use surface
 * (purpose-scoped disclosure and secret use) in vault-protected-use.ts, and
 * encrypted persistence and key lifecycle in vault-persistence.ts. Existing
 * import paths stay stable through these re-exports.
 */
export * from "./vault-store.js";
export * from "./vault-protected-use.js";
export * from "./vault-types.js";
export * from "./vault-persistence.js";
