import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const root = path.resolve('tools/reference/rtx3070');
const archive = path.resolve('docs/graphics/performance-distant-hero-2026-09-23/default24');
fs.mkdirSync(archive, { recursive: true });
const run = (args) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true,
    env: { ...process.env, BANVY_GPU: '1' } });
  assert.equal(r.status, 0, args.join(' '));
};
const results = [];
for (const course of ['puttom', 'veckefjarden']) {
  const out = path.join(archive, course);
  run(['tools/performance-ab.mjs', '--base', 'http://127.0.0.1:8648', '--kind', 'shots',
    '--course', course, '--variants', 'default24=|geographic=distanthero=0', '--order', 'default24,geographic',
    ...(course === 'veckefjarden' ? ['--poses', 'docs/graphics/performance-phase1-rtx3070-2026-09-23/tour-poses.json'] : []),
    ...(fs.existsSync(path.join(out, 'report.json')) ? ['--resume'] : []),
    '--out', out]);
  const current = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert.equal(current.runs[0].boot.treePolicy.distantHero, 24);
  assert.equal(current.runs[1].boot.treePolicy.distantHero, 0);
  const oldDir = path.resolve('docs/graphics/performance-distant-hero-2026-09-23', course);
  const old = JSON.parse(fs.readFileSync(path.join(oldDir, 'report.json')));
  for (const [variant, reference] of [['default24', 'far24'], ['geographic', 'before']]) {
    const nowRun = current.runs.find(r => r.variant === variant);
    const oldRun = old.runs.find(r => r.variant === reference);
    assert.deepEqual(nowRun.boot.fingerprint, oldRun.boot.fingerprint);
    for (const v of nowRun.views) {
      const ov = oldRun.views.find(o => o.id === v.id);
      const { position, target, ...settings } = v.state.cameraExact;
      const { position: oldPosition, target: oldTarget, ...oldSettings } = ov.state.cameraExact;
      assert.deepEqual(settings, oldSettings);
      // OrbitControls re-clamping can change the last bits of world coordinates
      // between settled frames (the existing shadow-cell fix handles this).
      const oldCoordinates = [...oldPosition, ...oldTarget];
      const maxCameraDelta = Math.max(...[...position, ...target].map((n, i) => Math.abs(n - oldCoordinates[i])));
      assert.ok(maxCameraDelta <= 1e-9, `${course} ${variant} ${v.id}: camera moved`);
      v.maxCameraCoordinateDelta = maxCameraDelta;
      assert.deepEqual(v.shadowMap.matrix, ov.shadowMap.matrix);
      assert.equal(v.state.terrain.loadingTiles, 0);
    }
    const report = { ...current, baselineBuild: old.build, order: [reference, variant], runs: [
      { ...oldRun, variant: reference, views: oldRun.views.map(v => ({ ...v, image: path.relative(out, path.join(oldDir, v.image)).replaceAll('\\', '/') })) },
      nowRun,
    ] };
    const name = path.join(out, `compare-${variant}.json`);
    fs.writeFileSync(name, JSON.stringify(report, null, 2) + '\n');
    run(['tools/performance-image-diff.mjs', name, reference]);
    const diff = JSON.parse(fs.readFileSync(path.join(out, 'pixel-diff.json')));
    for (const d of diff.results) {
      assert.ok(d.maxChannelError255 <= 1, `${course} ${variant} ${d.id}: color changed`);
      assert.equal(d.shadowBitIdentical, true);
    }
    fs.renameSync(path.join(out, 'pixel-diff.json'), path.join(out, `diff-${variant}.json`));
    results.push({ course, variant, reference, build: current.build, baselineBuild: old.build, results: diff.results });
  }
}
fs.writeFileSync(path.join(archive, 'visual-parity.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
console.log('All seven new-default views match the measured 24 px prototype; geographic opt-out retains all seven baseline views.');
