# Command registry

This is the current command source of truth. Commands absent here are not yet established.

| Purpose | Command | Status |
|---|---|---|
| Refresh installed skill/package inventory | `pwsh scripts/refresh-skill-registry.ps1` | Available |
| Verify W0 harness structure and ledgers | `pwsh scripts/verify-harness.ps1` | Available |
| Bootstrap dependencies | None; Node.js 22+ only | Available |
| Run local synthetic product | `npm run dev` | Available; loopback `127.0.0.1:3000` by default |
| Run hosted process | `npm start` | Available; requires exact HTTPS `PUBLIC_ORIGIN` when `HOST` is non-loopback |
| Build | None; native ESM/static assets | Available |
| Architecture lint | `npm run lint:architecture` | Available |
| Full automated suite | `npm test` | Available |
| Core unit tests | `npm run test:core` | Available |
| Integration and WebMCP contract tests | `npm run test:integration` | Available |
| Architecture tests | `npm run test:architecture` | Available |
| Rendered browser flow | See `docs/judge-script.md` | Manual Playwright evidence available; real WebMCP-host eval OPEN |
| Security/adversarial suite | `npm test` | Bounded M0 controls available; production suite OPEN |
| Protocol conformance | — | OPEN |
| Release | — | OPEN; public deployment/submission requires Human confirmation |

Commands target the bounded synthetic M0 profile unless explicitly labeled otherwise.
