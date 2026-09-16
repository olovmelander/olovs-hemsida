import { chromium } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const out = 'docs/graphics/golfer-2026-09-16/animation-audit';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, serviceWorkers: 'block' });
const errors = [], report = {};
page.on('pageerror', e => errors.push(e.message));
try {
  for (const character of ['female', 'male']) {
    await page.goto(`http://127.0.0.1:5180/golfer-study.html?character=${character}`);
    await page.waitForFunction(() => window.GOLFER_STUDY, undefined, { timeout: 60000 });
    report[character] = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.webgpu.js');
      const study = GOLFER_STUDY, g = study.golfer; study.renderer.setAnimationLoop(null); g.paused = true;
      const pos = n => g.root.getObjectByName(n)?.getWorldPosition(new THREE.Vector3());
      const sample = t => { g.seek(t); g.root.updateMatrixWorld(true); };
      const axisOffset = (a, b, c) => { const ac = c.clone().sub(a).normalize(); return b.clone().sub(a).addScaledVector(ac, -b.clone().sub(a).dot(ac)); };
      const soleSamples = [];
      g.root.traverse(o => {
        if (!o.isSkinnedMesh) return;
        const indices = o.geometry.attributes.skinIndex, weights = o.geometry.attributes.skinWeight;
        for (let i = 0; i < indices.count; i += 5) {
          for (let j = 0; j < 4; j++) {
            if (weights.getComponent(i,j) > .98 && /^Foot_[LR]$/.test(o.skeleton.bones[indices.getComponent(i,j)]?.name)) { soleSamples.push([o,i]); break; }
          }
        }
      });
      const motions = [];
      for (const data of g.manifest.clips) {
        g.root.rotation.y = 0; g.play(data.name, { fade: 0 });
        let gripError = 0, minContact = Infinity, maxJointStep = 0, worstJoint = '', worstTime = 0, gripTime = 0, minElbowBack = Infinity, minKneeForward = Infinity, maxWristBend = 0, minSoleHeight = Infinity;
        let oldQ = new Map(); const handFoot = { L: [], R: [] };
        const toeStart = {}; let toeSlide = 0;
        const first = {}, last = {};
        for (let index = 0; index <= Math.ceil(data.duration * 120); index++) {
          const t = Math.min(data.duration - 1e-6, index / 120); sample(t);
          const hip = pos('Hips');
          if (data.name.startsWith('Swing')) for (const side of ['L','R']) {
            const toe = pos(`PivotToe_${side}`);
            if (toe) { toe.y = 0; if (!toeStart[side]) toeStart[side] = toe.clone(); toeSlide = Math.max(toeSlide,toe.distanceTo(toeStart[side])); }
          }
          for (const side of ['L', 'R']) {
            const shoulder = pos(`UpperArm_${side}`), elbow = pos(`Forearm_${side}`), hand = pos(`Hand_${side}`);
            const back = axisOffset(shoulder, elbow, hand); minElbowBack = Math.min(minElbowBack, -back.z);
            const knee = axisOffset(pos(`Thigh_${side}`), pos(`Shin_${side}`), pos(`Foot_${side}`)); minKneeForward = Math.min(minKneeForward, knee.z);
            handFoot[side].push([hand.z - hip.z, pos(`Foot_${side}`).z - hip.z]);
            const handAxis = new THREE.Vector3(0,1,0).applyQuaternion(g.root.getObjectByName(`Hand_${side}`).getWorldQuaternion(new THREE.Quaternion()));
            maxWristBend = Math.max(maxWristBend, handAxis.angleTo(hand.clone().sub(elbow)) * 180/Math.PI);
          }
          if (index % 4 === 0) {
            for (const [object,i] of soleSamples) {
              object.skeleton.update();
              minSoleHeight = Math.min(minSoleHeight,object.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(object.matrixWorld).y);
            }
          }
          if (data.name.startsWith('Address') || data.impact != null) {
            const origin = pos('ClubGrip');
            const shaft = pos('ShaftAxis')?.sub(origin).normalize() || new THREE.Vector3(0, 1, 0).applyQuaternion(g.root.getObjectByName('ClubGrip').getWorldQuaternion(new THREE.Quaternion()));
            for (const side of ['L', 'R']) {
              const hand = pos(`Grip_${side}`).sub(origin); const along = hand.dot(shaft);
              const error = Math.max(hand.clone().addScaledVector(shaft, -along).length(), Math.abs(along - (side === 'L' ? .066 : .142)));
              if (error > gripError) { gripError = error; gripTime = t/data.duration; }
            }
            minContact = Math.min(minContact, pos(`Contact_${data.club}`).y);
          }
          g.root.traverse(o => {
            if (!o.isBone) return;
            if (!first[o.name]) first[o.name] = o.getWorldPosition(new THREE.Vector3()).toArray();
            last[o.name] = o.getWorldPosition(new THREE.Vector3()).toArray();
            if (oldQ.has(o.name)) {
              const delta = o.quaternion.angleTo(oldQ.get(o.name)) * 180 / Math.PI;
              if (delta > maxJointStep) { maxJointStep = delta; worstJoint = o.name; worstTime = t/data.duration; }
            }
            oldQ.set(o.name, o.quaternion.clone());
          });
        }
        let seam = 0;
        if (data.loop) for (const name of Object.keys(first)) seam = Math.max(seam, Math.hypot(...first[name].map((v, i) => v - last[name][i])));
        const correlation = values => {
          const a = values.reduce((s, v) => s + v[0], 0) / values.length, b = values.reduce((s, v) => s + v[1], 0) / values.length;
          let ab = 0, aa = 0, bb = 0;
          for (const [x, y] of values) { ab += (x-a)*(y-b); aa += (x-a)**2; bb += (y-b)**2; }
          return ab / Math.sqrt(aa*bb);
        };
        const entry = { name: data.name, loopSeamMetres: seam, maxJointStepDegrees: maxJointStep, worstJoint, worstTime, gripTime, minElbowBackMetres: minElbowBack, minKneeForwardMetres: minKneeForward, gripErrorMetres: gripError, maxWristBendDegrees: maxWristBend, minSoleHeight, toeSlideMetres:toeSlide, minContactHeight: Number.isFinite(minContact) ? minContact : null };
        if (['Walk', 'WalkBackward', 'Jog'].includes(data.name)) entry.armFootCorrelation = Object.fromEntries(Object.entries(handFoot).map(([s, values]) => [s, correlation(values)]));
        if (data.speed) {
          const world = [];
          for (const phase of [.17, .27, .37]) {
            const t = phase * data.duration; sample(t);
            world.push(pos('Foot_L').add(new THREE.Vector3(...data.travelDirection).multiplyScalar(data.speed * t)));
          }
          entry.stanceDriftMetres = Math.max(world[0].distanceTo(world[1]), world[1].distanceTo(world[2]));
        }
        if (data.impact != null) {
          sample(data.impact - 1/120); const before = pos(`Contact_${data.club}`);
          sample(data.impact + 1/120); const after = pos(`Contact_${data.club}`);
          sample(data.impact); const point = pos(`Contact_${data.club}`), face = pos(`Face_${data.club}`).sub(point).normalize();
          const velocity = after.sub(before).multiplyScalar(60);
          entry.impact = { position: point.toArray(), metadataError: point.distanceTo(new THREE.Vector3(...data.contact)), velocity: velocity.toArray(), forwardAlignment: velocity.clone().normalize().dot(new THREE.Vector3(1,0,0)), faceAlignment: face.dot(new THREE.Vector3(1,0,0)) };
        }
        motions.push(entry);
      }
      return { sha256:g.manifest.sha256, motions };
    });
    // Actual WebGPU renders: four phases from the front, side and back.
    for (const clip of process.argv.includes('--metrics-only') ? [] : report[character].motions.map(m=>m.name)) {
      const frames = await page.evaluate(async clip => {
        const THREE = await import('/node_modules/three/build/three.webgpu.js');
        const { golfer:g, renderer, scene } = GOLFER_STUDY;
        renderer.setPixelRatio(1); renderer.setSize(300,380,false);
        const camera = new THREE.OrthographicCamera(-1.25,1.25,1.58,-1.58,.05,100);
        const phases = clip.startsWith('Swing') || clip === 'ChipWedge' || clip === 'Putt' ? [0,.44,.60,.88] : [0,.25,.50,.75];
        const frames = []; g.root.position.set(0,0,0);g.root.rotation.y=0;g.play(clip,{fade:0});
        for (const [view,location] of [['Front',[0,1.08,5]],['Side',[5,1.08,0]],['Back',[0,1.08,-5]]]) {
          camera.position.set(...location);camera.lookAt(0,1.08,0);camera.updateMatrixWorld(true);
          for (const phase of phases) {
            g.seek(phase*g.duration);g.root.updateMatrixWorld(true);
            // WebGPU skin buffers update once per animation frame, not per render call.
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await renderer.renderAsync(scene,camera);
            frames.push({ label:`${view} · ${Math.round(phase*100)}%`, image:renderer.domElement.toDataURL('image/png') });
          }
        }
        return frames;
      }, clip);
      const sheet = await browser.newPage({ viewport: { width: 1240, height: 886 }, deviceScaleFactor: 1 });
      await sheet.setContent(`<style>body{margin:0;background:#f3f0e6;color:#304c40;font:14px system-ui}h1{font:24px Georgia;margin:18px 20px}main{display:grid;grid-template-columns:repeat(4,300px);gap:8px;padding:0 8px}figure{margin:0}img{width:300px;height:380px;display:block}figcaption{text-align:center;padding:4px}</style><h1>${character} · ${clip} · animation audit</h1><main>${frames.map(f=>`<figure><img src="${f.image}"><figcaption>${f.label}</figcaption></figure>`).join('')}</main>`);
      await sheet.screenshot({ path:`${out}/${character}-${clip}.png`, fullPage:true });await sheet.close();
    }
  }
  report.errors = errors;
  report.sampleHz = 120;
  await writeFile(`${out}/measurements.json`, JSON.stringify(report,null,2));
  await writeFile(`${out}/index.html`, `<!doctype html><meta charset="utf-8"><title>Golfer animation audit</title><style>body{max-width:1300px;margin:40px auto;padding:0 20px;background:#f3f0e6;color:#304c40;font:16px/1.5 system-ui}h1,h2{font-family:Georgia}img{width:100%;height:auto}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:inherit}details{margin:18px 0;border:1px solid #bdc8b6;padding:12px;border-radius:10px}summary{cursor:pointer}</style><h1>Both golfers · animation audit</h1><p>Actual rendered poses from the front, side and back. Motion is baked at 60 fps and measured at 120 samples per second, including the frames between keys. <a href="http://localhost:5180/golfer-study.html">Open the live studio</a></p>${['female','male'].map(c=>`<h2>${c}</h2>${report[c].motions.map(m=>`<details><summary>${m.name}</summary><img loading="lazy" src="${c}-${m.name}.png" alt="${c} ${m.name} front, side and back"></details>`).join('')}`).join('')}`);
  if (!process.argv.includes('--report-only')) {
    for (const character of ['female','male']) for (const m of report[character].motions) {
      const id=`${character} ${m.name}`;
      assert(m.loopSeamMetres<.002,`${id}: loop seam`);
      assert(m.maxJointStepDegrees<25,`${id}: abrupt rotation (${m.maxJointStepDegrees})`);
      assert(m.minSoleHeight>-.008,`${id}: foot below ground (${m.minSoleHeight})`);
      assert(m.gripErrorMetres<.008,`${id}: hand separated from handle (${m.gripErrorMetres})`);
      assert(m.toeSlideMetres<.001,`${id}: toe slides during follow-through (${m.toeSlideMetres})`);
      assert(m.maxWristBendDegrees<70,`${id}: wrist bends too far (${m.maxWristBendDegrees})`);
      if (m.stanceDriftMetres != null) assert(m.stanceDriftMetres<.004,`${id}: planted-foot slide`);
      if (m.armFootCorrelation) {
        assert(m.armFootCorrelation.L<-.95 && m.armFootCorrelation.R<-.95,`${id}: arm/leg phase`);
        assert(m.minElbowBackMetres>.025,`${id}: elbows bending forward`);
        assert(m.minKneeForwardMetres>.01,`${id}: knees bending backwards`);
      }
      if (m.impact) {
        assert(m.impact.metadataError<.001,`${id}: ball/contact position`);
        assert(m.impact.forwardAlignment>.95 && m.impact.faceAlignment>.99,`${id}: strike/face direction`);
        assert(m.impact.velocity[0]>.1,`${id}: club stops at impact`);
        assert(Math.abs(m.impact.position[1]-.02135)<.001,`${id}: club misses ball height`);
      }
    }
    assert.deepEqual(errors,[]);
    report.passed=true;
    for (const character of ['female','male']) {
      const manifestName=character==='female'?'golfer.json':'golfer-male.json';
      const path=`experiments/golfer/assets/${manifestName}`;
      const manifest=JSON.parse(await readFile(path,'utf8'));
      const hash=createHash('sha256').update(await readFile(`experiments/golfer/assets/${manifest.file}`)).digest('hex');
      assert.equal(hash,report[character].sha256,`${character}: audit must match the current exported asset`);
      manifest.status='Animation revision 2: all 20 clips verified at 120 Hz';
      manifest.animation.validation={sampleHz:120,clips:20,verifiedAt:new Date().toISOString()};
      await writeFile(path,JSON.stringify(manifest,null,2));
      await writeFile(`docs/graphics/golfer-2026-09-16/${character==='female'?'build-report.json':'build-report-male.json'}`,JSON.stringify(manifest,null,2));
    }
    await writeFile(`${out}/measurements.json`, JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify(report,null,2));
} finally { await browser.close(); }
