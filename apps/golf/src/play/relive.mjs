/* Återupplev: a round recorded with the map, replayed on the detailed course.

   Every measured shot starts and ends exactly where the phone locked it; the
   flight between is the club's own (ball-physics.mjs), turned and stretched
   onto the line the ball really travelled. Putts are counted, not positioned,
   and are shown rolling from the first putt's spot -- and said to be. Nothing
   here writes anything: a relived round changes no record and no statistic. */
import * as THREE from 'three/webgpu';
import { loadGolfer, GOLF_SWINGS, GOLFER_CHARACTERS } from '../engine/golfer.mjs';
import { DEFAULT_BAG } from '../engine/caddie.js';
import { createMapFrame } from '../map/map-frames.mjs';
import { BALL, launchState, simulateShot, puttSpeedFor, SURFACES, CLUB_LAUNCH } from './ball-physics.mjs';
import { clubCategory, launchFor, powerFor, flatShot, LIE_NAME } from './shot-model.mjs';
import { reliveRound } from './relive-model.mjs';
import { createPlayCamera } from './play-camera.mjs';
import { standAtBall, fitFeet, restoreLegs } from './golfer-rig.mjs';
import { createPlayHud, scorecardHtml } from './play-hud.mjs';
import { scoreName } from './play-rules.mjs';

const MAP_LIE = { green: 'green', bunker: 'sand', tee: 'tee', fairway: 'fairway', water: 'water', rough: 'rough' };
const CSS = `
body.pl-relive .pl-clubs,body.pl-relive .pl-help{display:none}
.pl-rv-bar{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:5px}
.pl-rv-bar button{min-width:48px;min-height:48px;border:0;border-radius:12px;background:transparent;color:var(--ink,#eaf3ec);font:600 18px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-rv-bar button:focus-visible{outline:2px solid var(--turf,#5fd07a);outline-offset:1px}
.pl-rv-bar [data-play]{background:var(--turf,#5fd07a);color:#0b1a13;min-width:64px}
.pl-rv-bar [data-speed]{font:600 13px 'JetBrains Mono',monospace;min-width:52px}
.pl-rv-tag{position:absolute;right:max(14px,env(safe-area-inset-right));top:calc(max(14px,env(safe-area-inset-top)) + 58px);padding:6px 11px;border-radius:999px;font-size:12px;color:var(--dim,#9db3a5)}
`;
/** Where a swing clip's backswing tops out. */
const lieOf = lie => MAP_LIE[lie] || 'fairway';

/** The flight of a recorded shot: the club's own, laid onto from -> to. */
export function reconstructFlight({ club, from, to, putt, heightAt, lie = 'fairway' }) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const yaw = Math.atan2(to[0] - from[0], to[1] - from[1]);
  const dir = [Math.sin(yaw), Math.cos(yaw)], side = [Math.cos(yaw), -Math.sin(yaw)];
  const y0 = heightAt(from[0], from[1]), y1 = heightAt(to[0], to[1]);
  const path = [];
  if (putt || d < 1) {
    const roll = SURFACES.green.roll * BALL.g, v0 = puttSpeedFor(d), T = v0 / roll;
    for (let i = 0; i <= 60; i++) {
      const t = T * i / 60, s = v0 * t - roll * t * t / 2;
      const x = from[0] + dir[0] * s, z = from[1] + dir[1] * s;
      path.push([t, x, heightAt(x, z) + BALL.radius, z, 'roll']);
    }
    return { path, landing: null, time: T };
  }
  const power = Math.min(1.1, powerFor(club, d, lie) ?? 1);
  const L = launchFor({ club, power, yaw: 0, lie, difficulty: 'normal' });
  const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: 0, spinRpm: L.spinRpm });
  const flat = simulateShot({ heightAt: () => 0, surfaceAt: () => 'fairway', cup: null }, { start: [0, BALL.radius, 0], velocity, spin }, { every: 3 });
  const restAlong = flat.rest[2] || 1, k = d / Math.hypot(flat.rest[0], flat.rest[2] || 1);
  let landing = null;
  for (const [t, lx, ly, lz, phase] of flat.path) {
    const along = lz * k, lateral = lx * k * .35;           // keep a little of the curve, mostly the line
    const u = Math.max(0, Math.min(1, lz / restAlong));
    const x = from[0] + dir[0] * along + side[0] * lateral, z = from[1] + dir[1] * along + side[1] * lateral;
    const ground = heightAt(x, z);
    const y = phase === 'air' ? Math.max(ground + BALL.radius, y0 + (y1 - y0) * u + ly) : ground + BALL.radius;
    if (!landing && phase !== 'air') landing = [x, y, z];
    path.push([t, x, y, z, phase]);
  }
  const last = path.at(-1);
  path.push([last[0] + .05, to[0], heightAt(to[0], to[1]) + BALL.radius, to[1], 'roll']);
  return { path, landing, time: last[0] + .05 };
}

function sample(path, t) {
  let lo = 0, hi = path.length - 1;
  if (t >= path[hi][0]) return { p: path[hi], v: [0, 0, 0], done: true };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][0] <= t) lo = mid; else hi = mid; }
  const a = path[lo], b = path[hi], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]), dt = Math.max(1e-6, b[0] - a[0]);
  return { p: [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4]],
    v: [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt, (b[3] - a[3]) / dt], done: false };
}

export async function mountRelive(h, roundId) {
  const fail = message => { h.toast(message, 6000); return null; };
  if (!h.ground) return fail('Den här banan saknar höjddata att återuppleva på.');
  let frame;
  try { frame = createMapFrame(h.ground.groundId, h.ground.frame); } catch (error) { return fail(`Kunde inte läsa banans ram: ${error.message}`); }
  const heightAt = (x, z) => { const y = h.heightAt(x, z); return Number.isFinite(y) ? y : 0; };
  const cupOf = n => { const cup = h.cups().find(c => c.hole === n); return cup ? [cup.x, cup.z] : h.holes[n - 1].pin.slice(); };
  const round = reliveRound(localStorage, h.slug, roundId, { toCourse: ([x, z]) => frame.toPack(x, z), cupOf });
  if (!round) return fail('Rundan finns inte på den här enheten.');
  const playable = round.holes.filter(hole => hole.plays.length);
  if (!playable.length) return fail('Rundan har inga inmätta slag att återuppleva.');

  const bag = (h.bag() || []).length ? h.bag() : DEFAULT_BAG;
  const clubOf = id => {
    const entry = bag.find(c => c.id === id) || DEFAULT_BAG.find(c => c.id === id) || { id, name: id, carry: 140 };
    const cat = clubCategory(entry);
    return { ...entry, cat, swing: CLUB_LAUNCH[cat]?.swing || 'Iron', carry: Number(entry.carry) || 140 };
  };
  const query = new URLSearchParams(location.search);
  const character = Object.hasOwn(GOLFER_CHARACTERS, query.get('golfare')) ? query.get('golfare') : 'female';

  h.releaseCamera(); h.quietCourse?.();
  h.controls.enabled = false;
  document.body.classList.add('pl-on', 'pl-relive');
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const hud = createPlayHud({ onMenu: () => openSheet(), onClub: () => {}, onOverview: () => {} });
  hud.root.querySelector('[data-overview]').remove();
  const bar = document.createElement('div'); bar.className = 'pl-rv-bar pl-glass'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Uppspelning');
  bar.innerHTML = `<button type="button" data-prev aria-label="Förra slaget">⏮</button><button type="button" data-play aria-label="Pausa">❚❚</button>
    <button type="button" data-next aria-label="Nästa slag">⏭</button><button type="button" data-hole aria-label="Nästa hål">Hål ›</button>
    <button type="button" data-speed aria-label="Hastighet">1×</button>`;
  hud.root.append(bar);
  const tag = document.createElement('span'); tag.className = 'pl-rv-tag pl-glass';
  const date = new Date(`${round.date}T12:00:00`);
  tag.textContent = `Återupplev · ${Number.isFinite(date.getTime()) ? date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }) : round.date}`;
  hud.root.append(tag);
  hud.banner('Laddar golfaren…', '', '', 0);
  const golfer = await loadGolfer(import.meta.env.BASE_URL, character);
  h.scene.add(golfer.root);
  hud.hideBanner();

  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 20, 14), new THREE.MeshStandardNodeMaterial({ color: '#fbfaf3', roughness: .42, emissive: '#5a5a52' }));
  h.scene.add(ballMesh);
  const TRACE = 600, traceGeometry = new THREE.BufferGeometry();
  traceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACE * 3), 3)); traceGeometry.setDrawRange(0, 0);
  const tracer = new THREE.Line(traceGeometry, new THREE.LineBasicNodeMaterial({ color: '#fff6d8', transparent: true, opacity: .9, depthWrite: false }));
  tracer.renderOrder = 3; tracer.frustumCulled = false; h.scene.add(tracer);
  const cam = createPlayCamera({ camera: h.camera, heightAt });

  let holeIndex = 0, strokeIndex = 0, state = 'idle', timer = 0, paused = false, speed = 1, flight = null, flightT = 0, traced = 0;
  const hole = () => playable[holeIndex];
  const stroke = () => hole().plays[strokeIndex];
  const cup = () => cupOf(hole().n);
  const ballAt = (x, z) => { ballMesh.position.set(x, heightAt(x, z) + BALL.radius, z); ballMesh.visible = true; };

  function card() {
    const H = h.holes[hole().n - 1], s = stroke();
    hud.hole({ n: hole().n, par: hole().par, length: H.t?.[0] ?? Math.round(H.lineLen || 0), strokes: strokeIndex, name: '' });
    const from = s?.from || cup();
    const left = Math.hypot(cup()[0] - from[0], cup()[1] - from[1]);
    hud.shot({ toPin: left, lie: s ? LIE_NAME[lieOf(s.fromLie)] || 'Fairway' : 'Green', windMs: 0, windDeg: 0, windLabel: 'Inspelad runda' });
    hud.root.querySelector('[data-wind]').style.display = 'none';
  }
  function address() {
    const s = stroke();
    if (!s) return endHole();
    const club = clubOf(s.club);
    const to = s.to || cup();
    const yaw = Math.atan2(to[0] - s.from[0], to[1] - s.from[1]);
    ballAt(s.from[0], s.from[1]);
    golfer.paused = false;
    golfer.selectClub(club.swing, false);
    standAtBall(golfer, ballMesh.position, yaw, club.swing, heightAt);
    golfer.play(`Address${club.swing}`, { fade: .2 });
    cam.address(ballMesh.position, yaw, { putt: s.putt, distance: s.distance ?? 20 });
    traceGeometry.setDrawRange(0, 0); traced = 0;
    const n = strokeIndex + 1;
    hud.banner(s.putt ? `Putt · slag ${n}` : `Slag ${n} · ${club.name}`,
      s.putt ? (s.counted && strokeIndex === hole().plays.findIndex(p => p.putt) ? 'Puttarna är räknade, inte inmätta' : '') : LIE_NAME[lieOf(s.fromLie)] || '', '', 1600);
    card();
    state = 'address'; timer = 1.1;
    flight = reconstructFlight({ club, from: s.from, to, putt: s.putt, heightAt, lie: lieOf(s.fromLie) });
  }
  function swing() {
    const club = clubOf(stroke().club);
    state = 'swing';
    golfer.play(GOLF_SWINGS[club.swing], { fade: .1 });
  }
  golfer.onImpact = () => { if (state === 'swing') { state = 'flight'; flightT = 0; cam.launch(); } };
  function landed() {
    const s = stroke(), d = s.distance;
    if (s.outcome === 'out') hud.banner('Out of bounds', 'Pliktslag · slogs om från samma plats', 'bad', 2200);
    else if (s.inHazard) hud.banner('Pliktområde', `${s.penalty ? `+${s.penalty} pliktslag` : 'Plikt'}`, 'bad', 2200);
    else if (s.holed) hud.banner('I hålet', d != null ? `${d < 10 ? d.toFixed(1) : Math.round(d)} m` : '', 'good', 1800);
    else hud.banner(d != null ? `${d < 10 ? d.toFixed(1) : Math.round(d)} m` : 'Slag', LIE_NAME[lieOf(s.toLie)] || '', '', 1600);
    if (s.holed) ballMesh.visible = false;
    cam.rest(ballMesh.position, new THREE.Vector3(cup()[0], heightAt(...cup()), cup()[1]));
    state = 'rest'; timer = s.holed ? .9 : 1.5;
  }
  function advance() {
    if (strokeIndex + 1 < hole().plays.length) { strokeIndex++; address(); }
    else endHole();
  }
  function endHole() {
    const H = hole();
    const name = H.picked ? 'Plockad' : scoreName(H.strokes, H.par);
    hud.banner(`Hål ${H.n} · ${name}`, H.picked ? '' : `${H.strokes} slag · ${H.putts ?? 0} puttar`, !H.picked && H.strokes <= H.par ? 'good' : '', 2600);
    if (!H.picked && H.strokes <= H.par) golfer.play('Celebrate', { fade: .25 });
    state = 'holeEnd'; timer = 2.8;
  }
  function startHole(i) {
    holeIndex = Math.max(0, Math.min(playable.length - 1, i)); strokeIndex = 0;
    if (h.hole() !== hole().n) h.goHole(hole().n, false, true);
    h.releaseCamera(); h.quietCourse?.();
    hud.fade(true);
    setTimeout(() => { address(); cam.snap(); hud.fade(false); }, 300);
    state = 'idle';
  }
  function nextHole() {
    if (holeIndex + 1 < playable.length) startHole(holeIndex + 1);
    else { state = 'done'; openSheet(true); }
  }
  function openSheet(finished = false) {
    const rec = { order: round.holes.map(x => x.n), holes: Object.fromEntries(round.holes.map(x => [x.n, { strokes: x.strokes, holed: !x.picked, picked: x.picked }])) };
    const t = round.totals;
    const box = hud.openSheet(`<h2>${round.courseName || h.courseName}</h2>
      <p class="pl-sub">Återupplev · ${round.date}${round.tee ? ` · ${round.tee} tee` : ''}${t ? ` · ${t.strokes} slag` : ''}</p>
      ${scorecardHtml(rec, h.holes)}
      <p class="pl-sub">${playable.length} av ${round.holes.length} hål har inmätta slag. Puttar är räknade, inte inmätta. Inget i rundan ändras.</p>
      <div class="pl-actions">${finished ? `<button class="pl-btn pl-primary" data-again type="button">Spela upp igen</button>` : `<button class="pl-btn pl-primary" data-resume type="button">Fortsätt</button>`}
      <button class="pl-btn pl-ghost" data-back type="button">Tillbaka till statistiken</button></div>`);
    box.querySelector('[data-resume]')?.addEventListener('click', () => { hud.closeSheet(); setPaused(false); });
    box.querySelector('[data-again]')?.addEventListener('click', () => { hud.closeSheet(); startHole(0); });
    box.querySelector('[data-back]').addEventListener('click', () => location.assign(`${import.meta.env.BASE_URL}#statistik/${encodeURIComponent(h.slug)}`));
    if (!finished) setPaused(true);
    box.querySelector('button').focus();
  }
  function setPaused(on) {
    paused = on;
    const b = bar.querySelector('[data-play]');
    b.textContent = on ? '▶' : '❚❚'; b.setAttribute('aria-label', on ? 'Spela' : 'Pausa');
    golfer.rate = on ? 0 : speed;
  }
  bar.querySelector('[data-play]').onclick = () => setPaused(!paused);
  bar.querySelector('[data-next]').onclick = () => { if (state !== 'done') advance(); };
  bar.querySelector('[data-prev]').onclick = () => { if (state === 'address' && strokeIndex > 0) strokeIndex--; address(); };
  bar.querySelector('[data-hole]').onclick = nextHole;
  bar.querySelector('[data-speed]').onclick = e => { speed = speed === 1 ? 2 : speed === 2 ? .5 : 1; e.target.textContent = `${speed}×`; if (!paused) golfer.rate = speed; };
  const abort = new AbortController();
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopImmediatePropagation();
    if (hud.sheetOpen) { if (e.key === 'Escape') { hud.closeSheet(); setPaused(false); } return; }
    if (e.key === ' ') { setPaused(!paused); e.preventDefault(); }
    else if (e.key === 'ArrowRight') bar.querySelector('[data-next]').click();
    else if (e.key === 'ArrowLeft') bar.querySelector('[data-prev]').click();
    else if (e.key === 'n' || e.key === 'N') nextHole();
    else if (e.key === 'Escape') openSheet();
  }, { capture: true, signal: abort.signal });

  startHole(0);
  return {
    get ownsCamera() { return true; },
    update(dt) {
      restoreLegs(golfer);
      golfer.update(dt);
      fitFeet(golfer.root, heightAt);
      const step = paused ? 0 : dt * speed;
      if (state === 'address' || state === 'rest' || state === 'holeEnd') {
        timer -= step;
        if (timer <= 0) {
          if (state === 'address') swing();
          else if (state === 'rest') advance();
          else nextHole();
        }
      } else if (state === 'flight' && flight) {
        flightT += step;
        const s = sample(flight.path, flightT), p = s.p;
        ballMesh.position.set(p[1], p[2], p[3]);
        if (traced < TRACE && !stroke().putt) { traceGeometry.attributes.position.setXYZ(traced++, p[1], p[2], p[3]); traceGeometry.attributes.position.needsUpdate = true; traceGeometry.setDrawRange(0, traced); }
        const s0 = stroke(), to = s0.to || cup();
        const landing = flight.landing ? new THREE.Vector3(...flight.landing) : new THREE.Vector3(to[0], heightAt(to[0], to[1]), to[1]);
        cam.flight(ballMesh.position, new THREE.Vector3(...s.v), { landing, start: new THREE.Vector3(s0.from[0], heightAt(...s0.from), s0.from[1]),
          progress: flightT / Math.max(.2, flight.time * .7), putt: s0.putt });
        if (s.done) landed();
      }
      const d = h.camera.position.distanceTo(ballMesh.position);
      ballMesh.scale.setScalar(Math.max(1, d * .085));
      cam.update(dt);
    },
    state: () => ({ state, hole: hole()?.n, stroke: strokeIndex, holes: playable.length, paused, ball: ballMesh.position.toArray() }),
    dispose() {
      abort.abort(); hud.dispose(); style.remove(); golfer.dispose();
      for (const o of [ballMesh, tracer]) { h.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      document.body.classList.remove('pl-on', 'pl-relive'); h.controls.enabled = true;
    },
  };
}
