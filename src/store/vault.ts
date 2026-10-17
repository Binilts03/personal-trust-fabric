/**
 * Personal State vault compatibility facade.
 *
 * Record/disclosure behavior lives in vault-store.ts; encrypted persistence
 * and key lifecycle live in vault-persistence.ts. Existing import paths stay
 * stable through these re-exports.
 */
export * from "./vault-store.js";
export * from "./vault-persistence.js";
