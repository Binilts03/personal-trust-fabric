# WebMCP Challenge Release Milestone

Research snapshot: **2026-09-02**. Official rules remain the source of truth and must be rechecked immediately before submission.

## 1. Purpose

Use the challenge to release and test **PTF itself**, not to build a separate hackathon application.

The milestone must expose real reusable PTF product surfaces through WebMCP and prove cross-domain generality.

## 2. Verified current challenge constraints

Official Devpost rules currently state:

- Submission period ends **September 3, 2026 at 1:00 PM Pacific Time**.
- Build a WebMCP-powered web app exploring the future open web for humans and agents.
- Judges must be able to access a working live project.
- Submission requires a working live URL.
- Submission requires a text description covering WebMCP fit, UX improvement, what becomes possible, and implementation.
- Submission requires a public code repository containing source/instructions and an open-source license.
- Submission requires a public YouTube demo video under three minutes with audio showing the project and WebMCP use.
- Existing projects are eligible only if meaningfully extended with WebMCP during the submission period; pre-existing work must be distinguished.
- Stage-two judging criteria are equally weighted:
  1. WebMCP Leverage;
  2. Execution;
  3. Potential Impact;
  4. Creativity & Ambition.
- The official rules freeze the Devpost Submission after the submission period and require the working Project to remain accessible through judging. They do not explicitly freeze every repository commit or deployment; preserve immutable submitted identifiers and recheck/ask Devpost before deciding how continuing development is separated.

Sources are listed in `RESEARCH_EVIDENCE.md`.

## 3. Challenge product requirements

### C-01 — PTF-first experience
A judge should understand that the product is a personal trust/capability layer from the main product UI, without first reading an architecture essay.

### C-02 — Material WebMCP
Use multiple meaningful WebMCP tools in real user journeys. WebMCP cannot be a decorative status endpoint.

### C-03 — Generality
Demonstrate multiple materially different PTF capability classes through the same trust core. A fresh product-scope review must confirm that the selected set proves generality; one scenario is insufficient.

### C-04 — Multi-recipient or multi-origin evidence
Demonstrate that recipient/purpose binding is not hard-coded to one service. Use multiple recipient origins or equivalent independently authenticated recipient fixtures so recipient binding is demonstrably generic.

### C-05 — Human-agent collaboration
The Human sees/controls consequential authority; the agent plans and calls tools; PTF mediates protected operations.

### C-06 — Security evidence
Demonstrate at least one hostile/prompt-injection/redirect/replay case where deterministic PTF enforcement, not model refusal, blocks unauthorized use.

### C-07 — Coherent product UI
Required surfaces for the challenge:
- PTF home/status;
- persona/safe-context view;
- credentials/protected resources;
- policies/authority;
- approval;
- capabilities/revocation;
- activity/security evidence;
- developer/test instructions.

### C-08 — Judgeability
A judge can reproduce the core path without installing obscure hardware or providing real sensitive credentials. Use synthetic protected data for the public challenge release.

## 4. Challenge implementation profile

The challenge may use a **hosted synthetic sandbox profile** if necessary for judgeability. This profile must be explicitly labeled and must use the same domain/interfaces as the complete product.

It is not evidence that hosted custody is the final product architecture.

## 5. Scenario selection rule

Travel is allowed but not privileged.

Select scenarios by:
- product coverage;
- WebMCP leverage;
- judge comprehension;
- security falsifiability;
- implementation reuse.

No scenario-specific entity may be added to core trust modules merely to make the demo easier.

## 6. Submission is not a terminal state

After the competition release:
- preserve/freeze submitted artifacts as the current official rules require;
- continue the complete PTF program through a separate permitted development line/repository only after rechecking the competition rule;
- never redefine the submitted milestone as “the complete product.”
