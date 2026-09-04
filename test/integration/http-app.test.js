import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createAppServer } from '../../src/server.js';

function fixedRecipientSecret(label) {
  return createHmac('sha256', Buffer.from('ptf_recipient_seed_v1')).update(label).digest();
}
function generateRecipientAuthToken(reference, recipientId) {
  const secretMap = {
    recipient_verifier_a: fixedRecipientSecret('verifier_a_secret'),
    recipient_merchant_b: fixedRecipientSecret('merchant_b_secret'),
    recipient_signer_c: fixedRecipientSecret('signer_c_secret'),
    recipient_account_d: fixedRecipientSecret('account_d_secret'),
    recipient_attacker: fixedRecipientSecret('attacker_secret')
  };
  const secret = secretMap[recipientId];
  if (!secret) throw new Error(`unknown recipient ${recipientId}`);
  return createHmac('sha256', secret).update(reference).digest('hex');
}

async function withServer(run, options) {
  const server = createAppServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

async function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function openHumanSession(baseUrl) {
  const response = await fetch(baseUrl);
  return {
    cookie: response.headers.get('set-cookie').split(';', 1)[0],
    origin: baseUrl
  };
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
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    request.on('error', reject);
    if (body !== null) request.end(body);
    else request.end();
  });
}

test('HTTP sandbox exposes safe state and human approval executes through server-held recipient proof', async () => {
  await withServer(async (baseUrl) => {
    const unauthenticatedState = await fetch(`${baseUrl}/api/state`);
    assert.equal(unauthenticatedState.status, 403);
    const session = await openHumanSession(baseUrl);
    const humanHeaders = { cookie: session.cookie, origin: session.origin };
    const state = await (await fetch(`${baseUrl}/api/state`, { headers: humanHeaders })).json();
    assert.equal(state.profile, 'synthetic_sandbox');
    assert.equal(JSON.stringify(state).includes('PTF_CANARY_'), false);

    const requestResponse = await post(baseUrl, '/api/operations/request', {
      scenario: 'payment',
      amountMinor: 4250,
      currency: 'USD'
    }, humanHeaders);
    assert.equal(requestResponse.status, 200);
    const proposal = await requestResponse.json();
    assert.equal(proposal.decision, 'approval_required');

    const unauthenticatedApproval = await post(baseUrl, `/api/approvals/${proposal.approvalId}`, {
      decision: 'approved'
    });
    assert.equal(unauthenticatedApproval.status, 403);

    const reboundApproval = await post(baseUrl, `/api/approvals/${proposal.approvalId}`, {
      decision: 'approved'
    }, { cookie: session.cookie, origin: 'http://attacker.test', host: 'attacker.test' });
    assert.equal(reboundApproval.status, 403);

    const approvalResponse = await post(baseUrl, `/api/approvals/${proposal.approvalId}`, {
      decision: 'approved'
    }, humanHeaders);
    assert.equal(approvalResponse.status, 200);
    const approvalJson = await approvalResponse.json();
    // New independent redemption: decide returns operationReference, receipt is null until redeem
    assert.equal(approvalJson.decision, 'approved');
    assert.ok(approvalJson.operationReference, 'operationReference should exist');
    // Attempt attacker redemption should fail (independent auth)
    const attackerRedeem = await post(baseUrl, `/api/capabilities/${approvalJson.operationReference}/redeem`, {
      recipientId: 'recipient_merchant_b',
      recipientAuthToken: generateRecipientAuthToken(approvalJson.operationReference, 'recipient_attacker')
    }, humanHeaders);
    assert.equal(attackerRedeem.status, 403);
    // Legitimate recipient redemption with correct token should succeed and prove protected execution
    const redeemResponse = await post(baseUrl, `/api/capabilities/${approvalJson.operationReference}/redeem`, {
      recipientId: 'recipient_merchant_b',
      recipientAuthToken: generateRecipientAuthToken(approvalJson.operationReference, 'recipient_merchant_b')
    }, humanHeaders);
    assert.equal(redeemResponse.status, 200);
    const completion = await redeemResponse.json();
    assert.equal(completion.receipt.outcome, 'paid');
    assert.equal(JSON.stringify(completion).includes('PTF_CANARY_'), false);
    // Second redeem should fail - capability is single-use (consumed)
    const secondRedeem = await post(baseUrl, `/api/capabilities/${approvalJson.operationReference}/redeem`, {
      recipientId: 'recipient_merchant_b',
      recipientAuthToken: generateRecipientAuthToken(approvalJson.operationReference, 'recipient_merchant_b')
    }, humanHeaders);
    assert.equal(secondRedeem.status, 403);

    const replay = await post(baseUrl, `/api/approvals/${proposal.approvalId}`, {
      decision: 'approved'
    }, humanHeaders);
    assert.equal(replay.status, 409);

    const redirected = await post(baseUrl, '/api/operations/request', {
      scenario: 'payment',
      amountMinor: 4250,
      currency: 'USD',
      recipientId: 'recipient_attacker'
    }, humanHeaders);
    assert.deepEqual(await redirected.json(), {
      decision: 'deny',
      reason: 'no matching allow policy',
      policyIds: []
    });

    const finalState = await (await fetch(`${baseUrl}/api/state`, { headers: humanHeaders })).json();
    assert.equal(finalState.auditIntegrity, true);
    assert.equal(finalState.activity.some((event) => event.outcome === 'paid'), true);
    assert.equal(JSON.stringify(finalState.activity).includes('PTF_CANARY_'), false);
  });
});

test('API session bootstrap supports static hosts and remains idempotent', async () => {
  await withServer(async (baseUrl) => {
    const first = await fetch(`${baseUrl}/api/session`);
    assert.equal(first.status, 200);
    const cookie = first.headers.get('set-cookie').split(';', 1)[0];
    assert.equal((await first.json()).profile, 'synthetic_sandbox');

    const second = await fetch(`${baseUrl}/api/session`, { headers: { cookie } });
    assert.equal(second.headers.get('set-cookie').split(';', 1)[0], cookie);
  });
});

test('HTTP boundary rejects unknown fields and exposes an explicit Human persona correction', async () => {
  await withServer(async (baseUrl) => {
    const session = await openHumanSession(baseUrl);
    const humanHeaders = { cookie: session.cookie, origin: session.origin };
    const invalid = await post(baseUrl, '/api/operations/request', {
      scenario: 'payment',
      amountMinor: 4250,
      currency: 'USD',
      smuggledRecipient: 'recipient_attacker'
    }, humanHeaders);
    assert.equal(invalid.status, 400);

    const before = await (await fetch(`${baseUrl}/api/state`, { headers: humanHeaders })).json();
    const budget = before.personaClaims.find((claim) => claim.key === 'purchase.budget_band');
    assert.equal(budget.value, 'moderate');

    const unauthenticatedCorrection = await post(baseUrl, `/api/persona/${budget.id}/correct`, {
      value: 'conservative',
      confidence: 1
    });
    assert.equal(unauthenticatedCorrection.status, 403);
    const correction = await post(baseUrl, `/api/persona/${budget.id}/correct`, {
      value: 'conservative',
      confidence: 1
    }, humanHeaders);
    assert.equal(correction.status, 200);

    const after = await (await fetch(`${baseUrl}/api/state`, { headers: humanHeaders })).json();
    assert.equal(after.safeView.persona.find((claim) => claim.key === budget.key).value, 'conservative');
    assert.equal(after.personaClaims.some((claim) => claim.id === budget.id), false);
    assert.equal(after.personaClaims[0].supersedes, budget.id);
    assert.equal(after.activity.some((event) => event.purpose === 'correct_persona' && event.outcome === 'corrected'), true);
    assert.equal(JSON.stringify(after).includes('PTF_CANARY_'), false);
  });
});

test('top-level page loads an imperative WebMCP adapter with strict schemas', async () => {
  await withServer(async (baseUrl) => {
    const session = await openHumanSession(baseUrl);
    const page = await (await fetch(baseUrl)).text();
    const adapter = await (await fetch(`${baseUrl}/webmcp.js`)).text();

    assert.match(page, /Personal Trust Fabric/);
    assert.match(adapter, /document\.modelContext\.registerTool/);
    assert.match(adapter, /additionalProperties:\s*false/);

    const agentView = await (await fetch(`${baseUrl}/api/agent-view`, {
      headers: { cookie: session.cookie }
    })).json();
    assert.deepEqual(Object.keys(agentView).sort(), ['assuranceLabel', 'safeView']);
    assert.equal(JSON.stringify(agentView).includes('approvalId'), false);
  });
});

test('browser sessions isolate pending approvals and Human authority', async () => {
  await withServer(async (baseUrl) => {
    const visitorA = await openHumanSession(baseUrl);
    const visitorB = await openHumanSession(baseUrl);
    assert.notEqual(visitorA.cookie, visitorB.cookie);

    const proposal = await (await post(baseUrl, '/api/operations/request', {
      scenario: 'payment',
      amountMinor: 4250,
      currency: 'USD'
    }, { cookie: visitorA.cookie })).json();

    const visitorBApproval = await post(baseUrl, `/api/approvals/${proposal.approvalId}`, {
      decision: 'approved'
    }, { cookie: visitorB.cookie, origin: baseUrl });
    assert.equal(visitorBApproval.status, 409);

    const stateA = await (await fetch(`${baseUrl}/api/state`, {
      headers: { cookie: visitorA.cookie }
    })).json();
    const stateB = await (await fetch(`${baseUrl}/api/state`, {
      headers: { cookie: visitorB.cookie }
    })).json();
    assert.equal(stateA.approvals.length, 1);
    assert.equal(stateB.approvals.length, 0);
  });
});

test('hosted profile marks the Human session cookie Secure', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    assert.match(response.headers.get('set-cookie'), /; Secure$/);
  }, { publicOrigin: 'HTTPS://ptf.example' });
});

test('hosted Vercel aliases bind mutations to the request origin', async () => {
  await withServer(async (baseUrl) => {
    const host = 'ptf-preview.vercel.app';
    const sessionResponse = await rawRequest(baseUrl, '/api/session', { headers: { host } });
    const cookie = sessionResponse.headers['set-cookie'][0].split(';', 1)[0];
    assert.match(sessionResponse.headers['set-cookie'][0], /; Secure$/);

    const reset = await rawRequest(baseUrl, '/api/reset', {
      method: 'POST',
      body: '{}',
      headers: {
        'content-type': 'application/json',
        'content-length': 2,
        cookie,
        host,
        origin: `https://${host}`
      }
    });
    assert.equal(reset.status, 200);
  }, { hosted: true });
});

test('hosted profile rejects an untrusted request host', async () => {
  await withServer(async (baseUrl) => {
    const response = await rawRequest(baseUrl, '/api/session', {
      headers: { host: 'attacker.test' }
    });
    assert.equal(response.status, 403);
  }, { hosted: true });
});

test('hosted profile rejects a non-HTTPS public origin', () => {
  assert.throws(
    () => createAppServer({ publicOrigin: 'http://ptf.example' }),
    /PUBLIC_ORIGIN must use HTTPS/
  );
});

test('browser session bounds agent requests until Human reset', async () => {
  await withServer(async (baseUrl) => {
    const session = await openHumanSession(baseUrl);
    const headers = { cookie: session.cookie };
    for (let index = 0; index < 100; index += 1) {
      const response = await post(baseUrl, '/api/operations/request', {
        scenario: 'payment',
        amountMinor: 4250,
        currency: 'USD',
        recipientId: 'recipient_attacker'
      }, headers);
      assert.equal(response.status, 200);
    }
    const limited = await post(baseUrl, '/api/operations/request', {
      scenario: 'payment',
      amountMinor: 4250,
      currency: 'USD',
      recipientId: 'recipient_attacker'
    }, headers);
    assert.equal(limited.status, 400);
  });
});
