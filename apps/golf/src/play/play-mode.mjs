/* Spela: the detailed course played as a game, one shot at a time.

   main.js hands over the world (the end of main.js); this module owns the
   golfer, the ball, the camera and the screen while a round is on. A shot is
   simulated whole the moment the club meets the ball (ball-physics.mjs) and
   then played back in real time, so the camera knows where it lands and the
   same swing always gives the same shot. */
import * as THREE from 'three/webgpu';
import { loadGolfer, GOLF_SWINGS, GOLFER_CHARACTERS } from '../engine/golfer.mjs';
import { launchState, simulateShot, BALL } from './ball-physics.mjs';
import { playBag, suggestClub, launchFor, puttRangeFor, powerFor, LIE_NAME, DIFFICULTY } from './shot-model.mjs';
import { createRound, addStroke, addPenalty, holeCard, roundTotals, nextHole, scoreName, savePlayedRound, dropPoint, PLAY_KEYS } from './play-rules.mjs';
import { createPlayWorld } from './play-world.mjs';
import { createPlayCamera } from './play-camera.mjs';
import { standAtBall, fitFeet, restoreLegs } from './golfer-rig.mjs';
import { createSwingPad, SWING_METHODS } from './swing-input.mjs';
import { createPlayHud, scorecardHtml } from './play-hud.mjs';

export async function mountPlay(handle) {
  const query = new URLSearchParams(location.search);
  if (query.has('aterupplev')) {
    const { mountRelive } = await import('./relive.mjs');
    return mountRelive(handle, query.get('aterupplev'));
  }
  return startPlay(handle, query);
}

function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(PLAY_KEYS.settings) || '{}');
    return { difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : 'normal', method: SWING_METHODS[s.method] ? s.method : 'drag' };
  } catch { return { difficulty: 'normal', method: 'drag' }; }
}
function saveSettings(settings) { try { localStorage.setItem(PLAY_KEYS.settings, JSON.stringify(settings)); } catch {} }

/** Where a swing clip's backswing tops out: a third of a second before impact. */
const topOf = clip => Math.max(.35, clip.impact - .34);
/** The time and position along a recorded path (binary search). */
function sample(path, t) {
  let lo = 0, hi = path.length - 1;
  if (t >= path[hi][0]) return { p: path[hi], v: [0, 0, 0], done: true };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid][0] <= t) lo = mid; else hi = mid; }
  const a = path[lo], b = path[hi], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
  const dt = Math.max(1e-6, b[0] - a[0]);
  return { p: [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u, a[4]],
    v: [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt, (b[3] - a[3]) / dt], done: false };
}

async function startPlay(h, query) {
  const settings = readSettings();
  const characterId = Object.hasOwn(GOLFER_CHARACTERS, query.get('golfare')) ? query.get('golfare') : 'female';
  const world = createPlayWorld(h);
  const bag = playBag(h.bag());
  const heightAt = world.heightAt;
  h.releaseCamera();
  h.quietCourse?.();
  h.controls.enabled = false;
  document.body.classList.add('pl-on');

  const hud = createPlayHud({
    onMenu: () => openMenu(),
    onClub: d => changeClub(d),
    onOverview: () => setOverview(!overview),
  });
  hud.banner('Laddar golfaren…', '', '', 0);
  const golfer = await loadGolfer(import.meta.env.BASE_URL, characterId);
  h.scene.add(golfer.root);
  hud.hideBanner();

  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 20, 14), new THREE.MeshStandardNodeMaterial({ color: '#fbfaf3', roughness: .42, emissive: '#5a5a52' }));
  ballMesh.renderOrder = 0;
  h.scene.add(ballMesh);
  // A soft round glow (a small data texture; the sprite's quad is otherwise a square).
  const glowSize = 32, glowData = new Uint8Array(glowSize * glowSize * 4);
  for (let y = 0; y < glowSize; y++) for (let x = 0; x < glowSize; x++) {
    const r = Math.hypot(x + .5 - glowSize / 2, y + .5 - glowSize / 2) / (glowSize / 2);
    const i = (y * glowSize + x) * 4;
    glowData[i] = 255; glowData[i + 1] = 251; glowData[i + 2] = 232;
    glowData[i + 3] = Math.round(255 * Math.max(0, 1 - r) ** 1.8);
  }
  const glow = new THREE.DataTexture(glowData, glowSize, glowSize, THREE.RGBAFormat);
  glow.needsUpdate = true; glow.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(new THREE.SpriteNodeMaterial({ map: glow, transparent: true, opacity: .8, depthWrite: false }));
  halo.renderOrder = 3; halo.visible = false; h.scene.add(halo);
  const markerMaterial = new THREE.MeshBasicNodeMaterial({ color: '#f0a23a', transparent: true, opacity: .95, depthTest: false, depthWrite: false });
  const marker = new THREE.Mesh(new THREE.RingGeometry(.75, 1.05, 48), markerMaterial);
  marker.rotation.x = -Math.PI / 2; marker.renderOrder = 3; marker.visible = false; h.scene.add(marker);
  const DOTS = 60;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.022, 8, 6), new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: .85, depthWrite: false }), DOTS);
  dots.renderOrder = 3; dots.count = 0; dots.frustumCulled = false; h.scene.add(dots);
  const TRACE = 600;
  const traceGeometry = new THREE.BufferGeometry();
  traceGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRACE * 3), 3));
  traceGeometry.setDrawRange(0, 0);
  const tracer = new THREE.Line(traceGeometry, new THREE.LineBasicNodeMaterial({ color: '#fff6d8', transparent: true, opacity: .9, depthWrite: false }));
  tracer.renderOrder = 3; tracer.frustumCulled = false; h.scene.add(tracer);

  const cam = createPlayCamera({ camera: h.camera, heightAt });
  const round = createRound({ slug: h.slug, courseName: h.courseName, holes: h.holes, startHole: h.hole(), tee: h.tee(),
    character: characterId, difficulty: settings.difficulty });
  const ball = new THREE.Vector3();
  let state = 'loading', lie = 'tee', yaw = 0, clubIndex = 0, cup = [0, 0, 0], puttRange = 10;
  let shot = null, flightT = 0, fast = 1, airTime = 1, traced = 0, waitFor = 0, after = null, overview = false;
  let strokeFrom = [0, 0], pending = null, planned = 1;
  const club = () => bag[clubIndex];
  const hole = () => h.holes[round.current - 1];
  const toCup = () => Math.hypot(cup[0] - ball.x, cup[1] - ball.z);
  const swingClip = () => golfer.clips.get(GOLF_SWINGS[club().swing]);

  const pad = createSwingPad({
    parent: hud.root, method: settings.method,
    onBack: power => {
      if (state !== 'address') return;
      hud.power(club().cat === 'putter' ? `≈ ${(Math.min(power, 1.1) * puttRange).toFixed(1)} m` : `${Math.round(power * 100)} %`);
      if (pad.method === 'drag') {
        const clip = swingClip();
        if (golfer.current !== clip.name) golfer.play(clip.name, { fade: .12 });
        golfer.paused = true; golfer.seek(topOf(clip) * Math.min(1, power));
      }
    },
    onStrike: input => strike(input),
    onCancel: () => { if (state === 'address') { golfer.paused = false; golfer.play(`Address${club().swing}`, { fade: .2 }); hud.power(''); } },
  });

  golfer.onImpact = () => { if (state === 'swinging') launch(); };

  /* -- the hole and the lie ------------------------------------------------- */
  function aimYaw(distance) {
    const d = toCup();
    if (club().cat === 'putter' || d <= distance * 1.12) return Math.atan2(cup[0] - ball.x, cup[1] - ball.z);
    // Along the hole's line: the point a club's distance away, never past the green.
    const line = hole().line;
    let best = null;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i];
      for (let s = 0; s <= 1; s += .05) {
        const x = a[0] + (b[0] - a[0]) * s, z = a[1] + (b[1] - a[1]) * s;
        const reach = Math.hypot(x - ball.x, z - ball.z), left = Math.hypot(cup[0] - x, cup[1] - z);
        if (left >= d) continue;
        const score = Math.abs(reach - distance);
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    const target = best || { x: cup[0], z: cup[1] };
    return Math.atan2(target.x - ball.x, target.z - ball.z);
  }
  function setBall(x, z) {
    ball.set(x, heightAt(x, z) + BALL.radius, z);
    ballMesh.position.copy(ball); ballMesh.visible = true;
  }
  function wind() {
    const w = h.wind();
    return [Number(w.x) || 0, Number(w.z) || 0];
  }
  /** The share of a full swing that reaches the target (the pin, or the club's lay-up point). */
  function plan() {
    const c = club();
    if (c.cat === 'putter') {
      planned = Math.min(1, toCup() / puttRange);
    } else {
      const reach = Math.min(toCup(), c.carry * 1.3);
      planned = powerFor(c, reach, lie) ?? 1;
    }
    pad.target(planned);
  }
  function showHud() {
    const n = round.current, card = holeCard(round, n), H = hole();
    const length = H.t?.[Math.min(round.tee, (H.t?.length || 1) - 1)] ?? Math.round(H.lineLen || 0);
    hud.hole({ n, par: H.par, length, strokes: card.strokes, name: '' });
    const [wx, wz] = wind(), ms = Math.hypot(wx, wz);
    // The arrow points where the wind blows, relative to the aim (up = with you).
    const rel = (Math.atan2(wx, wz) - yaw) * 180 / Math.PI;
    const along = ms > .2 ? (Math.cos(rel * Math.PI / 180) > .5 ? 'medvind' : Math.cos(rel * Math.PI / 180) < -.5 ? 'motvind' : 'sidvind') : 'stilla';
    hud.shot({ toPin: toCup(), lie: LIE_NAME[lie] || lie, windMs: ms, windDeg: -rel, windLabel: `Vind ${ms.toFixed(1)} m/s, ${along}` });
    hud.club({ name: club().name, carry: club().carry, putt: club().cat === 'putter', range: puttRange });
  }

  function address(snap = false) {
    lie = world.surfaceAt(ball.x, ball.z);
    if (lie === 'water') lie = 'rough';
    const target = suggestClub(bag, toCup(), lie);
    clubIndex = Math.max(0, bag.indexOf(target));
    puttRange = puttRangeFor(toCup());
    yaw = aimYaw(club().carry);
    stand(true);
    cam.address(ball, yaw, { putt: club().cat === 'putter', distance: Math.min(toCup(), club().carry || toCup()) });
    if (snap) cam.snap();
    overview = false; hud.overview(false);
    state = 'address';
    pad.setEnabled(true);
    plan(); showHud(); preview();
  }
  function stand(replay = false) {
    golfer.paused = false;
    golfer.selectClub(club().swing, false);
    standAtBall(golfer, ball, yaw, club().swing, heightAt);
    if (replay || !golfer.current?.startsWith('Address')) golfer.play(`Address${club().swing}`, { fade: .2 });
  }
  function changeClub(d) {
    if (state !== 'address') return;
    clubIndex = Math.max(0, Math.min(bag.length - 1, clubIndex + d));
    puttRange = puttRangeFor(toCup());
    stand(true);
    cam.address(ball, yaw, { putt: club().cat === 'putter', distance: Math.min(toCup(), club().carry || toCup()) });
    plan(); showHud(); preview();
  }
  function turn(degrees) {
    if (state !== 'address') return;
    yaw -= degrees * Math.PI / 180;            // positive turns the aim to the right
    standAtBall(golfer, ball, yaw, club().swing, heightAt);
    if (overview) cam.overview(ball, aimPoint(), yaw);
    else cam.address(ball, yaw, { putt: club().cat === 'putter', distance: Math.min(toCup(), club().carry || toCup()) });
    showHud(); preview();
  }
  function aimPoint() {
    const reach = club().cat === 'putter' ? Math.min(toCup(), puttRange) : Math.min(toCup() + 5, club().carry);
    return new THREE.Vector3(ball.x + Math.sin(yaw) * reach, 0, ball.z + Math.cos(yaw) * reach).setY(heightAt(ball.x + Math.sin(yaw) * reach, ball.z + Math.cos(yaw) * reach));
  }
  function setOverview(on) {
    if (state !== 'address') return;
    overview = on; hud.overview(on);
    if (on) cam.overview(ball, aimPoint(), yaw);
    else cam.address(ball, yaw, { putt: club().cat === 'putter', distance: Math.min(toCup(), club().carry || toCup()) });
  }

  /* -- what the aid shows ahead (by difficulty) ------------------------------ */
  function preview() {
    const level = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    marker.visible = false; dots.count = 0;
    if (level.preview === 'none' || state !== 'address') return;
    const putt = club().cat === 'putter';
    const L = launchFor({ club: club(), power: planned, yaw, lie, difficulty: settings.difficulty, puttRange });
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: L.yaw, spinRpm: L.spinRpm, axisDeg: 0 });
    const result = simulateShot(world.forStroke([ball.x, ball.z], cup), { start: [ball.x, ball.y, ball.z], velocity, spin,
      wind: level.preview === 'full' ? wind() : [0, 0], roll: L.roll }, { every: 6 });
    const m = new THREE.Matrix4();
    if (putt) {
      // The green's read: the whole roll on Lätt, the start line on Normal.
      const path = level.preview === 'full' ? result.path : result.path.slice(0, Math.ceil(result.path.length * .4));
      // A dot every 25 cm along the roll (a putt's read), never on top of each other.
      let k = 0, last = null;
      for (const q of path) {
        if (k >= DOTS) break;
        if (last && Math.hypot(q[1] - last[1], q[3] - last[3]) < .25) continue;
        last = q; m.makeTranslation(q[1], heightAt(q[1], q[3]) + .02, q[3]); dots.setMatrixAt(k++, m);
      }
      dots.count = k; dots.instanceMatrix.needsUpdate = true;
      return;
    }
    const land = result.landing || result.rest;
    marker.position.set(land[0], heightAt(land[0], land[2]) + .08, land[2]);
    const size = Math.max(1, Math.hypot(land[0] - ball.x, land[2] - ball.z) / 60);
    marker.scale.setScalar(size); marker.visible = true;
    if (level.preview === 'full') {
      const air = result.path.filter(p => p[4] === 'air');
      const step = Math.max(1, Math.floor(air.length / DOTS));
      let k = 0;
      for (let i = 0; i < air.length && k < DOTS; i += step) { m.makeTranslation(air[i][1], air[i][2], air[i][3]); dots.setMatrixAt(k++, m); }
      dots.count = k; dots.instanceMatrix.needsUpdate = true;
    }
  }

  /* -- the swing and the ball ----------------------------------------------- */
  function strike(input) {
    if (state !== 'address') return;
    pending = input;
    state = 'swinging';
    pad.setEnabled(false); hud.power(''); marker.visible = false; dots.count = 0;
    const clip = swingClip();
    if (golfer.current === clip.name && golfer.paused) { golfer.impactFired = false; golfer.paused = false; }
    else golfer.play(clip.name, { fade: .1 });
  }
  function launch() {
    const c = club(), input = pending || { power: 1, face: 0, path: 0 };
    const L = launchFor({ club: c, power: input.power, face: input.face, path: input.path, lie, yaw, difficulty: settings.difficulty, puttRange });
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: L.yaw, spinRpm: L.spinRpm, axisDeg: L.axisDeg });
    const teed = lie === 'tee' && c.cat !== 'putter' ? .025 : 0;
    const start = [ball.x, ball.y + teed, ball.z];
    strokeFrom = [ball.x, ball.z];
    shot = simulateShot(world.forStroke(strokeFrom, cup), { start, velocity, spin, wind: wind(), roll: L.roll,
      seed: round.id + (holeCard(round, round.current).strokes + 1) * 7919 + round.current * 104729 });
    addStroke(round, { club: c.id, putt: c.cat === 'putter', from: strokeFrom, to: [shot.rest[0], shot.rest[2]], lie,
      result: shot.outcome, distance: Math.round(shot.total * 10) / 10 });
    const firstGround = shot.path.find(p => p[4] !== 'air');
    airTime = firstGround ? firstGround[0] : shot.time;
    flightT = 0; fast = 1; traced = 0; traceGeometry.setDrawRange(0, 0);
    cam.launch();
    state = 'flight';
    showHud();
  }
  function trace(p) {
    if (traced >= TRACE) return;
    const a = traceGeometry.attributes.position;
    a.setXYZ(traced++, p[1], p[2], p[3]); a.needsUpdate = true;
    traceGeometry.setDrawRange(0, traced);
  }

  /* -- where it came to rest ------------------------------------------------- */
  function settle() {
    const card = holeCard(round, round.current), par = hole().par;
    const restXZ = [shot.rest[0], shot.rest[2]];
    if (shot.outcome === 'holed') {
      ballMesh.visible = false;
      return finishHole(true);
    }
    if (shot.outcome === 'water') {
      addPenalty(round, 1);
      const entry = shot.entry || strokeFrom;
      const drop = dropPoint({ entry, cup, isDry: (x, z) => world.surfaceAt(x, z) !== 'water', isOut: world.forStroke(strokeFrom, cup).isOut });
      hud.banner('I vattnet', 'Pliktslag · droppa vid inträdet', 'bad');
      setBall(drop[0], drop[1]); ballMesh.visible = false;
      return pause(2.2, () => { ballMesh.visible = true; nextShot(); });
    }
    if (shot.outcome === 'out') {
      addPenalty(round, 1);
      hud.banner('Out of bounds', 'Pliktslag · slå om från samma plats', 'bad');
      return pause(2.2, () => { setBall(strokeFrom[0], strokeFrom[1]); nextShot(); });
    }
    setBall(restXZ[0], restXZ[1]);
    const surface = shot.surface || world.surfaceAt(ball.x, ball.z);
    const putt = club().cat === 'putter';
    const left = toCup();
    if (surface === 'green' && left < .45) {
      // A tap-in: it counts, and it goes in.
      addStroke(round, { club: bag.at(-1).id, putt: true, from: restXZ, to: [cup[0], cup[1]], lie: 'green', result: 'holed', distance: left });
      hud.banner('Inspel', `${left.toFixed(2)} m`, '', 1400);
      return pause(1.1, () => { ballMesh.visible = false; finishHole(true); });
    }
    if (card.strokes >= par + 5) {
      card.picked = true;
      hud.banner('Plockad', `${card.strokes} slag – nästa hål`, 'bad');
      return pause(2, () => finishHole(false));
    }
    const name = LIE_NAME[surface] || surface;
    hud.banner(name, putt ? `${left < 10 ? left.toFixed(1) : Math.round(left)} m kvar` : `${Math.round(shot.carry)} m i luften · ${Math.round(shot.total)} m totalt`,
      surface === 'fairway' || surface === 'green' ? 'good' : '');
    pause(1.9, nextShot);
  }
  function pause(seconds, then) { state = 'rest'; waitFor = seconds; after = then; cam.rest(ball, new THREE.Vector3(cup[0], cup[2], cup[1])); }
  function nextShot() {
    hud.fade(true);
    setTimeout(() => {
      traceGeometry.setDrawRange(0, 0);
      address(true);
      hud.fade(false);
    }, 340);
  }

  /* -- the end of a hole ------------------------------------------------------ */
  function finishHole(holed) {
    const card = holeCard(round, round.current), par = hole().par;
    if (holed) card.holed = true;
    savePlayedRound(localStorage, round);
    state = 'holed';
    if (holed) {
      const name = scoreName(card.strokes, par);
      hud.banner(name, `${card.strokes} slag på hål ${round.current}`, card.strokes <= par ? 'good' : '', 2600);
      if (card.strokes <= par) golfer.play('Celebrate', { fade: .25 });
    }
    setTimeout(() => holeSheet(), holed ? 2700 : 400);
  }
  function holeSheet() {
    const card = holeCard(round, round.current), par = hole().par, next = nextHole(round);
    const totals = roundTotals(round);
    const toPar = totals.toPar === 0 ? 'E' : totals.toPar > 0 ? `+${totals.toPar}` : String(totals.toPar);
    const box = hud.openSheet(`
      <h2>Hål ${round.current} · ${card.picked ? 'Plockad' : scoreName(card.strokes, par)}</h2>
      <p class="pl-sub">${card.picked ? 'Bollen togs upp' : `${card.strokes} slag, ${card.putts} puttar`}${card.penalties ? `, ${card.penalties} pliktslag` : ''} · Par ${par}</p>
      ${scorecardHtml(round, h.holes)}
      <p class="pl-sub">Totalt ${totals.strokes} slag på ${totals.played} hål · <b>${toPar}</b></p>
      <div class="pl-actions">${next ? `<button class="pl-btn pl-primary" data-next type="button">Nästa hål · ${next}</button>` : ''}
      <button class="pl-btn ${next ? 'pl-ghost' : 'pl-primary'}" data-end type="button">${next ? 'Avsluta rundan' : 'Klar · tillbaka'}</button></div>`);
    box.querySelector('[data-next]')?.addEventListener('click', () => { hud.closeSheet(); startHole(next); });
    box.querySelector('[data-end]').addEventListener('click', endRound);
    (box.querySelector('[data-next]') || box.querySelector('[data-end]')).focus();
  }
  function endRound() {
    round.endedAt = Date.now();
    savePlayedRound(localStorage, round);
    location.assign(`${import.meta.env.BASE_URL}#spela`);
  }
  function startHole(n) {
    round.current = n;
    holeCard(round, n);
    if (h.hole() !== n) h.goHole(n, false, true);
    h.releaseCamera(); h.quietCourse?.();
    const H = hole();
    const marks = H.tees.marks;
    const mark = marks[Math.min(round.tee, marks.length - 1)] || marks[0];
    cup = world.cupOf(n);
    setBall(mark.c[0], mark.c[1]);
    strokeFrom = mark.c.slice();
    hud.banner(`Hål ${n}`, `Par ${H.par}${H.name ? ` · ${H.name}` : ''}`, '', 2200);
    address(true);
  }

  /* -- the menu ------------------------------------------------------------- */
  function openMenu() {
    const seg = (key, options, current) => `<div class="pl-seg" role="group" data-seg="${key}">${Object.entries(options).map(([id, o]) =>
      `<button type="button" data-v="${id}" aria-pressed="${id === current}">${o.label || o}</button>`).join('')}</div>`;
    const box = hud.openSheet(`
      <h2>${h.courseName}</h2><p class="pl-sub">Spela · hål ${round.current}</p>
      <div class="pl-menu">
        <div class="pl-row"><span>Svårighet</span>${seg('difficulty', DIFFICULTY, settings.difficulty)}</div>
        <div class="pl-row"><span>Sving</span>${seg('method', SWING_METHODS, settings.method)}</div>
      </div>
      ${scorecardHtml(round, h.holes)}
      <div class="pl-actions"><button class="pl-btn pl-primary" data-resume type="button">Fortsätt</button>
      <button class="pl-btn pl-ghost" data-end type="button">Avsluta rundan</button></div>`);
    for (const group of box.querySelectorAll('[data-seg]')) {
      group.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        settings[group.dataset.seg] = b.dataset.v; saveSettings(settings);
        for (const x of group.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
        if (group.dataset.seg === 'method') pad.setMethod(b.dataset.v);
        round.difficulty = settings.difficulty;
        preview();
      });
    }
    box.querySelector('[data-resume]').addEventListener('click', () => hud.closeSheet());
    box.querySelector('[data-end]').addEventListener('click', endRound);
    box.querySelector('[data-resume]').focus();
  }

  /* -- input: keys first in line, and a drag on the course to aim ------------ */
  const abort = new AbortController();
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    // While a game is on the course's own shortcuts (holes, views, tools) stay out of it.
    e.stopImmediatePropagation();
    const key = e.key;
    if (hud.sheetOpen) { if (key === 'Escape' && state !== 'holed') { hud.closeSheet(); e.preventDefault(); } return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') { turn((key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? .2 : 1)); e.preventDefault(); }
    else if (key === 'ArrowUp' || key === 'ArrowDown') { changeClub(key === 'ArrowUp' ? -1 : 1); e.preventDefault(); }
    else if (key === ' ') {
      e.preventDefault();
      if (state === 'flight') fast = fast > 1 ? 1 : 4;
      else if (state === 'rest') { waitFor = 0; }
      else pad.key();
    } else if (key === 'o' || key === 'O') setOverview(!overview);
    else if (key === 'Escape') openMenu();
  }, { capture: true, signal: abort.signal });
  const canvas = h.renderer.domElement;
  let aiming = null;
  canvas.addEventListener('pointerdown', e => {
    if (state === 'flight') { fast = fast > 1 ? 1 : 4; return; }
    if (state === 'rest') { waitFor = 0; return; }
    if (state !== 'address') return;
    aiming = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId);
  }, { signal: abort.signal });
  canvas.addEventListener('pointermove', e => {
    if (!aiming || e.pointerId !== aiming.id) return;
    const dx = e.clientX - aiming.x; aiming.x = e.clientX;
    if (dx) turn(dx * (club().cat === 'putter' ? .05 : .12));
  }, { signal: abort.signal });
  const stopAim = e => { if (aiming && e.pointerId === aiming.id) aiming = null; };
  canvas.addEventListener('pointerup', stopAim, { signal: abort.signal });
  canvas.addEventListener('pointercancel', stopAim, { signal: abort.signal });

  startHole(round.current);

  const controller = {
    get ownsCamera() { return true; },
    /** For harnesses: the ground the map records in (to build a recorded round). */
    get ground() { return h.ground; },
    update(dt) {
      restoreLegs(golfer);
      golfer.update(dt);
      fitFeet(golfer.root, heightAt);
      pad.step(dt);
      if (state === 'flight' && shot) {
        flightT += dt * fast;
        const s = sample(shot.path, flightT);
        const p = s.p;
        ballMesh.position.set(p[1], p[2], p[3]);
        if (p[4] === 'air' || traced < 2) trace(p);
        const putt = club().cat === 'putter';
        const landing = shot.landing ? new THREE.Vector3(shot.landing[0], shot.landing[1], shot.landing[2]) : new THREE.Vector3(shot.rest[0], shot.rest[1], shot.rest[2]);
        cam.flight(ballMesh.position, new THREE.Vector3(...s.v), { landing, start: new THREE.Vector3(strokeFrom[0], ball.y, strokeFrom[1]), progress: flightT / Math.max(.1, airTime), putt });
        if (s.done) settle();
      } else if (state === 'rest') {
        waitFor -= dt;
        if (waitFor <= 0 && after) { const then = after; after = null; then(); }
      }
      // A ball is a few millimetres of white: grow it with distance so it stays a dot,
      // with a soft halo in flight so the eye can follow it against the sky.
      const d = h.camera.position.distanceTo(ballMesh.position);
      ballMesh.scale.setScalar(Math.max(1, d * .085));
      halo.visible = state === 'flight' && club().cat !== 'putter' && d > 6;
      if (halo.visible) { halo.position.copy(ballMesh.position); halo.scale.setScalar(d * .016); }
      cam.update(dt);
    },
    state: () => ({ state, hole: round.current, strokes: holeCard(round, round.current).strokes, ball: ball.toArray(), lie,
      club: club().id, yaw, toCup: toCup(), planned, shot: shot ? { outcome: shot.outcome, carry: shot.carry, total: shot.total } : null, round }),
    /** For a harness: swing without the pad. */
    swing(input = { power: 1, face: 0, path: 0 }) { strike(input); },
    aim(degrees) { turn(degrees); },
    /** For a harness: the surface the ball would find at a point. */
    probe: (x, z) => world.surfaceAt(x, z),
    /** For a harness or the card art: put the camera at eye looking at target ([x, y, z] each), at once. */
    look(eye, target) { cam.frame(new THREE.Vector3(...eye), new THREE.Vector3(...target)); cam.snap(); },
    club(id) { const i = bag.findIndex(c => c.id === id); if (i >= 0 && state === 'address') { clubIndex = i; changeClub(0); } },
    dispose() {
      abort.abort(); pad.dispose(); hud.dispose(); golfer.dispose();
      glow.dispose();
      for (const o of [ballMesh, marker, dots, tracer, halo]) { h.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
      document.body.classList.remove('pl-on'); h.controls.enabled = true;
    },
  };
  return controller;
}
