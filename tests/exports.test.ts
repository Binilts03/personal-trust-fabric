import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

/**
 * Packaged export surface: what an npm consumer can actually import through
 * the `exports` map (not the `src/index.ts` barrel the other suites use).
 * `createRequire` keeps this untyped on purpose — the assertion is that the
 * names resolve to callable values in the BUILT package (tests run after
 * `npm run build`), so drift between the barrel and the shippable surface
 * fails here instead of in a user's project.
 */
const require = createRequire(import.meta.url);

function packaged(name: string): Record<string, unknown> {
  return require(name) as Record<string, unknown>;
}

function callable(
  mod: Record<string, unknown>,
  exportName: string,
  from: string
): void {
  assert.equal(
    typeof mod[exportName],
    "function",
    `${exportName} callable from ${from}`
  );
}

describe("packaged export surface (npm-consumer view)", () => {
  it("curated root exposes the engine, vault, contract, and ops", () => {
    const api = packaged("personal-trust-fabric");
    for (const name of [
      "Authority",
      "executeAndReceipt",
      "VaultStore",
      "requestData",
      "requestExecution",
      "executeProtectedAction",
      "backupStore",
      "restoreStore",
      "renderProposal",
    ]) {
      callable(api, name, "personal-trust-fabric");
    }
  });

  it("subpaths resolve with callable entries", () => {
    const vault = packaged("personal-trust-fabric/vault");
    callable(vault, "VaultStore", "personal-trust-fabric/vault");
    callable(vault, "readForPurpose", "personal-trust-fabric/vault");

    const providers = packaged("personal-trust-fabric/providers");
    callable(
      providers,
      "executeActionViaProvider",
      "personal-trust-fabric/providers"
    );
    callable(providers, "makeFakeProviders", "personal-trust-fabric/providers");

    const data = packaged("personal-trust-fabric/profiles/data");
    callable(data, "requestData", "personal-trust-fabric/profiles/data");

    const authzen = packaged("personal-trust-fabric/authzen");
    callable(authzen, "evaluateAuthZen", "personal-trust-fabric/authzen");

    const oauth = packaged("personal-trust-fabric/oauth");
    callable(oauth, "delegate", "personal-trust-fabric/oauth");

    const payment = packaged("personal-trust-fabric/profiles/payment");
    callable(
      payment,
      "recipientBounds",
      "personal-trust-fabric/profiles/payment"
    );
  });
});
