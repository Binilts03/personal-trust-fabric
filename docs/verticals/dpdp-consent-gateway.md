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
6. the rights surface: summary, erasure plan, exact Data-Principal-bound
   erasure;
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

The script uses a fixed clock (`2026-01-01T00:00:00Z`) so the transcript is
byte-for-byte reproducible. `tests/dpdp-vertical.test.ts` runs it as a
regression gate: it asserts the exit code, the disclosure, the withdrawal
stopping the next attempt, the erasure, and that no stored value, no direct
identifier and no internal deny reason reaches the transcript.

---

## The transcript

Captured verbatim from `node examples/dpdp-consent-gateway.mjs`:

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
  external ref: presentation:0b6b95ba77de09e5
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
  step 3         Act s.6(10) (burden of proof); Act s.8(4)-s.8(7) (safeguards)
  step 4         Act s.11 (access summary); Rules 6(1)(c), 6(1)(e) (access logs)
  step 5         Act s.6(4)-s.6(6) (withdrawal); Act s.8(4)-s.8(7) (erase)
  step 6         Act s.12 (erasure); Act s.8(4)-s.8(7) (erase)
  step 7         Rules 4 + First Schedule Part B (Consent Manager record)
  operator duty  Rules 8(1), 8(2) (retention; 48 hours' notice before erasure)
  not exercised  Act s.13; Rules 14; Rules 7; Act s.16

  Act s.6(4)-s.6(6) is exactly what step 5 shows: withdrawal as easy as the
  consent was given, processing ceasing, the processor ceasing, and the earlier
  disclosure left untouched.
  Act s.6(10) is what steps 3 and 4 produce: the proof that a notice was given
  and that consent was given.
  Rules 4 with First Schedule Part B is the closest thing in Indian law to the
  event log this run produces; it becomes enforceable on 13 November 2026.
  Neither the Act nor the Rules impose a general processing-activity record duty.

  The Rules phase in from 13 November 2025 (the Board), 13 November 2026
  (Consent Managers) and 13 May 2027 (the substantive Data Fiduciary duties,
  including notice, security safeguards, breach notification and Data Principal
  rights). The Board was still being staffed as of August 2026.

  This table records what the script demonstrates and which obligation it serves.
  It is not a legal determination, and PTF certifies nothing.
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
allowed (ADR-0024, invariant 1). The second basis (`b-2`) is the other basis
kind the profile accepts — **Act s.7**'s certain legitimate uses — recorded but
not relied on by any activity in this run.

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
never a value. The boundary itself is a **Act s.8(4) to s.8(7)** measure
(appropriate technical and organisational measures; reasonable security
safeguards), and the Processing Event it writes is the **Act s.6(10)** burden
of proof: where consent is the basis, the Data Fiduciary must be able to prove
that a notice was given and that consent was given.

**Step 4 — the evidence.** The Processing Event is secret-free by
construction: it names the profile, the activity, the basis, the purpose, the
recipient _role_, the categories and the authority citation — and no personal
value, no direct identifier and no free-text notice. `summarizeProcessing`
gives the operator one view of the Data Principal's processing, which is the
shape of the **Act s.11** access right (a summary of the personal data
processed and the processing activities undertaken); the access log itself is
the **Rules 6(1)(c)** and **6(1)(e)** obligation (logs of access to personal
data, and retention of logs and personal data for at least one year). Note the
honest default: with no owner and no holds supplied, the erasure line reads
`not-computed (owner-required)` rather than pretending the answer is "nothing
to erase".

**Step 5 — the withdrawal.** This step is **Act s.6(4) to s.6(6)** exactly.
The Data Principal withdraws consent while the second attempt is in flight, in
the window between the live recheck and the effect. The effect-boundary fence
re-reads the privacy state at the last possible moment and stops the attempt;
the Processing Event for that attempt is `FAILED_FINAL`, a provable pre-effect
failure — evidence exists, the disclosure did not. The authority use for that
attempt was spent (burn before effect), which is the conservative direction: a
spent use, not a leaked claim. The third attempt fails even earlier, because
the withdrawal is now durable in the encrypted state: the privacy gate denies
it before any evidence is prepared. Withdrawal does not undo the earlier
disclosure, and the first disclosure stands. **Act s.8(4) to s.8(7)** also
requires erasure on withdrawal of consent; that is the operator's next step,
not something the fence does for you.

**Step 6 — the rights surface.** The summary now reports the consent as
withdrawn and both attempts as evidence. The erasure plan is scoped to the
Data Principal's opaque reference: exactly three records are eligible, none is
held, none is unscoped. The erasure itself is per exact record id, and the
receipt carries id, type, version and time — never a value. That is **Act
s.12** (erasure unless retention is necessary for the specified purpose or by
law) and **Act s.8(4) to s.8(7)** (erase, and cause the processor to erase).
**Rules 8(1)** and **8(2)** add two operator duties this run does _not_
perform: the retention period, and informing the Data Principal at least 48
hours before completing an erasure — this script erases at once.

**Step 7 — the table.** It records what each step demonstrates and which
obligation it serves. The event log this run produces — the consents given,
denied and withdrawn, the notices, and the sharing, kept as a machine-readable
record — is closest in Indian law to the **Rule 4 / First Schedule Part B**
Consent Manager record. PTF is not a registered Consent Manager and does not
assume that role; the obligation becomes enforceable on 13 November 2026.

---

## The obligations it serves

The mapping below is against the primary text:

- **Digital Personal Data Protection Act, 2023** —
  <https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf>
  (linked from `docs/privacy/dpdp.md:80`)
- **Digital Personal Data Protection Rules, 2025**, G.S.R. 846(E), 13 November
  2025 —
  <https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf>
  (linked from `docs/privacy/dpdp.md:81`)

| Step                     | What it demonstrates                                                      | Obligation it serves                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                        | the operator's encrypted privacy state: notice, consent, basis, activity  | **Act s.5** (notice must accompany or precede the consent request, and state the data, the purpose, how to exercise rights and how to complain to the Board); **Act s.6(1)** (consent free, specific, informed, unconditional and unambiguous, with a clear affirmative action, limited to the data necessary for the specified purpose); **Rules 3** (content of the notice)                                                                                             |
| 2                        | the records, bound to the Data Principal and to an agent                  | **Act s.6(1)** (the data-necessary limit); **Act s.7** (certain legitimate uses: voluntary provision, state functions, legal obligation, medical emergency — the second basis kind the profile accepts)                                                                                                                                                                                                                                                                   |
| 3                        | the disclosure, and the per-attempt Processing Event that evidences it    | **Act s.6(10)** (burden of proof: where consent is the basis, the Data Fiduciary is obliged to prove that a notice was given and that consent was given — the Processing Event is that proof); **Act s.8(4) to s.8(7)** (appropriate technical and organisational measures; reasonable security safeguards)                                                                                                                                                               |
| 4                        | the operator's summary and the access log                                 | **Act s.11** (access right: a summary of the personal data processed and the processing activities undertaken); **Rules 6(1)(c)** and **6(1)(e)** (logs of access to personal data; retention of logs and personal data for at least one year)                                                                                                                                                                                                                            |
| 5                        | the withdrawal stopping the attempt, the earlier disclosure left standing | **Act s.6(4) to s.6(6)** (withdraw at any time, with the ease of doing so comparable to the ease with which consent was given; on withdrawal cease processing and cause the processor to cease; withdrawal does not affect the legality of prior processing); **Act s.8(4) to s.8(7)** (erase on withdrawal of consent)                                                                                                                                                   |
| 6                        | the erasure plan and the exact, Data-Principal-bound erasure              | **Act s.12** (correction, completion, updating and erasure; erase unless retention is necessary for the specified purpose or by law); **Act s.8(4) to s.8(7)** (erase, and cause the processor to erase); **Rules 8(1)** (retention periods) — **Rules 8(2)** (inform the Data Principal at least 48 hours before completing an erasure) is an operator duty this run does not perform                                                                                    |
| 7                        | the machine-readable event log                                            | **Rule 4 with the First Schedule Part B** (the Consent Manager record: the consents given, denied and withdrawn, the notices and the sharing; kept at least seven years and exportable in machine-readable form) — the closest thing in Indian law to the artifact this run produces. PTF is not a registered Consent Manager and does not assume that role; the obligation becomes enforceable on 13 November 2026                                                       |
| operator duty, not shown | —                                                                         | **Rules 8(1)** and **8(2)** (retention periods; the 48-hour notice before completing an erasure)                                                                                                                                                                                                                                                                                                                                                                          |
| not exercised            | —                                                                         | **Act s.13** (grievance redressal, and the Data Principal must exhaust it before approaching the Board); **Rules 14** (publish how to exercise rights, and respond to a grievance within a period not exceeding ninety days); **Rules 7** (breach intimation to each affected Data Principal without delay, and to the Board without delay with detailed information within 72 hours); **Act s.16** (transfer restrictions — no cross-border transfer is configured here) |

### A negative finding worth stating

Neither the DPDP Act 2023 nor the DPDP Rules 2025 impose a general _record of
processing activities_ obligation on a Data Fiduciary. The strings "record of
processing" and "records of processing" appear nowhere in the Act — that is a
GDPR Article 30 idea, and it does not belong in this table. What the Act does
impose, at **s.6(10)**, is a narrower and more specific duty: where consent is
the basis, the Data Fiduciary must be able to _prove_ that a notice was given
and that consent was given. That is the obligation the per-attempt Processing
Event serves, and it is the closest thing in the Act to a processing record.
The nearest statutory analogue to a machine-readable consent-and-sharing log is
the **Rule 4 / First Schedule Part B** Consent Manager record, which is a
separate regulated role that PTF does not assume.

### When the Rules bite

The Rules phase in: **13 November 2025** (the Board), **13 November 2026**
(Consent Managers) and **13 May 2027** (the substantive Data Fiduciary
obligations — notice, security safeguards, breach notification and the Data
Principal rights). The Board was still being staffed as of August 2026.
Verify the current applicable notifications before relying on any of this for a
specific deployment; PTF does not calculate legal deadlines
(`docs/privacy/dpdp.md:85`).

---

## The limits

- **This is not a compliance certificate.** The script exercises configured
  technical controls and produces evidence of those controls. PTF does not
  decide whether a legal basis is legally sufficient, does not review the
  clinic's notice text, and does not certify anything
  (`docs/privacy/dpdp.md:3`, `:16`; ADR-0024 invariant 7).
- **One host, one processor, one operator.** Enforcement is per-host and
  explicit: a host that does not compose the privacy runtime at its effect
  boundary is _uncovered_, not cleared (ADR-0025, decisions 1 and 4). The
  boundary in this example is the one the host owns; nothing here intercepts
  an unrelated code path.
- **The fence is not atomic with the effect.** The privacy re-read and the
  external effect are still two steps, so a withdrawal that lands in that
  narrow window can still race (`docs/audit/limits.md:388`). Hosts that need
  strict revocation ordering must serialise at the host level.
- **The erasure is bounded by PTF's own reach.** It removes PTF-managed vault
  records bound to that Data Principal reference. Processing Events, the audit
  log, the lab's own copies, upstream records and backups are not erased by
  this path (`docs/audit/limits.md:381`).
- **The operator stays accountable.** Notices, lawful-basis review, processor
  contracts, transfer rules, retention periods, breach notification, grievance
  handling and DPIA remain operator obligations (`docs/privacy/dpdp.md:12`,
  `:87-89`).
- **A Processing Event is not an enterprise activity log.** It tracks
  PTF-mediated attempts only (`docs/audit/limits.md:373`).
- **The host kit boundary is provisional in this branch.** The example calls
  `createEffectBoundary` from `src/hostkit/boundary.ts`, which is a
  provisional implementation of the API and the ordering in
  `docs/superpowers/specs/2026-10-21-host-kit-and-vertical.md` §1.1–§1.2.
  The real host kit lands in `feature/host-kit` and replaces that file; the
  example uses only the documented public API, so it keeps working against
  the real implementation.
