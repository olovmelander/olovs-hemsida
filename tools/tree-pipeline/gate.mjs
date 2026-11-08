/* The held-out gate and the owner's exceptions to it.

   The workflow's target (docs/tree-placement-workflow.md, "Benchmark gate")
   is at least 90% precision AND 90% recall on clearly distinguishable
   reference crowns that the detector's tuning never saw, on a sample of at
   least 30 scored crowns. The thresholds are constants: no config, flag or
   benchmark file can lower them. A failed gate stays FAIL; publication may
   still go ahead only when the OWNER has recorded an exception in the
   ground's config that pins the very benchmark file it accepted (its SHA-256)
   and restates the measured numbers, so a re-scored or re-tuned benchmark
   never inherits an old exception.

   A held-out sample is spent once it has been scored: tuning again and
   rescoring the same sample would turn it into a calibration sample. The
   guards below refuse that; the remedy is a new round with a new sample. */

export const HELD_OUT_GATE = Object.freeze({
  id: 'held-out-precision-recall',
  precision: 0.9,
  recall: 0.9,
  minimumScoredCrowns: 30,
});

const round3 = value => Math.round(value * 1000) / 1000;

/**
 * Evaluate the gate on a benchmark document (benchmark<suffix>.json) for a
 * round: the round's own detector (round.methodName) on its evaluation role.
 */
export function evaluateGate(benchmark, round) {
  const reasons = [];
  const result = benchmark?.results?.[round.methodName]?.[round.evaluationRole];
  if (!result) {
    return Object.freeze({ gate: HELD_OUT_GATE.id, status: 'FAIL', round: round.id, method: round.methodName, role: round.evaluationRole, measured: null,
      reasons: Object.freeze([`no ${round.evaluationRole} score for ${round.methodName} in the benchmark`]) });
  }
  const recorded = benchmark.gate || {};
  if (Number.isFinite(recorded.precision) && recorded.precision < HELD_OUT_GATE.precision) reasons.push(`the benchmark file declares a lowered precision gate (${recorded.precision}); the gate is ${HELD_OUT_GATE.precision}`);
  if (Number.isFinite(recorded.recall) && recorded.recall < HELD_OUT_GATE.recall) reasons.push(`the benchmark file declares a lowered recall gate (${recorded.recall}); the gate is ${HELD_OUT_GATE.recall}`);
  const scored = result.tp + result.missed;
  const measured = Object.freeze({ precision: result.precision, recall: result.recall, f1: result.f1, tp: result.tp, missed: result.missed, extra: result.extra, scored });
  if (!(scored >= HELD_OUT_GATE.minimumScoredCrowns)) reasons.push(`only ${scored} scored held-out crowns; at least ${HELD_OUT_GATE.minimumScoredCrowns} are needed`);
  if (!(result.precision >= HELD_OUT_GATE.precision)) reasons.push(`precision ${result.precision} is below ${HELD_OUT_GATE.precision}`);
  if (!(result.recall >= HELD_OUT_GATE.recall)) reasons.push(`recall ${result.recall} is below ${HELD_OUT_GATE.recall}`);
  return Object.freeze({
    gate: HELD_OUT_GATE.id, status: reasons.length ? 'FAIL' : 'PASS', round: round.id, method: round.methodName, role: round.evaluationRole,
    thresholds: { precision: HELD_OUT_GATE.precision, recall: HELD_OUT_GATE.recall, minimumScoredCrowns: HELD_OUT_GATE.minimumScoredCrowns },
    measured, reasons: Object.freeze(reasons),
  });
}

/**
 * The owner exception that covers this failed gate, or null. It must name the
 * gate and round, pin the benchmark file by SHA-256 and restate the measured
 * precision and recall (to three decimals).
 */
export function ownerExceptionFor(config, gateResult, benchmarkSha256) {
  const matches = (config.ownerExceptions || []).filter(x => x.gate === gateResult.gate && x.round === gateResult.round);
  for (const exception of matches) {
    if (exception.decidedBy !== 'owner') continue;
    if (exception.benchmark?.sha256 !== benchmarkSha256) continue;
    if (!gateResult.measured) continue;
    if (round3(exception.measured.precision) !== round3(gateResult.measured.precision) || round3(exception.measured.recall) !== round3(gateResult.measured.recall)) continue;
    return exception;
  }
  return null;
}

/**
 * A pending-owner-approval record for this failed gate, or null: it pins the
 * same benchmark and restates the same numbers, but it is NOT an exception
 * (publicationVerdict never accepts it). The publish stage may stage a
 * pending round only when asked to (--pending-owner), and labels it so.
 */
export function pendingApprovalFor(config, gateResult, benchmarkSha256) {
  for (const x of (config.pendingOwnerApprovals || []).filter(y => y.gate === gateResult.gate && y.round === gateResult.round)) {
    if (x.status !== 'pending-owner-approval' || x.benchmark?.sha256 !== benchmarkSha256 || !gateResult.measured) continue;
    if (round3(x.measured.precision) !== round3(gateResult.measured.precision) || round3(x.measured.recall) !== round3(gateResult.measured.recall)) continue;
    return x;
  }
  return null;
}

/** Why each recorded exception for this gate does not apply (for the report). */
export function staleExceptions(config, gateResult, benchmarkSha256) {
  return (config.ownerExceptions || []).filter(x => x.gate === gateResult.gate && x.round === gateResult.round).map(x => ({
    decidedOn: x.decidedOn,
    why: x.benchmark?.sha256 !== benchmarkSha256 ? 'it accepted another benchmark file (re-scored or re-tuned since)'
      : !gateResult.measured ? 'the benchmark has no score for the round'
      : 'its restated precision/recall do not match the benchmark',
  }));
}

/**
 * Whether publication may proceed: PASS, or FAIL with a matching owner
 * exception. The gate status itself is never rewritten.
 */
export function publicationVerdict(gateResult, exception) {
  if (gateResult.status === 'PASS') return Object.freeze({ allowed: true, gate: 'PASS', note: 'held-out gate passed' });
  if (exception) {
    return Object.freeze({ allowed: true, gate: 'FAIL', ownerException: { decidedOn: exception.decidedOn, record: exception.record },
      note: `held-out gate FAILED (${gateResult.reasons.join('; ')}); published only under the owner's exception of ${exception.decidedOn} (${exception.record})` });
  }
  return Object.freeze({ allowed: false, gate: 'FAIL',
    note: `held-out gate FAILED (${gateResult.reasons.join('; ')}). Stop and ask the owner: improve the method with a new round and a new unseen sample, or record an owner exception in trees.json pinning this benchmark.` });
}

/**
 * Refuse to tune a round whose held-out sample has already been scored, and
 * refuse to rescore a sample against a detector lock other than the one it was
 * first scored with. `existing` is the round's benchmark document or null.
 */
export function assertHeldOutUnseen({ action, existing, lockSha256 = null, roundId }) {
  if (!existing) return;
  if (action === 'tune') {
    throw new Error(`round ${roundId}'s held-out sample was scored at ${existing.scoredAt}: tuning again would tune on it. Declare a new round with a new, unseen sample (and mark this one used-holdout).`);
  }
  if (action === 'score' && lockSha256 && existing.detectorLockSha256 && existing.detectorLockSha256 !== lockSha256) {
    throw new Error(`round ${roundId}'s held-out sample was scored against detector lock ${existing.detectorLockSha256.slice(0, 12)}; the lock is now ${lockSha256.slice(0, 12)}. A changed detector needs a new round with a new, unseen sample.`);
  }
}
