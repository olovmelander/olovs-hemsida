import { expect, it, vi } from 'vitest';
import { createGuidancePlanner } from './map-guidance.mjs';

function harness() {
  const workers = [];
  const loadGeometry = vi.fn(async hole => ({ hole }));
  const onChange = vi.fn();
  const planner = createGuidancePlanner({
    onChange, loadGeometry,
    createWorker() {
      const worker = { postMessage: vi.fn(), terminate: vi.fn(), reply(data) { this.onmessage({ data }); } };
      workers.push(worker);
      return worker;
    },
  });
  return { ...planner, workers, loadGeometry, onChange };
}
const bag = [], request = { origin: [0, 0], target: null, bag, carryBag: bag };
const playable = origin => ({ status: 'playable', origin, shots: [{ from: origin, point: [30, 90] }] });

it('coalesces movement, keeps a nearby validated leg at its own origin, and gives a tap immediate precedence', async () => {
  const planner = harness();
  planner.read(1, request);
  await Promise.resolve();
  const [worker] = planner.workers;
  worker.reply({ type: 'ready' });
  const moved = { ...request, origin: [0, 2] };
  planner.read(1, moved);
  worker.reply({ type: 'result', id: 1, result: playable(request.origin) });
  expect(planner.read(1, moved).origin).toEqual(request.origin);
  const tapped = { ...moved, target: [10, 100] };
  expect(planner.read(1, tapped).shots).toEqual([]);
  worker.reply({ type: 'result', id: 2, result: playable(moved.origin) });
  expect(planner.read(1, tapped).shots).toEqual([]);
  expect(worker.postMessage.mock.lastCall[0].target).toEqual(tapped.target);
  worker.reply({ type: 'result', id: 3, result: { status: 'measured', shots: [{ from: moved.origin, point: tapped.target }] } });
  expect(planner.read(1, tapped).status).toBe('measured');
  expect(planner.read(1, moved).status).toBe('loading');
});

it('discards work for a previous hole and retries a failed worker', async () => {
  const planner = harness();
  planner.read(1, request);
  await Promise.resolve();
  const [first] = planner.workers;
  planner.read(2, request);
  first.reply({ type: 'result', id: 1, result: playable(request.origin) });
  expect(first.terminate).toHaveBeenCalledOnce();
  expect(planner.onChange).not.toHaveBeenCalled();
  await Promise.resolve();
  vi.spyOn(console, 'warn').mockImplementationOnce(() => {});
  planner.workers[1].onerror(new Error('offline'));
  expect(planner.read(2, request).status).toBe('unavailable');
  planner.retry();
  expect(planner.read(2, request).status).toBe('loading');
  expect(planner.loadGeometry).toHaveBeenCalledTimes(3);
});
