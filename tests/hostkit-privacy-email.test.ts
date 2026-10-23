import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority, PrivacyRuntime,
  type PrivacySnapshot, type PrivacyProfile,
  type PrivacyEventRepository, type ProcessingEventPrepare,
  type ProcessingEventRecord, type ProcessingEventFinalize
} from "../src/index.js";
import { createProtectedEffect } from "../src/hostkit/index.js";

const NOW = 1_800_000_000;
const ingress = { id: "agent-email", principal: "owner", source: "local-registration" as const, proofRef: "host-registry" };
const operation = {
  action: { name: "/email/send" as const },
  resource: { type: "email-message", id: "msg:1" },
  context: { messageId: "msg:1", recipient: "provider:email" },
  purpose: "delegated-email"
};
const processing = {
  authorityPrincipal: "owner", actor: "agent-email",
  dataPrincipalRef: "subject:opaque-email-1", controllerId: "host",
  action: "/email/send" as const, resource: { type: "email-message", id: "msg:1" },
  purpose: "delegated-email", dataCategories: ["contact"],
  recipients: [{ id: "provider:email", role: "third-party" as const }]
};
const profile: PrivacyProfile = {
  id: "synthetic-reference", revision: "1",
  validate: ({basis}) => basis.active ?
    {ok:true,controlRefs:["synthetic-processing"]} :
    {ok:false,reason:"basis-inactive"}
};
function snapshot(active: boolean): PrivacySnapshot {
  return {
    notices: [], consents: [], holds: [], revision: active ? 1 : 2,
    bases: [{
      kind: "certain-legitimate-use", id: "basis-email", controllerId: "host",
      purpose: "delegated-email", dataCategories: ["contact"],
      provisionRef: "synthetic-reference", evidenceRef: "operator-declared",
      assertedBy: "trusted-host", active
    }],
    activities: [{
      id: "activity-email", profileId: "synthetic-reference",
      authorityPrincipal: "owner", controllerId: "host",
      subjects: { kind: "exact", ref: "subject:opaque-email-1" },
      action: "/email/send", resourceType: "email-message", purpose: "delegated-email",
      dataCategories: ["contact"],
      recipients: [{id:"provider:email",role:"third-party"}],
      basisId: "basis-email", active:true
    }]
  };
}
class Events implements PrivacyEventRepository {
  readonly entries = new Map<string, ProcessingEventRecord>();
  prepare(input: ProcessingEventPrepare): ProcessingEventRecord {
    if (this.entries.size) throw Error("duplicate event");
    const r: ProcessingEventRecord = {
      ...input, eventId: "pev-reference", idempotencyKey: "key-reference",
      state: "PREPARED"
    };
    this.entries.set(r.eventId, r); return r;
  }
  load(id: string) { return this.entries.get(id) ?? null; }
  transition(id: string, to: "SUCCEEDED" | "FAILED_FINAL" | "OUTCOME_UNKNOWN", patch: ProcessingEventFinalize): ProcessingEventRecord {
    const prior = this.load(id); if (!prior) throw Error("missing");
    const value: ProcessingEventRecord = {
      ...prior, state: to, finalizedAt: patch.finalizedAt,
      ...(patch.evidenceRef ? {evidenceRef:patch.evidenceRef} : {})
    };
    this.entries.set(id,value); return value;
  }
  findByKey() { return this.entries.values().next().value ?? null; }
  listBySubject(ref: string) { return [...this.entries.values()].filter(e=>e.dataPrincipalRef===ref); }
  recoverPrepared() { return []; }
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"ptf-email-privacy-"));
  const auth=new Authority({nowSec:()=>NOW});
  auth.addGrant({
    id:"email-g1",principal:"owner",actor:{kind:"exact",id:"agent-email"},
    action:{name:"/email/send"}, bounds:[], exp:NOW+600,maxUses:1,
  });
  const events=new Events();
  const state={active:true};
  const runtime=new PrivacyRuntime({
    loadPrivacy:()=>snapshot(state.active),events,profile,nowSec:()=>NOW
  });
  const gate={authority:auth,ingress,operation,processing};
  return {dir,auth,events,state,runtime,gate};
}
describe("generic host processing with optional privacy profile",()=>{
  it("precommits privacy evidence before consumption and finalizes on effect",async()=>{
    const f=fixture(); let effects=0;
    try {
      const e=createProtectedEffect({
        dir:f.dir, auth:f.auth, ingress, operation, authorizedContext:operation.context,
        now:()=>NOW, processing:{kind:"enforced",runtime:f.runtime,gate:f.gate},
        effect:{kind:"trusted-callback",execute:async(ctx)=>{
          assert.equal(f.events.entries.size,1,"processing precommit required");
          assert.equal(f.auth.snapshot().used.length,1,"authority consumed before effect");
          ctx.markEffectStarted(); effects++;
          return { receiptId:"email-receipt",capabilityId:"host-only",
            recipient:"provider:email",resource:"msg:1",purpose:"delegated-email",
            transaction:"synthetic-email",termsDigest:ctx.termsDigest,at:NOW };
        }},
        persistAuthority:()=>{}
      });
      assert.equal((await e.check()).allow,true);
      assert.equal(f.events.entries.size,0);
      const result=await e.run();
      assert.equal(result.privacyEventId,"pev-reference");
      assert.equal("eventId" in result,false);
      assert.equal(effects,1);
      assert.equal(f.events.load("pev-reference")?.state,"SUCCEEDED");
    }finally{rmSync(f.dir,{recursive:true,force:true})}
  });
  it("withdrawn processing basis denies with no consumption or effect",async()=>{
    const f=fixture();let effects=0;
    try {
      const e=createProtectedEffect({
        dir:f.dir,auth:f.auth,ingress,operation,authorizedContext:operation.context,
        now:()=>NOW,processing:{kind:"enforced",runtime:f.runtime,gate:f.gate},
        effect:{kind:"trusted-callback",execute:async()=>{effects++}},
        persistAuthority:()=>{}
      });
      assert.equal((await e.check()).allow,true);
      f.state.active=false;
      await assert.rejects(()=>e.run(),/privacy denied/);
      assert.equal(f.auth.snapshot().used.length,0);
      assert.equal(f.events.entries.size,0);
      assert.equal(effects,0);
    }finally{rmSync(f.dir,{recursive:true,force:true})}
  });
  it("a withdrawal after precommit still fences the external effect",async()=>{
    const f=fixture();let effects=0;
    try {
      const e=createProtectedEffect({
        dir:f.dir,auth:f.auth,ingress,operation,authorizedContext:operation.context,
        now:()=>NOW,processing:{kind:"enforced",runtime:f.runtime,gate:f.gate},
        effect:{kind:"trusted-callback",execute:async()=>{effects++}},
        persistAuthority:()=>{f.state.active=false}
      });
      await assert.rejects(()=>e.run(),/privacy denied/);
      assert.equal(f.events.load("pev-reference")?.state,"FAILED_FINAL");
      assert.equal(f.auth.snapshot().used.length,1);
      assert.equal(effects,0);
    }finally{rmSync(f.dir,{recursive:true,force:true})}
  });
});
