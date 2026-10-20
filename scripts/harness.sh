#!/usr/bin/env bash
# PTF full local gate: typecheck, tests, evals, public-seam check, zero-dep core.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ typecheck"
npm run typecheck

echo "→ build+unit"
npm test

echo "→ eval"
npm run eval

echo "→ seam + zero-dep checks"
node scripts/check-seams.mjs

echo "OK: harness green"
