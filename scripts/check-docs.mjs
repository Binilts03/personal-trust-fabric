#!/usr/bin/env node
/**
 * Documentation link check.
 *
 * The docs are a site (Jekyll) and a repository (Markdown) at once, and a
 * link has to work in BOTH: a relative link is resolved by the file system
 * when the file is read on GitHub, and by the page's site URL when the site
 * is built. The two resolutions differ, so this check resolves both and
 * reports a link that works in only one of them.
 *
 * - Markdown links are resolved against the file that carries them (the
 *   repository view) and against the page's site URL (the site view).
 * - Site links (`{{ '/path/' | relative_url }}`) are resolved against the
 *   docs source tree, because that is what the site publishes.
 *
 * External links (http/https/mailto) and pure anchors are not resolved: they
 * are outside this repository's control.
 *
 * Run: `node scripts/check-docs.mjs` (exit 0 when every link resolves).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] ?? process.cwd());
const docsRoot = join(root, "docs");
const failures = [];

function markdownFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "_site") continue;
      files.push(...markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files.sort();
}

/** A site path resolves to the docs source file the site publishes. */
function siteSource(sitePath) {
  const clean = sitePath.replace(/^\/+|\/+$/g, "");
  const candidates =
    clean.length === 0
      ? [join(docsRoot, "index.md")]
      : [
          join(docsRoot, `${clean}.md`),
          join(docsRoot, clean, "index.md"),
        ];
  return candidates.find((candidate) => existsSync(candidate));
}

/** A page may opt out of publication (repository-only documents). */
function isPublished(file) {
  const head = readFileSync(file, "utf8").slice(0, 400);
  if (!head.startsWith("---")) return true;
  const front = head.split("---")[1] ?? "";
  return !/published:\s*false/.test(front);
}

/** The URL path a docs page is published at (without the baseurl). */
function pageUrl(file) {
  const rel = relative(docsRoot, file).split(sep).join("/");
  if (rel === "index.md") return "/";
  return `/${rel.replace(/\.md$/, "")}/`;
}

/** Join a page URL with a relative link, the way a browser would. */
function joinUrl(base, link) {
  const parts = base.split("/").filter((part) => part.length > 0);
  for (const segment of link.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return `/${parts.join("/")}/`;
}

const markdownLink = /\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
const liquidLink = /\{\{\s*['"]([^'"]+)['"]\s*\|\s*relative_url\s*\}\}/g;

for (const file of markdownFiles(root)) {
  const source = readFileSync(file, "utf8");
  const shown = relative(root, file).split(sep).join("/");
  const inDocs = file.startsWith(docsRoot + sep) || file === docsRoot;

  for (const match of source.matchAll(liquidLink)) {
    const target = match[1] ?? "";
    if (!target.startsWith("/")) continue;
    if (siteSource(target) === undefined) {
      failures.push(
        `${shown}: site link '${target}' has no docs source (docs/${target.replace(/^\/+/, "")}.md)`
      );
    }
  }

  for (const match of source.matchAll(markdownLink)) {
    const raw = match[1] ?? "";
    if (raw.length === 0) continue;
    if (raw.startsWith("#")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    if (raw.includes("{{")) continue;
    const withoutAnchor = raw.split("#")[0] ?? "";
    if (withoutAnchor.length === 0) continue;

    // The repository view: the link is relative to the file that carries it.
    const repositoryTarget = resolve(dirname(file), withoutAnchor);
    const repositoryOk = existsSync(repositoryTarget);

    // The site view: the link is relative to the page's published URL.
    let siteOk = true;
    let siteUrl = raw;
    if (inDocs && isPublished(file)) {
      const url = joinUrl(pageUrl(file), withoutAnchor);
      siteUrl = url;
      siteOk = siteSource(url) !== undefined;
    }

    if (inDocs && isPublished(file) && !siteOk) {
      failures.push(
        `${shown}: link '${raw}' does not resolve on the site (${siteUrl})`
      );
    } else if (!repositoryOk && !inDocs) {
      failures.push(`${shown}: link '${raw}' does not resolve`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  console.error(`documentation links: ${failures.length} broken`);
  process.exit(1);
}
console.log("documentation links: ok");
