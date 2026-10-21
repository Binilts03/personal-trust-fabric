/**
 * Package verifier: what a consumer actually receives.
 *
 * `npm pack` is the only place where the published surface is decided, and
 * a broken export map or a missing binary only shows up when a user
 * installs. This checks the tarball itself:
 *
 * - every `exports` target exists in the tarball,
 * - every `bin` target exists and is executable,
 * - the tests are not shipped,
 * - the README and the LICENSE are shipped,
 * - with `--install`, the tarball installs into a clean directory and the
 *   curated entry point imports.
 *
 * Run: `npm run verify:package` (add `--install` for the full check).
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const installCheck = process.argv.includes("--install");
const failures = [];

function fail(message) {
  failures.push(message);
}

const staging = mkdtempSync(join(tmpdir(), "ptf-pack-"));

/** Run npm through its own entry point: the .cmd shim is not executable here. */
function npm(args, opts = {}) {
  const execPath = process.env.npm_execpath;
  if (execPath !== undefined && execPath !== "") {
    return execFileSync(process.execPath, [execPath, ...args], {
      encoding: "utf8",
      ...opts,
    });
  }
  return execFileSync("npm", args, {
    encoding: "utf8",
    shell: true,
    ...opts,
  });
}

let packed;
try {
  const raw = npm(["pack", "--json", "--pack-destination", staging], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  packed = JSON.parse(raw)[0];
} catch (error) {
  console.error(`package verify: FAIL - npm pack failed: ${error.message}`);
  process.exit(1);
}

const files = new Set(
  packed.files.map((file) => file.path.replace(/\\/g, "/"))
);
const modes = new Map(
  packed.files.map((file) => [file.path.replace(/\\/g, "/"), file.mode])
);

function exportTargets(value, out = []) {
  if (typeof value === "string") {
    if (value.startsWith("./dist/")) out.push(value.slice(2));
    return out;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) exportTargets(nested, out);
  }
  return out;
}

for (const target of exportTargets(pkg.exports ?? {})) {
  if (!files.has(target))
    fail(`exports target missing from the tarball: ${target}`);
}

for (const [name, target] of Object.entries(pkg.bin ?? {})) {
  const path = String(target).replace(/^\.\//, "");
  if (!files.has(path)) fail(`bin ${name} missing from the tarball: ${path}`);
  // npm sets the executable bit when it links a bin, so the tarball mode is
  // not the property to check. The shebang is: without it the linked script
  // is not runnable on a POSIX shell.
  const local = resolve(root, path);
  if (!existsSync(local)) {
    fail(`bin ${name} has no built file: ${path} (run the build first)`);
  } else if (!readFileSync(local, "utf8").startsWith("#!")) {
    fail(`bin ${name} has no shebang: ${path}`);
  }
}

for (const path of files) {
  if (path.startsWith("dist/tests/"))
    fail(`tests must not be shipped: ${path}`);
  if (path.endsWith(".map")) fail(`source maps must not be shipped: ${path}`);
}

for (const required of ["README.md", "LICENSE", "package.json"]) {
  if (!files.has(required)) fail(`${required} missing from the tarball`);
}

if (installCheck) {
  const consumer = mkdtempSync(join(tmpdir(), "ptf-consumer-"));
  try {
    npm(["init", "-y"], { cwd: consumer, stdio: "ignore" });
    npm(
      [
        "install",
        join(staging, packed.filename),
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
      ],
      { cwd: consumer, stdio: "ignore" }
    );
    const probe = join(consumer, "probe.mjs");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      probe,
      'import { Authority } from "personal-trust-fabric";\n' +
        "console.log(typeof Authority);\n"
    );
    const out = execFileSync(process.execPath, [probe], {
      cwd: consumer,
      encoding: "utf8",
    });
    if (!out.includes("function")) {
      fail(
        `the installed package does not export the curated entry point: ${out.trim()}`
      );
    }
  } catch (error) {
    fail(`the tarball does not install and import: ${error.message}`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

rmSync(staging, { recursive: true, force: true });

if (failures.length > 0) {
  for (const failure of failures)
    console.error(`package verify: FAIL - ${failure}`);
  process.exit(1);
}
console.log(
  `package verify: ok - ${packed.filename} (${packed.files.length} files, ${packed.size} bytes)`
);
