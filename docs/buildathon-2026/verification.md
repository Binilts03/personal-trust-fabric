# Buildathon evidence and readiness gates

## Frozen scope

An AI-powered **synthetic action-delegation demonstration**, not a new PTF product or live commerce stack. Do not move authority into Gemini, redefine the trust boundary, add unconstrained agent tools, use actual financial/personal data, or force-merge PR #121 to satisfy a date.

## Executable gates

| Gate | Verification command or evidence | Status |
| --- | --- | --- |
| Baseline repository | Exact PR #121 branch and SHA; existing CI | Reference already exists; refresh on final head |
| Standalone Google proposal parser | `node --test examples/buildathon/gemini.test.mjs` | Requires final-head execution |
| End-to-end synthetic delegation | `node examples/buildathon/demo.mjs --offline` | Requires final-head execution |
| Negative recipient/actor cases | `--denied-recipient`, `--denied-actor` | Requires final-head execution |
| Replay/no duplicate provider | `--replay`; one provider call, same receipt | Requires final-head execution |
| Cloud endpoint safety | `node --test examples/buildathon/server.test.mjs` | Requires final-head execution |
| Full gate | `npm run check:brand && npm run typecheck && npm test && npm run eval` | Requires final-head execution |
| Model live proof | API key supplied by operator; inspect Gemini function call and PTF result | NOT YET VERIFIED |
| Cloud Run proof | Exact deployed image digest, IAM-bound invocation, Cloud Logging and budget receipt | NOT YET VERIFIED |
| A2A / AP2 protocol integration | Run official SDK interoperability and negative protocol vectors | NOT YET VERIFIED |
| Security review | Independent review of trust boundary, external ingress, keys and journal semantics | NOT YET VERIFIED |
| Customer discovery | At least two real relevant integrator interviews and buyer objections | NOT YET VERIFIED |

## Adversarial checklist

- A model's extra fields must be rejected before authority or provider access.
- Different recipient, actor, message ID, action or altered proof must not execute.
- A CHECK result is not a REDEEM result.
- One valid signed recipient proof and durable use precede the effect.
- A completed exact effect is not submitted twice.
- Unknown provider outcome must not be presented as a success or blindly retried.
- No Gemini prompt or log contains secrets, raw personal state or credentials.
- Cloud Run accepts no user-provided request body and does not expose an unauthenticated effect endpoint.
- Live AP2 mandates are verified externally before being accepted as evidence; a model's paraphrase does not establish validity.
- Reuse of synthetic demos must not be marketed as production interoperability.

## Buildathon calendar

Official organiser timeline at [Hack2skill](https://hack2skill.com/event/startupbuildathon2026): application closes **13 November 2026**; selected teams notified by **18 November**; city buildathons **20–21 November**; regional stages **23, 25, 27 November**; finale **2 December**. Recheck the organiser website for changes and confirm rules about prior code.

**Stop conditions:** Never use a real user credential or private financial record; no public Cloud Run endpoint; no payment/email delivery claims; no merge-to-main or 'production-ready' label without independently reviewed gates. If a live proof is not available, show the offline demonstration and name the gap.
