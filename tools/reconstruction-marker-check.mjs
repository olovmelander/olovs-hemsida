// Runs on the diagnostic Vite origin used by audit-reconstruction.mjs.
// Compare final DOM after every update, including moving/hidden/edge cases.
import assert from 'node:assert/strict';
export async function checkMarkerParity(page, { baselineDirectory, engineDirectory, threeModule }) {
  await page.route('**/audit-marker.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="card" style="position:fixed;left:0;top:0;width:220px;height:150px"></div></body></html>' }));
  await page.goto('http://127.0.0.1:8665/audit-marker.html');
  const pair = await page.evaluate(async ({ baselineDirectory, engineDirectory, threeModule }) => {
    const { PerspectiveCamera } = await import(`/@fs${threeModule}`);
    const modules = [await import(`/@fs${baselineDirectory}/hole-marker.mjs`), await import(`/@fs${engineDirectory}/hole-marker.mjs`)];
    const results = [];
    for (const module of modules) {
      const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 10000);
      const marker = module.createHoleMarker({ id: 'markerAudit', kind: 'green', icon: 'F', camera,
        heightAt: (x, z) => Math.sin(x / 10) + Math.cos(z / 10), onLocate() {}, describe: ({ docked }) => ({ action: docked ? 'edge' : 'point' }) });
      marker.select({ key: 'green1', c: [0, 0], hole: 1, label: 'Green 1', accessibleLabel: 'Green 1',
        outline: [[-8, -8], [8, -8], [8, 8], [-8, 8]] });
      const root = document.getElementById('markerAudit'), obstacle = document.getElementById('card');
      obstacle.style.top = '0px';
      const observer = new MutationObserver(() => {}); observer.observe(root, { subtree: true, attributes: true, characterData: true, childList: true });
      const snapshots = [], writes = [];
      for (let i = 0; i < 180; i++) {
        const moving = i >= 60 && i < 100;
        camera.position.set(moving ? (i - 60) * 2 : 0, i >= 120 ? 1 : 25, 60);
        camera.lookAt(i >= 100 && i < 120 ? 300 : 0, 0, 0);
        camera.fov = i >= 140 ? 70 : 45; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        if (i === 145) obstacle.style.top = '120px';
        if (i === 160) marker.select({ key: 'tee2', c: [5, 8], hole: 2, teeIndex: 1, label: 'Tee 2', value: '342 m', accessibleLabel: 'Tee 2' });
        if (i === 178) marker.select(null);
        const rect = marker.update({ now: i * 17, mode: 'orbit', hidden: i >= 170 && i < 175,
          reserved: i >= 130 ? [{ left: 200, top: 200, right: 550, bottom: 550 }] : [] });
        snapshots.push({ dom: root.outerHTML, rect }); writes.push(observer.takeRecords().length);
      }
      observer.disconnect(); root.remove(); results.push({ snapshots, writes });
    }
    return results;
  }, { baselineDirectory, engineDirectory, threeModule });
  assert.deepEqual(pair[1].snapshots, pair[0].snapshots, 'marker output differs');
  const total = values => values.reduce((a, b) => a + b, 0);
  assert.ok(total(pair[1].writes) < total(pair[0].writes), 'no DOM write reduction');
  return { exactSnapshots: pair[0].snapshots.length, baselineWrites: total(pair[0].writes), candidateWrites: total(pair[1].writes),
    stationaryFrames: 59, stationaryBaselineWrites: total(pair[0].writes.slice(1, 60)), stationaryCandidateWrites: total(pair[1].writes.slice(1, 60)),
    baselineWritesByFrame: pair[0].writes, candidateWritesByFrame: pair[1].writes };
}
