import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  Capabilities,
  digestForOperation,
  executeActionViaProvider,
  generateEd25519Keypair,
  leafCidHex,
  makeFakeProviders,
  recipientBounds,
  signBytes,
  travelBounds,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:principal";
const A = "did:test:agent";
const T = "did:test:travel-provider";

function demand(overrides: Record<string, unknown> = {}) {
  return {
    action: { name: "/travel/book" as const },
    resource: { type: "flight", id: "flight:BLR-DEL-0920" },
    context: {
      origin: "BLR",
      destination: "DEL",
      class: "economy",
      travelers: 2,
      fareMax: 50000,
      currency: "INR",
      departDate: "2026-10-01",
      recipient: T,
      ...overrides,
    },
    purpose: "team offsite",
  };
}

function ingress() {
  return {
    id: A,
    principal: P,
    source: "local-registration" as const,
    proofRef: "travel-test",
  };
}

describe("travel profile as second domain (M7)", () => {
  it("builds route/class/traveler/fare/date bounds; bad input throws", () => {
    const bounds = travelBounds({
      origin: "BLR",
      destination: "DEL",
      class: "economy",
      travelersMax: 2,
      fareMax: 50000,
      currency: "INR",
      departDate: "2026-10-01",
    });
    assert.deepEqual(bounds, [
      { path: ".context.origin", op: "==", value: "BLR" },
      { path: ".context.destination", op: "==", value: "DEL" },
      { path: ".context.class", op: "==", value: "economy" },
      { path: ".context.travelers", op: "<=", value: 2 },
      { path: ".context.fareMax", op: "<=", value: 50000 },
      { path: ".context.currency", op: "==", value: "INR" },
      { path: ".context.departDate", op: "==", value: "2026-10-01" },
    ]);
    assert.throws(() => travelBounds({ origin: "" }));
    assert.throws(() => travelBounds({ travelersMax: 0 }));
    assert.throws(() => travelBounds({ fareMax: -1, currency: "INR" }));
    assert.throws(() => travelBounds({ fareMax: 50000 }));
  });

  it("standing grant allows the booked trip and denies mutations", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-travel",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/travel/book" },
      bounds: [
        ...travelBounds({
          origin: "BLR",
          destination: "DEL",
          class: "economy",
          travelersMax: 2,
          fareMax: 50000,
          currency: "INR",
          departDate: "2026-10-01",
        }),
        ...recipientBounds([T]),
      ],
      exp: NOW + 86400,
      maxUses: 1,
    });
    assert.equal(auth.evaluate(demand(), ingress()).allow, true);
    for (const mutated of [
      demand({ destination: "BOM" }),
      demand({ class: "business" }),
      demand({ travelers: 3 }),
      demand({ fareMax: 60000 }),
      demand({ departDate: "2026-10-02" }),
      demand({ recipient: "did:test:attacker" }),
    ]) {
      assert.equal(auth.evaluate(mutated, ingress()).allow, false);
    }
  });

  it("executes /travel/book via the provider seam with a domain-neutral receipt", async () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const provider = generateEd25519Keypair();
    const keys = new Map([
      [P, principal.publicKeyRaw],
      [A, agent.publicKeyRaw],
      [T, provider.publicKeyRaw],
    ]);
    const args = {
      origin: "BLR",
      destination: "DEL",
      class: "economy",
      travelers: 2,
      fareMax: 50000,
      currency: "INR",
      departDate: "2026-10-01",
    };
    const digest = digestForOperation({
      principal: P,
      actor: A,
      action: { name: "/travel/book" as const },
      resource: { type: "flight", id: "flight:BLR-DEL-0920" },
      context: { ...args, recipient: T },
      purpose: "team offsite",
    });
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const cap = caps.issue(
      null,
      {
        iss: P,
        aud: A,
        sub: P,
        cmd: "/travel/book",
        pol: [],
        purpose: "team offsite",
        resource: "flight:BLR-DEL-0920",
        recipient: T,
        exp: NOW + 300,
        maxUses: 1,
        termsDigest: digest,
      },
      principal.privateKey
    );
    const cid = leafCidHex(cap);
    const redeemed = caps.redeem(
      [cap],
      {
        cmd: "/travel/book",
        args,
        recipient: T,
        resource: "flight:BLR-DEL-0920",
        purpose: "team offsite",
        termsDigest: digest,
      },
      {
        proof: {
          key: provider.publicKeyRaw,
          sig: signBytes(
            provider.privateKey,
            new Uint8Array(Buffer.from(cid, "hex"))
          ),
        },
      }
    );
    assert.equal(redeemed.ok, true);
    if (!redeemed.ok) throw new Error("redeem must succeed");

    const fakes = makeFakeProviders({ nowSec: () => NOW });
    const receipt = await executeActionViaProvider(
      fakes.travel,
      {
        capabilityId: cid,
        termsDigest: digest,
        action: "/travel/book",
        recipient: T,
        resource: "flight:BLR-DEL-0920",
        purpose: "team offsite",
        context: { ...args },
      },
      redeemed,
      NOW
    );
    assert.ok(receipt.transaction.startsWith("fake-travel-"));
    // Domain-neutral receipt: no payment-shaped fields.
    assert.deepEqual(Object.keys(receipt).sort(), [
      "at",
      "capabilityId",
      "purpose",
      "receiptId",
      "recipient",
      "resource",
      "termsDigest",
      "transaction",
    ]);

    // Mutated class fails closed; telemetry rides in metadata.
    await assert.rejects(
      () =>
        executeActionViaProvider(
          fakes.travel,
          {
            capabilityId: cid,
            termsDigest: digest,
            action: "/travel/book",
            recipient: T,
            resource: "flight:BLR-DEL-0920",
            purpose: "team offsite",
            context: { ...args, class: "first" },
          },
          redeemed,
          NOW
        ),
      /context differs from authorized terms/
    );
    const meta = await executeActionViaProvider(
      fakes.travel,
      {
        capabilityId: cid,
        termsDigest: digest,
        action: "/travel/book",
        recipient: T,
        resource: "flight:BLR-DEL-0920",
        purpose: "team offsite",
        context: { ...args },
        metadata: { traceId: "trace-travel-1" },
      },
      { ...redeemed, redemptionId: "rdm-travel-meta" },
      NOW
    );
    assert.ok(meta.transaction.startsWith("fake-travel-"));
  });
});
