import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Authority,
  Capabilities,
  claimsSubset,
  digestForOperation,
  generateEd25519Keypair,
  leafCidHex,
  paymentBounds,
  signBytes,
} from "../src/index.js";
import type {
  ActorSelector,
  AttributeBound,
  AuthorityRequest,
} from "../src/index.js";

const NOW = 1_700_000_000;
const PRINCIPAL = "did:test:principal";
const AGENT = "did:test:agent";
const OTHER_AGENT = "did:test:other-agent";
const ATTACKER = "did:attacker:anything";
const MERCHANT = "did:test:merchant";

function op(amount = 1790) {
  return {
    principal: PRINCIPAL,
    actor: AGENT,
    action: { name: "/pay" as const },
    resource: { type: "invoice", id: "invoice:inv_8472" },
    context: { amount, currency: "INR", recipient: MERCHANT },
    purpose: "pay invoice",
  };
}

function honest(amount = 1790): AuthorityRequest {
  const operation = op(amount);
  return { ...operation, termsDigest: digestForOperation(operation) };
}

interface GrantExtra {
  readonly actor?: ActorSelector;
  readonly action?: { readonly name: `/${string}` };
  readonly purpose?: string;
  readonly resource?: { readonly type?: string; readonly id?: string };
  readonly bounds?: readonly AttributeBound[];
  readonly exp?: number;
  readonly maxUses?: number;
}

function payGrant(id: string, extra: GrantExtra = {}) {
  return {
    id,
    principal: PRINCIPAL,
    actor: { kind: "exact", id: AGENT } as const,
    action: { name: "/pay" as const },
    bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
    exp: NOW + 3600,
    ...(extra.actor !== undefined ? { actor: extra.actor } : {}),
    ...(extra.action !== undefined ? { action: extra.action } : {}),
    ...(extra.purpose !== undefined ? { purpose: extra.purpose } : {}),
    ...(extra.resource !== undefined ? { resource: extra.resource } : {}),
    ...(extra.bounds !== undefined ? { bounds: extra.bounds } : {}),
    ...(extra.exp !== undefined ? { exp: extra.exp } : {}),
    ...(extra.maxUses !== undefined ? { maxUses: extra.maxUses } : {}),
  };
}

describe("policy authority with digest-bound approval (ptf-v01/01, neutral 0010)", () => {
  it("allows under a covering grant with citation; policy alone never allows", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addPolicy({
      id: "business-hours",
      bounds: paymentBounds({ amountMax: 100_000, currency: "INR" }),
    });
    const lonely = auth.evaluate(honest());
    assert.equal(lonely.allow, false);
    if (!lonely.allow) assert.equal(lonely.reason, "no-authority");

    auth.addGrant(
      payGrant("grocery-weekly", {
        purpose: "pay invoice",
        resource: { type: "invoice", id: "invoice:inv_8472" },
      })
    );
    const ok = auth.evaluate(honest());
    assert.equal(ok.allow, true);
    if (ok.allow) {
      assert.equal(ok.citations[0]?.authorityId, "grocery-weekly");
      assert.equal(ok.citations[0]?.kind, "grant");
    }
  });

  it("narrowing policy overrides the grant; compliant demands still pass", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant(payGrant("grocery-weekly"));
    auth.addPolicy({
      id: "frugal-cap",
      actionName: "/pay",
      bounds: paymentBounds({ amountMax: 1000, currency: "INR" }),
    });

    const over = auth.evaluate(honest(1500));
    assert.equal(over.allow, false);
    if (!over.allow) {
      assert.equal(over.reason, "forbidden");
      assert.equal(over.policyId, "frugal-cap");
    }
    const under = auth.evaluate(honest(500));
    assert.equal(under.allow, true);
  });

  it("one-time approval binds exact terms; mutations fail closed with terms reason", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const operation = op(1790);
    const approval = auth.createApproval({
      id: "appr-1",
      principal: PRINCIPAL,
      actor: AGENT,
      action: { name: "/pay" },
      purpose: "pay invoice",
      resource: { type: "invoice", id: "invoice:inv_8472" },
      context: { amount: 1790, currency: "INR", recipient: MERCHANT },
      ttlSec: 300,
    });
    assert.equal(approval.termsDigest, digestForOperation(operation));
    const ok = auth.evaluate({
      ...operation,
      termsDigest: approval.termsDigest,
    });
    assert.equal(ok.allow, true);
    if (ok.allow) assert.equal(ok.citations[0]?.kind, "approval");

    const mutatedOp = op(1791);
    const mutated = auth.evaluate({
      ...mutatedOp,
      termsDigest: digestForOperation(mutatedOp),
    });
    assert.equal(mutated.allow, false);
    if (!mutated.allow) assert.equal(mutated.reason, "terms");
  });

  it("enforces expiry, single use, and revocation", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant(payGrant("stale", { exp: NOW - 3600 }));
    const expired = auth.evaluate(honest());
    assert.equal(expired.allow, false);
    if (!expired.allow) assert.equal(expired.reason, "expired");

    auth.addGrant(payGrant("once", { maxUses: 1 }));
    assert.equal(auth.evaluate(honest(), { consume: true }).allow, true);
    const replay = auth.evaluate(honest(), { consume: true });
    assert.equal(replay.allow, false);
    if (!replay.allow) assert.equal(replay.reason, "uses-exhausted");

    auth.addGrant(payGrant("doomed"));
    auth.revoke("doomed");
    const revoked = auth.evaluate(honest());
    assert.equal(revoked.allow, false);
    if (!revoked.allow) assert.equal(revoked.reason, "revoked");
  });

  it("scopes authority to the bound actor; mismatches deny no-authority with detail", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant(
      payGrant("scoped", { actor: { kind: "exact", id: OTHER_AGENT } })
    );
    const wrongAgent = auth.evaluate(honest());
    assert.equal(wrongAgent.allow, false);
    if (!wrongAgent.allow) {
      assert.equal(wrongAgent.reason, "no-authority");
      assert.match(wrongAgent.detail ?? "", /actor mismatch on grant scoped/);
    }
  });

  it("supports set, rooted, and explicit-any actor selectors", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant(
      payGrant("team", { actor: { kind: "set", ids: [AGENT, OTHER_AGENT] } })
    );
    const operation = op();
    assert.equal(
      auth.evaluate({
        ...operation,
        termsDigest: digestForOperation(operation),
      }).allow,
      true
    );
    const strangerOp = { ...op(), actor: ATTACKER };
    const stranger = auth.evaluate({
      ...strangerOp,
      termsDigest: digestForOperation(strangerOp),
    });
    assert.equal(stranger.allow, false);
    if (!stranger.allow) assert.equal(stranger.reason, "no-authority");

    const rooted = new Authority({ nowSec: () => NOW });
    rooted.addGrant(
      payGrant("delegated", { actor: { kind: "rooted", root: AGENT } })
    );
    const leafOp = {
      ...op(),
      actor: "did:test:sub-agent",
      actorChain: [AGENT, "did:test:sub-agent"],
    };
    assert.equal(
      rooted.evaluate({ ...leafOp, termsDigest: digestForOperation(leafOp) })
        .allow,
      true
    );
    const noChainOp = { ...op(), actor: "did:test:sub-agent" };
    assert.equal(
      rooted.evaluate({
        ...noChainOp,
        termsDigest: digestForOperation(noChainOp),
      }).allow,
      false
    );
    const foreignChainOp = {
      ...op(),
      actor: "did:test:sub-agent",
      actorChain: [ATTACKER, "did:test:sub-agent"],
    };
    assert.equal(
      rooted.evaluate({
        ...foreignChainOp,
        termsDigest: digestForOperation(foreignChainOp),
      }).allow,
      false
    );

    // Explicit wildcard: deliberate and audit-visible — anyone allows.
    const open = new Authority({ nowSec: () => NOW });
    open.addGrant(payGrant("open-door", { actor: { kind: "any" } }));
    assert.equal(open.evaluate(honest()).allow, true);
    assert.equal(
      open.evaluate({
        ...strangerOp,
        termsDigest: digestForOperation(strangerOp),
      }).allow,
      true
    );
  });

  it("attribute bounds cover equality, range, membership, and subset", () => {
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "bound-showcase",
      principal: PRINCIPAL,
      actor: { kind: "exact", id: AGENT },
      action: { name: "/disclose" },
      bounds: [
        { path: ".context.verifier", op: "==", value: MERCHANT },
        { path: ".context.attempt", op: ">=", value: 2 },
        { path: ".context.channel", op: "in", value: ["qr", "nfc"] },
        ...claimsSubset(["ca_status", "age_over_18"]),
      ],
    });
    const good: AuthorityRequest = {
      principal: PRINCIPAL,
      actor: AGENT,
      action: { name: "/disclose" },
      resource: { type: "credential", id: "credential:issuer-1" },
      context: {
        verifier: MERCHANT,
        attempt: 3,
        channel: "nfc",
        claims: ["ca_status"],
      },
      purpose: "disclose",
      termsDigest: "00".repeat(32),
    };
    assert.equal(auth.evaluate(good).allow, true);
    for (const patch of [
      { verifier: "did:test:impostor" },
      { attempt: 1 },
      { channel: "sms" },
      { claims: ["ca_status", "passport_no"] },
      { claims: "ca_status" },
    ]) {
      const bad: AuthorityRequest = {
        ...good,
        context: { ...good.context, ...patch },
      };
      assert.equal(
        auth.evaluate(bad).allow,
        false,
        `expected deny for ${JSON.stringify(patch)}`
      );
    }
  });

  it("derives stable digests from the normalized operation", () => {
    const first = digestForOperation(op());
    assert.equal(first, digestForOperation(op()));
    assert.equal(first.length, 64);
    const mutated = { ...op(), purpose: "pay invoice twice" };
    assert.notEqual(digestForOperation(mutated), first);
    // Absent chain normalizes like an empty chain.
    const noChain = { ...op() };
    const emptyChain = { ...op(), actorChain: [] };
    assert.equal(digestForOperation(noChain), digestForOperation(emptyChain));
  });

  it("rejects missing actors, bad bounds, and non-finite numbers at registration", () => {
    const auth = new Authority({ nowSec: () => NOW });
    const noActor = {
      id: "noactor",
      principal: PRINCIPAL,
      action: { name: "/pay" },
      bounds: [],
    };
    assert.throws(
      () =>
        auth.addGrant(
          noActor as unknown as Parameters<Authority["addGrant"]>[0]
        ),
      /actor selector required/
    );
    assert.throws(
      () =>
        auth.addGrant(
          payGrant("badpath", {
            bounds: [{ path: "context.amount", op: "<=", value: 10 }],
          })
        ),
      /bound path/
    );
    assert.throws(
      () =>
        auth.addGrant(
          payGrant("badnum", {
            bounds: [{ path: ".context.amount", op: "<=", value: NaN }],
          })
        ),
      /finite number/
    );
    assert.throws(
      () =>
        auth.addGrant(
          payGrant("badop", {
            bounds: [
              {
                path: ".context.amount",
                op: "!=" as unknown as "<=",
                value: 10,
              },
            ],
          })
        ),
      /bound op/
    );
    assert.throws(
      () =>
        auth.addGrant(
          payGrant("wildcard", { action: { name: "/" as `/${string}` } })
        ),
      /\/-path/
    );
    assert.throws(() => claimsSubset([]), /non-empty/);
    assert.throws(
      () => paymentBounds({ amountMax: Infinity, currency: "INR" }),
      /positive finite/
    );
    assert.throws(
      () =>
        auth.createApproval({
          id: "badttl",
          principal: PRINCIPAL,
          actor: AGENT,
          action: { name: "/pay" },
          resource: { type: "invoice", id: "invoice:inv_8472" },
          ttlSec: Infinity,
        }),
      /ttlSec/
    );
  });

  it("revoking a grant invalidates already-issued capabilities derived from it", () => {
    const principal = generateEd25519Keypair();
    const agent = generateEd25519Keypair();
    const merchant = generateEd25519Keypair();
    const keys = new Map([
      [PRINCIPAL, principal.publicKeyRaw],
      [AGENT, agent.publicKeyRaw],
      [MERCHANT, merchant.publicKeyRaw],
    ]);
    const caps = new Capabilities({
      resolveKey: (id) => keys.get(id) ?? null,
      nowSec: () => NOW,
    });
    const auth = new Authority({
      nowSec: () => NOW,
      onRevoke: (ids) => {
        for (const id of ids) caps.revoke(id);
      },
    });
    auth.addGrant(payGrant("grocery"));
    const digest = digestForOperation(op(100));
    const cap = caps.issue(
      null,
      {
        iss: PRINCIPAL,
        aud: AGENT,
        sub: PRINCIPAL,
        cmd: "/pay",
        pol: [["<=", ".amount", 2000]],
        purpose: "p",
        resource: "r",
        recipient: MERCHANT,
        amountMax: 2000,
        currency: "INR",
        exp: NOW + 300,
        maxUses: 5,
        termsDigest: digest,
      },
      principal.privateKey
    );
    auth.noteIssued("grocery", cap.payload.revocationId);
    const ask = {
      cmd: "/pay" as const,
      args: { amount: 100, currency: "INR" },
      recipient: MERCHANT,
      termsDigest: digest,
    };
    const cidBytes = new Uint8Array(Buffer.from(leafCidHex(cap), "hex"));
    const proof = {
      key: merchant.publicKeyRaw,
      sig: signBytes(merchant.privateKey, cidBytes),
    };
    assert.equal(caps.authorize([cap], ask, { consume: true, proof }).ok, true);
    auth.revoke("grocery");
    const denied = caps.authorize([cap], ask, { consume: false });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.reason, "revoked");
  });

  it("soft guard rejects unbounded /pay* grants at addGrant", () => {
    const auth = new Authority({ nowSec: () => NOW });
    assert.throws(
      () =>
        auth.addGrant({
          id: "unbounded-pay",
          principal: PRINCIPAL,
          actor: { kind: "exact", id: AGENT },
          action: { name: "/pay" },
          bounds: [{ path: ".context.currency", op: "==", value: "INR" }],
        }),
      /unbounded \/pay/
    );
    assert.throws(
      () =>
        auth.addGrant({
          id: "unbounded-pay-sub",
          principal: PRINCIPAL,
          actor: { kind: "exact", id: AGENT },
          action: { name: "/pay/history" },
          bounds: paymentBounds({ amountMax: 2000, currency: "INR" }).filter(
            (b) => b.path !== ".context.amount"
          ),
        }),
      /unbounded \/pay/
    );
    // Bounded /pay grants still register and allow.
    auth.addGrant(payGrant("bounded-pay"));
    assert.equal(auth.evaluate(honest()).allow, true);
  });
});
