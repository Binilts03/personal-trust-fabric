import { randomUUID } from 'node:crypto';

import { digestApprovalTerms } from './approval-terms.js';

function parseTime(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function isSubset(childSet, parentSet) {
  if (!parentSet) return true; // parent unrestricted allows any child restriction (narrowing)
  if (!childSet) return true; // child doesn't specify, inherits parent
  // If parent is wildcard ['*'], any child is allowed (since parent allows any)
  if (parentSet.length === 1 && parentSet[0] === '*') return true;
  if (childSet.length === 1 && childSet[0] === '*') {
    // child wildcard '*' while parent is restricted => broadening
    // child trying to allow any when parent restricted to specific set => not narrower
    // So check if parent is unrestricted (already handled) else child wildcard is broader
    return false;
  }
  return childSet.every(v => parentSet.includes(v));
}

function isExpiryNarrower(childExpiry, parentExpiry) {
  if (childExpiry === undefined) return true;
  if (parentExpiry === undefined) return true;
  const childTime = parseTime(childExpiry);
  const parentTime = parseTime(parentExpiry);
  if (childTime === null || parentTime === null) return false;
  return childTime <= parentTime;
}

function isTimeWindowNarrower(childWindow, parentWindow) {
  if (!childWindow) return true;
  if (!parentWindow) return true;
  const childNb = parseTime(childWindow.notBefore);
  const childEa = parseTime(childWindow.expiresAt);
  const parentNb = parseTime(parentWindow.notBefore);
  const parentEa = parseTime(parentWindow.expiresAt);
  if (childNb !== null && parentNb !== null && childNb < parentNb) return false;
  if (childEa !== null && parentEa !== null && childEa > parentEa) return false;
  // also need to ensure child window itself is valid (notBefore <= expiresAt) but that is validated elsewhere
  return true;
}

export function createCapabilityRuntime({
  now = Date.now,
  referenceFactory = () => randomUUID(),
  executors,
  onPersist = null,
  sweepIntervalMs = 5 * 60 * 1000,
  verifier = null
} = {}) {
  const capabilities = new Map();
  const childrenIndex = new Map(); // parentReference -> Set(childReference)
  let sweepTimer = null;

  function sweepExpired() {
    const t = now();
    let changed = false;
    for (const cap of capabilities.values()) {
      if (cap.status === 'active' && t >= cap.expiresAt) {
        cap.status = 'expired';
        changed = true;
      }
      if (cap.status === 'executing' && t >= cap.expiresAt) {
        // executing that expired should become expired or indeterminate? For now mark expired
        cap.status = 'expired';
        changed = true;
      }
      if (cap.status === 'indeterminate' && t >= cap.expiresAt) {
        cap.status = 'expired';
        changed = true;
      }
    }
    if (changed && typeof onPersist === 'function') {
      try { onPersist(); } catch { /* ignore */ }
    }
    return changed;
  }

  function startSweep() {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweepExpired, sweepIntervalMs);
    if (sweepTimer.unref) sweepTimer.unref();
  }
  function stopSweep() {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  }

  function buildDerivationChain(parentCap) {
    if (!parentCap) return [];
    const chain = parentCap.derivationChain ? [...parentCap.derivationChain] : [];
    if (parentCap.reference) chain.push(parentCap.reference);
    // But parentCap may not have reference stored; we use parentReference linkage via map
    // Alternative: use parent's own chain plus parent's reference (we need to know parent reference)
    return chain;
  }

  return {
    issue({ grantId, authorityState, terms, expiresAt, maxUses, parentReference = null, constraints = null }) {
      if (authorityState !== 'active') throw new Error('authority grant is not active');
      if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > terms.requestedUses) {
        throw new Error('capability use count exceeds approved terms');
      }
      if (parentReference !== null && parentReference !== undefined) {
        const parent = capabilities.get(parentReference);
        if (!parent) throw new Error('parent capability not found');
        if (parent.status !== 'active') throw new Error('parent capability is not active');
        if (now() >= parent.expiresAt) {
          parent.status = 'expired';
          if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
          throw new Error('parent capability is expired');
        }
        // For delegation, ensure child expiry <= parent expiry
        if (expiresAt > parent.expiresAt) {
          throw new Error('delegated capability expiry exceeds parent expiry');
        }
        // Ensure maxUses <= parent remainingUses
        if (maxUses > parent.remainingUses) {
          throw new Error('delegated capability uses exceed parent remaining uses');
        }
      }

      const reference = referenceFactory();
      // Normalize terms for storage
      const storedTerms = { ...terms };
      // Preserve amount/currency etc for derive checks
      const cap = {
        grantId,
        termsDigest: digestApprovalTerms(terms),
        terms: storedTerms,
        operationType: terms.operationType,
        recipientId: terms.recipientId,
        expiresAt,
        remainingUses: maxUses,
        status: 'active',
        parentReference: parentReference || null,
        derivedFrom: parentReference || null,
        derivationChain: null,
        createdAt: now(),
        // Store constraints for narrowing checks: use provided constraints or derive from terms
        constraints: constraints ? { ...constraints } : {},
        // Also store explicit capability constraints for derive
        // For backwards compat, store allowed modes etc if available via constraints param
        // If not provided, try to infer from maxUses/expiresAt
        error: null,
        reference // store self reference for chain building
      };
      // Build derivation chain
      if (parentReference) {
        const parent = capabilities.get(parentReference);
        const parentChain = parent?.derivationChain ? [...parent.derivationChain] : [];
        // Parent's chain plus parent reference
        // Also include parent's reference itself
        const chain = [...parentChain];
        if (parent) {
          // Ensure parent's chain includes its own ancestors; we add parentReference
          // But avoid duplicate if chain already ends with parentReference
          if (chain[chain.length - 1] !== parentReference) chain.push(parentReference);
        }
        cap.derivationChain = chain;
        // Also ensure derivedFrom is immediate parent
        cap.derivedFrom = parentReference;
      } else {
        cap.derivationChain = [];
        cap.derivedFrom = null;
      }

      capabilities.set(reference, cap);
      if (parentReference) {
        if (!childrenIndex.has(parentReference)) childrenIndex.set(parentReference, new Set());
        childrenIndex.get(parentReference).add(reference);
      }
      if (!childrenIndex.has(reference)) childrenIndex.set(reference, new Set());
      if (typeof onPersist === 'function') {
        try { onPersist(); } catch {}
      }
      const issued = { reference, status: 'active', expiresAt, remainingUses: maxUses };
      if (parentReference) {
        issued.parentReference = parentReference;
        issued.derivedFrom = parentReference;
      }
      return issued;
    },

    derive(parentReference, newConstraints = {}) {
      sweepExpired();
      if (typeof parentReference !== 'string' || parentReference.length === 0) throw new TypeError('parentReference must be non-empty string');
      if (!newConstraints || typeof newConstraints !== 'object' || Array.isArray(newConstraints)) throw new TypeError('constraints must be an object');
      const parent = capabilities.get(parentReference);
      if (!parent) throw new Error('parent capability not found');
      if (parent.status !== 'active') throw new Error('parent capability is not active');
      if (now() >= parent.expiresAt) {
        parent.status = 'expired';
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        throw new Error('parent capability is expired');
      }

      // Validate narrowing for each dimension
      // expiry
      if (newConstraints.expiresAt !== undefined) {
        const newExp = parseTime(newConstraints.expiresAt);
        if (newExp === null) throw new TypeError('constraints.expiresAt must be valid timestamp');
        if (newExp > parent.expiresAt) throw new Error('derived expiry exceeds parent expiry');
      }
      if (newConstraints.expiresAt !== undefined && newConstraints.expiresAt !== null) {
        // also check notBefore if provided via timeWindow
      }
      // uses
      const newMaxUses = newConstraints.maxUses ?? newConstraints.remainingUses ?? newConstraints.useCount ?? newConstraints.requestedUses;
      if (newMaxUses !== undefined) {
        if (!Number.isSafeInteger(newMaxUses) || newMaxUses < 1) throw new TypeError('derived maxUses must be positive safe integer');
        if (newMaxUses > parent.remainingUses) throw new Error('derived uses exceed parent remaining uses');
      }
      // amountMinor
      if (newConstraints.amountMinor !== undefined && newConstraints.amountMinor !== null) {
        if (!Number.isSafeInteger(newConstraints.amountMinor) || newConstraints.amountMinor < 0) throw new TypeError('derived amountMinor must be non-negative safe integer');
        const parentAmount = parent.terms?.amountMinor;
        if (parentAmount !== null && parentAmount !== undefined) {
          if (newConstraints.amountMinor > parentAmount) throw new Error('derived amount exceeds parent amount');
        }
        // also check against parent constraints maxAmountMinor if stored
        if (parent.constraints?.maxAmountMinor !== undefined && newConstraints.amountMinor > parent.constraints.maxAmountMinor) {
          throw new Error('derived amount exceeds parent amount limit');
        }
      }
      // currencies / currency
      if (newConstraints.currencies !== undefined || newConstraints.currency !== undefined) {
        const childCurrencies = newConstraints.currencies ?? (newConstraints.currency ? [newConstraints.currency] : undefined);
        if (childCurrencies !== undefined) {
          const childArr = Array.isArray(childCurrencies) ? childCurrencies.map(c => String(c).toUpperCase()) : [String(childCurrencies).toUpperCase()];
          if (childArr.some(c => c !== '*' && !/^[A-Z]{3}$/.test(c))) throw new TypeError('derived currencies must be 3-letter codes');
          // Get parent currencies
          const parentCurrencies = parent.constraints?.currencies ?? parent.constraints?.currency ?? (parent.terms?.currency ? [parent.terms.currency] : undefined);
          let parentArr;
          if (parentCurrencies) {
            parentArr = Array.isArray(parentCurrencies) ? parentCurrencies.map(c => String(c).toUpperCase()) : [String(parentCurrencies).toUpperCase()];
          }
          if (parentArr && !parentArr.includes('*')) {
            // child must be subset of parent
            if (childArr.includes('*')) throw new Error('derived currencies broaden parent currencies');
            if (!childArr.every(c => parentArr.includes(c))) throw new Error('derived currencies not subset of parent');
          }
        }
      }
      // allowedModes / representationMode
      if (newConstraints.allowedModes !== undefined || newConstraints.representationMode !== undefined || newConstraints.representationModes !== undefined) {
        const childModes = newConstraints.allowedModes ?? newConstraints.representationModes ?? (newConstraints.representationMode ? [newConstraints.representationMode] : undefined);
        if (childModes !== undefined) {
          const childArr = Array.isArray(childModes) ? [...childModes] : [childModes];
          if (childArr.some(m => typeof m !== 'string' || m.length === 0)) throw new TypeError('derived allowedModes must be non-empty strings');
          const parentModes = parent.constraints?.allowedModes ?? parent.constraints?.representationModes ?? parent.constraints?.representationMode;
          let parentArr;
          if (parentModes) parentArr = Array.isArray(parentModes) ? [...parentModes] : [parentModes];
          if (parentArr && !parentArr.includes('*')) {
            if (childArr.includes('*')) throw new Error('derived modes broaden parent modes');
            if (!childArr.every(m => parentArr.includes(m))) throw new Error('derived modes not subset of parent');
          }
        }
      }
      // assurance
      if (newConstraints.assurance !== undefined || newConstraints.assuranceLevels !== undefined) {
        const childAss = newConstraints.assurance ?? newConstraints.assuranceLevels;
        if (childAss !== undefined) {
          const childArr = Array.isArray(childAss) ? [...childAss] : [childAss];
          const parentAss = parent.constraints?.assurance ?? parent.constraints?.assuranceLevels ?? parent.terms?.assurance;
          let parentArr;
          if (parentAss) parentArr = Array.isArray(parentAss) ? [...parentAss] : [parentAss];
          if (parentArr && !parentArr.includes('*')) {
            if (childArr.includes('*')) throw new Error('derived assurance broadens parent');
            if (!childArr.every(a => parentArr.includes(a))) throw new Error('derived assurance not subset of parent');
          }
        }
      }
      // geography
      if (newConstraints.geography !== undefined || newConstraints.geographies !== undefined) {
        const childGeo = newConstraints.geography ?? newConstraints.geographies;
        if (childGeo !== undefined) {
          const childArr = Array.isArray(childGeo) ? [...childGeo] : [childGeo];
          const parentGeo = parent.constraints?.geography ?? parent.constraints?.geographies ?? parent.terms?.geography;
          let parentArr;
          if (parentGeo) parentArr = Array.isArray(parentGeo) ? [...parentGeo] : [parentGeo];
          if (parentArr && !parentArr.includes('*')) {
            if (childArr.includes('*')) throw new Error('derived geography broadens parent');
            if (!childArr.every(g => parentArr.includes(g))) throw new Error('derived geography not subset of parent');
          }
        }
      }
      // claimIds / allowedClaims
      if (newConstraints.allowedClaims !== undefined || newConstraints.allowedClaimIds !== undefined || newConstraints.claimIds !== undefined) {
        const childClaims = newConstraints.allowedClaims ?? newConstraints.allowedClaimIds ?? newConstraints.claimIds;
        if (childClaims !== undefined) {
          if (!Array.isArray(childClaims)) throw new TypeError('derived claimIds must be array');
          const parentClaims = parent.constraints?.allowedClaims ?? parent.constraints?.allowedClaimIds ?? parent.constraints?.claimIds ?? parent.terms?.claimIds;
          if (parentClaims && !parentClaims.includes('*')) {
            if (childClaims.includes('*')) throw new Error('derived claimIds broaden parent claimIds');
            if (!childClaims.every(c => parentClaims.includes(c))) throw new Error('derived claimIds not subset of parent');
          } else if (!parentClaims) {
            // parent has no claim restriction (empty or undefined means only empty allowed per spec, but for derive we allow narrowing to add claim restriction)
            // If parent has no claimIds (undefined), child specifying claimIds is narrowing (adds restriction) – allow
            // If parent has empty (means no claims allowed) and child tries to add claims, that's broadening
            if (parentClaims && parentClaims.length === 0 && childClaims.length > 0) throw new Error('derived claimIds broaden parent claimIds');
          }
        }
      }
      // timeWindow
      if (newConstraints.timeWindow !== undefined) {
        const tw = newConstraints.timeWindow;
        if (!tw || typeof tw !== 'object' || Array.isArray(tw)) throw new TypeError('derived timeWindow must be object');
        const newNb = parseTime(tw.notBefore);
        const newEa = parseTime(tw.expiresAt);
        if (tw.notBefore !== undefined && newNb === null) throw new TypeError('derived timeWindow.notBefore must be valid timestamp');
        if (tw.expiresAt !== undefined && newEa === null) throw new TypeError('derived timeWindow.expiresAt must be valid timestamp');
        // Determine parent window: either parent's timeWindow constraint or parent's expiresAt/notBefore
        const parentWindow = parent.constraints?.timeWindow ?? (parent.expiresAt ? { notBefore: parent.createdAt ? new Date(parent.createdAt).toISOString() : undefined, expiresAt: new Date(parent.expiresAt).toISOString() } : null);
        const parentNb = parentWindow ? parseTime(parentWindow.notBefore) : null;
        const parentEa = parentWindow ? parseTime(parentWindow.expiresAt) : null;
        if (newNb !== null && parentNb !== null && newNb < parentNb) throw new Error('derived timeWindow notBefore is broader than parent');
        if (newEa !== null && parentEa !== null && newEa > parentEa) throw new Error('derived timeWindow expiresAt is broader than parent');
        // Also ensure child window itself is valid
        if (newNb !== null && newEa !== null && newNb > newEa) throw new Error('derived timeWindow is invalid');
      }
      // delegationDepth
      if (newConstraints.delegationDepth !== undefined || newConstraints.maxDelegationDepth !== undefined) {
        const childDepth = newConstraints.delegationDepth ?? newConstraints.maxDelegationDepth;
        if (childDepth !== undefined) {
          if (!Number.isSafeInteger(childDepth) || childDepth < 0) throw new TypeError('derived delegationDepth must be non-negative safe integer');
          const parentDepth = parent.constraints?.delegationDepth ?? parent.constraints?.maxDelegationDepth ?? parent.terms?.delegationDepth;
          if (parentDepth !== undefined && childDepth > parentDepth) throw new Error('derived delegationDepth exceeds parent');
        }
      }
      // Generic check: any other constraint trying to broaden numeric limits
      // For maxAmountMinor etc, ensure child <= parent if both defined
      if (newConstraints.maxAmountMinor !== undefined) {
        if (!Number.isSafeInteger(newConstraints.maxAmountMinor) || newConstraints.maxAmountMinor < 0) throw new TypeError('derived maxAmountMinor must be non-negative safe integer');
        const parentMax = parent.constraints?.maxAmountMinor ?? parent.terms?.amountMinor;
        if (parentMax !== undefined && parentMax !== null && newConstraints.maxAmountMinor > parentMax) throw new Error('derived maxAmountMinor exceeds parent');
      }

      // Passed all checks, create child
      const reference = referenceFactory();
      const childExpiresAt = newConstraints.expiresAt !== undefined ? parseTime(newConstraints.expiresAt) ?? parent.expiresAt : Math.min(newConstraints.timeWindow?.expiresAt ? parseTime(newConstraints.timeWindow.expiresAt) ?? parent.expiresAt : parent.expiresAt, parent.expiresAt);
      // Determine remaining uses
      let childRemainingUses;
      if (newConstraints.maxUses !== undefined) childRemainingUses = newConstraints.maxUses;
      else if (newConstraints.remainingUses !== undefined) childRemainingUses = newConstraints.remainingUses;
      else if (newConstraints.requestedUses !== undefined) childRemainingUses = newConstraints.requestedUses;
      else childRemainingUses = parent.remainingUses; // inherit
      // Ensure childRemainingUses <= parent.remainingUses already checked
      // If parent remainingUses is 1 and child inherits 1, okay
      // Build child terms: copy parent terms but override with narrowing? For now keep same terms
      const childTerms = { ...parent.terms };
      // If newConstraints overrides amountMinor/currency etc, update childTerms? But that would change digest - need to keep consistent?
      // We keep digest same as parent for now unless terms changed explicitly via newConstraints.terms
      if (newConstraints.terms) {
        Object.assign(childTerms, newConstraints.terms);
      }
      // Allow explicit amountMinor override to narrow
      if (newConstraints.amountMinor !== undefined) childTerms.amountMinor = newConstraints.amountMinor;
      if (newConstraints.currency !== undefined) childTerms.currency = newConstraints.currency ? String(newConstraints.currency).toUpperCase() : null;
      if (newConstraints.claimIds !== undefined) childTerms.claimIds = [...newConstraints.claimIds];
      if (newConstraints.transactionId !== undefined) childTerms.transactionId = newConstraints.transactionId;

      const childDigest = digestApprovalTerms(childTerms);

      // Merge constraints: parent constraints plus new narrower constraints
      const childConstraints = { ...(parent.constraints ?? {}) };
      for (const [k, v] of Object.entries(newConstraints)) {
        if (k === 'expiresAt' || k === 'maxUses' || k === 'remainingUses' || k === 'requestUses' || k === 'timeWindow' || k === 'terms') continue;
        // For set fields, store as provided
        childConstraints[k] = Array.isArray(v) ? [...v] : (v && typeof v === 'object' ? { ...v } : v);
      }
      if (newConstraints.timeWindow) childConstraints.timeWindow = { ...newConstraints.timeWindow };
      // Ensure expiresAt stored correctly
      const finalExpiresAt = newConstraints.expiresAt !== undefined ? parseTime(newConstraints.expiresAt) : parent.expiresAt;
      const finalRemainingUses = childRemainingUses;

      const cap = {
        grantId: `grant:derived:${parent.grantId}`,
        termsDigest: childDigest,
        terms: childTerms,
        operationType: childTerms.operationType ?? parent.operationType,
        recipientId: childTerms.recipientId ?? parent.recipientId,
        expiresAt: finalExpiresAt,
        remainingUses: finalRemainingUses,
        status: 'active',
        parentReference,
        derivedFrom: parentReference,
        derivationChain: [...(parent.derivationChain ?? []), parentReference],
        createdAt: now(),
        constraints: childConstraints,
        error: null,
        reference
      };

      capabilities.set(reference, cap);
      if (!childrenIndex.has(parentReference)) childrenIndex.set(parentReference, new Set());
      childrenIndex.get(parentReference).add(reference);
      if (!childrenIndex.has(reference)) childrenIndex.set(reference, new Set());
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }

      return { reference, status: 'active', expiresAt: finalExpiresAt, remainingUses: finalRemainingUses, parentReference, derivedFrom: parentReference, derivationChain: [...cap.derivationChain] };
    },

    async execute({ reference, terms, recipientProof }) {
      sweepExpired();
      const capability = capabilities.get(reference);
      if (!capability) throw new Error('capability is not active');
      // Handle indeterminate retry: allow retry if previous was indeterminate
      const isRetry = capability.status === 'indeterminate';
      if (capability.status === 'executing') throw new Error('capability is not active');
      if (capability.status !== 'active' && !isRetry) {
        // For expired, consumed, revoked etc, not active
        throw new Error('capability is not active');
      }
      if (now() >= capability.expiresAt) {
        capability.status = 'expired';
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        throw new Error('capability is expired');
      }
      // Recipient auth
      if (verifier && typeof verifier.verifyRecipientAuth === 'function') {
        if (!recipientProof?.recipientAuthToken || typeof recipientProof.recipientAuthToken !== 'string' || recipientProof.recipientId !== capability.recipientId) {
          throw new Error('recipient authentication mismatch');
        }
        const ok = verifier.verifyRecipientAuth({ reference, recipientId: recipientProof.recipientId, recipientAuthToken: recipientProof.recipientAuthToken });
        if (!ok) throw new Error('recipient authentication mismatch');
      } else {
        if (!recipientProof?.authenticated || recipientProof.recipientId !== capability.recipientId) {
          throw new Error('recipient authentication mismatch');
        }
      }
      if (digestApprovalTerms(terms) !== capability.termsDigest) {
        throw new Error('approval terms mismatch');
      }
      const executor = executors[capability.operationType];
      if (!executor) throw new Error('unsupported operation type');

      // State transition to executing
      // For retry (indeterminate), do NOT decrement again (idempotency)
      const shouldDecrement = !isRetry;
      if (shouldDecrement) {
        capability.remainingUses -= 1;
      }
      capability.status = 'executing';
      capability.error = null;
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }

      try {
        const result = await executor(terms);
        // Success: determine final status based on remainingUses
        // If remainingUses was decremented to 0, mark consumed, else active
        // For retry case, remainingUses already reflects previous decrement, so same logic
        if (capability.remainingUses <= 0) {
          capability.status = 'consumed';
        } else {
          capability.status = 'active';
        }
        capability.error = null;
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        return { status: 'completed', ...result };
      } catch (e) {
        // Failure handling: set indeterminate unless known terminal
        // Determine if known terminal: e.message indicates consumed, expired, revoked etc?
        // For now, treat as indeterminate for generic provider failures, allowing retry
        // If error is due to terms mismatch etc, it's terminal and we should consume? But spec says consumed if known terminal
        const terminalMessages = ['approval terms mismatch', 'recipient authentication mismatch', 'unsupported operation type', 'capability is expired'];
        const isTerminal = terminalMessages.some(m => e.message && e.message.includes(m));
        if (isTerminal) {
          // For terminal, if remainingUses was already decremented and now 0, mark consumed, else indeterminate? Spec says consumed if known terminal
          // We'll mark as consumed if uses exhausted, else indeterminate but store error
          if (capability.remainingUses <= 0) capability.status = 'consumed';
          else capability.status = 'indeterminate';
        } else {
          capability.status = 'indeterminate';
        }
        capability.error = e.message;
        if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
        // Re-throw with provider failure wrapping? Original code wraps? For capability-runtime, just throw original
        throw e;
      }
    },

    getStatus(reference) {
      sweepExpired();
      const capability = capabilities.get(reference);
      if (!capability) return { status: 'unknown' };
      return {
        status: capability.status,
        expiresAt: capability.expiresAt,
        remainingUses: capability.remainingUses,
        operationType: capability.operationType,
        recipientId: capability.recipientId,
        parentReference: capability.parentReference ?? null,
        derivedFrom: capability.derivedFrom ?? capability.parentReference ?? null,
        derivationChain: capability.derivationChain ? [...capability.derivationChain] : [],
        error: capability.error ?? null,
        createdAt: capability.createdAt ?? null
      };
    },

    revoke(reference) {
      sweepExpired();
      const capability = capabilities.get(reference);
      if (!capability) return false;
      const stack = [reference];
      const visited = new Set();
      while (stack.length > 0) {
        const ref = stack.pop();
        if (visited.has(ref)) continue;
        visited.add(ref);
        const cap = capabilities.get(ref);
        if (!cap) continue;
        if (cap.status !== 'revoked') cap.status = 'revoked';
        const children = childrenIndex.get(ref);
        if (children) {
          for (const child of children) stack.push(child);
        }
      }
      if (typeof onPersist === 'function') { try { onPersist(); } catch {} }
      return true;
    },

    listActive() {
      sweepExpired();
      const nowMs = now();
      const list = [];
      for (const [reference, cap] of capabilities.entries()) {
        if (cap.status === 'active' && nowMs < cap.expiresAt && cap.remainingUses > 0) {
          list.push({
            reference,
            status: cap.status,
            operationType: cap.operationType,
            recipientId: cap.recipientId,
            expiresAt: cap.expiresAt,
            remainingUses: cap.remainingUses,
            parentReference: cap.parentReference ?? null,
            derivedFrom: cap.derivedFrom ?? null,
            grantId: cap.grantId
          });
        }
      }
      return list;
    },

    listAll() {
      sweepExpired();
      return [...capabilities.entries()].map(([reference, cap]) => ({
        reference,
        status: cap.status,
        operationType: cap.operationType,
        recipientId: cap.recipientId,
        expiresAt: cap.expiresAt,
        remainingUses: cap.remainingUses,
        parentReference: cap.parentReference ?? null,
        derivedFrom: cap.derivedFrom ?? null,
        derivationChain: cap.derivationChain ? [...cap.derivationChain] : [],
        grantId: cap.grantId,
        createdAt: cap.createdAt,
        error: cap.error ?? null
      }));
    },

    exportState() {
      const out = {};
      for (const [ref, cap] of capabilities.entries()) {
        out[ref] = { ...cap };
        // Ensure derivationChain is array copy
        if (cap.derivationChain) out[ref].derivationChain = [...cap.derivationChain];
        if (cap.terms) out[ref].terms = { ...cap.terms, claimIds: cap.terms.claimIds ? [...cap.terms.claimIds] : cap.terms.claimIds };
        if (cap.constraints) out[ref].constraints = { ...cap.constraints };
        if (cap.children) out[ref].children = [...cap.children];
      }
      const childrenOut = {};
      for (const [p, set] of childrenIndex.entries()) childrenOut[p] = [...set];
      return { capabilities: out, childrenIndex: childrenOut };
    },

    importState(state) {
      capabilities.clear();
      childrenIndex.clear();
      if (!state || typeof state !== 'object') return;
      const caps = state.capabilities || {};
      for (const [ref, cap] of Object.entries(caps)) {
        capabilities.set(ref, { ...cap });
        // Ensure derivationChain is array
        if (cap.derivationChain && !Array.isArray(cap.derivationChain)) cap.derivationChain = [];
      }
      const idx = state.childrenIndex || {};
      for (const [p, arr] of Object.entries(idx)) {
        childrenIndex.set(p, new Set(arr));
      }
      for (const ref of capabilities.keys()) {
        if (!childrenIndex.has(ref)) childrenIndex.set(ref, new Set());
      }
    },

    sweepExpired,
    startSweep,
    stopSweep
  };
}
