/* The map session: every course as a light 3D map for a real round on the phone.
   ?bana=<slug>&karta=1, optionally &hal=<n>. Nothing here imports three.js or
   the player: it is a separate, far smaller program over the same course data.

   The frame only ever draws because something changed. There is no loop: a phone
   in a pocket between shots spends nothing on the map. */
import '../styles/course-map.css';
import { DEFAULT_BAG, gpsToLocal, nearestHole, parseBag, recommendClub } from '../engine/caddie.js';
import { frustumPlanes, selectPatches } from './map-lod.mjs';
import { createCamera, createFlight, MAX_DISTANCE, MAX_TILT, MIN_DISTANCE, MIN_TILT } from './map-camera.mjs';
import { loadMapCourse } from './map-course.mjs';
import { createGps, createScreenLock, downloadCourse, isDownloaded, offlineBytes, offlineTiles } from './map-field.mjs';
import { createMapRenderer } from './map-gl.mjs';
import { attachGestures } from './map-gestures.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, principalBearing, shotReading } from './map-measure.mjs';
import { createOverlay } from './map-overlay.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { createMapPainter } from './map-paint.mjs';
import { createTileStore, fetchKeptFile } from './map-tiles.mjs';
import { catalogueFor, createTreeRules, loadTreeAtlases, speciesCount } from './map-trees.mjs';

const params = new URLSearchParams(location.search);
const slug = params.get('bana');
const BASE = import.meta.env.BASE_URL;
const HOLE_TILT = 0.9, COURSE_TILT = 0.72;
const RELIEF_STEPS = [1, 1.5, 2, 3];
/* The afternoon sun: south-west, about 40 degrees up. High enough to light the
   whole course, low enough that a tree's shadow shows its height. */
const SUN = (() => {
  const v = [-0.5, 0.64, 0.58], l = Math.hypot(...v);
  return v.map(n => n / l);
})();
/* What a device that cannot hold the pace gives up, in order: distant trees first,
   then sharpness. A map that moves smoothly is worth more than one that is sharp
   and stutters. A step down is remembered, so the next round starts there. */
const QUALITY_STEPS = Object.freeze([
  { trees: 14000, pixelRatio: 2 },
  { trees: 9000, pixelRatio: 2 },
  { trees: 5000, pixelRatio: 1.6 },
  { trees: 2500, pixelRatio: 1.3 },
]);
const QUALITY_KEY = 'banvy-map-quality-v1';
const SLOW_FRAME_MS = 36, PACE_SAMPLES = 24;
const BAG_KEY = 'banvy-caddie-bag-v1';
const TEE_KEY = 'banvy-map-tee-v1';
const OFF_COURSE_METRES = 450, FOLLOW_HOLE_METRES = 120;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const metres = value => (Number.isFinite(value) ? `${Math.round(value)}` : '–');
const signed = value => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1).replace('.', ',')} m`;

document.body.classList.add('course-map');
const boot = document.getElementById('boot');
const bootMessage = document.getElementById('bmsg');
const say = text => { if (bootMessage) bootMessage.textContent = text; };

const root = document.createElement('main');
root.id = 'courseMap';
root.innerHTML = `
  <canvas class="map-ground" aria-label="3D-karta över banan"></canvas>
  <canvas class="map-marks" aria-hidden="true"></canvas>
  <header class="map-top">
    <a class="map-key" data-back href="${BASE}" aria-label="Alla banor">‹</a>
    <div class="map-hole">
      <button data-prev aria-label="Föregående hål">‹</button>
      <div class="map-hole-text"><b data-hole-title></b><span data-hole-facts></span></div>
      <button data-next aria-label="Nästa hål">›</button>
    </div>
    <button class="map-key" data-overview aria-label="Hela banan" aria-pressed="false">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M3 18l6-13 5 8 3-4 4 9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
    </button>
  </header>
  <aside class="map-green" data-green aria-label="Avstånd till greenen">
    <div><span>Bak</span><b data-back-number>–</b></div>
    <div class="map-green-mid"><span>Mitt</span><b data-mid-number>–</b></div>
    <div><span>Fram</span><b data-front-number>–</b></div>
    <small data-from></small>
  </aside>
  <section class="map-bottom">
    <div class="map-reading" data-reading hidden></div>
    <div class="map-profile" data-profile>
      <svg viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path data-profile-fill fill="rgba(120,205,120,.32)"/><path data-profile-line fill="none" stroke="#a6efa0" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
      <span data-profile-text></span><span class="map-plays" data-profile-plays></span>
    </div>
    <div class="map-tools">
      <button class="map-tool" data-gps aria-pressed="false">GPS</button>
      <button class="map-tool" data-tee aria-label="Byt tee"></button>
      <button class="map-tool" data-relief aria-label="Höjdförstärkning">Höjd 2×</button>
      <button class="map-tool" data-download>Spara</button>
      <a class="map-tool" data-full aria-label="Öppna den detaljerade 3D-banan">3D</a>
    </div>
  </section>
  <div class="map-status" data-status hidden role="status"></div>`;
document.body.append(root);

const $ = selector => root.querySelector(selector);
const ui = {
  hole: $('[data-hole-title]'), facts: $('[data-hole-facts]'),
  back: $('[data-back-number]'), mid: $('[data-mid-number]'), front: $('[data-front-number]'), from: $('[data-from]'),
  reading: $('[data-reading]'), status: $('[data-status]'),
  gps: $('[data-gps]'), tee: $('[data-tee]'), relief: $('[data-relief]'), download: $('[data-download]'), full: $('[data-full]'),
  overview: $('[data-overview]'), green: $('[data-green]'),
  profile: $('[data-profile]'), profileLine: $('[data-profile-line]'), profileFill: $('[data-profile-fill]'), profileText: $('[data-profile-text]'), profilePlays: $('[data-profile-plays]'),
};

let statusTimer = 0;
function status(text, hold = 3200) {
  ui.status.textContent = text;
  ui.status.hidden = false;
  clearTimeout(statusTimer);
  if (hold) statusTimer = setTimeout(() => { ui.status.hidden = true; }, hold);
}

function savedQuality() {
  const asked = Number(params.get('mapquality'));
  if (params.has('mapquality') && QUALITY_STEPS[asked]) return asked;
  try { return Math.min(QUALITY_STEPS.length - 1, Number(localStorage.getItem(QUALITY_KEY)) || 0); } catch { return 0; }
}

function savedTee(course) {
  const fallback = course.tees?.def ?? 0;
  try {
    const saved = Number(localStorage.getItem(`${TEE_KEY}:${course.slug}`));
    return Number.isInteger(saved) && localStorage.getItem(`${TEE_KEY}:${course.slug}`) !== null && saved < (course.tees?.names?.length ?? 0) ? saved : fallback;
  } catch { return fallback; }
}

function fail(error) {
  console.error(error);
  say(`kartan kunde inte öppnas: ${error.message}`);
  status(`Kartan kunde inte öppnas: ${error.message}`, 0);
}

async function start() {
  say('hämtar banan');
  /* The real trees, alongside the course rather than after it: the painted forest
     is stamped from them. If they cannot be had the map still opens, on its plainer
     canopy. A slug's ground decides its catalogue, so this need not wait. */
  const assetUrl = file => new URL(`${BASE}${file}`, location.href).href;
  const catalogue = catalogueFor(slug === 'visby' ? 'visby' : slug);
  const treesLoaded = loadTreeAtlases(catalogue, speciesCount(slug), entry => fetchKeptFile(assetUrl(entry.file))).catch(error => {
    console.warn('map trees:', error.message);
    return null;
  });
  const course = await loadMapCourse(slug);
  document.title = `${course.name} — Karta | Banvy`;
  ui.full.href = `${BASE}?bana=${encodeURIComponent(slug)}`;

  const rules = createTreeRules(course);
  const treeFiles = rules.catalogue.species.slice(0, speciesCount(slug)).flatMap(entry => [entry.colour, entry.normal])
    .map(entry => ({ ...entry, href: assetUrl(entry.file) }));
  const atlases = await treesLoaded;

  const groundCanvas = $('.map-ground');
  let store = null;
  const painter = createMapPainter(course, atlases);
  const renderer = createMapRenderer(groundCanvas, {
    onLost: () => store?.forgetGpu(),
    onRestored: () => invalidate(),
  });
  renderer.uploadDetail(createDetailTexture());
  if (atlases) renderer.uploadAtlases(atlases);
  const camera = createCamera();
  const overlay = createOverlay($('.map-marks'));
  let raf = 0;
  const invalidate = () => { if (!raf) raf = requestAnimationFrame(frame); };

  store = createTileStore({
    ground: course.ground,
    baseHref: new URL(BASE, location.href).href,
    renderer,
    painter,
    rules,
    structures: course.features.structures,
    onChange: invalidate,
  });

  const state = {
    mode: 'hole',
    hole: clamp(Number(params.get('hal')) || 1, 1, course.holes.length),
    exaggeration: 2,
    tee: savedTee(course),
    player: null,
    target: null,
    follow: true,
    flight: null,
    flightStart: 0,
    /* The first view waits for the root tile: framing a hole on heights that
       have not arrived put the green under the header. */
    opening: true,
    quality: savedQuality(),
    pace: { last: 0, samples: [] },
    stats: { triangles: 0, trees: 0, patches: 0, frames: 0, lastDrawMs: 0 },
  };
  const hole = () => course.holes[state.hole - 1];
  /* The tee played, by its colour's place in the course's list; a hole short of
     that many tees falls back as the player does. */
  const tee = () => {
    const { tees } = hole();
    return tees[state.tee] ?? tees[course.tees?.def ?? 0] ?? tees[0] ?? { point: hole().line[0], metres: hole().lengths[0] };
  };
  const teePoint = () => tee().point;
  const origin = () => (state.player?.onCourse ? state.player.point : teePoint());
  const groundY = (x, z) => {
    const h = store.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  const shown = (x, z) => groundY(x, z) * state.exaggeration;
  const lifted = point => [point[0], shown(point[0], point[1]), point[1]];

  function insets() {
    const { width, height } = camera.state;
    return width > height
      ? { top: 74, bottom: 96, left: 40, right: 138 }
      : { top: 96, bottom: 196, left: 34, right: 96 };
  }

  function flyTo(view, duration = 800) {
    const { x, y, z, distance, bearing, tilt } = camera.state;
    state.flight = createFlight({ x, y, z, distance, bearing, tilt }, view, reducedMotion ? 0 : duration);
    state.flightStart = performance.now();
    invalidate();
  }

  /* Frames the shot in hand: from where the ball is to the green, whichever way
     that points, with play running up the screen. */
  function frameHole(duration = 800) {
    const h = hole(), from = origin();
    const rest = state.player?.onCourse ? [from] : [from, ...h.line.slice(1)];
    const points = [...rest, ...h.green.ring.filter((_, i) => i % 3 === 0), h.green.c].map(lifted);
    /* Room above the flag, which stands taller than the green it marks. */
    points.push([h.pin[0], shown(h.pin[0], h.pin[1]) + camera.state.distance * 0.03, h.pin[1]]);
    const saved = { ...camera.state };
    const view = camera.fit(points, {
      bearing: bearingOf(from, h.green.c), tilt: HOLE_TILT, insets: insets(),
      minDistance: state.player?.onCourse ? 150 : 200,
      pivot: shown,
    });
    Object.assign(camera.state, saved);
    camera.update();
    flyTo(view, duration);
  }

  function frameCourse(duration = 900) {
    const points = course.holes.flatMap(each => [each.line[0], each.green.c]);
    const saved = { ...camera.state };
    const view = camera.fit(points.map(lifted), {
      bearing: principalBearing(points), tilt: COURSE_TILT, insets: insets(), minDistance: 400, pivot: shown,
    });
    Object.assign(camera.state, saved);
    camera.update();
    flyTo(view, duration);
  }

  function refreshNumbers() {
    const h = hole(), from = origin();
    const { front, centre, back } = greenNumbers(from, h.green);
    /* A placeholder green has a middle but no real edge, so its front and back
       are marked as the estimates they are. */
    const edge = course.greensApproximate ? '≈' : '';
    ui.back.textContent = edge + metres(back ?? centre);
    ui.mid.textContent = metres(centre);
    ui.front.textContent = edge + metres(front ?? centre);
    ui.from.textContent = state.player?.onCourse ? 'från dig' : 'från tee';
    ui.hole.textContent = state.mode === 'course' ? course.name : `Hål ${h.n}`;
    const length = tee().metres ?? h.lengths[0];
    ui.tee.textContent = `Tee ${course.tees?.names?.[state.tee] ?? ''}`.trim();
    ui.tee.hidden = (course.tees?.names?.length ?? 0) < 2 || state.mode === 'course';
    ui.facts.textContent = state.mode === 'course'
      ? `${course.holes.length} hål · par ${course.par}`
      : [`Par ${h.par}`, length ? `${length} m` : null, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    ui.green.hidden = state.mode === 'course';
    ui.profile.hidden = state.mode === 'course';
    ui.overview.setAttribute('aria-pressed', String(state.mode === 'course'));

    if (state.target && state.mode === 'hole') {
      const shot = shotReading(from, state.target, store.heightAt);
      const rest = shotReading(state.target, h.green.c, store.heightAt);
      const advice = recommendClub(shot.plays ?? shot.distance, bag);
      const parts = [`<b>${metres(shot.distance)} m</b>`];
      if (shot.rise !== null) parts.push(signed(shot.rise), `spelas ${metres(shot.plays)} m`);
      if (advice?.club) parts.push(advice.club.name);
      parts.push(`${metres(rest.distance)} m kvar`);
      ui.reading.innerHTML = parts.map(part => `<span>${part}</span>`).join('');
      ui.reading.hidden = false;
    } else ui.reading.hidden = true;

    refreshProfile();
  }

  function refreshProfile() {
    if (state.mode !== 'hole') return;
    const from = origin(), green = hole().green.c;
    const line = elevationProfile(from, green, store.heightAt);
    if (!line) return;
    const range = Math.max(line.high - line.low, 4);
    const y = value => 40 - (value - line.low) / range * 34;
    const step = 300 / (line.points.length - 1);
    const path = line.points.map((value, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    ui.profileLine.setAttribute('d', path);
    ui.profileFill.setAttribute('d', `${path} L300 44 L0 44 Z`);
    const word = Math.abs(line.rise) < 0.5 ? 'plant' : line.rise > 0 ? 'uppför' : 'nedför';
    const plays = shotReading(from, green, store.heightAt).plays;
    const climb = Math.abs(line.rise) < 0.5 ? '' : `${Math.abs(line.rise).toFixed(1).replace('.', ',')} m`;
    ui.profileText.textContent = `${word} ${climb}`.trim();
    ui.profilePlays.textContent = plays ? `spelas ${metres(plays)} m` : '';
  }

  function goHole(number, { fly = true } = {}) {
    state.hole = clamp(number, 1, course.holes.length);
    state.mode = 'hole';
    state.target = null;
    /* The tiles for this hole, ahead of need: the flight lands on 1 m ground
       instead of waiting for it. */
    store.prefetch(hole().tileIds.map(id => store.nodes.get(id)).filter(Boolean));
    refreshNumbers();
    if (fly) frameHole();
    invalidate();
  }

  function showCourse() {
    state.mode = 'course';
    state.target = null;
    state.follow = false;
    refreshNumbers();
    frameCourse();
  }

  /* ---- position ---- */
  const screenLock = createScreenLock();
  function receiveFix(coords) {
      const [x, z] = gpsToLocal(coords, course.geo);
      const point = course.frame.toWorld(x, z);
      const nearby = nearestHole(point, course.holes, state.hole);
      const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : 0;
      const onCourse = Boolean(nearby) && nearby.distance <= OFF_COURSE_METRES;
      const first = !state.player?.onCourse;
      state.player = { point, accuracy: clamp(accuracy, 3, 60), onCourse };
      if (!onCourse) {
        status(nearby ? `${Math.round(nearby.distance)} m från närmaste hål` : 'Positionen ligger utanför banan');
        refreshNumbers();
        invalidate();
        return;
      }
      const moved = nearby.distance <= FOLLOW_HOLE_METRES && nearby.hole !== state.hole;
      if (state.follow && moved) goHole(nearby.hole);
      else {
        refreshNumbers();
        if (state.follow) frameHole(first ? 900 : 500);
      }
      ui.gps.textContent = `±${Math.max(1, Math.round(accuracy))} m`;
      invalidate();
  }
  const gps = createGps({
    onFix: receiveFix,
    onFailure(message) {
      status(message);
      if (!gps.active) stopGps();
    },
  });

  function stopGps() {
    gps.stop();
    screenLock.release();
    state.player = null;
    ui.gps.textContent = 'GPS';
    ui.gps.setAttribute('aria-pressed', 'false');
    refreshNumbers();
    invalidate();
  }

  ui.gps.onclick = () => {
    if (gps.active) { stopGps(); return; }
    gps.start();
    screenLock.hold();
    state.follow = true;
    ui.gps.textContent = 'Söker…';
    ui.gps.setAttribute('aria-pressed', 'true');
  };

  /* ---- controls ---- */
  let bag = DEFAULT_BAG;
  try { bag = parseBag(localStorage.getItem(BAG_KEY)) ?? DEFAULT_BAG; } catch { bag = DEFAULT_BAG; }

  $('[data-prev]').onclick = () => { state.follow = false; goHole(state.hole > 1 ? state.hole - 1 : course.holes.length); };
  $('[data-next]').onclick = () => { state.follow = false; goHole(state.hole < course.holes.length ? state.hole + 1 : 1); };
  ui.overview.onclick = () => {
    if (state.mode === 'course') { state.follow = Boolean(state.player); goHole(state.hole); } else showCourse();
  };
  ui.tee.onclick = () => {
    state.tee = (state.tee + 1) % course.tees.names.length;
    try { localStorage.setItem(`${TEE_KEY}:${course.slug}`, String(state.tee)); } catch { /* a private window keeps it for this visit */ }
    state.target = null;
    refreshNumbers();
    if (state.mode === 'hole') frameHole(500);
    invalidate();
  };
  ui.relief.onclick = () => {
    const next = RELIEF_STEPS[(RELIEF_STEPS.indexOf(state.exaggeration) + 1) % RELIEF_STEPS.length];
    camera.state.y *= next / state.exaggeration;
    state.exaggeration = next;
    ui.relief.textContent = `Höjd ${String(next).replace('.', ',')}×`;
    invalidate();
  };

  const tiles = offlineTiles(store, course);
  const offlineExtras = treeFiles;
  const megabytes = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
  if (isDownloaded(course)) ui.download.textContent = 'Sparad';
  ui.download.onclick = async () => {
    if (isDownloaded(course) || ui.download.disabled) return;
    if (!globalThis.caches) { status('Webbläsaren kan inte spara banan'); return; }
    ui.download.disabled = true;
    try {
      const result = await downloadCourse(store, course, {
        extras: offlineExtras,
        onProgress: share => { ui.download.textContent = `${Math.round(share * 100)} %`; },
      });
      ui.download.textContent = 'Sparad';
      status(`Banan är sparad · ${megabytes(result.bytes)} · fungerar utan täckning`);
    } catch (error) {
      ui.download.textContent = 'Spara';
      status(`Kunde inte spara: ${error.message}`);
    } finally { ui.download.disabled = false; }
  };
  ui.download.title = `Spara banan för spel utan täckning (${megabytes(offlineBytes(tiles, offlineExtras))})`;

  attachGestures($('.map-marks'), {
    onTouched() { state.flight = null; },
    onPan(from, to) {
      state.follow = false;
      const a = camera.onPlane(from.x, from.y), b = camera.onPlane(to.x, to.y);
      if (!a || !b) return;
      camera.state.x += a[0] - b[0];
      camera.state.z += a[1] - b[1];
      invalidate();
    },
    onTwoFingers({ centre, from, zoom, turn, lean }) {
      state.follow = false;
      const before = camera.onPlane(from.x, from.y);
      camera.state.distance = clamp(camera.state.distance * zoom, MIN_DISTANCE, MAX_DISTANCE);
      camera.state.bearing -= turn;
      camera.state.tilt = clamp(camera.state.tilt - lean, MIN_TILT, MAX_TILT);
      camera.update();
      const after = camera.onPlane(centre.x, centre.y);
      if (before && after) {
        camera.state.x += before[0] - after[0];
        camera.state.z += before[1] - after[1];
      }
      invalidate();
    },
    onTurn(turn, lean) {
      state.follow = false;
      camera.state.bearing += turn;
      camera.state.tilt = clamp(camera.state.tilt + lean, MIN_TILT, MAX_TILT);
      invalidate();
    },
    onDoubleTap(point) {
      state.follow = false;
      const hit = camera.pick(point.x, point.y, store.heightAt, state.exaggeration);
      if (!hit) return;
      const { bearing, tilt, distance } = camera.state;
      flyTo({ x: hit[0], y: shown(hit[0], hit[1]), z: hit[1], bearing, tilt, distance: clamp(distance * 0.55, MIN_DISTANCE, MAX_DISTANCE) }, 350);
    },
    onTap(point) {
      if (state.mode === 'course') {
        const tapped = overlay.holeAt(point.x, point.y);
        if (tapped) { state.follow = Boolean(state.player); goHole(tapped); }
        return;
      }
      if (state.target) {
        const s = camera.project(...lifted(state.target));
        if (Math.hypot(s.x - point.x, s.y - point.y) < 30) {
          state.target = null;
          refreshNumbers();
          invalidate();
          return;
        }
      }
      const hit = camera.pick(point.x, point.y, store.heightAt, state.exaggeration);
      if (!hit) return;
      state.target = hit;
      refreshNumbers();
      invalidate();
    },
  });

  const pixelRatio = () => Math.min(devicePixelRatio || 1, QUALITY_STEPS[state.quality].pixelRatio);

  /* Only moving frames count: a still map draws one frame and stops, so the time
     between two of those says nothing about the device. */
  function notePace(time) {
    const { pace } = state;
    const moving = time - pace.last < 200;
    if (moving) pace.samples.push(time - pace.last);
    pace.last = time;
    if (pace.samples.length < PACE_SAMPLES) return;
    const typical = [...pace.samples].sort((a, b) => a - b)[PACE_SAMPLES >> 1];
    pace.samples.length = 0;
    if (typical > SLOW_FRAME_MS && state.quality < QUALITY_STEPS.length - 1 && !params.has('mapquality')) {
      state.quality++;
      try { localStorage.setItem(QUALITY_KEY, String(state.quality)); } catch { /* it holds for this visit */ }
      resize();
    }
  }

  function resize() {
    const box = root.getBoundingClientRect();
    /* Two device pixels per CSS pixel is as sharp as a map gets at arm's length,
       and a 3x phone would otherwise fill more than twice as many. */
    const ratio = pixelRatio();
    camera.state.width = box.width;
    camera.state.height = box.height;
    camera.update();
    renderer.resize(Math.round(box.width * ratio), Math.round(box.height * ratio));
    overlay.resize(box.width, box.height, Math.min(devicePixelRatio || 1, 3));
    invalidate();
  }
  addEventListener('resize', resize);
  addEventListener('orientationchange', resize);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') invalidate(); });

  function frame(time) {
    raf = 0;
    const started = performance.now();
    if (time !== undefined) notePace(time);
    if (state.flight) {
      const elapsed = (time ?? started) - state.flightStart;
      Object.assign(camera.state, state.flight.at(elapsed));
      if (state.flight.done(elapsed)) state.flight = null;
    } else {
      /* Stand the pivot on the ground as finer heights arrive, gently: a jump
         here would shake the whole picture. */
      const want = shown(camera.state.x, camera.state.z);
      camera.state.y += (want - camera.state.y) * 0.25;
    }
    camera.update();

    const backlog = store.drainUploads();
    if (state.opening && store.isReady(store.root)) {
      state.opening = false;
      if (params.get('vy') === 'bana') showCourse(); else goHole(state.hole);
      if (state.flight) Object.assign(camera.state, state.flight.at(1e9));
      state.flight = null;
      camera.update();
    }
    const { eye, clip, pixelsPerRadian } = camera.derived;
    const selection = selectPatches({
      root: store.root,
      isReady: store.isReady,
      eye,
      planes: frustumPlanes(clip),
      pixelsPerRadian: pixelsPerRadian * pixelRatio(),
      exaggeration: state.exaggeration,
    });
    store.request(selection.wanted);

    if (selection.patches.length) {
      for (const patch of selection.patches) {
        const size = patch.node.size * patch.span;
        patch.reach = Math.hypot(patch.node.x0 + (patch.u0 + patch.span / 2) * patch.node.size - eye[0],
          patch.node.z0 + (patch.v0 + patch.span / 2) * patch.node.size - eye[2]) - size;
      }
      selection.patches.sort((a, b) => a.reach - b.reach);
      const { distance, bearing } = camera.state;
      const fillBearing = bearing - Math.PI / 4;
      /* Close up the map colours carry the surface and the light only models it;
         over a whole course the light has to do the work, since a hole's slopes
         are too gentle to read at that size. */
      const wide = clamp(Math.log2(distance / 350) / 3, 0, 1);
      const blend = (near, far) => near + (far - near) * wide;
      const treeReach = pixelsPerRadian * pixelRatio() / 2.6;
      const metresPerPixel = distance / pixelsPerRadian;
      const interval = contourInterval(metresPerPixel);
      const drawn = renderer.draw(selection.patches, {
        clip,
        eye,
        exaggeration: state.exaggeration,
        /* One sun over the whole course, so shadows lie one way and a tree's falls
           where it would. A fill turns with the map, always from the top left of
           the screen: lit only from below, the eye reads hills as hollows. */
        sun: SUN,
        fill: [Math.sin(fillBearing) * 0.6, 0.8, -Math.cos(fillBearing) * 0.6],
        shadow: [0.56, 0.6, 0.68],
        closeness: clamp(1.5 - distance / 900, 0, 1),
        slopeGain: blend(1.25, 1.9) * Math.sqrt(state.exaggeration),
        shading: [blend(-0.24, -0.36), blend(0.18, 0.26), blend(0.1, 0.14), blend(0.08, 0.14)],
        treeFade: [treeReach * 0.72, treeReach],
        treeBudget: QUALITY_STEPS[state.quality].trees,
        fog: [distance * 2.2, Math.max(distance * 14, 9000)],
        haze: [0.71, 0.84, 0.9],
        zenith: [0.2, 0.47, 0.78],
        contour: [interval, blend(0.42, 0.2), 5],
        tint: [course.heightLow, course.heightHigh],
      });
      state.stats.triangles = drawn.triangles;
      state.stats.trees = drawn.trees;
      state.stats.patches = drawn.patches;
      state.stats.frames++;
      store.markUsed(selection.patches);
      if (boot && !boot.classList.contains('done')) boot.classList.add('done');
    }

    overlay.draw({
      camera,
      ground: shown,
      course,
      mode: state.mode,
      hole: hole(),
      origin: origin(),
      tee: state.player?.onCourse ? null : teePoint(),
      player: state.player,
      target: state.mode === 'hole' ? state.target : null,
    });

    state.stats.lastDrawMs = performance.now() - started;
    if (state.flight || backlog > 0 || Math.abs(shown(camera.state.x, camera.state.z) - camera.state.y) > 0.05) invalidate();
    if (store.stats().busy === 0 && !state.flight) refreshProfile();
  }

  resize();
  say('hämtar terrängen');
  refreshNumbers();
  if (course.greensApproximate) status('Greenernas form är ungefärlig på den här banan', 6000);

  /* The harness's handle: a fake position stands in for a walk across a course. */
  globalThis.V3DMap = {
    course,
    camera,
    state,
    store,
    goHole,
    showCourse,
    invalidate,
    heightAt: store.heightAt,
    stats: () => ({ ...state.stats, ...store.stats(), camera: { ...camera.state } }),
    fix: (latitude, longitude, accuracy = 4) => receiveFix({ latitude, longitude, accuracy }),
    worldOf: (latitude, longitude) => course.frame.toWorld(...gpsToLocal({ latitude, longitude }, course.geo)),
  };
}

start().catch(fail);
