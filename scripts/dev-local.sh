#!/usr/bin/env bash
# dev-local: one-command local loop for the PTF library repo.
# Right-sized: no servers, no infra, no tmux — just install + typecheck + test.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

preflight() {
  command -v node >/dev/null 2>&1 || { echo "missing node >=22 (https://nodejs.org)"; exit 1; }
  command -v npm >/dev/null 2>&1 || { echo "missing npm"; exit 1; }
  node --version
  npm --version
}

install_deps() {
  if [ ! -d node_modules ]; then
    echo "→ npm install"
    npm install
  else
    echo "→ node_modules present, skipping install"
  fi
}

typecheck() {
  echo "→ npm run typecheck"
  npm run typecheck
}

test_all() {
  echo "→ npm test"
  npm test
}

status() {
  preflight
  echo "repo: $ROOT"
  [ -d node_modules ] && echo "deps: installed" || echo "deps: missing (run: scripts/dev-local.sh up)"
  [ -d dist ] && echo "build: present" || echo "build: absent"
}

cmd="${1:-up}"
case "$cmd" in
  up) preflight; install_deps; typecheck; test_all; echo "OK: typecheck + tests green";;
  status) status;;
  typecheck) preflight; install_deps; typecheck;;
  test) preflight; install_deps; test_all;;
  *) echo "usage: dev-local.sh {up|status|typecheck|test}"; exit 1;;
esac
