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
  generateEd25519Keypair,
  loadVault,
  putRecord,
  readForPurpose,
  saveVault,
  useCredential,
} from "../src/index.js";

const NOW = 1_700_000_000;
const P = "did:test:owner";
const A = "did:test:agent";
const OTHER = "did:test:other-agent";
const VERIFIER = "did:test:verifier";
const SECRET = "PAN-SECRET-4111-never-leaves-host";

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
    saveVault(dir, vault);
    const reloaded = loadVault(dir);
    const pres = readForPurpose(reloaded, {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"],
      verifier: VERIFIER,
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
    saveVault(dir, vault);
    // Read path drops secrets: requesting only pan fails closed.
    assert.throws(
      () =>
        readForPurpose(vault, {
          ingress: ingressFor(A),
          purpose: "pay",
          requested: ["pan"],
          verifier: VERIFIER,
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
    saveVault(dir, seed);
    const a = loadVault(dir);
    const b = loadVault(dir);
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
    saveVault(dir, a);
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
    assert.throws(() => saveVault(dir, b), /changed under us/);
    assert.throws(
      () => saveVault(dir, new VaultStore(() => NOW)),
      /never loaded|changed under us/
    );
    const h = loadVault(dir);
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
    assert.throws(() => saveVault(dir, h), /store missing/);
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
      { audit }
    );
    assert.equal(rec.id, "r-email");
    const loaded = loadVault(dir);
    const pres = readForPurpose(loaded, {
      ingress: ingressFor(A),
      purpose: "support",
      requested: ["email"],
      verifier: VERIFIER,
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
    assert.throws(() => loadVault(dir));
  });
});
