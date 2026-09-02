export function toAgentSafeView(canonical) {
  return {
    version: 1,
    principalId: canonical.principalId,
    taskId: canonical.taskId,
    assurance: canonical.profile,
    persona: canonical.personaClaims
      .filter((claim) => claim.modelVisibility === 'shareable')
      .map(({ key, value }) => ({ key, value })),
    availableCapabilityTypes: [...canonical.availableCapabilityTypes],
    approvalStatus: canonical.approvalStatus
  };
}

export function toSafeReceipt(receipt) {
  return {
    version: 1,
    id: receipt.id,
    correlationId: receipt.correlationId,
    operationType: receipt.operationType,
    recipientId: receipt.recipientId,
    purpose: receipt.purpose,
    outcome: receipt.outcome,
    occurredAt: receipt.occurredAt
  };
}
