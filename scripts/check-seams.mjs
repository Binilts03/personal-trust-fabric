#!/usr/bin/env node
/**
 * Single source of truth for PTF's static architecture guards.
 *
 * Public seam: tests may import only the public barrel (`src/index.ts`) or the
 * bin entry points. Repository-owned privacy persistence suites are the one
 * deliberate exception: they exercise the file repositories directly because
 * the published `./privacy` surface intentionally excludes them.
 *
 * Core guard: `src/core/` depends only on node:crypto and relative modules.
 *
 * Interface: `node scripts/check-seams.mjs [--root <dir>]` exits 0 when both
 * guards pass, 1 with file:line evidence otherwise. Both CI and
 * `scripts/harness.sh` invoke this module so the rules cannot drift.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_TEST_IMPORTS = new Set([
  "../src/index.js",
  "../src/cli.js",
  "../src/mcp-server.js",
  "../src/pdp-server.js",
]);

// Exact, reviewed exceptions. Do not widen these to other tests or modules.
const PRIVACY_PERSISTENCE_TEST_IMPORTS = new Set([
  "../src/store/privacy.js",
  "../src/store/privacy-events.js",
]);

const CORE_ALLOWED_IMPORT = "node:crypto";

function parseRoot(argv) {
  const inline = argv.find((arg) => arg.startsWith("--root="));
  if (inline !== undefined) return resolve(inline.slice("--root=".length));
  const flag = argv.indexOf("--root");
  if (flag === -1) {
    return resolve(fileURLToPath(new URL("..", import.meta.url)));
  }
  const value = argv[flag + 1];
  if (value === undefined) throw new Error("--root requires a directory");
  return resolve(value);
}

function walkTypeScriptFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTypeScriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
  }
  return files.sort();
}

function importSpecifier(line) {
  const match = /\bfrom\s+["']([^"']+)["']/.exec(line);
  return match === null ? undefined : match[1];
}

function scan(root, target, allow) {
  const violations = [];
  for (const file of walkTypeScriptFiles(join(root, target))) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const specifier = importSpecifier(line);
      if (specifier === undefined) return;
      const verdict = allow(specifier);
      if (verdict !== true) {
        violations.push({
          file: relative(root, file).split(sep).join("/"),
          line: index + 1,
          specifier,
          reason: verdict,
        });
      }
    });
  }
  return violations;
}

function allowTestImport(specifier) {
  if (!specifier.startsWith("../src/")) return true;
  if (PUBLIC_TEST_IMPORTS.has(specifier)) return true;
  if (PRIVACY_PERSISTENCE_TEST_IMPORTS.has(specifier)) return true;
  return `not a public test seam; allowed: ${[...PUBLIC_TEST_IMPORTS, ...PRIVACY_PERSISTENCE_TEST_IMPORTS].join(", ")}`;
}

function allowCoreImport(specifier) {
  if (specifier === CORE_ALLOWED_IMPORT) return true;
  if (specifier.startsWith("./") || specifier.startsWith("../")) return true;
  return `core may import only ${CORE_ALLOWED_IMPORT} and relative modules`;
}

function report(violations, failure) {
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} imports "${violation.specifier}" — ${violation.reason}`
    );
  }
  if (violations.length > 0) {
    console.error(`FAIL: ${failure}`);
    return false;
  }
  return true;
}

const root = parseRoot(process.argv.slice(2));
const seamOk = report(
  scan(root, "tests", allowTestImport),
  "test reaches past public seam"
);
const coreOk = report(
  scan(root, "src/core", allowCoreImport),
  "core has non-allowlisted import"
);

if (seamOk) console.log("seam check: ok");
if (coreOk) console.log("zero-dep core: ok");
if (!seamOk || !coreOk) process.exit(1);
