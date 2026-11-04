/* The map session: every course as a light 3D map for a real round on the phone.
   ?bana=<slug>&karta=1, optionally &hal=<n>. Nothing here imports three.js or
   the player: it is a separate, far smaller program over the same course data.

   The frame only ever draws because something changed. There is no loop: a phone
   in a pocket between shots spends nothing on the map. */
import '../styles/course-map.css';
import { DEFAULT_BAG, gpsToLocal, nearestHole, parseBag, recommendClub } from '../engine/caddie.js';
import { compassName as windCompass, fetchWeather, weatherWord } from '../engine/weather.js';
import { detailedUrl } from '../shell/router.js';
import { frustumPlanes, selectPatches } from './map-lod.mjs';
import { createCamera, createFlight, MAX_DISTANCE, MAX_TILT, MIN_DISTANCE, MIN_TILT } from './map-camera.mjs';
import { loadMapCourse } from './map-course.mjs';
import { createGps, createScreenLock, downloadCourse, isDownloaded, offlineBytes, offlineTiles } from './map-field.mjs';
import { createMapRenderer } from './map-gl.mjs';
import { attachGestures } from './map-gestures.mjs';
import { SHADE_BELOW_SUN } from './map-horizon.mjs';
import { AUTUMN_RAMPS, compassName, DEFAULT_LIGHT, lightByKey, lightNow, MAP_LIGHTS } from './map-light.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, hazardsAhead, placeOnProfile, playedPath, principalBearing, stripX, windWords, shotReading } from './map-measure.mjs';
import { createOverlay } from './map-overlay.mjs';
import { MAX_HANDICAP, MIN_HANDICAP, newRound, parseRound, roundTotals, scoreName, stablefordPoints, strokesReceived } from './map-score.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { createMapPainter } from './map-paint.mjs';
import { createTileStore, fetchKeptFile } from './map-tiles.mjs';
import { catalogueFor, createTreeRules, loadTreeAtlases, speciesCount } from './map-trees.mjs';

const params = new URLSearchParams(location.search);
const slug = params.get('bana');
const BASE = import.meta.env.BASE_URL;
const HOLE_TILT = 0.9, COURSE_TILT = 0.72;
const RELIEF_STEPS = [1, 1.5, 2, 3];
/* What a device that cannot hold the pace gives up, in order: distant trees first,
   then sharpness. A map that moves smoothly is worth more than one that is sharp
   and stutters. A step down is remembered, so the next round starts there. */
const QUALITY_STEPS = Object.freeze([
  { trees: 20000, pixelRatio: 2 },
  { trees: 12000, pixelRatio: 2 },
  { trees: 5000, pixelRatio: 1.6 },
  { trees: 2500, pixelRatio: 1.3 },
]);
const QUALITY_KEY = 'banvy-map-quality-v1';
const SLOW_FRAME_MS = 36, PACE_SAMPLES = 24;
const BAG_KEY = 'banvy-caddie-bag-v1';
const TEE_KEY = 'banvy-map-tee-v1';
const LIGHT_KEY = 'banvy-map-light-v1';
const CONTOUR_KEY = 'banvy-map-contours-v1';
const NOW_REFRESH_MS = 60000;
const HAZARD_KEY = 'banvy-map-hazards-v1';
const ROUND_KEY = 'banvy-map-round-v1';
const HANDICAP_KEY = 'banvy-map-handicap-v1';
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
/* Older than this, a wind reading is history and has no business in a plays-like. */
const WEATHER_TRUSTED_MS = 3 * 60 * 60 * 1000;
const OFF_COURSE_METRES = 450, FOLLOW_HOLE_METRES = 120;
/* Further than this from a hole's line, a player is not on that hole. */
const ON_THE_STRIP_METRES = 150;
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
  <div class="map-side">
    <aside class="map-green" data-green aria-label="Avstånd till greenen">
      <div><span>Bak</span><b data-back-number>–</b></div>
      <div class="map-green-mid"><span>Mitt</span><b data-mid-number>–</b></div>
      <div><span>Fram</span><b data-front-number>–</b></div>
      <small data-from></small>
    </aside>
    <button class="map-wind" data-wind hidden aria-label="Vind och väder">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" data-wind-arrow><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/></svg>
      <b data-wind-speed></b><span data-wind-temp></span>
    </button>
  </div>
  <section class="map-bottom">
    <div class="map-reading" data-reading hidden></div>
    <div class="map-profile" data-profile>
      <svg viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path data-profile-fill fill="rgba(120,205,120,.32)"/><path data-profile-line fill="none" stroke="#a6efa0" stroke-width="2" vector-effect="non-scaling-stroke"/><rect data-profile-walked y="0" width="0" height="44" fill="rgba(12,24,18,.62)"/></svg>
      <i class="map-mark map-mark-aim" data-profile-aim hidden></i>
      <i class="map-mark map-mark-you" data-profile-you hidden></i>
      <span data-profile-text></span><span class="map-plays" data-profile-plays></span>
    </div>
    <div class="map-tools">
      <button class="map-tool" data-gps aria-pressed="false">GPS</button>
      <button class="map-tool" data-light aria-expanded="false">Ljus</button>
      <button class="map-tool" data-now aria-pressed="false" aria-label="Ljuset just nu på banan">Nu</button>
      <button class="map-tool" data-score aria-expanded="false">Score</button>
      <button class="map-tool" data-menu aria-expanded="false">Meny</button>
    </div>
  </section>
  <section class="map-sheet" data-score-sheet hidden aria-label="Scorekort">
    <div class="map-sheet-head"><b data-score-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div class="map-steppers">
      <div class="map-stepper"><span>Slag</span><button data-strokes-less aria-label="Ett slag färre">−</button><output data-strokes>–</output><button data-strokes-more aria-label="Ett slag till">+</button></div>
      <div class="map-stepper"><span>Putt</span><button data-putts-less aria-label="En putt färre">−</button><output data-putts>–</output><button data-putts-more aria-label="En putt till">+</button></div>
    </div>
    <p class="map-score-word" data-score-word></p>
    <p class="map-score-sum" data-score-sum></p>
    <div class="map-card" data-card></div>
    <div class="map-stepper map-handicap"><span>Spelhandicap</span><button data-handicap-less aria-label="Sänk spelhandicap">−</button><output data-handicap>–</output><button data-handicap-more aria-label="Höj spelhandicap">+</button></div>
    <div class="map-actions">
      <button class="map-action" data-pick-up>Stryk hålet</button>
      <button class="map-action" data-new-round>Ny runda</button>
    </div>
  </section>
  <section class="map-sheet" data-light-sheet hidden aria-label="Ljus">
    <div class="map-sheet-head"><b>Ljus</b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div class="map-lights" data-lights></div>
  </section>
  <section class="map-sheet map-menu" data-menu-sheet hidden aria-label="Meny">
    <div class="map-sheet-head"><b data-menu-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <p class="map-note" data-note hidden></p>
    <h3>Hål</h3>
    <div class="map-holes" data-holes></div>
    <div data-tee-section>
      <h3>Tee</h3>
      <div class="map-chips" data-tees></div>
    </div>
    <h3>Höjd</h3>
    <div class="map-chips" data-reliefs></div>
    <label class="map-row"><span>Höjdkurvor</span><input type="checkbox" data-contours></label>
    <label class="map-row"><span>Hinderavstånd</span><input type="checkbox" data-hazards></label>
    <div class="map-actions">
      <button class="map-action" data-download>Spara banan</button>
      <a class="map-action" data-full>Detaljerad 3D</a>
      <a class="map-action" href="${BASE}">Alla banor</a>
    </div>
  </section>
  <div class="map-status" data-status hidden role="status"></div>`;
document.body.append(root);

const $ = selector => root.querySelector(selector);
const ui = {
  hole: $('[data-hole-title]'), facts: $('[data-hole-facts]'),
  back: $('[data-back-number]'), mid: $('[data-mid-number]'), front: $('[data-front-number]'), from: $('[data-from]'),
  reading: $('[data-reading]'), status: $('[data-status]'),
  gps: $('[data-gps]'), light: $('[data-light]'), now: $('[data-now]'), menu: $('[data-menu]'), score: $('[data-score]'),
  scoreSheet: $('[data-score-sheet]'), scoreTitle: $('[data-score-title]'), strokes: $('[data-strokes]'), putts: $('[data-putts]'),
  scoreWord: $('[data-score-word]'), scoreSum: $('[data-score-sum]'), card: $('[data-card]'), handicap: $('[data-handicap]'),
  pickUp: $('[data-pick-up]'), newRound: $('[data-new-round]'), hazards: $('[data-hazards]'),
  wind: $('[data-wind]'), windArrow: $('[data-wind-arrow]'), windSpeed: $('[data-wind-speed]'), windTemp: $('[data-wind-temp]'),
  lightSheet: $('[data-light-sheet]'), menuSheet: $('[data-menu-sheet]'), lights: $('[data-lights]'),
  menuTitle: $('[data-menu-title]'), note: $('[data-note]'), holes: $('[data-holes]'),
  teeSection: $('[data-tee-section]'), tees: $('[data-tees]'), reliefs: $('[data-reliefs]'), contours: $('[data-contours]'),
  download: $('[data-download]'), full: $('[data-full]'),
  overview: $('[data-overview]'), green: $('[data-green]'),
  profile: $('[data-profile]'), profileLine: $('[data-profile-line]'), profileFill: $('[data-profile-fill]'), profileText: $('[data-profile-text]'), profilePlays: $('[data-profile-plays]'),
  profileWalked: $('[data-profile-walked]'), profileYou: $('[data-profile-you]'), profileAim: $('[data-profile-aim]'),
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

function savedText(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* it holds for this visit */ }
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
  ui.full.href = `${BASE}${detailedUrl(slug)}`;

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
    lightKey: params.get('nu') === '1' ? 'nu' : params.get('ljus') ?? savedText(LIGHT_KEY, DEFAULT_LIGHT),
    light: null,
    lightClock: null,
    contours: savedText(CONTOUR_KEY, '1') !== '0',
    showHazards: savedText(HAZARD_KEY, '1') !== '0',
    hazards: [],
    weather: null,
    windTurn: null,
    scoreHole: null,
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
      : { top: 96, bottom: 204, left: 34, right: 96 };
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

  /* Live air, while it can be trusted. */
  const air = () => {
    const reading = state.weather;
    return reading && Date.now() - (reading.fetchedAt ?? 0) < WEATHER_TRUSTED_MS ? reading : null;
  };

  function refreshNumbers() {
    const h = hole(), from = origin();
    state.hazards = state.mode === 'hole'
      ? hazardsAhead({ origin: from, path: playedPath(h, teePoint()), ...course.hazards })
      : [];
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
    refreshMenu();
    ui.facts.textContent = state.mode === 'course'
      ? `${course.holes.length} hål · par ${course.par}`
      : [`Par ${h.par}`, length ? `${length} m` : null, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    ui.green.hidden = state.mode === 'course';
    ui.profile.hidden = state.mode === 'course';
    ui.overview.setAttribute('aria-pressed', String(state.mode === 'course'));

    if (state.target && state.mode === 'hole') {
      const shot = shotReading(from, state.target, store.heightAt, air());
      const rest = shotReading(state.target, h.green.c, store.heightAt, air());
      const advice = recommendClub(shot.plays ?? shot.distance, bag);
      const parts = [`<b>${metres(shot.distance)} m</b>`];
      if (shot.rise !== null) parts.push(signed(shot.rise), `spelas ${metres(shot.plays)} m`);
      parts.push(...windWords(shot));
      if (advice?.club) parts.push(advice.club.name);
      parts.push(`${metres(rest.distance)} m kvar`);
      ui.reading.innerHTML = parts.map(part => `<span>${part}</span>`).join('');
      ui.reading.hidden = false;
    } else ui.reading.hidden = true;

    refreshProfile();
  }

  /* The whole hole, tee to green, so it keeps its shape all the way round and the
     player can move along it. */
  function refreshProfile() {
    if (state.mode !== 'hole') return;
    const from = origin(), green = hole().green.c;
    const path = playedPath(hole(), teePoint());
    /* Dense enough that the last stretch still draws a true curve when it has
       spread across most of the strip. */
    const line = elevationProfile(path, store.heightAt, 180);
    if (!line) return;
    const you = state.player?.onCourse ? placeOnProfile(state.player.point, path, line, ON_THE_STRIP_METRES) : null;
    const walked = you?.share ?? 0;
    const shareOf = i => i / (line.points.length - 1);

    /* The height scale belongs to the ground still to come, so a rise before the
       green reads as one however big the hole's hills were. Ground already walked
       may run past it, and rests against the strip's edges. */
    const ahead = line.points.filter((_, i) => shareOf(i) >= walked);
    const low = Math.min(...ahead), high = Math.max(...ahead);
    const range = Math.max(high - low, 3);
    const y = value => clamp(35 - (value - low) / range * 29, 4, 38);
    const curve = line.points.map((value, i) => `${i ? 'L' : 'M'}${(stripX(shareOf(i), walked) * 300).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    ui.profileLine.setAttribute('d', curve);
    ui.profileFill.setAttribute('d', `${curve} L300 44 L0 44 Z`);

    const mark = (element, place) => {
      element.hidden = !place;
      if (!place) return;
      element.dataset.share = place.share.toFixed(4);
      element.style.setProperty('--x', stripX(place.share, walked).toFixed(4));
      element.style.setProperty('--y', (y(place.height) / 44).toFixed(4));
    };
    const aim = state.target ? placeOnProfile(state.target, path, line) : null;
    mark(ui.profileYou, you);
    mark(ui.profileAim, aim);
    /* What is behind the player is done with, and steps back. */
    ui.profileWalked.setAttribute('width', (stripX(walked, walked) * 300).toFixed(1));

    const { rise, plays } = shotReading(from, green, store.heightAt, air());
    const flat = rise === null || Math.abs(rise) < 0.5;
    const word = flat ? 'plant' : rise > 0 ? 'uppför' : 'nedför';
    const climb = flat ? '' : `${Math.abs(rise).toFixed(1).replace('.', ',')} m`;
    ui.profileText.textContent = `${word} ${climb} ${you && !flat ? 'kvar' : ''}`.replace(/\s+/g, ' ').trim();
    ui.profilePlays.textContent = plays ? `spelas ${metres(plays)} m` : '';
    ui.profile.setAttribute('aria-label', you
      ? `Höjdprofil. Du är ${Math.round(you.along)} av ${Math.round(line.distance)} meter in på hålet.`
      : `Höjdprofil över hålet, ${Math.round(line.distance)} meter.`);
  }

  function goHole(number, { fly = true } = {}) {
    state.hole = clamp(number, 1, course.holes.length);
    state.scoreHole = null;
    if (!ui.scoreSheet.hidden) refreshScore();
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
  /* ---- the sheets ---- */
  const sheets = [[ui.lightSheet, ui.light], [ui.menuSheet, ui.menu], [ui.scoreSheet, ui.score]];
  function showSheet(sheet) {
    for (const [each, button] of sheets) {
      const open = each === sheet && each.hidden;
      each.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    }
  }
  ui.light.onclick = () => showSheet(ui.lightSheet);
  ui.menu.onclick = () => { refreshMenu(); showSheet(ui.menuSheet); };
  ui.score.onclick = () => { refreshScore(); showSheet(ui.scoreSheet); };
  for (const button of root.querySelectorAll('[data-close]')) button.onclick = () => showSheet(null);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') showSheet(null); });

  const chip = (label, pressed, onClick, extra = '') => {
    const button = document.createElement('button');
    button.className = `map-chip ${extra}`.trim();
    button.textContent = label;
    button.setAttribute('aria-pressed', String(pressed));
    button.onclick = onClick;
    return button;
  };

  function refreshMenu() {
    const h = hole(), hasHole = state.mode === 'hole';
    ui.menuTitle.textContent = hasHole ? [`Hål ${h.n}`, h.name].filter(Boolean).join(' · ') : course.name;
    ui.note.textContent = hasHole ? h.note ?? '' : '';
    ui.note.hidden = !ui.note.textContent;
    ui.holes.replaceChildren(...course.holes.map(each => chip(String(each.n), hasHole && each.n === h.n, () => {
      state.follow = false;
      showSheet(null);
      goHole(each.n);
    })));
    const names = course.tees?.names ?? [];
    ui.teeSection.hidden = names.length < 2 || !hasHole;
    ui.tees.replaceChildren(...names.map((name, index) => chip(name, index === state.tee, () => {
      state.tee = index;
      remember(`${TEE_KEY}:${course.slug}`, String(index));
      state.target = null;
      refreshNumbers();
      if (state.mode === 'hole') frameHole(500);
      invalidate();
    })));
    ui.reliefs.replaceChildren(...RELIEF_STEPS.map(step => chip(`${String(step).replace('.', ',')}×`, step === state.exaggeration, () => {
      camera.state.y *= step / state.exaggeration;
      state.exaggeration = step;
      refreshMenu();
      invalidate();
    })));
    ui.contours.checked = state.contours;
    ui.hazards.checked = state.showHazards;
  }
  ui.contours.onchange = () => {
    state.contours = ui.contours.checked;
    remember(CONTOUR_KEY, state.contours ? '1' : '0');
    invalidate();
  };

  ui.hazards.onchange = () => {
    state.showHazards = ui.hazards.checked;
    remember(HAZARD_KEY, state.showHazards ? '1' : '0');
    invalidate();
  };

  /* ---- the card ---- */
  const roundKey = `${ROUND_KEY}:${course.slug}`;
  let round = parseRound(savedText(roundKey, null)) ?? newRound();
  if (!Number.isFinite(round.handicap)) {
    const known = Number(savedText(HANDICAP_KEY, ''));
    if (savedText(HANDICAP_KEY, '') !== '' && Number.isFinite(known)) round.handicap = known;
  }
  const scoredHole = () => course.holes[(state.scoreHole ?? state.hole) - 1];
  const saveRound = () => remember(roundKey, JSON.stringify(round));

  function setScore(change) {
    const h = scoredHole();
    round.scores[h.n] = { ...round.scores[h.n], ...change };
    saveRound();
    refreshScore();
  }

  function cardRows(holes) {
    const sum = pick => holes.reduce((total, each) => total + (pick(each) ?? 0), 0);
    const score = each => round.scores[each.n];
    const shown = each => (score(each)?.picked ? '–' : score(each)?.strokes ?? '');
    const kind = each => {
      const strokes = score(each)?.strokes;
      if (!Number.isFinite(strokes)) return '';
      return strokes < each.par ? 'is-under' : strokes > each.par ? 'is-over' : '';
    };
    const cell = (each, text, extra = '') => `<button data-card-hole="${each.n}" class="${extra} ${each.n === scoredHole().n ? 'is-now' : ''}" aria-label="Hål ${each.n}">${text}</button>`;
    return `<div class="map-card-row map-card-head"><span>Hål</span>${holes.map(each => cell(each, each.n)).join('')}<span>Σ</span></div>
      <div class="map-card-row"><span>Par</span>${holes.map(each => cell(each, each.par)).join('')}<span>${sum(each => each.par)}</span></div>
      <div class="map-card-row map-card-score"><span>Slag</span>${holes.map(each => cell(each, shown(each), kind(each))).join('')}<span>${sum(each => score(each)?.strokes) || ''}</span></div>`;
  }

  function refreshScore() {
    const h = scoredHole(), own = round.scores[h.n] ?? {};
    ui.scoreTitle.textContent = [`Hål ${h.n}`, `Par ${h.par}`, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    ui.strokes.textContent = own.picked ? '–' : own.strokes ?? '–';
    ui.putts.textContent = own.putts ?? '–';
    ui.handicap.textContent = Number.isFinite(round.handicap) ? String(round.handicap) : '–';
    const received = strokesReceived(round.handicap, h, course.holes);
    const name = Number.isFinite(own.strokes) && !own.picked ? scoreName(own.strokes, h.par) : own.picked ? 'Struket' : '';
    const points = received === null ? null : own.picked ? 0 : Number.isFinite(own.strokes) ? stablefordPoints(h.par, own.strokes, received) : null;
    ui.scoreWord.textContent = [name, points === null ? null : `${points} poäng`,
      received ? `${received} erhållna slag` : null].filter(Boolean).join(' · ');
    const totals = roundTotals(round, course.holes);
    const toPar = totals.toPar === 0 ? 'E' : `${totals.toPar > 0 ? '+' : '−'}${Math.abs(totals.toPar)}`;
    ui.scoreSum.textContent = totals.played
      ? [`${totals.strokes} slag`, totals.strokes ? toPar : null, totals.points === null ? null : `${totals.points} poäng`, totals.putts ? `${totals.putts} putt` : null].filter(Boolean).join(' · ')
      : 'Rundan har inte börjat';
    const nines = [course.holes.slice(0, 9), course.holes.slice(9)].filter(part => part.length);
    ui.card.innerHTML = nines.map(cardRows).join('');
  }

  ui.card.onclick = event => {
    const target = event.target.closest('[data-card-hole]');
    if (!target) return;
    state.scoreHole = Number(target.dataset.cardHole);
    refreshScore();
  };
  $('[data-strokes-more]').onclick = () => {
    const { strokes } = round.scores[scoredHole().n] ?? {};
    setScore({ strokes: Number.isFinite(strokes) ? strokes + 1 : scoredHole().par, picked: false });
  };
  $('[data-strokes-less]').onclick = () => {
    const { strokes } = round.scores[scoredHole().n] ?? {};
    setScore({ strokes: Number.isFinite(strokes) ? Math.max(1, strokes - 1) : scoredHole().par, picked: false });
  };
  $('[data-putts-more]').onclick = () => {
    const { putts } = round.scores[scoredHole().n] ?? {};
    setScore({ putts: Number.isFinite(putts) ? putts + 1 : 2 });
  };
  $('[data-putts-less]').onclick = () => {
    const { putts } = round.scores[scoredHole().n] ?? {};
    setScore({ putts: Number.isFinite(putts) ? Math.max(0, putts - 1) : 2 });
  };
  ui.pickUp.onclick = () => setScore({ strokes: null, putts: null, picked: true });
  const setHandicap = value => {
    round.handicap = clamp(value, MIN_HANDICAP, MAX_HANDICAP);
    remember(HANDICAP_KEY, String(round.handicap));
    saveRound();
    refreshScore();
  };
  $('[data-handicap-more]').onclick = () => setHandicap(Number.isFinite(round.handicap) ? round.handicap + 1 : 18);
  $('[data-handicap-less]').onclick = () => setHandicap(Number.isFinite(round.handicap) ? round.handicap - 1 : 18);

  /* A whole round is one stray tap from gone, so it takes a second tap to clear. */
  let clearing = 0;
  ui.newRound.onclick = () => {
    if (!clearing) {
      ui.newRound.textContent = 'Säker? Tryck igen';
      clearing = setTimeout(() => { clearing = 0; ui.newRound.textContent = 'Ny runda'; }, 4000);
      return;
    }
    clearTimeout(clearing);
    clearing = 0;
    const { handicap } = round;
    round = { ...newRound(), handicap };
    state.scoreHole = 1;
    ui.newRound.textContent = 'Ny runda';
    saveRound();
    refreshScore();
  };

  /* ---- the light ---- */
  const { lat: latitude, lon: longitude } = course.geo.origin;
  const lightSwatch = light => `linear-gradient(180deg, rgb(${light.zenith.map(n => Math.round(n * 255))}), rgb(${light.horizon.map(n => Math.round(n * 255))}) 62%, rgb(${light.grade.map(n => Math.round(Math.min(n, 1) * 120))}) 62%)`;
  ui.lights.replaceChildren(...MAP_LIGHTS.map(light => {
    const button = chip(light.label, false, () => setLight(light.key), 'map-light-chip');
    button.dataset.key = light.key;
    button.style.setProperty('--swatch', lightSwatch(light));
    return button;
  }));

  function refreshLight() {
    const clock = state.lightClock ?? new Date();
    const next = state.lightKey === 'nu' ? lightNow(clock, latitude, longitude) : lightByKey(state.lightKey) ?? lightByKey(DEFAULT_LIGHT);
    const changed = !state.light || state.light.key !== next.key
      || Math.abs((state.light.elevationDegrees ?? 0) - (next.elevationDegrees ?? 0)) > 0.05;
    state.light = next;
    ui.now.setAttribute('aria-pressed', String(state.lightKey === 'nu'));
    for (const button of ui.lights.children) button.setAttribute('aria-pressed', String(button.dataset.key === state.lightKey));
    if (changed) invalidate();
  }

  function setLight(key) {
    state.lightKey = key;
    remember(LIGHT_KEY, key);
    refreshLight();
  }

  ui.now.onclick = () => {
    if (state.lightKey === 'nu') { setLight(DEFAULT_LIGHT); return; }
    setLight('nu');
    const { elevationDegrees, azimuth } = state.light;
    status(elevationDegrees > 0
      ? `Solen står ${Math.round(elevationDegrees)}° över horisonten i ${compassName(azimuth)}`
      : 'Solen har gått ner');
  };
  setInterval(() => { if (state.lightKey === 'nu' && !document.hidden) refreshLight(); }, NOW_REFRESH_MS);

  /* ---- the wind ---- */
  function applyWeather(reading) {
    state.weather = reading;
    const trusted = air();
    ui.wind.hidden = !trusted;
    if (trusted) {
      ui.windSpeed.textContent = `${Math.round(trusted.windMs)} m/s`;
      ui.windTemp.textContent = Number.isFinite(trusted.tempC) ? `${Math.round(trusted.tempC)}°` : '';
    }
    state.windTurn = null;
    refreshNumbers();
    invalidate();
  }
  async function refreshWeather() {
    if (document.hidden) return;
    const reading = await fetchWeather(latitude, longitude).catch(() => null);
    if (reading) applyWeather(reading);
  }
  ui.wind.onclick = () => {
    const reading = air();
    if (!reading) return;
    const gusts = Number.isFinite(reading.gustMs) ? `, byar ${Math.round(reading.gustMs)}` : '';
    const degrees = Number.isFinite(reading.tempC) ? ` · ${Math.round(reading.tempC)}°` : '';
    status(`${weatherWord(reading.code)} · vind från ${windCompass(reading.windFromDeg)} ${Math.round(reading.windMs)} m/s${gusts}${degrees}`);
  };
  setInterval(refreshWeather, WEATHER_REFRESH_MS);
  document.addEventListener('visibilitychange', refreshWeather);
  refreshWeather();

  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.lightKey === 'nu') refreshLight(); });
  refreshLight();

  const tiles = offlineTiles(store, course);
  const offlineExtras = treeFiles;
  const megabytes = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
  const saveLabel = `Spara banan · ${megabytes(offlineBytes(tiles, offlineExtras))}`;
  ui.download.textContent = isDownloaded(course) ? 'Sparad' : saveLabel;
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
      ui.download.textContent = saveLabel;
      status(`Kunde inte spara: ${error.message}`);
    } finally { ui.download.disabled = false; }
  };
  ui.download.title = 'Spara banan för spel utan täckning';

  attachGestures($('.map-marks'), {
    onTouched() { state.flight = null; showSheet(null); },
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

  /* Lakes freeze; the sea at Visby does not. */
  const frozenWater = !course.features.water.some(item => item.sea);
  let shadesWaiting = 0;

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
      /* The arrow turns with the map, so it points the way the wind blows on it. */
      const blowing = air();
      if (blowing) {
        const turn = Math.round(blowing.windFromDeg + 180 - bearing * 180 / Math.PI);
        if (turn !== state.windTurn) {
          state.windTurn = turn;
          ui.windArrow.style.transform = `rotate(${turn}deg)`;
        }
      }
      /* Close up the map colours carry the surface and the light only models it;
         over a whole course the light has to do the work, since a hole's slopes
         are too gentle to read at that size. */
      const wide = clamp(Math.log2(distance / 350) / 3, 0, 1);
      const blend = (near, far) => near + (far - near) * wide;
      const treeReach = pixelsPerRadian * pixelRatio() / 2.6;
      /* A low sun throws the land's own shadow, tile by tile, nearest first. */
      const lowSun = state.light.sun[1] < SHADE_BELOW_SUN && params.get('hillshade') !== '0';
      if (lowSun) shadesWaiting = store.bakeHillShades(selection.patches, state.light.sun, state.exaggeration, store.root.maxY * state.exaggeration);
      else shadesWaiting = 0;
      const metresPerPixel = distance / pixelsPerRadian;
      const interval = contourInterval(metresPerPixel);
      const drawn = renderer.draw(selection.patches, {
        clip,
        eye,
        exaggeration: state.exaggeration,
        /* One sun over the whole course, so shadows lie one way and a tree's falls
           where it would. A fill turns with the map, always from the top left of
           the screen: lit only from below, the eye reads hills as hollows. */
        ...state.light,
        ramps: AUTUMN_RAMPS,
        ice: frozenWater ? state.light.snow : 0,
        hillDark: lowSun ? 0.46 * state.light.sunShare : 0,
        turn: bearing / (Math.PI * 2),
        fill: [Math.sin(fillBearing) * 0.6, 0.8, -Math.cos(fillBearing) * 0.6],
        closeness: clamp(1.5 - distance / 900, 0, 1),
        slopeGain: blend(1.25, 1.9) * Math.sqrt(state.exaggeration),
        shading: [blend(-0.24, -0.36), blend(0.18, 0.26), blend(0.1, 0.14), blend(0.08, 0.14)],
        treeFade: [treeReach * 0.72, treeReach],
        treeBudget: QUALITY_STEPS[state.quality].trees,
        fog: [distance * 2.2, Math.max(distance * 14, 9000)],
        contour: [interval, state.contours ? blend(0.42, 0.2) : 0, 5],
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
      hazards: state.showHazards ? state.hazards : [],
    });

    state.stats.lastDrawMs = performance.now() - started;
    if (state.flight || backlog > 0 || shadesWaiting > 0 || Math.abs(shown(camera.state.x, camera.state.z) - camera.state.y) > 0.05) invalidate();
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
    setLight,
    setWeather: applyWeather,
    round: () => round,
    /* A fixed moment for Nu, so a harness can stand at any hour of the year. */
    setClock(date) { state.lightClock = date; refreshLight(); },
    heightAt: store.heightAt,
    stats: () => ({ ...state.stats, ...store.stats(), camera: { ...camera.state } }),
    fix: (latitude, longitude, accuracy = 4) => receiveFix({ latitude, longitude, accuracy }),
    worldOf: (latitude, longitude) => course.frame.toWorld(...gpsToLocal({ latitude, longitude }, course.geo)),
  };
}

start().catch(fail);
