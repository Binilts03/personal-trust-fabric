# Reference Scenarios

Scenarios are acceptance fixtures for PTF. They are not product domains.

## 1. Scenario portfolio requirement

The challenge milestone must exercise enough materially different capability classes to prove the same Trust Runtime is general; one scenario is insufficient. The final set is selected during validation and reviewed by a fresh product-scope reviewer.

The complete product test suite should eventually cover all of these classes:

### S1 — Private personalization
Agent receives a task-specific preference projection rather than full personal history.

Proves:
- Personal State;
- provenance/context;
- Agent Safe View;
- disclosure minimization.

### S2 — Credential/identity use
A verifier needs an identity/status claim. PTF chooses proof/selective/direct disclosure according to available protocol and policy.

Proves:
- Credential Broker;
- Disclosure Planner;
- recipient/purpose binding;
- minimal claim release.

### S3 — Payment authority
A merchant requests payment under explicit amount/currency/transaction terms. Agent may carry authorization state without receiving reusable payment credentials.

Proves:
- Payment Authority;
- transaction binding;
- approval;
- replay/amount escalation resistance.

### S4 — Signing/authentication authority
A service needs an authenticated or signed operation. PTF uses the key without exporting it to the model.

Proves:
- Signing Authority;
- user presence/approval where required;
- non-exported private key semantics.

### S5 — Bounded account/action authority
Agent requests a consequential service action with resource/action/recipient/purpose limits.

Proves:
- generic capability/action model;
- recipient authentication;
- policy and revocation.

## 2. Composite hero scenario

Codex may create a coherent hero workflow that composes multiple classes—for example, a transaction that uses persona + credential + payment—but the composite workflow remains an application of generic seams.

Travel is one candidate because it can compose preferences, identity and payment. It is not mandatory and must not be the only evidence of PTF generality.

## 3. Scenario acceptance

For every scenario:
- map each step to generic PTF interfaces;
- prove no scenario-only condition exists in trust-core policy code;
- include authorized and adversarial paths;
- collect observable data-flow evidence;
- reset deterministically with synthetic fixtures;
- state the assurance level and any downgrade.

## 4. Architecture lint

The trust-core packages/modules must not contain domain vocabulary belonging only to a scenario such as airline, flight, hotel, shopping cart, product catalog, merchant SKU, or document-specific workflow terms unless the module is explicitly an adapter/application package.

Codex should implement this as a mechanical lint or equivalent check appropriate to the chosen repository structure.
