---
name: verify
description: Prove a PTF task works before it ships. Triggers: verify, prove it works, verification, pre-PR check.
---

# /verify — PTF task verification SOP (non-web library)

Run on a branch with changes committed. Default `RUN_MODE=local`.

1. **Stack up:** `scripts/dev-local.sh up` (install + typecheck + tests). Must be green before anything else.
2. **Drive the change:** spawn a fresh verifier sub-agent (or a clean shell) that exercises the changed seam from `src/index.ts` — never internals — with a script under `/tmp` or `evidence/`. For capability work: issue → attenuate → dry-run → redeem-with-proof → assert receipt fields, plus one abuse case (replay / wrong recipient / mutated digest).
3. **Regression sweep:** `npm run typecheck && npm test`. Note the exact failing assertion on red; fix in the main session, re-run until green.
4. **Evidence:** save verifier output to `evidence/<date>-<slug>.log` (gitignored). Paste the 5-line tail + the `node --test` summary into the PR/scratch comment.
5. **Ship:** open the PR (once a remote exists) with the proof embedded. No proof, no merge.

`DRIVER=node --test + tsc` (no browser: library repo, no `playwright-cli` needed).
`AUTH_HELPER=n/a` (no login-gated flows in v0.1 core).
