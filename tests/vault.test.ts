import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,
  Disclose,
  FileAuditLog,
  VaultStore,
  claimsSubset,
  createVaultDek,
  ensureVaultDek,
  generateEd25519Keypair,
  loadVault,
  migrateVault,
  putRecord,
  readForPurpose,
  rotateVaultDek,
  saveVault,
  useCredential,
  VAULT_DEK_ALIAS,
  VAULT_DEK_NEXT_ALIAS,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const OTHER = "did:test:other-agent";
const VERIFIER = "did:test:verifier";
const SECRET = "PAN-SECRET-4111-never-leaves-host";
// One DEK across test stores (the DEK is not dir-bound; each test seals its
// own tmp dir with it).
const DEK = createVaultDek();

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "ptf-vault-"));
}

function discloseGrant(auth: Authority): void {
  auth.addGrant({
    id: "g-disclose",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/disclose" },
    bounds: claimsSubset(["email", "phone"]),
    exp: NOW + 3600,
  });
}

function useGrant(auth: Authority): void {
  auth.addGrant({
    id: "g-use",
    principal: P,
    actor: { kind: "exact", id: A },
    action: { name: "/use" },
    bounds: [{ path: ".context.claim", op: "==", value: "pan" }],
    exp: NOW + 3600,
  });
}

function ingressFor(actor: string) {
  return {
    id: actor,
    principal: P,
    source: "local-registration" as const,
    proofRef: "vault-test",
  };
}

describe("durable Personal State vault (P0 slice 1)", () => {
  it("puts, persists, and reads general records holder-signed", () => {
    const dir = tmp();
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    discloseGrant(auth);
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, vault, { dek: DEK });
    const reloaded = loadVault(dir, { dek: DEK });
    const pres = readForPurpose(reloaded, {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"],
      verifier: VERIFIER,
      resource: { type: "vault", id: "personal-state" },
      nonce: "n-1",
      nowSec: NOW,
      authority: auth,
      holder: { id: P, privateKey: holder.privateKey },
    });
    assert.equal(pres.sig.length, 64);
    const verified = Disclose.verify(pres, {
      holderKey: holder.publicKeyRaw,
      expectedAud: VERIFIER,
      nowSec: NOW,
    });
    assert.equal(verified.ok, true);
    assert.deepEqual(
      pres.disclosures.map((d) => d.name),
      ["email"]
    );
  });

  it("denies wrong purpose, wrong agent, and expiry", () => {
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    discloseGrant(auth);
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-phone",
      owner: P,
      type: "phone",
      value: "+91-999",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: NOW + 600,
    });
    const base = {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["phone"] as readonly string[],
      verifier: VERIFIER,
      resource: { type: "vault", id: "personal-state" },
      nonce: "n-x",
      nowSec: NOW,
      authority: auth,
      holder: { id: P, privateKey: holder.privateKey },
    };
    assert.throws(
      () => readForPurpose(vault, { ...base, purpose: "marketing" }),
      /authority denied|no records/
    );
    assert.throws(
      () => readForPurpose(vault, { ...base, ingress: ingressFor(OTHER) }),
      /authority denied|agent denied|no records/
    );
    assert.throws(
      () => readForPurpose(vault, { ...base, nowSec: NOW + 3600 }),
      /expired|no records|authority/
    );
  });

  it("never returns secret via read; useCredential is the sole path and never leaks", async () => {
    const dir = tmp();
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    discloseGrant(auth);
    useGrant(auth);
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
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, vault, { dek: DEK });
    // Read path drops secrets: requesting only pan fails closed.
    assert.throws(
      () =>
        readForPurpose(vault, {
          ingress: ingressFor(A),
          purpose: "pay",
          requested: ["pan"],
          verifier: VERIFIER,
          resource: { type: "vault", id: "personal-state" },
          nonce: "n-secret",
          nowSec: NOW,
          authority: auth,
          holder: { id: P, privateKey: holder.privateKey },
        }),
      /authority denied|no records/
    );
    // In-host use sees the value; the caller only gets a receipt.
    let seenInHost: unknown;
    const out = await useCredential(vault, {
      ingress: ingressFor(A),
      recordId: "r-pan",
      purpose: "pay",
      authority: auth,
      nowSec: NOW,
      use: async (instr) => {
        seenInHost = instr.value;
        assert.equal(instr.recordId, "r-pan");
        assert.equal(instr.type, "pan");
        return { receipt: "host-receipt-1", names: ["pan"] };
      },
    });
    assert.equal(seenInHost, SECRET);
    assert.equal(out.receipt, "host-receipt-1");
    assert.ok(!JSON.stringify(out).includes(SECRET));
    // A leaking callback fails closed instead of minting a tainted receipt.
    await assert.rejects(
      () =>
        useCredential(vault, {
          ingress: ingressFor(A),
          recordId: "r-pan",
          purpose: "pay",
          authority: auth,
          nowSec: NOW,
          use: async () => ({ receipt: `echo ${SECRET}` }),
        }),
      /leaked secret/
    );
  });

  it("revision CAS mirrors authority stores", () => {
    const dir = tmp();
    const seed = new VaultStore(() => NOW);
    seed.putRecord({
      id: "r1",
      owner: P,
      type: "email",
      value: "a@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, seed, { dek: DEK });
    const a = loadVault(dir, { dek: DEK });
    const b = loadVault(dir, { dek: DEK });
    a.putRecord({
      id: "r2",
      owner: P,
      type: "phone",
      value: "x",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, a, { dek: DEK });
    b.putRecord({
      id: "r3",
      owner: P,
      type: "phone",
      value: "y",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    assert.throws(() => saveVault(dir, b, { dek: DEK }), /changed under us/);
    assert.throws(
      () => saveVault(dir, new VaultStore(() => NOW), { dek: DEK }),
      /never loaded|changed under us/
    );
    const h = loadVault(dir, { dek: DEK });
    rmSync(join(dir, "personal-state.json"));
    h.putRecord({
      id: "r4",
      owner: P,
      type: "email",
      value: "z",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    assert.throws(() => saveVault(dir, h, { dek: DEK }), /store missing/);
  });

  it("audits puts/reads with ids only — values never enter the log", () => {
    const dir = tmp();
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    discloseGrant(auth);
    const audit = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);
    const vault = new VaultStore(() => NOW);
    const rec = putRecord(
      dir,
      vault,
      {
        id: "r-email",
        owner: P,
        type: "email",
        value: "owner@example.com",
        sensitivity: "general",
        source: "user",
        allowedPurposes: ["support"],
        allowedAgents: [A],
        expiresAt: null,
      },
      { audit, dek: DEK }
    );
    assert.equal(rec.id, "r-email");
    const loaded = loadVault(dir, { dek: DEK });
    const pres = readForPurpose(loaded, {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"],
      verifier: VERIFIER,
      resource: { type: "vault", id: "personal-state" },
      nonce: "n-audit",
      nowSec: NOW,
      authority: auth,
      holder: { id: P, privateKey: holder.privateKey },
      audit,
    });
    assert.equal(pres.disclosures.length, 1);
    const blob = readFileSync(join(dir, "audit.jsonl"), "utf8");
    assert.ok(blob.includes("r-email"));
    assert.ok(blob.includes("email"));
    assert.ok(!blob.includes("owner@example.com"));
    assert.ok(!blob.includes(SECRET));
    // Corrupt files fail closed.
    writeFileSync(join(dir, "personal-state.json"), "{nope");
    assert.throws(() => loadVault(dir, { dek: DEK }));
  });

  it("encrypts values at rest (AES-256-GCM under a keystore DEK)", () => {
    const dir = tmp();
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, vault, { dek: DEK });
    const blob = readFileSync(join(dir, "personal-state.json"), "utf8");
    const parsed = JSON.parse(blob) as Record<string, unknown>;
    assert.equal(parsed["version"], 2);
    assert.ok(typeof parsed["ctHex"] === "string");
    assert.ok(!blob.includes("owner@example.com"), "ciphertext only");
    assert.ok(!blob.includes("r-email"), "ids authenticated, not visible");
    // Wrong DEK fails closed without revealing anything.
    assert.throws(
      () => loadVault(dir, { dek: createVaultDek() }),
      /decryption failed/
    );
    // Missing DEK fails closed.
    assert.throws(() => loadVault(dir), /DEK required/);
    // Tampered ciphertext fails closed.
    const tampered = {
      ...(parsed as Record<string, unknown>),
      ctHex: `00${(parsed["ctHex"] as string).slice(2)}`,
    };
    writeFileSync(join(dir, "personal-state.json"), JSON.stringify(tampered));
    assert.throws(() => loadVault(dir, { dek: DEK }), /decryption failed/);
  });

  it("refuses legacy plaintext and migrates explicitly", () => {
    const dir = tmp();
    writeFileSync(
      join(dir, "personal-state.json"),
      JSON.stringify({
        records: [
          {
            id: "r-email",
            owner: P,
            type: "email",
            value: "owner@example.com",
            sensitivity: "general",
            source: "user",
            allowedPurposes: ["support"],
            allowedAgents: [A],
            expiresAt: null,
            version: 1,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        revision: 0,
      })
    );
    assert.throws(() => loadVault(dir, { dek: DEK }), /legacy plaintext/);
    assert.throws(
      () => saveVault(dir, new VaultStore(() => NOW), { dek: DEK }),
      /legacy plaintext/
    );
    // Explicit one-time migration seals the same records under the DEK.
    const migrated = migrateVault(dir, { dek: DEK });
    assert.equal(migrated.records, 1);
    const after = loadVault(dir, { dek: DEK });
    assert.equal(after.loadedRevision(), 0);
    // DEK custody helper generates once, then reuses.
    const fresh = ensureVaultDek({});
    assert.equal(fresh.created, true);
    assert.equal(ensureVaultDek(fresh.keys).created, false);
    // Rotation re-seals under a new DEK; the old DEK stops working.
    const newDek = createVaultDek();
    rotateVaultDek(dir, after, { dek: DEK, newDek });
    assert.throws(() => loadVault(dir, { dek: DEK }), /decryption failed/);
    const rotated = loadVault(dir, { dek: newDek });
    assert.equal(rotated.loadedRevision(), 1);
  });

  it("rotation crash windows stay recoverable via kid resolution", () => {
    const dir = tmp();
    const dekA = createVaultDek();
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r1",
      owner: P,
      type: "email",
      value: "a@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    saveVault(dir, vault, { dek: dekA });
    const keysA = { [VAULT_DEK_ALIAS]: dekA };
    // Crash after staging next, before reseal: current still opens.
    const dekB = createVaultDek();
    const staged = { ...keysA, [VAULT_DEK_NEXT_ALIAS]: dekB };
    assert.equal(loadVault(dir, { keys: staged }).loadedRevision(), 0);
    // Reseal under B while the keystore still carries both: opens via next.
    const loaded = loadVault(dir, { dek: dekA });
    rotateVaultDek(dir, loaded, { dek: dekA, newDek: dekB });
    assert.equal(loadVault(dir, { keys: staged }).loadedRevision(), 1);
    assert.throws(() => loadVault(dir, { dek: dekA }), /decryption failed/);
    // Promote: current-only keystore opens.
    assert.equal(
      loadVault(dir, { keys: { [VAULT_DEK_ALIAS]: dekB } }).loadedRevision(),
      1
    );
  });

  it("one-time approvals cover exactly one disclosure and one secret use", async () => {
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    auth.createApproval({
      id: "ap-disc",
      principal: P,
      actor: A,
      action: { name: "/disclose" },
      resource: { type: "vault", id: "personal-state" },
      context: { claims: ["email"], verifier: VERIFIER },
      purpose: "support",
      ttlSec: 600,
      maxUses: 1,
    });
    auth.createApproval({
      id: "ap-use",
      principal: P,
      actor: A,
      action: { name: "/use" },
      resource: { type: "vault-record", id: "r-pan" },
      context: { claim: "pan" },
      purpose: "pay",
      ttlSec: 600,
      maxUses: 1,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
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
    const readReq = {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"] as readonly string[],
      verifier: VERIFIER,
      nonce: "n-once",
      nowSec: NOW,
      authority: auth,
      resource: { type: "vault", id: "personal-state" },
      holder: { id: P, privateKey: holder.privateKey },
    };
    const pres = readForPurpose(vault, readReq);
    assert.deepEqual(
      pres.disclosures.map((d) => d.name),
      ["email"]
    );
    // Second disclosure under the spent approval fails closed.
    assert.throws(
      () => readForPurpose(vault, { ...readReq, nonce: "n-once-2" }),
      /uses-exhausted|authority denied/
    );
    const out = await useCredential(vault, {
      ingress: ingressFor(A),
      recordId: "r-pan",
      purpose: "pay",
      authority: auth,
      nowSec: NOW,
      use: async () => ({ receipt: "host-receipt-1" }),
    });
    assert.equal(out.receipt, "host-receipt-1");
    await assert.rejects(
      () =>
        useCredential(vault, {
          ingress: ingressFor(A),
          recordId: "r-pan",
          purpose: "pay",
          authority: auth,
          nowSec: NOW,
          use: async () => ({ receipt: "host-receipt-2" }),
        }),
      /uses-exhausted|authority denied/
    );
  });

  it("resource-constrained grants bind the vault read", () => {
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    auth.addGrant({
      id: "g-vault-elsewhere",
      principal: P,
      actor: { kind: "exact", id: A },
      action: { name: "/disclose" },
      resource: { type: "vault", id: "other-state" },
      bounds: claimsSubset(["email"]),
      exp: NOW + 3600,
    });
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email",
      owner: P,
      type: "email",
      value: "owner@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const req = {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"] as readonly string[],
      verifier: VERIFIER,
      nonce: "n-res",
      nowSec: NOW,
      authority: auth,
      resource: { type: "vault", id: "personal-state" },
      holder: { id: P, privateKey: holder.privateKey },
    };
    // Proposed resource (vault:personal-state) is not what the grant covers.
    assert.throws(() => readForPurpose(vault, req), /authority denied/);
  });

  it("same-type ambiguity fails closed instead of guessing", () => {
    const holder = generateEd25519Keypair();
    const auth = new Authority({ nowSec: () => NOW });
    discloseGrant(auth);
    const vault = new VaultStore(() => NOW);
    vault.putRecord({
      id: "r-email-old",
      owner: P,
      type: "email",
      value: "old@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    vault.putRecord({
      id: "r-email-new",
      owner: P,
      type: "email",
      value: "new@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: null,
    });
    const req = {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"],
      verifier: VERIFIER,
      nonce: "n-ambiguous",
      nowSec: NOW,
      authority: auth,
      resource: { type: "vault", id: "personal-state" },
      holder: { id: P, privateKey: holder.privateKey },
    };
    assert.throws(() => readForPurpose(vault, req), /ambiguous claim email/);
    // Retire the stale record by expiring it: one live record per type.
    vault.putRecord({
      id: "r-email-old",
      owner: P,
      type: "email",
      value: "old@example.com",
      sensitivity: "general",
      source: "user",
      allowedPurposes: ["support"],
      allowedAgents: [A],
      expiresAt: NOW - 1,
    });
    const pres = readForPurpose(vault, { ...req, nonce: "n-retired" });
    assert.equal(pres.disclosures.length, 1);
    assert.equal(pres.disclosures[0]?.value, "new@example.com");
  });
});
