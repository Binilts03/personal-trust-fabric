import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  PRODUCTION_OID4VP_PREFIXES,
  assertKeyFetchUrl,
  checkCardKeyPolicy,
  fetchCardKeyBytes,
  fetchViaPinnedIp,
  fetchWithPinning,
  isBlockedIp,
  parseClientIdProduction,
  requestToDisclosureDemand,
} from "../src/index.js";
import type { PinnedFetchResponse } from "../src/index.js";

function okResponse(url: string, textBody = "ok"): PinnedFetchResponse {
  return {
    status: 200,
    location: null,
    url,
    text: () => Promise.resolve(textBody),
  };
}

function redirectResponse(url: string, location: string): PinnedFetchResponse {
  return {
    status: 302,
    location,
    url,
    text: () => Promise.resolve("redirect"),
  };
}

const PUBLIC_IP = "93.184.216.34";

describe("host network duties — production fetch path (ticket 11)", () => {
  it("fails closed when DNS resolves private (rebinding)", async () => {
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/a2a", {
          lookup: () => Promise.resolve("10.0.0.5"),
          fetchFn: (url) => Promise.resolve(okResponse(url)),
        }),
      /DNS resolves private/
    );
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/a2a", {
          lookup: () => Promise.resolve("169.254.169.254"),
          fetchFn: (url) => Promise.resolve(okResponse(url)),
        }),
      /DNS resolves private/
    );
  });

  it("fails closed on redirect-to-private even with following enabled", async () => {
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/start", {
          maxRedirects: 3,
          lookup: (host) =>
            Promise.resolve(host === "10.1.2.3" ? "10.1.2.3" : PUBLIC_IP),
          fetchFn: (url) =>
            Promise.resolve(redirectResponse(url, "https://10.1.2.3/hook")),
        }),
      /blocked network range|DNS resolves private/
    );
  });

  it("no-follows by default: any redirect fails closed", async () => {
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/start", {
          lookup: () => Promise.resolve(PUBLIC_IP),
          fetchFn: (url) =>
            Promise.resolve(
              redirectResponse(url, "https://other.example.com/next")
            ),
        }),
      /no-follow/
    );
  });

  it("follows a clean redirect chain with per-hop re-check", async () => {
    const seen: string[] = [];
    const res = await fetchWithPinning("https://shop.example.com/start", {
      maxRedirects: 2,
      lookup: () => Promise.resolve(PUBLIC_IP),
      fetchFn: (url) => {
        seen.push(url);
        if (url === "https://shop.example.com/start") {
          return Promise.resolve(
            redirectResponse(url, "https://other.example.com/next")
          );
        }
        return Promise.resolve(okResponse(url));
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(seen, [
      "https://shop.example.com/start",
      "https://other.example.com/next",
    ]);
  });

  it("honours pinned IPs and still blocks private pins", async () => {
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/x", {
          pinnedIps: { "shop.example.com": "192.168.1.10" },
          fetchFn: (url) => Promise.resolve(okResponse(url)),
        }),
      /DNS resolves private/
    );
    const res = await fetchWithPinning("https://shop.example.com/x", {
      pinnedIps: { "shop.example.com": PUBLIC_IP },
      fetchFn: (url) => Promise.resolve(okResponse(url)),
    });
    assert.equal(res.status, 200);
  });

  it("isBlockedIp covers v4, loopback, link-local, and v6 ranges", () => {
    for (const bad of [
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "::ffff:127.0.0.1",
    ]) {
      assert.equal(isBlockedIp(bad), true, bad);
    }
    for (const good of [PUBLIC_IP, "8.8.8.8", "2606:4700:4700::1111"]) {
      assert.equal(isBlockedIp(good), false, good);
    }
  });

  it("passes the single validated IP to fetch (resolve-once, hostname preserved)", async () => {
    let lookups = 0;
    const seen: Array<{
      readonly url: string;
      readonly pinnedIp: string | undefined;
    }> = [];
    const res = await fetchWithPinning("https://shop.example.com/a2a", {
      lookup: (host) => {
        lookups += 1;
        assert.equal(host, "shop.example.com");
        return Promise.resolve(PUBLIC_IP);
      },
      fetchFn: (url, init) => {
        seen.push({ url, pinnedIp: init.pinnedIp });
        return Promise.resolve(okResponse(url));
      },
    });
    assert.equal(res.status, 200);
    assert.equal(lookups, 1);
    assert.equal(seen.length, 1);
    // Hostname stays in the URL (SNI/Host bind the name); the socket dials
    // the validated IP handed via init.pinnedIp — no re-resolution TOCTOU.
    assert.equal(seen[0]?.url, "https://shop.example.com/a2a");
    assert.equal(seen[0]?.pinnedIp, PUBLIC_IP);
  });

  it("re-resolves per redirect hop and pins each hop independently", async () => {
    const lookups: string[] = [];
    const pins: Array<string | undefined> = [];
    const res = await fetchWithPinning("https://shop.example.com/start", {
      maxRedirects: 2,
      lookup: (host) => {
        lookups.push(host);
        return Promise.resolve(
          host === "other.example.com" ? "8.8.8.8" : PUBLIC_IP
        );
      },
      fetchFn: (url, init) => {
        pins.push(init.pinnedIp);
        if (url === "https://shop.example.com/start") {
          return Promise.resolve(
            redirectResponse(url, "https://other.example.com/next")
          );
        }
        return Promise.resolve(okResponse(url));
      },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(lookups, ["shop.example.com", "other.example.com"]);
    assert.deepEqual(pins, [PUBLIC_IP, "8.8.8.8"]);
  });

  it("blocks private DNS before any connect (fetch never called)", async () => {
    let called = false;
    await assert.rejects(
      () =>
        fetchWithPinning("https://shop.example.com/x", {
          lookup: () => Promise.resolve("10.0.0.5"),
          fetchFn: (url, init) => {
            called = true;
            assert.equal(init.pinnedIp, "10.0.0.5");
            return Promise.resolve(okResponse(url));
          },
        }),
      /DNS resolves private/
    );
    assert.equal(called, false);
  });

  it("pinned transport dials the validated IP with Host preserved (SNI path)", async () => {
    let seenHost: string | undefined;
    let seenUrl: string | undefined;
    const server = createServer((req, res) => {
      seenHost = req.headers.host;
      seenUrl = req.url;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("pinned-ok");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    try {
      const addr = server.address();
      const port =
        typeof addr === "object" && addr !== null
          ? (addr as { readonly port: number }).port
          : 0;
      assert.ok(port > 0);
      // Fake hostname never resolves: success proves the socket dialled the
      // validated IP (127.0.0.1) while Host/SNI kept the original name
      // (src/adapters/urls.ts: fetchViaPinnedIp preserves servername + Host).
      const fake = new URL(`http://pinned.test:${port}/hello?x=1`);
      const res = await fetchViaPinnedIp(fake, "127.0.0.1");
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "pinned-ok");
      assert.equal(res.url, fake.toString());
      assert.equal(seenHost, `pinned.test:${port}`);
      assert.equal(seenUrl, "/hello?x=1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("host network duties — A2A key-fetch pinning (ticket 11)", () => {
  it("requires pinned https for key URLs", () => {
    assert.ok(assertKeyFetchUrl("https://keys.example.com/k1") instanceof URL);
    assert.throws(() => assertKeyFetchUrl("http://keys.example.com/k1"));
    assert.throws(() => assertKeyFetchUrl("https://10.0.0.5/k1"));
    assert.throws(() => assertKeyFetchUrl("https://user:pass@example.com/k1"));
  });

  it("enforces host allowlist, revocation, and expiry", () => {
    assert.ok(
      checkCardKeyPolicy("k1", "https://keys.example.com/k1", {
        allowedHosts: ["keys.example.com"],
      }) instanceof URL
    );
    assert.throws(() =>
      checkCardKeyPolicy("k1", "https://other.example.com/k1", {
        allowedHosts: ["keys.example.com"],
      })
    );
    assert.throws(() =>
      checkCardKeyPolicy("k1", "https://keys.example.com/k1", {
        isRevoked: (kid) => kid === "k1",
      })
    );
    assert.throws(() =>
      checkCardKeyPolicy("k1", "https://keys.example.com/k1", {
        expiresAtMs: 1_000,
        nowMs: 2_000,
      })
    );
    assert.ok(
      checkCardKeyPolicy("k1", "https://keys.example.com/k1", {
        expiresAtMs: 2_000,
        nowMs: 1_000,
      }) instanceof URL
    );
  });

  it("fetches key bytes over the pinned path, policy first", async () => {
    const fetched = await fetchCardKeyBytes("k1", {
      urlForKid: (kid) => `https://keys.example.com/${kid}.jwk`,
      policy: { allowedHosts: ["keys.example.com"] },
      fetch: {
        lookup: () => Promise.resolve(PUBLIC_IP),
        fetchFn: (url) => Promise.resolve(okResponse(url, '{"kty":"EC"}')),
      },
    });
    assert.equal(fetched.url, "https://keys.example.com/k1.jwk");
    assert.equal(fetched.text, '{"kty":"EC"}');
    // DNS-private key host fails closed inside the fetch, not the guard.
    await assert.rejects(() =>
      fetchCardKeyBytes("k1", {
        urlForKid: () => "https://keys.example.com/k1.jwk",
        fetch: {
          lookup: () => Promise.resolve("10.9.9.9"),
          fetchFn: (url) => Promise.resolve(okResponse(url)),
        },
      })
    );
    // Revocation fails before any fetch happens.
    let called = false;
    await assert.rejects(() =>
      fetchCardKeyBytes("k1", {
        urlForKid: () => "https://keys.example.com/k1.jwk",
        policy: { isRevoked: () => true },
        fetch: {
          lookup: () => Promise.resolve(PUBLIC_IP),
          fetchFn: (url) => {
            called = true;
            return Promise.resolve(okResponse(url));
          },
        },
      })
    );
    assert.equal(called, false);
  });
});

describe("host network duties — OIDC production cut (ticket 11)", () => {
  it("production allows redirect_uri only; x509/DID/attestation cut", () => {
    assert.deepEqual(PRODUCTION_OID4VP_PREFIXES.allowed, ["redirect_uri"]);
    assert.equal(
      parseClientIdProduction("redirect_uri:https://v.example.com/cb").prefix,
      "redirect_uri"
    );
    for (const cut of [
      "x509_san_dns:verifier.example.com",
      "x509_hash:abc123",
      "decentralized_identifier:did:example:123",
      "verifier_attestation:opaque-token",
      "openid_federation:https://fed.example.com",
    ]) {
      assert.throws(() => parseClientIdProduction(cut), cut);
    }
    assert.throws(() =>
      parseClientIdProduction("redirect_uri:http://v.example.com/cb")
    );
    assert.throws(() =>
      parseClientIdProduction("redirect_uri:https://v.example.com/cb#frag")
    );
  });

  it("cut is production-default with an explicit opt-out", () => {
    const x509Request = {
      response_type: "vp_token",
      client_id: "x509_san_dns:verifier.example.com",
      response_mode: "direct_post",
      nonce: "0123456789abcdef",
      dcql_query: {
        credentials: [{ id: "c", format: "dc+sd-jwt", claims: [] }],
      },
    };
    // Default: cut even when the deployment pin would allow the prefix.
    assert.throws(() =>
      requestToDisclosureDemand(x509Request, {
        allowed: ["x509_san_dns", "redirect_uri"] as const,
      })
    );
    // Escape hatch: host states unverified prefixes are its own verified duty.
    assert.ok(
      requestToDisclosureDemand(
        x509Request,
        { allowed: ["x509_san_dns", "redirect_uri"] as const },
        { allowUnverifiedClientIdPrefixes: true }
      )
    );
  });

  it("production still cuts mdoc, nested DCQL, and claim_sets", () => {
    const base = {
      response_type: "vp_token",
      client_id: "redirect_uri:https://v.example.com/cb",
      response_mode: "direct_post",
      nonce: "0123456789abcdef",
      dcql_query: {
        credentials: [{ id: "c", format: "dc+sd-jwt", claims: [] }],
      },
    };
    assert.ok(requestToDisclosureDemand(base, PRODUCTION_OID4VP_PREFIXES));
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          ...base,
          dcql_query: {
            credentials: [{ id: "c", format: "mso_mdoc", claims: [] }],
          },
        },
        PRODUCTION_OID4VP_PREFIXES
      )
    );
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          ...base,
          dcql_query: {
            credentials: [
              {
                id: "c",
                format: "dc+sd-jwt",
                claims: [{ path: ["address", "street"] }],
              },
            ],
          },
        },
        PRODUCTION_OID4VP_PREFIXES
      )
    );
    assert.throws(() =>
      requestToDisclosureDemand(
        {
          ...base,
          dcql_query: {
            credentials: [{ id: "c", format: "dc+sd-jwt", claims: [] }],
            claim_sets: [[{ id: "c" }]],
          },
        },
        PRODUCTION_OID4VP_PREFIXES
      )
    );
  });
});
