# Persona and Learning

## 1. Goal

PTF should personalize agents without turning the model into the canonical owner of a person's private history.

## 2. Canonical state classes

### Observation
Event/input with source, timestamp, integrity/trust label, and sensitivity.

### Persona Claim
Candidate fact/preference with:
- source evidence;
- explicit/inferred flag;
- confidence;
- context/domain;
- sensitivity;
- validity/decay;
- contradictions;
- verification/promotion state.

### Confirmed Preference
A preference promoted under a human-approved rule.

### Hard Policy
Not persona. Never update it through ordinary preference learning.

## 3. Precedence

Use a testable precedence model. Initial product requirement:

1. explicit current Human instruction;
2. explicit stored Human policy/preference;
3. repeated confirmed decisions/corrections;
4. inferred behavior with confidence/context;
5. third-party assertion;
6. arbitrary web/tool content.

This is a design starting point, not a substitute for conflict-resolution tests.

## 4. Connect, Learn, Disclose/Act are separate permissions

Connecting a source does not automatically authorize:
- learning from everything in it;
- disclosing its data;
- acting on it.

The UI and domain model must preserve these distinctions.

## 5. Safe projection

For a task, construct an Agent Safe View containing only information needed for planning. Examples of content classes:
- preference ranking;
- budget/risk constraint;
- available capability types;
- approval requirements;
- non-sensitive status.

Do not place raw secrets or irrelevant private history into the safe view merely because they exist in personal state.

## 6. Learning loop

Observation → integrity/sensitivity classification → evidence → claim/hypothesis → contradiction/context check → shadow prediction/evaluation → Human confirmation or rule-based promotion → active preference → decay/revalidation/correction.

Authority does not appear in this loop.

## 7. Poisoning controls

At minimum:
- external content cannot write trusted memory directly;
- model-generated summaries are observations, not authoritative facts;
- provenance survives compaction;
- promotion requires trust transition;
- sensitive/high-impact inferred traits require stricter rules;
- policy files and persona state use separate authority/update paths;
- rollback/correction is first-class.

## 8. Self-improvement levels

### May evolve under validation
- retrieval/ranking;
- confidence estimates;
- context classification;
- task strategies;
- parsing/connectors;
- preference proposals;
- explanation quality;
- privacy-preserving abstraction candidates.

### Human/policy controlled
- spend limits;
- signing rights;
- disclosure authority;
- delegation depth;
- trusted recipients;
- downgrade permission;
- recovery authority.

## 9. Evaluation

Track separately from generic task success:
- preference prediction accuracy;
- confidence calibration;
- contradiction handling;
- stale/over-personalization rate;
- correction burden;
- disclosure volume;
- sensitive-inference false positives;
- poisoning resistance;
- cross-agent consistency;
- reversibility.

LLM-as-judge may supplement but cannot be the only evidence.
