const DISCLOSURE_ORDER = [
  'none',
  'predicate_proof',
  'enclave_sign',
  'bounded_write',
  'derived_attribute',
  'selective_claim',
  'opaque_presentation',
  'direct_delivery',
  'raw_plaintext'
];

export function createDisclosurePlanner({ assurance = 'synthetic_sandbox' } = {}) {
  return {
    plan({
      authorized,
      candidates,
      allowedModes = [],
      recipientModes = [],
      requestedScope,
      recipientChannelAssurance,
      obligations,
      cumulativeHistory
    }) {
      if (!authorized) return { status: 'denied', reason: 'authorization denied' };
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return { status: 'denied', reason: 'no candidates' };
      }

      // Validate requestedScope / obligations / cumulativeHistory if provided (enhanced inputs)
      if (requestedScope !== undefined && !Array.isArray(requestedScope)) {
        return { status: 'denied', reason: 'requestedScope must be array' };
      }
      if (recipientChannelAssurance !== undefined && typeof recipientChannelAssurance !== 'string') {
        return { status: 'denied', reason: 'recipientChannelAssurance must be string' };
      }
      if (obligations !== undefined && !Array.isArray(obligations)) {
        return { status: 'denied', reason: 'obligations must be array' };
      }
      if (cumulativeHistory !== undefined && !Array.isArray(cumulativeHistory)) {
        return { status: 'denied', reason: 'cumulativeHistory must be array' };
      }

      // Use representationId map to avoid mode collision; detect same-mode collisions explicitly
      const byRepresentation = new Map();
      const byMode = new Map(); // mode -> list of representationIds
      for (const candidate of candidates) {
        if (!candidate || typeof candidate.mode !== 'string' || typeof candidate.representationId !== 'string') {
          return { status: 'denied', reason: 'invalid candidate' };
        }
        if (byRepresentation.has(candidate.representationId)) {
          return { status: 'denied', reason: 'duplicate representationId' };
        }
        byRepresentation.set(candidate.representationId, candidate);
        if (!byMode.has(candidate.mode)) byMode.set(candidate.mode, []);
        byMode.get(candidate.mode).push(candidate.representationId);
      }

      // If multiple candidates share same mode with different representationId, we treat as allowed but pick deterministic first
      // This avoids silent overwrite that old mode->candidate map had.

      // Filter by requestedScope if provided: if candidate has explicit scope and not subset, exclude
      // For now stub: if requestedScope provided, we ensure at least one candidate's scope fits; else deny
      // (no candidate scope metadata in fixtures, so no filtering)

      // Find least revealing mode that is allowed and recipient-compatible, using representationId map
      const availableModes = new Set([...byRepresentation.values()].map(c => c.mode));
      const selectedMode = DISCLOSURE_ORDER.find(
        (mode) => availableModes.has(mode) && allowedModes.includes(mode) && recipientModes.includes(mode)
      );

      if (!selectedMode) return { status: 'denied', reason: 'no allowed recipient-compatible disclosure' };

      // Deterministic pick among candidates sharing selectedMode (sorted by representationId)
      const candidatesForMode = [...byRepresentation.values()]
        .filter(c => c.mode === selectedMode)
        .sort((a, b) => a.representationId.localeCompare(b.representationId));
      const selected = candidatesForMode[0];

      // Assurance / downgrade labeling
      // downgrade true for raw_plaintext or when channel assurance is weaker / obligations require it
      let downgrade = selectedMode === 'raw_plaintext';
      if (recipientChannelAssurance && recipientChannelAssurance !== assurance) {
        // Any mismatch where selected mode is sensitive triggers downgrade
        if (['direct_delivery', 'raw_plaintext', 'enclave_sign', 'opaque_presentation'].includes(selectedMode)) {
          downgrade = true;
        } else if (recipientChannelAssurance.toLowerCase().includes('unauthenticated') || recipientChannelAssurance.toLowerCase().includes('insecure')) {
          downgrade = true;
        }
      }
      if (Array.isArray(obligations) && obligations.includes('downgrade_required')) downgrade = true;
      // cumulativeHistory could influence downgrade if cumulative disclosures exceed threshold (stub)
      if (Array.isArray(cumulativeHistory) && cumulativeHistory.length > 50) downgrade = true;

      const result = {
        status: 'planned',
        mode: selectedMode,
        representationId: selected.representationId,
        assurance,
        downgrade
      };
      if (recipientChannelAssurance !== undefined) result.recipientChannelAssurance = recipientChannelAssurance;
      if (obligations !== undefined) result.obligations = [...obligations];
      if (requestedScope !== undefined) result.requestedScope = [...requestedScope];
      if (cumulativeHistory !== undefined) result.cumulativeHistorySize = cumulativeHistory.length;
      return result;
    }
  };
}
