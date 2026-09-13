# Issue tracker: Local Markdown

Issues and specs (you may know a spec as a PRD) for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md` — exemption: wayfinder maps carry `map.md` instead of `spec.md` (`.scratch/ptf-wayfinder/` has no `spec.md`)
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- `Type:` is required-everywhere on implementation tickets (required-everywhere since `.scratch/ptf-standards-pivot/issues/01..06` now carry it; values `research`/`prototype`/`grilling`/`task`)
- Triage state is recorded as a `Status:` line near the top of each issue file: implementation tickets use `Status: open/claimed/resolved` (see `triage-labels.md` for the role strings)
- Blocking dialect is numeric-first: a `Blocked by: NN, NN` line near the top, with rationale after an em-dash (e.g. `Blocked by: 01, 02 — cleanup lands after translators exist`)
- Resolve record is `## Answer`: append the answer under an `## Answer` heading, set `Status: resolved`. `## Comments` has zero uses repo-wide — do not use it

## Spec markers (spec-only, distinct from issue Status)

Specs (not implementation tickets) use their own marker set on the `Status:` line: `draft` / `ready-for-agent` / `superseded` (e.g. `.scratch/ptf-v01/spec.md` is `ready-for-agent`, `.scratch/ptf-standards-pivot/spec.md` is `superseded`). Never mix these with issue `Status: open/claimed/resolved`.

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`, required-everywhere); a `Status:` line records `open`/`claimed`/`resolved`.
- **Blocking**: a numeric-first `Blocked by: NN, NN` line near the top, rationale after an em-dash. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
