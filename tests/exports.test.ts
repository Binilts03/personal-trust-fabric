import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import type * as Ptf from "../src/index.js";

/**
 * Packaged export surface: what an npm consumer can actually import through
 * the `exports` map (not the `src/index.ts` barrel the other suites use).
 * `createRequire` keeps the runtime access untyped on purpose — the
 * assertion is that the names resolve to callable values in the BUILT
 * package (tests run after `npm run build`), so drift between the barrel and
 * the shippable surface fails here instead of in a user's project.
 *
 * The TYPES come from the sanctioned public test seam (`../src/index.js`) so
 * the compiler can check the calls; the VALUES always come from the package
 * specifier, so a missing subpath fails here rather than at type-check time.
 */
const require = createRequire(import.meta.url);

function packaged<T = Record<string, unknown>>(name: string): T {
  return require(name) as T;
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

/** The shape the `./capabilities` subpath must present to a consumer. */
interface CapabilitiesSurface {
  readonly Capabilities: typeof Ptf.Capabilities;
  readonly MapRevocationStore: typeof Ptf.MapRevocationStore;
  readonly MapUseLedger: typeof Ptf.MapUseLedger;
  readonly leafCidHex: typeof Ptf.leafCidHex;
  readonly generateEd25519Keypair: typeof Ptf.generateEd25519Keypair;
  readonly signBytes: typeof Ptf.signBytes;
  readonly rawPublicKey: typeof Ptf.rawPublicKey;
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
    // ADR-0011's line is structural: the curated root is what `src/api.ts`
    // re-exports. ADR-0028 put the envelope on `./capabilities` instead, so
    // adding it to the root must fail this test.
    assert.equal(
      (api as unknown as Record<string, unknown>).Capabilities,
      undefined,
      "Capabilities must stay off the curated root (ADR-0011 / ADR-0028)"
    );
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

    const http = packaged("personal-trust-fabric/adapters/http");
    callable(http, "createHttpProvider", "personal-trust-fabric/adapters/http");
    callable(
      http,
      "canonicalRequestBody",
      "personal-trust-fabric/adapters/http"
    );

    const x402 = packaged("personal-trust-fabric/adapters/x402");
    callable(x402, "createX402Provider", "personal-trust-fabric/adapters/x402");

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

    const hostkit = packaged("personal-trust-fabric/hostkit");
    callable(hostkit, "createEffectBoundary", "personal-trust-fabric/hostkit");
    callable(hostkit, "createProtectedEffect", "personal-trust-fabric/hostkit");
    callable(
      hostkit,
      "createHostRedemptionChallenge",
      "personal-trust-fabric/hostkit"
    );
    callable(hostkit, "runHostConformance", "personal-trust-fabric/hostkit");
    callable(
      hostkit,
      "privacyForHostOperation",
      "personal-trust-fabric/hostkit"
    );
  });

  it("the capability subpath exposes the redemption producer the root's executors need", () => {
    const capabilities = packaged("personal-trust-fabric/capabilities");
    for (const name of [
      "Capabilities",
      "MapRevocationStore",
      "MapUseLedger",
      "leafCidHex",
      "generateEd25519Keypair",
      "signBytes",
      "rawPublicKey",
    ]) {
      callable(capabilities, name, "personal-trust-fabric/capabilities");
    }
  });

  it("the capability subpath is scoped: deep imports stay refused", () => {
    // The abuse case for ADR-0028: adding a subpath must not open the
    // package to arbitrary deep imports. Only the declared subpaths resolve.
    assert.throws(
      () => require("personal-trust-fabric/dist/src/core/capability.js"),
      /ERR_PACKAGE_PATH_NOT_EXPORTED/
    );
    assert.throws(
      () => require("personal-trust-fabric/dist/src/store/vault-store.js"),
      /ERR_PACKAGE_PATH_NOT_EXPORTED/
    );
    // The internal barrel is not a published entry point either.
    assert.throws(
      () => require("personal-trust-fabric/dist/src/index.js"),
      /ERR_PACKAGE_PATH_NOT_EXPORTED/
    );
  });

  it("a consumer can drive the payment path through the published surface only", async () => {
    // The end-to-end journey a host needs, using ONLY package specifiers:
    // grant -> authority decision -> digest -> capability -> redeem ->
    // execute -> receipt. Every step resolves through the `exports` map.
    const api = packaged<typeof Ptf>("personal-trust-fabric");
    const capabilities = packaged<CapabilitiesSurface>(
      "personal-trust-fabric/capabilities"
    );

    const NOW = 1_800_000_000;
    const PRINCIPAL = "principal-1";
    const ACTOR = "agent-1";
    const RECIPIENT = "recipient-1";
    const RESOURCE = "invoice:inv-1";
    const PURPOSE = "personal";

    const principal = capabilities.generateEd25519Keypair();
    const recipient = capabilities.generateEd25519Keypair();
    const keys = new Map<string, Uint8Array>([
      [PRINCIPAL, principal.publicKeyRaw],
      [RECIPIENT, recipient.publicKeyRaw],
    ]);

    const authority = new api.Authority({ nowSec: () => NOW });
    authority.addGrant({
      id: "g1",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: ACTOR },
      action: { name: "/pay" },
      bounds: api.paymentBounds({ amountMax: 2000, currency: "INR" }),
      exp: NOW + 600,
    });
    const ingress = {
      id: ACTOR,
      principal: PRINCIPAL,
      source: "local-registration" as const,
      proofRef: "consumer-test",
    };
    const operation = {
      action: { name: "/pay" as const },
      resource: { type: "invoice", id: "inv-1" },
      context: { amount: 100, currency: "INR" },
      purpose: PURPOSE,
    };
    const decision = authority.evaluate(operation, ingress, { nowSec: NOW });
    assert.equal(decision.allow, true);

    const digest = api.digestForOperation({
      principal: PRINCIPAL,
      actor: ACTOR,
      action: operation.action,
      resource: operation.resource,
      context: operation.context,
      purpose: PURPOSE,
    });

    const caps = new capabilities.Capabilities({
      resolveKey: (id: string) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: PRINCIPAL,
        aud: ACTOR,
        sub: PRINCIPAL,
        cmd: "/pay",
        pol: [["<=", ".amount", 100]],
        purpose: PURPOSE,
        resource: RESOURCE,
        recipient: RECIPIENT,
        amountMax: 100,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );

    const demand = {
      cmd: "/pay" as const,
      args: { amount: 100, currency: "INR" },
      recipient: RECIPIENT,
      resource: RESOURCE,
      purpose: PURPOSE,
      termsDigest: digest,
    };
    const cid = capabilities.leafCidHex(cap);
    const redemption = caps.redeem([cap], demand, {
      proof: {
        key: recipient.publicKeyRaw,
        sig: capabilities.signBytes(
          recipient.privateKey,
          new Uint8Array(Buffer.from(cid, "hex"))
        ),
      },
    });
    assert.equal(redemption.ok, true);

    // A consumer writes its own executor: the root ships no Fake* executor.
    const executor: Ptf.PaymentExecutor = {
      async executePayment(instruction) {
        return {
          ok: true as const,
          transaction: `tx-${instruction.recipient}`,
        };
      },
    };
    const receipt = await api.executeAndReceipt(
      executor,
      {
        capabilityId: cid,
        recipient: RECIPIENT,
        amount: 100,
        currency: "INR",
        resource: RESOURCE,
        purpose: PURPOSE,
        termsDigest: digest,
      },
      redemption,
      NOW
    );
    assert.equal(receipt.recipient, RECIPIENT);
    assert.equal(receipt.amount, 100);
    assert.equal(receipt.currency, "INR");
    assert.equal(receipt.termsDigest, digest);
    assert.equal(receipt.transaction, `tx-${RECIPIENT}`);
  });
});
