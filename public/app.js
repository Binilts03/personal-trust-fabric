import { registerWebMCPTools } from './webmcp.js';

const app = document.querySelector('#app');
let announcement = '';
let webmcpReadyFlag = false;
let currentState = null;
let currentCapabilities = [];
let currentAudit = { records: [], integrity: true };
let currentPoliciesFull = [];
let toasts = [];
let pollTimer = null;
let simulateResult = null;
let lastApprovalId = null;

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result;
}

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[ch]);
}

function ensureToastContainer() {
  let el = document.querySelector('.toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-stack';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'false');
    document.body.appendChild(el);
  }
  return el;
}

function showToast(message, type = 'info', timeout = 3400) {
  const container = ensureToastContainer();
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', 'status');
  toast.dataset.toastId = id;
  toast.textContent = String(message);
  container.appendChild(toast);
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(4px)';
    window.setTimeout(() => toast.remove(), 220);
  }, timeout);
}

function formatExpiry(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'expired';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s left`;
}

function shortRef(ref) {
  if (!ref) return '—';
  const s = String(ref);
  return s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function getBudgetClaim(claims) {
  return claims.find((c) => c.key === 'purchase.budget_band') || claims[0] || null;
}

async function fetchCombined() {
  const state = await api('/api/state');
  let caps = { capabilities: [] };
  let audit = { records: [], integrity: true };
  let policies = { policies: [] };
  try { caps = await api('/api/capabilities'); } catch {}
  try { audit = await api('/api/audit'); } catch {}
  try { policies = await api('/api/policies'); } catch {}
  return {
    state,
    capabilities: Array.isArray(caps.capabilities) ? caps.capabilities : [],
    audit: audit && Array.isArray(audit.records) ? audit : { records: [], integrity: true, correlationId: null },
    policiesFull: Array.isArray(policies.policies) ? policies.policies : []
  };
}

function render(combined, webmcpReady) {
  const { state, capabilities, audit, policiesFull } = combined;
  currentState = state;
  currentCapabilities = capabilities;
  currentAudit = audit;
  currentPoliciesFull = policiesFull;
  webmcpReadyFlag = webmcpReady;
  const integrity = audit.integrity !== undefined ? audit.integrity : state.auditIntegrity;
  const profile = state.profile || 'synthetic_sandbox';
  const version = state.safeView?.version ?? 1;
  const approvedCapsCount = capabilities.length;
  const pendingCount = state.approvals.length;
  // devices simulated
  const devices = [
    { id: 'device_primary', name: 'This browser — Human session', detail: 'HttpOnly ptf_human_session · SameSite Strict', status: 'active', meta: 'now · loopback' },
    { id: 'device_synthetic_recovery', name: 'Synthetic recovery device', detail: 'Simulated second factor · not real custody', status: 'available', meta: 'simulated' },
    { id: 'device_audit_reader', name: 'Audit-only reader', detail: 'Read-only receipt view · no authority', status: 'standby', meta: 'simulated' }
  ];

  const budgetClaim = getBudgetClaim(state.personaClaims);

  // policies to display: prefer policiesFull (detailed) else state.policies
  const policiesDisplay = policiesFull.length > 0 ? policiesFull : state.policies;
  const auditRecords = audit.records && audit.records.length > 0 ? audit.records : state.activity.map((a, idx) => ({
    sequence: idx + 1,
    previousHash: '—',
    hash: '—',
    event: {
      eventType: a.type || a.eventType || 'action_completed',
      correlationId: a.correlationId || '—',
      outcome: a.outcome || '—',
      recipientId: a.recipientId || '—',
      purpose: a.purpose || '—',
      representation: a.representation || a.disclosure?.mode || '—',
      assurance: a.assurance || 'synthetic_sandbox',
      occurredAt: a.at || new Date().toISOString()
    }
  }));

  app.innerHTML = `
    <p class="visually-hidden" role="status" aria-live="polite">${escapeText(announcement)}</p>
    <header class="masthead">
      <a class="wordmark" href="#top" aria-label="Personal Trust Fabric home"><span>PTF</span> Personal Trust Fabric</a>
      <div class="runtime-status" data-ready="${webmcpReady ? 'true' : 'false'}"><i aria-hidden="true"></i> ${webmcpReady ? 'WebMCP tools live' : 'Human interface mode'}</div>
    </header>

    <section class="thesis" id="top">
      <p class="eyebrow">Authority without exposure · PTF home / status</p>
      <h1>Your agent can act.<br><em>It does not get the secret.</em></h1>
      <p class="lede">PTF keeps planning in the open and protected execution behind deterministic policy, concrete human approval, and recipient-bound capabilities. This dashboard renders every trust surface without a mobile or desktop app.</p>
      <div class="assurance">${escapeText(state.assuranceLabel)}</div>
      <dl class="status-grid" aria-label="PTF status">
        <div><dt>Profile</dt><dd>${escapeText(profile)}</dd></div>
        <div><dt>Version</dt><dd>v${escapeText(version)} · synthetic_sandbox</dd></div>
        <div><dt>Approval gate</dt><dd>${state.safeView?.approvalStatus || 'available'} · ${pendingCount} pending</dd></div>
        <div><dt>Assurance label</dt><dd style="font-size:11px;line-height:1.4">${escapeText(state.assuranceLabel)}</dd></div>
        <div><dt>WebMCP</dt><dd>${webmcpReady ? '4 tools registered' : 'human fallback · tools unavailable'}</dd></div>
        <div><dt>Audit integrity</dt><dd><span class="integrity-dot ${integrity ? 'ok' : 'fail'}" aria-hidden="true"></span> ${integrity ? 'Chain consistent' : 'Integrity check failed'}</dd></div>
      </dl>
    </section>

    <section class="conduit" aria-label="Trust boundary overview">
      <article>
        <p class="plane-label">Agent plane — safe context</p>
        <h2>What the agent sees</h2>
        <ul>
          ${state.safeView.persona.map((claim) => `<li><span>${escapeText(claim.key)}</span><strong>${escapeText(claim.value)}</strong></li>`).join('')}
          <li><span>Capability classes</span><strong>${state.safeView.availableCapabilityTypes.length} available</strong></li>
          <li><span>Contexts</span><strong>${escapeText((state.personaClaims[0]?.contexts || ['dashboard']).join(', '))}</strong></li>
        </ul>
      </article>
      <div class="gate" aria-label="Deterministic trust gate">
        <span>Request</span><b>POLICY<br>GATE</b><span>Receipt</span>
      </div>
      <article>
        <p class="plane-label">Confidential plane — protected resources</p>
        <h2>What PTF keeps protected</h2>
        <ul>
          ${state.protectedResources.map((resource) => `<li><span>${escapeText(resource.type)}</span><strong>${escapeText(resource.handling)}</strong></li>`).join('')}
        </ul>
      </article>
    </section>

    <section class="workspace">
      <nav class="rail" aria-label="PTF sections">
        <a href="#status" class="${''}">Status <span>1</span></a>
        <a href="#journeys">Journeys <span>7</span></a>
        <a href="#persona">Persona <span>${state.personaClaims.length}</span></a>
        <a href="#resources">Credentials <span>${state.protectedResources.length}</span></a>
        <a href="#policies">Policies <span>${policiesDisplay.length}</span></a>
        <a href="#approvals" class="active">Approvals <span>${pendingCount}</span></a>
        <a href="#capabilities">Capabilities <span>${approvedCapsCount}</span></a>
        <a href="#activity">Activity <span>${auditRecords.length}</span></a>
        <a href="#developer">Developer <span>∞</span></a>
        <a href="#devices">Devices <span>${devices.length}</span></a>
      </nav>
      <div class="panels">

        <section class="panel" id="status">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">PTF home / status</p>
              <h2>Synthetic sandbox status</h2>
              <p class="section-note">All data is synthetic. No real credential, payment instrument, or signing key is stored. Profile <code class="mono">${escapeText(profile)}</code> isolates capabilities to this origin and human session.</p>
            </div>
            <span class="badge ${integrity ? 'badge--success' : 'badge--danger'}"><span class="integrity-dot ${integrity ? 'ok' : 'fail'}" aria-hidden="true"></span> ${integrity ? 'Chain consistent · hash integrity ok' : 'Integrity check failed'}</span>
          </div>
          <dl>
            <div><dt>Assurance label</dt><dd>${escapeText(state.assuranceLabel)}</dd></div>
            <div><dt>Profile</dt><dd>${escapeText(profile)} · version ${escapeText(version)}</dd></div>
            <div><dt>Safe view</dt><dd>${escapeText(state.safeView.persona.length)} shareable claims · ${escapeText(state.safeView.availableCapabilityTypes.join(', '))}</dd></div>
            <div><dt>Protected resources</dt><dd>${escapeText(state.protectedResources.map(r=>r.id).join(', '))}</dd></div>
            <div><dt>Pending approvals</dt><dd>${pendingCount}</dd></div>
            <div><dt>Active capabilities</dt><dd>${approvedCapsCount} · revocation descendant-aware</dd></div>
          </dl>
        </section>

        <section class="panel" id="journeys">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Journeys · 4 protected flows</p>
              <h2>Request a protected action</h2>
              <p class="section-note">Each journey creates an approval that must be approved with exact terms. No protected value is returned to the agent or UI.</p>
            </div>
            <span class="badge badge--neutral">use, don't reveal</span>
          </div>
          <div class="journey-grid">
            <div class="journey-card">
              <strong>Request Membership Proof</strong>
              <p>Credential · predicate proof only · Verifier A</p>
              <button class="approve" data-action="request-credential">Request Membership Proof</button>
            </div>
            <div class="journey-card">
              <strong>Request $42.50 Payment</strong>
              <p>Payment · direct delivery · Merchant B · one use · 5 min</p>
              <button class="approve" data-action="request-payment">Request $42.50 Payment</button>
            </div>
            <div class="journey-card">
              <strong>Request Signing</strong>
              <p>Signing key · enclave only · Signer C · non-exporting</p>
              <button class="approve" data-action="request-signing">Request Signing</button>
            </div>
            <div class="journey-card">
              <strong>Request Bounded Action</strong>
              <p>Account · bounded write · Account D · one use</p>
              <button class="approve" data-action="request-action">Request Bounded Action</button>
            </div>
          </div>
          <div style="height:18px"></div>
          <div class="panel-heading" style="margin-bottom:12px">
            <div>
              <p class="eyebrow">Adversarial checks</p>
              <h2 style="font-size:18px">Deterministic denials</h2>
              <p class="section-note">Policy denies these without model refusal. Each should return <code class="mono">deny</code> and create no approval.</p>
            </div>
          </div>
          <div class="adversarial-grid">
            <button class="deny" data-action="request-attack">Run Recipient-Redirect Attack</button>
            <button class="deny" data-action="attack-replay">Run Replay Attack</button>
            <button class="deny" data-action="attack-mutation">Run Amount Mutation Attack</button>
          </div>
          <p style="margin:10px 0 0;color:var(--muted);font-size:12px;line-height:1.5">Redirect = attacker recipient id. Replay = re-approve same approval. Mutation = amount $99.99 &gt; policy limit $50. Also try WebMCP tool <code class="mono">attempt_recipient_redirect_attack</code> from a supported host.</p>
        </section>

        <section class="panel" id="persona">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Persona · safe-context view</p>
              <h2>Agent-safe persona</h2>
              <p class="section-note">Only confirmed, task-relevant, shareable claims appear to the agent. Correction supersedes the old claim and never changes policy authority.</p>
            </div>
            <span class="badge badge--neutral">${state.safeView.persona.length} shareable · ${state.personaClaims.length} confirmed</span>
          </div>

          <div style="display:grid;gap:16px">
            <div style="padding:14px;border:1px solid var(--line);background:var(--paper);border-radius:var(--radius-sm)">
              <div style="font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">Safe view projection (agent sees)</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${state.safeView.persona.length === 0 ? '<span class="pill">no shareable claims for this task</span>' : state.safeView.persona.map((c)=> `<span class="pill">${escapeText(c.key)} = ${escapeText(c.value)}</span>`).join('')}
              </div>
              <div style="margin-top:10px;color:var(--muted);font:600 11px ui-monospace,monospace">Contexts: dashboard · confidence tracked · provenance retained</div>
            </div>

            <div class="persona-rows">
              ${state.personaClaims.map((claim) => `
                <form class="persona-row" data-claim-form="${escapeText(claim.id)}" data-claim-key="${escapeText(claim.key)}">
                  <label for="claim-${escapeText(claim.id)}">${escapeText(claim.key)} ${claim.key === 'purchase.budget_band' ? '<span style="color:var(--blue);font:700 10px ui-monospace,monospace;margin-left:8px">← inline edit with confidence</span>' : ''}</label>
                  <div>
                    <input id="claim-${escapeText(claim.id)}" name="value" value="${escapeText(claim.value)}" required aria-label="${escapeText(claim.key)} value" style="min-width:160px">
                    <input name="confidence" type="number" min="0" max="1" step="0.1" value="${escapeText(claim.confidence)}" required aria-label="confidence" style="max-width:110px" title="confidence 0–1">
                    <button class="quiet" type="submit">Confirm correction</button>
                  </div>
                  <small>${escapeText(claim.status)} · ${escapeText(claim.modelVisibility)} · confidence ${escapeText(claim.confidence)} · contexts ${escapeText(claim.contexts.join(', '))} · ${escapeText(claim.provenance.at(-1).kind)} by ${escapeText(claim.provenance.at(-1).source.type)}</small>
                  ${claim.supersedes ? `<small>Supersedes ${escapeText(claim.supersedes)}</small>` : ''}
                  ${claim.key === 'purchase.budget_band' ? `<small style="color:var(--blue)">Editable example — change value and confidence then confirm. Previous claim will be superseded.</small>` : ''}
                </form>`).join('')}
            </div>

            ${budgetClaim ? `
            <div style="padding:12px 14px;border:1px solid #e9c78a;background:#fffbf2;border-radius:var(--radius-sm);font-size:12px;line-height:1.5;color:#70440d">
              <strong>Correction UI:</strong> Inline edit for <code class="mono">budget_band</code> with confidence slider. Submit to call <code class="mono">POST /api/persona/${escapeText(budgetClaim.id)}/correct</code> with <code class="mono">{ value, confidence }</code>. Server appends a safe <code class="mono">corrected</code> audit event without policy mutation.
            </div>` : ''}
          </div>
        </section>

        <section class="panel" id="resources">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Credentials · protected resources</p>
              <h2>Use, don't reveal</h2>
              <p class="section-note">Each resource maps to a capability type. PTF never returns the raw secret — only a proof, payment authorization, signature, or bounded-write receipt.</p>
            </div>
            <span class="badge badge--warning">4 synthetic</span>
          </div>
          <div class="rows">
            ${state.protectedResources.map((resource) => `
              <div class="row">
                <strong>${escapeText(resource.id)}</strong>
                <p>${escapeText(resource.type)} · ${escapeText(resource.handling)} · ${escapeText(resource.status)}${resource.id === 'credential_membership' ? ' · <em>predicate proof only</em>' : ''}${resource.id === 'payment_instrument_demo' ? ' · <em>use only, single-use</em>' : ''}${resource.id === 'signing_key_demo' ? ' · <em>non-exporting · enclave only</em>' : ''}${resource.id === 'account_demo' ? ' · <em>bounded write · no open-ended authority</em>' : ''}</p>
              </div>`).join('')}
          </div>
          <div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px">
            <div style="padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)"><strong style="font:700 11px ui-monospace,monospace">credential_membership</strong><p style="margin:6px 0 0;color:var(--muted);font-size:12px">Returns <code class="mono">verified</code> without releasing the member record. Provider candidates: <code class="mono">predicate_proof</code>.</p></div>
            <div style="padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)"><strong style="font:700 11px ui-monospace,monospace">payment_instrument_demo</strong><p style="margin:6px 0 0;color:var(--muted);font-size:12px">Returns <code class="mono">paid</code> without exposing reusable credential. Mode <code class="mono">direct_delivery</code>.</p></div>
            <div style="padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)"><strong style="font:700 11px ui-monospace,monospace">signing_key_demo</strong><p style="margin:6px 0 0;color:var(--muted);font-size:12px">Returns <code class="mono">signed</code> without key export. Mode <code class="mono">enclave_sign</code>.</p></div>
            <div style="padding:12px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)"><strong style="font:700 11px ui-monospace,monospace">account_demo</strong><p style="margin:6px 0 0;color:var(--muted);font-size:12px">Returns <code class="mono">updated</code> without open-ended authority. Mode <code class="mono">bounded_write</code>.</p></div>
          </div>
        </section>

        <section class="panel" id="policies">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Policies · authority</p>
              <h2>Deterministic policy</h2>
              <p class="section-note">Order has no authority meaning. Most restrictive intersection wins. Explicit deny overrides allow. Human approval required for all consequential operations.</p>
            </div>
            <span class="badge badge--neutral">${policiesDisplay.length} active</span>
          </div>
          <div class="rows">
            ${policiesDisplay.map((policy) => {
              const isDetailed = !!policy.match;
              const summary = policy.summary || `${policy.id}@${policy.version} · ${policy.effect} · match ${JSON.stringify(policy.match||{})}`;
              const match = isDetailed ? JSON.stringify(policy.match) : '';
              const constraints = isDetailed ? JSON.stringify({ maxAmountMinor: policy.maxAmountMinor, currencies: policy.currencies, maxUses: policy.maxUses, allowedModes: policy.allowedModes, ...(policy.constraints||{}) }) : '';
              return `<div class="row">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
                  <strong>${escapeText(policy.id)}</strong>
                  <button class="ghost" data-action="explain-policy" data-policy="${escapeText(policy.id)}" style="padding:6px 10px;font-size:11px">Explain</button>
                </div>
                <p>${escapeText(summary)}</p>
                ${isDetailed ? `<small style="display:block;margin-top:6px;word-break:break-all">match: <code class="mono">${escapeText(match)}</code></small>` : ''}
                ${isDetailed && constraints && constraints !== '{}' ? `<small style="display:block;word-break:break-all">constraints: <code class="mono">${escapeText(constraints)}</code></small>` : ''}
                <div class="explain-target" data-explain="${escapeText(policy.id)}" style="display:none;margin-top:8px;padding:10px;border:1px dashed var(--line);background:var(--paper);border-radius:var(--radius-sm);font-size:12px;color:var(--muted)"></div>
              </div>`;
            }).join('')}
          </div>
          <div style="margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--paper)">
            <div style="font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:10px">Simulate policy (list policies, simulate, explain)</div>
            <form data-simulate-form class="simulate-grid">
              <div class="field"><label for="sim-recipient">Recipient</label><select id="sim-recipient" name="recipientId"><option value="recipient_verifier_a">recipient_verifier_a · Verifier A</option><option value="recipient_merchant_b">recipient_merchant_b · Merchant B</option><option value="recipient_signer_c">recipient_signer_c · Signer C</option><option value="recipient_account_d">recipient_account_d · Account D</option><option value="recipient_attacker">recipient_attacker · attacker</option></select></div>
              <div class="field"><label for="sim-op">Operation type</label><select id="sim-op" name="operationType"><option value="credential_presentation">credential_presentation</option><option value="payment">payment</option><option value="signing">signing</option><option value="bounded_action">bounded_action</option></select></div>
              <div class="field"><label for="sim-purpose">Purpose</label><select id="sim-purpose" name="purpose"><option value="verify_membership">verify_membership</option><option value="pay_invoice">pay_invoice</option><option value="sign_payload">sign_payload</option><option value="update_account">update_account</option></select></div>
              <div class="field"><label for="sim-amount">Amount (cents)</label><input id="sim-amount" name="amountMinor" type="number" placeholder="e.g. 4250" min="0" max="10000"></div>
              <div class="field"><label for="sim-resource">Resource id</label><input id="sim-resource" name="resourceId" placeholder="e.g. payment_instrument_demo"></div>
              <div class="field"><label for="sim-action">Action</label><input id="sim-action" name="action" placeholder="present | pay | sign | update"></div>
            </form>
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="quiet" data-action="simulate-policy">Simulate</button>
              <button class="ghost" data-action="simulate-attack" title="Simulate attacker amount">Simulate Amount Mutation ($99.99)</button>
            </div>
            <div class="simulate-result ${simulateResult ? (simulateResult.decision === 'deny' ? 'deny' : 'allow') : ''}" id="simulate-output" style="${simulateResult ? '' : 'display:none'}">
              ${simulateResult ? `${escapeText(simulateResult.decision)}${simulateResult.reason ? ` · ${escapeText(simulateResult.reason)}` : ''} · policies: ${escapeText((simulateResult.policyIds||[]).join(', ')||'—')}${simulateResult.constraints ? ` · constraints: ${escapeText(JSON.stringify(simulateResult.constraints))}` : ''}` : ''}
            </div>
            <small style="display:block;margin-top:8px;color:var(--muted);font:600 11px ui-monospace,monospace">Calls <code class="mono">POST /api/policies/simulate</code> with normalized terms. Response shows decision, reason, policyIds, constraints, trace.</small>
          </div>
        </section>

        <section class="panel" id="approvals">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Human authority · approvals</p>
              <h2>Pending approvals</h2>
              <p class="section-note">Each approval shows exact terms, bound-terms digest, disclosure mode, and provenance. Approve executes via server-held recipient proof.</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <span class="badge ${pendingCount ? 'badge--warning' : 'badge--neutral'}">${pendingCount} pending</span>
              <button class="quiet" data-action="reset">Reset sandbox</button>
            </div>
          </div>
          ${state.approvals.length === 0 ? `
            <div class="empty">
              <p>No pending requests. Ask a WebMCP agent, or simulate the same request here with the journey buttons above. Approvals require the HttpOnly human session and same-origin request.</p>
              <div class="demo-actions" style="margin-top:12px">
                <button class="quiet" data-action="request-credential">Simulate membership proof request</button>
                <button class="quiet" data-action="request-payment">Simulate $42.50 payment request</button>
                <button class="deny" data-action="request-attack">Run recipient redirect attack</button>
              </div>
            </div>` : state.approvals.map((approval) => `
            <article class="approval-card">
              <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
                <div><span class="operation-chip">${escapeText(approval.operationType.replaceAll('_', ' '))}</span><h3>${escapeText(approval.displayedTerms.action)} protected resource</h3><small style="color:var(--muted);font:600 11px ui-monospace,monospace">${escapeText(approval.operationType)} → ${escapeText(approval.displayedTerms.resourceId)}</small></div>
                <span class="badge badge--warning">${escapeText(approval.disclosure.mode.replaceAll('_', ' '))}</span>
              </div>
              <dl>
                <div><dt>Recipient</dt><dd>${escapeText(approval.recipientLabel || '—')} · ${escapeText(approval.displayedTerms.recipientId)}</dd></div>
                <div><dt>Protected resource</dt><dd>${escapeText(approval.displayedTerms.resourceId)}</dd></div>
                <div><dt>Purpose</dt><dd>${escapeText(approval.displayedTerms.purpose)}</dd></div>
                <div><dt>Disclosure</dt><dd>${escapeText(approval.disclosure.mode.replaceAll('_', ' '))} · assurance ${escapeText(profile)}</dd></div>
                <div><dt>Transaction</dt><dd class="mono">${escapeText(approval.displayedTerms.transactionId)}</dd></div>
                <div><dt>Authority</dt><dd>${escapeText(approval.displayedTerms.requestedUses)} use · expires after ${escapeText(approval.displayedTerms.validForSeconds / 60)} minutes · validForSeconds ${escapeText(approval.displayedTerms.validForSeconds)}</dd></div>
                <div><dt>Recipient authentication</dt><dd>${escapeText(approval.recipientAssurance || 'server-held synthetic session')}</dd></div>
                <div><dt>Request provenance</dt><dd>${escapeText(approval.displayedTerms.agentId)} · ${escapeText(approval.displayedTerms.taskId)}</dd></div>
                <div><dt>Bound-terms digest</dt><dd class="mono" style="word-break:break-all;font-size:11px">${escapeText(approval.proposalDigest)}</dd></div>
                ${approval.displayedTerms.claimIds.length === 0 ? '' : `<div><dt>Claim scope</dt><dd>${approval.displayedTerms.claimIds.map(escapeText).join(', ')}</dd></div>`}
                ${approval.displayedTerms.amountMinor === null ? '' : `<div><dt>Amount</dt><dd>$${(approval.displayedTerms.amountMinor / 100).toFixed(2)} ${escapeText(approval.displayedTerms.currency)}</dd></div>`}
                <div><dt>Correlation / Approval ID</dt><dd class="mono" style="word-break:break-all;font-size:11px">${escapeText(approval.id)}</dd></div>
              </dl>
              <div class="approval-actions"><button class="deny" data-decision="denied" data-approval="${escapeText(approval.id)}">Deny</button><button class="approve" data-decision="approved" data-approval="${escapeText(approval.id)}">Approve exact terms</button></div>
            </article>`).join('')}
        </section>

        <section class="panel" id="capabilities">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Capabilities · revocation</p>
              <h2>Active capabilities</h2>
              <p class="section-note">Reference is opaque and recipient-bound. Remaining uses and expiry enforce one-time authority. Revocation cascades to descendants.</p>
            </div>
            <span class="badge ${approvedCapsCount ? 'badge--success' : 'badge--neutral'}">${approvedCapsCount} active</span>
          </div>
          ${capabilities.length === 0 ? `<p class="empty">No active capabilities. Approve a pending request to issue a one-use, 5-minute capability.</p>` : `
            <div class="table-wrap">
              <table class="data-table" aria-label="Active capabilities">
                <thead>
                  <tr><th>Reference</th><th>Type</th><th>Recipient</th><th>Expiry</th><th>Remaining</th><th>Revoke</th></tr>
                </thead>
                <tbody>
                  ${capabilities.map((cap) => `
                    <tr>
                      <td class="mono" title="${escapeText(cap.reference)}">${escapeText(shortRef(cap.reference))} ${cap.parentReference ? `<span style="color:var(--muted);font:600 10px ui-monospace,monospace">↳ child of ${escapeText(shortRef(cap.parentReference))}</span>` : ''}</td>
                      <td>${escapeText(cap.operationType)}</td>
                      <td>${escapeText(cap.recipientId)}</td>
                      <td>${escapeText(formatExpiry(cap.expiresAt))}<br><small class="mono" style="color:var(--muted)">${escapeText(new Date(cap.expiresAt).toLocaleTimeString())}</small></td>
                      <td><span class="pill">${escapeText(cap.remainingUses)} use${cap.remainingUses===1?'':'s'}</span></td>
                      <td><button class="deny" data-revoke="${escapeText(cap.reference)}" style="padding:6px 10px;font-size:11px">Revoke</button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
            <p style="margin:10px 0 0;color:var(--muted);font-size:11px;line-height:1.5">Revocation calls <code class="mono">POST /api/capabilities/:ref/revoke</code>. Descendant revocation is BFS from the parent — all children are revoked. Expiry sweeps every 5 minutes; you can also observe auto-expiry after 5 min.</p>
          `}
          ${capabilities.length > 0 ? `<details style="margin-top:12px"><summary style="cursor:pointer;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Show raw capabilities JSON (safe fields only)</summary><pre class="curl-block" style="margin-top:8px;white-space:pre-wrap;word-break:break-all">${escapeText(JSON.stringify(capabilities.slice(0,3), null, 2))}</pre></details>` : ''}
        </section>

        <section class="panel" id="activity">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Activity · security evidence</p>
              <h2>Audit log</h2>
              <p class="section-note">In-memory, unkeyed SHA-256 hash chain. Consistency evidence for this run only — not tamper-proof storage. No protected payloads are stored.</p>
            </div>
            <span class="no-secret ${integrity ? '' : 'is-fail'}"><span class="integrity-dot ${integrity ? 'ok' : 'fail'}" aria-hidden="true"></span> ${integrity ? 'Chain consistent · hash integrity ok' : 'Integrity check failed'}</span>
          </div>
          ${auditRecords.length === 0 ? '<p class="empty">Activity appears here after a request, denial, approval, execution, or correction. Columns: eventType, correlationId, outcome, representation, assurance, hash chain integrity.</p>' : `
            <div class="table-wrap">
              <table class="data-table" aria-label="Audit log">
                <thead>
                  <tr><th>#</th><th>eventType</th><th>correlationId</th><th>outcome</th><th>representation</th><th>assurance</th><th>hash</th><th>at</th></tr>
                </thead>
                <tbody>
                  ${auditRecords.slice().reverse().slice(0, 40).map((rec) => {
                    const e = rec.event || rec;
                    return `<tr>
                      <td class="mono">${escapeText(rec.sequence ?? '—')}</td>
                      <td><span class="pill">${escapeText(e.eventType || e.type || '—')}</span></td>
                      <td class="mono" title="${escapeText(e.correlationId || '—')}">${escapeText(shortRef(e.correlationId))}</td>
                      <td>${escapeText(e.outcome || '—')}</td>
                      <td>${escapeText(e.representation || '—')}</td>
                      <td>${escapeText(e.assurance || '—')}</td>
                      <td class="mono" title="${escapeText(rec.hash || '—')}" style="font-size:10px">${escapeText((rec.hash||'—').slice(0,8))}…</td>
                      <td class="mono" style="font-size:11px">${escapeText(e.occurredAt ? new Date(e.occurredAt).toLocaleTimeString() : (e.at ? new Date(e.at).toLocaleTimeString() : '—'))}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <span class="badge ${integrity ? 'badge--success' : 'badge--danger'}">${integrity ? '✔ hash chain verified' : '✘ hash chain broken'}</span>
              <span class="badge badge--neutral">correlationId links request → approval → receipt</span>
              <span class="badge badge--neutral">representation = disclosure mode</span>
            </div>
            <details style="margin-top:12px"><summary style="cursor:pointer;font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)">Show hash chain details</summary>
              <div style="margin-top:8px;display:grid;gap:8px">
                ${auditRecords.slice(-3).map((rec)=> `<div style="padding:10px;border:1px solid var(--line);background:var(--paper);border-radius:var(--radius-sm);font:600 10px ui-monospace,monospace;overflow-wrap:anywhere">seq ${escapeText(rec.sequence)} · prev ${escapeText((rec.previousHash||'').slice(0,12))}… → hash ${escapeText((rec.hash||'').slice(0,12))}… · event ${escapeText(rec.event?.eventType||'?')}</div>`).join('')}
                <small style="color:var(--muted)">Verify via <code class="mono">GET /api/audit</code> → <code class="mono">{ records, integrity }</code>. Genesis hash is 64 zeros. Each record hashes <code class="mono">[sequence, previousHash, event]</code>.</small>
              </div>
            </details>
          `}
        </section>

        <section class="panel" id="developer">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Developer · test instructions</p>
              <h2>Curl, WebMCP, and portability</h2>
              <p class="section-note">Reproduce every journey with curl and WebMCP. Export/import moves synthetic state between devices. All endpoints are same-origin human-session gated where required.</p>
            </div>
            <span class="badge badge--neutral">synthetic · Node 22 · no deps</span>
          </div>

          <div class="code-grid">
            <div>
              <div class="copy-row"><strong style="font:700 12px ui-monospace,monospace">Curl — session</strong><button class="ghost" data-copy="curl-session" style="padding:6px 10px;font-size:11px">Copy</button></div>
              <pre class="curl-block" data-code="curl-session">curl -i http://127.0.0.1:3000/api/session
# → sets ptf_human_session cookie (HttpOnly)
# reuse cookie for all following calls
curl -H "Cookie: ptf_human_session=..." http://127.0.0.1:3000/api/state | jq</pre>
            </div>
            <div>
              <div class="copy-row"><strong style="font:700 12px ui-monospace,monospace">Curl — journeys (4)</strong><button class="ghost" data-copy="curl-journeys" style="padding:6px 10px;font-size:11px">Copy</button></div>
              <pre class="curl-block" data-code="curl-journeys"># membership proof
curl -X POST -H "Cookie: ..." -H "Content-Type: application/json" \\
  -d '{"scenario":"credential"}' http://127.0.0.1:3000/api/operations/request
# payment $42.50
curl -X POST -H "Cookie: ..." -d '{"scenario":"payment","amountMinor":4250,"currency":"USD"}' http://127.0.0.1:3000/api/operations/request
# signing
curl -X POST -H "Cookie: ..." -d '{"scenario":"signing"}' http://127.0.0.1:3000/api/operations/request
# bounded action
curl -X POST -H "Cookie: ..." -d '{"scenario":"action"}' http://127.0.0.1:3000/api/operations/request</pre>
            </div>
            <div>
              <div class="copy-row"><strong style="font:700 12px ui-monospace,monospace">Curl — approve / deny</strong><button class="ghost" data-copy="curl-approve" style="padding:6px 10px;font-size:11px">Copy</button></div>
              <pre class="curl-block" data-code="curl-approve"># approve exact terms (same-origin + HttpOnly required)
curl -X POST -H "Cookie: ..." -H "Origin: http://127.0.0.1:3000" -H "Content-Type: application/json" \\
  -d '{"decision":"approved"}' http://127.0.0.1:3000/api/approvals/&lt;approvalId&gt;
# deny
curl -X POST -H "Cookie: ..." -H "Origin: http://127.0.0.1:3000" -d '{"decision":"denied"}' http://127.0.0.1:3000/api/approvals/&lt;approvalId&gt;</pre>
            </div>
            <div>
              <div class="copy-row"><strong style="font:700 12px ui-monospace,monospace">Curl — capabilities & audit</strong><button class="ghost" data-copy="curl-caps" style="padding:6px 10px;font-size:11px">Copy</button></div>
              <pre class="curl-block" data-code="curl-caps">curl -H "Cookie: ..." http://127.0.0.1:3000/api/capabilities
curl -H "Cookie: ..." http://127.0.0.1:3000/api/audit | jq
curl -X POST -H "Cookie: ..." -H "Origin: http://127.0.0.1:3000" http://127.0.0.1:3000/api/capabilities/&lt;ref&gt;/revoke
curl -H "Cookie: ..." http://127.0.0.1:3000/api/export > ptf-export.json
curl -X POST -H "Cookie: ..." -H "Origin: http://127.0.0.1:3000" -H "Content-Type: application/json" --data @ptf-export.json http://127.0.0.1:3000/api/import</pre>
            </div>
          </div>

          <div style="margin-top:18px">
            <div style="font:700 11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px">WebMCP tools (4) — agent calls, human approves</div>
            <div class="tool-list">
              <div class="tool-item"><span><code>get_ptf_safe_view</code> — safe persona + capability types</span><span class="badge badge--neutral">readOnly</span></div>
              <div class="tool-item"><span><code>request_membership_status_proof</code> — predicate proof for Verifier A</span><span class="badge badge--neutral">approval_required</span></div>
              <div class="tool-item"><span><code>request_synthetic_invoice_payment</code> — { amountMinor } → Merchant B</span><span class="badge badge--neutral">approval_required</span></div>
              <div class="tool-item"><span><code>attempt_recipient_redirect_attack</code> — deterministic deny</span><span class="badge badge--danger">deny expected</span></div>
            </div>
            <small style="display:block;margin-top:8px;color:var(--muted);font-size:11px">Adapter feature-detects <code class="mono">document.modelContext.registerTool</code>. Tools are top-level imperative only; approval/correction/reset remain human-session only.</small>
          </div>

          <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="quiet" data-action="export">Export snapshot</button>
            <button class="quiet" data-action="import">Import snapshot</button>
            <input id="import-file" type="file" accept=".json,application/json" style="display:none">
            <button class="ghost" data-action="copy-export-curl">Copy export curl</button>
          </div>
        </section>

        <section class="panel" id="devices">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Devices · recovery · portability</p>
              <h2>Simulated devices</h2>
              <p class="section-note">No real custody. This bar demonstrates export/import portability and device-scoped human approval without mobile/desktop apps.</p>
            </div>
            <div class="export-actions"><button class="quiet" data-action="export">Export</button><button class="quiet" data-action="import">Import</button></div>
          </div>
          <div class="device-list">
            ${devices.map((d)=> `
              <div class="device-item">
                <div>
                  <strong>${escapeText(d.name)}</strong>
                  <p>${escapeText(d.detail)}</p>
                  <p style="margin-top:4px"><span class="badge ${d.status==='active'?'badge--success': d.status==='available'?'badge--warning':'badge--neutral'}" style="font-size:10px">${escapeText(d.status)}</span> <span style="font:600 11px ui-monospace,monospace;color:var(--muted)">${escapeText(d.id)}</span></p>
                </div>
                <div class="device-meta">${escapeText(d.meta)}<br><small>synthetic · no enclave</small></div>
              </div>`).join('')}
          </div>
          <div style="margin-top:14px;padding:14px;border:1px solid var(--line);background:var(--paper);border-radius:var(--radius-sm)">
            <strong style="font:700 12px ui-monospace,monospace">Recovery & portability — simulated</strong>
            <p style="margin:6px 0 0;color:var(--muted);font-size:12px;line-height:1.5">Export creates a JSON archive <code class="mono">{ version, snapshot, policies, capabilities, auditRecords }</code> via <code class="mono">GET /api/export</code>. Import restores via <code class="mono">POST /api/import</code> with tenant composite-key check. In production this would be an encrypted, signed backup; here it is a synthetic demonstration with file download/upload and no secrets.</p>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="approve" data-action="export">Download export JSON</button>
              <button class="quiet" data-action="import">Upload & Import JSON</button>
              <button class="ghost" data-action="reset">Reset sandbox</button>
            </div>
          </div>
        </section>

      </div>
    </section>

    <footer class="site-footer">
      <div>Personal Trust Fabric — synthetic sandbox · no real credentials · audit is in-memory unkeyed chain · capabilities are 5-minute one-use · WebMCP requires ChatGPT desktop + Sol/Terra or Chrome 149+ with testing enabled.</div>
      <div style="white-space:nowrap">Profile: ${escapeText(profile)} · v${escapeText(version)} · <span style="color:${integrity ? 'var(--success)' : 'var(--wine)'}">${integrity ? 'chain consistent' : 'integrity failed'}</span></div>
    </footer>
  `;
}

async function refresh(webmcpReady = webmcpReadyFlag) {
  // avoid clobbering user input
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') && document.hasFocus();
  if (isTyping && currentState) return;
  try {
    const combined = await fetchCombined();
    render(combined, webmcpReady);
    // restore simulateResult UI if needed
    if (simulateResult) {
      const out = document.getElementById('simulate-output');
      if (out) { out.style.display = ''; out.textContent = `${simulateResult.decision}${simulateResult.reason ? ` · ${simulateResult.reason}` : ''} · policies: ${(simulateResult.policyIds||[]).join(', ')||'—'}${simulateResult.constraints ? ` · constraints: ${JSON.stringify(simulateResult.constraints)}` : ''}`; out.className = `simulate-result ${simulateResult.decision === 'deny' ? 'deny' : 'allow'}`; }
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  // revoke
  if (button.dataset.revoke) {
    const ref = button.dataset.revoke;
    button.disabled = true;
    try {
      await api(`/api/capabilities/${encodeURIComponent(ref)}/revoke`, {});
      showToast(`Capability ${shortRef(ref)} revoked — descendants also revoked`, 'success');
      announcement = `Capability ${ref} revoked.`;
      await refresh();
    } catch (error) {
      button.disabled = false;
      showToast(error.message, 'error');
    }
    return;
  }
  // explain policy toggle
  if (button.dataset.action === 'explain-policy') {
    const id = button.dataset.policy;
    const esc = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape(id) : String(id).replace(/[^A-Za-z0-9_-]/g, '\\$&');
    const target = document.querySelector(`[data-explain="${esc}"]`);
    if (target) {
      const isHidden = target.style.display === 'none' || target.style.display === '';
      if (isHidden) {
        // fetch policy details if available
        const pol = currentPoliciesFull.find((p) => p.id === id) || currentState.policies.find((p)=>p.id===id);
        if (pol) {
          target.textContent = `Explain: ${pol.summary || JSON.stringify(pol.match || {})} · effect ${pol.effect || 'allow'} · ${pol.requireApproval ? 'requires human approval' : 'no approval'} · ${pol.maxAmountMinor ? `maxAmountMinor ${pol.maxAmountMinor}` : ''}`;
        } else {
          target.textContent = 'Policy details unavailable';
        }
        target.style.display = 'block';
        button.textContent = 'Hide';
      } else {
        target.style.display = 'none';
        button.textContent = 'Explain';
      }
    }
    return;
  }
  if (button.dataset.copy) {
    const codeEl = document.querySelector(`[data-code="${button.dataset.copy}"]`);
    if (codeEl) {
      try {
        await navigator.clipboard.writeText(codeEl.textContent);
        showToast('Copied to clipboard', 'success');
      } catch { showToast(codeEl.textContent.slice(0, 80) + '…', 'info'); }
    }
    return;
  }
  if (!button.dataset.action && !button.dataset.approval) return;
  button.disabled = true;
  try {
    if (button.dataset.action === 'reset') {
      await api('/api/reset', {});
      simulateResult = null;
      showToast('Sandbox reset', 'success');
    }
    if (button.dataset.action === 'request-credential') {
      const res = await api('/api/operations/request', { scenario: 'credential' });
      lastApprovalId = res.approvalId || null;
      showToast(res.decision === 'approval_required' ? 'Membership proof ready for approval' : `Decision: ${res.decision}`, res.decision === 'deny' ? 'error' : 'success');
    }
    if (button.dataset.action === 'request-payment') {
      const res = await api('/api/operations/request', { scenario: 'payment', amountMinor: 4250, currency: 'USD' });
      lastApprovalId = res.approvalId || null;
      showToast(res.decision === 'approval_required' ? '$42.50 payment ready for approval' : `Decision: ${res.decision}`, res.decision === 'deny' ? 'error' : 'success');
    }
    if (button.dataset.action === 'request-signing') {
      const res = await api('/api/operations/request', { scenario: 'signing' });
      lastApprovalId = res.approvalId || null;
      showToast(res.decision === 'approval_required' ? 'Signing request ready for approval' : `Decision: ${res.decision}`, res.decision === 'deny' ? 'error' : 'success');
    }
    if (button.dataset.action === 'request-action') {
      const res = await api('/api/operations/request', { scenario: 'action' });
      lastApprovalId = res.approvalId || null;
      showToast(res.decision === 'approval_required' ? 'Bounded action ready for approval' : `Decision: ${res.decision}`, res.decision === 'deny' ? 'error' : 'success');
    }
    if (button.dataset.action === 'request-attack') {
      const res = await api('/api/operations/request', { scenario: 'payment', amountMinor: 4250, currency: 'USD', recipientId: 'recipient_attacker' });
      showToast(res.decision === 'deny' ? `Attack blocked · ${res.reason}` : 'Unexpected allow', res.decision === 'deny' ? 'success' : 'error');
    }
    if (button.dataset.action === 'attack-replay') {
      // try to replay last approval if exists, else fake id
      const targetId = lastApprovalId || (currentState.approvals[0]?.id) || 'replay_fake_id_123';
      try {
        await api(`/api/approvals/${targetId}`, { decision: 'approved' });
        // if succeeded, try second time to trigger replay block
        try {
          await api(`/api/approvals/${targetId}`, { decision: 'approved' });
          showToast('Replay not blocked — unexpected', 'error');
        } catch (e2) {
          showToast(`Replay blocked · ${e2.message}`, 'success');
        }
      } catch (e) {
        // first attempt failed -> still demonstrates block
        if (e.message.includes('not pending') || e.message.includes('not authorized') || e.message.includes('approval is not pending')) {
          showToast(`Replay blocked · ${e.message}`, 'success');
        } else {
          showToast(`Replay check · ${e.message}`, e.message.includes('not pending') ? 'success' : 'info');
        }
      }
      // also try to demonstrate 409 via re-approving an already consumed approval: if no pending, create one then consume
      if (!lastApprovalId && currentState.approvals.length === 0) {
        // create and approve then replay in background already handled, but provide hint
      }
    }
    if (button.dataset.action === 'attack-mutation') {
      const res = await api('/api/operations/request', { scenario: 'payment', amountMinor: 9999, currency: 'USD' });
      showToast(res.decision === 'deny' ? `Mutation blocked · ${res.reason}` : 'Unexpected allow — mutation not blocked', res.decision === 'deny' ? 'success' : 'error');
    }
    if (button.dataset.action === 'export' || button.dataset.action === 'copy-export-curl') {
      if (button.dataset.action === 'copy-export-curl') {
        const curl = 'curl -H "Cookie: ptf_human_session=..." http://127.0.0.1:3000/api/export > ptf-export.json';
        try { await navigator.clipboard.writeText(curl); showToast('Export curl copied', 'success'); } catch { showToast(curl, 'info'); }
      } else {
        const data = await api('/api/export');
        downloadJson(data, `ptf-export-${new Date().toISOString().slice(0,10)}.json`);
        showToast('Export downloaded', 'success');
      }
    }
    if (button.dataset.action === 'import') {
      const input = document.getElementById('import-file');
      if (input) input.click();
      button.disabled = false;
      return;
    }
    if (button.dataset.action === 'simulate-policy') {
      const form = document.querySelector('[data-simulate-form]');
      const fd = new FormData(form);
      const body = {
        recipientId: fd.get('recipientId'),
        purpose: fd.get('purpose'),
        operationType: fd.get('operationType'),
        resourceId: fd.get('resourceId') || undefined,
        action: fd.get('action') || undefined,
        amountMinor: fd.get('amountMinor') ? Number(fd.get('amountMinor')) : undefined,
        currency: fd.get('amountMinor') ? 'USD' : undefined
      };
      // clean undefined
      Object.keys(body).forEach(k=> body[k]===undefined && delete body[k]);
      const res = await api('/api/policies/simulate', body);
      simulateResult = res;
      const out = document.getElementById('simulate-output');
      if (out) {
        out.style.display = '';
        out.textContent = `${res.decision}${res.reason ? ` · ${res.reason}` : ''} · policies: ${(res.policyIds||[]).join(', ')||'—'}${res.constraints ? ` · constraints: ${JSON.stringify(res.constraints)}` : ''}`;
        out.className = `simulate-result ${res.decision === 'deny' ? 'deny' : 'allow'}`;
      }
      showToast(`Simulate: ${res.decision}`, res.decision === 'deny' ? 'info' : 'success');
      button.disabled = false;
      return;
    }
    if (button.dataset.action === 'simulate-attack') {
      const res = await api('/api/policies/simulate', { recipientId: 'recipient_merchant_b', purpose: 'pay_invoice', operationType: 'payment', resourceId: 'payment_instrument_demo', action: 'pay', amountMinor: 9999, currency: 'USD' });
      simulateResult = res;
      const out = document.getElementById('simulate-output');
      if (out) {
        out.style.display = '';
        out.textContent = `${res.decision}${res.reason ? ` · ${res.reason}` : ''} · policies: ${(res.policyIds||[]).join(', ')||'—'}`;
        out.className = `simulate-result ${res.decision === 'deny' ? 'deny' : 'allow'}`;
      }
      showToast(`Mutation simulate: ${res.decision} · ${res.reason||''}`, res.decision==='deny' ? 'success' : 'error');
      button.disabled = false;
      return;
    }
    if (button.dataset.approval) {
      await api(`/api/approvals/${button.dataset.approval}`, { decision: button.dataset.decision });
      lastApprovalId = button.dataset.approval;
      announcement = `Operation ${button.dataset.decision}.`;
      showToast(button.dataset.decision === 'approved' ? 'Approved · capability issued' : 'Denied', button.dataset.decision === 'approved' ? 'success' : 'info');
    } else if (!['import','simulate-policy','simulate-attack','explain-policy'].includes(button.dataset.action)) {
      announcement = 'Sandbox state updated.';
    }
    await refresh();
  } catch (error) {
    button.disabled = false;
    showToast(error.message, 'error');
  }
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-claim-form]');
  if (form) {
    event.preventDefault();
    const button = form.querySelector('button');
    if (button) button.disabled = true;
    try {
      const fd = new FormData(form);
      const value = fd.get('value');
      const confRaw = fd.get('confidence');
      const confidence = confRaw === '' || confRaw === null ? 1 : Number(confRaw);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence must be between 0 and 1');
      await api(`/api/persona/${form.dataset.claimForm}/correct`, { value: String(value), confidence });
      announcement = 'Persona claim corrected. The previous claim was superseded.';
      showToast(`Corrected ${form.dataset.claimKey || form.dataset.claimForm} → ${value} (confidence ${confidence})`, 'success');
      await refresh();
    } catch (error) {
      if (button) button.disabled = false;
      showToast(error.message, 'error');
    }
    return;
  }
  const simForm = event.target.closest('[data-simulate-form]');
  if (simForm) {
    event.preventDefault();
    // handled via button click
  }
});

app.addEventListener('change', async (event) => {
  const input = event.target;
  if (input && input.id === 'import-file') {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await api('/api/import', json);
      showToast('Import successful', 'success');
      announcement = 'Import completed.';
      await refresh();
    } catch (error) {
      showToast(`Import failed · ${error.message}`, 'error');
    } finally {
      input.value = '';
    }
  }
});

window.addEventListener('ptf-state-changed', () => refresh());

// poll every 2s
if (pollTimer) clearInterval(pollTimer);
pollTimer = setInterval(() => { refresh(); }, 2000);
if (pollTimer.unref) pollTimer.unref();

// init
const webmcpReady = await registerWebMCPTools();
document.documentElement.dataset.webmcp = webmcpReady ? 'ready' : 'unavailable';
webmcpReadyFlag = webmcpReady;
const sessionState = await api('/api/session');
let initialCombined;
try {
  const caps = await api('/api/capabilities');
  const audit = await api('/api/audit');
  const policies = await api('/api/policies');
  initialCombined = { state: sessionState, capabilities: caps.capabilities || [], audit, policiesFull: policies.policies || [] };
} catch {
  initialCombined = { state: sessionState, capabilities: [], audit: { records: [], integrity: sessionState.auditIntegrity }, policiesFull: [] };
}
render(initialCombined, webmcpReady);
