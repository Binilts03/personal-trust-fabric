import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Authority,
  PrivacyStore,
  VaultStore,
  RecipientRegistry,
  createPrivacyDek,
  createVaultDek,
  generateEd25519Keypair,
  saveAuthority,
  savePrivacyStore,
  saveRegistry,
  saveVault,
  sealKeystore,
  claimsSubset,
  PRIVACY_DEK_ALIAS,
  VAULT_DEK_ALIAS,
} from "../src/index.js";

const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));
const P = "did:test:p";
const A = "did:test:a";

function setup(active: boolean): { dir: string; configPath: string } {
  const at = Math.floor(Date.now() / 1000);
  const dir = mkdtempSync(join(tmpdir(), "ptf-privacy-mcp-"));
  const principal = generateEd25519Keypair();
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
  saveAuthority(dir, auth);
  const registry = new RecipientRegistry(() => at);
  registry.register(P, principal.publicKeyRaw, at);
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
    dataCategories: ["email"],
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
  savePrivacyStore(dir, privacy, { dek: privacyDek });

  const principalSeed = new Uint8Array(
    principal.privateKey.export({ format: "der", type: "pkcs8" })
  );
  writeFileSync(
    join(dir, "keystore.json"),
    JSON.stringify(sealKeystore({
      [P]: principalSeed,
      [VAULT_DEK_ALIAS]: vaultDek,
      [PRIVACY_DEK_ALIAS]: privacyDek,
    }, "privacy-test-pass"))
  );
  const configPath = join(dir, "privacy-config.json");
  writeFileSync(configPath, JSON.stringify({
    dataPrincipalRef: "subject:opaque-1",
    controllerId: "acme",
    recipientRoles: { verifier: "third-party" },
  }));
  return { dir, configPath };
}

async function withRpc<T>(
  env: Record<string,string>,
  test: (call: (name:string,args:Record<string,unknown>) => Promise<any>) => Promise<T>
): Promise<T> {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe","pipe","pipe"],
  });
  let buffer = "";
  const waits = new Map<number, (value:any) => void>();
  let id = 0;
  let stderr = "";
  child.stderr?.on("data", (buf:Buffer) => { stderr += buf.toString(); });
  child.stdout?.on("data", (buf:Buffer) => {
    buffer += buf.toString();
    let nl = -1;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0,nl).trim();
      buffer = buffer.slice(nl+1);
      if (!line) continue;
      const response = JSON.parse(line);
      const done = waits.get(response.id);
      if (done) { waits.delete(response.id); done(response); }
    }
  });
  const rpc = (method:string,params:unknown):Promise<any> => {
    const key=++id;
    return new Promise((resolve,reject) => {
      const timer=setTimeout(()=>{waits.delete(key);reject(new Error("MCP timeout: "+method+" "+stderr.slice(0,1200)));},12000);
      waits.set(key,(x)=>{clearTimeout(timer);resolve(x);});
      child.stdin?.write(JSON.stringify({jsonrpc:"2.0",id:key,method,params})+"\n");
    });
  };
  try {
    const init=await rpc("initialize",{protocolVersion:"2026-07-28",capabilities:{},clientInfo:{name:"privacy-test",version:"1"}});
    assert.ok(init.result?.serverInfo);
    return await test((name,args)=>rpc("tools/call",{name,arguments:args}));
  } finally {
    child.kill();
  }
}

function resultData(response:any): any {
  const text = response.result?.content?.[0]?.text;
  if(typeof text !== "string") throw new Error("No MCP text: "+JSON.stringify(response));
  return JSON.parse(text);
}

describe("opt-in privacy disclosure over stdio",()=>{
  it("denies a valid authority when its privacy basis is inactive",async()=>{
    const {dir,configPath}=setup(false);
    await withRpc({
      PTF_STORE_DIR:dir,PTF_PASSPHRASE:"privacy-test-pass",
      PTF_MCP_PRINCIPAL:P,PTF_MCP_ACTOR:A,
      PTF_MCP_PRIVACY_CONFIG:configPath,
    },async(call)=>{
      const out=resultData(await call("ptf_request_data",{
        purpose:"support",resource:"personal-state",verifier:"verifier",claims:["email"],
      }));
      assert.equal(out.allowed,false);
      assert.equal(out.reason,"privacy denied");
    });
  });

  it("permits authorised+privacy-approved disclosure and records an encrypted event",async()=>{
    const {dir,configPath}=setup(true);
    await withRpc({
      PTF_STORE_DIR:dir,PTF_PASSPHRASE:"privacy-test-pass",
      PTF_MCP_PRINCIPAL:P,PTF_MCP_ACTOR:A,
      PTF_MCP_PRIVACY_CONFIG:configPath,
    },async(call)=>{
      const out=resultData(await call("ptf_request_data",{
        purpose:"support",resource:"personal-state",verifier:"verifier",claims:["email"],
      }));
      assert.equal(out.allowed,true);
      const presented=resultData(await call("ptf_present_data",{
        termsDigest:out.termsDigest,nonce:"unique-privacy-nonce-01",
      }));
      assert.equal(presented.presented,true);
      assert.equal(presented.disclosed[0],"email");
    });
    assert.equal(readdirSync(join(dir,"privacy-events")).length,1);
  });

  it("preserves legacy disabled mode without requiring a privacy basis",async()=>{
    const {dir}=setup(false);
    await withRpc({
      PTF_STORE_DIR:dir,PTF_PASSPHRASE:"privacy-test-pass",
      PTF_MCP_PRINCIPAL:P,PTF_MCP_ACTOR:A,
    },async(call)=>{
      const out=resultData(await call("ptf_request_data",{
        purpose:"support",resource:"personal-state",verifier:"verifier",claims:["email"],
      }));
      assert.equal(out.allowed,true);
    });
  });
});
