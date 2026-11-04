# Google Buildathon — constrained PTF demonstration design

**Intent:** Present PTF as an authority and protected-use layer *complementing* A2A/AP2, with Gemini limited to proposing a typed action. Provide an honest application pack and optional IAM-protected Cloud Run presentation, without redefining the core.

**Scope:** Build on existing draft consolidation PR #121, isolated in a dependent draft PR; no writes to main. Implement only a synthetic email action using a real PTF Authority grant, recipient-signed challenge, protected-effect boundary and fake provider. Test valid execution, changed actor, changed recipient and replay. Add fail-closed Gemini parsing and a synthetic-only Cloud endpoint.

**Non-goals:** payment settlement, email delivery, real personal data, AP2/A2A wire end-to-end conformity, public SaaS service, production custody, broad code refactor, unreviewed deployment.

**Approaches evaluated:** (1) replace PTF with AP2/A2A (rejected—protocols serve different roles); (2) modify the PTF core for Google-specific behavior (rejected—breaks model independence); (3) compose a narrow external demonstration on published PTF seams (selected—smallest testable, faithful change).

**Security:** The host—not Gemini—holds keys, exact grants, recipient proof and provider. Unknown/extra function-call fields fail before PTF. Synthetic-only mode is explicit; no implicit real-world execution. No unauthenticated Cloud Run action endpoint.

**Outcome:** A candidate submission with evidence-linked implementation and explicit live-qualification holds, not a claim that external integration succeeded.
