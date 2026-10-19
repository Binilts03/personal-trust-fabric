import type { AuthorityRequest, VerifiedIdentity } from "../core/authority.js";
import {
  assertOpaquePrivacySubjectRef,
  type PrivacyRecipientRole,
  type SubjectAssurance,
} from "./model.js";
import type { PrivacyGateRequest } from "./runtime.js";

export interface McpPrivacyConfig {
  readonly dataPrincipalRef: string;
  readonly controllerId: string;
  readonly recipientRoles: Readonly<Record<string, PrivacyRecipientRole>>;
  readonly subjectAssurance?: SubjectAssurance;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mcp privacy: operator configuration must be an object");
  }
  return value as Record<string, unknown>;
}

function required(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveMcpPrivacyConfig(value: unknown): McpPrivacyConfig {
  const raw = record(value);
  for (const name of Object.keys(raw)) {
    if (!["dataPrincipalRef", "controllerId", "recipientRoles", "subjectAssurance"].includes(name)) {
      throw new Error("mcp privacy: unexpected operator configuration field");
    }
  }
  assertOpaquePrivacySubjectRef(raw["dataPrincipalRef"]);
  if (!required(raw["controllerId"])) {
    throw new Error("mcp privacy: controllerId required");
  }
  const recipients = record(raw["recipientRoles"]);
  const roles: Record<string, PrivacyRecipientRole> = {};
  const allowed = new Set(["data-processor", "data-fiduciary", "third-party", "other"]);
  for (const [id, role] of Object.entries(recipients)) {
    if (!required(id) || typeof role !== "string" || !allowed.has(role)) {
      throw new Error("mcp privacy: invalid recipient role");
    }
    roles[id] = role as PrivacyRecipientRole;
  }
  const assurance = raw["subjectAssurance"];
  if (assurance === undefined) {
    return {
      dataPrincipalRef: raw["dataPrincipalRef"],
      controllerId: raw["controllerId"],
      recipientRoles: roles,
    };
  }
  const parsed = record(assurance);
  if (
    !["adult", "child", "guardian-assisted"].includes(String(parsed["classification"])) ||
    !required(parsed["proofRef"]) ||
    !required(parsed["assertedBy"]) ||
    Object.keys(parsed).some((k) => !["classification", "proofRef", "assertedBy"].includes(k))
  ) {
    throw new Error("mcp privacy: invalid subject assurance");
  }
  return {
    dataPrincipalRef: raw["dataPrincipalRef"],
    controllerId: raw["controllerId"],
    recipientRoles: roles,
    subjectAssurance: {
      classification: parsed["classification"] as SubjectAssurance["classification"],
      proofRef: parsed["proofRef"],
      assertedBy: parsed["assertedBy"],
    },
  };
}

/**
 * Only the trusted host configuration determines subject/controller/recipient
 * role. The agent's request determines which categories are requested, but
 * never which legal basis authorizes them.
 */
export function makeMcpPrivacyDisclosureGate(
  config: McpPrivacyConfig,
  ingress: VerifiedIdentity,
  demand: AuthorityRequest
): Omit<PrivacyGateRequest, "authority"> {
  const claims = demand.context["claims"];
  const verifier = demand.context["verifier"];
  if (
    demand.principal !== ingress.principal ||
    demand.actor !== ingress.id ||
    demand.action.name !== "/disclose" ||
    !Array.isArray(claims) ||
    claims.length === 0 ||
    !claims.every(required) ||
    !required(verifier)
  ) {
    throw new Error("privacy denied");
  }
  const role = Object.hasOwn(config.recipientRoles, verifier)
    ? config.recipientRoles[verifier]
    : undefined;
  if (role === undefined) throw new Error("privacy denied");
  return {
    ingress,
    operation: {
      action: demand.action,
      resource: demand.resource,
      context: demand.context,
      ...(demand.purpose !== undefined ? { purpose: demand.purpose } : {}),
    },
    // Runtime caller binds Authority separately; host must set it.
    processing: {
      authorityPrincipal: ingress.principal,
      actor: ingress.id,
      dataPrincipalRef: config.dataPrincipalRef,
      controllerId: config.controllerId,
      action: demand.action.name,
      resource: { type: demand.resource.type, id: demand.resource.id },
      purpose: demand.purpose ?? "",
      dataCategories: claims,
      recipients: [{ id: verifier, role }],
      ...(config.subjectAssurance !== undefined
        ? { subjectAssurance: config.subjectAssurance }
        : {}),
    },
  };
}
