/* How a timing tool loads the app, and whether the GPU is free to be timed.

   Timing tools measure normal use: no ?det=1, and ?qualitylock=1 with an
   explicit ?q= so the quality cannot change mid-run. det=1 is for pixel
   captures only; it distorts timing both ways (docs/performance-plan-
   2026-09-23.md, section 2): it cold-solves all eighteen flag cloths every
   frame (a flat ~40 ms at Puttom) and it hides the shadow re-render that
   float noise in the sun used to cause. `--det` puts it back for a
   comparison with an older number.

   Another tab or browser drawing on the same GPU inflates every timing, so
   a run refuses to start when the GPU is already busy. The check uses
   nvidia-smi, which is what the owner's machine has; elsewhere it reports
   that it could not look and lets the run proceed. `--allow-busy-gpu`
   overrides a refusal, and the result then says it was taken that way. */
import { execFileSync } from 'node:child_process';

export const BUSY_GPU_PERCENT = 10;

/** URL parameters for a timing run: normal use unless `det` is asked for. */
export function timingQuery({ det = false, quality = 'hi' } = {}) {
  const query = { qualitylock: '1', q: quality };
  if (det) query.det = '1';
  return query;
}

/** The same, as a `&k=v` string to append to an existing query. */
export function timingQueryString(options) {
  return Object.entries(timingQuery(options)).map(([k, v]) => `&${k}=${v}`).join('');
}

/** Reads GPU utilisation; null when there is no nvidia-smi to ask. */
export function gpuUtilisation(run = execFileSync) {
  try {
    const out = run('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
      { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const values = String(out).split(/\r?\n/).map(s => Number(s.trim())).filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  } catch { return null; }
}

/**
 * Refuses a timing run on a busy GPU. Returns a record for the result file.
 * `samples` readings are taken `intervalMs` apart and the lowest is used, so
 * one busy instant (the tool's own launch) does not refuse a quiet machine.
 */
export async function assertGpuIdle({ allowBusy = false, samples = 3, intervalMs = 500, read = gpuUtilisation, log = console.log } = {}) {
  const readings = [];
  for (let i = 0; i < samples; i++) {
    const value = read();
    if (value === null) break;
    readings.push(value);
    if (i < samples - 1) await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  if (!readings.length) {
    log('gpu idle check: nvidia-smi unavailable, not checked');
    return { checked: false, utilisation: null, allowedBusy: false };
  }
  const utilisation = Math.min(...readings);
  if (utilisation > BUSY_GPU_PERCENT) {
    const message = `GPU is ${utilisation}% busy before the run (limit ${BUSY_GPU_PERCENT}%): close other tabs and apps drawing on it`;
    if (!allowBusy) throw new Error(`${message}, or pass --allow-busy-gpu`);
    log(`WARN: ${message}; continuing because --allow-busy-gpu`);
    return { checked: true, utilisation, allowedBusy: true };
  }
  log(`gpu idle check: ${utilisation}% busy`);
  return { checked: true, utilisation, allowedBusy: false };
}
