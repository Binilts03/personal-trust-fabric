# Skill Routing Protocol

The installed Codex runtime reportedly contains a large skill inventory. This handoff does not know its complete or current contents. The runtime inventory is the source of truth.

## 1. Routing gate

Before every substantive work item:

1. **Discover/update inventory** — enumerate skills/plugins available in the current runtime.
2. **Classify task** — e.g. research, product design, architecture, security, Rust, web, WebMCP, cryptography, OAuth, testing, fuzzing, UI, debugging, review, release.
3. **Search triggers/descriptions** — retrieve plausible skills by semantics and explicit trigger text.
4. **Read current skill instructions** — do not rely on remembered behavior.
5. **Resolve process-first ordering** — process/workflow skills precede implementation skills where applicable.
6. **Select minimal sufficient composition** — broad search, narrow activation.
7. **Record routing** — candidates, selected skills, rejected material candidates, reason.
8. **Execute the skill workflows**.
9. **Re-route on category change** — implementation becoming debugging/security review is a new routing event.
10. **Record outcome** — useful, conflicting, stale, failed, or candidate for improvement.

## 2. Subagent routing

Every substantive subagent repeats routing in its own runtime. The controller may impose mandatory project constraints but must not assume the child has the same skill inventory.

## 3. Precedence

1. Human project requirements and safety constraints.
2. Repository-local authoritative specification/ADR applicable to the work.
3. Relevant installed skill workflow.
4. Default agent behavior.

If skills conflict, resolve by explicit trigger relevance, project requirements, and narrowest authority. Record the ruling.

## 4. No ceremonial skill use

A skill is “used” only if its current instructions materially govern the work. Loading a skill and ignoring its procedure does not count.

## 5. No skill flooding

Do not invoke dozens of vaguely related skills. Select the smallest set that covers the task after full discovery.

## 6. Repository-local skill registry

The harness should generate/maintain a machine-readable or concise registry containing:
- skill identifier;
- source/version/path;
- trigger/description;
- task categories;
- compatibility/requirements;
- last inspected;
- outcome notes.

Do not copy full third-party skill bodies into the registry.

## 7. Skill evolution

Repository-local wrapper/skill improvements may be proposed from execution evidence.

Rules:
- never silently modify third-party installed skills;
- stage changes;
- evaluate on representative/held-out tasks where possible;
- reject regressions;
- preserve security/product invariants;
- require human/security review for changes that affect permissions, trusted inputs, verification, or hard policy.

SkillOpt-style validation-gated evolution is relevant research, not mandatory tooling.
