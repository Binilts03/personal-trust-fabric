# User Stories and UX Contract

These stories define observable product behavior, not implementation technology.

## Human Principal

1. As a Human, I want to see what personal state PTF stores, so that I can understand what agents may be personalized with.
2. As a Human, I want to distinguish explicit facts, inferred claims, preferences, and hard policies, so that learning cannot masquerade as authority.
3. As a Human, I want to correct or reject a Persona Claim, so that future agents stop using wrong assumptions.
4. As a Human, I want to see why a preference was applied, including source/context/confidence, so that personalization remains inspectable.
5. As a Human, I want to connect a data source without automatically granting disclosure/action rights, so that collection, learning, and use stay separate.
6. As a Human, I want to see my protected resources/credentials without exposing secret values unnecessarily, so that PTF can broker them safely.
7. As a Human, I want to define or choose authority policies, so that agents know their boundaries before consequential actions.
8. As a Human, I want approval prompts to show recipient, purpose, action, requested data/authority, amount and other approval-relevant terms, so that consent is concrete.
9. As a Human, I want a changed transaction to require new approval when relevant terms change, so that old consent cannot be repurposed.
10. As a Human, I want to revoke an active capability/recipient/device/authority, so that I can stop future use.
11. As a Human, I want to see an activity/receipt history without raw secrets, so that I can audit what happened.
12. As a Human, I want to export my personal state/policies and move them to another PTF-compatible environment, so that the product is user-controlled.
13. As a Human, I want a documented recovery path after device loss, so that portability does not depend on one device.
14. As a Human, I want privacy/assurance downgrades called out before use, so that a legacy website cannot silently weaken my expectations.
15. As a Human, I want an emergency deny/revoke path, so that I can stop agent authority quickly.

## Agent

16. As an Agent, I want a task-specific safe view, so that I can personalize planning without receiving the person's full private state.
17. As an Agent, I want to discover available capability types/status, so that I can plan tasks without inspecting protected values.
18. As an Agent, I want structured denial/recovery errors, so that I can ask the Human for missing authority or choose a different path.
19. As an Agent, I want to request a bounded protected operation, so that PTF can authorize/execute it without revealing the underlying secret to me when non-possession is supported.
20. As an Agent, I want a safe receipt/outcome after execution, so that I can continue the task without receiving protected payloads.
21. As an Agent, I want to know when an external service forces a weaker assurance mode, so that I can surface the required Human decision.

## Recipient / Verifier / Merchant

22. As a Recipient, I want to declare the exact claim/proof/action I need and its purpose, so that PTF can evaluate minimal disclosure.
23. As a Recipient, I want to authenticate to PTF independently of an Agent-carried handle where required, so that stolen handles do not become bearer secrets.
24. As a Recipient, I want to redeem/verify approved authority through a stable SDK/interface, so that I do not need bespoke integration with each agent.
25. As a Recipient, I want deterministic errors for denied/expired/replayed requests, so that my application can recover safely.
26. As a Recipient, I want a non-secret receipt/correlation identifier, so that I can reconcile outcomes without logging the protected value.

## Developer

27. As a Developer, I want a local/synthetic PTF test environment, so that I can integrate without real personal credentials.
28. As a Developer, I want typed request/response contracts and versioning, so that adapters and recipients do not depend on trust-core internals.
29. As a Developer, I want conformance/eval fixtures, so that I can prove my adapter preserves PTF semantics.
30. As a Developer, I want a policy/capability debugger using synthetic data, so that I can understand denials without secret leakage.
31. As a Developer, I want clear assurance labels, so that my integration cannot imply protections it does not provide.

## Cross-device / recovery

32. As a Human, I want a newly enrolled device to receive only the state/keys it is authorized to hold, so that adding a device does not flatten the trust model.
33. As a Human, I want lost-device revocation to propagate according to documented bounds, so that stolen devices cannot retain indefinite authority.
34. As a Human, I want conflicting persona/policy updates to resolve predictably, so that sync cannot silently broaden authority.

## Self-improvement

35. As a Human, I want PTF to learn useful preferences from outcomes without changing hard authority, so that personalization improves safely.
36. As a Human, I want proposed learned preferences to be inspectable/reversible, so that automation does not ossify wrong assumptions.
37. As a Human, I want imported/web content treated as untrusted evidence, so that prompt injection cannot become durable personal policy.

## WebMCP release

38. As a Judge/User, I want PTF's WebMCP tools to drive real product actions, so that WebMCP is materially useful rather than decorative.
39. As a Judge/User, I want to see the same trust core mediate materially different capability classes, so that PTF is visibly a platform rather than one vertical demo.
40. As a Judge/User, I want an adversarial path that succeeds at malicious intent but fails at unauthorized authority, so that the security claim is demonstrated by enforcement.

## UX invariants

- Keep **Persona**, **Protected Resources/Credentials**, **Authority/Policies**, **Approvals**, **Capabilities**, **Activity**, **Devices/Recovery**, and **Developer/Test** conceptually distinct even if navigation evolves.
- Do not show a “privacy score” or other invented aggregate without a validated model.
- Approval copy names concrete recipient/purpose/action/terms; avoid generic “Allow agent?” prompts for consequential actions.
- Destructive/revocation actions show scope and consequence.
- Security evidence is accessible but does not overwhelm the primary product journey.
