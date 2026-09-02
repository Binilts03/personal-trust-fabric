# Devpost Submission Plan

This document governs the WebMCP release milestone only.

## 1. Judging strategy

### WebMCP Leverage
Evidence:
- multiple meaningful WebMCP tools across real PTF-enabled journeys;
- structured schemas/state transitions;
- visible site state changes;
- agent recovery from invalid state;
- WebMCP evals;
- no decorative one-tool integration.

### Execution
Evidence:
- live, coherent PTF product UI;
- deterministic seeded demo;
- approvals/revocations/activity;
- multiple capability classes;
- stable judge instructions;
- automated test/evidence report.

### Potential Impact
Demonstrate the actual problem:
agents increasingly need authority/personalization, but passing every protected value into model context expands exposure. PTF separates authority from knowledge.

Avoid unsupported market-size claims.

### Creativity & Ambition
Show the general primitive:
an agent can be **more capable while possessing less sensitive information**.

Differentiate from:
- password manager;
- memory store;
- generic wallet;
- WebMCP wrapper;
- one-site authorization prompt.

## 2. Submission experience

A judge should be able to:
1. open PTF and understand the product in under a minute;
2. inspect synthetic persona, credentials/resources and policies;
3. run agent-assisted WebMCP journeys spanning the validated set of materially different capability classes needed to make PTF generality observable;
4. approve a bounded consequential action;
5. inspect receipt/activity;
6. trigger a deterministic hostile scenario;
7. observe unauthorized action/disclosure blocked by PTF;
8. view concise security/evidence limitations.

## 3. Public repository

Before submission verify:
- license visible;
- complete source;
- setup/run/test instructions;
- WebMCP implementation location documented;
- architecture/trust-boundary diagram;
- threat model/limitations;
- synthetic data only;
- challenge-period commit history clearly documented if pre-existing work exists;
- no secrets;
- no private/user data;
- reproducible judge flow.

## 4. Video

Under three minutes, public YouTube, with audio.

Narrative:
1. problem/thesis;
2. show PTF product;
3. show human+agent WebMCP journey;
4. show protected operation and approval;
5. show adversarial attempt denied;
6. show same trust core across different capability classes;
7. close with accurate limitation/vision.

Do not spend most of the video explaining architecture.

## 5. Submission copy

Must explicitly answer:
- why WebMCP is a strong fit;
- UX improvement;
- what humans and agents can now do together;
- how WebMCP was implemented.

## 6. Final challenge gate

Immediately before submission:
- re-fetch official rules;
- test live URL in ChatGPT in-app browser if available and Chrome WebMCP testing environment;
- run full challenge suite;
- test video URL/public visibility;
- verify repository/license;
- verify no post-deadline modification plan conflicts with rules;
- record immutable release commit/deployment identifiers.

After submission, follow the current rules regarding repository/site modification during judging. Continue full PTF development only through a separate permitted development line after rechecking those rules.
