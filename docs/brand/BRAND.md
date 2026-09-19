# Authority Fabric — Brand System v1

Authority Fabric is the visual identity of Personal Trust Fabric (PTF).

Its job is to make one product idea legible before a visitor reads the implementation:

> **Authority belongs to the person. Not the agent.**

The brand is intentionally independent of today's protocol adapters, CLI shape,
test counts, providers, and roadmap milestones. Those details evolve. The
authority boundary should not.

## Visual language

The mark is four independent routes converging through one bounded aperture.
It represents interchangeable agents and systems borrowing authority through a
single user-owned control point.

### Palette

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| Background | `#0B0F14` | `#F7F9FB` | neutral trust surface |
| Surface | `#111821` | `#FFFFFF` | bounded components |
| Primary text | `#F4F7FA` | `#10151C` | high-confidence text |
| Secondary text | `#95A1AF` | `#5E6A78` | explanatory text |
| Authority cyan | `#49D7FF` | `#007E9E` | routing / verification |
| Allow mint | `#62E6A7` | `#168B61` | permitted bounded action |
| Warning amber | `#F2B84B` | `#A56800` | ceilings / constraints |

Red is intentionally not a primary brand color. Deny states may use it
sparingly in future diagrams, but the identity is about bounded authority, not
alarm aesthetics.

## Repository assets

All primary visual assets are committed locally under `assets/brand/`.
Do not replace them with dynamic third-party renderers.

- `ptf-mark-dark.svg` / `ptf-mark-light.svg` — compact mark.
- `hero-dark.svg` / `hero-light.svg` — repository landing hero.
- `architecture-dark.svg` / `architecture-light.svg` — stable conceptual model.
- `authority-trace-dark.svg` / `authority-trace-light.svg` — example decision trace.
- `social-preview.svg` — 1280×640 social-card source.

GitHub README images use `<picture>` so light/dark mode is selected by the
viewer without JavaScript.

## Stable versus evolving content

The README region between:

`<!-- PTF-BRAND:START -->`

and:

`<!-- PTF-BRAND:END -->`

is the stable brand layer. It may state enduring product principles, but it
must not contain volatile facts such as test counts, current protocol versions,
number of tools, supported provider counts, or current milestone status.

Everything below that region is normal evolving technical documentation.

### Agent rule

Unrelated engineering work MUST NOT modify `assets/brand/` or the protected
README brand region. If a technical change genuinely invalidates a statement
inside the brand region, flag it for explicit brand review instead of silently
rewriting it.

Run:

```sh
npm run check:brand
```

after any README or brand-asset change.

## Copy rules

Preferred:
- "Authority belongs to the person. Not the agent."
- "User-owned authority and protected use for interchangeable AI agents."
- "Agents propose. The deterministic core decides."
- "Use without possession."
- "External messages are evidence, never authority."

Avoid:
- presenting PTF as a payment platform, wallet, PSP, settlement service, or
  generic AI-agent framework;
- generic hacker/cybersecurity language;
- claims that depend on the current implementation;
- unsupported production-readiness claims;
- purple AI gradients, lock/shield clichés, Matrix imagery, or decorative
  GitHub-stat widgets.

## Social preview

`social-preview.svg` is the editable source and is intentionally static. GitHub
repository settings currently expect a raster social-preview upload, so export
this source to a 1280×640 PNG when configuring the repository social preview.
The source should change only when the core positioning changes.

## Versioning

This document defines **Authority Fabric v1**. Changes to colors, mark geometry,
hero thesis, or the core visual metaphor are brand-version changes. Ordinary
README and product-documentation maintenance is not.
