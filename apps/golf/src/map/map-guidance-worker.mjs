import { createMapShotGeometry } from './map-shot-geometry.mjs';
import { createMapStrategy, readMapShot } from './map-strategy.mjs';

let geometry, strategy, config, previous, pin, onward;
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'open') {
      geometry = createMapShotGeometry(data.geometry);
      self.postMessage({ type: 'ready' });
      return;
    }
    const { origin, target, bag, carryBag, weather, greensApproximate } = data;
    if (data.config !== config) {
      config = data.config;
      strategy = createMapStrategy({ ...geometry, bag, carryBag, weather, greensApproximate });
      previous = pin = null;
    }
    let result;
    if (target) {
      previous = null;
      const measurement = readMapShot({ ...geometry, from: origin, to: target, bag, carryBag, weather });
      if (!pin || target[0] !== pin[0] || target[1] !== pin[1]) {
        pin = target;
        onward = strategy.plan(target);
      }
      result = { status: 'measured', measurement, shots: [{ from: origin, point: target }, ...onward.shots] };
    } else {
      pin = null;
      result = strategy.plan(origin, { tee: data.tee, previous });
      previous = result;
    }
    self.postMessage({ type: 'result', id: data.id, result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
