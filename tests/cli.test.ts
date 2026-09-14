import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openKeystore } from "../src/index.js";
import type { PaymentExecutor } from "../src/index.js";
import { parseArgs, run } from "../src/cli.js";

describe("operator CLI argument parsing (prod-03)", () => {
  it("parses commands, flags, and the store dir", () => {
    assert.deepEqual(
      parseArgs(["pay", "--agent", "a", "--amount", "10", "--yes"]),
      {
        command: "pay",
        dir: "./ptf-store",
        flags: { agent: "a", amount: "10", yes: true },
      }
    );
    assert.deepEqual(
      parseArgs(["--dir", "/tmp/x", "audit", "--verify"]).dir,
      "/tmp/x"
    );
  });

  it("rejects garbage with usage errors", () => {
    assert.throws(() => parseArgs([]), /usage/);
    assert.throws(() => parseArgs(["frobnicate"]), /unknown command/);
    assert.throws(() => parseArgs(["pay", "--agent"]), /expects a value/);
    assert.throws(
      () => parseArgs(["pay", "--yes", "extra"]),
      /unexpected positional/
    );
    assert.throws(
      () => parseArgs(["pay", "pos", "--agent", "a"]),
      /unexpected positional/
    );
  });

  it("supports --help/--version and rejects unknown flags", () => {
    assert.equal(parseArgs(["--help"]).command, "help");
    assert.equal(parseArgs(["--version"]).command, "version");
    assert.equal(parseArgs(["help"]).command, "help");
    assert.throws(
      () => parseArgs(["pay", "--frobnicate", "x"]),
      /unknown flag/
    );
    assert.throws(
      () => parseArgs(["grant", "--id", "g", "--nope", "v"]),
      /unknown flag/
    );
  });

  it("operator-quickstart README commands all pass parseArgs (ticket 17)", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const readme = readFileSync(join(root, "README.md"), "utf8");
    const block =
      readme.split("## Operator quickstart")[1]?.split("```")[1] ?? "";
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) => l.startsWith("node dist/src/cli.js") || l.startsWith("ptf ")
      );
    assert.ok(lines.length > 0, "expected operator-quickstart commands");
    for (const line of lines) {
      // Skip placeholder lines (e.g. --key <hex-from-keygen>): not parseable by design.
      if (line.includes("<") && line.includes(">")) continue;
      const argv = line.startsWith("node dist/src/cli.js")
        ? line.slice("node dist/src/cli.js".length).trim().split(/\s+/)
        : line.slice("ptf ".length).trim().split(/\s+/);
      if (argv.length === 1 && argv[0] === "") continue;
      parseArgs(argv);
    }
  });
});

function testIo(): {
  io: { print: (l: string) => void; readLine: () => string; now: () => number };
  out: string[];
} {
  const out: string[] = [];
  return {
    io: {
      print: (l: string) => out.push(l),
      readLine: () => "yes",
      now: () => 1_700_000_000,
    },
    out,
  };
}

function openAliases(dir: string, pass: string): string[] {
  const ks = openKeystore(
    JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8")) as Parameters<
      typeof openKeystore
    >[0],
    pass
  );
  return Object.keys(ks).sort();
}

describe("operator CLI custody (ticket 04)", () => {
  it("a second keygen keeps the first key — never silent clobber", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-cli-"));
    const { io } = testIo();
    const env = { PTF_PASSPHRASE: "test-pass-123" };
    assert.equal(await run(["--dir", dir, "init"], io, env), 0);
    assert.equal(
      await run(["--dir", dir, "keygen", "--alias", "you"], io, env),
      0
    );
    assert.equal(
      await run(["--dir", dir, "keygen", "--alias", "shop"], io, env),
      0
    );
    assert.deepEqual(openAliases(dir, "test-pass-123"), ["shop", "you"]);
  });

  it("rekey rotates the passphrase with keys intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-cli-"));
    const { io } = testIo();
    await run(["--dir", dir, "init"], io, { PTF_PASSPHRASE: "old-pass" });
    await run(["--dir", dir, "keygen", "--alias", "you"], io, {
      PTF_PASSPHRASE: "old-pass",
    });
    assert.equal(
      await run(["--dir", dir, "rekey"], io, {
        PTF_PASSPHRASE: "old-pass",
        PTF_NEW_PASSPHRASE: "brand-new-pass",
      }),
      0
    );
    assert.deepEqual(openAliases(dir, "brand-new-pass"), ["you"]);
    assert.throws(() => openAliases(dir, "old-pass"));
  });

  it("keygen works from a passphrase file with no env secret", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-cli-"));
    const pp = join(dir, "pp");
    writeFileSync(pp, "file-pass\n", { mode: 0o600 });
    const { io } = testIo();
    await run(["--dir", dir, "init"], io, {});
    assert.equal(
      await run(["--dir", dir, "keygen", "--alias", "you"], io, {
        PTF_PASSPHRASE_FILE: pp,
      }),
      0
    );
    assert.deepEqual(openAliases(dir, "file-pass"), ["you"]);
  });
});

async function setupPaidStore(): Promise<{
  dir: string;
  io: { print: (l: string) => void; readLine: () => string; now: () => number };
  out: string[];
  env: Record<string, string>;
  payArgv: string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "ptf-cli-"));
  const { io, out } = testIo();
  const env = { PTF_PASSPHRASE: "test-pass-123" };
  await run(["--dir", dir, "init"], io, env);
  await run(["--dir", dir, "keygen", "--alias", "you"], io, env);
  await run(["--dir", dir, "keygen", "--alias", "shop"], io, env);
  const shopLine = out.find((l) => l.startsWith("shop: ")) ?? "";
  const shopHex = shopLine.slice("shop: ".length).trim();
  assert.match(shopHex, /^[0-9a-f]{64}$/);
  await run(
    ["--dir", dir, "recipient", "--alias", "shop", "--key", shopHex],
    io,
    env
  );
  await run(
    [
      "--dir",
      dir,
      "grant",
      "--id",
      "g1",
      "--principal",
      "you",
      "--cmd",
      "/pay",
      "--agent",
      "shopper",
      "--amount-max",
      "5000",
      "--currency",
      "INR",
      "--recipient",
      "shop",
      "--max-uses",
      "1",
    ],
    io,
    env
  );
  const payArgv = [
    "--dir",
    dir,
    "pay",
    "--principal",
    "you",
    "--agent",
    "shopper",
    "--recipient",
    "shop",
    "--amount",
    "100",
    "--currency",
    "INR",
    "--resource",
    "invoice:1",
    "--yes",
  ];
  return { dir, io, out, env, payArgv };
}

describe("operator CLI execution ordering (ticket 05)", () => {
  it("a failing rail burns the use instead of double-spending", async () => {
    const { io, out, env, payArgv } = await setupPaidStore();
    const failing: PaymentExecutor = {
      executePayment: async () => {
        throw new Error("rail down");
      },
    };
    // Consumption persisted before the rail threw: the attempt rejects…
    await assert.rejects(
      run(payArgv, io, env, { executor: failing }),
      /rail down/
    );
    // …and the retry on a live rail denies (uses-exhausted), not refunds.
    const code = await run(payArgv, io, env);
    assert.equal(code, 1);
    assert.match(out.join("\n"), /uses-exhausted/);
  });

  it("pay succeeds end-to-end on the reference rail (control)", async () => {
    const { io, out, env, payArgv } = await setupPaidStore();
    const code = await run(payArgv, io, env);
    assert.equal(code, 0);
    const receipt = JSON.parse(out[out.length - 1] as string) as {
      amount?: number;
      transaction?: string;
      capabilityId?: string;
    };
    assert.equal(receipt.amount, 100);
    assert.ok((receipt.transaction ?? "").length > 0);
    assert.ok((receipt.capabilityId ?? "").length > 0);
  });
});
