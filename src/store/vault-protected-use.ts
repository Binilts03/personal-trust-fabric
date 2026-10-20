import type { Presentation } from "../core/disclose.js";
import type { VaultStore } from "./vault-store.js";
import type { SecretUseOptions, VaultReadRequest } from "./vault-types.js";

/**
 * The protected-use half of the vault surface: purpose-scoped disclosure
 * and the sole in-host path for `secret` records. The record lifecycle
 * lives in `vault-store.ts`; both are re-exported by the `vault.ts` facade so
 * the published import paths stay stable.
 */

/**
 * Purpose-scoped read (module entry; delegates to {@link VaultStore.disclose},
 * the only read path besides {@link VaultStore.useSecret}).
 */
export function readForPurpose(
  vault: VaultStore,
  req: VaultReadRequest
): Presentation {
  return vault.disclose(req);
}

/**
 * Sole in-host path for `secret` records (module entry; delegates to
 * {@link VaultStore.useSecret}). Returns only the callback's receipt/names.
 */
export async function useCredential(
  vault: VaultStore,
  opts: SecretUseOptions
): Promise<{
  readonly recordId: string;
  readonly type: string;
  readonly purpose: string;
  readonly receipt: string;
  readonly names?: readonly string[];
}> {
  return vault.useSecret(opts);
}
