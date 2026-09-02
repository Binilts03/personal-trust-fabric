# Codebase Harness

The harness is executable repository infrastructure that makes the project legible, testable, recoverable, and reviewable by agents. It is not one enormous `AGENTS.md`.

## 1. Required harness capabilities

### H1 — Thin entrypoint
A root agent instruction file should contain only:
- project mission;
- hard invariants;
- map/pointers to authoritative docs;
- command discovery;
- skill-routing requirement;
- security/review gates.

Do not duplicate detailed specifications into the entrypoint.

### H2 — Repository map
Codex must maintain a small, current map of bounded contexts/modules and authoritative docs.

### H3 — Domain context
Maintain canonical glossary/context files and ADRs close to the relevant context.

### H4 — Command registry
One authoritative source for:
- bootstrap;
- dev;
- build;
- lint;
- unit;
- integration;
- e2e;
- security;
- conformance;
- release.

Prefer commands discoverable from repository configuration rather than prose caches.

### H5 — Deterministic verification
A fresh verifier must be able to run the product and collect evidence.

### H6 — Architecture lints
Promote important architectural invariants into mechanical checks when possible:
- scenario vocabulary out of core;
- forbidden secret serialization;
- dependency-direction rules;
- missing policy/receipt tests;
- client bundle importing trusted secret modules.

### H7 — Synthetic fixtures
Deterministic principals, credentials, policies, recipients, capabilities, payment/signing fixtures, and unique canaries.

### H8 — Execution ledger
Persist:
- work item;
- selected skills;
- assumptions/rulings;
- subagent dispatch/result;
- tests/evidence;
- review findings/fixes;
- completion status.

This is the recovery map after context compaction.

### H9 — Isolated work
Use worktrees/sandboxes/isolated environments for parallel or risky implementation. Never allow multiple agents to race on overlapping mutable state without explicit coordination.

### H10 — Sanitized observability
Logs/traces/eval artifacts must be useful without copying protected values.

### H11 — Review packages
Fresh reviewers get:
- goal/spec;
- exact diff/files;
- constraints;
- actual verification evidence;
- review rubric.

### H12 — Context audit
Periodically audit agent instructions, skills, docs, tool descriptions, and harness state for:
- conflicts;
- duplication;
- stale facts;
- missing gotchas;
- overconstraint;
- malicious/untrusted persistent instructions.

## 2. Harness research candidates

These are research references, not mandatory dependencies:

- AI-Builder-Club/skills — codebase harness, verifier, context audit, loop/delegation patterns.
- Sol Advisor — Codex-native controller/implementer/fresh-review routing patterns.
- SkillOpt / SkillOpt-Sleep — validation-gated skill evolution.
- Headroom — context compression/retrieval ideas; any use must be evaluated because lossy context manipulation can hide needed/security-relevant evidence.

Codex must discover its actual installed skills and current repository needs before deciding whether any candidate is useful.

## 3. Harness acceptance

Before major implementation:
- fresh clone/setup works;
- one command or documented minimal sequence runs required local dependencies;
- baseline tests execute;
- synthetic fixture reset works;
- execution ledger exists;
- fresh verifier can inspect/run the repo;
- skill registry exists;
- architecture lints have at least the first load-bearing rules;
- no giant duplicated agent instruction document exists.
