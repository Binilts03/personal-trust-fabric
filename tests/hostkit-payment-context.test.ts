import { describe,it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Authority,Capabilities,generateEd25519Keypair,
  digestForOperation,leafCidHex,signBytes,makeFakeProviders,paymentBounds
} from "../src/index.js";
import { createProtectedEffect } from "../src/hostkit/index.js";
const NOW=1_800_000_000;
describe("legacy payment terms through canonical Host Kit",()=>{
  it("binds payment amount/currency and recipient separately without reauthorizing unbound context",async()=>{
    const dir=mkdtempSync(join(tmpdir(),"ptf-pay-seam-"));
    try {
      const P="owner", A="agent", M="merchant";
      const owner=generateEd25519Keypair(), recipient=generateEd25519Keypair();
      const keys=new Map([[P,owner.publicKeyRaw],[M,recipient.publicKeyRaw]]);
      const auth=new Authority({nowSec:()=>NOW});
      auth.addGrant({
        id:"g-pay",principal:P,actor:{kind:"exact",id:A},
        action:{name:"/pay"},bounds:paymentBounds({amountMax:500,currency:"INR"}),
        exp:NOW+600,maxUses:1
      });
      const ingress={id:A,principal:P,source:"local-registration" as const,proofRef:"test"};
      const operation={
        action:{name:"/pay" as const},resource:{type:"ptf-resource",id:"invoice:1"},
        context:{amount:100,currency:"INR",recipient:M},purpose:"settle"
      };
      const termsDigest=digestForOperation({...operation,principal:P,actor:A});
      const caps=new Capabilities({resolveKey:(id)=>keys.get(id)??null,nowSec:()=>NOW});
      const cap=caps.issue(null,{
        iss:P,aud:A,sub:P,cmd:"/pay",pol:[["<=",".amount",100]],
        purpose:"settle",resource:"invoice:1",recipient:M,amountMax:100,currency:"INR",
        termsDigest,exp:NOW+300,maxUses:1,
      },owner.privateKey);
      const id=leafCidHex(cap);
      const proof=caps.redeem([cap],{
        cmd:"/pay",args:{amount:100,currency:"INR"},recipient:M,
        resource:"invoice:1",purpose:"settle",termsDigest,
      },{proof:{key:recipient.publicKeyRaw,sig:signBytes(recipient.privateKey,Buffer.from(id,"hex"))}});
      if(!proof.ok)throw Error("unexpected signed proof denial: "+proof.reason);
      const provider=makeFakeProviders({nowSec:()=>NOW}).payment;
      const effect=createProtectedEffect({
        dir,auth,ingress,operation,authorizedContext:proof.operation.args,now:()=>NOW,
        processing:{kind:"not-enforced",reason:"synthetic-no-personal-data"},
        effect:{kind:"provider",provider,redemption:proof},
        persistAuthority:()=>{}
      });
      const receipt=await effect.run();
      assert.equal(receipt.action,"/pay");
      assert.equal(receipt.resource,"invoice:1");
      assert.equal(provider.calls.length,1);
      assert.equal(auth.snapshot().used.length,1);
    }finally{rmSync(dir,{recursive:true,force:true})}
  });
});
