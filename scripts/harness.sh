#!/usr/bin/env bash
# harness: codebase harness for PTF v04. One command proves the whole contract.
# - typecheck (strict TS) + build + unit + eval
# - seam check: tests import only from src/index.ts (public seam)
# - zero-dep check: src/core imports only node:crypto + relative
# - evidence check: every .scratch/*/issues/*.md resolved has ## Answer
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "→ typecheck"; npm run typecheck
echo "→ build+unit"; npm test
echo "→ eval"; npm run eval
echo "→ seam check (tests via ../src/index.js; bin entries src/cli.js + src/mcp-server.js exempt per cli.ts:34-36)"
if grep -R "from \"\.\./src/[^\"]*\.js\"" tests --include="*.ts" | grep -v "from \"\.\./src/index\.js\"" | grep -v "from \"\.\./src/cli\.js\"" | grep -v "from \"\.\./src/mcp-server\.js\""; then
  echo "FAIL: test reaches past public seam"; exit 1;
fi
echo "→ zero-dep check (src/core: node:crypto + relative only)"
if grep -R "from \"" src/core --include="*.ts" | grep -v "from \"node:crypto\"" | grep -v "from \"\./" | grep -v "from \"\.\./"; then
  echo "FAIL: core has non-allowlisted import"; exit 1;
fi
echo "→ evidence check (resolved tickets need ## Answer)"
for f in .scratch/*/issues/*.md; do
  [ -e "$f" ] || continue
  if grep -q "Status.*resolved" "$f" && ! grep -q "## Answer" "$f"; then
    echo "FAIL: $f resolved without ## Answer"; exit 1;
  fi
done
echo "OK: harness green"
