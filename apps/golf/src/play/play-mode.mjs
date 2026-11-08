/* Spela: the detailed course played as a game, one shot at a time.

   main.js hands over the world (the end of main.js); this module owns the
   golfer, the ball, the camera and the screen while a round is on. A shot is
   simulated whole the moment the club meets the ball (ball-physics.mjs) and
   then played back in real time, so the camera knows where it lands and the
   same swing always gives the same shot.

   Around the shot, as in the tour games: the hole is flown over before its
   first shot, the shot is set up (type, shape, height, spin) against a lie
   that is read (lie %, slope), the aim shows where it lands and how far it may
   stray, the green's slope is drawn for a putt, the swing's tempo counts, and
   after it come its numbers, its sound and an instant replay. A game
   controller plays it as well as the keys, the mouse or a finger. */
import * as THREE from 'three/webgpu';
import { loadGolfer, GOLF_SWINGS, GOLFER_CHARACTERS } from '../engine/golfer.mjs';
import { playsLike } from '../engine/rangefinder.js';
import { launchState, simulateShot, seeded, BALL } from './ball-physics.mjs';
import {
  playBag, launchFor, puttRangeFor, powerFor, flatShot, LIE_NAME, DIFFICULTY, SHOT_TYPES, SHAPES, HEIGHTS, SPINS, STOCK_SETUP,
  shotTypesFor, shapeable, swingFor, fitSetup, lieQuality, slopeLie, slopeWords, suggestShot, puttPlaysLike,
} from './shot-model.mjs';
import { createRound, addStroke, addPenalty, holeCard, roundTotals, nextHole, scoreName, savePlayedRound, dropPoint, PLAY_KEYS } from './play-rules.mjs';
import { createPlayWorld } from './play-world.mjs';
import { createPlayCamera } from './play-camera.mjs';
import { standAtBall, fitFeet, restoreLegs } from './golfer-rig.mjs';
import { createSwingPad, SWING_METHODS, tempoOf } from './swing-input.mjs';
import { createPlayHud, scorecardHtml } from './play-hud.mjs';
import { createGamepadInput } from './gamepad-input.mjs';
import { createPlayAudio } from './play-audio.mjs';
import { createRibbonTracer } from './ribbon-tracer.mjs';
import { createGreenRead } from './green-read.mjs';
import { flyoverPose, flyoverSeconds, lineLength } from './flyover.mjs';

export async function mountPlay(handle) {
  const query = new URLSearchParams(location.search);
  if (query.has('aterupplev')) {
    const { mountRelive } = await import('./relive.mjs');
    return mountRelive(handle, query.get('aterupplev'));
  }
  return startPlay(handle, query);
}

const ON_OFF = Object.freeze({ on: 'På', off: 'Av' });
function readSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(PLAY_KEYS.settings) || '{}');
    return { difficulty: DIFFICULTY[s.difficulty] ? s.difficulty : 'normal', method: SWING_METHODS[s.method] ? s.method : 'drag',
      sound: s.sound !== false, flyover: s.flyover !== false };
  } catch { return { difficulty: 'normal', method: 'drag', sound: true, flyover: true }; }
}
function saveSettings(settings) { try { localStorage.setItem(PLAY_KEYS.settings, JSON.stringify(settings)); } catch {} }

const KEY_HELP = 'Sikta ← → · Klubba ↑ ↓ · Slag T · Form Q E · Höjd W S · Spinn Z C · Repris R · Översikt O';
const PAD_HELP = 'Vänster spak siktar · höger spak svingar · LB RB klubba · X slag · ←→ form · ↑↓ höjd · LT RT spinn · Y översikt · Back repris';
const TYPE_LABELS = Object.freeze(Object.fromEntries(Object.entries(SHOT_TYPES).map(([k, v]) => [k, v.label])));
const SETUP_LABELS = Object.freeze({ type: TYPE_LABELS, shape: SHAPES, height: HEIGHTS, spin: SPINS });

/** Where a swing clip's backswing tops out: a third of a second before impact. */
const topOf = clip => Math.max(.35, clip.impact - .34);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const metres = d => (d < 10 ? d.toFixed(1).replace('.', ',') : String(Math.round(d)));
const signed = d => `${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))}`;
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
  const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const narrow = () => globalThis.matchMedia?.('(max-width: 640px)').matches ?? false;
  h.releaseCamera();
  h.quietCourse?.();
  h.controls.enabled = false;
  document.body.classList.add('pl-on');

  const hud = createPlayHud({
    onMenu: () => openMenu(),
    onClub: d => changeClub(d),
    onOverview: () => setOverview(!overview),
    onSetup: (key, value) => changeSetup(key, value),
    onReplay: () => startReplay(),
  });
  hud.banner('Laddar golfaren…', '', '', 0);
  const golfer = await loadGolfer(import.meta.env.BASE_URL, characterId);
  h.scene.add(golfer.root);
  hud.hideBanner();
  const audio = createPlayAudio({ enabled: settings.sound });
  const pads = createGamepadInput({
    onConnect: on => {
      hud.help(on ? PAD_HELP : KEY_HELP);
      if (on) hud.banner('Handkontroll ansluten', 'Höger spak svingar · vänster spak siktar', '', 2400);
    },
  });

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
  // Where the ball may land: an ellipse across the aim (the swing's likely spread).
  const spread = new THREE.Group();
  const spreadFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicNodeMaterial({ color: '#f0a23a', transparent: true, opacity: .14, depthTest: false, depthWrite: false }));
  const spreadEdge = new THREE.Mesh(new THREE.RingGeometry(.95, 1, 72), new THREE.MeshBasicNodeMaterial({ color: '#ffd28a', transparent: true, opacity: .75, depthTest: false, depthWrite: false }));
  for (const m of [spreadFill, spreadEdge]) { m.rotation.x = -Math.PI / 2; m.renderOrder = 3; spread.add(m); }
  spread.visible = false; h.scene.add(spread);
  const DOTS = 60;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(.022, 8, 6), new THREE.MeshBasicNodeMaterial({ color: '#ffffff', transparent: true, opacity: .85, depthWrite: false }), DOTS);
  dots.renderOrder = 3; dots.count = 0; dots.frustumCulled = false; h.scene.add(dots);
  const tracer = createRibbonTracer({ scene: h.scene, camera: h.camera });
  const greenRead = createGreenRead({ scene: h.scene, heightAt });

  const cam = createPlayCamera({ camera: h.camera, heightAt });
  const round = createRound({ slug: h.slug, courseName: h.courseName, holes: h.holes, startHole: h.hole(), tee: h.tee(),
    character: characterId, difficulty: settings.difficulty });
  const ball = new THREE.Vector3();
  let state = 'loading', lie = 'tee', yaw = 0, clubIndex = 0, cup = [0, 0, 0], puttRange = 10;
  let shot = null, flightT = 0, fast = 1, airTime = 1, waitFor = 0, after = null, overview = false;
  let strokeFrom = [0, 0], pending = null, planned = 1, eventIdx = 0, clock = 0;
  let setup = { ...STOCK_SETUP }, quality = null, slope = null, nextPlugged = false;
  let backTween = null, last = null, replay = null, fly = null;
  const club = () => bag[clubIndex];
  const hole = () => h.holes[round.current - 1];
  const toCup = () => Math.hypot(cup[0] - ball.x, cup[1] - ball.z);
  const putting = () => club().cat === 'putter';
  const swingName = () => swingFor(club(), setup.type);
  const swingClip = (name = swingName()) => golfer.clips.get(GOLF_SWINGS[name]);

  const pad = createSwingPad({
    parent: hud.root, method: settings.method,
    onBack: (power, source) => {
      if (state !== 'address') return;
      hud.toggleSetup(false);
      hud.power(putting() ? `≈ ${metres(Math.min(power, 1.1) * puttRange)} m` : `${Math.round(power * 100)} %`);
      if (source === 'drag' || source === 'stick') {
        // The golfer's backswing follows the finger (or the stick).
        const clip = swingClip();
        if (golfer.current !== clip.name) golfer.play(clip.name, { fade: .12 });
        golfer.paused = true; golfer.seek(topOf(clip) * Math.min(1, power));
      }
    },
    onStrike: input => strike(input),
    onCancel: () => { if (state === 'address') { golfer.paused = false; golfer.rate = 1; golfer.play(`Address${swingName()}`, { fade: .2 }); hud.power(''); } },
  });

  golfer.onImpact = () => {
    if (state === 'swinging') launch();
    else if (state === 'replay' && replay?.phase === 'swing') replayLaunch();
  };

  /* -- the hole and the lie ------------------------------------------------- */
  function aimYaw(distance) {
    const d = toCup();
    if (putting() || d <= distance * 1.12) return Math.atan2(cup[0] - ball.x, cup[1] - ball.z);
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
  /** The pin's distance as it plays: the rise, the wind along it (and for a putt, the rise on the green's pace). */
  function playsNow(putt = putting()) {
    const d = toCup(), dh = cup[2] - (ball.y - BALL.radius);
    if (putt) return { total: puttPlaysLike(d, dh), dh, wind: 0 };
    const [wx, wz] = wind(), bearing = Math.atan2(cup[0] - ball.x, cup[1] - ball.z);
    const head = -(wx * Math.sin(bearing) + wz * Math.cos(bearing));
    return { ...playsLike({ dist: d, dh, head }), dh };
  }
  /** How the ball lies here: its surface, how it sits (seeded per stroke) and a plugged ball in sand. */
  function readLie() {
    lie = world.surfaceAt(ball.x, ball.z);
    if (lie === 'water') lie = 'rough';
    const stroke = holeCard(round, round.current).strokes + 1;
    const rand = seeded(round.id % 1e9 + round.current * 977 + stroke * 7919);
    rand();                                     // a small seed's first draw is small too
    quality = lieQuality(lie, rand, { plugged: nextPlugged && lie === 'sand' });
    nextPlugged = false;
  }
  const readSlope = () => { slope = putting() ? null : slopeLie(heightAt, ball.x, ball.z, yaw); };
  /** How far this club and shot type go at full power: its carry for a full swing, its whole run otherwise. */
  const reachOf = () => (putting() ? toCup() : setup.type === 'full' ? club().carry : flatShot(club(), 1, 'fairway', { type: setup.type }).total);
  /** The share of a full swing that reaches the target (the pin, or the club's lay-up point). */
  function plan() {
    const c = club(), easy = settings.difficulty === 'latt';
    if (c.cat === 'putter') {
      // Lätt plans for the rise as well; otherwise the line is the flat distance and the chip says the rest.
      planned = Math.min(1.1, (easy ? playsNow().total : toCup()) / puttRange);
    } else {
      const target = easy ? playsNow().total : toCup();
      const reach = Math.min(target, c.carry * 1.3);
      const landOn = reach >= toCup() * .85 && world.surfaceAt(cup[0], cup[1]) === 'green' ? 'green' : 'fairway';
      planned = powerFor(c, reach, lie, setup, quality, landOn) ?? 1;
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
    const pl = playsNow(), putt = putting();
    let plays = '', playsTitle = '';
    if (putt) {
      const cm = Math.round(Math.abs(pl.dh) * 100);
      plays = cm >= 2 ? `${pl.dh > 0 ? 'Uppför' : 'Nedför'} <b>${cm} cm</b> · som <b>${metres(pl.total)} m</b>` : 'Plant';
      playsTitle = 'Höjdskillnaden till hålet, och puttens längd som den spelar på en plan green';
    } else if (toCup() > 15) {
      plays = `Spelas som <b>${Math.round(pl.total)} m</b>`;
      playsTitle = `Höjd ${signed(pl.slope)} m · vind ${signed(pl.wind)} m`;
    }
    const words = putt ? '' : slopeWords(slope || {});
    hud.shot({ toPin: toCup(), lie: LIE_NAME[lie] || lie, liePct: putt ? null : quality?.pct, slope: words,
      lieTitle: [quality?.label, words].filter(Boolean).join(' · '), plays, playsTitle,
      windMs: ms, windDeg: -rel, windLabel: `Vind ${ms.toFixed(1)} m/s, ${along}` });
    hud.club({ name: club().name, carry: reachOf(), putt, range: puttRange });
    hud.setup({ types: shotTypesFor(club()), labels: SETUP_LABELS, current: setup, shapeable: shapeable(setup.type), putt });
  }
  function showGreenRead() {
    if (state !== 'address' || toCup() > 30) { greenRead.hide(); return; }
    greenRead.show({ from: [ball.x, ball.z], to: [cup[0], cup[1]], isGreen: (x, z) => world.surfaceAt(x, z) === 'green' });
  }

  function address(snap = false) {
    readLie();
    // The caddie's choice: the club and shot for the distance as it plays, from this lie.
    const asPlays = lie === 'green' ? toCup() : playsNow(false).total;
    const pick = suggestShot(bag, asPlays / Math.max(.6, quality?.speed ?? 1), lie);
    clubIndex = Math.max(0, bag.indexOf(pick.club));
    setup = fitSetup(club(), { ...STOCK_SETUP, type: pick.type });
    puttRange = puttRangeFor(putting() ? Math.max(toCup(), playsNow().total) : toCup());
    yaw = aimYaw(reachOf());
    readSlope();
    stand(true);
    cam.address(ball, yaw, { putt: putting(), distance: Math.min(toCup(), club().carry || toCup()) });
    if (snap) cam.snap();
    overview = false; hud.overview(false);
    state = 'address';
    pad.setEnabled(true);
    plan(); showHud(); preview(); showGreenRead();
    hud.replay(Boolean(last));
  }
  /** Back at the ball after a flyover or a replay, the shot as it was set up. */
  function restoreAddress() {
    state = 'address';
    ballMesh.position.copy(ball); ballMesh.visible = true;
    stand(true);
    cam.address(ball, yaw, { putt: putting(), distance: Math.min(toCup(), club().carry || toCup()) });
    cam.snap();
    pad.setEnabled(true);
    plan(); showHud(); preview(); showGreenRead();
    hud.replay(Boolean(last));
  }
  function stand(replayClip = false) {
    golfer.paused = false; golfer.rate = 1;
    const swing = swingName();
    golfer.selectClub(swing, false);
    standAtBall(golfer, ball, yaw, swing, heightAt);
    if (replayClip || golfer.current !== `Address${swing}`) golfer.play(`Address${swing}`, { fade: .2 });
  }
  function reAddress() {
    puttRange = puttRangeFor(putting() ? Math.max(toCup(), playsNow().total) : toCup());
    readSlope();
    stand();
    cam.address(ball, yaw, { putt: putting(), distance: Math.min(toCup(), club().carry || toCup()) });
    plan(); showHud(); preview(); showGreenRead();
  }
  function changeClub(d) {
    if (state !== 'address') return;
    clubIndex = Math.max(0, Math.min(bag.length - 1, clubIndex + d));
    setup = fitSetup(club(), setup);
    reAddress();
  }
  function changeSetup(key, value) {
    if (state !== 'address' || putting()) return;
    if (key === 'type') setup = fitSetup(club(), { ...setup, type: value });
    else setup = fitSetup(club(), { ...setup, [key]: Number(value) });
    reAddress();
  }
  function stepSetup(key, d) {
    if (state !== 'address' || putting()) return;
    if (key === 'shape' && !shapeable(setup.type)) { hud.flash('Kortspel slås rakt', '', 1200); return; }
    changeSetup(key, (setup[key] || 0) + d);
  }
  function cycleType() {
    if (state !== 'address' || putting()) return;
    const types = shotTypesFor(club());
    changeSetup('type', types[(types.indexOf(setup.type) + 1) % types.length]);
    hud.flash(TYPE_LABELS[setup.type], '', 1000);
  }
  function turn(degrees) {
    if (state !== 'address') return;
    yaw -= degrees * Math.PI / 180;            // positive turns the aim to the right
    standAtBall(golfer, ball, yaw, swingName(), heightAt);
    readSlope();
    if (overview) cam.overview(ball, aimPoint(), yaw);
    else cam.address(ball, yaw, { putt: putting(), distance: Math.min(toCup(), club().carry || toCup()) });
    showHud(); preview();
  }
  function aimPoint() {
    const reach = putting() ? Math.min(toCup(), puttRange) : Math.min(toCup() + 5, reachOf());
    return new THREE.Vector3(ball.x + Math.sin(yaw) * reach, 0, ball.z + Math.cos(yaw) * reach).setY(heightAt(ball.x + Math.sin(yaw) * reach, ball.z + Math.cos(yaw) * reach));
  }
  function setOverview(on) {
    if (state !== 'address') return;
    overview = on; hud.overview(on);
    if (on) cam.overview(ball, aimPoint(), yaw);
    else cam.address(ball, yaw, { putt: putting(), distance: Math.min(toCup(), club().carry || toCup()) });
  }

  /* -- what the aid shows ahead (by difficulty) ------------------------------ */
  function simulateLaunch(L, windNow) {
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: L.yaw, spinRpm: L.spinRpm, axisDeg: L.axisDeg });
    return simulateShot(world.forStroke([ball.x, ball.z], cup), { start: [ball.x, ball.y, ball.z], velocity, spin, wind: windNow, roll: L.roll }, { every: 6 });
  }
  function preview() {
    const level = DIFFICULTY[settings.difficulty] || DIFFICULTY.normal;
    marker.visible = false; dots.count = 0; spread.visible = false;
    if (level.preview === 'none' || state !== 'address') return;
    const putt = putting();
    const base = { club: club(), power: planned, yaw, lie, difficulty: settings.difficulty, puttRange, setup, quality, slope };
    const windNow = level.preview === 'full' ? wind() : [0, 0];
    const result = simulateLaunch(launchFor(base), windNow);
    const m = new THREE.Matrix4();
    if (putt) {
      // The green's read: the whole roll on Lätt, the start line on Normal.
      const path = level.preview === 'full' ? result.path : result.path.slice(0, Math.ceil(result.path.length * .4));
      // A dot every 25 cm along the roll (a putt's read), never on top of each other.
      let k = 0, lastDot = null;
      for (const q of path) {
        if (k >= DOTS) break;
        if (lastDot && Math.hypot(q[1] - lastDot[1], q[3] - lastDot[3]) < .25) continue;
        lastDot = q; m.makeTranslation(q[1], heightAt(q[1], q[3]) + .02, q[3]); dots.setMatrixAt(k++, m);
      }
      dots.count = k; dots.instanceMatrix.needsUpdate = true;
      return;
    }
    const land = result.landing || result.rest;
    marker.position.set(land[0], heightAt(land[0], land[2]) + .08, land[2]);
    const carry = Math.hypot(land[0] - ball.x, land[2] - ball.z);
    marker.scale.setScalar(Math.max(1, carry / 60)); marker.visible = true;
    // The spread: a typical miss either way (a third of the pad's width), and the depth of a strike's pace.
    const sigma = .3;
    const a = simulateLaunch(launchFor({ ...base, face: sigma, path: sigma }), windNow);
    const b = simulateLaunch(launchFor({ ...base, face: -sigma, path: -sigma }), windNow);
    const la = a.landing || a.rest, lb = b.landing || b.rest;
    const half = Math.max(1.2, Math.hypot(la[0] - lb[0], la[2] - lb[2]) / 2 + .6);
    const depth = Math.max(1.5, carry * .03 * (1 + (launchFor(base).error ?? .75)));
    spread.position.set((la[0] + lb[0] + land[0]) / 3, heightAt(land[0], land[2]) + .06, (la[2] + lb[2] + land[2]) / 3);
    spread.rotation.y = Math.atan2(land[0] - ball.x, land[2] - ball.z);
    spread.scale.set(half, 1, depth); spread.visible = true;
    if (level.preview === 'full') {
      const air = result.path.filter(p => p[4] === 'air');
      const step = Math.max(1, Math.floor(air.length / DOTS));
      let k = 0;
      for (let i = 0; i < air.length && k < DOTS; i += step) { m.makeTranslation(air[i][1], air[i][2], air[i][3]); dots.setMatrixAt(k++, m); }
      dots.count = k; dots.instanceMatrix.needsUpdate = true;
    }
  }
  function hideAids() { marker.visible = false; dots.count = 0; spread.visible = false; greenRead.hide(); }

  /* -- the swing and the ball ----------------------------------------------- */
  /** From the backswing's top (or as far as it went) down through the ball. */
  function downswing(clip, f) {
    golfer.seek(clip.impact - (clip.impact - topOf(clip)) * f);
    golfer.impactFired = false; golfer.paused = false;
  }
  /** A backswing played to `f` of the top, then the downswing (the tap meter, a replay, a harness). */
  function swingFrom(clip, f, duration = .3 + .55 * f) {
    golfer.play(clip.name, { fade: .1 });
    golfer.paused = true; golfer.seek(0);
    backTween = { t: 0, dur: duration, f, clip };
    audio.whoosh(duration + (clip.impact - topOf(clip)) * f, f);
  }
  function strike(input) {
    if (state !== 'address') return;
    hud.toggleSetup(false);
    pending = input;
    state = 'swinging';
    pad.setEnabled(false); hud.power(''); hideAids(); hud.stats(null); hud.replay(false);
    const clip = swingClip(), f = clamp(input.power, .12, 1), tempo = input.tempo;
    if (tempo && tempo.grade !== 'none') {
      hud.flash(`${tempo.label} · ${tempo.ratio.toFixed(1).replace('.', ',')}:1`, tempo.grade === 'perfect' || tempo.grade === 'good' ? 'good' : 'bad');
      // The downswing on the screen keeps the player's own pace.
      golfer.rate = tempo.down ? clamp((clip.impact - topOf(clip)) * f / tempo.down, .6, 1.6) : 1;
    }
    if (golfer.current === clip.name && golfer.paused) {
      downswing(clip, f);
      audio.whoosh((clip.impact - topOf(clip)) * f / golfer.rate, f);
    } else swingFrom(clip, f);
  }
  const soundKind = c => (c.cat === 'putter' ? 'putter' : c.cat === 'driver' ? 'driver' : c.cat === 'wood' || c.cat === 'hybrid' ? 'wood'
    : SHOT_TYPES[setup.type].swing === 'Wedge' || /^(pw|gw|sw|lw)$/.test(c.cat) ? 'wedge' : 'iron');
  function launch() {
    golfer.rate = 1;
    const c = club(), input = pending || { power: 1, face: 0, path: 0 };
    const L = launchFor({ club: c, power: input.power, face: input.face, path: input.path, lie, yaw, difficulty: settings.difficulty, puttRange,
      setup, quality, slope, tempo: input.tempo });
    const { velocity, spin } = launchState({ speed: L.speed, launchDeg: L.launchDeg, yaw: L.yaw, spinRpm: L.spinRpm, axisDeg: L.axisDeg });
    const teed = lie === 'tee' && c.cat !== 'putter' ? .025 : 0;
    const start = [ball.x, ball.y + teed, ball.z];
    strokeFrom = [ball.x, ball.z];
    shot = simulateShot(world.forStroke(strokeFrom, cup), { start, velocity, spin, wind: wind(), roll: L.roll,
      seed: round.id + (holeCard(round, round.current).strokes + 1) * 7919 + round.current * 104729 });
    addStroke(round, { club: c.id, putt: c.cat === 'putter', from: strokeFrom, to: [shot.rest[0], shot.rest[2]], lie,
      result: shot.outcome, distance: Math.round(shot.total * 10) / 10 });
    const tempo = input.tempo;
    const pure = (tempo?.grade === 'perfect' ? 1 : tempo?.grade === 'good' ? .8 : tempo && tempo.grade !== 'none' ? .45 : .7) * (1 - Math.min(.6, Math.abs(input.face) + Math.abs(input.path) * .5));
    audio.strike(soundKind(c), { pure, power: input.power, lie });
    if (pure > .85 && c.cat !== 'putter') pads.rumble(.55, 110); else pads.rumble(.3, 80);
    last = { shot, from: strokeFrom.slice(), fromY: start[1], yaw, swing: swingName(), power: input.power, putt: c.cat === 'putter',
      club: c, setup: { ...setup }, L, input, plays: playsNow(), cup: cup.slice() };
    const firstGround = shot.path.find(p => p[4] !== 'air');
    airTime = firstGround ? firstGround[0] : shot.time;
    flightT = 0; fast = 1; eventIdx = 0;
    tracer.reset();
    cam.launch();
    state = 'flight';
    showHud();
  }
  function playEvent(e) {
    if (e.type === 'bounce') audio.bounce(e.surface, e.speed);
    else if (e.type === 'trunk') audio.trunk();
    else if (e.type === 'leaves') audio.leaves();
    else if (e.type === 'cup') audio.cup();
    else if (e.type === 'water') audio.splash();
  }
  /** One frame of a shot's playback: the ball, its trace and its sounds. Returns the sample. */
  function playback(dt, played) {
    flightT += dt * fast;
    const s = sample(played.path, flightT), p = s.p;
    ballMesh.position.set(p[1], p[2], p[3]);
    if (p[4] === 'air' || tracer.count < 2) tracer.push(p[1], p[2], p[3]);
    while (eventIdx < played.events.length && played.events[eventIdx].t <= flightT) playEvent(played.events[eventIdx++]);
    audio.roll(p[4] === 'roll' && !s.done ? Math.hypot(s.v[0], s.v[2]) : 0);
    return s;
  }

  /* -- where it came to rest ------------------------------------------------- */
  function settle() {
    audio.roll(0);
    const card = holeCard(round, round.current), par = hole().par;
    const restXZ = [shot.rest[0], shot.rest[2]];
    nextPlugged = Boolean(shot.plugged);
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
    showStats();
    const surface = shot.surface || world.surfaceAt(ball.x, ball.z);
    const putt = putting();
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
    const name = shot.plugged ? 'Pluggad i bunkern' : LIE_NAME[surface] || surface;
    hud.banner(name, putt ? `${metres(left)} m kvar` : `${Math.round(shot.carry)} m i luften · ${Math.round(shot.total)} m totalt`,
      surface === 'fairway' || surface === 'green' ? 'good' : shot.plugged ? 'bad' : '');
    pause(1.9, nextShot);
  }
  /** The last shot's numbers and the swing's verdict. */
  function showStats() {
    if (!last) return;
    const { L, input, shot: s } = last;
    const tempo = input.tempo;
    const dx = s.rest[0] - last.from[0], dz = s.rest[2] - last.from[1];
    const right = dx * -Math.cos(last.yaw) + dz * Math.sin(last.yaw);
    const side = Math.abs(right) < .5 ? 'rakt' : `${metres(Math.abs(right))} m ${right > 0 ? 'höger' : 'vänster'}`;
    const faceTotal = input.face * (tempo?.errorMul ?? 1) + (tempo?.faceAdd ?? 0), pathTotal = input.path * (tempo?.errorMul ?? 1) + (tempo?.pathAdd ?? 0);
    const faceWord = Math.abs(faceTotal) < .12 ? 'rak' : faceTotal > 0 ? 'öppen' : 'stängd';
    const pathWord = Math.abs(pathTotal) < .12 ? 'neutral' : pathTotal > 0 ? 'utifrån-in' : 'inifrån-ut';
    const graded = tempo && tempo.grade !== 'none';
    const title = graded ? `${tempo.label} · ${tempo.ratio.toFixed(1).replace('.', ',')}:1` : 'Slagdata';
    const tone = !graded ? '' : tempo.grade === 'perfect' || tempo.grade === 'good' ? 'good' : 'bad';
    const rows = last.putt
      ? [['Längd', `${metres(s.total)} m`], ['Bollfart', `${(L.speed * 3.6).toFixed(1).replace('.', ',')} km/h`], ['Spelades som', `${metres(last.plays.total)} m`], ['Sida', side]]
      : [['Carry', `${Math.round(s.carry)} m`], ['Totalt', `${Math.round(s.total)} m`], ['Bollfart', `${Math.round(L.speed * 3.6)} km/h`],
        ['Utgångsvinkel', `${L.launchDeg.toFixed(1).replace('.', ',')}°`], ['Spinn', `${Math.round(L.spinRpm / 50) * 50} rpm`],
        ['Höjd', `${Math.round(s.apex)} m`], ['Sida', side]];
    hud.stats({ title, tone, note: `${last.club.name}${last.putt ? '' : ` · ${TYPE_LABELS[last.setup.type]}`} · kraft ${Math.round(input.power * 100)} % · träff ${faceWord} · bana ${pathWord}`, rows },
      narrow() ? 4500 : 0);
  }
  function pause(seconds, then) { state = 'rest'; waitFor = seconds; after = then; cam.rest(ball, new THREE.Vector3(cup[0], cup[2], cup[1])); }
  function nextShot() {
    hud.fade(true);
    setTimeout(() => {
      tracer.reset();
      address(true);
      hud.fade(false);
    }, 340);
  }

  /* -- the instant replay ----------------------------------------------------- */
  function startReplay(then = null) {
    if (!last || (state !== 'address' && state !== 'holed')) return;
    hud.toggleSetup(false); hud.stats(null); hud.replay(false); hud.power('');
    hideAids(); pad.setEnabled(false);
    replay = { then, phase: 'address', wait: .7 };
    state = 'replay';
    document.body.classList.add('pl-cinema');
    hud.banner('Repris', 'Tryck för att hoppa över', '', 1600);
    const from = new THREE.Vector3(last.from[0], last.fromY, last.from[1]);
    ballMesh.position.copy(from); ballMesh.visible = true;
    tracer.reset();
    golfer.paused = false; golfer.rate = 1;
    golfer.selectClub(last.swing, false);
    standAtBall(golfer, from, last.yaw, last.swing, heightAt);
    golfer.play(`Address${last.swing}`, { fade: 0 });
    cam.replaySwing(from, last.yaw, { putt: last.putt }); cam.snap();
  }
  function replayLaunch() {
    replay.phase = 'flight';
    flightT = 0; fast = 1; eventIdx = 0;
    const tempo = last.input.tempo;
    audio.strike(soundKind(last.club), { pure: tempo?.grade === 'perfect' ? 1 : .7, power: last.power, lie: last.shot.path.length ? lie : 'fairway' });
  }
  function endReplay() {
    if (state !== 'replay') return;
    const then = replay.then;
    replay = null; backTween = null; state = 'loading';
    audio.roll(0);
    document.body.classList.remove('pl-cinema');
    hud.fade(true);
    setTimeout(() => {
      tracer.reset(); golfer.rate = 1;
      if (then) then(); else restoreAddress();
      hud.fade(false);
    }, 340);
  }

  /* -- the flyover ------------------------------------------------------------ */
  function startFlyover(n) {
    const H = hole(), line = H.line || [[ball.x, ball.z], [cup[0], cup[1]]];
    fly = { t: 0, dur: flyoverSeconds(lineLength(line)), line, pin: cup.slice() };
    state = 'flyover';
    document.body.classList.add('pl-cinema');
    pad.setEnabled(false); hideAids();
    const length = H.t?.[Math.min(round.tee, (H.t?.length || 1) - 1)] ?? Math.round(H.lineLen || lineLength(line));
    hud.banner(`Hål ${n} · par ${H.par}`, `${length} m · tryck för att hoppa över`, '', 0);
    const pose = flyoverPose(fly.line, fly.pin, 0, heightAt);
    cam.frame(new THREE.Vector3(...pose.eye), new THREE.Vector3(...pose.look), 10); cam.snap();
  }
  function endFlyover() {
    if (state !== 'flyover') return;
    fly = null; state = 'loading';
    document.body.classList.remove('pl-cinema');
    hud.hideBanner(); hud.fade(true);
    setTimeout(() => { restoreAddress(); hud.fade(false); }, 340);
  }

  /* -- the end of a hole ------------------------------------------------------ */
  function finishHole(holed) {
    const card = holeCard(round, round.current), par = hole().par;
    if (holed) card.holed = true;
    savePlayedRound(localStorage, round);
    state = 'holed';
    hud.replay(false); hideAids();
    if (holed) {
      const name = scoreName(card.strokes, par);
      hud.banner(name, `${card.strokes} slag på hål ${round.current}`, card.strokes <= par ? 'good' : '', 2600);
      if (card.strokes <= par) { golfer.play('Celebrate', { fade: .25 }); audio.chime(card.strokes < par); }
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
      ${last && card.holed ? '<button class="pl-btn pl-ghost" data-replay-last type="button">Se sista slaget igen</button>' : ''}
      <button class="pl-btn ${next ? 'pl-ghost' : 'pl-primary'}" data-end type="button">${next ? 'Avsluta rundan' : 'Klar · tillbaka'}</button></div>`);
    box.querySelector('[data-next]')?.addEventListener('click', () => { hud.closeSheet(); startHole(next); });
    box.querySelector('[data-replay-last]')?.addEventListener('click', () => {
      hud.closeSheet();
      startReplay(() => { ballMesh.visible = false; state = 'holed'; holeSheet(); });
    });
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
    last = null; nextPlugged = false; hud.stats(null);
    tracer.reset();
    audio.wind(Math.hypot(...wind()));
    address(true);
    if (settings.flyover && !still) startFlyover(n);
    else hud.banner(`Hål ${n}`, `Par ${H.par}${H.name ? ` · ${H.name}` : ''}`, '', 2200);
  }

  /* -- the menu ------------------------------------------------------------- */
  function openMenu() {
    hud.toggleSetup(false);
    const seg = (key, options, current) => `<div class="pl-seg" role="group" data-seg="${key}">${Object.entries(options).map(([id, o]) =>
      `<button type="button" data-v="${id}" aria-pressed="${id === current}">${o.label || o}</button>`).join('')}</div>`;
    const box = hud.openSheet(`
      <h2>${h.courseName}</h2><p class="pl-sub">Spela · hål ${round.current}</p>
      <div class="pl-menu">
        <div class="pl-row"><span>Svårighet</span>${seg('difficulty', DIFFICULTY, settings.difficulty)}</div>
        <div class="pl-row"><span>Sving</span>${seg('method', SWING_METHODS, settings.method)}</div>
        <div class="pl-row"><span>Ljud</span>${seg('sound', ON_OFF, settings.sound ? 'on' : 'off')}</div>
        <div class="pl-row"><span>Hålöverflygning</span>${seg('flyover', ON_OFF, settings.flyover ? 'on' : 'off')}</div>
      </div>
      ${scorecardHtml(round, h.holes)}
      <div class="pl-actions"><button class="pl-btn pl-primary" data-resume type="button">Fortsätt</button>
      <button class="pl-btn pl-ghost" data-end type="button">Avsluta rundan</button></div>`);
    for (const group of box.querySelectorAll('[data-seg]')) {
      group.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        const key = group.dataset.seg, value = b.dataset.v;
        if (key === 'sound' || key === 'flyover') settings[key] = value === 'on'; else settings[key] = value;
        saveSettings(settings);
        for (const x of group.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
        if (key === 'method') pad.setMethod(value);
        if (key === 'sound') { audio.setEnabled(settings.sound); audio.wind(Math.hypot(...wind())); }
        round.difficulty = settings.difficulty;
        if (state === 'address') { plan(); preview(); }
      });
    }
    box.querySelector('[data-resume]').addEventListener('click', () => hud.closeSheet());
    box.querySelector('[data-end]').addEventListener('click', endRound);
    box.querySelector('[data-resume]').focus();
  }

  /* -- input: keys first in line, a drag on the course to aim, a controller -- */
  const abort = new AbortController();
  const wake = () => audio.unlock();
  addEventListener('pointerdown', wake, { capture: true, signal: abort.signal });
  addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    // While a game is on the course's own shortcuts (holes, views, tools) stay out of it.
    e.stopImmediatePropagation();
    wake();
    const key = e.key, lower = key.length === 1 ? key.toLowerCase() : key;
    if (hud.sheetOpen) { if (key === 'Escape' && state !== 'holed') { hud.closeSheet(); e.preventDefault(); } return; }
    if (state === 'flyover') { if (key === ' ' || key === 'Enter' || key === 'Escape') { e.preventDefault(); endFlyover(); } return; }
    if (state === 'replay') { if (key === ' ' || key === 'Enter' || key === 'Escape' || lower === 'r') { e.preventDefault(); endReplay(); } return; }
    if (key === 'Escape' && hud.setupOpen) { hud.toggleSetup(false); e.preventDefault(); return; }
    if (key === 'ArrowLeft' || key === 'ArrowRight') { turn((key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? .2 : 1)); e.preventDefault(); }
    else if (key === 'ArrowUp' || key === 'ArrowDown') { changeClub(key === 'ArrowUp' ? -1 : 1); e.preventDefault(); }
    else if (key === ' ') {
      e.preventDefault();
      if (state === 'flight') fast = fast > 1 ? 1 : 4;
      else if (state === 'rest') { waitFor = 0; }
      else pad.key();
    } else if (lower === 'o') setOverview(!overview);
    else if (lower === 't') cycleType();
    else if (lower === 'q') stepSetup('shape', -1);
    else if (lower === 'e') stepSetup('shape', 1);
    else if (lower === 'w') stepSetup('height', 1);
    else if (lower === 's') stepSetup('height', -1);
    else if (lower === 'z') stepSetup('spin', -1);
    else if (lower === 'c') stepSetup('spin', 1);
    else if (lower === 'r') startReplay();
    else if (key === 'Escape') openMenu();
  }, { capture: true, signal: abort.signal });
  const canvas = h.renderer.domElement;
  let aiming = null;
  canvas.addEventListener('pointerdown', e => {
    if (state === 'flyover') { endFlyover(); return; }
    if (state === 'replay') { endReplay(); return; }
    if (state === 'flight') { fast = fast > 1 ? 1 : 4; return; }
    if (state === 'rest') { waitFor = 0; return; }
    if (state !== 'address') return;
    hud.toggleSetup(false);
    aiming = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId);
  }, { signal: abort.signal });
  canvas.addEventListener('pointermove', e => {
    if (!aiming || e.pointerId !== aiming.id) return;
    const dx = e.clientX - aiming.x; aiming.x = e.clientX;
    if (dx) turn(dx * (putting() ? .05 : .12));
  }, { signal: abort.signal });
  const stopAim = e => { if (aiming && e.pointerId === aiming.id) aiming = null; };
  canvas.addEventListener('pointerup', stopAim, { signal: abort.signal });
  canvas.addEventListener('pointercancel', stopAim, { signal: abort.signal });

  function moveFocus(d) {
    const buttons = [...hud.sheet.querySelectorAll('button')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + d + buttons.length) % buttons.length].focus();
  }
  function controllerInput(g, dt) {
    const p = g.pressed;
    if (p.size) wake();
    if (hud.sheetOpen) {
      if (p.has('a')) document.activeElement?.click?.();
      if (p.has('b') && state !== 'holed') hud.closeSheet();
      if (p.has('left') || p.has('up')) moveFocus(-1);
      if (p.has('right') || p.has('down')) moveFocus(1);
      return;
    }
    if (state === 'flyover') { if (p.has('a') || p.has('b')) endFlyover(); return; }
    if (state === 'replay') { if (p.has('a') || p.has('b') || p.has('back')) endReplay(); return; }
    if (state === 'flight') { if (p.has('a')) fast = fast > 1 ? 1 : 4; return; }
    if (state === 'rest') { if (p.has('a')) waitFor = 0; return; }
    if (state !== 'address') return;
    if (p.has('start')) { openMenu(); return; }
    if (p.has('b') && hud.setupOpen) hud.toggleSetup(false);
    if (g.lx) turn(g.lx * Math.abs(g.lx) * dt * (putting() ? 9 : 35));
    pad.stick(g.rx, g.ry);
    if (state !== 'address') return;            // the stick may have struck
    if (p.has('lb')) changeClub(-1);
    if (p.has('rb')) changeClub(1);
    if (p.has('x')) cycleType();
    if (p.has('y')) setOverview(!overview);
    if (p.has('left')) stepSetup('shape', -1);
    if (p.has('right')) stepSetup('shape', 1);
    if (p.has('up')) stepSetup('height', 1);
    if (p.has('down')) stepSetup('height', -1);
    if (p.has('lt')) stepSetup('spin', -1);
    if (p.has('rt')) stepSetup('spin', 1);
    if (p.has('a')) pad.key();
    if (p.has('back')) startReplay();
  }

  startHole(round.current);

  const controller = {
    get ownsCamera() { return true; },
    /** For harnesses: the ground the map records in (to build a recorded round). */
    get ground() { return h.ground; },
    update(dt) {
      clock += dt;
      const g = pads.poll();
      if (g.connected) controllerInput(g, dt);
      restoreLegs(golfer);
      if (backTween) {
        backTween.t += dt;
        const u = Math.min(1, backTween.t / backTween.dur);
        golfer.seek(topOf(backTween.clip) * backTween.f * (1 - (1 - u) * (1 - u)));
        if (u >= 1) { const { clip, f } = backTween; backTween = null; downswing(clip, f); }
      }
      golfer.update(dt);
      fitFeet(golfer.root, heightAt);
      pad.step(dt);
      greenRead.update(clock, still);
      if (state === 'flight' && shot) {
        const s = playback(dt, shot);
        const landing = shot.landing ? new THREE.Vector3(shot.landing[0], shot.landing[1], shot.landing[2]) : new THREE.Vector3(shot.rest[0], shot.rest[1], shot.rest[2]);
        cam.flight(ballMesh.position, new THREE.Vector3(...s.v), { landing, start: new THREE.Vector3(strokeFrom[0], ball.y, strokeFrom[1]), progress: flightT / Math.max(.1, airTime), putt: putting() });
        if (s.done) settle();
      } else if (state === 'rest') {
        waitFor -= dt;
        if (waitFor <= 0 && after) { const then = after; after = null; then(); }
      } else if (state === 'replay' && replay) {
        if (replay.phase === 'address') {
          replay.wait -= dt;
          if (replay.wait <= 0) { replay.phase = 'swing'; swingFrom(swingClip(last.swing), clamp(last.power, .12, 1)); }
        } else if (replay.phase === 'flight') {
          const played = last.shot;
          const s = playback(dt, played);
          const first = played.path.find(p => p[4] !== 'air');
          const landing = played.landing ? new THREE.Vector3(played.landing[0], played.landing[1], played.landing[2]) : new THREE.Vector3(played.rest[0], played.rest[1], played.rest[2]);
          cam.replay(ballMesh.position, { start: new THREE.Vector3(last.from[0], last.fromY, last.from[1]), landing,
            progress: flightT / Math.max(.1, first ? first[0] : played.time), putt: last.putt, cup: new THREE.Vector3(last.cup[0], last.cup[2], last.cup[1]) });
          if (s.done) { replay.phase = 'hold'; replay.wait = 1.4; audio.roll(0); }
        } else if (replay.phase === 'hold') {
          replay.wait -= dt;
          if (replay.wait <= 0) endReplay();
        }
      } else if (state === 'flyover' && fly) {
        fly.t += dt;
        const pose = flyoverPose(fly.line, fly.pin, fly.t / fly.dur, heightAt);
        cam.frame(new THREE.Vector3(...pose.eye), new THREE.Vector3(...pose.look), 10);
        if (fly.t >= fly.dur + .5) endFlyover();
      }
      // A ball is a few millimetres of white: grow it with distance so it stays a dot,
      // with a soft halo in flight so the eye can follow it against the sky.
      const d = h.camera.position.distanceTo(ballMesh.position);
      ballMesh.scale.setScalar(Math.max(1, d * .085));
      const flying = state === 'flight' || (state === 'replay' && replay?.phase === 'flight');
      halo.visible = flying && !(state === 'flight' ? putting() : last?.putt) && d > 6;
      if (halo.visible) { halo.position.copy(ballMesh.position); halo.scale.setScalar(d * .016); }
      cam.update(dt);
      tracer.update(h.renderer.domElement.clientHeight || innerHeight);
    },
    state: () => ({ state, hole: round.current, strokes: holeCard(round, round.current).strokes, ball: ball.toArray(), lie,
      club: club().id, yaw, toCup: toCup(), planned, setup: { ...setup }, quality, slope, plays: state === 'address' ? playsNow() : null,
      shot: shot ? { outcome: shot.outcome, carry: shot.carry, total: shot.total, plugged: shot.plugged, events: shot.events.map(e => e.surface || e.type) } : null,
      greenArrows: greenRead.visible, round }),
    /** For a harness: swing without the pad. back/down (seconds) time the tempo. */
    swing(input = { power: 1, face: 0, path: 0 }) {
      const tempo = input.back && input.down ? tempoOf({ back: input.back, down: input.down, power: input.power }) : input.tempo;
      strike({ face: 0, path: 0, ...input, tempo });
    },
    aim(degrees) { turn(degrees); },
    /** For a harness: the shot's setup (type, shape, height, spin). */
    setup(key, value) { changeSetup(key, value); },
    replay() { startReplay(); },
    /** For a harness: skip a flyover or a replay. */
    skip() { if (state === 'flyover') endFlyover(); else if (state === 'replay') endReplay(); },
    /** For a harness: the surface the ball would find at a point. */
    probe: (x, z) => world.surfaceAt(x, z),
    /** For a harness or the card art: put the camera at eye looking at target ([x, y, z] each), at once. */
    look(eye, target) { cam.frame(new THREE.Vector3(...eye), new THREE.Vector3(...target)); cam.snap(); },
    club(id) { const i = bag.findIndex(c => c.id === id); if (i >= 0 && state === 'address') { clubIndex = i; changeClub(0); } },
    dispose() {
      abort.abort(); pad.dispose(); hud.dispose(); golfer.dispose(); audio.dispose(); tracer.dispose(); greenRead.dispose();
      glow.dispose();
      for (const o of [ballMesh, marker, dots, halo, spreadFill, spreadEdge]) { o.parent?.remove(o); o.geometry.dispose(); o.material.dispose(); }
      h.scene.remove(spread);
      document.body.classList.remove('pl-on', 'pl-cinema'); h.controls.enabled = true;
    },
  };
  return controller;
}
