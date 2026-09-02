# Interface Contracts

These are behavioral seams, not frozen language/framework signatures. Codex must design each foundational interface at least twice before freezing it.

## 1. Agent Gateway

Agent-facing operations should cover:

### GetSafeView
Input:
- principal/task context;
- intended recipient/context if relevant.

Output:
- task-relevant model-shareable persona;
- available capability classes/status;
- approval requirements;
- safe restrictions.

Never returns protected values classified as non-model-visible.

### RequestOperation
Input:
- requested operation type;
- recipient;
- purpose;
- resource/action;
- transaction terms;
- requested data/proof scope.

Output:
- allowed without approval / approval required / denied;
- safe reason;
- operation/capability reference if permitted;
- assurance/downgrade state.

### GetOperationStatus
Returns safe status/outcome/receipt reference.

The Agent Gateway should not expose generic `read_secret`, `dump_wallet`, or unrestricted personal-state export tools.

## 2. Policy Authority

### Evaluate
Consumes:
- principal;
- agent/task;
- recipient/purpose;
- operation/resource/action;
- requested disclosure/action scope;
- transaction;
- assurance context.

Returns:
- allow/deny/approval-required;
- constraints;
- policy references;
- explanation safe for caller.

No side effect.

## 3. Disclosure Planner

### PlanDisclosure
Consumes:
- authorized request;
- available credential/proof/protected representations;
- recipient/channel capability;
- disclosure history/risk state if implemented.

Returns:
- selected representation;
- channel;
- claims/action scope;
- assurance/downgrade;
- obligations/evidence.

Cannot override a denial.

## 4. Capability Runtime

### Issue
Creates a capability only from valid authority.

### Derive
Creates equal-or-narrower capability.

### ExecuteOrRedeem
Requires the holder/recipient proof appropriate to the grant; validates all constraints atomically.

### Revoke
Invalidates target and defined descendants/uses.

## 5. Protected Store

Operations expose:
- safe metadata;
- controlled cryptographic/use operations;
- protected-value access only to trusted modules/channels under policy.

No general-purpose plaintext export for agent callers.

## 6. Persona Store

Operations:
- add observation/evidence;
- propose/update claim;
- confirm/contextualize/reject/correct;
- query task-relevant claims;
- export/import under user authority.

Hard Policy is not stored/updated through this interface.

## 7. Recipient / Verifier SDK

### Register/ResolveRecipient
Establish authenticated recipient/trust metadata.

### CreateRequest
Creates a typed credential/proof/action request with nonce/purpose/transaction.

### RedeemOrVerify
Presents recipient/holder authentication plus approved capability/presentation.

### ReportOutcome
Records non-secret result/correlation.

A recipient should be integrable without understanding PTF's internal database/policy implementation.

## 8. Audit

Append-only logical interface:
- record decision/action/disclosure lifecycle;
- query Human-readable history;
- produce safe forensic export;
- verify integrity/tamper evidence.

Reject raw protected values at the interface/schema layer.

## 9. Adapter contract

Every external adapter:
- translates external protocol identity/authorization objects into canonical PTF requests;
- calls core interfaces;
- maps safe results back;
- cannot bypass Policy Authority/Disclosure Planner;
- has version/maturity/conformance metadata;
- owns protocol-specific errors, not core policy semantics.
