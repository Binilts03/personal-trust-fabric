import type { KeyObject } from "node:crypto";
import { Capabilities, leafCidHex } from "../core/capability.js";
import { type AuthorityOperation, type VerifiedIdentity } from "../core/authority.js";
import { publicKeyFromPrivate, rawPublicKey } from "../core/crypto.js";
import type { KeyResolver, Redemption } from "../core/types.js";
import { hostTermsDigest } from "./boundary.js";

/**
 * Trusted-host-only helper. The caller supplies verified identity and the
 * principal's private key; neither the key nor a capability token is sent to
 * an agent. This does NOT itself confer standing Authority or execute.
 */
export interface HostRedemptionChallenge {
  readonly cidHex: string;
  redeem(proof: { readonly key: Uint8Array; readonly sig: Uint8Array }): Redemption;
}

export function createHostRedemptionChallenge(input: {
  readonly operation: AuthorityOperation;
  readonly ingress: VerifiedIdentity;
  readonly recipient: string;
  readonly principalPrivateKey: KeyObject;
  readonly resolveKey: KeyResolver;
  readonly nowSec: () => number;
}): HostRedemptionChallenge {
  const { operation, ingress, recipient } = input;
  const action = operation.action.name;
  if (action === "/pay" || action.startsWith("/pay/") ||
      action === "/disclose" || action.startsWith("/disclose/")) {
    throw new Error("host redemption: reserved domain; use existing entry point");
  }
  if (!operation.purpose || !operation.resource.id ||
      typeof recipient !== "string" || recipient.length === 0 ||
      operation.context["recipient"] !== recipient) {
    throw new Error("host redemption: resource, purpose and exact recipient required");
  }
  const expectedIssuer = input.resolveKey(ingress.principal);
  const publicIssuer = rawPublicKey(publicKeyFromPrivate(input.principalPrivateKey));
  if (expectedIssuer === null ||
      !Buffer.from(expectedIssuer).equals(Buffer.from(publicIssuer))) {
    throw new Error("host redemption: signer is not the verified principal");
  }
  if (input.resolveKey(recipient) === null) {
    throw new Error("host redemption: unknown recipient key");
  }
  const digest = hostTermsDigest(operation, ingress);
  const capabilities = new Capabilities({ resolveKey: input.resolveKey, nowSec: input.nowSec });
  const capability = capabilities.issue(null, {
    iss: ingress.principal,
    aud: ingress.id,
    sub: ingress.principal,
    cmd: action,
    pol: [],
    purpose: operation.purpose,
    resource: operation.resource.id,
    recipient,
    exp: input.nowSec() + 300,
    maxUses: 1,
    termsDigest: digest,
  }, input.principalPrivateKey);
  const cidHex = leafCidHex(capability);
  return Object.freeze({
    cidHex,
    redeem(proof: { readonly key: Uint8Array; readonly sig: Uint8Array }): Redemption {
      const outcome = capabilities.redeem([capability], {
        cmd: action, args: { ...operation.context }, recipient,
        resource: operation.resource.id, purpose: operation.purpose,
        termsDigest: digest,
      }, { proof });
      if (!outcome.ok) {
        throw new Error("host redemption denied: " + outcome.reason);
      }
      return outcome;
    }
  });
}
