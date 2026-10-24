import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Authority, generateEd25519Keypair, signBytes, makeFakeProviders } from "../src/index.js";
import { createHostRedemptionChallenge, createProtectedEffect } from "../src/hostkit/index.js";
const NOW=1_800_000_000, P="owner", A="agent-a", M="provider:email";
const ingress={id:A,principal:P,source:"local-registration" as const,proofRef:"test"};
const operation={action:{name:"/email/send" as const},resource:{type:"email-message",id:"msg:1"},purpose:"delegated-email",context:{messageId:"msg:1",recipient:M}};
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"ptf-replay-"));
  const auth=new Authority({nowSec:()=>NOW});
  auth.addGrant({id:"g-email",principal:P,actor:{kind:"exact",id:A},action:{name:"/email/send"},bounds:[],exp:NOW+200,maxUses:1});
  const owner=generateEd25519Keypair(), recipient=generateEd25519Keypair();
  const keys=new Map([[P,owner.publicKeyRaw],[M,recipient.publicKeyRaw]]);
  const challenge=createHostRedemptionChallenge({
    operation,ingress,recipient:M,principalPrivateKey:owner.privateKey,
    resolveKey:(id)=>keys.get(id)??null,nowSec:()=>NOW
  });
  const redemption=challenge.redeem({
    key:recipient.publicKeyRaw,sig:signBytes(recipient.privateKey,Buffer.from(challenge.cidHex,"hex"))
  });
  const provider=makeFakeProviders({nowSec:()=>NOW}).email;
  const make=()=>createProtectedEffect({
    dir,auth,ingress,operation,authorizedContext:operation.context,now:()=>NOW,
    processing:{kind:"not-enforced" as const,reason:"synthetic-no-personal-data" as const},
    effect:{kind:"provider" as const, provider,redemption},
    persistAuthority:()=>{},
  });
  return {dir,auth,provider,make};
}
describe("journal-first canonical effect",()=>{
  it("returns already completed exact outcome without consuming live authority again",async()=>{
    const f=fixture();
    try {
      const first=await f.make().run();
      assert.equal(f.auth.snapshot().used.length,1);
      assert.equal(f.provider.calls.length,1);
      const second=await f.make().run();
      assert.deepEqual(second,first);
      assert.equal(f.provider.calls.length,1);
    }finally{rmSync(f.dir,{recursive:true,force:true})}
  });
});
