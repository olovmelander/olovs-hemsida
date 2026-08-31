/* Measure the manifest-driven streaming runtime against a real published
   graph, in the real app, WITHOUT letting it touch the visible ground.
   Activation needs evidence the plan names — time to a first-visible shell,
   time to a refined active hole, resident tiles, draw calls, decoded bytes —
   and a correctness statement that its worker/decode path reproduces the
   heights the verified pilot already renders. A probe that renders nothing
   can produce both without risking the course anyone is looking at. */

export const V2_STREAM_PROBE_BUDGETS = Object.freeze({
  /* From the plan's performance table. Recorded on every run and compared,
     but a software-adapter runner is not a reference device: the verdict is
     evidence for a human, never an automatic activation. */
  shellVisibleMilliseconds: 3000,
  activeHoleRefinedMilliseconds: 5000,
  terrainDrawCalls: 8,
});

export const V2_STREAM_PARITY_TOLERANCE_METRES = 0.011;

export function v2StreamProbeRequested(search = globalThis.location?.search || '') {
  return new URLSearchParams(search).get('v2stream') === '1';
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? +value.toFixed(1) : null;
}

/**
 * Compare the streaming runtime's CPU heights against the already verified
 * pilot sampler over the ground both cover. The pilot frontier is a subgrid of
 * the published graph, so agreement here means the worker decode, the tile
 * selection and the frame bridge all reproduce heights that have already been
 * accepted — measured like with like rather than asserted.
 */
export function compareStreamHeights({ bounds, streamHeightAt, pilotHeightAt, samples = 24 }) {
  if (!bounds || ![bounds.x0, bounds.x1, bounds.z0, bounds.z1].every(Number.isFinite)) {
    throw new TypeError('finite probe bounds are required');
  }
  if (typeof streamHeightAt !== 'function' || typeof pilotHeightAt !== 'function') {
    throw new TypeError('both height samplers are required');
  }
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 256) {
    throw new RangeError('samples must be an integer from 2 to 256');
  }
  let compared = 0;
  let agreed = 0;
  let streamMissing = 0;
  let pilotMissing = 0;
  let maximumAbsoluteDifferenceMetres = 0;
  /* Inset by one step so a sample never lands exactly on the shared frontier
     edge, where either sampler may legitimately report nothing. */
  const stepX = (bounds.x1 - bounds.x0) / (samples + 1);
  const stepZ = (bounds.z1 - bounds.z0) / (samples + 1);
  for (let row = 1; row <= samples; row++) {
    for (let column = 1; column <= samples; column++) {
      const x = bounds.x0 + column * stepX;
      const z = bounds.z0 + row * stepZ;
      const streamSample = streamHeightAt(x, z);
      const streamHeight = Number.isFinite(streamSample) ? streamSample : streamSample?.height;
      const pilotHeight = pilotHeightAt(x, z);
      if (!Number.isFinite(streamHeight)) { streamMissing++; continue; }
      if (!Number.isFinite(pilotHeight)) { pilotMissing++; continue; }
      compared++;
      const difference = Math.abs(streamHeight - pilotHeight);
      maximumAbsoluteDifferenceMetres = Math.max(maximumAbsoluteDifferenceMetres, difference);
      if (difference <= V2_STREAM_PARITY_TOLERANCE_METRES) agreed++;
    }
  }
  return Object.freeze({
    requested: samples * samples,
    compared,
    agreed,
    streamMissing,
    pilotMissing,
    maximumAbsoluteDifferenceMetres: +maximumAbsoluteDifferenceMetres.toFixed(4),
    agreedFraction: compared ? agreed / compared : 0,
  });
}

export function summarizeStreamProbe({ timings, snapshot, parity, budgets = V2_STREAM_PROBE_BUDGETS }) {
  const renderer = snapshot?.renderer || {};
  const stream = snapshot?.stream || {};
  const shellMs = finiteOrNull(timings?.shellVisibleMilliseconds);
  const refinedMs = finiteOrNull(timings?.activeHoleRefinedMilliseconds);
  return Object.freeze({
    kind: 'v2-stream-probe',
    /* Software-adapter CI is shader and correctness evidence, never hardware
       performance, so the budget columns record a comparison and explicitly
       do not authorise anything. */
    performanceEvidence: false,
    backend: snapshot?.backend ?? null,
    mobile: snapshot?.mobile ?? null,
    timings: Object.freeze({
      shellVisibleMilliseconds: shellMs,
      activeHoleRefinedMilliseconds: refinedMs,
      /* A run that ran out of time is a timeout, not a failure and not a
         zero: without these a starved software-adapter run reads exactly
         like a broken streaming path. */
      settledBeforeDeadline: timings?.settledBeforeDeadline === true,
      deadlineMilliseconds: timings?.deadlineMilliseconds ?? null,
      parityMilliseconds: finiteOrNull(timings?.parityMilliseconds),
      elapsedMilliseconds: finiteOrNull(timings?.elapsedMilliseconds),
    }),
    budgets: Object.freeze({
      shellVisibleMilliseconds: budgets.shellVisibleMilliseconds,
      activeHoleRefinedMilliseconds: budgets.activeHoleRefinedMilliseconds,
      terrainDrawCalls: budgets.terrainDrawCalls,
      shellWithinBudget: shellMs !== null && shellMs <= budgets.shellVisibleMilliseconds,
      activeHoleWithinBudget: refinedMs !== null && refinedMs <= budgets.activeHoleRefinedMilliseconds,
      drawCallsWithinBudget: Number.isSafeInteger(renderer.drawCalls) &&
        renderer.drawCalls <= budgets.terrainDrawCalls,
    }),
    renderer: Object.freeze({
      renderedTiles: renderer.renderedTiles ?? null,
      residentLayers: renderer.residentLayers ?? null,
      drawCalls: renderer.drawCalls ?? null,
    }),
    stream: Object.freeze({
      readyTiles: stream.readyTileIds?.length ?? null,
      loadingTiles: stream.loadingTileIds?.length ?? null,
      failedTiles: stream.failedTileIds?.length ?? null,
      activeTileIds: Object.freeze([...(stream.plan?.activeTileIds || [])]),
    }),
    requests: snapshot?.requests ?? null,
    parity,
    /* One boolean a reviewer can act on: did the streaming path reproduce the
       accepted ground, and did it stream without losing a tile? Performance
       stays a reported comparison. */
    correctnessPassed: parity?.compared >= 1 &&
      parity.agreedFraction === 1 &&
      parity.streamMissing === 0 &&
      (stream.failedTileIds?.length ?? 1) === 0 &&
      (renderer.renderedTiles ?? 0) >= 1,
  });
}
