import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  Authority, RecipientRegistry, generateEd25519Keypair, makeFakeProviders,
  saveAuthority, saveRegistry, loadAuthority, sealKeystore, signBytes,
  AgentRegistry, saveAgents, loadAgents,
  PrivacyRuntime, type AuthorityRequest, type VerifiedIdentity,
  type PrivacyEventRepository, type ProcessingEventRecord,
  type ProcessingEventPrepare, type ProcessingEventFinalize, type PrivacySnapshot
} from "../src/index.js";
import { createPtfServer } from "../src/mcp-server.js";

const NOW=1_800_000_000, P="did:test:owner", A="did:test:agent", B="did:test:other", M="did:test:mail";
function seed() {
  const dir=mkdtempSync(join(tmpdir(),"ptf-mcp-reg-"));
  const owner=generateEd25519Keypair(), recipient=generateEd25519Keypair();
  const auth=new Authority({nowSec:()=>NOW});
  auth.addGrant({
    id:"email-a", principal:P, actor:{kind:"exact",id:A}, action:{name:"/email/send"},
    bounds:[
      {path:".context.messageId",op:"==",value:"msg:1"},
      {path:".context.recipient",op:"==",value:M},
    ],
    exp:NOW+300,maxUses:1
  });
  saveAuthority(dir,auth);
  const reg=new RecipientRegistry(()=>NOW);
  reg.register(P,owner.publicKeyRaw,NOW);
  reg.register(M,recipient.publicKeyRaw,NOW);
  saveRegistry(dir,reg);
  writeFileSync(join(dir,"keystore.json"),JSON.stringify(sealKeystore({
    [P]:new Uint8Array(owner.privateKey.export({format:"der",type:"pkcs8"}))
  },"pw")));
  return {dir,owner,recipient};
}
async function connect(server: ReturnType<typeof createPtfServer>) {
  const [client,serverTransport]=InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const callbacks=new Map<number,(result:Record<string,unknown>)=>void>();
  client.onmessage=(packet)=>{
    if("id" in packet && typeof packet.id === "number") {
      callbacks.get(packet.id)?.(packet as Record<string,unknown>);
      callbacks.delete(packet.id);
    }
  };
  await client.start();
  let id=0;
  async function call(method:string,params:Record<string,unknown>={}) {
    const key=++id;
    const result=new Promise<Record<string,unknown>>((resolve,reject)=>{
      const timer=setTimeout(()=>{callbacks.delete(key);reject(Error("rpc timeout: "+method))},8000);
      callbacks.set(key,(packet)=>{clearTimeout(timer);resolve(packet)});
    });
    await client.send({jsonrpc:"2.0",id:key,method,params} as Parameters<typeof client.send>[0]);
    return result;
  }
  await call("initialize",{protocolVersion:"2026-07-28",capabilities:{},clientInfo:{name:"test",version:"1"}});
  return {call,close:async()=>{await client.close();await server.close()}};
}
function decode(response:Record<string,unknown>) {
  const result=response["result"] as { content?: Array<{text?:string}>,isError?:boolean } | undefined;
  const text=result?.content?.[0]?.text ?? "{}";
  let body:Record<string,unknown>;
  try { body=JSON.parse(text) as Record<string,unknown>; }
  catch { body={message:text}; }
  return {body, error:result?.isError===true || response["error"]!==undefined};
}
const demand={
  cmd:"/email/send",purpose:"delegated-email",resource:"msg:1",
  resourceType:"email-message",context:{messageId:"msg:1",recipient:M}
};
describe("host-registered generic MCP effect",()=>{
  it("allows exact action proposal→proof→receipt with one provider call and no new tool",async()=>{
    const fx=seed();const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const registration={
      action:"/email/send" as const,
      provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:(d:{context:Readonly<Record<string,unknown>>})=>{
        const c=d.context;
        if(Object.keys(c).sort().join(",")!=="messageId,recipient" ||
          !/^msg:[a-z0-9]+$/.test(String(c["messageId"])) || c["recipient"]!==M) {
          throw new Error("unregistered email context");
        }
      }
    };
    const server=createPtfServer({dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW,registeredActions:[registration]});
    const wire=await connect(server);
    try {
      const proposal=decode(await wire.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      assert.equal(proposal.body["allowed"],true);
      const digest=proposal.body["termsDigest"] as string;
      const challenge=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      assert.equal(challenge.body["needProof"],true);
      const cid=challenge.body["cidHex"] as string;
      const result=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{
        termsDigest:digest, recipientKeyHex:Buffer.from(fx.recipient.publicKeyRaw).toString("hex"),
        recipientSigHex:Buffer.from(signBytes(fx.recipient.privateKey,Buffer.from(cid,"hex"))).toString("hex")
      }}));
      assert.equal(result.error,false);
      assert.equal(result.body["action"],"/email/send");
      assert.equal(provider.calls.length,1);
      assert.equal(JSON.stringify(result.body).includes("privateKey"),false);
      const again=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      assert.equal(again.error,false);
      assert.equal(again.body["receiptId"],result.body["receiptId"]);
      assert.equal(provider.calls.length,1);
    }finally{await wire.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("keeps generic action proposals non-executable without registration",async()=>{
    const fx=seed();
    const server=createPtfServer({dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW});
    const wire=await connect(server);
    try {
      const proposal=decode(await wire.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      assert.equal(proposal.body["allowed"],true);
      const proof=decode(await wire.call("tools/call",{name:"ptf_redeem",
        arguments:{termsDigest:proposal.body["termsDigest"]}}));
      assert.equal(proof.error,true);
    }finally{await wire.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("refuses extra email fields and an agent-selected processing mode",async()=>{
    const fx=seed();
    const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const registration={
      action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:(d:{context:Readonly<Record<string,unknown>>})=>{
        if(Object.keys(d.context).sort().join(",")!=="messageId,recipient" ||
            d.context["messageId"]!=="msg:1" || d.context["recipient"]!==M) throw Error("bad handles");
      }
    };
    const server=createPtfServer({dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,
      now:()=>NOW,registeredActions:[registration]});
    const wire=await connect(server);
    try {
      const malicious=decode(await wire.call("tools/call",{name:"ptf_request_action",
        arguments:{...demand,context:{...demand.context,body:"private",processing:{kind:"not-enforced"}}}}));
      assert.equal(malicious.body["allowed"],false);
      assert.equal(provider.calls.length,0);
    }finally{await wire.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("fails closed when a host privacy profile is configured but an action does not bind a gate",async()=>{
    const fx=seed();const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const server=createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW,
      privacy:{dataPrincipalRef:"subject:opaque-email-1",controllerId:"test",
        recipientRoles:{[M]:"third-party"}},
      registeredActions:[{
        action:"/email/send",provider,
        processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
        validate:()=>{}
      }]
    });
    const wire=await connect(server);
    try{
      const proposal=decode(await wire.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      assert.equal(proposal.body["allowed"],false);
      assert.equal(provider.calls.length,0);
    }finally{await wire.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("does not reveal another actor's stored proposal or receipt",async()=>{
    const fx=seed();const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const registration={
      action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:()=>{}
    };
    const a=await connect(createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW,registeredActions:[registration]
    }));
    let digest:string;
    try {
      const propose=decode(await a.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      digest=propose.body["termsDigest"] as string;
      assert.equal(propose.body["allowed"],true);
    }finally{await a.close()}
    const b=await connect(createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:B,now:()=>NOW,registeredActions:[registration]
    }));
    try {
      for(const name of ["ptf_check","ptf_get_receipt","ptf_redeem"]) {
        const response=decode(await b.call("tools/call",{name,arguments:{termsDigest:digest}}));
        assert.equal(response.error,true,name+" must deny an unrelated actor");
      }
      assert.equal(provider.calls.length,0);
    }finally{await b.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("rejects wildcard, duplicate and reserved trusted registrations",()=>{
    const fx=seed();const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const good={action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"synthetic-no-personal-data" as const}),
      validate:()=>{}};
    try {
      assert.throws(()=>createPtfServer({
        dir:fx.dir,env:{},principal:P,actor:A,
        registeredActions:[good,good]
      }),/registration/);
      assert.throws(()=>createPtfServer({
        dir:fx.dir,env:{},principal:P,actor:A,
        registeredActions:[{...good,action:"/email/*" as const}]
      }),/registration/);
      assert.throws(()=>createPtfServer({
        dir:fx.dir,env:{},principal:P,actor:A,
        registeredActions:[{...good,action:"/pay" as const}]
      }),/registration/);
    }finally{rmSync(fx.dir,{recursive:true,force:true})}
  });

  it("quarantines unknown external provider outcomes across an MCP server restart",async()=>{
    const fx=seed();let submits=0;
    const provider={
      kind:"email" as const,namespace:"email",
      submit:async():Promise<never>=>{submits++;throw Error("timed out after submit")},
      verify:()=>({ok:true as const})
    };
    const registration={
      action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:()=>{}
    };
    const make=()=>createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW,registeredActions:[registration]
    });
    const first=await connect(make());let digest:string;
    try{
      const p=decode(await first.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      digest=p.body["termsDigest"] as string;
      const ch=decode(await first.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      const cid=ch.body["cidHex"] as string;
      const res=decode(await first.call("tools/call",{name:"ptf_redeem",arguments:{
        termsDigest:digest,
        recipientKeyHex:Buffer.from(fx.recipient.publicKeyRaw).toString("hex"),
        recipientSigHex:Buffer.from(signBytes(fx.recipient.privateKey,Buffer.from(cid,"hex"))).toString("hex")
      }}));
      assert.equal(res.body["status"],"outcome_unknown");
      assert.equal(submits,1);
    }finally{await first.close()}
    const resumed=await connect(make());
    try {
      const res=decode(await resumed.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      assert.equal(res.body["status"],"outcome_unknown");
      assert.equal(submits,1,"unknown effect must not submit again");
    }finally{await resumed.close();rmSync(fx.dir,{recursive:true,force:true})}
  });
  it("supports two independently authorized actors while keeping their digests isolated",async()=>{
    const fx=seed();
    const auth=loadAuthority(fx.dir,{nowSec:()=>NOW});
    auth.addGrant({id:"email-b",principal:P,actor:{kind:"exact",id:B},
      action:{name:"/email/send"},bounds:[],exp:NOW+300,maxUses:1});
    saveAuthority(fx.dir,auth);
    const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const registration={action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:()=>{}};
    const digests:string[]=[];
    try{
      for(const actor of [A,B]){
        const wire=await connect(createPtfServer({
          dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor,now:()=>NOW,
          registeredActions:[registration]
        }));
        try{
          const proposal=decode(await wire.call("tools/call",{name:"ptf_request_action",arguments:demand}));
          assert.equal(proposal.body["allowed"],true);
          const digest=proposal.body["termsDigest"] as string;
          digests.push(digest);
          const ch=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
          const out=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{
            termsDigest:digest,
            recipientKeyHex:Buffer.from(fx.recipient.publicKeyRaw).toString("hex"),
            recipientSigHex:Buffer.from(signBytes(fx.recipient.privateKey,Buffer.from(ch.body["cidHex"] as string,"hex"))).toString("hex")
          }}));
          assert.equal(out.error,false);
          assert.equal(out.body["action"],"/email/send");
        }finally{await wire.close()}
      }
      assert.notEqual(digests[0],digests[1],"agent identity must bind digest");
      assert.equal(provider.calls.length,2);
    }finally{rmSync(fx.dir,{recursive:true,force:true})}
  });

  it("executes a registered action under enforced privacy and finalizes evidence",async()=>{
    const fx=seed();const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const eventRows=new Map<string,ProcessingEventRecord>();
    const events:PrivacyEventRepository={
      prepare:(input:ProcessingEventPrepare)=>{
        const row:ProcessingEventRecord={...input,eventId:"pev-email-mcp",idempotencyKey:"email-mcp",state:"PREPARED"};
        if(eventRows.has(row.eventId))throw Error("duplicate event");
        eventRows.set(row.eventId,row);return row;
      },
      load:(id)=>eventRows.get(id)??null,
      transition:(id,to,patch:ProcessingEventFinalize)=>{
        const prior=eventRows.get(id);if(prior===undefined)throw Error("missing event");
        const next:ProcessingEventRecord={...prior,state:to,finalizedAt:patch.finalizedAt,
          ...(patch.evidenceRef===undefined?{}:{evidenceRef:patch.evidenceRef})};
        eventRows.set(id,next);return next;
      },
      findByKey:()=>[...eventRows.values()][0]??null,
      listBySubject:(ref)=>[...eventRows.values()].filter(e=>e.dataPrincipalRef===ref),
      recoverPrepared:()=>[]
    };
    const snapshot:PrivacySnapshot={
      notices:[],consents:[],holds:[],revision:1,
      bases:[{kind:"certain-legitimate-use",id:"basis-email",controllerId:"host",
        purpose:"delegated-email",dataCategories:["email"],
        provisionRef:"reference-only",evidenceRef:"operator:synthetic",
        assertedBy:"host-test",active:true}],
      activities:[{id:"activity-email",profileId:"synthetic-email",authorityPrincipal:P,
        controllerId:"host",subjects:{kind:"exact",ref:"subject:opaque-email-1"},
        action:"/email/send",resourceType:"email-message",purpose:"delegated-email",
        dataCategories:["email"],recipients:[{id:M,role:"third-party"}],
        basisId:"basis-email",active:true}]
    };
    const registration={
      action:"/email/send" as const,provider,
      validate:(d:{context:Readonly<Record<string,unknown>>})=>{
        if(Object.keys(d.context).sort().join(",")!=="messageId,recipient")throw Error("unexpected fields");
      },
      processing:(d:AuthorityRequest,ingress:VerifiedIdentity,auth:Authority)=>{
        const runtime=new PrivacyRuntime({
          loadPrivacy:()=>snapshot, events,
          profile:{id:"synthetic-email",revision:"1",
            validate:()=>({ok:true as const,controlRefs:["synthetic-test"]})},
          nowSec:()=>NOW
        });
        return {kind:"enforced" as const,runtime,
          gate:{authority:auth,ingress,operation:{action:d.action,resource:d.resource,context:d.context,
            ...(d.purpose===undefined?{}:{purpose:d.purpose})},
            processing:{authorityPrincipal:P,actor:ingress.id,
              dataPrincipalRef:"subject:opaque-email-1",controllerId:"host",
              action:d.action.name,resource:d.resource,
              purpose:d.purpose??"",dataCategories:["email"],
              recipients:[{id:M,role:"third-party" as const}]}}
        };
      }
    };
    const server=createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor:A,now:()=>NOW,
      privacy:{dataPrincipalRef:"subject:opaque-email-1",controllerId:"host",
        recipientRoles:{[M]:"third-party"},actionCategories:{"/email/send":["email"]}},
      registeredActions:[registration]
    });
    const wire=await connect(server);
    try {
      const p=decode(await wire.call("tools/call",{name:"ptf_request_action",arguments:demand}));
      assert.equal(p.body["allowed"],true);
      const digest=p.body["termsDigest"] as string;
      const ch=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      assert.equal(ch.body["needProof"],true);
      const result=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{
        termsDigest:digest,
        recipientKeyHex:Buffer.from(fx.recipient.publicKeyRaw).toString("hex"),
        recipientSigHex:Buffer.from(signBytes(fx.recipient.privateKey,
          Buffer.from(ch.body["cidHex"] as string,"hex"))).toString("hex")
      }}));
      assert.equal(result.error,false);
      assert.equal(result.body["privacyEventId"],"pev-email-mcp");
      assert.equal(eventRows.get("pev-email-mcp")?.state,"SUCCEEDED");
      assert.equal(provider.calls.length,1);
      // Simulate the process crashing after provider journal commit but before
      // the durable proposal transition, with independent privacy evidence
      // missing. The provider outcome is proven, the processing evidence is
      // a reported gap, and there must be NO new submission.
      const proposalPath=join(fx.dir,"proposals",digest+".json");
      const row=JSON.parse(readFileSync(proposalPath,"utf8")) as Record<string,unknown>;
      row["state"]="pending";delete row["receipt"];
      writeFileSync(proposalPath,JSON.stringify(row));
      eventRows.clear();
      const replay=decode(await wire.call("tools/call",{name:"ptf_redeem",arguments:{termsDigest:digest}}));
      assert.equal(replay.body["status"],"executed");
      assert.equal(replay.body["processingEvidence"],"gap");
      const persistent = decode(await wire.call("tools/call", {
        name: "ptf_get_receipt", arguments: { termsDigest: digest }
      }));
      assert.equal(
        (persistent.body["receipt"] as Record<string, unknown>)?.["processingEvidence"],
        "gap",
        "evidence gap must remain visible after stored proposal recovery"
      );
      const repeated=decode(await wire.call("tools/call",{
        name:"ptf_redeem",arguments:{termsDigest:digest}
      }));
      assert.equal(repeated.body["processingEvidence"],"gap");
      assert.equal(provider.calls.length,1);
    }finally{await wire.close();rmSync(fx.dir,{recursive:true,force:true})}
  });

  it("retires a registered agent before redemption while preserving another agent's grant",async()=>{
    const fx=seed();
    const membership=new AgentRegistry(()=>NOW);
    membership.register(A,undefined,NOW);
    membership.register(B,undefined,NOW);
    saveAgents(fx.dir,membership);
    const auth=loadAuthority(fx.dir,{nowSec:()=>NOW});
    auth.addGrant({id:"email-b-registered",principal:P,actor:{kind:"exact",id:B},
      action:{name:"/email/send"},bounds:[],exp:NOW+300,maxUses:1});
    saveAuthority(fx.dir,auth);
    const provider=makeFakeProviders({nowSec:()=>NOW}).email;
    const registration={action:"/email/send" as const,provider,
      processing:()=>({kind:"not-enforced" as const,reason:"no-host-privacy-profile-configured" as const}),
      validate:()=>{}};
    const make=(actor:string)=>createPtfServer({
      dir:fx.dir,env:{PTF_PASSPHRASE:"pw"},principal:P,actor,now:()=>NOW,
      registeredActions:[registration]
    });
    const a=await connect(make(A));
    try {
      const proposal=decode(await a.call("tools/call",{
        name:"ptf_request_action",arguments:demand
      }));
      assert.equal(proposal.body["allowed"],true);
      const digest=proposal.body["termsDigest"] as string;
      const agents=loadAgents(fx.dir);
      agents.remove(A,NOW);
      saveAgents(fx.dir,agents);
      for (const name of ["ptf_redeem","ptf_check","ptf_get_receipt"]) {
        const denied=decode(await a.call("tools/call",{
          name,arguments:{termsDigest:digest}
        }));
        assert.equal(denied.error,true,"retired actor denied at "+name);
      }
    } finally { await a.close(); }
    const b=await connect(make(B));
    try {
      const proposal=decode(await b.call("tools/call",{
        name:"ptf_request_action",arguments:demand
      }));
      assert.equal(proposal.body["allowed"],true);
      const digest=proposal.body["termsDigest"] as string;
      const ch=decode(await b.call("tools/call",{
        name:"ptf_redeem",arguments:{termsDigest:digest}
      }));
      assert.equal(ch.body["needProof"],true);
      const done=decode(await b.call("tools/call",{
        name:"ptf_redeem",arguments:{
          termsDigest:digest,
          recipientKeyHex:Buffer.from(fx.recipient.publicKeyRaw).toString("hex"),
          recipientSigHex:Buffer.from(signBytes(fx.recipient.privateKey,
            Buffer.from(ch.body["cidHex"] as string,"hex"))).toString("hex"),
        }
      }));
      assert.equal(done.error,false);
      assert.equal(done.body["action"],"/email/send");
      assert.equal(provider.calls.length,1);
    } finally {
      await b.close();
      rmSync(fx.dir,{recursive:true,force:true});
    }
  });

});
