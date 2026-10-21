#!/usr/bin/env node
// PTF vertical: a DPDP-shaped consent gateway for one clinic, one lab, one
// Data Principal.
//
// Run: npm run build && node examples/dpdp-consent-gateway.mjs
//
// The scenario: a clinic (Data Fiduciary) shares a Data Principal's diagnostic
// summary with a lab (Data Processor). The lab's agent asks for the minimised
// claim set. The host-kit boundary decides authority, then privacy, then writes
// the Processing Event, and only then releases the claims. The Data Principal
// then withdraws consent, and the next attempt is stopped before anything
// leaves. Finally the Data Principal asks for erasure, and the exact records
// bound to that Data Principal's reference go.
//
// Ground rules this script keeps:
//   - no credentials, no network, and no state outside a temp dir it removes
//   - no personal values in the output: claim NAMES and opaque refs only
//   - no internal deny reasons: a failure prints the operator's coarse wording
//   - no legal claim: the script exercises controls, it certifies nothing
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  Authority,
  FileAuditLog,
  VaultStore,
  claimsSubset,
  digestForOperation,
  ensureVaultDek,
  eraseRecord,
  generateEd25519Keypair,
  planErasure,
  putRecord,
  saveAuthority,
  summarizeProcessing,
} from "../dist/src/index.js";
import {
  PrivacyStore,
  ensurePrivacyDek,
  savePrivacyStore,
} from "../dist/src/store/privacy.js";
import { FilePrivacyEventRepository } from "../dist/src/store/privacy-events.js";
import {
  createEffectBoundary,
  privacyForHostOperation,
} from "../dist/src/hostkit/index.js";

// A fixed clock keeps this transcript byte-for-byte reproducible.
const NOW = 1767225600; // 2026-01-01T00:00:00Z
const STAMP = new Date(NOW * 1000).toISOString().replace(".000Z", "Z");

const CLINIC = "did:example:clinic"; // the Data Fiduciary (authority principal)
const LAB_AGENT = "did:example:lab-agent"; // the verified actor
const LAB = "did:example:lab"; // the Data Processor (recipient)
const SUBJECT = "subject:opq-4a32c9"; // the Data Principal's opaque host ref
const CONTROLLER = "clinic:northside"; // the Data Fiduciary's id (API field)
const PURPOSE = "diagnostic-analysis";
const RESOURCE = { type: "diagnostic-summary", id: "summary:opq-1" };
const REQUESTED = ["diagnostic-summary", "lab-order-id", "patient-name"];

// Personal values. They live in the encrypted vault and nowhere else.
const VALUE_SUMMARY = "SENTINEL-HBA1C-9.1-DO-NOT-PRINT";
const VALUE_ORDER = "SENTINEL-ORDER-4417-DO-NOT-PRINT";
const VALUE_NAME = "SENTINEL-PATIENT-NAME-DO-NOT-PRINT";

const dir = mkdtempSync(join(tmpdir(), "ptf-dpdp-vertical-"));
const printed = [];

/** The run leaves nothing behind: the store it made is removed on exit. */
function cleanup() {
  rmSync(dir, { recursive: true, force: true });
}
process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function say(line = "") {
  printed.push(line);
  console.log(line);
}

/**
 * The authority with one deliberate seam: a withdrawal can be armed to land
 * the instant the boundary consumes authority - that is, after the live
 * recheck and before the effect-boundary fence. It is the window ADR-0024's
 * fence exists to close, and it is the only way to reproduce it in a
 * sequential script.
 */
class WithdrawalRace extends Authority {
  constructor(opts) {
    super(opts);
    this.onConsume = null;
  }

  evaluate(operation, ingress, opts = {}) {
    const decision = super.evaluate(operation, ingress, opts);
    if (opts.consume === true && this.onConsume !== null) {
      const fire = this.onConsume;
      this.onConsume = null;
      fire();
    }
    return decision;
  }
}

try {
  // ---------------------------------------------------------------------
  // The store: one temporary directory, encrypted at rest, removed at exit.
  // ---------------------------------------------------------------------
  const keys = {};
  ensurePrivacyDek(keys);
  const vaultKey = ensureVaultDek(keys);
  Object.assign(keys, vaultKey.keys);
  const privacyDek = keys["ptf/privacy-dek"];
  const vaultDek = keys["ptf/vault-dek"];
  const audit = FileAuditLog.open(join(dir, "audit.jsonl"), () => NOW);

  const authority = new WithdrawalRace({ nowSec: () => NOW });
  authority.addGrant({
    id: "g-disclose-lab",
    principal: CLINIC,
    actor: { kind: "exact", id: LAB_AGENT },
    action: { name: "/disclose" },
    resource: RESOURCE,
    purpose: PURPOSE,
    bounds: claimsSubset(REQUESTED),
    exp: NOW + 3600,
  });
  saveAuthority(dir, authority);

  const ingress = {
    id: LAB_AGENT,
    principal: CLINIC,
    source: "local-registration",
    proofRef: "example",
  };
  const holder = generateEd25519Keypair();

  say("PTF - DPDP consent gateway (vertical)");
  say(
    "clinic (Data Fiduciary) -> lab (Data Processor); one Data Principal, one disclosure"
  );
  say(`data principal reference: ${SUBJECT} (opaque, minted by the host)`);
  say(`clock: ${STAMP} (fixed, so this transcript is reproducible)`);
  say("store: a temporary directory, removed when the script exits");
  say();

  // ---------------------------------------------------------------------
  // Step 1 - the operator records what may happen.
  // ---------------------------------------------------------------------
  const privacyStore = new PrivacyStore(() => NOW);
  privacyStore.addNotice({
    id: "n-1",
    controllerId: CONTROLLER,
    dataPrincipalRef: SUBJECT,
    purpose: PURPOSE,
    dataCategories: REQUESTED,
    noticeRef: "notice:opq-2026-01",
    noticeHash: "sha256:6f1c2a9d4b7e",
    presentedAt: NOW,
    assertedBy: "clinic-privacy-office",
    language: "en",
    version: "2026-01",
  });
  privacyStore.addConsent({
    id: "c-1",
    noticeId: "n-1",
    controllerId: CONTROLLER,
    dataPrincipalRef: SUBJECT,
    purpose: PURPOSE,
    dataCategories: REQUESTED,
    givenAt: NOW,
    method: "in-person",
    proofRef: "consent-form:opq-2026-01",
    assertedBy: "clinic-privacy-office",
  });
  privacyStore.addBasis({
    kind: "consent",
    id: "b-1",
    controllerId: CONTROLLER,
    dataPrincipalRef: SUBJECT,
    purpose: PURPOSE,
    dataCategories: REQUESTED,
    consentId: "c-1",
    assertedBy: "clinic-privacy-office",
    active: true,
  });
  privacyStore.addBasis({
    kind: "certain-legitimate-use",
    id: "b-2",
    controllerId: CONTROLLER,
    purpose: "clinical-utility-review",
    dataCategories: ["diagnostic-summary"],
    provisionRef: "dpdp:s7:clinical-utility",
    evidenceRef: "policy:clinical-utility-2026",
    assertedBy: "clinic-privacy-office",
    active: true,
  });
  privacyStore.addActivity({
    id: "a-1",
    profileId: "IN-DPDP-2025",
    authorityPrincipal: CLINIC,
    controllerId: CONTROLLER,
    subjects: { kind: "exact", ref: SUBJECT },
    action: "/disclose",
    resourceType: RESOURCE.type,
    purpose: PURPOSE,
    dataCategories: REQUESTED,
    recipients: [{ id: LAB, role: "data-processor" }],
    basisId: "b-1",
    active: true,
  });
  savePrivacyStore(dir, privacyStore, { dek: privacyDek });

  say(
    "step 1 - the operator records what may happen (encrypted privacy state)"
  );
  say("  notice    n-1   the notice the Data Principal saw for this purpose");
  say("  consent   c-1   affirmative consent, bound to notice n-1");
  say("  basis     b-1   consent basis, bound to consent c-1");
  say(
    "  basis     b-2   certain-legitimate-use basis (recorded; no activity uses it here)"
  );
  say("  activity  a-1   /disclose for the lab, bound to basis b-1");
  say();

  // ---------------------------------------------------------------------
  // Step 2 - the clinic's vault holds the Data Principal's records.
  // ---------------------------------------------------------------------
  const vault = new VaultStore(() => NOW);
  putRecord(
    dir,
    vault,
    {
      id: "r-summary",
      owner: CLINIC,
      type: "diagnostic-summary",
      value: VALUE_SUMMARY,
      sensitivity: "sensitive",
      source: "clinic-ehr",
      dataPrincipalRef: SUBJECT,
      allowedPurposes: [PURPOSE],
      allowedAgents: [LAB_AGENT],
      expiresAt: null,
    },
    { at: NOW, audit, dek: vaultDek }
  );
  putRecord(
    dir,
    vault,
    {
      id: "r-order",
      owner: CLINIC,
      type: "lab-order-id",
      value: VALUE_ORDER,
      sensitivity: "general",
      source: "clinic-ehr",
      dataPrincipalRef: SUBJECT,
      allowedPurposes: [PURPOSE],
      allowedAgents: [LAB_AGENT],
      expiresAt: null,
    },
    { at: NOW, audit, dek: vaultDek }
  );
  putRecord(
    dir,
    vault,
    {
      id: "r-name",
      owner: CLINIC,
      type: "patient-name",
      value: VALUE_NAME,
      sensitivity: "sensitive",
      source: "clinic-ehr",
      dataPrincipalRef: SUBJECT,
      allowedPurposes: [PURPOSE],
      // Bound to another agent: the lab's agent may not have this record.
      allowedAgents: ["did:example:clinic-billing-agent"],
      expiresAt: null,
    },
    { at: NOW, audit, dek: vaultDek }
  );

  say(
    "step 2 - the clinic's vault holds the Data Principal's records (encrypted)"
  );
  say(
    "  r-summary   diagnostic-summary  sensitive  the Data Principal's record, agent-bound to the lab"
  );
  say(
    "  r-order     lab-order-id        general    the Data Principal's record, agent-bound to the lab"
  );
  say(
    "  r-name      patient-name        sensitive  the Data Principal's record, bound to another agent"
  );
  say();

  // ---------------------------------------------------------------------
  // Step 3 - the disclosure, through the host-kit boundary.
  // ---------------------------------------------------------------------
  // The exact terms the authority covered. The boundary re-derives them and
  // refuses anything that does not match.
  const termsDigest = digestForOperation({
    principal: CLINIC,
    actor: LAB_AGENT,
    action: { name: "/disclose" },
    resource: RESOURCE,
    context: { claims: REQUESTED, verifier: LAB },
    purpose: PURPOSE,
  });

  // The privacy binding for this operation, built the way any host builds
  // it: the operator configuration, the verified ingress, and the demand.
  const demand = {
    principal: CLINIC,
    actor: LAB_AGENT,
    action: { name: "/disclose" },
    resource: RESOURCE,
    context: { claims: REQUESTED, verifier: LAB },
    purpose: PURPOSE,
    termsDigest,
  };
  const { runtime, gate } = privacyForHostOperation({
    dir,
    keys,
    auth: authority,
    ingress,
    demand,
    config: {
      dataPrincipalRef: SUBJECT,
      controllerId: CONTROLLER,
      recipientRoles: { [LAB]: "data-processor" },
      subjectAssurance: {
        classification: "adult",
        proofRef: "id-check:opq-7",
        assertedBy: "clinic-registration-desk",
      },
    },
    now: () => NOW,
  });

  // Armed: land the withdrawal at the next authority burn, which is
  // between the live recheck and the effect boundary.
  let armed = false;
  // What the boundary released. It stays out of the receipt: the receipt
  // carries a reference, never a claim name.
  let disclosure = null;
  /**
   * One attempt through the host-kit boundary. The boundary owns the
   * order: authority, privacy preflight, live recheck, evidence precommit,
   * the authority burn, the privacy fence at the effect boundary, the
   * effect, the finalisation.
   */
  async function attempt(attemptRef) {
    const boundary = createEffectBoundary({
      dir,
      auth: authority,
      ingress,
      runtime,
      gate,
      now: () => NOW,
      authorizedContext: { claims: REQUESTED, verifier: LAB },
      attemptRef,
      execute: async () => {
        const presentation = vault.disclose({
          ingress,
          purpose: PURPOSE,
          requested: REQUESTED,
          verifier: LAB,
          nonce: `nonce-${NOW}-${attemptRef}`,
          nowSec: NOW,
          authority,
          resource: RESOURCE,
          holder: { id: CLINIC, privateKey: holder.privateKey },
          audit,
        });
        const disclosed = presentation.disclosures.map((d) => d.name).sort();
        const withheld = REQUESTED.filter((name) => !disclosed.includes(name));
        disclosure = { disclosed, withheld };
        const reference = `presentation:${createHash("sha256")
          .update(`${termsDigest}|${disclosed.join(",")}`)
          .digest("hex")
          .slice(0, 16)}`;
        return {
          receiptId: reference,
          capabilityId: "",
          recipient: LAB,
          resource: RESOURCE.id,
          purpose: PURPOSE,
          transaction: reference,
          at: NOW,
          termsDigest,
        };
      },
    });
    try {
      // run() returns only when the effect happened and the evidence was
      // finalized. Every failure throws, and the throw says whether the
      // effect was prevented or left unknown.
      const receipt = await boundary.run();
      return { kind: "ok", receipt, disclosure };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const safe =
        message === "privacy denied" || message === "authority denied"
          ? message
          : "the attempt was stopped";
      return { kind: "stopped", message: safe };
    }
  }

  say(
    "step 3 - the lab asks for the minimised claim set, through the boundary"
  );
  say(
    `  request: /disclose, ${REQUESTED.length} claim names, verifier: ${LAB}`
  );
  const first = await attempt("attempt-1");
  if (first.kind !== "ok") {
    throw new Error(
      `the first disclosure must succeed: ${first.message ?? first.state}`
    );
  }
  const disclosed = first.disclosure.disclosed;
  const withheld = first.disclosure.withheld;
  say(`  disclosed: ${disclosed.join(", ")}`);
  say(
    `  withheld: ${withheld.join(", ")} (the record is not bound to this agent)`
  );
  say(`  receipt id: ${first.receipt.receiptId}`);
  say(`  terms digest: ${first.receipt.termsDigest.slice(0, 16)}...`);
  say(`  evidence id: ${first.receipt.eventId}`);
  say();

  // ---------------------------------------------------------------------
  // Step 4 - the evidence an operator can hand to a reviewer.
  // ---------------------------------------------------------------------
  const events = new FilePrivacyEventRepository({
    dir,
    dek: privacyDek,
    nowSec: () => NOW,
  });
  const event = events.load(first.receipt.eventId);
  say("step 4 - the evidence an operator can hand to a reviewer");
  say(`  Processing Event ${event.eventId}`);
  say(
    `    state: ${event.state}   purpose: ${event.purpose}   profile: ${event.profileId}`
  );
  say(
    `    activity: ${event.activityId}   basis: ${event.basisId}   data fiduciary: ${event.controllerId}`
  );
  say(
    `    recipients: ${event.recipients
      .map((r) => `${r.id} (${r.role})`)
      .join(", ")}`
  );
  say(`    categories: ${event.dataCategories.join(", ")}`);
  say(`    authority citations: ${event.authorityCitationIds.join(", ")}`);
  const summary = summarizeProcessing(events.listBySubject(SUBJECT), SUBJECT, {
    consents: privacyStore.snapshot().consents,
    nowSec: NOW,
  });
  say("  operator summary (summarizeProcessing):");
  for (const consent of summary.consentState) {
    say(
      `    consent ${consent.consentId}: ${consent.status} (bound to notice ${consent.noticeId})`
    );
  }
  say(`    purposes: ${summary.purposes.join(", ")}`);
  say(
    `    recipients: ${summary.recipients
      .map((r) => `${r.id} (${r.role})`)
      .join(", ")}`
  );
  say(
    `    bases: ${summary.basisIds.join(", ")}   activities: ${summary.activityIds.join(", ")}`
  );
  say(
    `    events: ${summary.events
      .map((e) => `${e.eventId} ${e.state}`)
      .join(", ")}`
  );
  say(
    `    erasure: ${summary.erasure.status}${
      summary.erasure.status === "not-computed"
        ? ` (${summary.erasure.reason})`
        : ""
    }`
  );
  say();

  // ---------------------------------------------------------------------
  // Step 5 - the Data Principal withdraws consent.
  // ---------------------------------------------------------------------
  let withdrawalLanded = false;
  function withdrawConsent() {
    privacyStore.withdrawConsent("c-1", {
      at: NOW,
      proofRef: "withdrawal-request:opq-9",
      assertedBy: "clinic-privacy-office",
    });
    savePrivacyStore(dir, privacyStore, { dek: privacyDek });
    withdrawalLanded = true;
  }

  say(
    "step 5 - the Data Principal withdraws consent, and the disclosure is tried again"
  );
  // Attempt 2: the withdrawal lands between the live recheck and the effect
  // boundary. The fence is the last live re-read, so it is the fence that
  // stops this attempt.
  authority.onConsume = withdrawConsent;
  const second = await attempt("attempt-2");
  authority.onConsume = null;
  if (second.kind === "ok") {
    throw new Error(
      "the mid-flight withdrawal did not stop the disclosure - the effect boundary did not re-check the privacy state"
    );
  }
  if (!withdrawalLanded) {
    throw new Error(
      "the withdrawal never landed - the boundary did not consume authority before the effect"
    );
  }
  say("  attempt 2 (same terms, new attempt reference):");
  say(
    "    the withdrawal landed mid-flight (armed at the authority burn, after the live recheck)"
  );
  const secondEvents = events.findByAttempt(termsDigest, "attempt-2");
  if (secondEvents.length === 1) {
    say("    the effect-boundary fence stopped it: nothing was released");
    say(
      `    Processing Event ${secondEvents[0].eventId}: ${secondEvents[0].state} - a provable pre-effect failure`
    );
  } else {
    say(
      "    the attempt stopped before any evidence was prepared: nothing was released"
    );
  }
  say("    the authority use for that attempt was spent (burn before effect)");
  say("  the withdrawal is now durable in the encrypted privacy state:");
  say(
    `    consent c-1 withdrawn at ${STAMP} (proof: withdrawal-request:opq-9)`
  );

  // Attempt 3: the withdrawal is durable, so the privacy gate denies the
  // attempt before any evidence is even prepared.
  const third = await attempt("attempt-3");
  if (third.kind === "ok") {
    throw new Error("the withdrawn consent must stop the next attempt");
  }
  say("  attempt 3 (same terms, new attempt reference):");
  const thirdEvents = events.findByAttempt(termsDigest, "attempt-3");
  if (thirdEvents.length === 0) {
    say(
      "    the privacy gate denied it before any evidence was prepared: nothing was released"
    );
  } else {
    say(
      `    Processing Event ${thirdEvents[0].eventId}: ${thirdEvents[0].state}`
    );
  }
  say("  the first disclosure stands; attempts 2 and 3 never reached the lab");
  say();

  // ---------------------------------------------------------------------
  // Step 6 - the rights surface.
  // ---------------------------------------------------------------------
  const snapshot = privacyStore.snapshot();
  const records = vault.listMetadata(CLINIC);
  const rightsSummary = summarizeProcessing(
    events.listBySubject(SUBJECT),
    SUBJECT,
    { consents: snapshot.consents, records, holds: snapshot.holds, nowSec: NOW }
  );
  say("step 6 - the rights surface: what the Data Principal can ask for");
  say(`  processing summary for the Data Principal (${SUBJECT}):`);
  for (const consent of rightsSummary.consentState) {
    say(
      `    consent ${consent.consentId}: ${consent.status} (bound to notice ${consent.noticeId})`
    );
  }
  say(
    `    events: ${rightsSummary.events
      .map((e) => `${e.eventId} ${e.state}`)
      .join(", ")}`
  );
  if (rightsSummary.erasure.status === "computed") {
    say(
      `    erasure: computed - ${rightsSummary.erasure.eligibleRecordIds.length} eligible, ${rightsSummary.erasure.heldRecords.length} held, ${rightsSummary.erasure.unscopedRecordIds.length} unscoped`
    );
  }
  const plan = planErasure({
    records,
    holds: snapshot.holds,
    dataPrincipalRef: SUBJECT,
    nowSec: NOW,
  });
  say(
    `  erasure plan (planErasure), scoped to the Data Principal (${SUBJECT}):`
  );
  for (const item of plan) {
    say(`    ${item.record.id}  ${item.status}`);
  }
  const erased = [];
  for (const item of plan) {
    if (item.status !== "eligible") continue;
    const receipt = eraseRecord(
      dir,
      vault,
      { id: item.record.id, owner: item.record.owner },
      { at: NOW, audit, dek: vaultDek }
    );
    erased.push(receipt);
    say(
      `    erased ${receipt.id} (${receipt.type}) - receipt: id=${receipt.id} type=${receipt.type} version=${receipt.version} erasedAt=${STAMP}`
    );
  }
  say("  the receipt carries id, type, version and time - never a value");
  say(
    "  note: this erases PTF-managed records only. The Processing Events, the audit log, the"
  );
  say(
    "        lab's own copies and backups are outside this path (docs/audit/limits.md)."
  );
  say();

  // ---------------------------------------------------------------------
  // Step 7 - what each step exercises.
  // ---------------------------------------------------------------------
  say("step 7 - what each step demonstrates, and which obligation it serves");
  say("  (DPDP Act 2023 / DPDP Rules 2025, read against the primary text;");
  say("   sources in docs/verticals/dpdp-consent-gateway.md)");
  say("");
  const table = [
    [
      "step 1",
      "Act s.5 (notice); Act s.6(1) (consent); Rules 3 (notice content)",
    ],
    [
      "step 2",
      "Act s.6(1) (data necessary); Act s.7 (certain legitimate uses)",
    ],
    ["step 3", "Act s.6(10) (burden of proof); Act s.8(4)-s.8(7) (safeguards)"],
    [
      "step 4",
      "Act s.11 (access summary); Rules 6(1)(c), 6(1)(e) (access logs)",
    ],
    ["step 5", "Act s.6(4)-s.6(6) (withdrawal); Act s.8(4)-s.8(7) (erase)"],
    ["step 6", "Act s.12 (erasure); Act s.8(4)-s.8(7) (erase)"],
    ["step 7", "Rules 4 + First Schedule Part B (Consent Manager record)"],
    [
      "operator duty",
      "Rules 8(1), 8(2) (retention; 48 hours' notice before erasure)",
    ],
    ["not exercised", "Act s.13; Rules 14; Rules 7; Act s.16"],
  ];
  for (const [label, text] of table) {
    say(`  ${label.padEnd(13)}  ${text}`);
  }
  say("");
  say(
    "  Act s.6(4)-s.6(6) is exactly what step 5 shows: withdrawal as easy as the"
  );
  say(
    "  consent was given, processing ceasing, the processor ceasing, and the earlier"
  );
  say("  disclosure left untouched.");
  say(
    "  Act s.6(10) is what steps 3 and 4 produce: the proof that a notice was given"
  );
  say("  and that consent was given.");
  say(
    "  Rules 4 with First Schedule Part B is the closest thing in Indian law to the"
  );
  say(
    "  event log this run produces; it becomes enforceable on 13 November 2026."
  );
  say(
    "  Neither the Act nor the Rules impose a general processing-activity record duty."
  );
  say("");
  say(
    "  The Rules phase in from 13 November 2025 (the Board), 13 November 2026"
  );
  say(
    "  (Consent Managers) and 13 May 2027 (the substantive Data Fiduciary duties,"
  );
  say(
    "  including notice, security safeguards, breach notification and Data Principal"
  );
  say("  rights). The Board was still being staffed as of August 2026.");
  say("");
  say(
    "  This table records what the script demonstrates and which obligation it serves."
  );
  say("  It is not a legal determination, and PTF certifies nothing.");
  say("");

  // ---------------------------------------------------------------------
  // Self-checks: the script fails loudly if a control did not hold.
  // ---------------------------------------------------------------------
  if (erased.length === 0) {
    throw new Error("the subject-bound erasure erased nothing");
  }
  const transcript = printed.join("\n");
  for (const secret of [VALUE_SUMMARY, VALUE_ORDER, VALUE_NAME]) {
    if (transcript.includes(secret)) {
      throw new Error("a personal value reached the transcript");
    }
  }
} finally {
  cleanup();
}
