# Loops

Recurring workstreams and how to run each. One loop = one separable concern.

## dev loop (manual, on every change)

Entry: `scripts/dev-local.sh up`. Does install → typecheck → test. See `.claude/skills/dev-local/SKILL.md`.

## verify loop (per task, before ship)

Entry: `/verify` (`.claude/skills/verify/SKILL.md`). Fresh verifier drives the public seam from `src/index.ts`, runs the regression sweep, saves `evidence/<date>-<slug>.log`. No proof, no merge.

## eval loop (per capability change)

Entry: `npm test` + `fast-check` property suite (once added): child≤parent holds over random narrowings; cascade revocation holds over random trees; expiry-wins holds over random bounds. Golden attack transcripts live in `tests/` (replay, over-spend, wrong recipient, mutated digest, `/`-top, powerline).

## tdd loop (red → green, one slice at a time)

One seam, one failing test, minimal implementation. Seams under test are agreed before code (see `tests/`). Refactoring belongs to review, not the loop.

## ticket subloop (per tracer ticket; the delivery engine for ptf-v01)

Same five steps, every ticket, no exceptions. Designed 2026-09-09 after tickets 01/01-policy-approval proved it.

1. **Claim.** Set the ticket `Status: claimed` before any other work, so parallel sessions skip it.
2. **Red.** Write the failing test first at the public seam (`src/index.ts` only), with independent expected values (fixed seeds, hand-computed digests). Confirm it fails for the right reason.
3. **Green.** Minimal implementation in a new deep module (small interface, secrets never cross it). No speculative features.
4. **Verify.** `npm run typecheck && npm test` fully green. A red caused by the fixture is fixed in the test; a red caused by the module is fixed in the module — never blur the two.
5. **Resolve.** Append `## Answer` (what was built, which acceptance criteria, test evidence), set `Status: resolved`.

Done-condition: every acceptance checkbox in the ticket file holds, proven by the suite output in step 4.

## knowledge loops (deferred)

`new-loop` knowledge-base loops (`domains/<loop>/README.md` + `LOG.md`) are deferred until a KB repo exists. `loopany` mission/task/signal capture applies to decisions meanwhile (see wayfinder map).
