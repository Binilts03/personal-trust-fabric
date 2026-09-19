# Authority Manifest v1

Authority Manifest is the repository identity for Personal Trust Fabric.

Its job is not to make GitHub resemble a marketing site. Its job is to make the
core mechanism legible in the medium developers already trust: text, code,
structured artifacts, and precise technical prose.

The governing line is:

> **Authority should travel. Secrets should not.**

## Design read

This is a repository for security engineers, agent-runtime builders, standards
people, and technically serious early adopters. The visual language therefore
comes from signed manifests, protocol transcripts, RFCs, capability grants, and
decision logs rather than generic cybersecurity branding.

The design should feel authored, not decorated.

## Signature element

The README's ASCII authority topology is the primary brand artifact.

It is functional. It must explain:

1. authority belongs to the person;
2. multiple interchangeable agents may request bounded use;
3. PTF is the decision and protected-use boundary;
4. Personal State remains behind that boundary;
5. outward results are disclosures, protected actions, signatures, or receipts;
6. secrets do not cross to the agent.

Do not replace the ASCII topology with a decorative hero illustration unless a
future brand review explicitly changes this system.

## Visual system

GitHub itself provides the primary surface. In-repository content should inherit
GitHub's typography, spacing, code rendering, and light/dark themes rather than
fight them.

Owned visual assets are intentionally minimal.

| Token | Value | Role |
| --- | --- | --- |
| GitHub dark | `#0D1117` | social preview background |
| GitHub light | `#FFFFFF` | light neutral reference |
| Dark foreground | `#F0F6FC` | social preview type |
| Muted dark | `#8B949E` | secondary social preview type |
| Signal orange | `#FF6A1A` | the single brand accent |

Signal orange marks the authority boundary or decisive transition. It is not a
gradient color and should not become general decoration.

## Typography

Inside GitHub, use native Markdown and code rendering.

- Normal prose uses GitHub's native text face.
- Monospace is reserved for code, protocol-like structures, ASCII topology,
  identifiers, and decision transcripts.
- No decorative monospace.
- No all-caps eyebrow labels above section headings.
- No gradient text.
- No typography introduced only to imitate a startup landing page.

The social preview may use a system sans-serif fallback stack because it is a
standalone static asset. Its composition, not a novelty font, carries the
identity.

## Layout

The brand region is left-aligned and reading-first.

Do not introduce:
- centered SaaS heroes;
- rows of equal feature cards;
- pill badges used as decoration;
- bento grids with no information hierarchy;
- glassmorphism;
- neon cybersecurity motifs;
- fake terminal windows;
- lock or shield clichés;
- Matrix imagery;
- visitor counters, streaks, GitHub stats, or animated typing banners.

The ASCII topology and decision transcript are the only intentionally technical
visual devices in the README landing layer.

## Stable versus evolving content

The README region between:

`<!-- PTF-BRAND:START -->`

and:

`<!-- PTF-BRAND:END -->`

is the stable brand layer.

It may describe enduring product principles, but it must not contain volatile
facts such as test counts, current adapter lists, protocol versions, package
release state, or roadmap milestone completion.

Everything below that region is evolving technical documentation.

## Copy rules

Preferred language:

- "Authority should travel. Secrets should not."
- "Use without possession."
- "External messages are evidence, never authority."
- "The agent proposes. PTF decides."
- "Protected state stays behind the boundary."

Avoid:
- presenting PTF as a payment platform, wallet, PSP, settlement service, or
  generic agent framework;
- vague claims such as "secure", "production-grade", or "enterprise-ready"
  without evidence;
- generic AI marketing language;
- technical claims inside visual decoration that can drift from implementation.

## Social preview

`assets/brand/social-preview.svg` is the only primary branded graphic committed
to the repository. It is a 1280×640 poster-like source built around
"AUTHORITY WITHOUT POSSESSION", a minimal PTF topology, and the signal-orange
boundary.

A raster export may be uploaded to GitHub repository settings for the social
preview. The source should change only through explicit brand review.

## Maintenance contract

Unrelated engineering work MUST NOT modify `assets/brand/` or the protected
README brand region.

If an implementation change genuinely invalidates a statement in the brand
region, flag it for explicit brand review instead of silently rewriting it.

Run:

```sh
npm run check:brand
```

after any README or brand-asset change.

## Versioning

This document defines **Authority Manifest v1**. A change to the governing line,
ASCII topology, one-accent rule, or social-card composition is a brand-version
change. Ordinary technical documentation maintenance is not.
