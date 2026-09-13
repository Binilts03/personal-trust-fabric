import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  delegate,
  fromJwtClaims,
  MAX_DELEGATION_DEPTH,
  mintRoot,
  OAuthAgentError,
  toJwtClaims,
} from "../src/index.js";
import type { DelegatedToken } from "../src/index.js";

const NOW = 1_700_000_000;

function root() {
  return mintRoot({
    sub: "user_abc",
    actor: "did:agent:a",
    scope: ["pay:book", "pay:quote"],
    aud: "https://api.example/resource",
    senderCnf: "jkt-aaa",
    ttlSec: 3600,
    nowSec: NOW,
  });
}

describe("OAuth-agent attenuator (pivot/02)", () => {
  it("narrows scope and shortens expiry with act appended", () => {
    const child = delegate({
      parent: root(),
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    assert.equal(child.sub, "user_abc");
    assert.deepEqual(child.act, ["did:agent:a", "did:agent:b"]);
    assert.deepEqual(child.scope, ["pay:quote"]);
    assert.equal(child.exp, NOW + 600);
  });

  it("rejects broader scope, extended expiry, cycles, and missing cnf", () => {
    const parent = root();
    assert.throws(() =>
      delegate({
        parent,
        actor: "did:agent:b",
        scope: ["pay:book", "admin:all"],
        ttlSec: 600,
        senderCnf: "jkt-bbb",
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      delegate({
        parent,
        actor: "did:agent:a",
        scope: ["pay:quote"],
        ttlSec: 600,
        senderCnf: "jkt-bbb",
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      delegate({
        parent,
        actor: "did:agent:b",
        scope: ["pay:quote"],
        ttlSec: 600,
        senderCnf: "",
        nowSec: NOW,
      })
    );
    const clamped = delegate({
      parent,
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 7200,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    assert.equal(clamped.exp, parent.exp);
  });
});

describe("OAuth-agent hardening (review fixes)", () => {
  it("rejects NaN/Infinity/0/negative/string ttlSec in mintRoot+delegate", () => {
    const bad: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      0,
      -5,
      "3600",
    ];
    for (const ttlSec of bad) {
      assert.throws(
        () =>
          mintRoot({
            sub: "user_abc",
            actor: "did:agent:a",
            scope: ["pay:book"],
            aud: "https://api.example/resource",
            senderCnf: "jkt-aaa",
            ttlSec: ttlSec as number,
            nowSec: NOW,
          }),
        OAuthAgentError
      );
      assert.throws(
        () =>
          delegate({
            parent: root(),
            actor: "did:agent:b",
            scope: ["pay:quote"],
            ttlSec: ttlSec as number,
            senderCnf: "jkt-bbb",
            nowSec: NOW,
          }),
        OAuthAgentError
      );
    }
  });

  it("floors fractional ttlSec to preserve the integer-exp invariant", () => {
    const child = delegate({
      parent: root(),
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600.9,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    assert.equal(child.exp, NOW + 600);
    assert.ok(Number.isInteger(child.exp));
  });

  it("rejects bad nowSec instead of minting exp:NaN/float tokens", () => {
    const bad: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1.5,
      -1,
      "now",
    ];
    for (const nowSec of bad) {
      assert.throws(
        () =>
          mintRoot({
            sub: "user_abc",
            actor: "did:agent:a",
            scope: ["pay:book"],
            aud: "https://api.example/resource",
            senderCnf: "jkt-aaa",
            ttlSec: 3600,
            nowSec: nowSec as number,
          }),
        OAuthAgentError
      );
      assert.throws(
        () =>
          delegate({
            parent: root(),
            actor: "did:agent:b",
            scope: ["pay:quote"],
            ttlSec: 600,
            senderCnf: "jkt-bbb",
            nowSec: nowSec as number,
          }),
        OAuthAgentError
      );
    }
  });

  it("rejects expired parents with zero skew (exact <= check)", () => {
    const parent = root();
    const base = {
      parent,
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-bbb",
    } as const;
    assert.throws(
      () => delegate({ ...base, nowSec: parent.exp }),
      OAuthAgentError
    );
    assert.throws(
      () => delegate({ ...base, nowSec: parent.exp + 1 }),
      OAuthAgentError
    );
  });

  it("rejects malformed parents with OAuthAgentError, not TypeError", () => {
    const p = root();
    const badParents: unknown[] = [
      { ...p, act: null },
      { ...p, act: ["did:agent:a", 7] },
      { ...p, act: [] },
      { ...p, scope: "pay:book" },
      { ...p, scope: ["pay:book", ""] },
      { ...p, sub: 7 },
      { ...p, aud: 7 },
      { ...p, cnf: "" },
      { ...p, exp: Number.NaN },
      null,
    ];
    for (const bad of badParents) {
      assert.throws(
        () =>
          delegate({
            parent: bad as DelegatedToken,
            actor: "did:agent:b",
            scope: ["pay:quote"],
            ttlSec: 600,
            senderCnf: "jkt-bbb",
            nowSec: NOW,
          }),
        OAuthAgentError
      );
    }
  });

  it("typeof-checks strings before .length (non-strings cannot bypass)", () => {
    assert.throws(
      () =>
        delegate({
          parent: root(),
          actor: 7 as unknown as string,
          scope: ["pay:quote"],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        delegate({
          parent: root(),
          actor: "did:agent:b",
          scope: ["pay:quote"],
          ttlSec: 600,
          senderCnf: 7 as unknown as string,
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        mintRoot({
          sub: 7 as unknown as string,
          actor: "did:agent:a",
          scope: ["pay:book"],
          aud: "https://api.example/resource",
          senderCnf: "jkt-aaa",
          ttlSec: 3600,
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        mintRoot({
          sub: "user_abc",
          actor: "did:agent:a",
          scope: ["pay:book"],
          aud: 7 as unknown as string,
          senderCnf: "jkt-aaa",
          ttlSec: 3600,
          nowSec: NOW,
        }),
      OAuthAgentError
    );
  });

  it("rejects empty child scope like mintRoot (PTF policy, documented)", () => {
    const parent = root();
    assert.throws(
      () =>
        delegate({
          parent,
          actor: "did:agent:b",
          scope: [],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        delegate({
          parent,
          actor: "did:agent:b",
          scope: [""],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        delegate({
          parent,
          actor: "did:agent:b",
          scope: [7] as unknown as readonly string[],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
  });

  it("aud: absent inherits, explicit inherit ok, mismatch throws (v0.1 ceiling)", () => {
    const parent = root();
    const inherited = delegate({
      parent,
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    assert.equal(inherited.aud, parent.aud);
    const explicit = delegate({
      parent,
      actor: "did:agent:b",
      scope: ["pay:quote"],
      aud: parent.aud,
      ttlSec: 600,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    assert.equal(explicit.aud, parent.aud);
    assert.throws(
      () =>
        delegate({
          parent,
          actor: "did:agent:b",
          scope: ["pay:quote"],
          aud: "https://other.example/x",
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
  });

  it("enforces depth-10-ok / depth-11-reject (PTF policy, not RFC)", () => {
    assert.equal(MAX_DELEGATION_DEPTH, 10);
    let t = mintRoot({
      sub: "user_abc",
      actor: "did:agent:0",
      scope: ["s"],
      aud: "https://api.example/resource",
      senderCnf: "jkt-0",
      ttlSec: 3600,
      nowSec: NOW,
    });
    for (let i = 1; i < MAX_DELEGATION_DEPTH; i++) {
      t = delegate({
        parent: t,
        actor: `did:agent:${i}`,
        scope: ["s"],
        ttlSec: 3600,
        senderCnf: `jkt-${i}`,
        nowSec: NOW,
      });
    }
    assert.equal(t.act.length, MAX_DELEGATION_DEPTH);
    assert.throws(
      () =>
        delegate({
          parent: t,
          actor: "did:agent:10",
          scope: ["s"],
          ttlSec: 60,
          senderCnf: "jkt-10",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
  });

  it("rejects direct-repeat, deeper-duplicate, and empty actor cycles", () => {
    const c1 = delegate({
      parent: root(),
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    const c2 = delegate({
      parent: c1,
      actor: "did:agent:c",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-ccc",
      nowSec: NOW,
    });
    // Direct repeat of the root actor.
    assert.throws(
      () =>
        delegate({
          parent: root(),
          actor: "did:agent:a",
          scope: ["pay:quote"],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    // Deeper duplicate: root actor re-appears two levels down.
    assert.throws(
      () =>
        delegate({
          parent: c2,
          actor: "did:agent:a",
          scope: ["pay:quote"],
          ttlSec: 600,
          senderCnf: "jkt-ddd",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
    assert.throws(
      () =>
        delegate({
          parent: root(),
          actor: "",
          scope: ["pay:quote"],
          ttlSec: 600,
          senderCnf: "jkt-bbb",
          nowSec: NOW,
        }),
      OAuthAgentError
    );
  });

  it("allows cnf reuse at this layer; host must verify PoP (v0.1 ceiling)", () => {
    // DECISION: permitted-and-labeled. This layer sees only an opaque
    // descriptor string, so uniqueness checks would be theater; the real
    // control is host-side presenter authentication + key-possession proof.
    const parent = root();
    const child = delegate({
      parent,
      actor: "did:agent:b",
      scope: ["pay:quote"],
      ttlSec: 600,
      senderCnf: "jkt-aaa",
      nowSec: NOW,
    });
    assert.equal(child.cnf, "jkt-aaa");
  });
});

describe("OAuth-agent JWT mapping (RFC8693/RFC7800 edge)", () => {
  it("round-trips descriptor <-> standard claims", () => {
    const r = mintRoot({
      sub: "user_abc",
      actor: "did:agent:a",
      scope: ["a", "b"],
      aud: "https://api.example/resource",
      senderCnf: "jkt-aaa",
      ttlSec: 3600,
      nowSec: NOW,
    });
    const jwt = toJwtClaims(r);
    assert.equal(jwt.sub, "user_abc");
    assert.deepEqual(jwt.act, { sub: "did:agent:a" });
    assert.equal(jwt.scope, "a b");
    assert.equal(jwt.aud, "https://api.example/resource");
    assert.deepEqual(jwt.cnf, { jkt: "jkt-aaa" });
    assert.equal(jwt.exp, NOW + 3600);
    assert.equal(jwt.iat, NOW);

    const child = delegate({
      parent: r,
      actor: "did:agent:b",
      scope: ["a"],
      ttlSec: 600,
      senderCnf: "jkt-bbb",
      nowSec: NOW,
    });
    const childJwt = toJwtClaims(child);
    // Outermost = current actor per RFC8693 §4.1.
    assert.deepEqual(childJwt.act, {
      sub: "did:agent:b",
      act: { sub: "did:agent:a" },
    });
    assert.equal(childJwt.scope, "a");
    assert.deepEqual(fromJwtClaims(childJwt), child);
    assert.deepEqual(fromJwtClaims(jwt), r);
  });

  it("fromJwtClaims ignores unknown extra claims (forward compat)", () => {
    const good = toJwtClaims(root());
    assert.deepEqual(
      fromJwtClaims({ ...good, iss: "https://issuer.example" }),
      root()
    );
  });

  it("fromJwtClaims rejects array-scope, string-cnf, flat-act", () => {
    const good = toJwtClaims(root());
    assert.throws(
      () => fromJwtClaims({ ...good, scope: ["pay:book", "pay:quote"] }),
      OAuthAgentError
    );
    assert.throws(() => fromJwtClaims({ ...good, scope: "" }), OAuthAgentError);
    assert.throws(
      () => fromJwtClaims({ ...good, scope: "pay:book  pay:quote" }),
      OAuthAgentError
    );
    assert.throws(
      () => fromJwtClaims({ ...good, cnf: "jkt-aaa" }),
      OAuthAgentError
    );
    assert.throws(() => fromJwtClaims({ ...good, cnf: {} }), OAuthAgentError);
    assert.throws(
      () => fromJwtClaims({ ...good, act: ["did:agent:a"] }),
      OAuthAgentError
    );
    assert.throws(
      () => fromJwtClaims({ ...good, act: "did:agent:a" }),
      OAuthAgentError
    );
    assert.throws(() => fromJwtClaims({ ...good, sub: "" }), OAuthAgentError);
    assert.throws(
      () => fromJwtClaims({ ...good, exp: NOW + 0.5 }),
      OAuthAgentError
    );
  });
});
