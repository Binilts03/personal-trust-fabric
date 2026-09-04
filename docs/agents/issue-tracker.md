# Engineering Issue Tracker

Status: **Active planning convention for PTF v1.**

## Tracker

Use GitHub Issues in `Binilts03/personal-trust-fabric` for bounded execution work, defects, review findings, and explicit follow-up decisions.

The approved implementation plans under `docs/superpowers/plans/` remain the sequencing and task contract. Issues do not replace or restate the specification or plans; they reference the exact plan/task and relevant approved-spec sections.

## Issue creation rule

Create an issue when a unit of work is ready to execute or when review uncovers a concrete defect/change that cannot be fixed inside the currently accepted task without changing its reviewed scope.

Each implementation issue body must contain:

- `Plan:` exact repository path to the implementation plan;
- `Task:` exact task number/title from that plan;
- `Spec:` relevant section numbers from `docs/spec/PTF-V1-PROPOSED.md`;
- `Dependencies:` issue numbers or accepted-plan task dependencies;
- `Acceptance:` the test/verification commands copied from the plan;
- `Security impact:` `none`, `security-relevant`, or `spec/ADR review required`;
- `Status evidence:` links to the implementing commit/PR and independent review when complete.

Do not convert conversational requests directly into implementation issues when the approved plan does not already contain the work. First amend/review the plan or, where semantics change, the specification/ADR.

## Workflow

1. `planned` — represented in an approved implementation plan but not yet started;
2. `in execution` — isolated branch/worktree is implementing the exact issue/plan task;
3. `in review` — implementation tests pass and independent review is active;
4. `accepted` — review findings are resolved and evidence is linked;
5. `blocked` — an explicit dependency, security gate, protocol uncertainty, or spec/ADR decision prevents progress.

These are workflow states, not required GitHub labels. Do not invent repository labels merely to mirror them.

## Branch/PR convention

- Never execute directly on `main`.
- Before any rewrite of `main`, the mandatory immutable `webmcp-sandbox-v0.1` tag must resolve to `2ed4020c2f0ef91da1a5ee0e74e083539fed98b9`.
- Use the isolated rewrite branch/worktree required by the roadmap and Superpowers `using-git-worktrees`.
- One PR may contain multiple tightly dependent tasks only when the implementation plan explicitly sequences them as one reviewable increment; otherwise prefer one bounded PR per accepted task.
- PR descriptions must identify the plan/task, spec sections, verification commands, and any residual risks/downgrades.

## Triage labels

No repo-local triage skill/configuration exists at planning time, so no canonical triage-label vocabulary is imposed. Add a durable `docs/agents/triage-labels.md` only if a future approved workflow introduces repo-local triage behavior and first maps any existing repository labels rather than overwriting them.
