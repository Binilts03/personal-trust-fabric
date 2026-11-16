/**
 * Package verifier: what a consumer actually receives.
 *
 * `npm pack` is the only place where the published surface is decided, and
 * a broken export map or a missing binary only shows up when a user
 * installs. This checks the tarball itself:
 *
 * - every `exports` target exists in the tarball,
 * - every `bin` target exists and is executable,
 * - the tests are not shipped,
 * - the README and the LICENSE are shipped,
 * - with `--install`, the tarball installs into a clean directory and the
 *   curated entry point imports.
 *
 * Run: `npm run verify:package` (add `--install` for the full check).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * A TypeScript consumer, compiled against the installed package. It uses the
 * public specifiers only and lets the types constrain it.
 */
const TS_CONSUMER = `import assert from "node:assert/strict";
import {
  Authority,
  digestForOperation,
  executeAndReceipt,
  paymentBounds,
  type AuthorityDecision,
  type AuthorityOperation,
  type PaymentExecutor,
  type Receipt,
  type VerifiedIdentity,
} from "personal-trust-fabric";
import {
  createProtectedEffect,
  type HostEffectBoundary,
  type HostEffectReceipt,
} from "personal-trust-fabric/hostkit";
import {
  Capabilities,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
} from "personal-trust-fabric/capabilities";
import { makeFakeProviders } from "personal-trust-fabric/providers";

const NOW = 1_800_000_000;
const P = "p";
const A = "a";
const R = "r";

const principal = generateEd25519Keypair();
const recipient = generateEd25519Keypair();
const keys = new Map<string, Uint8Array>([
  [P, principal.publicKeyRaw],
  [R, recipient.publicKeyRaw],
]);

const authority = new Authority({ nowSec: () => NOW });
authority.addGrant({
  id: "g1",
  principal: P,
  actor: { kind: "exact", id: A },
  action: { name: "/pay" },
  bounds: paymentBounds({ amountMax: 100, currency: "INR" }),
  exp: NOW + 600,
});

const ingress: VerifiedIdentity = {
  id: A,
  principal: P,
  source: "local-registration",
  proofRef: "ts-consumer",
};
const operation: AuthorityOperation = {
  action: { name: "/pay" },
  resource: { type: "invoice", id: "inv-1" },
  context: { amount: 100, currency: "INR" },
  purpose: "personal",
};

const decision: AuthorityDecision = authority.evaluate(operation, ingress, {
  nowSec: NOW,
});
assert.equal(decision.allow, true);

const digest = digestForOperation({
  principal: P,
  actor: A,
  action: operation.action,
  resource: operation.resource,
  context: operation.context,
  purpose: operation.purpose,
});

const caps = new Capabilities({
  resolveKey: (id: string) => keys.get(id) ?? null,
  nowSec: () => NOW,
});
const cap = caps.issue(
  null,
  {
    iss: P,
    aud: A,
    sub: P,
    cmd: "/pay",
    pol: [["<=", ".amount", 100]],
    purpose: "personal",
    resource: "invoice:inv-1",
    recipient: R,
    amountMax: 100,
    currency: "INR",
    exp: NOW + 300,
    maxUses: 1,
    termsDigest: digest,
  },
  principal.privateKey
);
const redemption = caps.redeem(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 100, currency: "INR" },
    recipient: R,
    resource: "invoice:inv-1",
    purpose: "personal",
    termsDigest: digest,
  },
  {
    proof: {
      key: recipient.publicKeyRaw,
      sig: signBytes(
        recipient.privateKey,
        new Uint8Array(Buffer.from(leafCidHex(cap), "hex"))
      ),
    },
  }
);
assert.equal(redemption.ok, true);
if (!redemption.ok) throw new Error("redeem denied");

const executor: PaymentExecutor = {
  async executePayment(instruction) {
    return { ok: true, transaction: \`tx-\${instruction.recipient}\` };
  },
};
const receipt: Receipt = await executeAndReceipt(
  executor,
  {
    capabilityId: leafCidHex(cap),
    recipient: R,
    amount: 100,
    currency: "INR",
    resource: "invoice:inv-1",
    purpose: "personal",
    termsDigest: digest,
  },
  redemption,
  NOW
);
assert.equal(receipt.transaction, \`tx-\${R}\`);

// The host kit's types resolve from the published subpath too.
const boundaryFactory: typeof createProtectedEffect = createProtectedEffect;
assert.equal(typeof boundaryFactory, "function");
type Boundary = HostEffectBoundary;
type EffectReceipt = HostEffectReceipt;
const boundaryTypes: Boundary | EffectReceipt | undefined = undefined;
assert.equal(boundaryTypes, undefined);

const providers = makeFakeProviders({ nowSec: () => NOW });
assert.equal(providers.payment.kind, "payment");

console.log("ts consumer: ok");
`;

/**
 * A misuse of the public API. It MUST NOT compile: a published type that
 * accepts anything is not a contract.
 */
const TS_MISUSE = `import { Authority } from "personal-trust-fabric";
const authority = new Authority({ nowSec: () => 1 });
// The decision object is not a string:
const wrong: string = authority.evaluate(
  {
    action: { name: "/pay" },
    resource: { type: "invoice", id: "inv-1" },
    context: {},
    purpose: "personal",
  },
  { id: "a", principal: "p", source: "local-registration", proofRef: "x" },
  { nowSec: 1 }
);
void wrong;
`;

/**
 * The persisted protected effect journey, run against the installed package:
 * the published CLI creates the store and the grant, the published library
 * performs the effect with a durable consumption, the store on disk shows the
 * consumed use, and a replay is refused without a second effect.
 */
const PROTECTED_JOURNEY = `import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  VaultStore,
  executeProtectedAction,
  makeFakeProviders,
} from "personal-trust-fabric";
import {
  Capabilities,
  generateEd25519Keypair,
  leafCidHex,
  signBytes,
} from "personal-trust-fabric/capabilities";

const NOW = Math.floor(Date.now() / 1000);
const P = "owner";
const A = "shopper";
const M = "merchant";
const SECRET = "4111111111111111";

const cli = join(
  process.cwd(),
  "node_modules",
  "personal-trust-fabric",
  "dist",
  "src",
  "cli.js"
);
const dir = join(process.cwd(), "journey-store");
const ptf = (...args) =>
  execFileSync(process.execPath, [cli, "--dir", dir, ...args], {
    encoding: "utf8",
  });

// The published CLI creates the persisted store and the grant.
ptf("init");
ptf(
  "grant",
  "--id",
  "g-use",
  "--principal",
  P,
  "--cmd",
  "/use",
  "--agent",
  A,
  "--purpose",
  "pay",
  "--max-uses",
  "1",
  "--exp-in",
  "3600"
);

const vault = new VaultStore(() => NOW);
vault.putRecord({
  id: "r-pan",
  owner: P,
  type: "pan",
  value: SECRET,
  sensitivity: "secret",
  source: "issuer",
  allowedPurposes: ["pay"],
  allowedAgents: [A],
  expiresAt: null,
});

const principal = generateEd25519Keypair();
const merchant = generateEd25519Keypair();
const keys = new Map([
  [P, principal.publicKeyRaw],
  [M, merchant.publicKeyRaw],
]);
const digest = "cd".repeat(32);
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
    cmd: "/pay",
    pol: [],
    purpose: "pay",
    resource: "invoice:7",
    recipient: M,
    amountMax: 5000,
    currency: "INR",
    exp: NOW + 300,
    maxUses: 10,
    termsDigest: digest,
  },
  principal.privateKey
);
const redeemed = caps.redeem(
  [cap],
  {
    cmd: "/pay",
    args: { amount: 250, currency: "INR", ref: "r-pan" },
    recipient: M,
    resource: "invoice:7",
    purpose: "pay",
    termsDigest: digest,
  },
  {
    proof: {
      key: merchant.publicKeyRaw,
      sig: signBytes(
        merchant.privateKey,
        new Uint8Array(Buffer.from(leafCidHex(cap), "hex"))
      ),
    },
  }
);
assert.equal(redeemed.ok, true);
if (!redeemed.ok) throw new Error("redeem denied");

const fakes = makeFakeProviders({ nowSec: () => NOW });
const ingress = {
  id: A,
  principal: P,
  source: "local-registration",
  proofRef: "journey",
};
const attempt = {
  dir,
  nowSec: NOW,
  ingress,
  recordId: "r-pan",
  purpose: "pay",
  provider: fakes.payment,
  redemption: redeemed,
  buildRequest: (instr) => ({
    termsDigest: digest,
    action: "/pay",
    recipient: M,
    resource: "invoice:7",
    purpose: "pay",
    context: { amount: 250, currency: "INR", ref: instr.recordId },
  }),
  loadVaultState: () => vault,
  at: NOW,
};

const receipt = await executeProtectedAction(attempt);
assert.equal(receipt.amount, 250);
assert.equal(fakes.payment.calls.length, 1, "one provider effect");

// The consumption is PERSISTED: the store on disk shows the used grant.
const stored = JSON.parse(
  readFileSync(join(dir, "authority.json"), "utf8")
);
const used = Array.isArray(stored.used)
  ? new Map(stored.used)
  : new Map(Object.entries(stored.used ?? {}));
assert.equal(used.get("g-use"), 1, "the consumption must be on disk");

// The secret never reached the store.
assert.equal(
  readFileSync(join(dir, "authority.json"), "utf8").includes(SECRET),
  false
);

// A replay is refused on the persisted use: no second external effect.
let refused = false;
try {
  await executeProtectedAction(attempt);
} catch {
  refused = true;
}
assert.equal(refused, true, "a replay must be refused");
assert.equal(fakes.payment.calls.length, 1, "no second external effect");

console.log("persisted protected effect: ok");
`;

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const installCheck = process.argv.includes("--install");
const failures = [];

function fail(message) {
  failures.push(message);
}

const staging = mkdtempSync(join(tmpdir(), "ptf-pack-"));

/** Run npm through its own entry point: the .cmd shim is not executable here. */
function npm(args, opts = {}) {
  const execPath = process.env.npm_execpath;
  if (execPath !== undefined && execPath !== "") {
    return execFileSync(process.execPath, [execPath, ...args], {
      encoding: "utf8",
      ...opts,
    });
  }
  return execFileSync("npm", args, {
    encoding: "utf8",
    shell: true,
    ...opts,
  });
}

let packed;
try {
  const raw = npm(["pack", "--json", "--pack-destination", staging], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  packed = JSON.parse(raw)[0];
} catch (error) {
  console.error(`package verify: FAIL - npm pack failed: ${error.message}`);
  process.exit(1);
}

const files = new Set(
  packed.files.map((file) => file.path.replace(/\\/g, "/"))
);
const modes = new Map(
  packed.files.map((file) => [file.path.replace(/\\/g, "/"), file.mode])
);

function exportTargets(value, out = []) {
  if (typeof value === "string") {
    if (value.startsWith("./dist/")) out.push(value.slice(2));
    return out;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, out);
  }
  return out;
}

for (const target of exportTargets(pkg.exports ?? {})) {
  if (!files.has(target))
    fail(`exports target missing from the tarball: ${target}`);
}

for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  const path = String(target).replace(/^\.\//, "");
  if (!files.has(path)) fail(`bin ${name} missing from the tarball: ${path}`);
  // npm sets the executable bit when it links a bin, so the tarball mode is
  // not the property to check. The shebang is: without it the linked script
  // is not runnable on a POSIX shell.
  const local = resolve(root, path);
  if (!existsSync(local)) {
    fail(`bin ${name} has no built file: ${path} (run the build first)`);
  } else if (!readFileSync(local, "utf8").startsWith("#!")) {
    fail(`bin ${name} has no shebang: ${path}`);
  }
}

for (const path of files) {
  if (path.startsWith("dist/tests/"))
    fail(`tests must not be shipped: ${path}`);
  if (path.endsWith(".map")) fail(`source maps must not be shipped: ${path}`);
}

for (const required of ["README.md", "LICENSE", "package.json"]) {
  if (!files.has(required)) fail(`${required} missing from the tarball`);
}

if (installCheck) {
  const consumer = mkdtempSync(join(tmpdir(), "ptf-consumer-"));
  try {
    npm(["init", "-y"], { cwd: consumer, stdio: "ignore" });
    npm(
      [
        "install",
        join(staging, packed.filename),
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
      ],
      { cwd: consumer, stdio: "ignore" }
    );
    // The consumer is an ESM project: the package's exports map is resolved
    // with the ESM algorithm, and a TypeScript consumer is compiled with
    // NodeNext resolution, so the consumer must be too.
    const consumerManifestPath = join(consumer, "package.json");
    const consumerManifest = JSON.parse(
      readFileSync(consumerManifestPath, "utf8")
    );
    consumerManifest.type = "module";
    writeFileSync(
      consumerManifestPath,
      `${JSON.stringify(consumerManifest, null, 2)}\n`
    );
    const probe = join(consumer, "probe.mjs");
    writeFileSync(
      probe,
      'import { Authority } from "personal-trust-fabric";\n' +
        "console.log(typeof Authority);\n"
    );
    const out = execFileSync(process.execPath, [probe], {
      cwd: consumer,
      encoding: "utf8",
    });
    if (!out.includes("function")) {
      fail(
        `the installed package does not export the curated entry point: ${out.trim()}`
      );
    }
    // Consumer must be able to embed the registered-action MCP server using
    // an advertised public entry point, not a source/deep import.
    const mcpProbe = join(consumer, "mcp-public-probe.mjs");
    writeFileSync(mcpProbe, [
      'import { createPtfServer, validateOpaqueEmailAction } from "personal-trust-fabric/mcp";',
      'if (typeof createPtfServer !== "function" || typeof validateOpaqueEmailAction !== "function") process.exit(1);',
      'const server = createPtfServer({ dir: "./scratch", env: {}, principal: "p", actor: "a" });',
      'await server.close();',
      'console.log("mcp public import: ok");'
    ].join("\n"));
    const mcpOut = execFileSync(process.execPath, [mcpProbe], {
      cwd: consumer, encoding: "utf8",
    });
    if (!mcpOut.includes("mcp public import: ok"))
      fail("packed installed MCP module cannot be embedded");
    // The payment path must be reachable from the INSTALLED package: the
    // curated root's executors need a Redemption, and only the capability
    // subpath can produce one. Exercised here so a consumer-side hole fails
    // the package gate, not a user's project.
    const paymentProbe = join(consumer, "payment-public-probe.mjs");
    writeFileSync(
      paymentProbe,
      [
        'import { Authority, digestForOperation, executeAndReceipt, paymentBounds } from "personal-trust-fabric";',
        'import { Capabilities, generateEd25519Keypair, leafCidHex, signBytes } from "personal-trust-fabric/capabilities";',
        'const NOW = 1800000000, P = "p", A = "a", R = "r";',
        'const principal = generateEd25519Keypair();',
        'const recipient = generateEd25519Keypair();',
        'const keys = new Map([[P, principal.publicKeyRaw], [R, recipient.publicKeyRaw]]);',
        'const authority = new Authority({ nowSec: () => NOW });',
        'authority.addGrant({ id: "g1", principal: P, actor: { kind: "exact", id: A }, action: { name: "/pay" }, bounds: paymentBounds({ amountMax: 2000, currency: "INR" }), exp: NOW + 600 });',
        'const ingress = { id: A, principal: P, source: "local-registration", proofRef: "probe" };',
        'const operation = { action: { name: "/pay" }, resource: { type: "invoice", id: "inv-1" }, context: { amount: 100, currency: "INR" }, purpose: "personal" };',
        'if (!authority.evaluate(operation, ingress, { nowSec: NOW }).allow) throw new Error("authority denied");',
        'const digest = digestForOperation({ principal: P, actor: A, action: operation.action, resource: operation.resource, context: operation.context, purpose: "personal" });',
        'const caps = new Capabilities({ resolveKey: (id) => keys.get(id) ?? null, nowSec: () => NOW });',
        'const cap = caps.issue(null, { iss: P, aud: A, sub: P, cmd: "/pay", pol: [["<=", ".amount", 100]], purpose: "personal", resource: "invoice:inv-1", recipient: R, amountMax: 100, currency: "INR", exp: NOW + 300, maxUses: 1, termsDigest: digest }, principal.privateKey);',
        'const demand = { cmd: "/pay", args: { amount: 100, currency: "INR" }, recipient: R, resource: "invoice:inv-1", purpose: "personal", termsDigest: digest };',
        'const cid = leafCidHex(cap);',
        'const redemption = caps.redeem([cap], demand, { proof: { key: recipient.publicKeyRaw, sig: signBytes(recipient.privateKey, new Uint8Array(Buffer.from(cid, "hex"))) } });',
        'if (!redemption.ok) throw new Error("redeem denied");',
        'const receipt = await executeAndReceipt({ async executePayment(i) { return { ok: true, transaction: `tx-${i.recipient}` }; } }, { capabilityId: cid, recipient: R, amount: 100, currency: "INR", resource: "invoice:inv-1", purpose: "personal", termsDigest: digest }, redemption, NOW);',
        'if (receipt.transaction !== `tx-${R}`) throw new Error("unexpected receipt");',
        'console.log("payment public path: ok");'
      ].join("\n")
    );
    const paymentOut = execFileSync(process.execPath, [paymentProbe], {
      cwd: consumer, encoding: "utf8",
    });
    if (!paymentOut.includes("payment public path: ok"))
      fail("packed consumer cannot drive the payment path through the public surface");
    // Copy the real third-domain example INTO the fresh consumer. Executing
    // it from the source tree would accidentally resolve local dist instead
    // of the packed installation and invalidate this check.
    const genericProbe = join(consumer, "generic-protected-action.mjs");
    writeFileSync(
      genericProbe,
      readFileSync(join(root, "examples/generic-protected-action.mjs"), "utf8")
    );
    const genericOutput = execFileSync(process.execPath, [genericProbe], {
      cwd: consumer,
      encoding: "utf8",
    });
    if (!genericOutput.includes("email receipt:") ||
        genericOutput.includes("PRIVATE KEY") ||
        genericOutput.includes("PAN-SECRET")) {
      fail("packed consumer generic protected action failed or leaked sensitive output");
    }

    // A TypeScript consumer must compile against the INSTALLED package: the
    // `types` entries the exports map advertises have to resolve, and they
    // have to constrain the consumer (a type that accepts anything is not a
    // contract). The node type definitions are copied in from the checkout
    // so the compile needs no network.
    const typesSource = join(root, "node_modules", "@types", "node");
    const undiciTypes = join(root, "node_modules", "undici-types");
    if (!existsSync(typesSource) || !existsSync(undiciTypes)) {
      fail("cannot compile a TypeScript consumer: the node type definitions are missing");
    } else {
      cpSync(typesSource, join(consumer, "node_modules", "@types", "node"), {
        recursive: true,
      });
      cpSync(undiciTypes, join(consumer, "node_modules", "undici-types"), {
        recursive: true,
      });
    }
    const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
    if (!existsSync(tsc)) {
      fail("cannot compile a TypeScript consumer: typescript is missing");
    } else {
      writeFileSync(join(consumer, "consumer.ts"), TS_CONSUMER);
      writeFileSync(
        join(consumer, "tsconfig.json"),
        `${JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              noEmitOnError: true,
              types: ["node"],
              outDir: "./out",
              rootDir: ".",
            },
            include: ["consumer.ts"],
          },
          null,
          2
        )}\n`
      );
      let compiled = true;
      let compileOutput = "";
      try {
        compileOutput = execFileSync(process.execPath, [tsc, "-p", join(consumer, "tsconfig.json")], {
          cwd: consumer,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        compiled = false;
        compileOutput = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      }
      if (!compiled) {
        fail(
          `a TypeScript consumer does not compile against the installed package: ${compileOutput}`
        );
      } else {
        // The compiled consumer must also RUN: types and runtime agree.
        try {
          const tsOut = execFileSync(
            process.execPath,
            [join(consumer, "out", "consumer.js")],
            { cwd: consumer, encoding: "utf8" }
          );
          if (!tsOut.includes("ts consumer: ok")) {
            fail(`the compiled TypeScript consumer did not run: ${tsOut.trim()}`);
          }
        } catch (error) {
          fail(
            `the compiled TypeScript consumer failed to run: ${error.stdout ?? ""}${error.stderr ?? ""}${error.message}`
          );
        }
        // The advertised types must CONSTRAIN the consumer: a file that
        // misuses the API must not compile.
        writeFileSync(join(consumer, "misuse.ts"), TS_MISUSE);
        writeFileSync(
          join(consumer, "tsconfig.misuse.json"),
          `${JSON.stringify(
            {
              compilerOptions: {
                target: "ES2022",
                module: "NodeNext",
                moduleResolution: "NodeNext",
                strict: true,
                noEmit: true,
                types: ["node"],
              },
              include: ["misuse.ts"],
            },
            null,
            2
          )}\n`
        );
        let misuseFailed = false;
        try {
          execFileSync(
            process.execPath,
            [tsc, "-p", join(consumer, "tsconfig.misuse.json")],
            { cwd: consumer, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
          );
        } catch {
          misuseFailed = true;
        }
        if (!misuseFailed) {
          fail(
            "the published types do not constrain a consumer: a misuse of the API compiled cleanly"
          );
        }
      }
    }

    // A PERSISTED protected effect journey from the installed package: the
    // published CLI creates the store and the grant, the published library
    // performs the effect with a durable consumption, the store on disk shows
    // the consumed use, and a replay is refused without a second effect.
    const journey = join(consumer, "protected-journey.mjs");
    writeFileSync(journey, PROTECTED_JOURNEY);
    try {
      const journeyOut = execFileSync(process.execPath, [journey], {
        cwd: consumer,
        encoding: "utf8",
      });
      if (!journeyOut.includes("persisted protected effect: ok")) {
        fail(
          `the persisted protected effect journey did not complete: ${journeyOut.trim()}`
        );
      }
    } catch (error) {
      fail(
        `the persisted protected effect journey failed: ${error.stdout ?? ""}${error.stderr ?? error.message}`
      );
    }
  } catch (error) {
    fail(`the tarball does not install and import: ${error.message}`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

rmSync(staging, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures)
    console.error(`package verify: FAIL - ${failure}`);
  process.exit(1);
}
console.log(
  `package verify: ok - ${packed.filename} (${packed.files.length} files, ${packed.size} bytes)`
);
