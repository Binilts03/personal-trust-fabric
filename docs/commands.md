# Command registry

Public sandbox commands:

| Purpose | Command |
|---|---|
| Run full automated suite | `npm test` |
| Run local synthetic product | `npm run dev` — loopback `127.0.0.1:3000` by default |
| Run hosted process | `npm start` — requires exact HTTPS `PUBLIC_ORIGIN` when `HOST` is non-loopback |
| Architecture lint | `npm run lint:architecture` |
| Core unit tests | `npm run test:core` |
| Integration and WebMCP contract tests | `npm run test:integration` |
| Architecture tests | `npm run test:architecture` |
| Rendered browser flow | See `docs/judge-script.md` |

No dependencies beyond Node.js 22+. Internal harness (`scripts/verify-harness.ps1`, skill registry) is archived at `../handoff-archive-2026-09-02/` and not tracked on `main`.
