#!/usr/bin/env node
/**
 * Single source of truth for PTF's static architecture guards.
 *
 * Public seam: tests may import only the public barrel (`src/index.ts`) or the
 * bin entry points. A small, exact list of repository-owned persistence
 * suites may reach the file repositories directly because the published
 * `./privacy` surface intentionally excludes them. The exemption is scoped to
 * the named test file and specifier; it never applies repo-wide.
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
  "../src/hostkit/index.js",
]);

// Exact, reviewed exceptions: test file -> specifiers it may import.
// Do not widen these to other tests or modules.
const TEST_IMPORT_EXEMPTIONS = new Map([
  ["tests/privacy-store.test.ts", new Set(["../src/store/privacy.js"])],
  [
    "tests/backup.test.ts",
    new Set(["../src/store/privacy.js", "../src/store/privacy-events.js"]),
  ],
  [
    "tests/privacy-cli.test.ts",
    new Set(["../src/store/privacy.js", "../src/store/privacy-events.js"]),
  ],
  [
    "tests/privacy-events.test.ts",
    new Set(["../src/store/privacy.js", "../src/store/privacy-events.js"]),
  ],
  [
    "tests/privacy-mcp-stdio.test.ts",
    new Set(["../src/store/privacy.js", "../src/store/privacy-events.js"]),
  ],
  [
    "tests/privacy-payment-replay.test.ts",
    new Set(["../src/privacy/payment-replay.js"]),
  ],
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
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/,
    /^\s*import\s+["']([^"']+)["']/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match !== null) return match[1];
  }
  return undefined;
}

function isAbsoluteSpecifier(specifier) {
  return (
    specifier.startsWith("/") ||
    specifier.startsWith("\\\\") ||
    specifier.startsWith("file:") ||
    /^[A-Za-z]:[\\/]/.test(specifier)
  );
}

function scan(root, target, allow) {
  const violations = [];
  const files = walkTypeScriptFiles(join(root, target));
  if (files.length === 0) {
    violations.push({
      file: target,
      line: 1,
      specifier: "",
      reason: "root is missing or contains no TypeScript files",
    });
  }
  for (const file of files) {
    const filePath = relative(root, file).split(sep).join("/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      const specifier = importSpecifier(line);
      if (specifier === undefined) return;
      const verdict = allow(filePath, specifier);
      if (verdict !== true) {
        violations.push({
          file: filePath,
          line: index + 1,
          specifier,
          reason: verdict,
        });
      }
    });
  }
  return violations;
}

function allowTestImport(file, specifier) {
  if (isAbsoluteSpecifier(specifier))
    return "absolute import paths are not allowed";
  if (!specifier.startsWith("../src/")) return true;
  if (PUBLIC_TEST_IMPORTS.has(specifier)) return true;
  const exemptions = TEST_IMPORT_EXEMPTIONS.get(file);
  if (exemptions !== undefined && exemptions.has(specifier)) return true;
  return `not a public test seam; allowed: ${[...PUBLIC_TEST_IMPORTS].join(", ")} (plus file-scoped persistence exceptions)`;
}

function allowCoreImport(_file, specifier) {
  if (isAbsoluteSpecifier(specifier))
    return "absolute import paths are not allowed";
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
