import type { KeyObject } from "node:crypto";
import type { Authority, VerifiedIdentity } from "../core/authority.js";
import type { FileAuditLog } from "./files.js";

/**
 * The vault's protected-use request/result types. They live in their own
 * module so the record lifecycle (`vault-store.ts`) and the protected-use
 * surface (`vault-protected-use.ts`) stay independently readable; the
 * `vault.ts` facade re-exports them.
 */

export interface VaultReadRequest {
  readonly ingress: VerifiedIdentity;
  readonly purpose: string;
  readonly requested: readonly string[];
  readonly verifier: string;
  readonly nonce: string;
  readonly nowSec: number;
  readonly authority: Authority;
  /**
   * Resource coordinates of the PROPOSED operation. Callers must pass the
   * exact resource the demand was proposed under (ADR-0018: the vault
   * evaluates the identical canonical operation, never a rewritten one).
   */
  readonly resource: { readonly type: string; readonly id: string };
  /** Host-held holder signing key. holder.id must equal the ingress principal. */
  readonly holder: { readonly id: string; readonly privateKey: KeyObject };
  readonly audit?: FileAuditLog;
}

export interface SecretInstruction {
  readonly recordId: string;
  readonly type: string;
  readonly purpose: string;
  readonly owner: string;
  /** Secret value, visible to the in-host callback only — never returned. */
  readonly value: unknown;
}

export interface SecretUseResult {
  readonly receipt: string;
  readonly names?: readonly string[];
}

export interface SecretUseOptions {
  readonly ingress: VerifiedIdentity;
  readonly recordId: string;
  readonly purpose: string;
  readonly authority: Authority;
  readonly nowSec: number;
  readonly use: (instr: SecretInstruction) => Promise<SecretUseResult>;
  readonly audit?: FileAuditLog;
  /**
   * Burn-before-effect hook (ADR-0018): runs after authority is consumed
   * but BEFORE the secret reaches the callback. Hosts persist authority
   * state here, so a crash between consumption and the external effect
   * burns a use instead of resurrecting it. Without this hook, callers
   * must persist before invoking — persisting after success is too late.
   */
  readonly onConsumed?: (authority: Authority) => void | Promise<void>;
}
