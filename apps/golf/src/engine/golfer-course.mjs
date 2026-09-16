import * as THREE from 'three/webgpu';
import { loadGolfer, characterFromUrl, transferGolferState, shotYawForDirection, GOLF_SWINGS } from './golfer.mjs';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const terrainPoses = new WeakMap();

/** Optional character preview. The course viewer stays unchanged until ?golfer=1. */
export async function mountCourseGolfer({ scene, camera, controls, heightAt, getTee, getGreen, getHole, kindAt }) {
  let golfer = await loadGolfer(undefined, characterFromUrl());
  scene.add(golfer.root);
  const saved = { eye: camera.position.clone(), target: controls.target.clone(), min: controls.minDistance, max: controls.maxDistance };
  controls.minDistance = 2.4; controls.maxDistance = 40;
  const panel = document.createElement('section'); panel.className = 'golfer-course'; panel.setAttribute('aria-label', 'Golfer preview');
  panel.innerHTML = `<div class="gc-title"><b>En runda till</b><button data-close aria-label="Stäng golfaren">×</button></div><p>W A S D för att gå · Shift för att jogga</p><label>Golfare <select data-character aria-label="Golfare"><option value="female">Kvinna</option><option value="male">Man</option></select></label><label>Klubba <select data-club aria-label="Golfklubba"><option value="Driver">Driver</option><option value="Wood">Fairwaywood</option><option value="Iron" selected>Järn</option><option value="Wedge">Wedge</option><option value="Putter">Putter</option></select></label><div class="gc-row"><button data-address>Ställ upp</button><button data-swing>Slå</button><button data-reset>Till tee</button></div><div class="gc-row gc-walk"><button data-key="a" aria-label="Gå vänster">←</button><button data-key="w" aria-label="Gå framåt">↑</button><button data-key="s" aria-label="Gå bakåt">↓</button><button data-key="d" aria-label="Gå höger">→</button></div><small role="status">Karaktärsstudie · slag visar animation</small><a href="${import.meta.env.BASE_URL}golfer-study.html">Öppna karaktärsstudion ↗</a>`;
  const style = document.createElement('style');
  style.textContent = `.golfer-course{position:fixed;z-index:45;left:16px;top:102px;width:252px;padding:15px;background:#f4f0e4f2;color:#304c40;border:1px solid #bcc9b5;border-radius:14px;box-shadow:0 5px 24px #152c2525;font:12px/1.5 system-ui}.gc-title{display:flex;align-items:center;justify-content:space-between}.gc-title b{font:21px Georgia,serif}.golfer-course p{font-size:10px;margin:8px 0 12px}.golfer-course button,.golfer-course select{padding:7px 9px;border-radius:7px;border:1px solid #bcc9b5;background:#fffdf3;color:inherit;cursor:pointer;font:inherit}.golfer-course label{display:flex;align-items:center;justify-content:space-between;gap:12px}.golfer-course select{flex:1}.golfer-course label+label{margin-top:8px}.gc-row{display:flex;gap:6px;margin-top:10px}.gc-row button{flex:1}.gc-walk button{touch-action:none}.golfer-course [data-swing]{background:#3c654f;color:white}.golfer-course small,.golfer-course a{display:block;margin-top:10px;font-size:10px;color:#657660}.golfer-course [data-close]{border:0;background:transparent;padding:0 4px;font-size:20px}@media(max-width:600px){.golfer-course{top:auto;bottom:100px;left:10px;width:230px;padding:11px}.golfer-course p{margin:4px 0}.gc-row{margin-top:6px}}`;
  document.head.append(style); document.body.append(panel);
  const keys = new Set(), abort = new AbortController();
  let closed = false, moved = false, hole = getHole(), flight = null;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.02135, 16, 12), new THREE.MeshStandardNodeMaterial({ color: '#fff9e8', roughness: .8 })); ball.castShadow = true; scene.add(ball);
  const label = panel.querySelector('[role=status]');
  function ballAtFeet() {
    const names = { Driver:'SwingDriver', Wood:'SwingWood', Iron:'SwingIron', Wedge:'ChipWedge', Putter:'Putt' };
    const contact = golfer.clips.get(names[golfer.club]).contact || [0, .02135, .75];
    ball.position.copy(golfer.root.localToWorld(new THREE.Vector3(...contact)));
    const ground = heightAt(ball.position.x, ball.position.z);
    if (golfer.current.startsWith('Address') || golfer.clips.get(golfer.current).impact != null) {
      // Match the striking face to the actual ball elevation. Leg IK below takes
      // up the difference between that stance plane and the ground under each foot.
      const delta = ground - golfer.root.position.y;
      golfer.root.position.y = ground; camera.position.y += delta; controls.target.y += delta;
      golfer.root.updateMatrixWorld(true);
    }
    ball.position.y = ground + .02135;
    ball.visible = true; flight = null;
  }
  function reset() {
    const [x, z] = getTee(), green = getGreen();
    golfer.root.position.set(x, heightAt(x, z) + .008, z);
    golfer.root.rotation.y = Math.atan2(green[0] - x, green[1] - z);
    golfer.play('Idle'); keys.clear(); moved = false;
    controls.target.copy(golfer.root.position).add(new THREE.Vector3(0, 1.05, 0));
    camera.position.copy(golfer.root.position).add(new THREE.Vector3(3, 2.25, 4.5).applyAxisAngle(UP, golfer.root.rotation.y));
    controls.update(); ballAtFeet();
  }
  function aim() {
    const green = getGreen(), p = golfer.root.position;
    golfer.root.rotation.y = shotYawForDirection(green[0] - p.x, green[1] - p.z, golfer.clips.get(GOLF_SWINGS[golfer.pendingClub || golfer.club]).shotDirection);
    keys.clear(); moved = false;
  }
  panel.querySelector('[data-club]').onchange = e => golfer.selectClub(e.target.value);
  const characterSelect = panel.querySelector('[data-character]'); characterSelect.value = golfer.character;
  let characterRequest = 0;
  function bindCharacter() {
    golfer.onImpact = () => { flight = { t: 0, origin: ball.position.clone(), direction: golfer.shotDirection(), putt: golfer.club === 'Putter', wedge: golfer.club === 'Wedge' }; label.textContent = 'Träff · animationsförhandsvisning'; };
    golfer.onFinished = name => { if (name !== 'ClubChange') label.textContent = 'W A S D för att gå vidare'; };
    const url = new URL(location.href); url.searchParams.set('character', golfer.character); history.replaceState(null, '', url);
    const studio = new URL(panel.querySelector('a').href); studio.searchParams.set('character', golfer.character); panel.querySelector('a').href = studio.href;
  }
  characterSelect.onchange = async () => {
    const request = ++characterRequest, id = characterSelect.value;
    if (id === golfer.character) { label.textContent = 'Redo för nästa hål'; characterSelect.removeAttribute('aria-busy'); return; }
    label.textContent = 'Laddar golfaren…'; characterSelect.setAttribute('aria-busy', 'true');
    try {
      const next = await loadGolfer(undefined, id);
      if (closed || request !== characterRequest) { next.dispose(); return; }
      const previous = golfer; transferGolferState(previous, next);
      golfer = next; scene.add(next.root); bindCharacter(); previous.dispose(); ballAtFeet();
      label.textContent = 'Redo för nästa hål';
    } catch (error) {
      if (!closed && request === characterRequest) { characterSelect.value = golfer.character; label.textContent = `Kunde inte byta golfare: ${error.message}`; }
    } finally { if (request === characterRequest) characterSelect.removeAttribute('aria-busy'); }
  };
  panel.querySelector('[data-address]').onclick = () => { aim(); golfer.address(); ballAtFeet(); };
  panel.querySelector('[data-swing]').onclick = () => { aim(); golfer.swing(); ballAtFeet(); label.textContent = 'Slaganimation'; };
  panel.querySelector('[data-reset]').onclick = reset;
  bindCharacter();
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (['w', 'a', 's', 'd', 'shift'].includes(e.key.toLowerCase())) { keys.add(e.key.toLowerCase()); e.preventDefault(); }
  }, { signal: abort.signal });
  addEventListener('keyup', e => keys.delete(e.key.toLowerCase()), { signal: abort.signal });
  addEventListener('blur', () => keys.clear(), { signal: abort.signal });
  document.addEventListener('visibilitychange', () => keys.clear(), { signal: abort.signal });
  for (const button of panel.querySelectorAll('[data-key]')) {
    button.onpointerdown = e => { button.setPointerCapture(e.pointerId); keys.add(button.dataset.key); };
    button.onpointerup = button.onpointercancel = button.onlostpointercapture = () => keys.delete(button.dataset.key);
  }
  function dispose() {
    if (closed) return; closed = true; abort.abort(); keys.clear(); panel.remove(); style.remove();
    golfer.dispose(); scene.remove(ball); ball.geometry.dispose(); ball.material.dispose();
    camera.position.copy(saved.eye); controls.target.copy(saved.target); controls.minDistance = saved.min; controls.maxDistance = saved.max; controls.update();
  }
  panel.querySelector('[data-close]').onclick = dispose;
  reset();
  return { get golfer() { return golfer; }, get target() { return getGreen(); }, panel, ball, reset, dispose, get closed() { return closed; }, update(dt) {
    if (closed) return;
    if (getHole() !== hole) { hole = getHole(); reset(); }
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = forward.clone().cross(UP);
    const z = Number(keys.has('w')) - Number(keys.has('s')), x = Number(keys.has('d')) - Number(keys.has('a'));
    if (x || z) {
      const direction = forward.multiplyScalar(z).addScaledVector(right, x).normalize();
      const name = keys.has('shift') ? 'Jog' : 'Walk';
      const step = direction.clone().multiplyScalar(golfer.clips.get(name).speed * dt);
      const p = golfer.root.position.clone().add(step), h = heightAt(p.x, p.z);
      if (Number.isFinite(h) && Math.abs(h - golfer.root.position.y) < .22 && kindAt(p.x, p.z) !== 'vatten') {
        golfer.play(name, { restart: false });
        golfer.root.rotation.y = Math.atan2(direction.x, direction.z);
        step.y = h + .008 - golfer.root.position.y;
        golfer.root.position.add(step); camera.position.add(step); controls.target.add(step); moved = true;
      }
    } else if (moved) { golfer.play('Idle'); moved = false; }
    // AnimationMixer can skip unchanged tracks. Restore the unmodified pose
    // before evaluating it so terrain corrections never accumulate at a held finish.
    for (const [bone, quaternion] of terrainPoses.get(golfer.root) || []) bone.quaternion.copy(quaternion);
    golfer.update(dt);
    // Follow the actual course mesh; align the ankle chains to modest local slopes.
    fitFeet(golfer.root, heightAt);
    if (flight) {
      flight.t += dt; const t = flight.t, speed = flight.putt ? 2 : flight.wedge ? 8 : 15;
      const offset = flight.direction.clone().multiplyScalar(speed * t);
      ball.position.copy(flight.origin).add(offset);
      const ground = heightAt(ball.position.x, ball.position.z) + .02135;
      ball.position.y = flight.putt ? ground : Math.max(ground, flight.origin.y + 5 * t - 4.905 * t * t);
      if (t > (flight.putt ? 2 : 1.4)) flight = null;
    }
  } };
}

function fitFeet(root, heightAt) {
  root.updateMatrixWorld(true);
  const originalPose = [];
  const ground = root.position.y;
  for (const side of ['L', 'R']) {
    const thigh = root.getObjectByName(`Thigh_${side}`), shin = root.getObjectByName(`Shin_${side}`), foot = root.getObjectByName(`Foot_${side}`);
    for (const bone of [thigh, shin, foot]) originalPose.push([bone, bone.quaternion.clone()]);
    const a = thigh.getWorldPosition(new THREE.Vector3()), b = shin.getWorldPosition(new THREE.Vector3()), c = foot.getWorldPosition(new THREE.Vector3());
    const originalFoot = foot.getWorldQuaternion(new THREE.Quaternion());
    const target = c.clone(); target.y += clamp(heightAt(c.x, c.z) - ground, -.16, .16);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c), axis = target.clone().sub(a), distance = Math.min(axis.length(), l1 + l2 - 1e-4); axis.normalize();
    target.copy(a).addScaledVector(axis, distance);
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const pole = b.clone().sub(a); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const knee = a.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    rotateTo(thigh, shin, knee); rotateTo(shin, foot, target);
    const nx = heightAt(c.x - .12, c.z) - heightAt(c.x + .12, c.z), nz = heightAt(c.x, c.z - .12) - heightAt(c.x, c.z + .12);
    const normal = new THREE.Vector3(nx, .24, nz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal).multiply(originalFoot);
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); foot.updateWorldMatrix(false, true);
  }
  terrainPoses.set(root, originalPose);
}
function rotateTo(bone, child, target) {
  const origin = bone.getWorldPosition(new THREE.Vector3()), current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(current, desired).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); bone.updateWorldMatrix(false, true);
}
