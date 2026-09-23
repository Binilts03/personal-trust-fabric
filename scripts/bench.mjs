import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  Authority,
  Capabilities,
  FakePaymentExecutor,
  executeAndReceipt,
  generateEd25519Keypair,
  leafCidHex,
  loadAuthority,
  makeFakeProviders,
  paymentBounds,
  saveAuthority,
  signBytes,
  termsDigestOf,
} from "../dist/src/index.js";

// G14 empirical harness: local percentile numbers for the hot paths —
// normalize/CHECK/REDEEM/consume/receipt/provider round-trip/persist.
// Env-stamped and shape-only by design: CI asserts row shape (see
// tests/bench.test.ts), never thresholds. Compare runs on the same box
// only; these numbers are not SLOs (see docs/audit/limits.md).

const P = "did:bench:principal";
const A = "did:bench:agent";
const M = "did:bench:merchant";

function parseN(argv) {
  let n = 100;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") {
      const v = Number(argv[i + 1]);
      if (!Number.isSafeInteger(v) || v <= 0) {
        console.error("usage: bench.mjs [--n positive-integer]");
        process.exit(2);
      }
      n = v;
      i++;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: bench.mjs [--n positive-integer]");
      process.exit(0);
    } else {
      console.error(`usage: unknown flag ${argv[i]}`);
      process.exit(2);
    }
  }
  return n;
}

function quantile(sorted, q) {
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(q * (sorted.length - 1)))
  ];
}

async function measure(op, n, fn) {
  await fn();
  await fn();
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    op,
    n,
    min: samples[0],
    p50: quantile(samples, 0.5),
    p95: quantile(samples, 0.95),
    p99: quantile(samples, 0.99),
  };
}

function kit() {
  const mk = (id) => {
    const kp = generateEd25519Keypair();
    return { id, pub: kp.publicKeyRaw, priv: kp.privateKey };
  };
  const principal = mk(P);
  const agent = mk(A);
  const merchant = mk(M);
  const keys = new Map([
    [P, principal.pub],
    [A, agent.pub],
    [M, merchant.pub],
  ]);
  const caps = new Capabilities({
    resolveKey: (id) => keys.get(id) ?? null,
    nowSec: () => 1_700_000_000,
  });
  return { caps, principal, merchant };
}

function issueRoot(caps, priv, maxUses, terms) {
  return caps.issue(
    null,
    {
      iss: P,
      aud: A,
      sub: P,
      cmd: "/pay",
      pol: [["<=", ".amount", 2000]],
      purpose: "pay invoice",
      resource: "invoice:inv_8472",
      recipient: M,
      amountMax: 2000,
      currency: "INR",
      exp: 1_700_003_600,
      maxUses,
      termsDigest: terms,
    },
    priv
  );
}

function demandFor(terms) {
  return {
    cmd: "/pay",
    args: { amount: 1790, currency: "INR" },
    recipient: M,
    resource: "invoice:inv_8472",
    purpose: "pay invoice",
    termsDigest: terms,
  };
}

function proofFor(leaf, signer) {
  const cidBytes = new Uint8Array(Buffer.from(leafCidHex(leaf), "hex"));
  return { key: signer.pub, sig: signBytes(signer.priv, cidBytes) };
}

async function main() {
  const n = parseN(process.argv.slice(2));
  const ops = [];
  const { caps, principal, merchant } = kit();
  const terms = termsDigestOf({ invoice: "inv_8472", bench: true });

  const checkRoot = issueRoot(caps, principal.priv, 1, terms);
  const checkDemand = demandFor(terms);
  ops.push(
    await measure("capability.check", n, () =>
      caps.check([checkRoot], checkDemand)
    )
  );
  ops.push(
    await measure("capability.check.x8", n, () =>
      Promise.all(
        Array.from({ length: 8 }, () => caps.check([checkRoot], checkDemand))
      )
    )
  );

  const redeemRoot = issueRoot(caps, principal.priv, n + 2, terms);
  const redeemProof = proofFor(redeemRoot, merchant);
  ops.push(
    await measure("capability.redeem", n, () =>
      caps.redeem([redeemRoot], demandFor(terms), { proof: redeemProof })
    )
  );

  const execRoot = issueRoot(caps, principal.priv, n + 2, terms);
  const execProof = proofFor(execRoot, merchant);
  const redemptions = [];
  for (let i = 0; i < n + 2; i++) {
    const r = caps.redeem([execRoot], demandFor(terms), { proof: execProof });
    if (!r.ok) throw new Error("bench setup: redeem failed");
    redemptions.push(r);
  }
  const executor = new FakePaymentExecutor();
  // measure() runs 2 warmup + n timed calls; the array holds exactly that.
  let ri = 0;
  ops.push(
    await measure("execute.receipt", n, () => {
      const r = redemptions[ri++];
      return executeAndReceipt(
        executor,
        {
          capabilityId: r.chainId,
          recipient: M,
          amount: 1790,
          currency: "INR",
          resource: "invoice:inv_8472",
          purpose: "pay invoice",
          termsDigest: terms,
        },
        r,
        1_700_000_000
      );
    })
  );

  const fakes = makeFakeProviders({ nowSec: () => 1_700_000_000 });
  ops.push(
    await measure("provider.roundtrip", n, async () => {
      const sub = await fakes.payment.submit({
        capabilityId: "cid-bench",
        termsDigest: "ab".repeat(16),
        action: "/pay",
        recipient: M,
        resource: "res:1",
        purpose: "p",
        context: { handle: "h-1" },
      });
      fakes.payment.verify(sub, {
        capabilityId: "cid-bench",
        termsDigest: "ab".repeat(16),
      });
    })
  );

  const dir = mkdtempSync(join(tmpdir(), "ptf-bench-"));
  const auth = new Authority({ nowSec: () => 1_700_000_000 });
  auth.addGrant({
    id: "g-bench",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    bounds: paymentBounds({ amountMax: 2000, currency: "INR" }),
    exp: 1_700_003_600,
  });
  ops.push(
    await measure("authority.persist", n, () => {
      saveAuthority(dir, auth);
      loadAuthority(dir, { nowSec: () => 1_700_000_000 });
    })
  );

  console.log(
    JSON.stringify(
      {
        env: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          at: new Date().toISOString(),
        },
        ops,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(
    `bench failed: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exitCode = 1;
});
