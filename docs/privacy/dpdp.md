# DPDP privacy enforcement profile (experimental)

PTF can help an AI host enforce **configured technical privacy controls** at runtime. It does not determine whether a controller/Data Fiduciary has a lawful processing basis or make any organisation compliant with the Digital Personal Data Protection Act, 2023.

This profile is a **privacy-control and evidence implementation**, not an Indian statutory **Consent Manager**. It has no Data Protection Board registration, notice/consent validation service, processor-contract workflow, breach reporting service, or full data-subject-rights automation.

## Responsibility boundary

- **PTF Authority** determines whether a verified AI actor has delegated authority for an exact operation.
- **Processing Basis Evidence** contains an operator/delegated-privacy-function assertion about the processing basis; it **never** adds an Authority grant.
- **PrivacyRuntime** can narrow or deny an already-authorised operation based on configured controller, opaque privacy subject reference, purpose, categories, recipient role, active basis and DPDP profile rules.
- **The Data Fiduciary/controller** remains accountable for the legal correctness of its basis, notices, rights processing, retention periods, processor contracts, transfer rules and required notifications.
- **The trusted host** maps real individuals to random opaque `subject:` references and supplies operator-controlled configuration. A reference prefix is only syntactic validation, **not proof of pseudonymisation**.
- The provider/host also remains responsible for applying privacy to **every actual personal-data processing route**. Calling the general PTF APIs without the privacy wrapper is not a privacy-enforced path.

No code returns `compliant=true`; an `allow` means only that the **configured checks** passed.

## Runtime composition

The basic sequence is:

1. Authenticate the actor (never trust a principal/actor in the agent's tool request).
2. Run a **non-consuming PTF Authority preflight**. If it denies, do not inspect privacy state; do not leak privacy-basis existence.
3. Resolve the privacy Data Principal, controller, subject assurance and recipient role from the **host**, not from the agent.
4. Load a fresh encrypted privacy snapshot; check exact purpose/action/resource type, category/recipient subsets and the configured processing basis.
5. Recheck live privacy state at the effect/disclosure boundary.
6. Precommit a secret-free Processing Event; then invoke PTF's existing protected-use or disclosure boundary and persist authority consumption before delivery.
7. Finalise the Processing Event on observed success, or retain `OUTCOME_UNKNOWN` when an effect might have occurred.
8. Never put a personal value, credential or direct subject identifier in an audit record or Processing Event.

A storage snapshot is not a lifetime guarantee. Other processors, vendor systems, backups and external APIs require their own retention/erasure workflows.

## Operator setup

The operator command is `ptf privacy`. Run `ptf privacy init` in an existing PTF store first; it creates encrypted privacy state under a separate privacy DEK. Use `notice add`, `consent add`, `basis add`, `activity add` with operator-reviewed JSON evidence/configuration files. See `ptf privacy --help` for current CLI flags. A PTF Standing Grant must **also** independently cover the agent's exact operation.

An enabled *stdio reference host* can use a separate locally protected JSON file:

```json
{
  "dataPrincipalRef": "subject:opaque-4a32",
  "controllerId": "example-india",
  "recipientRoles": {
    "approved-processor": "data-processor"
  },
  "subjectAssurance": {
    "classification": "adult",
    "proofRef": "trusted-identity-record:12",
    "assertedBy": "privacy-office"
  }
}
```

Set `PTF_MCP_PRIVACY_CONFIG=/absolute/path/to/privacy-config.json` in the host process environment. **Do not give the agent write access to the file or environment.** The configuration contains **no legal basis identifier** and no directly identifying Data Principal value. Legal basis/activity records are independently established by the operator in encrypted privacy state.

In the reference MCP server, the opt-in mode currently gates **`ptf_request_data` and `ptf_present_data`**. It uses the existing, unchanged agent tool schemas. If privacy mode is explicitly configured but missing/invalid, the server or disclosure fails closed. Absence of this setting retains the existing PTF behavior.

**Limits of this MCP slice:** `ptf_propose`/`ptf_redeem` and general `ptf_request_action` are not automatically governed by this data-disclosure gate. Hosts using those routes to process personal data must enforce the privacy runtime explicitly. This reference is not a universal protection for arbitrary tool/provider calls.

## Data and privacy records

A Processing Activity declares its PTF Authority principal, Data Fiduciary, subject scope, exact action, resource type, purpose, permitted categories/recipients and basis reference.

The initial `IN-DPDP-2025` profile supports **consent evidence** and operator-asserted **certain legitimate use** evidence. It does not infer legal sufficiency from an AI explanation. Consent withdrawal prevents *future* consent-based processing under that evidence without automatically revoking an unrelated Standing Grant.

`privacy-events/` stores one encrypted per-attempt record, separate from `privacy-state.json`. A precommitted attempt that cannot prove success or non-effect is tracked as `OUTCOME_UNKNOWN`; it is **not** erased or reported as a completed success. This is not a full external system activity log.

Erasure uses exact PTF Vault record IDs and is subject to configured retention holds. The implementation cannot automatically erase copies in external systems, historical backups, processor systems or independent audit stores.

## DPDP sources and dates

Consult primary law directly:

- [Digital Personal Data Protection Act, 2023 (India Code)](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf).
- [Digital Personal Data Protection Rules, 2025 — Gazette G.S.R. 846(E), dated 13 November 2025](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf).
- [MeitY DPDP Rules index (also contains December 2025 corrigendum)](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa).
- [DPDP Act commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf).

Commencement is phased. The rules specify that Rule 4 takes effect one year after the relevant Gazette publication and most other substantive rules at eighteen months. Always verify current applicable notifications before making an organisation-specific compliance determination. PTF does not calculate legal deadlines.

## Not implemented: operator must supply complementary controls

PTF does not replace complete notices/consent UX, lawful-basis review, grievance rights, enterprise-wide DSAR search, cross-system corrections/deletions, backup disposal, data-breach detection/notification, Significant Data Fiduciary assessment/audit, children's consent-verification service, DPO oversight, regulator communication, cross-border transfer legal review or processor contracts.

**Security warning:** a malicious or compromised trusted host can bypass or misconfigure PTF. Runtime configuration is a control **only for traffic actually routed through it**. Store encryption is not protection from a host that legitimately holds the decryption keys.
