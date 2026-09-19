import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const readmePath = resolve(root, "README.md");
const readme = readFileSync(readmePath, "utf8");

const START = "<!-- PTF-BRAND:START -->";
const END = "<!-- PTF-BRAND:END -->";

function fail(message) {
  console.error(`brand check: FAIL — ${message}`);
  process.exitCode = 1;
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

if (count(readme, START) !== 1) fail("README must contain exactly one brand start marker");
if (count(readme, END) !== 1) fail("README must contain exactly one brand end marker");

const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start < 0 || end < 0 || start >= end) {
  fail("README brand markers are missing or out of order");
}

const requiredAssets = [
  "assets/brand/ptf-mark-dark.svg",
  "assets/brand/ptf-mark-light.svg",
  "assets/brand/hero-dark.svg",
  "assets/brand/hero-light.svg",
  "assets/brand/architecture-dark.svg",
  "assets/brand/architecture-light.svg",
  "assets/brand/authority-trace-dark.svg",
  "assets/brand/authority-trace-light.svg",
  "assets/brand/social-preview.svg",
  "docs/brand/BRAND.md",
];

for (const relative of requiredAssets) {
  const path = resolve(root, relative);
  if (!existsSync(path)) {
    fail(`missing required brand asset: ${relative}`);
    continue;
  }
  if (statSync(path).size === 0) fail(`empty required brand asset: ${relative}`);
  if (relative.endsWith(".svg")) {
    const svg = readFileSync(path, "utf8");
    if (!svg.includes("<svg") || !svg.includes("</svg>")) {
      fail(`invalid SVG wrapper: ${relative}`);
    }
  }
}

if (start >= 0 && end > start) {
  const brand = readme.slice(start, end + END.length);
  const requiredRefs = [
    "./assets/brand/hero-dark.svg",
    "./assets/brand/hero-light.svg",
    "./assets/brand/architecture-dark.svg",
    "./assets/brand/architecture-light.svg",
    "./assets/brand/authority-trace-dark.svg",
    "./assets/brand/authority-trace-light.svg",
  ];
  for (const ref of requiredRefs) {
    if (!brand.includes(ref)) fail(`brand region does not reference ${ref}`);
  }

  if (/\b(?:src|srcset)=["']https?:\/\//i.test(brand)) {
    fail("brand region must not depend on externally hosted images");
  }
  if (/!\[[^\]]*\]\(https?:\/\//i.test(brand)) {
    fail("brand region must not use externally hosted Markdown images");
  }
}

if (process.exitCode !== 1) {
  console.log("brand check: ok");
}
