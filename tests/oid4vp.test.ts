import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Disclose,
  checkResponseBinding,
  generateEd25519Keypair,
  requestToDisclosureDemand,
} from "../src/index.js";

const NONCE = "n-91530ff2c44d5657a8b21d917ed8345d";
const CLIENT = "redirect_uri:https://verifier.example.com/cb";

function baseRequest(): Record<string, unknown> {
  return {
    response_type: "vp_token",
    client_id: CLIENT,
    response_uri: "https://verifier.example.com/cb",
    response_mode: "direct_post",
    nonce: NONCE,
    state: "st-1",
    dcql_query: {
      credentials: [
        {
          id: "ca_cred",
          format: "dc+sd-jwt",
          claims: [{ path: ["ca_status"] }, { path: ["age_over_18"] }],
        },
      ],
    },
  };
}

const PINNED = { allowed: ["redirect_uri"] as const };

describe("OpenID4VP request/response adapter (ptf-v03/03)", () => {
  it("maps a valid DCQL request to a bounded disclosure demand", () => {
    const mapped = requestToDisclosureDemand(baseRequest(), PINNED);
    assert.equal(mapped.verifier, CLIENT);
    assert.equal(mapped.nonce, NONCE);
    assert.deepEqual(mapped.requested, ["ca_status", "age_over_18"]);
    assert.equal(mapped.transactionData, false);
  });

  it("rejects malformed or out-of-scope requests before any demand exists", () => {
    const both = { ...baseRequest(), scope: "openid" };
    assert.throws(() => requestToDisclosureDemand(both, PINNED));
    assert.throws(() =>
      requestToDisclosureDemand(
        { ...baseRequest(), client_id: "magic:xyz" },
        PINNED
      )
    );
    assert.throws(() =>
      requestToDisclosureDemand(
        { ...baseRequest(), client_id: "x509_san_dns:verifier.example.com" },
        PINNED
      )
    );
    const { nonce, ...noNonce } = baseRequest();
    void nonce;
    assert.throws(() => requestToDisclosureDemand(noNonce, PINNED));
    assert.throws(() =>
      requestToDisclosureDemand(
        { ...baseRequest(), response_type: "code" },
        PINNED
      )
    );
    const nested = structuredClone(baseRequest()) as Record<string, unknown>;
    const dcql = nested["dcql_query"] as {
      credentials: { claims: unknown[] }[];
    };
    dcql.credentials[0]?.claims.push({ path: ["address", "street"] });
    assert.throws(() => requestToDisclosureDemand(nested, PINNED));
    const withSets = structuredClone(baseRequest()) as Record<string, unknown>;
    const dcql2 = withSets["dcql_query"] as Record<string, unknown>;
    dcql2["claim_sets"] = [{ options: [["a"]] }];
    assert.throws(() => requestToDisclosureDemand(withSets, PINNED));
  });

  it("enforces response binding including the KB-downgrade rule", () => {
    const ok = { vp_token: {}, nonce: NONCE, aud: CLIENT, state: "st-1" };
    checkResponseBinding(ok, {
      expectedNonce: NONCE,
      expectedAud: CLIENT,
      stateSent: "st-1",
      transactionDataRequested: false,
      holderBindingPresent: false,
      kbRequired: false,
    });
    assert.throws(() =>
      checkResponseBinding(
        { ...ok, nonce: "other" },
        {
          expectedNonce: NONCE,
          expectedAud: CLIENT,
          stateSent: "st-1",
          transactionDataRequested: false,
          holderBindingPresent: false,
          kbRequired: false,
        }
      )
    );
    assert.throws(() =>
      checkResponseBinding(
        { ...ok, aud: "someone-else" },
        {
          expectedNonce: NONCE,
          expectedAud: CLIENT,
          stateSent: "st-1",
          transactionDataRequested: false,
          holderBindingPresent: false,
          kbRequired: false,
        }
      )
    );
    const { state, ...noState } = ok;
    void state;
    assert.throws(() =>
      checkResponseBinding(noState, {
        expectedNonce: NONCE,
        expectedAud: CLIENT,
        stateSent: "st-1",
        transactionDataRequested: false,
        holderBindingPresent: false,
        kbRequired: false,
      })
    );
    assert.throws(() =>
      checkResponseBinding(ok, {
        expectedNonce: NONCE,
        expectedAud: CLIENT,
        stateSent: "st-1",
        transactionDataRequested: false,
        holderBindingPresent: false,
        kbRequired: true,
      })
    );
    assert.throws(() =>
      checkResponseBinding(ok, {
        expectedNonce: NONCE,
        expectedAud: CLIENT,
        stateSent: "st-1",
        transactionDataRequested: true,
        holderBindingPresent: true,
        kbRequired: true,
      })
    );
  });

  it("wires request → demand → holder-bound presentation", () => {
    const holder = generateEd25519Keypair();
    const mapped = requestToDisclosureDemand(baseRequest(), PINNED);
    const pres = Disclose.present(
      {
        issuer: "did:test:ca",
        subject: "did:test:holder",
        claims: { ca_status: "active", age_over_18: true, passport: "X1" },
      },
      {
        verifier: mapped.verifier,
        nonce: mapped.nonce,
        requested: mapped.requested,
      },
      { recipient: CLIENT, allowed: ["ca_status", "age_over_18"] },
      { id: "did:test:holder", privateKey: holder.privateKey },
      1_700_000_000
    );
    assert.deepEqual(pres.disclosures.map((d) => d.name).sort(), [
      "age_over_18",
      "ca_status",
    ]);
    const result = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: CLIENT,
      nowSec: 1_700_000_000,
    });
    assert.equal(result.ok, true);
  });
});
