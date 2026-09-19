import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import {
  toAp2PaymentDemand as ap2ToDemand,
  verifyMandatePair,
} from "../src/index.js";
import type { EcJwk } from "../src/index.js";

const NOW = 1_700_000_000;
const EXPECTED_AUD = "ptf-adapter";

const b64u = (data: Uint8Array | Buffer | string): string =>
  Buffer.from(data as Uint8Array).toString("base64url");
const sha256b64u = (ascii: string): string =>
  createHash("sha256").update(ascii, "ascii").digest().toString("base64url");

interface Jwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
}

function p256(): { pub: Jwk; priv: Jwk } {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return {
    pub: publicKey.export({ format: "jwk" }) as Jwk,
    priv: privateKey.export({ format: "jwk" }) as Jwk,
  };
}

function derToRaw(der: Buffer): Buffer {
  let o = 2;
  const lr = der[o + 1] as number;
  const r = der.slice(o + 2, o + 2 + lr);
  o += 2 + lr;
  const ls = der[o + 1] as number;
  const s = der.slice(o + 2, o + 2 + ls);
  const norm = (b: Buffer): Buffer => {
    const t = b[0] === 0 ? b.slice(1) : b;
    return t.length < 32 ? Buffer.concat([Buffer.alloc(32 - t.length), t]) : t;
  };
  return Buffer.concat([norm(r), norm(s)]);
}

function signEs256(priv: Jwk, signingInput: string): string {
  const key = createPrivateKey({ key: priv as never, format: "jwk" });
  return b64u(
    derToRaw(sign("sha256", Buffer.from(signingInput, "ascii"), key))
  );
}

function jwt(payload: object, priv: Jwk): string {
  const input = `${b64u(JSON.stringify({ alg: "ES256", typ: "JWT" }))}.${b64u(JSON.stringify(payload))}`;
  return `${input}.${signEs256(priv, input)}`;
}

/** SD-JWT serialization: jwt + disclosures + trailing ~ (+ optional KB). */
function sdwrap(
  payload: object,
  signer: Jwk,
  disclosures: string[] = [],
  kb?: string
): string {
  const token = jwt(payload, signer);
  return `${token}~${disclosures.map((d) => `${d}~`).join("")}${kb ?? ""}`;
}

function disclosure(salt: string, name: string, value: unknown): string {
  return b64u(JSON.stringify([salt, name, value]));
}

const USER = p256();
const AGENT = p256();
const MERCHANT = p256();
const AGENT_CNF = {
  jwk: { kty: "EC", crv: "P-256", x: AGENT.pub.x, y: AGENT.pub.y },
};

function mandateSet(
  overrides: {
    tamperCheckout?: boolean;
    cnfMismatch?: boolean;
    expiredOpen?: boolean;
    expiredClosed?: boolean;
    kbAud?: string;
    kbNonce?: string | null;
    kbWithoutExp?: boolean;
    autonomous?: boolean;
  } = {}
) {
  const checkoutJwt = jwt(
    { iss: "did:test:merchant", cart: ["widget"], exp: NOW + 600 },
    MERCHANT.priv
  );
  const shownJwt = overrides.tamperCheckout
    ? `${checkoutJwt}tampered`
    : checkoutJwt;
  const checkoutHash = sha256b64u(checkoutJwt);
  const openExp = overrides.expiredOpen ? NOW - 500 : NOW + 3600;
  const paymentCnf = overrides.cnfMismatch
    ? { jwk: { kty: "EC", crv: "P-256", x: USER.pub.x, y: USER.pub.y } }
    : AGENT_CNF;

  const openCheckout = sdwrap(
    {
      vct: "mandate.checkout.open.1",
      cnf: AGENT_CNF,
      exp: openExp,
      constraints: [],
    },
    USER.priv
  );
  const openPayment = sdwrap(
    {
      vct: "mandate.payment.open.1",
      cnf: paymentCnf,
      exp: openExp,
      constraints: [],
    },
    USER.priv
  );
  const closedSigner = overrides.autonomous === true ? AGENT.priv : USER.priv;
  const closedExp = overrides.expiredClosed ? NOW - 500 : NOW + 600;
  const closedCheckout = sdwrap(
    {
      vct: "mandate.checkout.1",
      checkout_jwt: shownJwt,
      checkout_hash: checkoutHash,
      exp: closedExp,
    },
    closedSigner
  );
  const disc = disclosure("salt-1", "note", "fragile");
  const closedPayment = sdwrap(
    {
      vct: "mandate.payment.1",
      transaction_id: checkoutHash,
      payee: { id: "did:test:payee", name: "Shop" },
      payment_amount: { amount: 4250, currency: "INR" },
      payment_instrument: { id: "card-1", type: "card" },
      exp: closedExp,
    },
    closedSigner,
    [disc]
  );
  let kbPayment: string | undefined;
  if (overrides.autonomous === true) {
    const kbPayload: Record<string, unknown> = {
      aud: overrides.kbAud ?? EXPECTED_AUD,
      sd_hash: sha256b64u(closedPayment),
      iat: NOW,
    };
    if (overrides.kbNonce !== null) {
      kbPayload["nonce"] = overrides.kbNonce ?? "kb-nonce-1";
    }
    if (overrides.kbWithoutExp !== true) {
      kbPayload["exp"] = NOW + 300;
    }
    const input = `${b64u(JSON.stringify({ alg: "ES256", typ: "kb+jwt" }))}.${b64u(JSON.stringify(kbPayload))}`;
    kbPayment = `${input}.${signEs256(AGENT.priv, input)}`;
  }
  return {
    openCheckout,
    openPayment,
    closedCheckout,
    closedPayment,
    ...(kbPayment !== undefined ? { kbPayment } : {}),
  };
}

const KEYS: { userKey: EcJwk; merchantKey: EcJwk } = {
  userKey: { kty: "EC", crv: "P-256", x: USER.pub.x, y: USER.pub.y },
  merchantKey: {
    kty: "EC",
    crv: "P-256",
    x: MERCHANT.pub.x,
    y: MERCHANT.pub.y,
  },
};

describe("AP2 mandate-pair verifier adapter (ptf-v02/03)", () => {
  it("verifies a valid direct pair and maps it to a demand", () => {
    const set = mandateSet();
    const verified = verifyMandatePair(set, {
      ...KEYS,
      expectedAud: EXPECTED_AUD,
      nowSec: NOW,
    });
    assert.equal(verified.mode, "direct");
    assert.equal(verified.amountMinor, 4250);
    assert.equal(verified.currency, "INR");
    assert.equal(verified.transactionId.length > 0, true);
    const { operation, binding, capabilityArgs } = ap2ToDemand(verified, {
      purpose: "buy widget",
      resource: "order:1",
    });
    // ADR-0013: identity-free operation; the verified transaction id travels
    // as a VerifiedExternalBinding for the host to fold into evaluate opts.
    assert.ok(!("principal" in operation));
    assert.ok(!("actor" in operation));
    assert.ok(!("termsDigest" in operation));
    assert.equal(operation.context["recipient"], "did:test:payee");
    assert.equal(operation.context["amount"], 4250);
    assert.equal(operation.context["transactionId"], undefined);
    assert.equal(binding.scheme, "ap2");
    assert.equal(binding.value, verified.transactionId);
    assert.deepEqual(capabilityArgs, { amount: 4250, currency: "INR" });
  });

  it("verifies a valid autonomous pair bound by KB-JWT", () => {
    const set = mandateSet({ autonomous: true });
    const verified = verifyMandatePair(set, {
      ...KEYS,
      expectedAud: EXPECTED_AUD,
      expectedNonce: "kb-nonce-1",
      nowSec: NOW,
    });
    assert.equal(verified.mode, "autonomous");
    assert.equal(verified.amountMinor, 4250);
  });

  it("rejects tampered carts, mismatched agent keys, expired opens, and wrong KB audience", () => {
    assert.throws(() =>
      verifyMandatePair(mandateSet({ tamperCheckout: true }), {
        ...KEYS,
        expectedAud: EXPECTED_AUD,
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      verifyMandatePair(mandateSet({ cnfMismatch: true }), {
        ...KEYS,
        expectedAud: EXPECTED_AUD,
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      verifyMandatePair(mandateSet({ expiredOpen: true }), {
        ...KEYS,
        expectedAud: EXPECTED_AUD,
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      verifyMandatePair(
        mandateSet({ autonomous: true, kbAud: "someone-else" }),
        {
          ...KEYS,
          expectedAud: EXPECTED_AUD,
          nowSec: NOW,
        }
      )
    );
  });

  it("rejects expired closed mandates, KB-JWTs without expiry, and foreign nonces", () => {
    assert.throws(() =>
      verifyMandatePair(mandateSet({ expiredClosed: true }), {
        ...KEYS,
        expectedAud: EXPECTED_AUD,
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      verifyMandatePair(mandateSet({ autonomous: true, kbWithoutExp: true }), {
        ...KEYS,
        expectedAud: EXPECTED_AUD,
        nowSec: NOW,
      })
    );
    assert.throws(() =>
      verifyMandatePair(
        mandateSet({ autonomous: true, kbNonce: "session-b" }),
        {
          ...KEYS,
          expectedAud: EXPECTED_AUD,
          expectedNonce: "session-a",
          nowSec: NOW,
        }
      )
    );
  });
});
