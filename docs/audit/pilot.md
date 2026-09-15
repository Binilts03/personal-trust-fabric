# Pilot plan — test funds before real assets (owner-run)

No auditor, no live rails, and no agent run can substitute for the
operator performing every drill with their own hands. Run this pilot
with TEST rails and NON-SENSITIVE credentials only. Real money, real
keys, and production secrets stay out until the exit criteria hold.

## Entry criteria

- [ ] Prod-ready tree merged to `main` via PR + green CI (gate + secrets).
- [ ] `verify.md` reproduced from a fresh clone on the operator's machine.
- [ ] Package installed from the release tarball (not a laptop build):
      `npm pack` → blank-dir `npm install <tarball>` → `import()` resolves.
- [ ] Operator image built (`docker build -t ptf:<tag> .`), digest
      recorded in `public-flip.md` §7, `audit --verify` green inside it.
- [ ] Backup location exists OUTSIDE the pilot host (owner-accessible).

## Pilot setup (records to keep)

- Dedicated store dir (never the dev one), passphrase in a 0600 file
  (`PTF_PASSPHRASE_FILE`), never env, never chat, never screenshots.
- Anchor logbook: every backup's `anchor.json` root/count pasted next to
  its date (see `operations.md` backup runbook).
- Decision log: every surprise, however small, written down the same day.

## Operator drills (each performed by the human, not the agent)

1. **Issue → spend → revoke**: `init`, `keygen`, `recipient`, `grant`,
   `pay --yes` on the Fake/test rail, `audit --verify`, `revoke --grant`,
   then prove the revoked grant denies (re-run the spend, watch it fail).
2. **Rotation**: PDP keys-file overlap cutover per `operations.md`
   (old 401s, new 200s, zero restarts).
3. **Restore**: delete the live store, restore from backup + anchor,
   `audit --verify` green AND a stale-file restore alarms (prove both
   directions at least once).
4. **Log inspection**: after a week of pilot traffic, grep backups and
   shipped logs for key material / PAN-shaped strings; any hit aborts
   the pilot (redaction failure).

## Suggested duration and traffic

2–4 weeks of routine pilot traffic (daily spends/disclosures on test
rails). Boredom is the point: the system must be uneventful before it
is trusted.

## Exit criteria (all required for live-asset consideration)

- [ ] Zero unexplained allows, zero secret sightings in any copy,
      zero failed restores across the whole pilot.
- [ ] Third-party audit commissioned (see `commissioning.md`) with
      findings remediated + retested — or a dated, signed owner waiver.
- [ ] Custody decision recorded: file keystore kept (with its stated
      residual) or HSM/KMS host seam implemented.
- [ ] npm package published from CI (Trusted Publisher) and
      blank-install verified — no laptop builds in the live path.

## Abort criteria (any one stops the pilot)

An allow without matching authority; a secret in any receipt, log,
backup, or screenshot; a restore that silently allows stale state; a
lost passphrase or backup; any CI gate red on `main`.
