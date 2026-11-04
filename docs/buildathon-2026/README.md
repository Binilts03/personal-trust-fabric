# Google Startup Buildathon India 2026 — PTF application slice

**Status:** candidate demonstration, **not** a production launch, A2A/AP2 conformance certification or live Google Cloud deployment.

**Repository lineage:** this branch depends on the unmerged domain-neutral consolidation (PR #121). The Buildathon branch is reviewed in PR #124. Nothing here changes the product definition: PTF is a principal-controlled authority and protected-use layer, independent of an agent's model and of transaction protocols.

## One-sentence product

Personal Trust Fabric lets a trusted host execute exactly authorized agent-requested actions without placing the user's underlying secrets or unrestricted power inside the agent.

## Why PTF complements A2A and AP2

- **A2A** defines how agents discover and communicate. It does not replace a principal's local trust/custody decision.
- **AP2** defines commerce/payment mandates and verifiable transaction claims. Its mandates are important **inputs/evidence** to PTF; PTF cannot manufacture valid mandates, override a payment provider, or independently prove AP2 conformity.
- **PTF** binds a verified ingress actor, exact operation, recipient and principal's grant. The host manages secrets, disclosures, approval and journaled protected effects.
- **Gemini** interprets a user's instruction and proposes a typed operation. It is never an issuer of authority. The demonstration deliberately does not transmit a credential, personal profile or private key to Gemini.

Existing PTF A2A/AP2 adapters enforce specific subsets; this Buildathon example does **not** establish actual A2A agent communication, AP2 VDC exchange, UCP checkout or settlement. These are separately gated integration milestones.

## Runnable demo

Use **Node >=22**, a built checkout of **this branch** and no real personal information:

```sh
npm ci
npm run build
node examples/buildathon/demo.mjs --offline
node examples/buildathon/demo.mjs --denied-recipient
node examples/buildathon/demo.mjs --denied-actor
node examples/buildathon/demo.mjs --replay
node --test examples/buildathon/gemini.test.mjs examples/buildathon/server.test.mjs
```

These calls use PTF's actual Authority evaluator, signed recipient challenge, protected-effect boundary, durable execution journal and a **fake provider**. The fake provider sends **no email**. The local demo marker is not a hardened durable host store; the existing Host Kit conformance suite covers the real storage contract separately.

For real Gemini function calling, supply a Google AI Studio API key **in the operator's environment only**:

```sh
# Never put the key in source, a CLI argument, a screenshot or a recording.
GEMINI_API_KEY="<operator-supplied-key>" node examples/buildathon/demo.mjs --gemini
```

A model-proposed recipient or message other than the authorized synthetic handles is **denied**, not silently corrected. This lets the judge see the difference between planning and authority. A transient Gemini failure cannot become an execution approval.

## Google Cloud Run presentation

The optional HTTP presentation endpoint accepts exactly **POST /demo without a body** and calls the real Gemini proposal endpoint; **GET /healthz** returns only synthetic service status. It has no user accounts, persistent multi-tenant store, live provider, arbitrary prompts or personal data. It must be deployed behind **Cloud Run IAM** (no unauthenticated invocations) and uses one request at a time per instance.

An operator with permission to spend cloud resources must explicitly run:

```sh
# Replace these placeholders; create Artifact Registry repository beforehand.
PROJECT_ID="<your-project>"
REGION="asia-south1"
IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/ptf-buildathon/synthetic-demo:2026-11"
gcloud config set project "$PROJECT_ID"
gcloud builds submit . --config examples/buildathon/cloudbuild.yaml --substitutions="_IMAGE=$IMAGE"
# Create Secret Manager secret ptf-buildathon-gemini out-of-band.
# Grant the Cloud Run runtime service account Secret Manager access explicitly.
gcloud run deploy ptf-buildathon-demo --image="$IMAGE" --region="$REGION" \
  --no-allow-unauthenticated --concurrency=1 --max-instances=1 \
  --set-secrets="GEMINI_API_KEY=ptf-buildathon-gemini:latest"
```

Cloud Run/Cloud Build/Artifact Registry/Secret Manager may incur charges. Set a budget/alert and delete the resources when finished. This is an **operator procedure, not a claim that deployment happened**. A publicly exposed URL, unauthenticated Cloud Run invocation or unreviewed real-provider credentials are out of scope.

## What to show judges (3 minutes)

1. Ask Gemini to propose the already-authorized synthetic provider action. Show the typed function call (redacted of API key).
2. Show PTF approving the exact actor, recipient and resource; host verifies a signed recipient challenge and invokes the **fake provider once**.
3. Change the recipient; show denial before any provider call and no authority spent.
4. Change the actor; show denial.
5. Repeat the exact completed operation; show the same receipt and no second provider submission.
6. Show the existing vault-protected-action reference separately to illustrate host-only synthetic credential use. **Do not claim both examples are one integrated production flow.**

## Gaps that must not be disguised

- Live Gemini result with an operator key: **not recorded here**.
- Authenticated Cloud Run build and invocation: **not recorded here**.
- A2A/AP2 live protocol interoperability and external provider rails: **not recorded here**.
- Independent users, purchasing intent, product-market fit, security audit, legal compliance, distributed exactly-once effects: **not proven**.
- Prior code reuse and buildathon entry eligibility: organiser confirmation required.

See [Application draft](application.md) and [readiness gates](verification.md). The authoritative security register remains [known limits](../audit/limits.md).
