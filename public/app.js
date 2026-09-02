import { registerWebMCPTools } from './webmcp.js';

const app = document.querySelector('#app');
let announcement = '';

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result;
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function render(state, webmcpReady) {
  app.innerHTML = `
    <p class="visually-hidden" role="status" aria-live="polite">${escapeText(announcement)}</p>
    <header class="masthead">
      <a class="wordmark" href="#top" aria-label="Personal Trust Fabric home"><span>PTF</span> Personal Trust Fabric</a>
      <div class="runtime-status"><i aria-hidden="true"></i> ${webmcpReady ? 'WebMCP tools live' : 'Human interface mode'}</div>
    </header>

    <section class="thesis" id="top">
      <p class="eyebrow">Authority without exposure</p>
      <h1>Your agent can act.<br><em>It does not get the secret.</em></h1>
      <p class="lede">PTF keeps planning in the open and protected execution behind deterministic policy, concrete human approval, and recipient-bound capabilities.</p>
      <div class="assurance">${escapeText(state.assuranceLabel)}</div>
    </section>

    <section class="conduit" aria-label="Trust boundary overview">
      <article>
        <p class="plane-label">Agent plane</p>
        <h2>What the agent sees</h2>
        <ul>
          ${state.safeView.persona.map((claim) => `<li><span>${escapeText(claim.key)}</span><strong>${escapeText(claim.value)}</strong></li>`).join('')}
          <li><span>Capability classes</span><strong>${state.safeView.availableCapabilityTypes.length} available</strong></li>
        </ul>
      </article>
      <div class="gate" aria-label="Deterministic trust gate">
        <span>Request</span><b>POLICY<br>GATE</b><span>Receipt</span>
      </div>
      <article>
        <p class="plane-label">Confidential plane</p>
        <h2>What PTF keeps protected</h2>
        <ul>
          ${state.protectedResources.map((resource) => `<li><span>${escapeText(resource.type)}</span><strong>${escapeText(resource.handling)}</strong></li>`).join('')}
        </ul>
      </article>
    </section>

    <section class="workspace">
      <nav class="rail" aria-label="PTF sections">
        <a class="active" href="#approvals">Approvals <span>${state.approvals.length}</span></a>
        <a href="#persona">Persona <span>${state.personaClaims.length}</span></a>
        <a href="#policies">Policies <span>${state.policies.length}</span></a>
        <a href="#resources">Protected resources <span>${state.protectedResources.length}</span></a>
        <a href="#activity">Activity <span>${state.activity.length}</span></a>
      </nav>
      <div class="panels">
        <section class="panel" id="approvals">
          <div class="panel-heading"><div><p class="eyebrow">Human authority</p><h2>Pending approvals</h2></div><button class="quiet" data-action="reset">Reset sandbox</button></div>
          ${state.approvals.length === 0 ? `<div class="empty"><p>No pending requests. Ask a WebMCP agent, or simulate the same request here.</p><div class="demo-actions"><button class="quiet" data-action="request-credential">Simulate membership proof request</button><button class="quiet" data-action="request-payment">Simulate $42.50 payment request</button><button class="deny" data-action="request-attack">Run recipient redirect attack</button></div></div>` : state.approvals.map((approval) => `
            <article class="approval-card">
              <div><span class="operation-chip">${escapeText(approval.operationType.replace('_', ' '))}</span><h3>${escapeText(approval.displayedTerms.action)} protected resource</h3></div>
              <dl>
                <div><dt>Recipient</dt><dd>${escapeText(approval.recipientLabel)} · ${escapeText(approval.displayedTerms.recipientId)}</dd></div>
                <div><dt>Protected resource</dt><dd>${escapeText(approval.displayedTerms.resourceId)}</dd></div>
                <div><dt>Purpose</dt><dd>${escapeText(approval.displayedTerms.purpose)}</dd></div>
                <div><dt>Disclosure</dt><dd>${escapeText(approval.disclosure.mode.replaceAll('_', ' '))}</dd></div>
                <div><dt>Transaction</dt><dd>${escapeText(approval.displayedTerms.transactionId)}</dd></div>
                <div><dt>Authority</dt><dd>${escapeText(approval.displayedTerms.requestedUses)} use · expires after ${escapeText(approval.displayedTerms.validForSeconds / 60)} minutes</dd></div>
                <div><dt>Recipient authentication</dt><dd>${escapeText(approval.recipientAssurance)}</dd></div>
                <div><dt>Request provenance</dt><dd>${escapeText(approval.displayedTerms.agentId)} · ${escapeText(approval.displayedTerms.taskId)}</dd></div>
                <div><dt>Bound-terms digest</dt><dd>${escapeText(approval.proposalDigest)}</dd></div>
                ${approval.displayedTerms.claimIds.length === 0 ? '' : `<div><dt>Claim scope</dt><dd>${approval.displayedTerms.claimIds.map(escapeText).join(', ')}</dd></div>`}
                ${approval.displayedTerms.amountMinor === null ? '' : `<div><dt>Amount</dt><dd>$${(approval.displayedTerms.amountMinor / 100).toFixed(2)} ${escapeText(approval.displayedTerms.currency)}</dd></div>`}
              </dl>
              <div class="approval-actions"><button class="deny" data-decision="denied" data-approval="${escapeText(approval.id)}">Deny</button><button class="approve" data-decision="approved" data-approval="${escapeText(approval.id)}">Approve exact terms</button></div>
            </article>`).join('')}
        </section>

        <section class="panel split" id="persona">
          <div><p class="eyebrow">Human-correctable state</p><h2>Agent-safe persona</h2><p class="section-note">Only confirmed, task-relevant, shareable claims appear here. A correction supersedes the old claim; it never changes policy authority.</p></div>
          <div class="persona-rows">${state.personaClaims.map((claim) => `
            <form class="persona-row" data-claim-form="${escapeText(claim.id)}">
              <label for="claim-${escapeText(claim.id)}">${escapeText(claim.key)}</label>
              <div><input id="claim-${escapeText(claim.id)}" name="value" value="${escapeText(claim.value)}" required><button class="quiet" type="submit">Confirm correction</button></div>
              <small>${escapeText(claim.status)} · ${escapeText(claim.modelVisibility)} · confidence ${escapeText(claim.confidence)} · ${escapeText(claim.provenance.at(-1).kind)} by ${escapeText(claim.provenance.at(-1).source.type)}</small>
              ${claim.supersedes ? `<small>Supersedes ${escapeText(claim.supersedes)}</small>` : ''}
            </form>`).join('')}</div>
        </section>

        <section class="panel split" id="policies">
          <div><p class="eyebrow">Deterministic rules</p><h2>Active policy</h2></div>
          <div class="rows">${state.policies.map((policy) => `<div class="row"><strong>${escapeText(policy.id)}</strong><p>${escapeText(policy.summary)}</p></div>`).join('')}</div>
        </section>

        <section class="panel split" id="resources">
          <div><p class="eyebrow">Use, don't reveal</p><h2>Protected resources</h2></div>
          <div class="rows">${state.protectedResources.map((resource) => `<div class="row"><strong>${escapeText(resource.id)}</strong><p>${escapeText(resource.type)} · ${escapeText(resource.handling)} · ${escapeText(resource.status)}</p></div>`).join('')}</div>
        </section>

        <section class="panel" id="activity">
          <div class="panel-heading"><div><p class="eyebrow">Safe receipts</p><h2>Activity</h2><p class="section-note">In-memory, unkeyed chain: consistency evidence for this run, not tamper-proof storage.</p></div><span class="no-secret">${state.auditIntegrity ? 'Chain consistent' : 'Integrity check failed'}</span></div>
          ${state.activity.length === 0 ? '<p class="empty">Activity appears here after a request, denial, approval, execution, or correction.</p>' : `<div class="timeline">${state.activity.map((event) => `<div><time>${escapeText(new Date(event.at).toLocaleTimeString())}</time><p><strong>${escapeText(event.operationType ?? event.type)}</strong><small>${escapeText(event.purpose)} · ${escapeText(event.recipientId)} · ${escapeText(event.correlationId)}</small></p><span>${escapeText(event.outcome)}</span></div>`).join('')}</div>`}
        </section>
      </div>
    </section>
  `;
}

async function refresh(webmcpReady = document.documentElement.dataset.webmcp === 'ready') {
  render(await api('/api/state'), webmcpReady);
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (!button.dataset.action && !button.dataset.approval) return;
  button.disabled = true;
  try {
    if (button.dataset.action === 'reset') await api('/api/reset', {});
    if (button.dataset.action === 'request-credential') await api('/api/operations/request', { scenario: 'credential' });
    if (button.dataset.action === 'request-payment') await api('/api/operations/request', { scenario: 'payment', amountMinor: 4250, currency: 'USD' });
    if (button.dataset.action === 'request-attack') await api('/api/operations/request', { scenario: 'payment', amountMinor: 4250, currency: 'USD', recipientId: 'recipient_attacker' });
    if (button.dataset.approval) await api(`/api/approvals/${button.dataset.approval}`, { decision: button.dataset.decision });
    announcement = button.dataset.approval ? `Operation ${button.dataset.decision}.` : 'Sandbox state updated.';
    await refresh();
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-claim-form]');
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const value = new FormData(form).get('value');
    await api(`/api/persona/${form.dataset.claimForm}/correct`, { value, confidence: 1 });
    announcement = 'Persona claim corrected. The previous claim was superseded.';
    await refresh();
  } catch (error) {
    button.disabled = false;
    window.alert(error.message);
  }
});

window.addEventListener('ptf-state-changed', () => refresh());
const webmcpReady = await registerWebMCPTools();
document.documentElement.dataset.webmcp = webmcpReady ? 'ready' : 'unavailable';
await refresh(webmcpReady);
