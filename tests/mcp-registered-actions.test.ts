import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import {
  Authority, RecipientRegistry, generateEd25519Keypair, makeFakeProviders,
  saveAuthority, saveRegistry, sealKeystore, signBytes
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

});
