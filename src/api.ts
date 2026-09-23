/**
 * Curated public entry (ticket 09, ADR-0011). EXPLICIT NAMED re-exports only:
 * the Authority engine, the human-approval presenter, agent-view shaping,
 * receipt-bound execution, the recipient registry, the Personal State vault
 * (`store/vault.js`), the general agent contract (`profiles/data.js`), and
 * the protected provider seam (`adapters/providers.js`).
 *
 * INTERNAL BY PACKAGING (still importable via deep paths, never from here):
 * - capability envelope (`core/capability.js`, `core/types.js`:
 *   Capabilities, SealedCapability, CapabilityPayload) — local-only receipt
 *   machinery, never wire (ADR-0009);
 * - canonical/crypto machinery (`core/canonical.js`, `core/crypto.js`:
 *   canonicalize, sha256Hex, termsDigestOf, key functions) — bind operations
 *   with `digestForOperation`, not raw digests (never the `Fake*` executors —
 *   except the provider fakes below, which ship as the host reference
 *   implementation: canned refs, call logs, move nothing);
 * - disclosure engine (`core/disclose.js`), policy predicates
 *   (`core/policy.js`), remaining host stores (`store/files.js`,
 *   `store/keystore.js`, `store/challenges.js`, `store/anchor.js`) and
 *   evidence adapters — translators live on subpaths (`./authzen`,
 *   `./oauth`, `./profiles/payment`, `./profiles/data`, `./providers`,
 *   `./vault`) or deep paths.
 *
 * When unsure, a symbol stays OUT of this file (narrower is the point).
 * Tests keep importing the full barrel (`../src/index.js`); hosts needing
 * internals import deep paths or use the bins.
 */

export {
  Authority,
  paymentBounds,
  claimsSubset,
  digestForOperation,
} from "./core/authority.js";
export type {
  AuthorityRequest,
  AuthorityOperation,
  VerifiedIdentity,
  VerifiedExternalBinding,
  ActorSelector,
  AttributeBound,
  StandingGrant,
  OneTimeApproval,
  PolicyConstraint,
  AuthorityDecision,
} from "./core/authority.js";

export {
  renderProposal,
  parseDecision,
  sanitizeField,
} from "./core/approve.js";
export type { ProposalView } from "./core/approve.js";

export { assembleCapsule, renderAgentView } from "./core/persona.js";
export type {
  PersonalState,
  PersonaCapsule,
  AgentView,
} from "./core/persona.js";

export { executeAndReceipt, requireBoundOperation } from "./core/execute.js";
export type {
  Receipt,
  ExecutionReceipt,
  PaymentInstruction,
  PaymentExecutor,
} from "./core/execute.js";

export { signAndReceipt } from "./core/signing.js";
export type {
  SignReceipt,
  SignInstruction,
  SigningExecutor,
} from "./core/signing.js";

export { RecipientRegistry } from "./core/identity.js";

export { backupStore, restoreStore } from "./store/backup.js";
export type { BackupSummary, RestoreSummary } from "./store/backup.js";

export {
  VaultStore,
  saveVault,
  loadVault,
  putRecord,
  readForPurpose,
  useCredential,
  createVaultDek,
  ensureVaultDek,
  migrateVault,
  rotateVaultDek,
  resolveVaultDek,
  readVaultKid,
  vaultDekFingerprint,
  VAULT_DEK_ALIAS,
  VAULT_DEK_NEXT_ALIAS,
} from "./store/vault.js";
export type {
  VaultSensitivity,
  VaultRecord,
  VaultRecordInput,
  VaultSnapshot,
  VaultReadRequest,
  SecretInstruction,
  SecretUseResult,
  SecretUseOptions,
} from "./store/vault.js";
export { parseSensitivity } from "./store/vault.js";

export { requestData, requestExecution } from "./profiles/data.js";
export type {
  DataRequest,
  ActionRequest,
  AgentProposal,
} from "./profiles/data.js";

export {
  FakeProvider,
  makeFakeProviders,
  providerAsExecutor,
  executeViaProvider,
  executeActionViaProvider,
  executeWithCredential,
  executeProtectedAction,
} from "./adapters/providers.js";
export type {
  ProviderKind,
  ProviderRequest,
  ProviderSubmission,
  ProtectedProvider,
} from "./adapters/providers.js";
