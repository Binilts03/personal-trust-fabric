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

echo "→ seam check"
if grep -R 'from "\.\./src/[^"]*\.js"' tests --include="*.ts" \
  | grep -v 'from "\.\./src/index\.js"' \
  | grep -v 'from "\.\./src/cli\.js"' \
  | grep -v 'from "\.\./src/mcp-server\.js"' \
  | grep -v 'from "\.\./src/pdp-server\.js"'; then
  echo "FAIL: test reaches past public seam"
  exit 1
fi

echo "→ zero-dep core"
if grep -R 'from "' src/core --include="*.ts" \
  | grep -v 'from "node:crypto"' \
  | grep -v 'from "\./' \
  | grep -v 'from "\.\./'; then
  echo "FAIL: core has non-allowlisted import"
  exit 1
fi

echo "OK: harness green"
