---
name: Bug report
about: Something in PTF fails closed when it should allow — or worse, allows when it should deny
title: "[bug] "
labels: bug
---

## What happened

<!-- Observed behavior. For fail-OPEN suspicions (an allow without authority), say so in the first line. -->

## Expected behavior

<!-- What the ADRs / limits.md say should happen. Cite the rule. -->

## Reproduction

```sh
# Minimal commands from a fresh store (synthetic data only — never paste real secrets, keys, or tokens)
```

## Environment

- Commit / tag:
- Node (`node --version`):
- OS:

## Security note

If this report involves a secret that touched a log, receipt, backup, or screenshot, state that plainly. For live vulnerabilities, report privately per `SECURITY.md` instead.
