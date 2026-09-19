import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const readme = readFileSync(resolve(root, "README.md"), "utf8");

const START = "<!-- PTF-BRAND:START -->";
const END = "<!-- PTF-BRAND:END -->";

function fail(message) {
  console.error(`brand check: FAIL - ${message}`);
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

const required = [
  "assets/brand/social-preview.svg",
  "docs/brand/BRAND.md",
];

for (const relative of required) {
  const path = resolve(root, relative);
  if (!existsSync(path)) {
    fail(`missing required brand file: ${relative}`);
    continue;
  }
  if (statSync(path).size === 0) fail(`empty required brand file: ${relative}`);
}

const brandDir = resolve(root, "assets/brand");
if (existsSync(brandDir)) {
  const allowedAssets = new Set(["social-preview.svg"]);
  for (const name of readdirSync(brandDir)) {
    if (!allowedAssets.has(name)) {
      fail(`unexpected brand asset: assets/brand/${name}`);
    }
  }
}

const socialPath = resolve(root, "assets/brand/social-preview.svg");
if (existsSync(socialPath)) {
  const svg = readFileSync(socialPath, "utf8");
  if (!svg.includes("<svg") || !svg.includes("</svg>")) {
    fail("social preview is not a complete SVG");
  }
  if (!svg.includes('viewBox="0 0 1280 640"')) {
    fail("social preview must use the 1280x640 canvas");
  }
}

if (start >= 0 && end > start) {
  const brand = readme.slice(start, end + END.length);

  const requiredCopy = [
    "# Personal Trust Fabric",
    "Authority should travel. Secrets should not.",
    "secrets stop here",
    "decision      ALLOW",
  ];
  for (const fragment of requiredCopy) {
    if (!brand.includes(fragment)) fail(`brand region is missing: ${fragment}`);
  }

  if (/<picture\b|<img\b|!\[[^\]]*\]\(/i.test(brand)) {
    fail("brand region must stay native to GitHub and contain no hero images");
  }
  if (/\b(?:src|srcset)=["']https?:\/\//i.test(brand)) {
    fail("brand region must not depend on externally hosted images");
  }
}

if (process.exitCode !== 1) {
  console.log("brand check: ok");
}
