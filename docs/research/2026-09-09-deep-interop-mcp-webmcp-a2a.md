# Deep read: agent interop security (MCP auth, WebMCP, A2A v1.0)

_Generated: 2026-09-09 | Sources: 5 primary, all read in full | Confidence: High, except flagged guidance-only items_

Supersedes the interop section of `2026-09-08-agentic-commerce-protocols.md`. Read from spec text.

## 1. MCP authorization (spec 2025-11-25 read in full)

- Discovery order: `401 WWW-Authenticate resource_metadata` if present, else `/.well-known/oauth-protected-resource/<path>`, then `/.well-known/oauth-protected-resource`. Server MUST serve RFC 9728 metadata with `authorization_servers`; client MUST support both. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- AS metadata order: with path — `/.well-known/oauth-authorization-server/<path>`, then `/.well-known/openid-configuration/<path>`, then `<path>/.well-known/openid-configuration`; without path — oauth then openid. Client MUST try all. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Audience: client MUST send RFC 8707 `resource` = canonical MCP URI in authorize + token requests; server MUST validate audience (RFC 9068 `aud`) and reject otherwise. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Token-passthrough ban (quoted): "The MCP server MUST NOT pass through the token it received from the MCP client" — rationale: confused deputy, bypass of rate-limit/audit, trust-boundary break. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- Redirect/state: redirect MUST be pre-registered + exact-match validated, `localhost` or HTTPS only; client SHOULD send/verify `state` and discard mismatches; AS MUST prevent open-redirect per OAuth 2.1 §7.12.2. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- PKCE/scopes: client MUST use PKCE `S256` and MUST refuse if `code_challenge_methods_supported` is absent. Scope priority: `WWW-Authenticate scope`, then all of `scopes_supported`. Keep `scopes_supported` minimal + step-up via `403 insufficient_scope`. (https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)

## 2. MCP official risks + fixes (security tutorial read in full)

- Confused deputy (proxy with static upstream ID + dynamic downstream registration): MUST do per-client consent before upstream redirect; `__Host-` cookie `Secure/HttpOnly/SameSite=Lax` bound to `client_id`; exact `redirect_uri`; single-use 10-min `state` set only after consent. (https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- SSRF (metadata/token/CIMD URLs): MUST consider SSRF on `resource_metadata`, `authorization_servers`, `token_endpoint`, CIMD; SHOULD enforce HTTPS, block `10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, fc00::/7, fe80::/10`, validate redirects, use egress proxy, pin DNS. (https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- State-handle hijacking: "MUST NOT treat possession of a state handle as authentication"; SHOULD use secure-random expiring handles keyed `<user_id>:<handle>` from the verified token. (https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- Local-server RCE (one-click `npx`): MUST show the exact untruncated command + explicit approval; SHOULD flag `sudo/rm`/network/SSH, sandbox, least-privilege; local server SHOULD use `stdio` or HTTP with token/Unix-socket. (https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)
- Auth-URL injection: MUST allow only `http/https` (http loopback-only), reject `javascript:/data:/file:/vbscript:`; MUST NOT open via shell; SHOULD use `script-src 'self'` + sanitization. (https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

## 3. WebMCP (spec + Chrome hardening read in full)

- Registration: `ModelContextTool{name*,title,description*,inputSchema,execute*,annotations}` + `options{exposedTo[],signal}`. `name` 1–128 chars `[A-Za-z0-9_.-]`; empty/duplicate/non-active/non-origin-keyed/no-`tools`-permission registrations rejected. (https://webmachinelearning.github.io/webmcp/)
- Annotations: `readOnlyHint` = no state change; `untrustedContentHint` = output untrusted, sanitize/spotlight/hide; `consequentialHint` = significant/irreversible (flight/money), require confirmation. (https://webmachinelearning.github.io/webmcp/)
- Exposure: default `exposedTo=[]` = same-origin tree only; expose only to trusted secure origins; `getTools{fromOrigins[]}` empty = same-origin only; `tools` Permissions-Policy default `self`; cross-origin needs `allow` + exposure. (https://webmachinelearning.github.io/webmcp/)
- Chrome hardening: set hints; expose read (`getFavoriteProducts`) / write (`postComment`) only to trusted origins; keep descriptions/outputs terse — 500/150/30/1.5K char budgets are guidance only, NOT spec-enforced (single source). (https://developer.chrome.com/docs/ai/webmcp/secure-tools)
- Spec-listed risks: tool-poisoning metadata, output injection (UGC exfil), tool implementation as attack target, `finalizeCart` intent mismatch, over-parameter profiling (`age/pregnant/location`), cross-origin state carry (TODO in spec), private-mode leakage. (https://webmachinelearning.github.io/webmcp/)

## 4. A2A v1.0 (spec + task-lifecycle + enterprise docs read in full)

- AgentCard fields: `name*,description*,supportedInterfaces*[{url*,protocolBinding*,protocolVersion*,tenant}],provider{organization*,url*},version*,documentationUrl,capabilities*{streaming,pushNotifications,extensions[],extendedAgentCard},securitySchemes,securityRequirements,defaultInputModes*,defaultOutputModes*,skills*[],signatures[],iconUrl`. (https://a2a-protocol.org/v1.0.0/specification/)
- Skills/schemes: skill `{id*,name*,description*,tags*,examples,inputModes,outputModes,securityRequirements}`; scheme exactly-one-of `apiKey/httpAuth/oauth2/openIdConnect/mtls`; flows one-of `authorizationCode/clientCredentials/deviceCode` (`implicit`/`password` deprecated). (https://a2a-protocol.org/v1.0.0/specification/)
- Signed cards: JWS RFC 7515 over JCS RFC 8785 canonical form minus `signatures`/defaults; `protected` MUST have `alg`/`kid` (SHOULD `typ:JOSE`, MAY `jku`); guarantees authenticity + integrity; SHOULD verify ≥1 signature via HTTPS, never expired/revoked. (https://a2a-protocol.org/v1.0.0/specification/)
- Task states: `TASK_STATE_UNSPECIFIED/SUBMITTED/WORKING/COMPLETED/FAILED/CANCELED/INPUT_REQUIRED/REJECTED/AUTH_REQUIRED`. Terminal = COMPLETED/FAILED/CANCELED/REJECTED (immutable); interrupted = INPUT/AUTH_REQUIRED. (https://a2a-protocol.org/v1.0.0/topics/life-of-a-task/)
- In-task auth: agent MUST track the Task and set `AUTH_REQUIRED` + status message (unless out-of-band/extension); credentials MUST arrive out-of-band (HTTPS) unless in-band via extension; SHOULD stay subscribed/poll, bind/encrypt to originator. (https://a2a-protocol.org/v1.0.0/specification/)
- Push security: agent MUST send `PushNotificationConfig.authentication` creds; SHOULD use 10–30s timeout + backoff; SHOULD reject private/loopback/link-local URLs + prefer HTTPS allowlists. Client MUST verify auth + `taskId`, return 2xx, SHOULD be idempotent + rate-limited. (https://a2a-protocol.org/v1.0.0/specification/)

## Key takeaways (fail-closed gateway rules)

- MCP: reject any token whose audience ≠ self; never forward a client token upstream — mint a separate upstream token. (Inference synthesizing the spec MUSTs.)
- WebMCP: deny cross-origin get/execute unless `exposedTo` + `tools` policy allow; force confirmation on `consequentialHint`; treat ALL tool metadata and outputs as untrusted input.
- A2A: authenticate every request; enforce per-skill/OAuth-scope + caller-scoped Get/List before DB query; verify card signatures + webhook auth. (Per enterprise-ready guidance.)

## Sources

1. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) — discovery, audience, passthrough ban, redirect, PKCE
2. [MCP security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) — deputy/SSRF/handle/RCE/URL fixes
3. [WebMCP spec](https://webmachinelearning.github.io/webmcp/) — registration, hints, exposure, risks
4. [Chrome WebMCP hardening](https://developer.chrome.com/docs/ai/webmcp/secure-tools) — guidance-level budgets
5. [A2A v1.0 spec / life-of-a-task / enterprise-ready](https://a2a-protocol.org/v1.0.0/specification/) — cards, tasks, auth, push

## Methodology

Parallel subagent read all 5 primaries in full via webfetch; main session synthesized. No source unread. Single-source flags: Chrome char budgets (guidance, not enforcement), WebMCP same-origin-carry and declarative form-schema execution (spec TODOs). Fail-closed rules are inference, labeled as such.
