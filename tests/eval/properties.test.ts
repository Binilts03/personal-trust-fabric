import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import {
  Capabilities,
  generateEd25519Keypair,
  termsDigestOf,
} from "../../src/index.js";
import type { KeyObject } from "node:crypto";

const NOW = 1_700_000_000;
const P = "did:test:p";
const AGENTS = [
  "did:test:a0",
  "did:test:a1",
  "did:test:a2",
  "did:test:a3",
] as const;
const MERCHANT = "did:test:merchant";

interface Kit {
  keys: Map<string, Uint8Array>;
  priv: Map<string, KeyObject>;
}

function kit(): Kit {
  const keys = new Map<string, Uint8Array>();
  const priv = new Map<string, KeyObject>();
  const add = (id: string) => {
    const kp = generateEd25519Keypair();
    keys.set(id, kp.publicKeyRaw);
    priv.set(id, kp.privateKey);
  };
  add(P);
  for (const a of AGENTS) add(a);
  return { keys, priv };
}

function key(k: Kit, id: string): KeyObject {
  const p = k.priv.get(id);
  assert.ok(p);
  return p;
}

describe("capability invariants under randomization (ptf-v01/05)", () => {
  it("valid narrowing chains always issue and redeem", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountDrop: fc.integer({ min: 0, max: 500 }),
            expDrop: fc.integer({ min: 0, max: 600 }),
            usesDrop: fc.integer({ min: 0, max: 2 }),
          }),
          { minLength: 1, maxLength: 3 }
        ),
        (steps) => {
          const k = kit();
          const digest = termsDigestOf({ t: "prop-narrow" });
          const caps = new Capabilities({
            resolveKey: (id) => k.keys.get(id) ?? null,
            nowSec: () => NOW,
          });
          let amount = 2000;
          let exp = NOW + 3600;
          let uses = 5;
          let aud = AGENTS[0] as string;
          const root = caps.issue(
            null,
            {
              iss: P,
              aud,
              sub: P,
              cmd: "/pay",
              pol: [["<=", ".amount", amount]],
              purpose: "p",
              resource: "r",
              recipient: MERCHANT,
              amountMax: amount,
              currency: "INR",
              exp,
              maxUses: uses,
              termsDigest: digest,
            },
            key(k, P)
          );
          let chain = [root];
          let depth = 1;
          for (const s of steps) {
            amount = Math.max(1, amount - s.amountDrop);
            exp = Math.max(NOW + 120, exp - s.expDrop);
            uses = Math.max(1, uses - s.usesDrop);
            const nextAud = AGENTS[depth] as string;
            const child = caps.issue(
              chain,
              {
                iss: aud,
                aud: nextAud,
                sub: P,
                cmd: "/pay",
                pol: [["<=", ".amount", amount]],
                purpose: "p",
                resource: "r",
                recipient: MERCHANT,
                amountMax: amount,
                currency: "INR",
                exp,
                maxUses: uses,
                termsDigest: digest,
              },
              key(k, aud)
            );
            chain = [...chain, child];
            aud = nextAud;
            depth += 1;
          }
          const leaf = chain[chain.length - 1];
          assert.ok(leaf);
          const seen = caps.authorize(
            chain,
            {
              cmd: "/pay",
              args: { amount: 1, currency: "INR" },
              recipient: MERCHANT,
              termsDigest: digest,
            },
            { consume: false }
          );
          assert.equal(seen.ok, true);
        }
      ),
      { numRuns: 25 }
    );
  });

  it("any single widening throws at issue", () => {
    fc.assert(
      fc.property(
        fc
          .record({
            widenAmount: fc.boolean(),
            widenExp: fc.boolean(),
            widenUses: fc.boolean(),
            delta: fc.integer({ min: 1, max: 500 }),
          })
          .filter((w) => w.widenAmount || w.widenExp || w.widenUses),
        (w) => {
          const k = kit();
          const digest = termsDigestOf({ t: "prop-widen" });
          const caps = new Capabilities({
            resolveKey: (id) => k.keys.get(id) ?? null,
            nowSec: () => NOW,
          });
          const root = caps.issue(
            null,
            {
              iss: P,
              aud: AGENTS[0],
              sub: P,
              cmd: "/pay",
              pol: [["<=", ".amount", 1000]],
              purpose: "p",
              resource: "r",
              recipient: MERCHANT,
              amountMax: 1000,
              currency: "INR",
              exp: NOW + 1000,
              maxUses: 3,
              termsDigest: digest,
            },
            key(k, P)
          );
          const childAmount = w.widenAmount ? 1000 + w.delta : 1000;
          assert.throws(() =>
            caps.issue(
              [root],
              {
                iss: AGENTS[0],
                aud: AGENTS[1],
                sub: P,
                cmd: "/pay",
                pol: [["<=", ".amount", childAmount]],
                purpose: "p",
                resource: "r",
                recipient: MERCHANT,
                amountMax: childAmount,
                currency: "INR",
                exp: w.widenExp ? NOW + 1000 + w.delta : NOW + 1000,
                maxUses: w.widenUses ? 3 + Math.min(w.delta, 5) : 3,
                termsDigest: digest,
              },
              key(k, AGENTS[0])
            )
          );
        }
      ),
      { numRuns: 25 }
    );
  });

  it("validity always resolves to the earliest expiry", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 120, max: 7200 }), {
          minLength: 3,
          maxLength: 3,
        }),
        (offsets) => {
          const sorted = [...offsets].sort((a, b) => b - a);
          const [e1, e2, e3] = sorted as [number, number, number];
          const k = kit();
          const digest = termsDigestOf({ t: "prop-exp" });
          const mk = (now: number) =>
            new Capabilities({
              resolveKey: (id) => k.keys.get(id) ?? null,
              nowSec: () => now,
            });
          const caps = mk(NOW);
          const root = caps.issue(
            null,
            {
              iss: P,
              aud: AGENTS[0],
              sub: P,
              cmd: "/pay",
              pol: [["<=", ".amount", 100]],
              purpose: "p",
              resource: "r",
              recipient: MERCHANT,
              amountMax: 100,
              currency: "INR",
              exp: NOW + (e1 as number),
              maxUses: 1,
              termsDigest: digest,
            },
            key(k, P)
          );
          const c1 = caps.issue(
            [root],
            {
              iss: AGENTS[0],
              aud: AGENTS[1],
              sub: P,
              cmd: "/pay",
              pol: [["<=", ".amount", 100]],
              purpose: "p",
              resource: "r",
              recipient: MERCHANT,
              amountMax: 100,
              currency: "INR",
              exp: NOW + (e2 as number),
              maxUses: 1,
              termsDigest: digest,
            },
            key(k, AGENTS[0])
          );
          const c2 = caps.issue(
            [root, c1],
            {
              iss: AGENTS[1],
              aud: AGENTS[2],
              sub: P,
              cmd: "/pay",
              pol: [["<=", ".amount", 100]],
              purpose: "p",
              resource: "r",
              recipient: MERCHANT,
              amountMax: 100,
              currency: "INR",
              exp: NOW + (e3 as number),
              maxUses: 1,
              termsDigest: digest,
            },
            key(k, AGENTS[1])
          );
          const demand = {
            cmd: "/pay" as const,
            args: { amount: 1, currency: "INR" },
            recipient: MERCHANT,
            termsDigest: digest,
          };
          const earliest = NOW + (e3 as number);
          assert.equal(
            mk(earliest - 61).authorize([root, c1, c2], demand, {
              consume: false,
            }).ok,
            true
          );
          assert.equal(
            mk(earliest + 61).authorize([root, c1, c2], demand, {
              consume: false,
            }).ok,
            false
          );
        }
      ),
      { numRuns: 25 }
    );
  });
});
