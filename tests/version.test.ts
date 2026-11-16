import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packageVersion, ptfVersion, run } from "../src/cli.js";

/**
 * One version, one source: the package metadata.
 *
 * The CLI, the PDP health endpoint and the MCP server each used to carry
 * their own copy of the version string, and they drifted — the package moved
 * to a candidate version while the CLI and the MCP server still reported the
 * old one. A copied version is a version that lies, so all three now read
 * `package.json` at runtime.
 *
 * The PDP surface is pinned by `tests/operations.test.ts` (the healthz
 * contract reads `package.json` too); this file pins the CLI and the MCP
 * server, and the reader they share.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Tests run compiled from dist/tests: the server lives at dist/src.
const SERVER = fileURLToPath(new URL("../src/mcp-server.js", import.meta.url));

function metadataVersion(): string {
  const parsed = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8")
  ) as { readonly version?: unknown };
  assert.equal(
    typeof parsed.version,
    "string",
    "package.json must carry a version"
  );
  return parsed.version as string;
}

/** A minimal stdio JSON-RPC client for the MCP server's handshake. */
function serverVersion(env: Record<string, string>): Promise<string> {
  const child: ChildProcess = spawn(process.execPath, [SERVER], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("rpc timeout: initialize"));
    }, 20000);
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        const message = JSON.parse(line) as {
          readonly id?: number;
          readonly result?: {
            readonly serverInfo?: { readonly version?: unknown };
          };
        };
        if (message.id !== 1) continue;
        clearTimeout(timer);
        child.kill();
        resolve(String(message.result?.serverInfo?.version ?? ""));
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin?.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2026-07-28",
          capabilities: {},
          clientInfo: { name: "version-check", version: "1" },
        },
      })}\n`
    );
  });
}

describe("version reporting", () => {
  it("reads the version from the package metadata", () => {
    assert.equal(packageVersion(), metadataVersion());
    assert.notEqual(packageVersion(), "unknown");
  });

  it("reports the package version from the CLI", async () => {
    const out: string[] = [];
    const code = await run(
      ["version"],
      {
        print: (line: string) => out.push(line),
        readLine: () => "yes",
        now: () => 1_700_000_000,
      },
      {}
    );
    assert.equal(code, 0);
    assert.deepEqual(out, [`ptf ${metadataVersion()}`]);
    assert.equal(ptfVersion(), metadataVersion());
  });

  it("reports the package version from the MCP server handshake", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ptf-version-"));
    try {
      const version = await serverVersion({
        PTF_STORE_DIR: dir,
        PTF_PASSPHRASE: "version-check",
        PTF_MCP_PRINCIPAL: "did:test:p",
        PTF_MCP_ACTOR: "did:test:a",
      });
      assert.equal(version, metadataVersion());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
