# Launch claims verification — 2026-10-22

Independent, read-only check of every factual claim in the launch kit, plus the
x402 and DPDP claims in `README.md` and `docs/host-kit.md`. Read-only: no source
file was changed; this report is the only addition.

Baseline: `35d1bf6`. The working tree had unrelated uncommitted edits while
this audit ran, so every runtime result below comes from a clean clone at
`%TEMP%\ptf-head-audit`, checked out at `35d1bf6`. The launch files themselves
were unmodified at that commit.

## Bottom line

**Hold the launch.** The core story is supported, but the launch copy and the
demo are not yet safe to publish as written.

- Two of the five demo beats fail on a clean clone. Beat 1 exits 1 with
  `Error: redeem denied: terms`; Beat 3 cannot find the passphrase file or the
  `privacy-config.json` it is told to use.
- Six post sentences need correction: two are wrong (the one-rupee claim and
  the "every stopped attempt leaves evidence" claim), two are overbroad (the
  "exactly ... on nothing else" framing and the conformance claim), and two
  omit qualifiers (the s.6(10) burden and the "both adapters tested" sentence).
- `publish.md` cannot be followed as written: the tarball is 266,974 bytes,
  not 236 kB; `v0.1.0` already exists; and a laptop `npm publish` with
  `provenance: true` fails with `EUSAGE`.
- `launch-facts.md` is mostly right, but it has three factual errors (the
  844(E) link, the `WWW-Authenticate` count, and the facilitator non-custody
  sentence) and two stale DPDP ranges (s.8(4)-(7) and Rule 8's 48-hour warning).
- `README.md` and `docs/host-kit.md` are the most accurate documents. Fix the
  npm install ordering, the conformance wording, and the missing config link.

## Verdict key

| Verdict        | Meaning                                                                    |
| -------------- | -------------------------------------------------------------------------- |
| CONFIRMED      | The primary source says it, or it was reproduced exactly.                  |
| PARTIAL        | True but omits a qualifier that changes the meaning.                       |
| OVERBROAD      | True of a narrower thing than the sentence names.                          |
| MISLEADING     | Literally defensible only under a reading a normal reader will not supply. |
| WRONG          | Contradicted by the primary source or by reproduction.                     |
| WRONG CITATION | The fact is right; the cited document says something else.                 |
| OUTDATED       | Was true of an earlier revision of the file.                               |
| UNVERIFIED     | No primary source found. Do not publish.                                   |
| BROKEN         | The command or step fails when followed as written.                        |
| DOC GAP        | The instruction depends on a file or value the docs do not supply or link. |

## What was reproduced

| Check                                         | Result                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm test`                                    | 567 tests, 91 suites, 567 pass, 0 fail.                                                        |
| `npm run eval`                                | 9 tests, 2 suites, 9 pass, 0 fail.                                                             |
| `node --test dist/tests/mcp-crash.test.js`    | 4 tests, 4 pass.                                                                               |
| `node examples/payment-disclosure.mjs`        | Exit 1: `Error: redeem denied: terms`.                                                         |
| `node examples/dpdp-consent-gateway.mjs`      | Exit 0; transcript matches the doc.                                                            |
| `host-conformance` with a valid config        | 9/9 checks pass, exit 0.                                                                       |
| `host-conformance` without the config         | Exit 1: `privacy: cannot read input file: ./privacy-config.json`.                              |
| Beat 3 without a passphrase file              | Exit 1: `keystore: cannot stat PTF_PASSPHRASE_FILE`.                                           |
| `npm pack --dry-run --json`                   | 266,974 bytes, 161 files, 1,023,934 bytes unpacked; no `dist/tests`, no source maps.           |
| `amountMax: 2000`, amounts 1999 / 2000 / 2001 | ALLOW / ALLOW / DENY (`no-authority`).                                                         |
| `npm view personal-trust-fabric version`      | 404, unclaimed at audit time.                                                                  |
| `git tag --list "v0.1.0*"`                    | `v0.1.0` at `a6d20ad`; `v0.1.0-rc.1` at `727f122`.                                             |
| `npm publish --dry-run`                       | Exit 0; it does not exercise the provenance path. The real path was read in npm 10.9.8 source. |

## 1. `docs/launch/linkedin-post.md`

| #   | Claim                                                                                                                                   | Location       | Source                                                                                                                                                 | Verdict                             | Required action                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "The agent acts on that grant, exactly" / "on nothing else"                                                                             | L25, L47       | REPO: a grant is a set of bounds, not one exact operation; `paymentBounds` is a ceiling and multiple grants can exist                                  | OVERBROAD                           | "The agent acts within that grant, and the host checks every effect against it."                                                           |
| 2   | "Change the amount by one rupee and the grant stops covering it"                                                                        | L47-48         | REPRO: 1999 ALLOW, 2000 ALLOW, 2001 DENY with `amountMax: 2000`                                                                                        | WRONG                               | "Change 2000 to 2001 and it stops covering it; 1999 still fits."                                                                           |
| 3   | "Every effect leaves evidence, including the effects that did not happen" / "so does every attempt that was stopped before it happened" | L26-27, L51-52 | REPO: `docs/verticals/dpdp-consent-gateway.md` L115 says attempt 3 was "denied ... before any evidence was prepared"                                   | WRONG                               | "Every effect that reaches the boundary leaves evidence. A denial before evidence precommit leaves a decision, not a Processing Event."    |
| 4   | DPDP Act 2023; Rules notified 13 Nov 2025; phases 13 Nov 2026 and 13 May 2027                                                           | L55-58         | A; R r.1(2)-(4); N paras (a)-(c); L                                                                                                                    | CONFIRMED                           | None. The printed Gazette says 13 Nov 2025; PIB says 14 Nov. Keep the Gazette date.                                                        |
| 5   | "The Data Protection Board has existed since November 2025"                                                                             | L58            | B (G.S.R. 844(E)) establishes the Board                                                                                                                | CONFIRMED                           | Prefer "established on 13 November 2025"; the notification does not say when members took office, so do not imply a sitting Board.         |
| 6   | "as of ... August 2026, no chairperson had been reported as appointed"                                                                  | L59-60         | L; P                                                                                                                                                   | CONFIRMED                           | Keep "reported" and the date qualifier.                                                                                                    |
| 7   | "Section 6(10) puts the burden on the Data Fiduciary to prove that a notice was given and that consent was given"                       | L63-65         | A s.6(10), p.6; prior DPDP audit row 6                                                                                                                 | MISLEADING                          | Add "where the question arises in a proceeding." The vertical already does this at L152-154.                                               |
| 8   | "a conformance suite lets a host ... prove that its agent paths enforce the controls"                                                   | L69-72         | REPO: `docs/host-kit.md` L171-172 says it "does not prove that a separately running host composes it"                                                  | OVERBROAD                           | "checks the composition it is given; it does not prove an uncomposed path is covered."                                                     |
| 9   | "One signs a JSON body and posts it to any REST endpoint, which covers most payment and KYC APIs"                                       | L73-74         | REPO: `createHttpProvider` signs a canonical JSON body; no coverage study exists                                                                       | UNVERIFIED                          | Delete "covers most payment and KYC APIs"; say "posts a signed JSON body to a REST endpoint."                                              |
| 10  | "Both are tested ... including the cases where the server asks for more ... or names another asset or another payee"                    | L78-80         | REPO: `tests/x402-provider.test.ts` has larger-amount, different-asset and different-payee cases; `tests/http-provider.test.ts` has no challenge cases | MISLEADING                          | Split the sentence: the x402 adapter has those cases; the HTTP adapter is tested for signed submission, failures, redirects, and timeouts. |
| 11  | "Two HTTP provider adapters that speak real protocols"                                                                                  | L73            | REPO: one is a signed-JSON POST convention, one is x402 v2                                                                                             | PARTIAL                             | "Two HTTP provider adapters: a signed-JSON POST adapter and an x402 v2 adapter."                                                           |
| 12  | "the exact erasure"                                                                                                                     | L84            | REPO: transcript L131-132 says this erases PTF-managed records only; lab copies and backups are outside                                                | PARTIAL                             | "the erasure of the PTF-managed records, scoped to the subject."                                                                           |
| 13  | "not a wallet ... enforcement is per host ... uncovered ... a different thing from compliant"                                           | L88-93         | REPO: ADR-0025; `docs/audit/limits.md`                                                                                                                 | CONFIRMED                           | None. Add a short version of this caveat to the feed post; the short version currently omits it.                                           |
| 14  | The poster's "do not use compliant" rule                                                                                                | L105-108       | Text scan                                                                                                                                              | CONFIRMED (no affirmative claim)    | L92 uses the word only to negate it. If the rule is literal, rewrite that clause.                                                          |
| 15  | The x402 usage counters                                                                                                                 | L109           | Text scan                                                                                                                                              | CONFIRMED absent from the post body | Keep them in the notes only; do not move them into the copy.                                                                               |

## 2. `docs/launch/demo-script.md`

| #   | Claim                                                                                                             | Location | Source                                                                                                                                                                                 | Verdict   | Required action                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "Everything below runs from a clean clone with no credentials and no network beyond `npm install`"                | L13-14   | REPRO: Beat 1 exits 1; Beat 3 fails                                                                                                                                                    | WRONG     | Fix Beats 1 and 3, then run all five beats from a fresh clone before publishing.                                                          |
| 2   | `node examples/payment-disclosure.mjs`                                                                            | L26      | REPRO: exit 1, `Error: redeem denied: terms`. `src/core/capability.ts` L205-220 requires `resource` and `purpose`; the demand at `examples/payment-disclosure.mjs` L95-100 has neither | BROKEN    | Add `resource: "invoice:inv-1"` and `purpose: "groceries"` to the demand, or change the beat to a working example; add the example to CI. |
| 3   | "The decision is a pure function of an exact operation, an exact recipient, an exact amount and a verified actor" | L29-31   | REPO: the example calls `evaluate` with `consume: true`; the cap's `amountMax` is 1790                                                                                                 | PARTIAL   | "deterministic policy evaluation of the operation, recipient, amount and host-asserted actor"; drop "pure" and "exact amount."            |
| 4   | "Change the amount by one rupee and the grant no longer covers it"                                                | L31      | REPRO: 1999/2000 ALLOW, 2001 DENY                                                                                                                                                      | WRONG     | Same fix as the post: it is a ceiling, not an exact value.                                                                                |
| 5   | Beat 2 command and transcript claims                                                                              | L37-51   | REPRO: exit 0; transcript L83-132                                                                                                                                                      | CONFIRMED | The event records the requested category set, including a withheld category (L96); do not present it as the disclosure manifest.          |
| 6   | "The erasure is exact and subject-bound"                                                                          | L50-51   | REPO: transcript L131-132 limits erasure to PTF-managed records                                                                                                                        | PARTIAL   | Add "within the PTF-managed store; the lab's copies and backups are outside this path."                                                   |
| 7   | `export PTF_PASSPHRASE_FILE="$HOME/.ptf/passphrase"`                                                              | L59      | REPRO: file does not exist; `keygen` exits 1 with `keystore: cannot stat PTF_PASSPHRASE_FILE`. No doc creates the file                                                                 | BROKEN    | Use `PTF_PASSPHRASE=...` for the throwaway demo, or add `mkdir -p ~/.ptf` and a 0600 file creation step.                                  |
| 8   | `--privacy-config ./privacy-config.json`                                                                          | L63      | REPO: no `privacy-config.json` in the repository; a complete sample exists at `docs/privacy/dpdp.md` L46-63                                                                            | BROKEN    | Ship `examples/privacy-config.example.json` (or point at the sample) and use an absolute path.                                            |
| 9   | "Nine checks ... prove ... its own agent paths enforce the controls"                                              | L66-68   | REPRO: 9/9 with a valid config; `docs/host-kit.md` L171-172 caveat                                                                                                                     | OVERBROAD | "Nine checks of the composition it is given; a host that does not route an effect through the boundary is uncovered."                     |
| 10  | "exit code is 0 only when all of them pass"                                                                       | L67      | REPRO: 9/9 exit 0; missing config exit 1                                                                                                                                               | CONFIRMED | None.                                                                                                                                     |
| 11  | Beat 4 command and journal claims                                                                                 | L78-83   | REPRO: 4/4; the test asserts `status: "outcome_unknown"`                                                                                                                               | CONFIRMED | None.                                                                                                                                     |
| 12  | Beat 5 limits                                                                                                     | L89-99   | REPO: `docs/audit/limits.md`                                                                                                                                                           | CONFIRMED | None.                                                                                                                                     |

## 3. `docs/launch/publish.md`

| #   | Claim                                                         | Location | Source                                                                                                                                                         | Verdict                     | Required action                                                                                                                              |
| --- | ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "`npm pack` produces a 236 kB tarball"                        | L3       | REPRO: 266,974 bytes (260.7 KiB), 161 files                                                                                                                    | WRONG                       | "267 kB (261 KiB), 161 files"; re-measure after the next build.                                                                              |
| 2   | The tarball contains the three named bins, README and LICENSE | L3-5     | REPRO: all present; a fourth `personal-trust-fabric` bin also exists                                                                                           | CONFIRMED (incomplete list) | Say "four bins" or add the fourth.                                                                                                           |
| 3   | The npm name is unclaimed (404)                               | L5-7     | REPRO: 404                                                                                                                                                     | CONFIRMED                   | Re-check immediately before publishing.                                                                                                      |
| 4   | `dist/tests/**` and source maps are excluded                  | L30-31   | REPRO: no `dist/tests`, 0 maps                                                                                                                                 | CONFIRMED                   | None.                                                                                                                                        |
| 5   | "From a laptop, npm publishes without provenance"             | L40-44   | NPM 10.9.8 `libnpmpublish/lib/publish.js` L138-196: `provenance: true` calls `ensureProvenanceGeneration`, which throws `EUSAGE` outside GitHub Actions/GitLab | WRONG                       | Publish from GitHub Actions with `id-token: write`, or remove `publishConfig.provenance` for a laptop publish and say provenance is skipped. |
| 6   | "Tag the release: `git tag -a v0.1.0`"                        | L65      | REPRO: `v0.1.0` exists at `a6d20ad` (2026-09-12); `v0.1.0-rc.1` at `727f122`; CHANGELOG says `main` is ahead of both                                           | BROKEN                      | Cut `v0.1.1` (or reconcile tags per CHANGELOG) and tag the commit actually published.                                                        |
| 7   | README "currently says 'npm pending'"                         | L66-67   | REPRO: README L74 says "The first release is not on npm yet"; no "npm pending" string                                                                          | OUTDATED                    | Update the instruction to the actual sentence.                                                                                               |
| 8   | Preflight commands exist                                      | L16-18   | REPO: `scripts/check-seams.mjs`, `scripts/harness.sh`, `npm test`, `npm run eval` all exist                                                                    | CONFIRMED                   | None; note `bash` is required for `harness.sh`.                                                                                              |
| 9   | `npx ptf` and `npx personal-trust-fabric` work after install  | L58-61   | REPO: both bins map to `./dist/src/cli.js`                                                                                                                     | CONFIRMED                   | Verify once the package is published.                                                                                                        |
| 10  | "PTF is publish-ready"                                        | L3       | REPRO: the tarball is installable, but the demo and README fixes are pending                                                                                   | OVERBROAD                   | "The package is publishable"; fix the demo/docs before the launch.                                                                           |

## 4. `docs/launch/launch-facts.md`

### 4a. Needs correction

| #   | Claim                                                                                        | Location | Source                                                                                                                                                       | Verdict                          | Required action                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | "The Data Protection Board was established by G.S.R. 844(E)" with the `c56ceae6...` link     | L24      | The linked PDF is **G.S.R. 843(E)**, the Act commencement notification. 844(E) is `cc217843...`                                                              | WRONG CITATION                   | Replace the URL with `https://www.meity.gov.in/static/uploads/2025/11/cc217843dc3bcb37b2b05bcc3b4e031f.pdf`. The fact is right.                                    |
| 2   | "`WWW-Authenticate` appears nowhere in any version of the spec or the docs (0 hits)"         | L47      | X: 7 hits in `specs/extensions/extension-auth-hints.md`; the extension explicitly discusses compatibility                                                    | WRONG                            | Delete the sentence or say "the core v2 transport does not use `WWW-Authenticate`; the `auth-hints` extension does."                                               |
| 3   | "The facilitator verifies and settles; it does not hold funds"                               | L49      | X §7 and §6.1: the facilitator verifies/settles, and `upfront`/`escrow` flows commit funds before the resource executes; the spec does not state non-custody | UNVERIFIED                       | Delete "it does not hold funds" or say "the spec does not define custody; a facilitator may settle or escrow depending on the scheme."                             |
| 4   | "Act s.8(4) to (7): technical and organisational measures, security safeguards, erasure ..." | L30      | A s.8(4)-(7), pp.7-8; prior DPDP audit rows 8-9                                                                                                              | MISLEADING                       | Cite s.8(4)-(5) for safeguards, s.8(6) for breach notification, s.8(7) for erasure.                                                                                |
| 5   | "Rule 8: retention periods and the 48-hour erasure warning"                                  | L32      | R r.8(1)-(2), p.27 + Third Schedule; prior DPDP audit row 20                                                                                                 | WRONG                            | r.8(1)-(2) apply only to Third Schedule classes; the 48-hour warning runs before the rule's erasure period, not before any s.12 request. Delete the general claim. |
| 6   | "Google announced AP2 on 16-17 September 2025"                                               | L55      | G1: the Google Cloud post is dated 17 September 2025                                                                                                         | PARTIAL                          | Use "17 September 2025"; the 16 September half is not supported by the cited source.                                                                               |
| 7   | Penalties are cited to the PIB backgrounder                                                  | L34      | A Schedule (s.33(1)), p.21; prior DPDP audit row 29                                                                                                          | CONFIRMED figures, weak citation | Keep the figures; cite the Act's Schedule. The PIB document does not carry the penalty table.                                                                      |
| 8   | "Act s.6(10): ... shall be obliged to prove that a notice was given"                         | L26      | A s.6(10), p.6; prior DPDP audit row 6                                                                                                                       | PARTIAL                          | Add the condition "where a question arises in this regard in a proceeding."                                                                                        |

### 4b. Confirmed without change

| Claim                                                                                                 | Location | Source                                                                               |
| ----------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| Act No. 22 of 2023, 11 August 2023                                                                    | L18      | A                                                                                    |
| Rules G.S.R. 846(E), Gazette No. 760, 13 November 2025                                                | L19      | R                                                                                    |
| Phase 1 (13 Nov 2025), Phase 2 (13 Nov 2026), Phase 3 (13 May 2027)                                   | L20-22   | R r.1(2)-(4); N paras (a)-(c); L                                                     |
| The Government described the same phases in Parliament on 12 August 2026                              | L23      | L                                                                                    |
| Board recruitment ad ran 6 June 2026; no appointment reported on 12 August 2026                       | L25      | P; L                                                                                 |
| Act s.6(4)-(6): withdrawal, comparable ease, cessation, prior processing stays lawful                 | L27      | A s.6(4)-(6), pp.5-6 (omits s.6(5) consequences and the "reasonable time" in s.6(6)) |
| Act s.5: notice before/with the consent request                                                       | L28      | A s.5(1), p.4                                                                        |
| Act s.7: certain legitimate uses                                                                      | L29      | A s.7, pp.6-7                                                                        |
| Act s.11 access, s.12 correction/erasure, s.13 grievance                                              | L31      | A ss.11-13, pp.9-10 (s.12 is limited to data previously consented to)                |
| Rule 4 + First Schedule Part B: Consent Manager records for seven years, machine-readable on request  | L33      | R r.4(3), p.25 + First Sch. Part B; prior DPDP audit row 22                          |
| "record of processing" does not appear in the Act                                                     | L36-38   | A, full-text search                                                                  |
| x402 Foundation operational launch 14 July 2026, 40 members, Premier list                             | L44      | F                                                                                    |
| Protocol Version 2, 9 December 2025                                                                   | L45      | X, revision table                                                                    |
| `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`; v1 headers superseded                    | L46-47   | X, `specs/transports-v2/http.md`, migration guide                                    |
| Amount is an atomic-unit string; the core spec does not define decimals                               | L48      | X §5.1                                                                               |
| Mastercard Agent Pay 29 April 2025; Visa Intelligent Commerce 30 April 2025; Visa TAP 14 October 2025 | L56      | M; V                                                                                 |
| A2A donated 23 June 2025; 150+ organisations on 9 April 2026                                          | L57      | LF1; LF2                                                                             |
| Agentic AI Foundation formed 9 December 2025                                                          | L58      | LF3                                                                                  |
| Moffatt v. Air Canada, 2024 BCCRT 149                                                                 | L59      | C                                                                                    |
| July 2025 report of a coding agent deleting a production database                                     | L60      | The cited SaaSTR article only; secondary report, no primary incident record reviewed |

## 5. `README.md`

| #   | Claim                                                                                                                                                                                   | Location         | Source                                                                               | Verdict    | Required action                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------------- |
| 1   | `npm install personal-trust-fabric` appears before "The first release is not on npm yet"                                                                                                | L71 vs L74       | REPRO: `npm view` returns 404                                                        | MISLEADING | Put the `github:` install first, or label the npm line "after publication."             |
| 2   | "a host kit ... proves it with a conformance suite"                                                                                                                                     | L62              | REPO: `docs/host-kit.md` L171-172                                                    | PARTIAL    | "checks the composition it is given"; do not imply adoption.                            |
| 3   | `host-conformance --privacy-config ./privacy-config.json`                                                                                                                               | L156, L166, L169 | REPRO: no `privacy-config.json` in the repo; sample at `docs/privacy/dpdp.md` L46-63 | DOC GAP    | Ship an example file or link the sample; document the required fields.                  |
| 4   | "a host can put it in CI and say, with evidence, that its own agent paths enforce the controls"                                                                                         | L159             | REPO: `docs/host-kit.md` L171-172                                                    | OVERBROAD  | "that the composition it gave the suite enforces the controls."                         |
| 5   | "What CI proves on every merge: strict TypeScript, the full unit suite, attack/property evaluations, public-seam and zero-dependency hygiene, secret scanning, and the docs site build" | L58              | REPO: `.github/workflows/ci.yml` (gate, docs, secrets)                               | CONFIRMED  | None. "Every merge" assumes branch protection; CI runs on every push.                   |
| 6   | "reference providers move nothing"                                                                                                                                                      | L64              | REPO: `docs/audit/limits.md`                                                         | CONFIRMED  | None.                                                                                   |
| 7   | The DPDP vertical runs with one command, no credentials, no network, and no state outside a temporary directory                                                                         | L91, L153        | REPRO: exit 0; transcript L69                                                        | CONFIRMED  | None.                                                                                   |
| 8   | The package ships `ptf`, `ptf-mcp-server`, `ptf-pdp-server` and the `./privacy`, `./providers`, `./vault` subpaths                                                                      | L80-82           | REPO: `package.json`                                                                 | CONFIRMED  | None. A fourth bin, `personal-trust-fabric`, also ships; mention it or say "four bins." |

## 6. `docs/host-kit.md`

| #   | Claim                                                                                                                     | Location    | Source                                                                                                              | Verdict   | Required action                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| 1   | "every operation it performs is then decided by Authority, narrowed by the privacy plane, and evidenced"                  | L10-12      | REPO: only effects routed through `createEffectBoundary` are covered; L14 says it is a boundary, not an interceptor | OVERBROAD | "every operation routed through it."                       |
| 2   | "A host that does not route its effects through it is uncovered, not compliant"                                           | L14-16      | REPO: ADR-0025                                                                                                      | CONFIRMED | None. This is the caveat the launch copy needs.            |
| 3   | The kit ships on `./hostkit` and is not re-exported from the root barrel                                                  | L20, L30-31 | REPO: `package.json` exports; `src/hostkit/index.ts`                                                                | CONFIRMED | None.                                                      |
| 4   | Nine executable checks, each observed against a real encrypted store                                                      | L128        | REPRO: 9/9, exit 0                                                                                                  | CONFIRMED | None.                                                      |
| 5   | `host-conformance --privacy-config ./privacy-config.json`                                                                 | L132        | REPRO: no `privacy-config.json` in the repo; sample at `docs/privacy/dpdp.md` L46-63                                | DOC GAP   | Link the sample or ship an example file.                   |
| 6   | The checks run in a scratch directory; the operator's store is read, never written; nothing reaches the network           | L142-144    | REPO: `src/hostkit/conformance.ts`; scratch store; no network calls                                                 | CONFIRMED | None.                                                      |
| 7   | A failing check is `ok: false` with a detail, never an exception                                                          | L156-157    | REPO: `runHostConformance` catches per-check failures                                                               | CONFIRMED | None.                                                      |
| 8   | It does not decide that a basis is legally sufficient and never reports `compliant`                                       | L166-167    | REPO: `docs/audit/limits.md`                                                                                        | CONFIRMED | None.                                                      |
| 9   | "It does not prove that a separately running host composes it. The conformance suite proves the composition it is given." | L171-172    | REPO: the suite receives a boundary factory                                                                         | CONFIRMED | None. Keep this sentence; the launch copy should quote it. |

## 7. DO-NOT-USE scan

The post body and demo were scanned for every previously banned claim. "Post
body" means the copy before "Notes for the poster"; the notes at L109 are not
part of the post.

| Banned claim                              | Post body                        | Demo | README | host-kit                        | launch-facts            | Verdict         |
| ----------------------------------------- | -------------------------------- | ---- | ------ | ------------------------------- | ----------------------- | --------------- |
| x402 75.41M transactions / $24.24M volume | None (notes L109 only)           | None | None   | None                            | L64, unverified list    | PASS            |
| Visa Trust Index 23% / 61%                | None                             | None | None   | None                            | L67-70, unverified list | PASS            |
| Visa "4,700% surge"                       | None                             | None | None   | None                            | L71-73, unverified list | PASS            |
| Stripe 22% / 40%                          | None                             | None | None   | None                            | L74-76, unverified list | PASS            |
| OLAS 14M deals / Mastercard 30 firms      | None                             | None | None   | None                            | L77-78, unverified list | PASS            |
| Washington Post, 2 October 2026           | None                             | None | None   | None                            | L79-80, unverified list | PASS            |
| Affirmative "compliant"                   | None; L92 uses it only to negate | None | None   | L167, "never reports compliant" | None                    | PASS (see note) |

Note: if the poster's rule is literal ("do not use the words anywhere"), rewrite
L92's "which is a different thing from compliant" as "which is not a compliance
claim." The current use is a disclaimer, not a claim.

## 8. Per-document verdict

| Document                       | Verdict                           | Reason                                                                                                                | Gate before publishing                                                  |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/launch/linkedin-post.md` | **NOT SAFE AS WRITTEN**           | Six sentences need correction (two wrong, two overbroad, two misleading); the short version omits the per-host caveat | Fix L25, L47-48, L51-52, L63-65, L69-72, L78-80; add the caveat.        |
| `docs/launch/demo-script.md`   | **NOT SAFE AS WRITTEN**           | Beat 1 and Beat 3 fail on a clean clone                                                                               | Fix the example and the passphrase/config steps; re-run all five beats. |
| `docs/launch/publish.md`       | **NOT SAFE TO FOLLOW**            | Tarball size, existing tag, and provenance behavior are wrong                                                         | Re-measure; cut the next tag; publish from CI or drop provenance.       |
| `docs/launch/launch-facts.md`  | **NOT SAFE AS A SOURCE OF TRUTH** | Three factual errors and two stale DPDP ranges                                                                        | Fix L24, L26, L30, L32, L47, L49, L55 before citing it.                 |
| `README.md`                    | **SAFE WITH FIXES**               | Core claims are accurate; install order, conformance wording, config link need work                                   | Reorder L71/L74; soften L62/L159; link the config sample.               |
| `docs/host-kit.md`             | **SAFE WITH FIXES**               | Accurate and appropriately caveated; only the config path is missing                                                  | Link the config sample; tighten L10-12 to "routed through it."          |
| **Overall launch**             | **HOLD**                          | The post and demo blockers are material                                                                               | Re-run this audit after the fixes.                                      |

## 9. Fix list

### P0 — blockers

1. `examples/payment-disclosure.mjs` L95-100: add `resource: "invoice:inv-1"` and
   `purpose: "groceries"` to the redemption demand. Without both,
   `Capabilities.redeem` returns `reason: "terms"` before it evaluates the
   amount. Add the example to CI so it cannot rot again.
2. `demo-script.md` L59: create the passphrase file or use `PTF_PASSPHRASE` for
   the throwaway demo. `README.md` L132 and L162 currently tell the reader to
   `chmod` a file that does not exist.
3. `demo-script.md` L63, `README.md` L156/L166, `host-kit.md` L132: no
   `privacy-config.json` is shipped. Point at the sample in
   `docs/privacy/dpdp.md` L46-63 or ship `examples/privacy-config.example.json`.
4. `linkedin-post.md` L47-48 and `demo-script.md` L31: the one-rupee claim is
   false downward. 1999 and 2000 both pass a 2000 ceiling.
5. `linkedin-post.md` L26-27, L51-52: the "every stopped attempt leaves
   evidence" claim contradicts the project's own transcript. Attempt 3 is
   denied before evidence precommit.
6. `publish.md` L40-44: do not tell the operator a laptop publish silently
   skips provenance. With `publishConfig.provenance: true`, npm 10.9.8 throws
   `EUSAGE: Automatic provenance generation not supported for provider: ...`.
   Publish from GitHub Actions with `id-token: write`, or remove the setting.
7. `publish.md` L65: `v0.1.0` already exists at an older commit. Cut `v0.1.1`
   or reconcile tags first.

### P1 — accuracy

8. `linkedin-post.md` L69-72, `README.md` L62/L159, `demo-script.md` L66-68:
   align the conformance wording with `host-kit.md` L171-172.
9. `linkedin-post.md` L78-80: split the x402 and HTTP test coverage. Only x402
   has larger-amount, different-asset and different-payee cases.
10. `launch-facts.md` L24: point the 844(E) claim at the 844(E) PDF.
11. `launch-facts.md` L47: delete the "0 hits" sentence. There are 7 hits in
    the `auth-hints` extension.
12. `launch-facts.md` L49: delete "it does not hold funds." The spec allows
    `escrow` and `upfront` fund commitment and does not define custody.
13. `launch-facts.md` L30: split s.8(4)-(5), s.8(6) and s.8(7).
14. `launch-facts.md` L32: delete the general Rule 8 48-hour claim. It applies
    only to Third Schedule classes and to the rule's own erasure period.
15. `linkedin-post.md` L63-65 and `launch-facts.md` L26: add "in a proceeding"
    to the s.6(10) sentence.
16. `launch-facts.md` L55: use 17 September 2025 for AP2.
17. `linkedin-post.md` L25 and L47: "exactly" and "on nothing else" describe a
    grant as one exact operation. A grant is a set of bounds. Say "within the
    grant, checked on every effect."

### P2 — polish

18. `README.md` L71/L74: put the install that works first.
19. `publish.md` L3: replace "236 kB" with "267 kB (261 KiB)".
20. `publish.md` L66-67: the README no longer says "npm pending."
21. `linkedin-post.md` L73-74: delete "covers most payment and KYC APIs" and
    name the two adapters (signed-JSON POST and x402 v2).
22. `linkedin-post.md` L84 and `demo-script.md` L50-51: scope "exact erasure"
    to PTF-managed records.
23. `linkedin-post.md` short version: add one sentence of per-host scope, or a
    link to the limits.

## 10. Sources

| Ref  | Document                                                                                                            | Locator                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A    | DPDP Act, 2023 (No. 22 of 2023), Gazette, 11 August 2023                                                            | <https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf>                                                                                                         |
| R    | DPDP Rules, 2025, G.S.R. 846(E), Gazette No. 760, 13 November 2025                                                  | <https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf>                                                                                                         |
| N    | Act commencement, G.S.R. 843(E), 13 November 2025                                                                   | <https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf>                                                                                                         |
| B    | Board establishment, G.S.R. 844(E), 13 November 2025                                                                | <https://www.meity.gov.in/static/uploads/2025/11/cc217843dc3bcb37b2b05bcc3b4e031f.pdf>                                                                                                         |
| L    | Lok Sabha Unstarred Q. No. 3960, answered 12 August 2026                                                            | <https://sansad.in/getFile/lsapps/loksabhaquestions/annex/188/AU3960_GyWSTk.pdf>                                                                                                               |
| P    | MeitY advertisement, Chairperson/Members, 6 May 2026 (Employment News, 6 June 2026)                                 | <https://www.meity.gov.in/static/uploads/2026/05/53b1bcf01cab9a0adde463e73fbc3417.pdf>                                                                                                         |
| X    | x402 Protocol Version 2, 9 December 2025; `specs/transports-v2/http.md`; `specs/extensions/extension-auth-hints.md` | <https://github.com/x402-foundation/x402> (clone HEAD `faa1c69`, 2026-10-15)                                                                                                                   |
| F    | Linux Foundation, x402 Foundation operational launch, 14 July 2026                                                  | <https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications>                |
| G1   | Google Cloud, "Powering AI commerce with AP2", 17 September 2025                                                    | <https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol>                                                                                        |
| G2   | Google, AP2 donated to the FIDO Alliance, 28 April 2026                                                             | <https://blog.google/products-and-platforms/platforms/google-pay/agent-payments-protocol-fido-alliance/>                                                                                       |
| M    | Mastercard Agent Pay, 29 April 2025                                                                                 | <https://investor.mastercard.com/investor-news/investor-news-details/2025/Mastercard-Unveils-Agent-Pay-Pioneering-Agentic-Payments-Technology-to-Power-Commerce-in-the-Age-of-AI/default.aspx> |
| V    | Visa Intelligent Commerce, 30 April 2025; Visa Trusted Agent Protocol, 14 October 2025                              | <https://usa.visa.com/about-visa/newsroom/press-releases.release.21361.html>; <https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.21716.html>                                   |
| LF1  | Linux Foundation, A2A launch, 23 June 2025                                                                          | <https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents>                                |
| LF2  | Linux Foundation, A2A 150+ organisations, 9 April 2026                                                              | <https://www.linuxfoundation.org/press/a2a-protocol-surpasses-150-organizations-lands-in-major-cloud-platforms-and-sees-enterprise-production-use-in-first-year>                               |
| LF3  | Linux Foundation, Agentic AI Foundation, 9 December 2025                                                            | <https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation>                                                                                  |
| C    | Moffatt v. Air Canada, 2024 BCCRT 149                                                                               | CRT decisions portal, neutral citation 2024 BCCRT 149                                                                                                                                          |
| NPM  | npm registry; npm 10.9.8 `libnpmpublish/lib/publish.js` L138-196                                                    | `npm view personal-trust-fabric`; local npm installation                                                                                                                                       |
| REPO | Repository at `35d1bf6`                                                                                             | `package.json`, `tests/`, `examples/`, `src/`, `docs/`                                                                                                                                         |

Cross-check: `docs/audit/2026-10-22-dpdp-provision-verification.md` rows 6,
8-9, 20, 22, 29 and 33 reach the same DPDP conclusions from the same Gazette
prints.

## 11. Could not verify

- **A live npm publish.** No npm credentials were used. The `EUSAGE` behavior
  is read from npm 10.9.8's `libnpmpublish` source and is deterministic, but a
  real publish from CI is still the only end-to-end proof.
- **The tarball size after the working-tree edits.** Measured at `35d1bf6`
  with the build present; the uncommitted edits may change it.
- **Every Premier member name in the x402 Foundation list.** The press release
  lists them; the four named in the post (Visa, Mastercard, Stripe, Google)
  were checked directly.
- **The Replit incident beyond the cited article.** The claim is a "July 2025
  report," and the cited SaaSTR article supports that framing; no primary
  incident record was reviewed.
- **Board appointments after 12 August 2026.** The post's claim is limited to
  "not reported" as of that answer, which the Lok Sabha answer supports.
- **The 16 September half of the AP2 date.** The cited Google Cloud post is
  dated 17 September 2025; no primary source for 16 September was found.
- **The do-not-use counters.** They were not re-verified because they must not
  be used; the scan only confirms they are absent from the publishable copy.
