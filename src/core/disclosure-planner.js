const DISCLOSURE_ORDER = [
  'none',
  'enclave_sign',
  'bounded_write',
  'predicate_proof',
  'derived_attribute',
  'selective_claim',
  'opaque_presentation',
  'direct_delivery',
  'raw_plaintext'
];

export function createDisclosurePlanner({ assurance = 'synthetic_sandbox' } = {}) {
  return {
    plan({ authorized, candidates, allowedModes = [], recipientModes = [] }) {
      if (!authorized) return { status: 'denied', reason: 'authorization denied' };

      const available = new Map(candidates.map((candidate) => [candidate.mode, candidate]));
      const selectedMode = DISCLOSURE_ORDER.find(
        (mode) => available.has(mode) && allowedModes.includes(mode) && recipientModes.includes(mode)
      );

      if (!selectedMode) return { status: 'denied', reason: 'no allowed recipient-compatible disclosure' };
      const selected = available.get(selectedMode);
      return {
        status: 'planned',
        mode: selectedMode,
        representationId: selected.representationId,
        assurance,
        downgrade: selectedMode === 'raw_plaintext'
      };
    }
  };
}
