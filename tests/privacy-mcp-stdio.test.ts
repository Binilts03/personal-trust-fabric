import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  VaultStore,
  RecipientRegistry,
  createVaultDek,
  generateEd25519Keypair,
  saveAuthority,
  saveRegistry,
  saveVault,
  sealKeystore,
  claimsSubset,
  paymentBounds,
  signBytes,
  openKeystore,
  loadAuthority,
  VAULT_DEK_ALIAS,
  DPDP_PROFILE_ID,
  DPDP_PROFILE_REVISION,
} from "../src/index.js";
import {
  PrivacyStore,
  createPrivacyDek,
  savePrivacyStore,
  PRIVACY_DEK_ALIAS,
} from "../src/store/privacy.js";
import { FilePrivacyEventRepository } from "../src/store/privacy-events.js";
import {
  createExecution,
  deriveIdempotencyKey,
  transitionExecution,
} from "../src/index.js";

const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));
const P = "did:test:p";
const A = "did:test:a";

function setup(
  active: boolean,
  paymentMaxUses?: number
): {
  dir: string;
  configPath: string;
  recipientDer: Uint8Array;
  recipientPub: Uint8Array;
} {
  const at = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-mcp-"));
  const principal = generateEd25519Keypair();
  const recipient = generateEd25519Keypair();
  const auth = new Authority({ nowSec: () => at });
  auth.addGrant({
    id: "grant-privacy",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    resource: { type: "credential", id: "personal-state" },
    purpose: "support",
    bounds: claimsSubset(["email"]),
    exp: at + 300,
  });
  auth.addGrant({
    id: "grant-payment",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/pay" },
    resource: { type: "ptf-resource", id: "invoice:1" },
    purpose: "support",
    bounds: paymentBounds({ amountMax: 5000, currency: "INR" }),
    ...(paymentMaxUses !== undefined ? { maxUses: paymentMaxUses } : {}),
    exp: at + 300,
  });
  saveAuthority(dir, auth);
  const registry = new RecipientRegistry(() => at);
  registry.register(P, principal.publicKeyRaw, at);
  registry.register("seller:1", recipient.publicKeyRaw, at);
  saveRegistry(dir, registry);

  const vaultDek = createVaultDek();
  const vault = new VaultStore(() => at);
  vault.putRecord({
    id: "r-email",
    owner: P,
    type: "email",
    value: "protected-person@example.com",
    sensitivity: "general",
    source: "user",
    allowedPurposes: ["support"],
    allowedAgents: [A],
    expiresAt: null,
  });
  saveVault(dir, vault, { dek: vaultDek });

  const privacyDek = createPrivacyDek();
  const privacy = new PrivacyStore(() => at);
  privacy.addBasis({
    kind: "certain-legitimate-use",
    id: "basis-support",
    controllerId: "acme",
    purpose: "support",
    dataCategories: ["email", "payment"],
    provisionRef: "operator-asserted:s7",
    evidenceRef: "operator-evidence:1",
    assertedBy: "privacy-office",
    active,
  });
  privacy.addActivity({
    id: "act-support",
    profileId: "IN-DPDP-2025",
    authorityPrincipal: P,
    controllerId: "acme",
    subjects: { kind: "exact", ref: "subject:opaque-1" },
    action: "/disclose",
    resourceType: "credential",
    purpose: "support",
    dataCategories: ["email"],
    recipients: [{ id: "verifier", role: "third-party" }],
    basisId: "basis-support",
    active: true,
  });
  privacy.addActivity({
    id: "act-payment",
    profileId: "IN-DPDP-2025",
    authorityPrincipal: P,
    controllerId: "acme",
    subjects: { kind: "exact", ref: "subject:opaque-1" },
    action: "/pay",
    resourceType: "ptf-resource",
    purpose: "support",
    dataCategories: ["payment"],
    recipients: [{ id: "seller:1", role: "third-party" }],
    basisId: "basis-support",
    active: true,
  });
  savePrivacyStore(dir, privacy, { dek: privacyDek });

  const principalSeed = new Uint8Array(
    principal.privateKey.export({ format: "der", type: "pkcs8" })
  );
  writeFileSync(
    join(dir, "keystore.json"),
    JSON.stringify(
      sealKeystore(
        {
          [P]: principalSeed,
          [VAULT_DEK_ALIAS]: vaultDek,
          [PRIVACY_DEK_ALIAS]: privacyDek,
        },
        "privacy-test-pass"
      )
    )
  );
  const configPath = join(dir, "privacy-config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      dataPrincipalRef: "subject:opaque-1",
      controllerId: "acme",
      recipientRoles: { verifier: "third-party", "seller:1": "third-party" },
      actionCategories: { "/pay": ["payment"] },
    })
  );
  const recipientDer = new Uint8Array(
    recipient.privateKey.export({ format: "der", type: "pkcs8" })
  );
  return {
    dir,
    configPath,
    recipientDer,
    recipientPub: recipient.publicKeyRaw,
  };
}

function paymentEventRepo(dir: string): FilePrivacyEventRepository {
  const keys = openKeystore(
    JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8")),
    "privacy-test-pass"
  );
  return new FilePrivacyEventRepository({
    dir,
    dek: keys[PRIVACY_DEK_ALIAS] as Uint8Array,
  });
}

function seedPaymentEvent(
  dir: string,
  termsDigest: string,
  state: "PREPARED" | "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN"
): void {
  const at = Math.floor(Date.now() / 1000);
  const repo = paymentEventRepo(dir);
  const record = repo.prepare({
    profileId: DPDP_PROFILE_ID,
    profileRevision: DPDP_PROFILE_REVISION,
    dataPrincipalRef: "subject:opaque-1",
    authorityPrincipal: P,
    actor: A,
    controllerId: "acme",
    activityId: "act-payment",
    basisId: "basis-support",
    purpose: "support",
    action: "/pay",
    resource: { type: "ptf-resource", id: "invoice:1" },
    dataCategories: ["payment"],
    recipients: [{ id: "seller:1", role: "third-party" }],
    termsDigest,
    authorityCitationIds: ["grant-payment"],
    attemptRef: termsDigest,
    preparedAt: at,
  });
  if (state !== "PREPARED") {
    repo.transition(record.eventId, state, {
      finalizedAt: at,
      ...(state === "SUCCEEDED" ? { evidenceRef: "seed:receipt-1" } : {}),
    });
  }
}

function seedPaymentJournal(
  dir: string,
  termsDigest: string,
  overrides: {
    readonly recipient?: string;
    readonly amount?: number;
    readonly currency?: string;
    readonly purpose?: string;
  } = {}
): void {
  const at = Math.floor(Date.now() / 1000);
  const record = createExecution(
    dir,
    {
      idempotencyKey: deriveIdempotencyKey(termsDigest, "payment"),
      capabilityId: "c".repeat(32),
      termsDigest,
      action: "/pay",
      recipient: overrides.recipient ?? "seller:1",
      resource: "invoice:1",
      purpose: overrides.purpose ?? "support",
      context: {
        amount: overrides.amount ?? 100,
        currency: overrides.currency ?? "INR",
      },
    },
    at
  );
  transitionExecution(dir, record.executionId, "AUTHORIZED", {}, at);
  transitionExecution(dir, record.executionId, "SUBMITTING", {}, at);
  transitionExecution(
    dir,
    record.executionId,
    "SUCCEEDED",
    {
      externalRef: "provider-tx-1",
      receiptId: "receipt-1",
      receiptAt: at,
    },
    at
  );
}

/** A journal row that never reached the provider boundary. */
function seedUnsubmittedPaymentJournal(dir: string, termsDigest: string): void {
  const at = Math.floor(Date.now() / 1000);
  createExecution(
    dir,
    {
      idempotencyKey: deriveIdempotencyKey(termsDigest, "payment"),
      capabilityId: "c".repeat(32),
      termsDigest,
      action: "/pay",
      recipient: "seller:1",
      resource: "invoice:1",
      purpose: "support",
      context: { amount: 100, currency: "INR" },
    },
    at
  );
}

async function withRpc<T>(
  env: Record<string, string>,
  test: (
    call: (name: string, args: Record<string, unknown>) => Promise<any>
  ) => Promise<T>
): Promise<T> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  const waits = new Map<number, (value: any) => void>();
  let id = 0;
  let stderr = "";
  child.stderr?.on("data", (buf: Buffer) => {
    stderr += buf.toString();
  });
  child.stdout?.on("data", (buf: Buffer) => {
    buffer += buf.toString();
    let nl = -1;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const done = waits.get(response.id);
      if (done) {
        waits.delete(response.id);
        done(response);
      }
    }
  });
  const rpc = (method: string, params: unknown): Promise<any> => {
    const key = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waits.delete(key);
        reject(
          new Error("MCP timeout: " + method + " " + stderr.slice(0, 1200))
        );
      }, 12000);
      waits.set(key, (x) => {
        clearTimeout(timer);
        resolve(x);
      });
      child.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id: key, method, params }) + "\n"
      );
    });
  };
  try {
    const init = await rpc("initialize", {
      protocolVersion: "2026-07-28",
      capabilities: {},
      clientInfo: { name: "privacy-test", version: "1" },
    });
    assert.ok(init.result?.serverInfo);
    return await test((name, args) =>
      rpc("tools/call", { name, arguments: args })
    );
  } finally {
    child.kill();
  }
}

function resultData(response: any): any {
  const text = response.result?.content?.[0]?.text;
  if (typeof text !== "string")
    throw new Error("No MCP text: " + JSON.stringify(response));
  return JSON.parse(text);
}

describe("opt-in privacy disclosure over stdio", () => {
  it("denies a valid authority when its privacy basis is inactive", async () => {
    const { dir, configPath } = setup(false);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, false);
        assert.equal(out.reason, "privacy denied");
      }
    );
  });

  it("permits authorised+privacy-approved disclosure and records an encrypted event", async () => {
    const { dir, configPath } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
        const presented = resultData(
          await call("ptf_present_data", {
            termsDigest: out.termsDigest,
            nonce: "dW5pcXVlLXByaXZhY3ktbm9uY2UrLw==",
          })
        );
        assert.equal(presented.presented, true);
        assert.equal(presented.disclosed[0], "email");
        assert.match(presented.notice, /consumes one authority use/);
        assert.doesNotMatch(presented.notice, /no uses consumed/);
      }
    );
    assert.equal(readdirSync(join(dir, "privacy-events")).length, 1);
  });

  it("gates the actual MCP payment redemption and journal with privacy evidence", async () => {
    const { dir, configPath, recipientDer, recipientPub } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(proposal.allowed, true);
        const challenge = resultData(
          await call("ptf_redeem", {
            termsDigest: proposal.termsDigest,
          })
        );
        assert.equal(challenge.needProof, true);
        const { createPrivateKey } = await import("node:crypto");
        const privateKey = createPrivateKey({
          key: Buffer.from(recipientDer),
          format: "der",
          type: "pkcs8",
        });
        const signature = signBytes(
          privateKey,
          new Uint8Array(Buffer.from(challenge.cidHex, "hex"))
        );
        const paid = resultData(
          await call("ptf_redeem", {
            termsDigest: proposal.termsDigest,
            recipientKeyHex: Buffer.from(recipientPub).toString("hex"),
            recipientSigHex: Buffer.from(signature).toString("hex"),
          })
        );
        assert.equal(paid.amount, 100);
        assert.ok(paid.receiptId);
      }
    );
    const eventRepo = new FilePrivacyEventRepository({
      dir,
      dek: openKeystore(
        JSON.parse(readFileSync(join(dir, "keystore.json"), "utf8")),
        "privacy-test-pass"
      )[PRIVACY_DEK_ALIAS] as Uint8Array,
    });
    const records = eventRepo.listBySubject("subject:opaque-1");
    assert.ok(
      records.some(
        (record) => record.action === "/pay" && record.state === "SUCCEEDED"
      )
    );
  });

  it("denies payment in privacy mode when its operator category mapping is absent", async () => {
    const { dir, configPath } = setup(true);
    writeFileSync(
      configPath,
      JSON.stringify({
        dataPrincipalRef: "subject:opaque-1",
        controllerId: "acme",
        recipientRoles: { "seller:1": "third-party" },
      })
    );
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const result = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(result.allowed, false);
        assert.equal(result.reason, "privacy denied");
      }
    );
  });

  it("denies ptf_request_action in privacy mode and never leaks store detail on corruption", async () => {
    const { dir, configPath } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const action = await call("ptf_request_action", {
          cmd: "/send",
          resource: "message:1",
        });
        assert.match(
          JSON.stringify(action.error ?? action.result),
          /not supported|privacy mode/
        );
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
        writeFileSync(join(dir, "privacy-state.json"), "corrupt");
        const failed = await call("ptf_present_data", {
          termsDigest: out.termsDigest,
          nonce: "unique-privacy-nonce-02",
        });
        const text = JSON.stringify(failed);
        assert.match(text, /privacy denied/);
        assert.doesNotMatch(
          text,
          /privacy-state|keystore|DEK|kid|[A-Za-z]:[\\/]/i
        );
      }
    );
  });

  it("preserves legacy disabled mode without requiring a privacy basis", async () => {
    const { dir } = setup(false);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
      },
      async (call) => {
        const out = resultData(
          await call("ptf_request_data", {
            purpose: "support",
            resource: "personal-state",
            verifier: "verifier",
            claims: ["email"],
          })
        );
        assert.equal(out.allowed, true);
      }
    );
  });

  it("returns a journaled payment receipt after a post-effect crash without a new challenge", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(proposal.allowed, true);
        digest = proposal.termsDigest;
        seedPaymentJournal(dir, digest);
        seedPaymentEvent(dir, digest, "OUTCOME_UNKNOWN");

        // No recipient proof: the journal must win before the challenge
        // branch, otherwise this would return needProof or burn authority.
        const paid = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(paid.receiptId, "receipt-1");
        assert.equal(paid.amount, 100);
        assert.equal(paid.currency, "INR");
        assert.equal(paid.transaction, "provider-tx-1");

        const checked = resultData(
          await call("ptf_check", { termsDigest: digest })
        );
        assert.equal(checked.status, "executed");
        assert.equal(checked.receipt.receiptId, "receipt-1");

        const fetched = resultData(
          await call("ptf_get_receipt", { termsDigest: digest })
        );
        assert.equal(fetched.status, "executed");
        assert.equal(fetched.receipt.receiptId, "receipt-1");
      }
    );
    const events = paymentEventRepo(dir).findByAttempt(digest, digest);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.state, "SUCCEEDED");
    assert.equal(events[0]?.evidenceRef, "journal:receipt-1");
  });

  it("reconstructs missing processing evidence from a succeeded journal", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        seedPaymentJournal(dir, digest);
        // Deliberately no Processing Event: the journal proves the effect,
        // and recovery must fill the missing evidence rather than deny.
        const paid = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(paid.receiptId, "receipt-1");
      }
    );
    const events = paymentEventRepo(dir).findByAttempt(digest, digest);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.state, "SUCCEEDED");
  });

  it("recovers a spent single-use payment without consuming again", async () => {
    const { dir, configPath, recipientDer, recipientPub } = setup(true, 1);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        const challenge = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        const { createPrivateKey } = await import("node:crypto");
        const privateKey = createPrivateKey({
          key: Buffer.from(recipientDer),
          format: "der",
          type: "pkcs8",
        });
        const signature = signBytes(
          privateKey,
          new Uint8Array(Buffer.from(challenge.cidHex, "hex"))
        );
        const paid = resultData(
          await call("ptf_redeem", {
            termsDigest: digest,
            recipientKeyHex: Buffer.from(recipientPub).toString("hex"),
            recipientSigHex: Buffer.from(signature).toString("hex"),
          })
        );
        assert.ok(paid.receiptId);
      }
    );
    // Simulate the crash window: the effect and journal exist, but the
    // proposal transition did not land. Reopen it as pending with no receipt.
    const proposalPath = join(dir, "proposals", `${digest}.json`);
    const stored = JSON.parse(readFileSync(proposalPath, "utf8")) as Record<
      string,
      unknown
    >;
    delete stored["receipt"];
    stored["state"] = "pending";
    writeFileSync(proposalPath, JSON.stringify(stored));
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const replay = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.ok(replay.receiptId);
        assert.equal(replay.amount, 100);
      }
    );
    const used = Object.fromEntries(loadAuthority(dir).snapshot().used);
    assert.equal(used["grant-payment"], 1);
  });

  it("surfaces journal ambiguity as outcome_unknown rather than denial", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        mkdirSync(join(dir, "executions"), { recursive: true });
        writeFileSync(join(dir, "executions", "corrupt.json"), "{not-json");

        const replay = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(replay.status, "outcome_unknown");
        assert.match(replay.instruction, /[Rr]econcile/);

        const checked = resultData(
          await call("ptf_check", { termsDigest: digest })
        );
        assert.equal(checked.status, "outcome_unknown");
        const fetched = resultData(
          await call("ptf_get_receipt", { termsDigest: digest })
        );
        assert.equal(fetched.status, "outcome_unknown");
      }
    );
    const stillPending = JSON.parse(
      readFileSync(join(dir, "proposals", `${digest}.json`), "utf8")
    ) as { state: string };
    assert.equal(stillPending.state, "pending");
  });

  it("does not return a receipt when journal fields drift from the proposal", async () => {
    const { dir, configPath } = setup(true);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        seedPaymentJournal(dir, proposal.termsDigest, {
          recipient: "attacker:1",
        });
        const replay = resultData(
          await call("ptf_redeem", { termsDigest: proposal.termsDigest })
        );
        assert.equal(replay.status, "outcome_unknown");
      }
    );
  });

  it("reports a journal/event terminal conflict without denying the proposal", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        seedPaymentJournal(dir, digest);
        seedPaymentEvent(dir, digest, "FAILED_FINAL");
        const replay = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(replay.status, "evidence_conflict");
        assert.equal(replay.processingState, "FAILED_FINAL");
      }
    );
    const stillPending = JSON.parse(
      readFileSync(join(dir, "proposals", `${digest}.json`), "utf8")
    ) as { state: string };
    assert.equal(stillPending.state, "pending");
  });

  it("keeps a journaled receipt readable after the grant is revoked", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        seedPaymentJournal(dir, digest);
      }
    );
    // The operator revokes the grant out of band. Revocation stops NEW
    // effects; it does not unmake a recorded one.
    const auth = loadAuthority(dir, {
      nowSec: () => Math.floor(Date.now() / 1000),
    });
    auth.revoke("grant-payment");
    saveAuthority(dir, auth);
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const replay = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(replay.receiptId, "receipt-1");
        // A NEW proposal for the same terms is denied: revocation holds.
        const fresh = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        assert.equal(fresh.allowed, false);
        assert.equal(fresh.reason, "revoked");
      }
    );
  });

  it("reports a never-submitted attempt as not_submitted without spending authority", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    await withRpc(
      {
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "privacy-test-pass",
        PTF_MCP_PRINCIPAL: P,
        PTF_MCP_ACTOR: A,
        PTF_MCP_PRIVACY_CONFIG: configPath,
      },
      async (call) => {
        const proposal = resultData(
          await call("ptf_propose", {
            cmd: "/pay",
            purpose: "support",
            resource: "invoice:1",
            recipient: "seller:1",
            amount: 100,
            currency: "INR",
          })
        );
        digest = proposal.termsDigest;
        // A prepared row: the provider was never called, so no money moved.
        seedUnsubmittedPaymentJournal(dir, digest);
        const attempt = resultData(
          await call("ptf_redeem", { termsDigest: digest })
        );
        assert.equal(attempt.status, "not_submitted");
        assert.match(attempt.instruction, /no payment was made/);
        const checked = resultData(
          await call("ptf_check", { termsDigest: digest })
        );
        assert.equal(checked.status, "outcome_unknown");
      }
    );
    const stillPending = JSON.parse(
      readFileSync(join(dir, "proposals", `${digest}.json`), "utf8")
    ) as { state: string };
    assert.equal(stillPending.state, "pending");
    const used = Object.fromEntries(
      loadAuthority(dir, {
        nowSec: () => Math.floor(Date.now() / 1000),
      }).snapshot().used
    );
    assert.equal(used["grant-payment"], undefined);
  });

  it("recovers journal-backed status across a server restart", async () => {
    const { dir, configPath } = setup(true);
    let digest = "";
    const env = {
      PTF_STORE_DIR: dir,
      PTF_PASSPHRASE: "privacy-test-pass",
      PTF_MCP_PRINCIPAL: P,
      PTF_MCP_ACTOR: A,
      PTF_MCP_PRIVACY_CONFIG: configPath,
    };
    await withRpc(env, async (call) => {
      const proposal = resultData(
        await call("ptf_propose", {
          cmd: "/pay",
          purpose: "support",
          resource: "invoice:1",
          recipient: "seller:1",
          amount: 100,
          currency: "INR",
        })
      );
      digest = proposal.termsDigest;
    });
    seedPaymentJournal(dir, digest);
    seedPaymentEvent(dir, digest, "OUTCOME_UNKNOWN");
    await withRpc(env, async (call) => {
      const checked = resultData(
        await call("ptf_check", { termsDigest: digest })
      );
      assert.equal(checked.status, "executed");
      assert.equal(checked.receipt.receiptId, "receipt-1");
      const paid = resultData(
        await call("ptf_redeem", { termsDigest: digest })
      );
      assert.equal(paid.receiptId, "receipt-1");
    });
  });
});
