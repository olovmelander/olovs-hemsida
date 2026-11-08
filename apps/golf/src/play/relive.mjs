/* Återupplev: a round recorded with the map, replayed on the detailed course.

   Every measured shot starts and ends exactly where the phone locked it; the
   flight between is the club's own (ball-physics.mjs), turned and stretched
   onto the line the ball really travelled. Putts are counted, not positioned,
   and are shown rolling from the first putt's spot -- and said to be. Nothing
   here writes anything: a relived round changes no record and no statistic. */
import * as THREE from 'three/webgpu';
import { loadGolfer, GOLF_SWINGS, GOLFER_CHARACTERS } from '../engine/golfer.mjs';
import { DEFAULT_BAG, parseBag } from '../engine/caddie.js';
import { exampleData } from '../shell/stats-model.mjs';
import { createMapFrame } from '../map/map-frames.mjs';
import { BALL, launchState, simulateShot, puttSpeedFor, SURFACES, CLUB_LAUNCH } from './ball-physics.mjs';
import { clubCategory, launchFor, powerFor, LIE_NAME } from './shot-model.mjs';
import { reliveRound, exampleRound, EXAMPLE_PREFIX } from './relive-model.mjs';
import { createPlayCamera } from './play-camera.mjs';
import { standAtBall, fitFeet, restoreLegs } from './golfer-rig.mjs';
import { createPlayHud, scorecardHtml } from './play-hud.mjs';
import { createRibbonTracer } from './ribbon-tracer.mjs';
import { createPlayAudio } from './play-audio.mjs';
import { createPlayWorld } from './play-world.mjs';
import { createHoleMap } from './hole-map.mjs';
import { scoreName, PLAY_KEYS } from './play-rules.mjs';

const MAP_LIE = { green: 'green', bunker: 'sand', tee: 'tee', fairway: 'fairway', water: 'water', rough: 'rough' };
const CSS = `
body.pl-relive .pl-dock,body.pl-relive .pl-swing,body.pl-relive .pl-help,body.pl-relive .pl-setup-panel,body.pl-relive .pl-stats,body.pl-relive .pl-cond{display:none!important}
body.pl-relive .pl-live{top:max(14px,env(safe-area-inset-top));background:rgba(9,18,14,.78);border:1px solid rgba(160,230,185,.15)}
body.pl-relive .pl-third{bottom:calc(max(16px,env(safe-area-inset-bottom)) + 104px);border-left-color:#4bb4d8}
body.pl-relive .pl-third-kicker{color:#9fdcf2}
.pl-rv-bar{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom));transform:translateX(-50%);display:grid;gap:8px;padding:10px 12px 8px;border-radius:20px}
.pl-rv-line{display:flex;align-items:center;gap:10px;padding:0 4px}
.pl-rv-line .pl-k{white-space:nowrap}
.pl-rv-dots{display:flex;align-items:center;gap:6px;flex:1;justify-content:center}
.pl-rv-dots i{width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(234,243,236,.45);transition:background .25s,transform .25s}
.pl-rv-dots i.done{background:rgba(234,243,236,.55);border-color:transparent}
.pl-rv-dots i.now{background:#4bb4d8;border-color:#4bb4d8;transform:scale(1.3);box-shadow:0 0 10px rgba(75,180,216,.7)}
.pl-rv-dots i.putt{border-radius:3px}
.pl-rv-buttons{display:flex;align-items:center;justify-content:center;gap:4px}
.pl-rv-bar button{min-width:48px;min-height:48px;border:0;border-radius:13px;background:transparent;color:var(--ink,#eaf3ec);font:600 17px Outfit,system-ui,sans-serif;cursor:pointer}
.pl-rv-bar button:hover{background:rgba(255,255,255,.06)}
.pl-rv-bar button:focus-visible{outline:2px solid var(--turf,#5fd07a);outline-offset:1px}
.pl-rv-bar [data-play]{background:linear-gradient(160deg,#6fe08a,#3fae5d);color:#07170d;min-width:66px}
.pl-rv-bar [data-speed]{font:600 13px 'JetBrains Mono',monospace;min-width:52px}
@media (max-width:640px){
  body.pl-relive .pl-live{top:auto;bottom:calc(max(16px,env(safe-area-inset-bottom)) + 112px);font-size:10px}
  body.pl-relive .pl-third{bottom:calc(max(16px,env(safe-area-inset-bottom)) + 156px)}
  .pl-rv-bar{width:calc(100vw - 20px)}
}
`;
/** Where a swing clip's backswing tops out. */
const lieOf = lie => MAP_LIE[lie] || 'fairway';

/** The flight of a recorded shot: the club's own, laid onto from -> to. */
export function reconstructFlight({ club, from, to, putt, heightAt, lie = 'fairway', landLie = 'fairway' }) {
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
    return { path, landing: null, time: T, events: [] };
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
  // Its bounces, heard on the surface the map recorded it finishing on.
  const events = flat.events.map(e => (e.type === 'bounce' ? { ...e, surface: landLie } : e));
  return { path, landing, time: last[0] + .05, events };
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
  const heightAt = (x, z) => { const y = h.heightAt(x, z); return Number.isFinite(y) ? y : 0; };
  const cupOf = n => { const cup = h.cups().find(c => c.hole === n); return cup ? [cup.x, cup.z] : h.holes[n - 1].pin.slice(); };
  let round;
  if (String(roundId).startsWith(EXAMPLE_PREFIX)) {
    /* Statistik's example: rebuilt from the same catalog and seed it was drawn from,
       and laid along this course's holes (relive-model.mjs exampleRound) */
    try {
      const catalog = await (await fetch(`${import.meta.env.BASE_URL}courses/index.json`)).json();
      const example = exampleData({ courses: catalog.courses || [], bag: parseBag(null) });
      round = exampleRound(example, String(roundId).slice(EXAMPLE_PREFIX.length), { holes: h.holes, tee: h.tee() });
    } catch (error) { return fail(`Exemplet kunde inte läsas: ${error.message}`); }
    if (!round || round.slug !== h.slug) return fail('Exemplet hör till en annan bana.');
  } else {
    if (!h.ground) return fail('Den här banan saknar höjddata att återuppleva på.');
    let frame;
    try { frame = createMapFrame(h.ground.groundId, h.ground.frame); } catch (error) { return fail(`Kunde inte läsa banans ram: ${error.message}`); }
    round = reliveRound(localStorage, h.slug, roundId, { toCourse: ([x, z]) => frame.toPack(x, z), cupOf });
    if (!round) return fail('Rundan finns inte på den här enheten.');
  }
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
  const hud = createPlayHud({ onMenu: () => openSheet(), onClub: () => {}, onView: () => {} });
  hud.root.querySelector('[data-view]').remove();
  const bar = document.createElement('div'); bar.className = 'pl-rv-bar pl-glass'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Uppspelning');
  bar.innerHTML = `<div class="pl-rv-line"><span class="pl-k" data-rv-hole>Hål</span><span class="pl-rv-dots" data-rv-dots></span><span class="pl-k" data-rv-count></span></div>
    <div class="pl-rv-buttons"><button type="button" data-prev aria-label="Förra slaget" title="Förra slaget (←)">⏮</button><button type="button" data-play aria-label="Pausa" title="Pausa (mellanslag)">❚❚</button>
    <button type="button" data-next aria-label="Nästa slag" title="Nästa slag (→)">⏭</button><button type="button" data-hole aria-label="Nästa hål" title="Nästa hål (N)">Hål ›</button>
    <button type="button" data-speed aria-label="Hastighet">1×</button></div>`;
  hud.root.append(bar);
  const date = new Date(`${round.date}T12:00:00`);
  // The broadcast bug: what is being watched, and when it was played.
  hud.live(round.example ? 'Exempel · Återupplev'
    : `Återupplev · ${Number.isFinite(date.getTime()) ? date.toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' }) : round.date}`);
  // The hole map, with the round's own shots drawn on it.
  const world = createPlayWorld(h);
  const holeMap = createHoleMap({ parent: hud.mapSlot, surfaceAt: world.surfaceAt, heightAt, trees: world.trees, small: matchMedia('(max-width: 640px)').matches });
  hud.banner('Laddar golfaren…', '', '', 0);
  const golfer = await loadGolfer(import.meta.env.BASE_URL, character);
  h.scene.add(golfer.root);
  hud.hideBanner();

  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 20, 14), new THREE.MeshStandardNodeMaterial({ color: '#fbfaf3', roughness: .42, emissive: '#5a5a52' }));
  h.scene.add(ballMesh);
  const tracer = createRibbonTracer({ scene: h.scene, camera: h.camera });
  const audio = createPlayAudio({ enabled: (() => { try { return JSON.parse(localStorage.getItem(PLAY_KEYS.settings) || '{}').sound !== false; } catch { return true; } })() });
  const cam = createPlayCamera({ camera: h.camera, heightAt });

  let holeIndex = 0, strokeIndex = 0, state = 'idle', timer = 0, paused = false, speed = 1, flight = null, flightT = 0, eventIdx = 0;
  const hole = () => playable[holeIndex];
  const stroke = () => hole().plays[strokeIndex];
  const cup = () => cupOf(hole().n);
  const ballAt = (x, z) => { ballMesh.position.set(x, heightAt(x, z) + BALL.radius, z); ballMesh.visible = true; };

  function card() {
    const H = h.holes[hole().n - 1], s = stroke();
    const length = H.t?.[0] ?? Math.round(H.lineLen || 0);
    hud.hole({ n: hole().n, par: hole().par, length, strokes: strokeIndex, name: H.name || '', index: Number.isFinite(H.idx) ? H.idx : null });
    // The course guide's page for the hole, behind the hole card as in Spela.
    hud.guide({ title: `Hål ${hole().n}${H.name ? ` · ${H.name}` : ''}`, sub: `Par ${hole().par} · ${length} m${Number.isFinite(H.idx) ? ` · index ${H.idx}` : ''}`,
      note: H.note || H.shape || '', facts: `Banguide från ${h.courseName}` });
    const from = s?.from || cup();
    const left = Math.hypot(cup()[0] - from[0], cup()[1] - from[1]);
    hud.shot({ toPin: left, lie: s ? LIE_NAME[lieOf(s.fromLie)] || 'Fairway' : 'Green', windMs: 0, windDeg: 0, windLabel: 'Inspelad runda' });
    // The hole's shots as the timeline's dots: played, playing, to come (a putt is square).
    const plays = hole().plays;
    bar.querySelector('[data-rv-hole]').textContent = `Hål ${hole().n}`;
    bar.querySelector('[data-rv-count]').textContent = `Slag ${Math.min(strokeIndex + 1, plays.length)}/${plays.length}`;
    bar.querySelector('[data-rv-dots]').innerHTML = plays.map((p, i) => `<i class="${i < strokeIndex ? 'done' : i === strokeIndex ? 'now' : ''}${p.putt ? ' putt' : ''}"></i>`).join('');
    // And on the hole map: the shots so far, and the ball.
    const done = plays.slice(0, strokeIndex).map(p => ({ from: p.from, to: p.to || cup() }));
    holeMap.marks({ ball: from, pin: cup(), strokes: done, aim: s ? (s.to || cup()) : null });
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
    tracer.reset();
    const n = strokeIndex + 1;
    const length = Math.hypot(to[0] - s.from[0], to[1] - s.from[1]);
    hud.third({ kicker: `Hål ${hole().n} · slag ${n} av ${hole().plays.length}`, title: s.putt ? 'Putt' : club.name,
      sub: `${length < 10 ? length.toFixed(1).replace('.', ',') : Math.round(length)} m · ${LIE_NAME[lieOf(s.fromLie)] || 'Fairway'} → ${s.holed ? 'i hålet' : LIE_NAME[lieOf(s.toLie)] || 'Green'}`,
      body: s.putt && !round.example && s.counted && strokeIndex === hole().plays.findIndex(p => p.putt) ? 'Puttarna är räknade, inte inmätta: de rullas från första puttens plats.' : '' });
    card();
    state = 'address'; timer = 1.1;
    flight = reconstructFlight({ club, from: s.from, to, putt: s.putt, heightAt, lie: lieOf(s.fromLie), landLie: lieOf(s.toLie) });
  }
  function swing() {
    const club = clubOf(stroke().club);
    state = 'swing';
    golfer.play(GOLF_SWINGS[club.swing], { fade: .1 });
  }
  golfer.onImpact = () => {
    if (state !== 'swing') return;
    state = 'flight'; flightT = 0; eventIdx = 0; cam.launch();
    const club = clubOf(stroke().club);
    audio.strike(club.cat === 'putter' || stroke().putt ? 'putter' : club.cat === 'driver' ? 'driver' : /wood|hybrid/.test(club.cat) ? 'wood' : /^(pw|gw|sw|lw)$/.test(club.cat) ? 'wedge' : 'iron',
      { pure: .7, power: .9, lie: lieOf(stroke().fromLie) });
  };
  function landed() {
    const s = stroke(), d = s.distance;
    if (s.outcome === 'out') hud.banner('Out of bounds', 'Pliktslag · slogs om från samma plats', 'bad', 2200);
    else if (s.inHazard) hud.banner('Pliktområde', `${s.penalty ? `+${s.penalty} pliktslag` : 'Plikt'}`, 'bad', 2200);
    else if (s.holed) { hud.banner('I hålet', d != null ? `${d < 10 ? d.toFixed(1) : Math.round(d)} m` : '', 'good', 1800); audio.cup(); }
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
    hud.third(null);
    holeMap.marks({ pin: cup(), strokes: H.plays.map(p => ({ from: p.from, to: p.to || cup() })) });
    state = 'holeEnd'; timer = 2.8;
  }
  function startHole(i) {
    holeIndex = Math.max(0, Math.min(playable.length - 1, i)); strokeIndex = 0;
    if (h.hole() !== hole().n) h.goHole(hole().n, false, true);
    h.releaseCamera(); h.quietCourse?.();
    const H = h.holes[hole().n - 1];
    holeMap.setHole({ line: H.line || [hole().plays[0].from, cup()], boundaries: world.boundaries });
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
      <p class="pl-sub">${round.example
        ? 'Ett exempel från Statistik: en påhittad spelares runda, med slagen lagda längs banans hål. Det är inte dina siffror.'
        : `${playable.length} av ${round.holes.length} hål har inmätta slag. Puttar är räknade, inte inmätta. Inget i rundan ändras.`}</p>
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
  addEventListener('pointerdown', () => audio.unlock(), { capture: true, signal: abort.signal });
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.stopImmediatePropagation();
    audio.unlock();
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
      if (!holeMap.ready) holeMap.step(3);
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
        if (!stroke().putt && (p[4] === 'air' || tracer.count < 2)) tracer.push(p[1], p[2], p[3]);
        while (eventIdx < flight.events.length && flight.events[eventIdx].t <= flightT) {
          const e = flight.events[eventIdx++];
          if (e.type === 'bounce') audio.bounce(e.surface, e.speed);
        }
        const s0 = stroke(), to = s0.to || cup();
        const landing = flight.landing ? new THREE.Vector3(...flight.landing) : new THREE.Vector3(to[0], heightAt(to[0], to[1]), to[1]);
        cam.flight(ballMesh.position, new THREE.Vector3(...s.v), { landing, start: new THREE.Vector3(s0.from[0], heightAt(...s0.from), s0.from[1]),
          progress: flightT / Math.max(.2, flight.time * .7), putt: s0.putt });
        if (s.done) landed();
      }
      const d = h.camera.position.distanceTo(ballMesh.position);
      ballMesh.scale.setScalar(Math.max(1, d * .085));
      cam.update(dt);
      tracer.update(h.renderer.domElement.clientHeight || innerHeight);
    },
    state: () => ({ state, hole: hole()?.n, stroke: strokeIndex, holes: playable.length, paused, ball: ballMesh.position.toArray() }),
    dispose() {
      abort.abort(); holeMap.dispose(); hud.dispose(); style.remove(); golfer.dispose(); tracer.dispose(); audio.dispose();
      h.scene.remove(ballMesh); ballMesh.geometry.dispose(); ballMesh.material.dispose();
      document.body.classList.remove('pl-on', 'pl-relive'); h.controls.enabled = true;
    },
  };
}
