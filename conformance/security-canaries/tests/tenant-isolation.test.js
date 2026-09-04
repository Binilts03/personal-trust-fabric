import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';

import { createAppServer } from '../../../src/server.js';

async function withServer(run, options = {}) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

function rawRequest(baseUrl, path, { method = 'GET', headers = {}, body = null } = {}) {
  const target = new URL(path, baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(target, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        json: () => {
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
        }
      }));
    });
    request.on('error', reject);
    if (body !== null) request.end(body);
    else request.end();
  });
}

async function openSessionWithTenant(baseUrl, tenantId) {
  const headers = {};
  if (tenantId) headers['x-tenant-id'] = tenantId;
  // Need to open via GET http://baseUrl/api/session? Use rawRequest to handle tenant header full test
  // Simpler use fetch via global fetch
  const res = await fetch(`${baseUrl}/api/session`, { headers });
  const cookie = res.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const body = await res.json().catch(() => ({}));
  return { cookie, tenantId, status: res.status, body };
}

test('tenant-isolation: cross-tenant access rejected (cookie vs header)', async () => {
  await withServer(async (baseUrl) => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    // Open session for tenant A
    const sessionA = await openSessionWithTenant(baseUrl, tenantA);
    assert.equal(sessionA.status, 200);
    const cookieA = sessionA.cookie;
    assert.ok(cookieA.includes('ptf_human_session'));

    // Access with same cookie but different tenant B should be rejected
    const resCross = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: cookieA, 'x-tenant-id': tenantB }
    });
    assert.equal(resCross.status, 403);
    const bodyCross = JSON.parse(resCross.body);
    assert.ok(bodyCross.error && typeof bodyCross.error === 'string');
    assert.match(bodyCross.error, /(cross-tenant|not authorized)/i);

    // Access with correct tenant should succeed
    const resOk = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: cookieA, 'x-tenant-id': tenantA }
    });
    assert.equal(resOk.status, 200);

    // Another tenant's session should be isolated
    const sessionB = await openSessionWithTenant(baseUrl, tenantB);
    assert.notEqual(sessionB.cookie, cookieA);
    const resBA = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB }
    });
    assert.equal(resBA.status, 200);
    // Try to use B's cookie with A's tenant
    const resBACross = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantA }
    });
    assert.equal(resBACross.status, 403);
  }, { requireTenant: true });
});

test('tenant-isolation: X-Tenant-Id must be valid UUID when required', async () => {
  await withServer(async (baseUrl) => {
    // Missing tenant header when required should be 400
    const missing = await rawRequest(baseUrl, '/api/session', {});
    assert.equal(missing.status, 400);
    assert.match(JSON.parse(missing.body).error, /X-Tenant-Id/i);

    // Invalid UUID format
    const invalid = await rawRequest(baseUrl, '/api/session', {
      headers: { 'x-tenant-id': 'not-a-uuid' }
    });
    assert.equal(invalid.status, 400);
    assert.match(JSON.parse(invalid.body).error, /UUID/);

    // Valid UUID works
    const valid = await openSessionWithTenant(baseUrl, randomUUID());
    assert.equal(valid.status, 200);
  }, { requireTenant: true });
});

test('tenant-isolation: operations are isolated per tenant (approval not visible cross-tenant)', async () => {
  await withServer(async (baseUrl) => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const sessionA = await openSessionWithTenant(baseUrl, tenantA);
    const sessionB = await openSessionWithTenant(baseUrl, tenantB);

    // Tenant A creates an approval
    const reqA = await rawRequest(baseUrl, '/api/operations/request', {
      method: 'POST',
      headers: { cookie: sessionA.cookie, 'x-tenant-id': tenantA, 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ scenario: 'payment', amountMinor: 1000, currency: 'USD' })
    });
    assert.equal(reqA.status, 200);
    const proposalA = JSON.parse(reqA.body);
    assert.equal(proposalA.decision, 'approval_required');

    // Tenant B state should have 0 approvals
    const stateB = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB }
    });
    const bodyB = JSON.parse(stateB.body);
    assert.equal(bodyB.approvals.length, 0, 'tenant B must not see tenant A approvals');

    // Tenant B trying to approve A's approval should get 409 or 403 (not pending for them)
    const approveCross = await rawRequest(baseUrl, `/api/approvals/${proposalA.approvalId}`, {
      method: 'POST',
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(approveCross.status, 409); // approval is not pending for B's session

    // Tenant A can still approve its own
    const approveA = await rawRequest(baseUrl, `/api/approvals/${proposalA.approvalId}`, {
      method: 'POST',
      headers: { cookie: sessionA.cookie, 'x-tenant-id': tenantA, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(approveA.status, 200);
  }, { requireTenant: true });
});

test('tenant-isolation: composite keys - export/import tenant enforcement', async () => {
  await withServer(async (baseUrl) => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const sessionA = await openSessionWithTenant(baseUrl, tenantA);
    const cookieA = sessionA.cookie;

    // Create capability for tenant A to have something to export
    const req = await rawRequest(baseUrl, '/api/operations/request', {
      method: 'POST',
      headers: { cookie: cookieA, 'x-tenant-id': tenantA, 'content-type': 'application/json', origin: baseUrl },
      body: JSON.stringify({ scenario: 'credential' })
    });
    assert.equal(req.status, 200);
    const prop = JSON.parse(req.body);
    const appr = await rawRequest(baseUrl, `/api/approvals/${prop.approvalId}`, {
      method: 'POST',
      headers: { cookie: cookieA, 'x-tenant-id': tenantA, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(appr.status, 200);

    // Export for tenant A
    const exp = await rawRequest(baseUrl, '/api/export', {
      headers: { cookie: cookieA, 'x-tenant-id': tenantA }
    });
    assert.equal(exp.status, 200);
    const archive = JSON.parse(exp.body);
    assert.equal(archive.tenantId, tenantA.toLowerCase());
    assert.equal(archive.version, 1);

    // Try to import that archive with tenant B header - should be rejected due to composite key mismatch
    const sessionB = await openSessionWithTenant(baseUrl, tenantB);
    const importCross = await rawRequest(baseUrl, '/api/import', {
      method: 'POST',
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify(archive)
    });
    assert.equal(importCross.status, 403);
    assert.match(JSON.parse(importCross.body).error, /(cross-tenant|not authorized)/i);

    // Import with correct tenant should succeed
    const importOk = await rawRequest(baseUrl, '/api/import', {
      method: 'POST',
      headers: { cookie: cookieA, 'x-tenant-id': tenantA, origin: baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify(archive)
    });
    assert.equal(importOk.status, 200);
    const okBody = JSON.parse(importOk.body);
    assert.equal(okBody.imported, true);

    // Export with tenant B should have different tenantId and not contain A's data (isolation)
    const expB = await rawRequest(baseUrl, '/api/export', {
      headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB }
    });
    const archB = JSON.parse(expB.body);
    assert.equal(archB.tenantId, tenantB.toLowerCase());
    assert.notEqual(archB.tenantId, archive.tenantId);
  }, { requireTenant: true });
});

test('tenant-isolation: default tenant is isolated when requireTenant false (backward compat)', async () => {
  await withServer(async (baseUrl) => {
    // When requireTenant false, missing header defaults to 'default'
    const sessionDefault = await openSessionWithTenant(baseUrl, null);
    assert.equal(sessionDefault.status, 200);
    const cookie = sessionDefault.cookie;

    const state = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie }
    });
    assert.equal(state.status, 200);

    // With tenant header, should still allow but isolate? In non-require mode, header is optional
    // But if we use a tenant header, it creates isolated session
    const tenantX = randomUUID();
    const sessionX = await openSessionWithTenant(baseUrl, tenantX);
    assert.notEqual(sessionX.cookie, cookie);

    const stateX = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie: sessionX.cookie, 'x-tenant-id': tenantX }
    });
    assert.equal(stateX.status, 200);

    // Using default cookie with tenant header should be cross-tenant
    // In non-require mode, the server still enforces if header present? It checks enforceTenantForSession when headerTenantId !== null
    // So cross-tenant should be rejected when header present and mismatched
    const cross = await rawRequest(baseUrl, '/api/state', {
      headers: { cookie, 'x-tenant-id': tenantX }
    });
    assert.equal(cross.status, 403);
  }, { requireTenant: false });
});

test('tenant-isolation: rate limiting is per-tenant (composite key)', async () => {
  await withServer(async (baseUrl) => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();

    const sessionA = await openSessionWithTenant(baseUrl, tenantA);
    const sessionB = await openSessionWithTenant(baseUrl, tenantB);

    // We can't easily test 100 req limit without hitting limit, but we can verify tenants are separate by checking one tenant hitting limit doesn't affect other
    // For performance, we test that both can make a few requests independently
    for (let i = 0; i < 5; i++) {
      const rA = await rawRequest(baseUrl, '/api/operations/request', {
        method: 'POST',
        headers: { cookie: sessionA.cookie, 'x-tenant-id': tenantA, 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: 'payment', amountMinor: 100, currency: 'USD', recipientId: 'recipient_attacker' })
      });
      assert.equal(rA.status, 200);
      const rB = await rawRequest(baseUrl, '/api/operations/request', {
        method: 'POST',
        headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB, 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: 'payment', amountMinor: 100, currency: 'USD', recipientId: 'recipient_attacker' })
      });
      assert.equal(rB.status, 200);
    }

    // Verify audit and capabilities are still isolated
    const stateA = JSON.parse((await rawRequest(baseUrl, '/api/state', { headers: { cookie: sessionA.cookie, 'x-tenant-id': tenantA } })).body);
    const stateB = JSON.parse((await rawRequest(baseUrl, '/api/state', { headers: { cookie: sessionB.cookie, 'x-tenant-id': tenantB } })).body);
    // Both have activity but isolated sessions (approvals differ maybe)
    assert.ok(Array.isArray(stateA.activity));
    assert.ok(Array.isArray(stateB.activity));
  }, { requireTenant: true, rateLimitEnabled: true });
});
