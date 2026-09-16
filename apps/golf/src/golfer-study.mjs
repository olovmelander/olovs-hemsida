import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadGolfer, GOLFER_CHARACTERS, characterFromUrl, transferGolferState } from './engine/golfer.mjs';

const $ = id => document.getElementById(id);
const stage = $('stage'), status = $('status');
const renderer = new THREE.WebGPURenderer({ antialias: true });
let golfer;
try {
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d7dfc9'); scene.fog = new THREE.Fog('#d7dfc9', 12, 55);
  const hemi = new THREE.HemisphereLight('#f0f2e7', '#73845b', 2.5); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d8', 3.3); sun.position.set(-3, 7, 5); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: .1, far: 25 }); sun.shadow.normalBias = .012; scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight('#d5e9f0', .65); fill.position.set(4, 2, -3); scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardNodeMaterial({ color: '#d7dfc9', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -.004; ground.receiveShadow = true; scene.add(ground);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, .014, 96), new THREE.MeshStandardNodeMaterial({ color: '#afbf93', roughness: 1 })); pad.position.y = -.009; pad.receiveShadow = true; scene.add(pad);
  // A few quiet grass clumps give the studio floor a link to the landscape.
  for (let i = 0; i < 45; i++) {
    const a = i * 2.39996, r = 2.5 + (i % 7) * .47;
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(.028 + i % 3 * .01, .12 + i % 4 * .015, 4), new THREE.MeshStandardNodeMaterial({ color: i % 2 ? '#b4c39b' : '#a5b789', roughness: 1 }));
    tuft.position.set(Math.cos(a) * r, .05, Math.sin(a) * r); tuft.rotation.z = Math.sin(i) * .22; scene.add(tuft);
  }
  golfer = await loadGolfer(undefined, characterFromUrl()); scene.add(golfer.root);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.02135, 20, 14), new THREE.MeshStandardNodeMaterial({ color: '#fff9e4', roughness: .7 })); ball.castShadow = true; scene.add(ball);
  let flight = null, walked = false;
  function resetBall() {
    // Contact position is measured from the active clip's baked club-head marker.
    const contact = golfer.clips.get({ Driver:'SwingDriver', Wood:'SwingWood', Iron:'SwingIron', Wedge:'ChipWedge', Putter:'Putt' }[golfer.club])?.contact;
    const p = new THREE.Vector3(...(contact || [0, .02135, .76]));
    p.y = .02135; ball.position.copy(golfer.root.localToWorld(p)); ball.visible = true; flight = null;
  }
  function bindCharacter() {
    golfer.onImpact = () => { flight = { time: 0, start: ball.position.clone(), direction: golfer.shotDirection(), putt: golfer.club === 'Putter' }; };
    golfer.onChange = name => {
      $('motion-name').textContent = name.replace(/([a-z])([A-Z])/g, '$1 $2');
      for (const b of document.querySelectorAll('[data-motion]')) b.setAttribute('aria-pressed', String(b.dataset.motion === name));
    };
    golfer.onChange(golfer.current);
    $('palette').textContent = GOLFER_CHARACTERS[golfer.character].palette;
    for (const b of $('characters').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.character === golfer.character));
    const url = new URL(location.href); url.searchParams.set('character', golfer.character); history.replaceState(null, '', url);
    const course = new URL(document.querySelector('.toplink').href); course.searchParams.set('character', golfer.character); document.querySelector('.toplink').href = course.href;
  }
  bindCharacter();
  let characterRequest = 0;
  async function selectCharacter(id) {
    const request = ++characterRequest;
    if (id === golfer.character) { status.textContent = 'Ready for a round'; $('characters').removeAttribute('aria-busy'); return; }
    status.textContent = `Getting the ${GOLFER_CHARACTERS[id].label.toLowerCase()} golfer ready…`;
    $('characters').setAttribute('aria-busy', 'true');
    try {
      const next = await loadGolfer(undefined, id);
      if (request !== characterRequest) { next.dispose(); return; }
      const previous = golfer; transferGolferState(previous, next);
      golfer = next; scene.add(next.root); bindCharacter(); previous.dispose(); resetBall();
      status.textContent = 'Ready for a round';
    } catch (error) {
      if (request === characterRequest) status.textContent = `Could not switch golfer: ${error.message}`;
    } finally { if (request === characterRequest) $('characters').removeAttribute('aria-busy'); }
  }
  $('characters').onclick = e => { const b = e.target.closest('[data-character]'); if (b) void selectCharacter(b.dataset.character); };
  const camera = new THREE.PerspectiveCamera(32, 1, .03, 300);
  const controls = new OrbitControls(camera, renderer.domElement); controls.minDistance = 1.1; controls.maxDistance = 14; controls.maxPolarAngle = Math.PI * .51; controls.enableDamping = true;
  function resetCamera() { const p = golfer.root.position; camera.position.copy(p).add(new THREE.Vector3(2.25, 1.95, 4.3)); controls.target.copy(p).add(new THREE.Vector3(0, 1.02, 0)); controls.update(); }
  $('views').onclick = e => {
    const view = e.target.closest('[data-view]')?.dataset.view;
    if (!view) return;
    const offset = { front: [0, 1.3, 5], side: [5, 1.3, 0], back: [0, 1.3, -5] }[view];
    controls.target.copy(golfer.root.position).add(new THREE.Vector3(0, 1.02, 0));
    camera.position.copy(golfer.root.position).add(new THREE.Vector3(...offset).applyQuaternion(golfer.root.quaternion)); controls.update();
  };
  resetCamera(); resetBall();
  function resize() { const w = stage.clientWidth, h = renderer.domElement.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  new ResizeObserver(resize).observe(stage); resize();
  const notes = { Driver: 'A wide stance and a sweeping drive, with the weight moving onto the lead foot.', Wood: 'A sweeping fairway-wood swing, built around the longer shaft.', Iron: 'A balanced iron swing, with a full turn and a gentle finish.', Wedge: 'A shorter, quieter chip. Less body turn, more control around the green.', Putter: 'A small pendulum stroke with steady feet and a quiet head.' };
  $('clubs').addEventListener('click', e => { const b = e.target.closest('[data-club]'); if (!b) return; golfer.selectClub(b.dataset.club); $('club-note').textContent = notes[b.dataset.club]; for (const button of $('clubs').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button === b)); });
  $('motions').addEventListener('click', e => { const b = e.target.closest('[data-motion]'); if (b) golfer.play(b.dataset.motion); });
  $('address').onclick = () => { golfer.address(); resetBall(); };
  $('swing').onclick = () => { golfer.swing(); resetBall(); };
  $('reset').onclick = () => { golfer.root.position.set(0, 0, 0); golfer.root.rotation.y = 0; golfer.play('Idle'); resetCamera(); resetBall(); };
  $('pause').onclick = () => { golfer.paused = !golfer.paused; $('pause').textContent = golfer.paused ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', String(golfer.paused)); };
  $('speed').onchange = () => { golfer.rate = Number($('speed').value); };
  $('timeline').oninput = () => { golfer.paused = true; $('pause').textContent = 'Resume'; $('pause').setAttribute('aria-pressed', 'true'); golfer.seek(Number($('timeline').value) * golfer.duration); };
  $('light').onchange = () => { const warm = $('light').value === 'evening'; sun.color.set(warm ? '#ffcb87' : '#fff1d8'); sun.position.set(-3, warm ? 2.4 : 7, 5); hemi.intensity = warm ? 1.85 : 2.5; scene.background.set(warm ? '#e5d8b8' : '#d7dfc9'); scene.fog.color.copy(scene.background); };
  const keys = new Set();
  addEventListener('keydown', e => { if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(e.target.tagName)) return; if ('wasd'.includes(e.key.toLowerCase()) || e.key === 'Shift') { keys.add(e.key.toLowerCase()); e.preventDefault(); } });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => keys.clear());
  for (const b of document.querySelectorAll('[data-key]')) {
    b.onpointerdown = e => { b.setPointerCapture(e.pointerId); keys.add(b.dataset.key); };
    b.onpointerup = b.onpointercancel = b.onlostpointercapture = () => keys.delete(b.dataset.key);
  }
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, .05); last = now;
    const x = Number(keys.has('d')) - Number(keys.has('a')), z = Number(keys.has('w')) - Number(keys.has('s'));
    if ((x || z) && !golfer.paused) {
      const forward = camera.getWorldDirection(new THREE.Vector3()); forward.y = 0; forward.normalize();
      const right = forward.clone().cross(new THREE.Vector3(0,1,0));
      const direction = forward.multiplyScalar(z).addScaledVector(right,x).normalize();
      const name = keys.has('shift') ? 'Jog' : 'Walk'; golfer.play(name, { restart: false });
      golfer.root.rotation.y = Math.atan2(direction.x, direction.z);
      const step = direction.multiplyScalar(golfer.clips.get(name).speed * dt * golfer.rate);
      golfer.root.position.add(step); camera.position.add(step); controls.target.add(step); sun.position.add(step); sun.target.position.add(step); walked = true;
    } else if (walked) { golfer.play('Idle'); walked = false; }
    else if ($('travel').checked && !golfer.paused && golfer.clips.get(golfer.current).speed) {
      const clip = golfer.clips.get(golfer.current);
      const step = new THREE.Vector3(...clip.travelDirection).applyQuaternion(golfer.root.quaternion).multiplyScalar(clip.speed * dt * golfer.rate);
      golfer.root.position.add(step); camera.position.add(step); controls.target.add(step); sun.position.add(step); sun.target.position.add(step);
    }
    golfer.update(dt);
    if (flight && !golfer.paused) { flight.time += dt * golfer.rate; const t = flight.time; const p = flight.direction.clone().multiplyScalar(t * (flight.putt ? 1.5 : 7)); p.y = flight.putt ? 0 : Math.max(0, 3.8 * t - 4.9 * t * t); ball.position.copy(flight.start).add(p); if (t > 2) flight = null; }
    controls.update(); renderer.render(scene, camera);
    $('timeline').value = String(golfer.time / golfer.duration); $('time').textContent = `${golfer.time.toFixed(2)} / ${golfer.duration.toFixed(2)} s`;
  });
  status.textContent = 'Ready for a round';
  window.GOLFER_STUDY = { get golfer() { return golfer; }, scene, camera, renderer, controls, ball, resetBall, selectCharacter };
} catch (error) {
  status.textContent = 'The golfer could not be loaded.';
  const note = document.createElement('div'); note.className = 'error'; note.textContent = error.message; stage.append(note);
  console.error(error);
}
