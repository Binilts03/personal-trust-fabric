import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ExplicitRedirects,
  assertDistinctTokens,
  assertSafeUrl,
  checkAudience,
} from "../src/index.js";

describe("MCP edge guards (ptf-v03/01)", () => {
  it("rejects tokens whose audience is not this gateway", () => {
    checkAudience("https://gw.example/mcp", "https://gw.example/mcp");
    checkAudience(
      ["https://other.example", "https://gw.example/mcp"],
      "https://gw.example/mcp"
    );
    assert.throws(() =>
      checkAudience("https://evil.example/mcp", "https://gw.example/mcp")
    );
    assert.throws(() => checkAudience(undefined, "https://gw.example/mcp"));
  });

  it("refuses to forward a client token upstream", () => {
    assert.throws(() => assertDistinctTokens("tok-abc", "tok-abc"));
    assert.throws(() => assertDistinctTokens("tok-abc", ""));
    assertDistinctTokens("tok-abc", "tok-upstream-xyz");
  });

  it("blocks SSRF targets and non-HTTP schemes", () => {
    for (const bad of [
      "http://169.254.169.254/latest/meta-data/",
      "https://10.0.0.5/as",
      "http://192.168.1.1/x",
      "https://172.16.9.9/x",
      "http://127.0.0.1:8080/x",
      "https://127.0.0.1/x",
      "https://[::1]/x",
      "https://[::]/x",
      "https://[::ffff:10.0.0.1]/x",
      "https://[::ffff:127.0.0.1]/x",
      "https://[fc00::1]/x",
      "https://[fe80::1]/x",
      "javascript:alert(1)",
      "data:text/plain,hi",
      "file:///etc/passwd",
      "https://evil.example:badport/x",
    ]) {
      assert.throws(() => assertSafeUrl(bad, "metadata"), bad);
    }
    assert.ok(
      assertSafeUrl(
        "https://auth.example.com/.well-known/x",
        "metadata"
      ) instanceof URL
    );
    assert.ok(
      assertSafeUrl("http://localhost:3000/cb", "redirect", true) instanceof URL
    );
    assert.throws(() => assertSafeUrl("http://localhost:3000/cb", "metadata"));
  });

  it("enforces exact-match redirect registration", () => {
    const redirects = new ExplicitRedirects();
    redirects.register("https://app.example.com/cb");
    redirects.register("http://localhost:3000/cb");
    assert.throws(() => redirects.register("javascript:alert(1)"));
    redirects.check("https://app.example.com/cb");
    assert.throws(() =>
      redirects.check("https://app.example.com/cb?next=evil")
    );
    assert.throws(() => redirects.check("https://app.example.com/other"));
  });
});
