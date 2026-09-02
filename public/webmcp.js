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
    name: 'attempt_recipient_redirect_attack',
    title: 'Run the recipient-redirection adversarial check',
    description: 'Ask the deterministic PTF policy engine to evaluate a payment redirected to an unauthorized recipient. Expected result is denial; this does not rely on model refusal.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: false },
    execute: async (_input, execution = {}) => request(
      '/api/operations/request',
      {
        scenario: 'payment',
        amountMinor: 4250,
        currency: 'USD',
        recipientId: 'recipient_attacker'
      },
      execution.signal
    )
  });
  return true;
}
