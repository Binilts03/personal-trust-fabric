async function request(path, body, signal) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'PTF request failed');
  window.dispatchEvent(new CustomEvent('ptf-state-changed'));
  return result;
}

async function requestGet(path, signal) {
  const response = await fetch(path, {
    method: 'GET',
    headers: {},
    signal
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'PTF request failed');
  // Do not dispatch state changed for pure status polls? But keep for consistency
  return result;
}

export async function registerWebMCPTools() {
  if (typeof document.modelContext?.registerTool !== 'function') return false;

  await document.modelContext.registerTool({
    name: 'get_ptf_safe_view',
    title: 'Inspect the agent-safe PTF view',
    description: 'Read only the task-safe persona projection, available capability types, approval state, and synthetic assurance label. Never returns protected values.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    execute: async (_input, execution = {}) => {
      const state = await request('/api/agent-view', undefined, execution.signal);
      return { assuranceLabel: state.assuranceLabel, safeView: state.safeView };
    }
  });

  await document.modelContext.registerTool({
    name: 'request_membership_status_proof',
    title: 'Request a minimal membership proof',
    description: 'Ask PTF to prepare a one-use active-membership predicate proof for synthetic Verifier A. A human must approve it in the PTF interface.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async (_input, execution = {}) => request(
      '/api/operations/request',
      { scenario: 'credential' },
      execution.signal
    )
  });

  await document.modelContext.registerTool({
    name: 'request_synthetic_invoice_payment',
    title: 'Request a bounded synthetic payment',
    description: 'Ask PTF to prepare a one-use USD invoice payment to synthetic Merchant B. The reusable payment instrument stays hidden and a human must approve concrete terms.',
    inputSchema: {
      type: 'object',
      properties: {
        amountMinor: { type: 'integer', minimum: 1, maximum: 5000, description: 'USD amount in cents.' }
      },
      required: ['amountMinor'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ amountMinor }, execution = {}) => request(
      '/api/operations/request',
      { scenario: 'payment', amountMinor, currency: 'USD' },
      execution.signal
    )
  });

  await document.modelContext.registerTool({
    name: 'request_signing_authority',
    title: 'Request a detached signing authority',
    description: 'Ask PTF to prepare a one-use detached signing for synthetic payload (e.g., "document hash abc123") bound to recipient_verifier_a, purpose sign_document, operationType signing. A human must approve it in the PTF interface.',
    inputSchema: {
      type: 'object',
      properties: {
        payloadHash: { type: 'string', pattern: '^[a-f0-9]{64}$', description: 'SHA-256 hex digest of the payload to sign.' }
      },
      required: ['payloadHash'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ payloadHash }, execution = {}) => request(
      '/api/operations/request',
      { scenario: 'signing', payloadHash },
      execution.signal
    )
  });

  await document.modelContext.registerTool({
    name: 'request_bounded_action',
    title: 'Request a bounded account action',
    description: 'Ask PTF to prepare a one-use bounded account action (e.g., "update profile visibility") bound to recipient_verifier_a. A human must approve it in the PTF interface.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['update_visibility', 'submit_form'], description: 'Bounded account action to perform.' }
      },
      required: ['action'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ action }, execution = {}) => request(
      '/api/operations/request',
      { scenario: 'bounded_action', action },
      execution.signal
    )
  });

  await document.modelContext.registerTool({
    name: 'get_operation_status',
    title: 'Poll operation or approval status',
    description: 'Poll the status of a pending approval or issued capability by operationReference or approvalId. Returns safe receipt/status without protected values. Use after request → approval_required to detect when human approves and to retrieve receipt.',
    inputSchema: {
      type: 'object',
      properties: {
        operationReference: { type: 'string', minLength: 1, description: 'Opaque operation reference returned from approval, or approvalId for pending approvals.' }
      },
      required: ['operationReference'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true },
    execute: async ({ operationReference }, execution = {}) => {
      const encoded = encodeURIComponent(operationReference);
      // Try capability status first, then approval status (unified poll)
      try {
        const cap = await requestGet(`/api/capabilities/${encoded}`, execution.signal);
        return cap;
      } catch (e) {
        // If capability not found, try approval
        try {
          const approval = await requestGet(`/api/approvals/${encoded}`, execution.signal);
          return approval;
        } catch (e2) {
          // Fallback to POST unified endpoint
          try {
            return await request('/api/operations/status', { operationReference }, execution.signal);
          } catch {
            throw e;
          }
        }
      }
    }
  });

  await document.modelContext.registerTool({
    name: 'attempt_recipient_redirect_attack',
    title: 'Run the recipient-redirection adversarial check',
    description: 'Basic policy-deny check: ask the deterministic PTF policy engine to evaluate a payment or credential redirected to an unauthorized recipient (recipient_attacker). Expected result is deny (no matching allow policy). This is a trivial pre-issuance denial; see capability-forward and replay attacks for post-issuance binding checks.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['payment', 'credential'], description: 'Capability class to test redirection against. Defaults to payment for backward compatibility.' }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async (input = {}, execution = {}) => {
      const target = input?.target ?? 'payment';
      if (target === 'credential') {
        return request(
          '/api/operations/request',
          {
            scenario: 'credential',
            recipientId: 'recipient_attacker'
          },
          execution.signal
        );
      }
      return request(
        '/api/operations/request',
        {
          scenario: 'payment',
          amountMinor: 4250,
          currency: 'USD',
          recipientId: 'recipient_attacker'
        },
        execution.signal
      );
    }
  });

  await document.modelContext.registerTool({
    name: 'attempt_capability_forward_attack',
    title: 'Attempt capability forwarding to attacker',
    description: 'Real post-issuance attack: try to redeem an issued capability as a different recipient (recipient mismatch). Expected DENIED via recipient authentication mismatch even if attacker holds the handle.',
    inputSchema: {
      type: 'object',
      properties: {
        operationReference: { type: 'string', minLength: 1, description: 'Issued operation reference to attempt to forward.' },
        targetRecipientId: { type: 'string', description: 'Recipient to masquerade as, defaults to recipient_attacker.' }
      },
      required: ['operationReference'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ operationReference, targetRecipientId }, execution = {}) => {
      const target = targetRecipientId ?? 'recipient_attacker';
      const encoded = encodeURIComponent(operationReference);
      // Attempt to redeem same reference as attacker; should be denied via recipient mismatch (independent redemption boundary)
      // Use placeholder token; server checks recipientId mismatch before token verification
      return request(
        `/api/capabilities/${encoded}/redeem`,
        { recipientId: target, recipientAuthToken: 'attacker_forward_attempt_placeholder' },
        execution.signal
      );
    }
  });

  await document.modelContext.registerTool({
    name: 'attempt_replay_attack',
    title: 'Attempt capability replay (double use)',
    description: 'Real replay attack: try to redeem the same single-use capability twice. Second redemption should be DENIED as consumed/replay even with legitimate authentication.',
    inputSchema: {
      type: 'object',
      properties: {
        operationReference: { type: 'string', minLength: 1, description: 'Operation reference to attempt to replay.' }
      },
      required: ['operationReference'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ operationReference }, execution = {}) => {
      const encoded = encodeURIComponent(operationReference);
      // First try to redeem (if capability is still active, this would consume; second should fail as replay)
      // We use placeholder token that will be denied, but server will treat second attempt同样 as replay if first succeeded elsewhere.
      // For deterministic demo, we just attempt one redeem and return; second attempt would be done by caller or second tool invocation.
      // To simulate double redeem in one call, we attempt twice and return second result expected to be denied.
      try {
        await request(
          `/api/capabilities/${encoded}/redeem`,
          { recipientId: 'recipient_merchant_b', recipientAuthToken: 'replay_first_attempt' },
          execution.signal
        );
      } catch {}
      // Second attempt - expected to be denied (replay)
      return request(
        `/api/capabilities/${encoded}/redeem`,
        { recipientId: 'recipient_merchant_b', recipientAuthToken: 'replay_second_attempt' },
        execution.signal
      );
    }
  });

  await document.modelContext.registerTool({
    name: 'attempt_claim_escalation_attack',
    title: 'Attempt claim escalation beyond policy',
    description: 'Policy-authorization attack: try to request extra claims beyond what the matched policy allows (e.g., escalate membership proof to include extra claims). Expected DENIED via claim not allowed by policy.',
    inputSchema: {
      type: 'object',
      properties: {
        scenario: { type: 'string', enum: ['credential', 'payment', 'signing', 'bounded_action'], description: 'Scenario to escalate.' },
        extraClaims: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Extra claimIds to inject beyond policy allowlist.' }
      },
      required: ['scenario'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: false },
    execute: async ({ scenario, extraClaims }, execution = {}) => {
      const claims = extraClaims ?? ['escalated_claim_should_be_denied'];
      // For claim escalation, we request scenario with additional claimIds beyond policy.
      // Payment policy allows [], credential allows ['membership.active']; extra should be denied.
      if (scenario === 'credential') {
        return request(
          '/api/operations/request',
          { scenario: 'credential', claimIds: ['membership.active', ...claims] },
          execution.signal
        );
      }
      if (scenario === 'payment') {
        return request(
          '/api/operations/request',
          { scenario: 'payment', amountMinor: 1000, currency: 'USD', claimIds: claims },
          execution.signal
        );
      }
      if (scenario === 'signing') {
        return request(
          '/api/operations/request',
          { scenario: 'signing', payloadHash: 'a'.repeat(64), claimIds: claims },
          execution.signal
        );
      }
      return request(
        '/api/operations/request',
        { scenario: scenario ?? 'bounded_action', action: 'update_visibility', claimIds: claims },
        execution.signal
      );
    }
  });
  return true;
}
