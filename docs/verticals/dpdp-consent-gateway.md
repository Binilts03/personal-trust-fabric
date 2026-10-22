---
layout: default
title: The DPDP consent gateway (vertical)
nav_order: 7
permalink: /verticals/dpdp-consent-gateway/
---

# The DPDP consent gateway (vertical)

A worked example for the builder who must **share personal data with a
processor and be able to show the basis**: a clinic (Data Fiduciary) sends a
Data Principal's diagnostic summary to a lab (Data Processor), the Data
Principal then withdraws consent, and the Data Principal then asks for erasure.

The script is `examples/dpdp-consent-gateway.mjs`. It runs in one command, with
no credentials, no network access, and no state outside a temporary directory it
creates and removes.

**Who it is for.** A host engineer wiring privacy enforcement into an AI host.
The question this answers is "what do I have to compose, in what order, and
what evidence do I end up holding?" — not "am I legal?".

**What it demonstrates.** Seven steps:

1. the operator's privacy state (notice, consent, two bases, one activity);
2. the Data Principal's records in the encrypted vault, bound to an opaque
   Data Principal reference;
3. a disclosure through the **host-kit boundary** — authority, then privacy,
   then the Processing Event, then the claims;
4. the evidence: the Processing Event and the operator's processing summary;
5. a consent withdrawal, then the same disclosure attempted again — stopped;
6. the rights surface: summary, erasure plan, and subject-bound erasure of
   the PTF-managed records;
7. a table mapping each step to the obligation of the DPDP Act 2023 / DPDP
   Rules 2025 it serves.

**What it does not demonstrate.** See [The limits](#the-limits) below.

---

## How to run it

```sh
npm install
npm run build
node examples/dpdp-consent-gateway.mjs
```

The script uses a fixed clock (`2026-01-01T00:00:00Z`), so repeated runs on the
same platform produce the same stdout; line endings may differ. The Node
`ExperimentalWarning` for SQLite goes to stderr and is not part of the
transcript. `tests/dpdp-vertical.test.ts` runs it as a regression gate: it
asserts the exit code, the disclosure, the withdrawal stopping the next
attempt, the erasure, and that no stored value, no direct identifier and no
internal deny reason reaches the transcript.

---

## The transcript

Captured from the stdout of `node examples/dpdp-consent-gateway.mjs` (line
endings normalised to LF; stderr omitted):

```text
PTF - DPDP consent gateway (vertical)
clinic (Data Fiduciary) -> lab (Data Processor); one Data Principal, one disclosure
data principal reference: subject:opq-4a32c9 (opaque, minted by the host)
clock: 2026-01-01T00:00:00Z (fixed, so this transcript is reproducible)
store: a temporary directory, removed when the script exits

step 1 - the operator records what may happen (encrypted privacy state)
  notice    n-1   the notice the Data Principal saw for this purpose
  consent   c-1   affirmative consent, bound to notice n-1
  basis     b-1   consent basis, bound to consent c-1
  basis     b-2   certain-legitimate-use basis (recorded; no activity uses it here)
  activity  a-1   /disclose for the lab, bound to basis b-1

step 2 - the clinic's vault holds the Data Principal's records (encrypted)
  r-summary   diagnostic-summary  sensitive  the Data Principal's record, agent-bound to the lab
  r-order     lab-order-id        general    the Data Principal's record, agent-bound to the lab
  r-name      patient-name        sensitive  the Data Principal's record, bound to another agent

step 3 - the lab asks for the minimised claim set, through the boundary
  request: /disclose, 3 claim names, verifier: did:example:lab
  disclosed: diagnostic-summary, lab-order-id
  withheld: patient-name (the record is not bound to this agent)
  receipt id: presentation:0b6b95ba77de09e5
  terms digest: 172da5b2b47bcc94...
  evidence id: pev-18f9bfbbdcaf3c66a3223c4631dd694a

step 4 - the evidence an operator can hand to a reviewer
  Processing Event pev-18f9bfbbdcaf3c66a3223c4631dd694a
    state: SUCCEEDED   purpose: diagnostic-analysis   profile: IN-DPDP-2025
    activity: a-1   basis: b-1   data fiduciary: clinic:northside
    recipients: did:example:lab (data-processor)
    categories: diagnostic-summary, lab-order-id, patient-name
    authority citations: g-disclose-lab
  operator summary (summarizeProcessing):
    consent c-1: given (bound to notice n-1)
    purposes: diagnostic-analysis
    recipients: did:example:lab (data-processor)
    bases: b-1   activities: a-1
    events: pev-18f9bfbbdcaf3c66a3223c4631dd694a SUCCEEDED
    erasure: not-computed (owner-required)

step 5 - the Data Principal withdraws consent, and the disclosure is tried again
  attempt 2 (same terms, new attempt reference):
    the withdrawal landed mid-flight (armed at the authority burn, after the live recheck)
    the effect-boundary fence stopped it: nothing was released
    Processing Event pev-ffc3519282b64f290894bc5a15ec605d: FAILED_FINAL - a provable pre-effect failure
    the authority use for that attempt was spent (burn before effect)
  the withdrawal is now durable in the encrypted privacy state:
    consent c-1 withdrawn at 2026-01-01T00:00:00Z (proof: withdrawal-request:opq-9)
  attempt 3 (same terms, new attempt reference):
    the privacy gate denied it before any evidence was prepared: nothing was released
  the first disclosure stands; attempts 2 and 3 never reached the lab

step 6 - the rights surface: what the Data Principal can ask for
  processing summary for the Data Principal (subject:opq-4a32c9):
    consent c-1: withdrawn (bound to notice n-1)
    events: pev-18f9bfbbdcaf3c66a3223c4631dd694a SUCCEEDED, pev-ffc3519282b64f290894bc5a15ec605d FAILED_FINAL
    erasure: computed - 3 eligible, 0 held, 0 unscoped
  erasure plan (planErasure), scoped to the Data Principal (subject:opq-4a32c9):
    r-name  eligible
    r-order  eligible
    r-summary  eligible
    erased r-name (patient-name) - receipt: id=r-name type=patient-name version=1 erasedAt=2026-01-01T00:00:00Z
    erased r-order (lab-order-id) - receipt: id=r-order type=lab-order-id version=1 erasedAt=2026-01-01T00:00:00Z
    erased r-summary (diagnostic-summary) - receipt: id=r-summary type=diagnostic-summary version=1 erasedAt=2026-01-01T00:00:00Z
  the receipt carries id, type, version and time - never a value
  note: this erases PTF-managed records only. The Processing Events, the audit log, the
        lab's own copies and backups are outside this path (docs/audit/limits.md).

step 7 - what each step demonstrates, and which obligation it serves
  (DPDP Act 2023 / DPDP Rules 2025, read against the primary text;
   sources in docs/verticals/dpdp-consent-gateway.md)

  step 1         Act s.5 (notice); Act s.6(1) (consent); Rules 3 (notice content)
  step 2         Act s.6(1) (data necessary); Act s.7 (certain legitimate uses)
  step 3         Act s.6(10) (burden of proof, in a proceeding); Act s.8(4)-s.8(5) (safeguards)
  step 4         Act s.11 (access summary); Rules 6(1)(c), 6(1)(e) (logging/retention; the event is not an access log)
  step 5         Act s.6(4)-s.6(6) (withdrawal); Act s.8(7) (erase)
  step 6         Act s.12 (erasure); Act s.8(7) (erase); Rule 8(3) (one-year retention floor)
  step 7         Rules 4 + First Schedule Part B (Consent Manager record; transferee Data Fiduciary)
  not applicable  Rules 8(1), 8(2) (Third Schedule classes only; a clinic is not one)
  not exercised  Act s.13; Rules 14; Rules 7; Act s.16 (notified restrictions)

  Act s.6(4)-s.6(6) frames step 5: the run shows withdrawal, processing
  stopped before the effect, and the earlier disclosure left untouched. It
  does not show comparable ease for the Data Principal, processor cessation,
  or the "reasonable time" s.6(6) allows.
  Act s.6(10) applies where a question arises in a proceeding: the notice
  (n-1) and consent (c-1) records are the evidence; the Processing Event
  chains to them and records the attempt.
  Rules 4 with First Schedule Part B is the nearest analogue, but Part B
  item 3(c) covers transfers to a transferee Data Fiduciary, not processor
  disclosures; PTF is not a Consent Manager.
  Neither the Act nor the Rules impose a general processing-activity record
  duty; rule 6(1)(c) requires access logging, and rule 6(1)(e) and rule 8(3)
  require one year of logs and data.

  The Act is phased too: ss.1(2), 2, 18-26, 35, 38-43, 44(1),(3) from
  13 November 2025; s.6(9) and s.27(1)(d) from 13 November 2026; and
  ss.3-17 (including every Act section in this table) from 13 May 2027.

  The Rules phase in from 13 November 2025 (the Board), 13 November 2026
  (Consent Managers) and 13 May 2027 (the substantive Data Fiduciary duties,
  including notice, security safeguards, breach notification and Data Principal
  rights). The Board's recruitment advertisement is dated 6 May 2026
  (Employment News, 6 June 2026); the Government's 12 August 2026 answer
  reported no appointments.

  This table records what the script demonstrates and which obligation it serves.
  It is not a legal determination.
```

---

## What to conclude from each step

**Step 1 — the operator's privacy state.** Notice, consent, basis and activity
are separate artifacts with separate ids, and each is bound to the Data
Principal, the purpose and the data scope. This is the shape of **Act s.5**
(the notice must accompany or precede the consent request and must state the
data, the purpose, how to exercise rights and how to complain to the Board) and
**Act s.6(1)** (consent free, specific, informed, unconditional and unambiguous,
with a clear affirmative action, limited to the data necessary for the purpose);
**Rules 3** fixes the notice's content. The consent is _not_ a Standing Grant:
it never mints authority, it only narrows an operation the authority already
allowed (ADR-0024, invariant 1). The second basis (`b-2`) is **Act s.7(a)**'s
voluntary-provision use, recorded but not relied on by any activity in this run.
It is not a "clinical utility" basis: the Act has no such s.7 clause.

**Step 2 — the records.** Every record carries the opaque Data Principal
reference. That reference is the only thing tying a record to a person, and it
is a _syntax_ guard, not proof of pseudonymisation: the trusted host mints it
and keeps the mapping outside PTF. One record is bound to another agent, so it
is not part of the lab's disclosure.

**Step 3 — the disclosure.** The boundary evaluates authority first (a denied
caller learns nothing about the privacy state), then the configured privacy
controls, then writes the Processing Event, and only then releases claims. The
release is `requested ∩ available ∩ allowed`: two of the three requested claim
names came out, and the presentation carried names and values that the
operator's log never sees. The output line says "disclosed" and "withheld" —
never a value. The boundary itself is an **Act s.8(4) to s.8(5)** measure
(appropriate technical and organisational measures; reasonable security
safeguards). The Processing Event does not itself prove notice and consent:
**Act s.6(10)**, where a question arises **in a proceeding**, puts the burden
on the Data Fiduciary to prove that notice was given and that consent was given.
The notice (`n-1`) and consent (`c-1`) records from step 1 are that evidence;
the event chains to them and records the attempt.

**Step 4 — the evidence.** The Processing Event is secret-free by
construction: it names the profile, the activity, the basis, the purpose, the
recipient _role_, the categories and the authority citation — and no personal
value, no direct identifier and no free-text notice. `summarizeProcessing`
gives the operator one view of the Data Principal's processing, which is the
shape of the **Act s.11** access right (a summary of the personal data
processed, the processing activities undertaken, and the identities of other
Data Fiduciaries/Processors with whom the data was shared; it applies to a
Data Principal who has previously given consent). The event is evidence
_towards_ the **Rules 6(1)(c)** access-logging control and the **Rules 6(1)(e)**
one-year retention floor; it is not an access log, and this run does not
produce one. Note the honest default: with no owner and no holds supplied, the
erasure line reads `not-computed (owner-required)` rather than pretending the
answer is "nothing to erase".

**Step 5 — the withdrawal.** This step exercises the **Act s.6(4) to
s.6(6)** frame: the Data Principal withdraws consent while the second attempt
is in flight, in the window between the live recheck and the effect. The
effect-boundary fence re-reads the privacy state at the last possible moment
and stops the attempt; the Processing Event for that attempt is
`FAILED_FINAL`, a provable pre-effect failure — evidence exists, the disclosure
did not. The authority use for that attempt was spent (burn before effect),
which is the conservative direction: a spent use, not a leaked claim. The third
attempt fails even earlier, because the withdrawal is now durable in the
encrypted state: the privacy gate denies it before any evidence is prepared.
Withdrawal does not undo the earlier disclosure, and the first disclosure
stands. The run does not show comparable ease for the Data Principal, processor
cessation, or the "reasonable time" s.6(6) allows. **Act s.8(7)** also requires
erasure on withdrawal of consent; that is the operator's next step, not
something the fence does for you.

**Step 6 — the rights surface.** The summary now reports the consent as
withdrawn and both attempts as evidence. The erasure plan is scoped to the
Data Principal's opaque reference: exactly three records are eligible, none is
held, none is unscoped. The erasure itself is per exact record id, and the
receipt carries id, type, version and time — never a value. That is **Act
s.12** (erasure of data for which the Data Principal previously gave consent,
unless retention is necessary for the specified purpose or by law) and **Act
s.8(7)** (erase, and cause the processor to erase). Two retention limits sit
outside the script: **Rule 8(3)** requires every Data Fiduciary to retain
personal data, traffic data and processing logs for at least one year, subject
to other law, and s.8(7)'s proviso excuses erasure only where retention is
necessary for compliance with law. The example erases immediately to show the
mechanism; a deployment must reconcile that with r.8(3) and r.6(1)(e).
**Rules 8(1)** and **8(2)** are not general duties: they apply only to the
Third Schedule classes, and a clinic is not one.

**Step 7 — the table.** It records what each step demonstrates and which
obligation it serves. The event log this run produces — the consents given,
denied and withdrawn, the notices, and the sharing, kept as a machine-readable
record — is the nearest analogue to the **Rule 4 / First Schedule Part B**
Consent Manager record. Part B item 3(c) covers sharing with a transferee Data
Fiduciary, not disclosure to a Data Processor; PTF is not a registered Consent
Manager and does not assume that role. The obligation becomes enforceable on
13 November 2026.

---

## The obligations it serves

The mapping below is against the primary text:

- **Digital Personal Data Protection Act, 2023** — Gazette print via MeitY:
  <https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf>
  (India Code mirror, not reachable from this environment:
  <https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf>)
- **Digital Personal Data Protection Rules, 2025**, G.S.R. 846(E), 13 November
  2025 —
  <https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf>;
  corrigendum G.S.R. 892(E), 10 December 2025 —
  <https://www.meity.gov.in/static/uploads/2025/12/3c7ebbae0e5456f493f486e6845df86b.pdf>
- **Act commencement**, G.S.R. 843(E), 13 November 2025 —
  <https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf>
- **Data Protection Board established**, G.S.R. 844(E), 13 November 2025 —
  <https://www.meity.gov.in/static/uploads/2025/11/cc217843dc3bcb37b2b05bcc3b4e031f.pdf>
- **Lok Sabha Unstarred Q. No. 3960**, answered 12 August 2026 —
  <https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU3960_GyWSTk.pdf>
- **MeitY recruitment advertisement** for the Board, 6 May 2026 —
  <https://www.meity.gov.in/static/uploads/2026/05/53b1bcf01cab9a0adde463e73fbc3417.pdf>

Every Act section in the table below other than the commencement provisions
themselves is out of force until **13 May 2027** (see
[When the Act and the Rules bite](#when-the-act-and-the-rules-bite)). The table
records the design intent, not current enforceability.

| Step           | What it demonstrates                                                      | Obligation it serves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1              | the operator's encrypted privacy state: notice, consent, basis, activity  | **Act s.5** (notice must accompany or precede the consent request, and state the data, the purpose, how to exercise rights and how to complain to the Board); **Act s.6(1)** (consent free, specific, informed, unconditional and unambiguous, with a clear affirmative action, limited to the data necessary for the specified purpose); **Rules 3** (content of the notice)                                                                                                                                                           |
| 2              | the records, bound to the Data Principal and to an agent                  | **Act s.6(1)** (the data-necessary limit); **Act s.7** (certain legitimate uses; the second basis is s.7(a), voluntary provision. "Legal obligation" in s.7(d) means an obligation to disclose information to the State, not any contractual duty)                                                                                                                                                                                                                                                                                      |
| 3              | the disclosure, and the per-attempt Processing Event that evidences it    | **Act s.6(10)** (where a question arises **in a proceeding**, the Data Fiduciary must prove that notice was given and consent was given; the notice and consent records are the evidence, and the event chains to them); **Act s.8(4) to s.8(5)** (appropriate technical and organisational measures; reasonable security safeguards). s.8(6) breach notification is not exercised                                                                                                                                                      |
| 4              | the operator's summary, and the event as evidence towards the log control | **Act s.11** (access right: a summary of the personal data processed and the processing activities undertaken, including the identities of other Data Fiduciaries/Processors; limited to a Data Principal who previously gave consent); **Rules 6(1)(c)** and **6(1)(e)** (access logging; retention of logs and personal data for at least one year). The run does not produce an access log                                                                                                                                           |
| 5              | the withdrawal stopping the attempt, the earlier disclosure left standing | **Act s.6(4) to s.6(6)** (withdraw at any time, with ease comparable to giving consent; on withdrawal cease processing and cause the processor to cease within a reasonable time; withdrawal does not affect the legality of prior processing). The run shows withdrawal, the fence and the untouched prior disclosure, not comparable-ease UX or processor cessation; **Act s.8(7)** (erase on withdrawal of consent)                                                                                                                  |
| 6              | the erasure plan and subject-bound erasure of PTF-managed records         | **Act s.12** (erasure of data for which consent was previously given, unless retention is necessary for the specified purpose or by law); **Act s.8(7)** (erase, and cause the processor to erase); **Rule 8(3)** (one-year retention floor for personal data, traffic data and processing logs, subject to other law). The example erases immediately; a deployment must reconcile that with the floor. **Rules 8(1)-(2)** apply only to Third Schedule classes                                                                        |
| 7              | the machine-readable event log                                            | **Rule 4 with the First Schedule Part B** (the registered Consent Manager record: consents given, denied and withdrawn, notices and sharing with a transferee Data Fiduciary; kept at least seven years and exportable in machine-readable form on the Data Principal's request). This is the nearest analogue, not the same role: PTF is not a Consent Manager; enforceable 13 November 2026                                                                                                                                           |
| not applicable | —                                                                         | **Rules 8(1)** and **8(2)** (Third Schedule classes only: e-commerce, online gaming and social-media intermediaries above the stated user thresholds; a clinic is not one)                                                                                                                                                                                                                                                                                                                                                              |
| not exercised  | —                                                                         | **Act s.13** (grievance redressal, and the Data Principal must exhaust it before approaching the Board); **Rules 14** (publish how to exercise rights, and respond to a grievance within a period not exceeding ninety days); **Rules 7** (breach intimation to each affected Data Principal without delay, and to the Board without delay with detailed information within 72 hours); **Act s.16** (restrictions the Central Government may notify; no cross-border transfer is configured here); **Act s.8(6)** (breach notification) |

### A negative finding worth stating

Neither the DPDP Act 2023 nor the DPDP Rules 2025 impose a general _record of
processing activities_ obligation on a Data Fiduciary. The strings "record of
processing" and "records of processing" appear nowhere in the Act — that is a
GDPR Article 30 idea, and it does not belong in this table. What the Act does
impose, at **s.6(10)**, is narrower: where a question arises **in a
proceeding**, the Data Fiduciary must be able to _prove_ that a notice was
given and that consent was given. The notice and consent records are that
evidence; the per-attempt Processing Event chains to them and records the
attempt. This is not a "no logging" claim: **r.6(1)(c)** requires access
logging, and **r.6(1)(e)** and **r.8(3)** require one year of logs and data.
The nearest statutory analogue to a machine-readable consent-and-sharing log is
the **Rule 4 / First Schedule Part B** Consent Manager record, although it
covers transfers to a transferee Data Fiduciary rather than processor
disclosures; PTF does not assume that regulated role.

### When the Act and the Rules bite

The Act is phased by **G.S.R. 843(E)**: ss.1(2), 2, 18-26, 35, 38-43,
44(1) and (3) from **13 November 2025**; s.6(9) and s.27(1)(d) from **13
November 2026**; and ss.3-17 (including ss.5-8, 11-13 and 16), s.27 (except
(1)(d)), ss.28-34, 36, 37 and 44(2) from **13 May 2027**. Every Act section
this document maps is therefore out of force today.

The Rules phase in: **13 November 2025** (the Board), **13 November 2026**
(Consent Managers) and **13 May 2027** (the substantive Data Fiduciary
obligations — notice, security safeguards, breach notification and the Data
Principal rights). The Board's recruitment advertisement is dated 6 May 2026
(Employment News, 6 June 2026); the Government's 12 August 2026 answer reported
no appointments. Verify the current applicable notifications
before relying on any of this for a specific deployment; PTF does not calculate
legal deadlines.

---

## The limits

- **This is not a compliance certificate.** The script exercises configured
  technical controls and produces evidence of those controls. PTF does not
  decide whether a legal basis is legally sufficient, does not review the
  clinic's notice text, and does not certify anything
  (`docs/privacy/dpdp.md` — Responsibility boundary; ADR-0024 invariant 7).
- **The Act is not yet in force for these sections.** Every Act section in the
  table commences on 13 May 2027, and s.6(9)/s.27(1)(d) on 13 November 2026.
  The example is a design exercise against the text, not a statement of duties
  that apply today.
- **One host, one processor, one operator.** Enforcement is per-host and
  explicit: a host that does not compose the privacy runtime at its effect
  boundary is _uncovered_, not cleared (ADR-0025, decisions 1 and 4). The
  boundary in this example is the one the host owns; nothing here intercepts
  an unrelated code path.
- **The fence is not atomic with the effect.** The privacy re-read and the
  external effect are still two steps, so a withdrawal that lands in that
  narrow window can still race
  ([DPDP privacy limits](../audit/limits.md#dpdp-privacy-enforcement-experimental)).
  Hosts that need strict revocation ordering must serialise at the host level.
- **The erasure is bounded by PTF's own reach, and by the retention floor.**
  It removes PTF-managed vault records bound to that Data Principal reference.
  Processing Events, the audit log, the lab's own copies, upstream records and
  backups are not erased by this path. Rule 8(3) and Rule 6(1)(e) require at
  least one year of retention for personal data, traffic data and processing
  logs, subject to other law; the example's immediate erasure does not model
  that reconciliation
  ([DPDP privacy limits](../audit/limits.md#dpdp-privacy-enforcement-experimental)).
- **The operator stays accountable.** Notices, lawful-basis review, processor
  contracts, transfer rules, retention periods, breach notification, grievance
  handling and DPIA remain operator obligations
  (`docs/privacy/dpdp.md` — Responsibility boundary; Not implemented).
- **A Processing Event is not an enterprise activity log.** It tracks
  PTF-mediated attempts only
  ([DPDP privacy limits](../audit/limits.md#dpdp-privacy-enforcement-experimental)).
- **The example runs the real host kit.** The boundary it calls is
  `createEffectBoundary` from `src/hostkit/boundary.ts`, the same
  implementation a third-party host adopts (see `docs/host-kit.md`). The
  ordering it exercises is the ordering in the host-kit spec.
- **The mid-flight withdrawal needs a seam.** The script arms the withdrawal
  at the authority burn (the `WithdrawalRace` authority in the example
  fires a hook right after a consuming evaluation), because that is the only
  way to reproduce the window between the live recheck and the effect
  boundary in a sequential script. The window itself is proven by the
  conformance suite, not by this script.
