/* The map session: every course as a light 3D map for a real round on the phone.
   ?bana=<slug>&karta=1, optionally &hal=<n>. Nothing here imports three.js or
   the player: it is a separate, far smaller program over the same course data.

   The frame only ever draws because something changed. There is no loop: a phone
   in a pocket between shots spends nothing on the map. */
import '../styles/course-map.css';
import { DEFAULT_BAG, gpsToLocal, nearestHole, parseBag, recommendClub } from '../engine/caddie.js';
import { compassName as windCompass, fetchWeather, weatherWord } from '../engine/weather.js';
import { isPhone } from '../shell/map-default.mjs';
import { distanceText } from '../shell/nearest-course.mjs';
import { detailedUrl, hubUrl } from '../shell/router.js';
import { MODES, rememberLaunch } from '../shell/settings-store.mjs';
import { frustumPlanes, selectPatches } from './map-lod.mjs';
import { createCamera, createFlight, EYE_FOV_DEGREES, MAX_DISTANCE, MAX_EYE_FOV_DEGREES, MAX_TILT, MIN_DISTANCE, MIN_EYE_FOV_DEGREES, MIN_TILT } from './map-camera.mjs';
import { loadMapCourse } from './map-course.mjs';
import { createGps, createScreenLock, downloadCourse, isDownloaded, offlineBytes, offlineTiles } from './map-field.mjs';
import { createMapRenderer } from './map-gl.mjs';
import { addPenalty, changeClub, closeHole, clubStats, correctClub, holeTally, isPutt, isPutter, learnedBag, lockShot, MEASURABLE_ACCURACY_METRES, openShot, parseHistory, reachOf, retakeShot, SAME_SPOT_METRES, setPutts, shotLength, storeHistory, surfaceAt } from './map-shots.mjs';
import { createClubWheel } from './map-wheel.mjs';
import { createDiary } from './map-diary.mjs';
import { createDisplay } from './map-display.mjs';
import { dateText, renderClubs, renderHoleHistory, renderRound, renderRounds } from './map-panels.mjs';
import { atTheTurn, courseLength, dropRound, dropRoundShots, holeHistory, holesScored, isRoundComplete, keepRound, parseRounds, roundIsOver, roundRecord, roundSummary, roundText, roundTrend, storeRounds } from './map-rounds.mjs';
import { createTeeWatch } from './map-follow.mjs';
import { attachGestures } from './map-gestures.mjs';
import { SHADE_BELOW_SUN } from './map-horizon.mjs';
import { AUTUMN_RAMPS, compassName, DEFAULT_LIGHT, lightByKey, lightNow, MAP_LIGHTS } from './map-light.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, hazardsAhead, placeOnProfile, playedPath, principalBearing, sideOfPlay, stripX, windWords, shotReading } from './map-measure.mjs';
import { createOverlay } from './map-overlay.mjs';
import { hitGreen, MAX_HANDICAP, MIN_HANDICAP, newRound, parseRound, roundTotals, scoreName, stablefordPoints, strokeKeys, strokesReceived } from './map-score.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { createMapPainter } from './map-paint.mjs';
import { createTileStore, fetchKeptFile } from './map-tiles.mjs';
import { catalogueFor, createTreeRules, loadTreeAtlases, speciesCount } from './map-trees.mjs';
import { buildGreenGrid, slopeColor, SLOPE_STEPS } from './map-greengrid.mjs';
import { landRecord, loadLandPictures, loadShores } from './map-land.mjs';

const params = new URLSearchParams(location.search);
const slug = params.get('bana');
const BASE = import.meta.env.BASE_URL;
const COURSE_TILT = 0.72;
/* The quick views of a hole. Each runs from where the ball is to the green, whichever
   way that points, so the picture stays lined up with the player as they walk. They
   differ in how far the camera leans: the hole as a map, the golfer's own eye behind
   the ball, and straight down. */
const QUICK_VIEWS = Object.freeze({ hole: { tilt: 0.9 }, behind: { tilt: 1.24 }, above: { tilt: 0.06 }, eye: { tilt: 1.5 } });
/* Min vy: standing at the ball, at a golfer's height, on the ground as it really is.
   The relief is drawn at its true height here: raised, a gentle rise becomes a wall. */
const TREE_REACH_PER_DISTANCE = 2.4, MOST_TREE_REACH_METRES = 6000, EYE_TREE_REACH_METRES = 3000;
const EYE_HEIGHT_METRES = 1.8, EYE_LOOK_METRES = 120, EYE_PITCH = 0.04, EYE_PITCH_LIMIT = 0.5;
const VIEW_KEY = 'banvy-map-view-v1';
const EYE_FOG_METRES = 700;
/* As low as the simulator's fly-in over a green: 26 m back and 21 m up. */
const GREEN_TILT = 0.89;
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
const SHOTS_KEY = 'banvy-map-shots-v1';
const ROUNDS_KEY = 'banvy-map-rounds-v1';
/* "Bara titta": a player looking at a course is not asked again for a while. */
const LOOK_KEY = 'banvy-map-looking-v1';
/* A lock this soon after ending a round plays on. Later, it is the day's next round. */
const PLAY_ON_MS = 30 * 60 * 1000;
/* Far enough from a locked ball that the player is on the way to the next one. */
const WHEEL_AWAY_METRES = 15;
const NOTE_MS = 9000, SAME_SPOT_MS = 12000;
/* About two lines of a hole's tip. */
const NOTE_CLAMP_LETTERS = 90;
/* A lock waiting for a good fix. Past this the player may have walked off. */
const LOCK_WAIT_MS = 10000;
/* A position older than this is where the player was. */
const FRESH_FIX_MS = 10000;
/* A shot left open this long was never finished, and must not end at the next round. */
const STALE_SHOT_MS = 3 * 60 * 60 * 1000;
const HOLE_KEY = 'banvy-map-hole-v1';
const GPS_KEY = 'banvy-map-gps-v1';
const HINT_KEY = 'banvy-map-hint-v1';
const HINT_LOCK_KEY = 'banvy-map-hint-lock-v1';
/* A tab killed in the pocket comes back to the same hole, with the GPS on. A round
   is over by the time this has passed. */
const RESUME_MS = 6 * 60 * 60 * 1000;
const PROMPT_MS = 40000;
const WEATHER_REFRESH_MS = 10 * 60 * 1000;
/* Older than this, a wind reading is history and has no business in a plays-like. */
const WEATHER_TRUSTED_MS = 3 * 60 * 60 * 1000;
/* The pulses run at about 30 frames a second, and only while the green is being
   looked at: a phone left on this view in a golf bag soon goes back to no frames. */
const GRID_FRAME_MS = 33, GRID_AWAKE_MS = 60000;
/* The simulator's pulse is 9 cm wide, under a pixel from where a phone sees a green. */
const PULSE_WIDTH_METRES = 0.0893, PULSE_LEAST_PIXELS = 2.6;
const OFF_COURSE_METRES = 450, FOLLOW_HOLE_METRES = 120;
/* A gap this long means the phone was away, and any number of tees may have gone by. */
const FIX_GAP_MS = 60000, LOST_HOLES_AT_MOST = 4;
/* A loose first fix must not choose a hole: nothing would correct it afterwards. */
const PLACING_ACCURACY_METRES = 20;
/* GPS wanders a few metres at a standstill. The picture stays put under that, or a
   player standing still would keep the map flying, and the battery with it. */
const REFRAME_METRES = 5;
/* A player standing still may send no fixes at all, so a tee is looked at again. */
const TEE_RECHECK_MS = 4000;
const GRAB_PIXELS = 28;
/* Further than this from a hole's line, a player is not on that hole. */
const ON_THE_STRIP_METRES = 150;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const metres = value => (Number.isFinite(value) ? `${Math.round(value)}` : '–');
const signed = value => `${value >= 0 ? '+' : '−'}${Math.round(Math.abs(value))} m`;
const toParText = value => (value === 0 ? '±0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`);

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
    <div class="map-hole" data-hole-bar>
      <button data-prev aria-label="Föregående hål">‹</button>
      <button class="map-hole-text" data-hole-text aria-label="Om hålet"><b data-hole-title></b><span data-hole-facts></span></button>
      <button data-next aria-label="Nästa hål">›</button>
    </div>
  </header>
  <div class="map-side">
    <button class="map-green" data-green aria-label="Avstånd till greenen. Tryck för att se greenen nära.">
      <span class="map-green-row"><i>Bak</i><b data-back-number>–</b></span>
      <span class="map-green-row map-green-mid"><i>Mitt</i><b data-mid-number>–</b></span>
      <span class="map-green-row"><i>Fram</i><b data-front-number>–</b></span>
      <small data-from></small>
    </button>
    <button class="map-wind" data-wind hidden aria-label="Vind och väder">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" data-wind-arrow><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/></svg>
      <b data-wind-speed></b>
    </button>
    <div class="map-wheel" data-wheel>
      <div class="map-wheel-band" aria-hidden="true"></div>
      <div class="map-wheel-list" data-wheel-list role="listbox" tabindex="0" aria-label="Klubba. Snurra för att välja, håll för att låsa slaget."></div>
    </div>
    <button class="map-sr" data-wheel-lock>Lås klubban och slaget här</button>
    <p class="map-wheel-hint" data-wheel-hint hidden><small data-hint-note></small><b data-hint-metres></b></p>
  </div>
  <section class="map-bottom">
    <div class="map-float">
      <button class="map-recentre" data-recentre hidden aria-label="Tillbaka till hålet"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
    </div>
    <div class="map-locked" data-locked hidden role="status">
      <b data-locked-text></b>
      <button data-locked-edit hidden>Ändra</button>
      <button data-locked-end hidden>Avsluta</button>
      <button data-locked-penalty>Plikt +1</button>
      <button data-locked-undo>Ångra</button>
    </div>
    <div class="map-locked map-same" data-same hidden>
      <b>Samma plats – vad hände?</b>
      <div>
        <button data-same-club>Bytte klubba</button>
        <button data-same-shot>Nytt slag</button>
        <button data-same-out>Omslag +1</button>
      </div>
    </div>
    <div class="map-prompt" data-prompt hidden role="group" aria-labelledby="map-prompt-title">
      <div class="map-prompt-head"><b id="map-prompt-title" data-prompt-title></b><button data-prompt-more>Fler val</button><button class="map-sheet-close" data-prompt-close aria-label="Inte nu">×</button></div>
      <div class="map-keys" data-prompt-keys></div>
    </div>
    <div class="map-reading" data-reading hidden>
      <div class="map-reading-text" data-reading-text></div>
      <button class="map-sheet-close" data-reading-close aria-label="Ta bort mätpunkten">×</button>
    </div>
    <div class="map-profile" data-profile>
      <svg viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path data-profile-fill fill="rgba(120,205,120,.32)"/><path data-profile-line fill="none" stroke="#a6efa0" stroke-width="2" vector-effect="non-scaling-stroke"/><rect data-profile-walked y="0" width="0" height="44" fill="rgba(12,24,18,.62)"/></svg>
      <i class="map-mark map-mark-aim" data-profile-aim hidden></i>
      <i class="map-mark map-mark-you" data-profile-you hidden></i>
      <span data-profile-text></span><span class="map-plays" data-profile-plays></span>
    </div>
    <div class="map-legend" data-legend hidden aria-label="Greenens lutning i procent">
      <span>Lutning %</span><div data-legend-steps></div>
    </div>
    <div class="map-views" data-views role="group" aria-label="Kameravy">
      <button data-overview aria-pressed="false" aria-label="Hela banan">Banan</button>
      <button data-view="hole" aria-pressed="true">Hela hålet</button>
      <button data-view="behind" aria-pressed="false" aria-label="Bakom bollen, mot greenen">Bakom</button>
      <button data-view="above" aria-pressed="false">Ovanifrån</button>
      <button data-view="eye" aria-pressed="false" aria-label="Min vy, från ögonhöjd mot greenen">Min vy</button>
      <button data-view="green" aria-pressed="false" aria-label="Greenen nära">Green</button>
    </div>
    <div class="map-tools">
      <button class="map-tool" data-gps aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 21s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.4" fill="currentColor"/></svg><span data-gps-label>GPS</span></button>
      <button class="map-tool" data-hole aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 21V4l11 4.5L7 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Hålet</span></button>
      <button class="map-tool" data-score aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9h6M9 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span data-score-label>Score</span></button>
      <button class="map-tool" data-menu aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Meny</span></button>
    </div>
  </section>
  <section class="map-sheet" data-score-sheet hidden aria-label="Scorekort">
    <div class="map-sheet-head">
      <button class="map-sheet-close" data-score-prev aria-label="Hålet före">‹</button>
      <b data-score-title></b>
      <button class="map-sheet-close" data-score-next aria-label="Hålet efter">›</button>
      <button class="map-sheet-close" data-close aria-label="Stäng">×</button>
    </div>
    <div class="map-keys map-keys-strokes" data-stroke-keys aria-label="Slag"></div>
    <p class="map-score-word" data-score-word></p>
    <div class="map-key-row"><span>Putt</span><div class="map-keys" data-putt-keys aria-label="Puttar"></div></div>
    <div class="map-key-row" data-fairway-row><span>Fairway</span><div class="map-keys" data-fairway-keys aria-label="Fairway"></div></div>
    <button class="map-action map-action-next" data-score-done></button>
    <p class="map-score-sum" data-score-sum></p>
    <p class="map-score-stats" data-score-stats></p>
    <div class="map-card" data-card></div>
    <div class="map-stepper map-handicap"><span>Spelhandicap</span><button data-handicap-less aria-label="Sänk spelhandicap">−</button><output data-handicap>–</output><button data-handicap-more aria-label="Höj spelhandicap">+</button></div>
    <div class="map-actions">
      <button class="map-action" data-pick-up>Stryk hålet</button>
      <button class="map-action" data-end-round>Avsluta rundan</button>
    </div>
  </section>
  <section class="map-sheet map-sheet-tall" data-round-sheet hidden aria-label="Rundan">
    <div class="map-sheet-head"><button class="map-sheet-close" data-round-back hidden aria-label="Tillbaka till mina rundor">‹</button><b data-round-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div data-round-body></div>
    <div class="map-actions">
      <button class="map-action map-action-next" data-round-new>Ny runda</button>
      <button class="map-action" data-round-share>Dela rundan</button>
      <button class="map-action map-action-quiet" data-round-drop hidden>Ta bort rundan</button>
    </div>
  </section>
  <section class="map-sheet map-sheet-tall" data-rounds-sheet hidden aria-label="Mina rundor">
    <div class="map-sheet-head"><button class="map-sheet-close" data-rounds-back aria-label="Tillbaka till menyn">‹</button><b>Mina rundor</b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div data-rounds-body></div>
  </section>
  <section class="map-sheet map-sheet-tall map-start" data-start-sheet hidden aria-label="Starta rundan">
    <div class="map-sheet-head"><b data-start-title></b><button class="map-sheet-close" data-close aria-label="Bara titta på banan">×</button></div>
    <p class="map-start-facts" data-start-facts></p>
    <div data-start-tee-section>
      <h3>Tee</h3>
      <div class="map-chips" data-start-tees></div>
    </div>
    <div class="map-stepper"><span>Spelhandicap</span><button data-start-less aria-label="Sänk spelhandicap">−</button><output data-start-handicap>–</output><button data-start-more aria-label="Höj spelhandicap">+</button></div>
    <button class="map-action map-action-next map-start-go" data-start-go>Starta rundan</button>
    <button class="map-note-more map-start-look" data-close>Bara titta på banan</button>
  </section>
  <section class="map-sheet" data-light-sheet hidden aria-label="Ljus">
    <div class="map-sheet-head"><button class="map-sheet-close" data-light-back aria-label="Tillbaka till menyn">‹</button><b>Ljus</b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div class="map-lights" data-lights></div>
  </section>
  <section class="map-sheet" data-hole-sheet hidden aria-label="Hålet">
    <div class="map-sheet-head"><b data-hole-sheet-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div data-hazard-section>
      <h3>Hinder framåt</h3>
      <ul class="map-hazards" data-hazard-list></ul>
    </div>
    <div data-shots-section hidden>
      <h3>Dina slag</h3>
      <ol class="map-shots" data-shots></ol>
      <p class="map-shots-hint" data-shots-hint hidden>Fel klubba? Tryck på slaget.</p>
    </div>
    <div data-history-section hidden>
      <h3>Så brukar du spela hålet</h3>
      <ul class="map-facts" data-history></ul>
    </div>
    <p class="map-note is-clamped" data-note hidden></p>
    <button class="map-note-more" data-note-more hidden>Läs mer</button>
    <h3>Alla hål</h3>
    <div class="map-holes" data-holes></div>
  </section>
  <section class="map-sheet" data-clubs-sheet hidden aria-label="Mina klubbor">
    <div class="map-sheet-head"><button class="map-sheet-close" data-clubs-back aria-label="Tillbaka till menyn">‹</button><b>Mina klubbor</b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <p class="map-note" data-clubs-note></p>
    <ul class="map-clubs" data-clubs></ul>
  </section>
  <section class="map-sheet map-menu" data-menu-sheet hidden aria-label="Meny">
    <div class="map-sheet-head"><b data-menu-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div data-tee-section>
      <h3>Tee</h3>
      <div class="map-chips" data-tees></div>
    </div>
    <h3>Spel</h3>
    <button class="map-row map-row-next" data-rounds-open><span>Mina rundor</span><span class="map-row-value" data-rounds-count></span></button>
    <button class="map-row map-row-next" data-clubs-open><span>Mina klubbor</span><span class="map-row-value" data-clubs-count></span></button>
    <h3>Visning</h3>
    <label class="map-row"><span>Solläge<small>Ljusa paneler för starkt solljus</small></span><input type="checkbox" role="switch" data-sun></label>
    <label class="map-row"><span>Större text</span><input type="checkbox" role="switch" data-large></label>
    <label class="map-row"><span>Hjulet till vänster</span><input type="checkbox" role="switch" data-left></label>
    <h3>Kartan</h3>
    <button class="map-row map-row-next" data-light aria-expanded="false"><span>Ljus</span><span class="map-row-value" data-light-name></span></button>
    <label class="map-row"><span>Hinderavstånd</span><input type="checkbox" role="switch" data-hazards></label>
    <label class="map-row"><span>Höjdkurvor</span><input type="checkbox" role="switch" data-contours></label>
    <div class="map-row"><span>Höjdskala</span><div class="map-chips" data-reliefs></div></div>
    <h3>Banan</h3>
    <div class="map-actions">
      <button class="map-action" data-download>Spara banan</button>
      <button class="map-action" data-diary>Spara provrundans logg</button>
      <a class="map-action" data-full>Detaljerad 3D</a>
      <a class="map-action" href="${hubUrl(MODES.map.route)}">Alla banor</a>
    </div>
  </section>
  <div class="map-status" data-status hidden role="status"></div>`;
document.body.append(root);

const $ = selector => root.querySelector(selector);
const ui = {
  hole: $('[data-hole-title]'), facts: $('[data-hole-facts]'),
  back: $('[data-back-number]'), mid: $('[data-mid-number]'), front: $('[data-front-number]'), from: $('[data-from]'),
  reading: $('[data-reading]'), status: $('[data-status]'),
  gps: $('[data-gps]'), gpsLabel: $('[data-gps-label]'), light: $('[data-light]'), lightName: $('[data-light-name]'), menu: $('[data-menu]'),
  score: $('[data-score]'), scoreLabel: $('[data-score-label]'), holeTool: $('[data-hole]'), holeText: $('[data-hole-text]'), holeBar: $('[data-hole-bar]'),
  holeSheet: $('[data-hole-sheet]'), holeSheetTitle: $('[data-hole-sheet-title]'), hazardSection: $('[data-hazard-section]'), hazardList: $('[data-hazard-list]'),
  recentre: $('[data-recentre]'),
  prompt: $('[data-prompt]'), promptTitle: $('[data-prompt-title]'), promptKeys: $('[data-prompt-keys]'),
  readingText: $('[data-reading-text]'), legend: $('[data-legend]'), views: $('[data-views]'),
  wheel: $('[data-wheel]'), wheelHint: $('[data-wheel-hint]'), hintNote: $('[data-hint-note]'), hintMetres: $('[data-hint-metres]'),
  promptMore: $('[data-prompt-more]'), holeNoteMore: $('[data-note-more]'), locked: $('[data-locked]'), lockedText: $('[data-locked-text]'), lockedPenalty: $('[data-locked-penalty]'), lockedEdit: $('[data-locked-edit]'), same: $('[data-same]'),
  clubsSheet: $('[data-clubs-sheet]'), clubs: $('[data-clubs]'), clubsNote: $('[data-clubs-note]'), clubsCount: $('[data-clubs-count]'),
  shotsSection: $('[data-shots-section]'), shotList: $('[data-shots]'), shotsHint: $('[data-shots-hint]'),
  scoreSheet: $('[data-score-sheet]'), scoreTitle: $('[data-score-title]'), strokeKeys: $('[data-stroke-keys]'), puttKeys: $('[data-putt-keys]'),
  fairwayRow: $('[data-fairway-row]'), fairwayKeys: $('[data-fairway-keys]'), scoreDone: $('[data-score-done]'), scoreStats: $('[data-score-stats]'),
  scoreWord: $('[data-score-word]'), scoreSum: $('[data-score-sum]'), card: $('[data-card]'), handicap: $('[data-handicap]'),
  pickUp: $('[data-pick-up]'), endRound: $('[data-end-round]'), hazards: $('[data-hazards]'),
  roundSheet: $('[data-round-sheet]'), roundTitle: $('[data-round-title]'), roundBody: $('[data-round-body]'), roundBack: $('[data-round-back]'), roundNew: $('[data-round-new]'), roundDrop: $('[data-round-drop]'), lockedEnd: $('[data-locked-end]'),
  roundsSheet: $('[data-rounds-sheet]'), roundsBody: $('[data-rounds-body]'), roundsCount: $('[data-rounds-count]'),
  startSheet: $('[data-start-sheet]'), startTitle: $('[data-start-title]'), startFacts: $('[data-start-facts]'), startTeeSection: $('[data-start-tee-section]'), startTees: $('[data-start-tees]'), startHandicap: $('[data-start-handicap]'),
  historySection: $('[data-history-section]'), history: $('[data-history]'),
  sun: $('[data-sun]'), large: $('[data-large]'), left: $('[data-left]'),
  wind: $('[data-wind]'), windArrow: $('[data-wind-arrow]'), windSpeed: $('[data-wind-speed]'),
  lightSheet: $('[data-light-sheet]'), menuSheet: $('[data-menu-sheet]'), lights: $('[data-lights]'),
  menuTitle: $('[data-menu-title]'), note: $('[data-note]'), holes: $('[data-holes]'),
  teeSection: $('[data-tee-section]'), tees: $('[data-tees]'), reliefs: $('[data-reliefs]'), contours: $('[data-contours]'),
  download: $('[data-download]'), full: $('[data-full]'),
  overview: $('[data-overview]'), green: $('[data-green]'),
  profile: $('[data-profile]'), profileLine: $('[data-profile-line]'), profileFill: $('[data-profile-fill]'), profileText: $('[data-profile-text]'), profilePlays: $('[data-profile-plays]'),
  profileWalked: $('[data-profile-walked]'), profileYou: $('[data-profile-you]'), profileAim: $('[data-profile-aim]'),
};

const display = createDisplay(root, { read: key => savedText(key, null), write: remember });

/* The column and the foot, fitted to this phone. A phone's height says little by itself:
   a notch and a home bar take over 90 px from a screen that looks tall. So the column is
   measured against what is really left above the strip, and gives way a step at a time:
   fewer rows on the wheel, a tighter column with the walking hint beside it, then the
   height strip. Where a note and the way-back button would reach the column they stand beside it,
   since the wheel is what a player is using just then. */
const STRIP_PIXELS = 68, HINT_PIXELS = 60, TWO_ROWS_PIXELS = 118;
const sideways = matchMedia('(orientation: landscape) and (max-height: 520px)');
function fitLayout() {
  root.classList.remove('is-compact', 'is-stripless', 'is-tight');
  ui.wheel.style.removeProperty('--rows');
  if (sideways.matches) return;
  /* Fitted for the column at its fullest, not as it is this moment: the wind arrives after
     the first picture, and the numbers go on a green and over the whole course. */
  const onGreen = ui.green.classList.contains('is-on');
  const held = [[ui.wind, ui.wind.hidden], [ui.green, ui.green.hidden]];
  for (const [element] of held) element.hidden = false;
  ui.green.classList.remove('is-on');
  const room = () => {
    const compact = root.classList.contains('is-compact');
    const strip = root.classList.contains('is-stripless') ? 0 : STRIP_PIXELS;
    return ui.views.getBoundingClientRect().top - 8 - strip - ui.wheel.getBoundingClientRect().bottom - (compact ? 6 : HINT_PIXELS);
  };
  const steps = [
    () => ui.wheel.style.setProperty('--rows', '5'),
    () => ui.wheel.style.setProperty('--rows', '3'),
    () => root.classList.add('is-compact'),
    () => root.classList.add('is-stripless'),
  ];
  for (const step of steps) {
    step();
    if (room() >= 0) break;
  }
  root.classList.toggle('is-tight', room() < TWO_ROWS_PIXELS);
  for (const [element, hidden] of held) element.hidden = hidden;
  ui.green.classList.toggle('is-on', onGreen);
}

let statusTimer = 0;
function status(text, hold = 3200, low = false) {
  ui.status.textContent = text;
  ui.status.hidden = false;
  ui.status.classList.toggle('is-low', low);
  clearTimeout(statusTimer);
  if (hold) statusTimer = setTimeout(() => { ui.status.hidden = true; }, hold);
}

function savedQuality() {
  const asked = Number(params.get('mapquality'));
  if (params.has('mapquality') && QUALITY_STEPS[asked]) return asked;
  try { return Math.min(QUALITY_STEPS.length - 1, Number(localStorage.getItem(QUALITY_KEY)) || 0); } catch { return 0; }
}

function localStorageOrNull() {
  try { return localStorage; } catch { return null; }
}

function savedText(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* it holds for this visit */ }
}

/* A value that holds only as long as a round could still be going on. */
function savedFresh(key) {
  try {
    const { value, at } = JSON.parse(localStorage.getItem(key));
    return Date.now() - at < RESUME_MS ? value : null;
  } catch { return null; }
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
  /* the start menu's "Fortsätt" brings the golfer back here, in this mode */
  rememberLaunch(localStorageOrNull(), slug, 'map');

  const rules = createTreeRules(course);
  const treeFiles = rules.catalogue.species.slice(0, speciesCount(slug)).flatMap(entry => [entry.colour, entry.normal])
    .map(entry => ({ ...entry, href: assetUrl(entry.file) }));
  const landFiles = landRecord(course.ground.groundId);
  /* Each lake out to its ground's own shore (map-shores.mjs); ?waterreach=0 is the before. */
  const shoresWanted = params.get('waterreach') !== '0';
  const landExtras = landFiles ? [landFiles.water, landFiles.forest, ...(shoresWanted && landFiles.shores ? [landFiles.shores.picture, landFiles.shores.lakes] : [])]
    .map(entry => ({ ...entry, href: assetUrl(entry.file) })) : [];
  const [atlases, land, shores] = await Promise.all([treesLoaded,
    params.get('land') === '0' ? null : loadLandPictures(landFiles, file => fetchKeptFile(assetUrl(file))),
    shoresWanted ? loadShores(landFiles, file => fetchKeptFile(assetUrl(file))) : null]);

  const groundCanvas = $('.map-ground');
  let store = null;
  const painter = createMapPainter(course, atlases, land, shores);
  const renderer = createMapRenderer(groundCanvas, {
    onLost: () => store?.forgetGpu(),
    /* A tile that arrived while the context was gone went nowhere. */
    onRestored: () => {
      store?.forgetGpu();
      invalidate();
    },
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
    hole: clamp(Number(params.get('hal')) || savedFresh(`${HOLE_KEY}:${course.slug}`) || 1, 1, course.holes.length),
    exaggeration: 2,
    tee: savedTee(course),
    player: null,
    target: null,
    follow: true,
    view: QUICK_VIEWS[savedText(VIEW_KEY, 'hole')] ? savedText(VIEW_KEY, 'hole') : 'hole',
    /* Standing in Min vy, with the relief the map was using and where the eye is turned. */
    atEye: false,
    mapRelief: null,
    eyeTurn: 0,
    eyePitch: EYE_PITCH,
    /* The hole being played, which stays put while a player looks at another. */
    playing: null,
    /* A tee change of this session, which ends the first tee's special case. */
    started: false,
    /* A hole stood on while the player was busy with something else. */
    owed: null,
    located: false,
    /* The fixes stopped, and the next good one has to say where the player went. */
    lost: false,
    /* The player chose this hole. A phone waking up does not overrule that. */
    handPicked: false,
    lastFixAt: 0,
    framedFrom: null,
    clockAhead: 0,
    /* The player has moved the view off the framed hole, or stands looking at a green. */
    viewMoved: false,
    greenView: false,
    greenGrid: null,
    gridRead: false,
    gridAwake: 0,
    draggingTarget: false,
    numbersDirty: false,
    /* The wheel rests on the suggestion until a finger chooses. */
    wheelAuto: true,
    /* A lock made by the ball: the wheel stays on that club until the player walks on. */
    justLocked: false,
    pendingLock: null,
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
  state.playing = state.hole;
  const diary = createDiary({ read: key => savedText(key, null), write: remember });
  diary.add('open', course.slug);
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
    /* Read off the screen: a notch and a home bar move all of these. */
    const under = $('.map-top').getBoundingClientRect().bottom;
    const foot = height - ui.views.getBoundingClientRect().top;
    const room = width > height
      ? { top: Math.max(74, under + 8), bottom: Math.max(150, foot + 76), left: 100, right: 138 }
      /* Room for the strip and one note under the shot in hand, so a passing note never
         lies on the player's own dot. */
      : { top: Math.max(78, under + 12), bottom: Math.max(250, foot + 150), left: 34, right: display.get('sun') ? 106 : 96 };
    return display.get('left') ? { ...room, left: room.right, right: room.left } : room;
  }

  function flyTo(view, duration = 800) {
    const { x, y, z, distance, bearing, tilt, fov } = camera.state;
    state.flight = createFlight({ x, y, z, distance, bearing, tilt, fov }, view, reducedMotion ? 0 : duration);
    state.flightStart = performance.now();
    invalidate();
  }

  /* Frames the shot in hand: from where the ball is to the green, whichever way
     that points, with play running up the screen. */
  let gridTimer = 0;
  function leaveGreen() {
    state.greenView = false;
    state.greenGrid = null;
    state.gridRead = false;
    clearTimeout(gridTimer);
    renderer.uploadGreenGrid(null);
  }

  /* Into or out of Min vy, which is the one view that changes more than the camera. */
  function standAtEye(wanted) {
    if (wanted === state.atEye) return;
    state.atEye = wanted;
    const relief = wanted ? 1 : state.mapRelief;
    if (wanted) state.mapRelief = state.exaggeration;
    camera.state.y *= relief / state.exaggeration;
    state.exaggeration = relief;
    camera.setLens(camera.state.fov, wanted);
    if (!wanted) state.mapRelief = null;
  }

  /* The view from a point: the camera orbits a point straight ahead of the eye, on the
     line of sight, so the eye itself stands exactly where it should. */
  function eyeView(from, bearing, pitch, fov = EYE_FOV_DEGREES) {
    const look = EYE_LOOK_METRES;
    const y = groundY(from[0], from[1]) * state.exaggeration + EYE_HEIGHT_METRES - Math.tan(pitch) * look;
    return {
      x: from[0] + Math.sin(bearing) * look,
      y,
      z: from[1] - Math.cos(bearing) * look,
      distance: look / Math.cos(pitch),
      bearing,
      tilt: Math.PI / 2 - pitch,
      fov,
    };
  }
  const eyeBearing = from => bearingOf(from, hole().green.c) + state.eyeTurn;
  /* Look around from where the player stands. */
  function lookAround(turn, lean) {
    state.eyeTurn += turn;
    state.eyePitch = clamp(state.eyePitch + lean, -EYE_PITCH_LIMIT, EYE_PITCH_LIMIT);
    state.viewMoved = true;
    Object.assign(camera.state, eyeView(origin(), eyeBearing(origin()), state.eyePitch, camera.state.fov));
    camera.update();
    invalidate();
  }

  function frameHole(duration = 800) {
    state.viewMoved = false;
    leaveGreen();
    state.framedFrom = origin();
    standAtEye(state.view === 'eye');
    if (state.atEye) {
      state.eyeTurn = 0;
      state.eyePitch = EYE_PITCH;
      flyTo(eyeView(origin(), eyeBearing(origin()), EYE_PITCH), duration);
      return;
    }
    camera.setLens();
    const h = hole(), from = origin();
    const rest = state.player?.onCourse ? [from] : [from, ...h.line.slice(1)];
    const points = [...rest, ...h.green.ring.filter((_, i) => i % 3 === 0), h.green.c].map(lifted);
    /* Room above the flag, which stands taller than the green it marks. */
    points.push([h.pin[0], shown(h.pin[0], h.pin[1]) + camera.state.distance * 0.03, h.pin[1]]);
    const saved = { ...camera.state };
    const view = camera.fit(points, {
      bearing: bearingOf(from, h.green.c), tilt: QUICK_VIEWS[state.view].tilt, insets: insets(),
      minDistance: state.player?.onCourse ? 150 : 200,
      pivot: shown,
    });
    Object.assign(camera.state, saved);
    camera.update();
    flyTo(view, duration);
  }

  /* The green close to, on the line it is played along, for the greengrid to read. */
  function frameGreen(duration = 700) {
    const h = hole(), from = origin();
    leaveGreen();
    standAtEye(false);
    camera.setLens();
    state.greenView = true;
    state.viewMoved = false;
    state.follow = false;
    const points = [...h.green.ring, h.green.c].map(lifted);
    const saved = { ...camera.state };
    const view = camera.fit(points, { bearing: bearingOf(from, h.green.c), tilt: GREEN_TILT, insets: insets(), minDistance: 60, pivot: shown });
    Object.assign(camera.state, saved);
    camera.update();
    flyTo(view, duration);
    refreshNumbers();
  }

  function frameCourse(duration = 900) {
    state.viewMoved = false;
    leaveGreen();
    standAtEye(false);
    camera.setLens();
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
    const onTheGreen = Boolean(state.player?.onCourse) && state.mode === 'hole' && surfaceAt(state.player.point, h) === 'green';
    ui.green.classList.toggle('is-on', onTheGreen);
    ui.mid.textContent = onTheGreen ? 'På green' : metres(centre);
    ui.front.textContent = edge + metres(front ?? centre);
    ui.from.textContent = state.player?.onCourse ? 'från dig' : 'från tee';
    const spoken = onTheGreen ? 'Du är på greenen.' : `Till greenen ${ui.from.textContent}: fram ${ui.front.textContent}, mitt ${ui.mid.textContent}, bak ${ui.back.textContent} meter.`;
    ui.green.setAttribute('aria-label', `${spoken} Tryck för att ${state.greenView ? 'gå tillbaka till hålet' : 'se greenen nära'}.`);
    ui.hole.textContent = state.mode === 'course' ? course.name : `Hål ${h.n}`;
    const length = tee().metres ?? h.lengths[0];
    /* A fix redraws an open sheet, and a button replaced under a finger loses its tap. */
    if (!ui.menuSheet.hidden && !state.pressingSheet) refreshMenu();
    if (!ui.holeSheet.hidden && !state.pressingSheet) refreshHole();
    const percent = value => `${(value * 100).toFixed(1).replace('.', ',')} %`;
    ui.facts.textContent = state.greenGrid
      ? `Snitt ${percent(state.greenGrid.mean)} · max ${percent(state.greenGrid.max)}`
      : state.mode === 'course'
      ? `${course.holes.length} hål · par ${course.par}`
      : [`Par ${h.par}`, length ? `${length} m` : null, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    ui.green.hidden = state.mode === 'course';
    ui.profile.hidden = state.mode === 'course' || state.greenView || onTheGreen;
    ui.legend.hidden = !state.greenView;
    ui.overview.setAttribute('aria-pressed', String(state.mode === 'course'));

    if (state.target && state.mode === 'hole') {
      const shot = shotReading(from, state.target, store.heightAt, air());
      const rest = shotReading(state.target, h.green.c, store.heightAt, air());
      const advice = recommendClub(shot.plays ?? shot.distance, playingBag);
      const parts = [`<b>${metres(shot.distance)} m</b>`];
      if (shot.rise !== null) parts.push(`spelas ${metres(shot.plays)} m`);
      if (advice?.club) parts.push(`<em>${advice.club.name}</em>`);
      parts.push(`${metres(rest.distance)} m kvar`);
      if (shot.rise !== null) parts.push(signed(shot.rise));
      parts.push(...windWords(shot));
      ui.readingText.innerHTML = parts.map(part => `<span>${part}</span>`).join('');
      ui.reading.hidden = false;
    } else ui.reading.hidden = true;

    refreshProfile();
    refreshFloat();
    refreshWheel();
  }

  /* The two buttons over the map's corner: back to the shot, and a shot walked off. */
  function refreshFloat() {
    const walking = gps.active;
    const say = (element, value) => { if (element.ariaLabel !== value) element.setAttribute('aria-label', value); };
    /* Looking at another hole counts as well: a quick view follows the player, but
       on the hole on screen. */
    const elsewhere = state.player?.onCourse && state.hole !== state.playing;
    ui.recentre.hidden = state.mode !== 'hole' || !(state.viewMoved || state.greenView || elsewhere || (walking && !state.follow));
    say(ui.recentre, walking ? 'Tillbaka till min position' : 'Tillbaka till hålet');
    /* Kept in the layout, so the wheel keeps its place while the course is shown. */
    ui.wheel.classList.toggle('is-away', state.mode !== 'hole');
    const shownView = state.mode === 'course' ? null : state.greenView ? 'green' : state.view;
    for (const button of ui.views.querySelectorAll('[data-view]')) {
      const pressed = String(button.dataset.view === shownView);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    }
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
    ui.profileText.textContent = flat ? 'Plant till green' : `${Math.round(Math.abs(rise))} m ${rise > 0 ? 'uppför' : 'nedför'} till green`;
    ui.profilePlays.textContent = plays ? `Spelas ${metres(plays)} m` : '';
    ui.profile.setAttribute('aria-label', you
      ? `Höjdprofil. Du är ${Math.round(you.along)} av ${Math.round(line.distance)} meter in på hålet.`
      : `Höjdprofil över hålet, ${Math.round(line.distance)} meter.`);
  }

  function goHole(number, { fly = true } = {}) {
    const left = state.hole;
    state.hole = clamp(number, 1, course.holes.length);
    state.scoreHole = null;
    state.wheelAuto = true;
    state.justLocked = false;
    leaveGreen();
    refreshTrail();
    remember(`${HOLE_KEY}:${course.slug}`, JSON.stringify({ value: state.hole, at: Date.now() }));
    /* On to the next hole by hand, in a round: the one left behind still wants its
       score. With the GPS on a tap only looks ahead, and the tee does the asking. */
    if (state.hole === left + 1 && !gps.active && roundTotals(round, course.holes).played) askScore(left);
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
  const clock = () => performance.now() + state.clockAhead;
  const teeWatch = createTeeWatch();
  let teeTimer = 0;
  /* Mid-sentence on the card, or looking at something else: the tee can wait. */
  const busyElsewhere = () => state.mode === 'course' || state.greenView || sheets.some(([sheet]) => !sheet.hidden);

  function moveOn(number) {
    const begun = state.started;
    finishOpenShot();
    diary.add('tee', number);
    state.follow = true;
    state.playing = number;
    state.started = true;
    state.owed = null;
    state.handPicked = false;
    goHole(number);
    /* The hole just before this tee is the one a score is owed for. */
    if (begun) askScore(number === 1 ? course.holes.length : number - 1);
    status(`Hål ${number}`, 2500);
  }

  function checkTee() {
    clearTimeout(teeTimer);
    const { player } = state;
    if (!player?.onCourse) return;
    const number = teeWatch.update({
      point: player.point,
      accuracy: player.accuracy,
      now: clock(),
      holes: course.holes,
      shown: state.hole,
      playing: state.playing,
      fresh: !state.started && !roundTotals(round, course.holes).played,
    });
    if (teeWatch.standingOn(state.hole)) state.playing = state.hole;
    if (number !== null) state.owed = number;
    if (teeWatch.waiting || state.owed !== null) teeTimer = setTimeout(checkTee, TEE_RECHECK_MS);
    if (state.owed === null || busyElsewhere()) return;
    moveOn(state.owed);
  }

  function receiveFix(coords) {
      const [x, z] = gpsToLocal(coords, course.geo);
      const point = course.frame.toWorld(x, z);
      const nearby = nearestHole(point, course.holes, state.hole);
      const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : 0;
      const onCourse = Boolean(nearby) && nearby.distance <= OFF_COURSE_METRES;
      diary.fix(accuracy);
      const first = !state.player?.onCourse;
      const now = clock();
      state.lastCoords = coords;
      const known = state.located;
      if (now - state.lastFixAt > FIX_GAP_MS) state.lost = true;
      state.lastFixAt = now;
      state.player = { point, accuracy: clamp(accuracy, 3, 60), onCourse, at: performance.now() + state.clockAhead };
      if (onCourse) remember(`${GPS_KEY}:${course.slug}`, JSON.stringify({ value: true, at: Date.now() }));
      if (!onCourse) {
        status(nearby ? `${distanceText(nearby.distance)} från närmaste hål` : 'Positionen ligger utanför banan');
        refreshNumbers();
        invalidate();
        return;
      }
      /* The first good fix finds the hole, so a map opened mid-round lands on it, and so
         does the first after the phone was put away. Between those only the next tee
         moves it (map-follow.mjs). */
      const placing = (!state.located || state.lost) && accuracy <= PLACING_ACCURACY_METRES;
      const count = course.holes.length;
      /* After a gap only forward, and a few holes at most: the ball can be in another
         hole's fairway as easily as the player can have walked there. */
      const onward = (nearby.hole - state.playing + count) % count;
      const allowed = known ? onward >= 1 && onward <= LOST_HOLES_AT_MOST && !state.handPicked : state.follow;
      if (placing) {
        state.located = true;
        state.lost = false;
      }
      if (placing && nearby.hole === state.hole) state.playing = state.hole;
      if (placing && allowed && nearby.distance <= FOLLOW_HOLE_METRES && nearby.hole !== state.hole) {
        if (state.started) moveOn(nearby.hole);
        else {
          state.playing = nearby.hole;
          goHole(nearby.hole);
        }
      } else {
        refreshNumbers();
        const from = state.framedFrom;
        if (state.follow && (!from || Math.hypot(point[0] - from[0], point[1] - from[1]) > REFRAME_METRES)) frameHole(first ? 900 : 500);
      }
      checkTee();
      if (state.pendingLock && accuracy <= PLACING_ACCURACY_METRES) lockClub(state.pendingLock.club);
      ui.gpsLabel.textContent = `±${Math.max(1, Math.round(accuracy))} m`;
      invalidate();
  }
  const gps = createGps({
    onFix: receiveFix,
    onFailure(message) {
      diary.add('gps-failed', message);
      status(message);
      if (!gps.active) stopGps();
    },
  });

  function stopGps() {
    gps.stop();
    screenLock.release();
    state.player = null;
    state.owed = null;
    state.pendingLock = null;
    ui.gpsLabel.textContent = 'GPS';
    ui.gps.setAttribute('aria-pressed', 'false');
    refreshNumbers();
    invalidate();
  }

  function startGps() {
    gps.start();
    screenLock.hold();
    state.follow = true;
    ui.gpsLabel.textContent = 'Söker…';
    ui.gps.setAttribute('aria-pressed', 'true');
  }

  ui.gps.onclick = () => {
    if (gps.active) {
      stopGps();
      remember(`${GPS_KEY}:${course.slug}`, '');
      return;
    }
    startGps();
  };

  /* Back to the shot in hand: to where the player is, or to the hole. */
  function recentre() {
    state.follow = true;
    /* The hole being played, unless the player has plainly walked onto the one on
       screen, as after skipping a hole and choosing it by hand. */
    if (state.player?.onCourse) {
      const inPlay = holeNumberInPlay();
      state.playing = inPlay;
      state.handPicked = false;
      if (inPlay !== state.hole) {
        goHole(inPlay);
        return;
      }
    }
    state.handPicked = false;
    frameHole(500);
    refreshNumbers();
  }
  ui.recentre.onclick = recentre;

  $('[data-legend-steps]').replaceChildren(...SLOPE_STEPS.map(({ label, slope }) => {
    const step = document.createElement('span');
    step.textContent = label;
    step.style.background = `rgb(${slopeColor(slope).map(channel => Math.round(channel * 255))})`;
    return step;
  }));

  /* A tap also brings the view back after a finger has moved it, as the round button
     does, and it keeps following the player from then on. */
  for (const button of ui.views.querySelectorAll('[data-view]')) {
    button.onclick = () => {
      const { view } = button.dataset;
      state.mode = 'hole';
      if (view === 'green') {
        if (!state.greenView) frameGreen();
        return;
      }
      state.view = view;
      remember(VIEW_KEY, view);
      /* The same hole from another angle: a view never changes the hole. */
      state.follow = true;
      frameHole(500);
      refreshNumbers();
    };
  }

  ui.green.onclick = () => {
    if (state.mode !== 'hole') return;
    if (state.greenView) recentre(); else frameGreen();
  };

  /* ---- controls ---- */
  let bag = DEFAULT_BAG;
  try { bag = parseBag(localStorage.getItem(BAG_KEY)) ?? DEFAULT_BAG; } catch { bag = DEFAULT_BAG; }

  /* A hole chosen by hand is the player's say, whatever tee they stand on. */
  const pickHole = number => {
    diary.add('picked', number);
    state.follow = false;
    state.handPicked = true;
    teeWatch.manual();
    state.owed = null;
    goHole(number);
  };
  const stepHole = direction => pickHole(((state.hole - 1 + direction + course.holes.length) % course.holes.length) + 1);
  $('[data-prev]').onclick = () => stepHole(-1);
  $('[data-next]').onclick = () => stepHole(1);
  /* A sideways swipe along the header turns the page, as on a watch. */
  let swipeFrom = null, swiped = false;
  ui.holeBar.addEventListener('pointerdown', event => { swipeFrom = event.clientX; swiped = false; });
  ui.holeBar.addEventListener('pointerup', event => {
    if (swipeFrom === null) return;
    const travel = event.clientX - swipeFrom;
    swipeFrom = null;
    if (Math.abs(travel) < 44) return;
    swiped = true;
    stepHole(travel < 0 ? 1 : -1);
  });
  ui.holeBar.addEventListener('pointercancel', () => { swipeFrom = null; });
  ui.holeBar.addEventListener('click', event => {
    if (!swiped) return;
    swiped = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  ui.overview.onclick = () => {
    if (state.mode === 'course') { state.follow = Boolean(state.player); goHole(state.hole); } else showCourse();
  };
  /* ---- the sheets ---- */
  const sheets = [[ui.lightSheet, ui.menu], [ui.menuSheet, ui.menu], [ui.clubsSheet, ui.menu], [ui.roundsSheet, ui.menu], [ui.scoreSheet, ui.score], [ui.roundSheet, ui.score], [ui.holeSheet, ui.holeTool], [ui.startSheet, null]];
  for (const [sheet] of sheets) {
    sheet.setAttribute('role', 'dialog');
    sheet.tabIndex = -1;
  }
  /* Focus goes into a sheet and back to where it was, so a screen reader or a keyboard
     never has to find its way across the whole map. */
  let cameFrom = null;
  function showSheet(sheet) {
    /* A tip by the thumb is about the map, and would lie across the sheet. */
    if (sheet && ui.status.classList.contains('is-low')) ui.status.hidden = true;
    const wasStart = !ui.startSheet.hidden, wasOpen = sheets.some(([each]) => !each.hidden);
    for (const [each] of sheets) each.hidden = !(each === sheet && each.hidden);
    for (const [, button] of sheets) button?.setAttribute('aria-expanded', String(sheets.some(([each, owner]) => owner === button && !each.hidden)));
    const open = sheets.find(([each]) => !each.hidden)?.[0] ?? null;
    if (open) {
      if (!wasOpen) cameFrom = document.activeElement;
      /* A sheet keeps its scroll while hidden, and always opens at its top. */
      open.scrollTop = 0;
      open.focus({ preventScroll: true });
      diary.add('sheet', open.getAttribute('aria-label'));
    } else {
      cameFrom?.focus?.({ preventScroll: true });
      cameFrom = null;
    }
    if (wasStart && ui.startSheet.hidden) {
      if (!round.begunAt || round.endedAt) remember(LOOK_KEY, JSON.stringify({ value: true, at: Date.now() }));
      firstTip();
    }
    if (sheet !== ui.scoreSheet) state.fromRound = false;
  }
  root.addEventListener('pointerdown', event => { state.pressingSheet = Boolean(event.target.closest('.map-sheet')); }, true);
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { state.pressingSheet = false; }, true);
  ui.light.onclick = () => showSheet(ui.lightSheet);
  $('[data-light-back]').onclick = () => { refreshMenu(); showSheet(ui.menuSheet); };
  ui.menu.onclick = () => {
    refreshMenu();
    const inner = [ui.lightSheet, ui.clubsSheet, ui.roundsSheet].find(sheet => !sheet.hidden);
    showSheet(inner ?? ui.menuSheet);
  };
  $('[data-clubs-open]').onclick = () => { refreshClubs(); showSheet(ui.clubsSheet); };
  $('[data-clubs-back]').onclick = () => { refreshMenu(); showSheet(ui.menuSheet); };
  /* It opens on the hole being played: a hole picked on the card last time is not. */
  ui.score.onclick = () => {
    state.scoreHole = null;
    refreshScore();
    showSheet(ui.scoreSheet);
  };
  ui.holeNoteMore.onclick = () => {
    ui.note.classList.remove('is-clamped');
    ui.holeNoteMore.hidden = true;
  };
  const openRounds = () => { refreshRounds(); showSheet(ui.roundsSheet); };
  $('[data-rounds-open]').onclick = openRounds;
  ui.roundBack.onclick = openRounds;
  $('[data-rounds-back]').onclick = () => { refreshMenu(); showSheet(ui.menuSheet); };
  const openHole = () => {
    state.correcting = null;
    refreshHole();
    showSheet(ui.holeSheet);
  };
  ui.holeTool.onclick = openHole;
  ui.holeText.onclick = openHole;
  for (const button of root.querySelectorAll('[data-close]')) button.onclick = () => showSheet(null);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') showSheet(null); });

  /* A sheet goes back down the way it came. Only by its head: its body scrolls. */
  const DISMISS_PIXELS = 56;
  for (const [sheet] of sheets) {
    const head = sheet.querySelector('.map-sheet-head');
    let from = null;
    const settle = () => { from = null; sheet.style.transform = ''; };
    head.addEventListener('pointerdown', event => {
      if (event.target.closest('button')) return;
      from = event.clientY;
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener('pointermove', event => {
      if (from !== null) sheet.style.transform = `translateY(${Math.max(0, event.clientY - from)}px)`;
    });
    head.addEventListener('pointerup', event => {
      if (from === null) return;
      const pulled = event.clientY - from;
      settle();
      if (pulled > DISMISS_PIXELS) showSheet(null);
    });
    head.addEventListener('pointercancel', settle);
  }

  const chip = (label, pressed, onClick, extra = '') => {
    const button = document.createElement('button');
    button.className = `map-chip ${extra}`.trim();
    button.textContent = label;
    button.setAttribute('aria-pressed', String(pressed));
    button.onclick = onClick;
    return button;
  };

  /* The hole in words: its tip, what lies ahead, and the way to any other hole. */
  function refreshHole() {
    const h = hole(), hasHole = state.mode === 'hole';
    ui.holeSheetTitle.textContent = hasHole ? [`Hål ${h.n}`, h.name].filter(Boolean).join(' · ') : course.name;
    ui.note.textContent = hasHole ? h.note ?? '' : '';
    ui.note.hidden = !ui.note.textContent;
    ui.note.classList.add('is-clamped');
    ui.holeNoteMore.hidden = ui.note.textContent.length < NOTE_CLAMP_LETTERS;
    const played = hasHole ? roundShots().filter(shot => shot.hole === h.n) : [];
    ui.shotsSection.hidden = !played.length;
    const strokes = played.filter(shot => !isPutt(shot)), putts = played.length - strokes.length;
    ui.shotsHint.hidden = !strokes.length;
    ui.shotList.replaceChildren(...strokes.map(shotRow), ...(putts ? [puttsRow(putts)] : []));
    const history = hasHole ? holeHistory(rounds, shots, course.slug, h.n) : null;
    ui.historySection.hidden = !history;
    if (history) renderHoleHistory(ui.history, { history, clubName });
    ui.hazardSection.hidden = !hasHole || !state.hazards.length;
    ui.hazardList.replaceChildren(...state.hazards.map(hazard => {
      const row = document.createElement('li');
      const name = hazard.kind === 'water' ? 'Vatten' : 'Bunker';
      const where = hazard.side === 'mitt' ? 'mitt i' : hazard.side;
      const carry = hazard.carry === null ? '' : `<small>över ${Math.round(hazard.carry)}</small>`;
      row.innerHTML = `<i class="map-dot is-${hazard.kind}"></i><span>${name}, ${where}</span><b>${Math.round(hazard.front)}</b>${carry}`;
      return row;
    }));
    ui.holes.replaceChildren(...course.holes.map(each => chip(String(each.n), hasHole && each.n === h.n, () => {
      showSheet(null);
      pickHole(each.n);
    })));
  }

  function puttsRow(count) {
    const item = document.createElement('li');
    item.innerHTML = '<div class="map-shot"><i></i><span>Puttar</span><b></b></div>';
    item.querySelector('b').textContent = String(count);
    return item;
  }

  /* The whole row is the way in, and the bag opens right under it. */
  function shotRow(shot, index) {
    const item = document.createElement('li'), button = document.createElement('button');
    const name = clubName(shot.club), length = shotLength(shot), open = state.correcting === shot;
    const result = shot.outcome === 'out' ? 'Omslag' : length === null ? '–' : `${Math.round(length)} m${shot.suspect ? '?' : ''}`;
    button.className = 'map-shot';
    button.innerHTML = '<i></i><span></span><b></b>';
    button.children[0].textContent = String(index + 1);
    button.children[1].textContent = name;
    button.children[2].textContent = result;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', `Slag ${index + 1}, ${name}, ${result === '–' ? 'ingen längd än' : result}. Rätta klubban.`);
    button.onclick = () => {
      state.correcting = open ? null : shot;
      refreshHole();
      const row = ui.shotList.children[index];
      row.firstChild.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    };
    item.append(button);
    if (open) {
      const clubs = document.createElement('div');
      clubs.className = 'map-chips map-shot-clubs';
      clubs.setAttribute('role', 'group');
      clubs.setAttribute('aria-label', `Rätt klubba för slag ${index + 1}`);
      clubs.replaceChildren(...wheelClubs(bag).filter(club => club.carry > 0).map(club => chip(club.name, club.id === shot.club, () => correctShot(shot, club, index))));
      item.append(clubs);
    }
    return item;
  }

  function correctShot(shot, club, index) {
    const underWay = shot === openShot(shots);
    state.correcting = null;
    if (club.id !== shot.club) {
      markUndo();
      diary.add('corrected', [shot.club, club.id]);
      shots = correctClub(shots, shot, club);
      saveShots();
      relearnBag();
      /* The wheel shows what is locked. */
      if (underWay) wheel.rest(club.id);
      refreshWheel();
      invalidate();
    }
    refreshHole();
    ui.shotList.children[index].firstChild.focus({ preventScroll: true });
  }

  const teeChips = (after = () => {}) => (course.tees?.names ?? []).map((name, index) => chip(name, index === state.tee, () => {
    state.tee = index;
    remember(`${TEE_KEY}:${course.slug}`, String(index));
    state.target = null;
    refreshNumbers();
    if (state.mode === 'hole') frameHole(500);
    invalidate();
    after();
  }));

  /* Each takes effect at once. The picture is framed again: the column may have moved. */
  for (const name of ['sun', 'large', 'left']) {
    ui[name].checked = display.get(name);
    ui[name].onchange = () => {
      display.set(name, ui[name].checked);
      fitLayout();
      diary.add('display', [name, ui[name].checked]);
      if (state.mode === 'hole' && state.follow) frameHole(300);
      invalidate();
    };
  }

  function refreshMenu() {
    const hasHole = state.mode === 'hole';
    ui.menuTitle.textContent = course.name;
    ui.lightName.textContent = state.lightKey === 'nu' ? 'Nu' : lightByKey(state.lightKey)?.label ?? '';
    const logged = shots.filter(shot => shot.to && !isPutt(shot)).length;
    ui.clubsCount.textContent = logged ? `${logged} slag` : '';
    ui.roundsCount.textContent = rounds.length ? `${rounds.length} ${rounds.length === 1 ? 'runda' : 'rundor'}` : '';
    const names = course.tees?.names ?? [];
    ui.teeSection.hidden = names.length < 2 || !hasHole;
    ui.tees.replaceChildren(...teeChips());
    /* Min vy stands on the true ground: the choice waits for the map's own views. */
    ui.reliefs.replaceChildren(...RELIEF_STEPS.map(step => chip(`${String(step).replace('.', ',')}×`, step === (state.mapRelief ?? state.exaggeration), () => {
      if (state.atEye) {
        state.mapRelief = step;
        refreshMenu();
        return;
      }
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
  let rounds = parseRounds(savedText(ROUNDS_KEY, null));
  const teeName = () => course.tees?.names?.[state.tee] ?? null;
  const keepRecord = record => {
    rounds = keepRound(rounds, record);
    remember(ROUNDS_KEY, storeRounds(rounds));
    return record;
  };
  let round = parseRound(savedText(roundKey, null)) ?? newRound();
  if (!Number.isFinite(round.handicap)) {
    const known = Number(savedText(HANDICAP_KEY, ''));
    if (savedText(HANDICAP_KEY, '') !== '' && Number.isFinite(known)) round.handicap = known;
  }
  const scoredHole = () => course.holes[(state.scoreHole ?? state.hole) - 1];
  /* An earlier hole being put right: nothing to move on from. */
  const fillingIn = () => state.scoreHole !== null && state.scoreHole !== state.hole;
  /* A card left from another day is that day's: the same course played again is a
     new round, or the log would add both together. */
  if (Date.now() - (round.touchedAt ?? Date.parse(round.startedAt)) > RESUME_MS) {
    /* Never ended by hand, and still worth keeping. */
    if (round.id && holesScored(round, course.holes)) keepRecord(roundRecord(round, course, { tee: teeName(), at: round.touchedAt }));
    const { handicap } = round;
    round = { ...newRound(), handicap };
  }
  round.id ??= Date.now();
  const thisRecord = () => roundRecord(round, course, { tee: teeName(), at: round.endedAt ?? Date.now() });
  const saveRound = () => {
    round.touchedAt = Date.now();
    remember(roundKey, JSON.stringify(round));
    /* A round ended can still be put right. */
    if (round.endedAt) keepRecord(thisRecord());
  };

  function setScore(change, number = scoredHole().n) {
    round.scores[number] = { ...round.scores[number], ...change };
    saveRound();
    refreshScore();
  }

  /* The next tee is the moment a golfer has the score in their head: one tap, and
     the rest can wait. */
  let promptTimer = 0;
  const closePrompt = () => { clearTimeout(promptTimer); ui.prompt.hidden = true; };
  function askScore(number) {
    const h = course.holes[number - 1];
    const own = round.scores[number];
    if (!h || Number.isFinite(own?.strokes) || own?.picked) return;
    ui.prompt.dataset.asked = String(h.n);
    /* The strokes the wheel saw, as the likely answer: a putt or two may be missing. */
    const { strokes } = holeTally(roundShots(), h.n);
    ui.prompt.dataset.kind = 'score';
    ui.promptMore.textContent = 'Fler val';
    ui.promptTitle.textContent = [`Slag på hål ${h.n}?`, `par ${h.par}`, strokes ? `${strokes} loggade` : null].filter(Boolean).join(' · ');
    ui.promptKeys.replaceChildren(...strokeKeys(h.par, strokes).map(value => {
      const key = chip(String(value), value === strokes, () => {
        setScore({ strokes: value, picked: false, logged: false }, h.n);
        closePrompt();
        endIfOver(h.n);
      }, value === h.par ? 'is-par' : '');
      key.dataset.promptKey = String(value);
      return key;
    }));
    ui.prompt.hidden = false;
    clearTimeout(promptTimer);
    promptTimer = setTimeout(closePrompt, PROMPT_MS);
  }
  /* The putter is held once, on the green: a putt is shorter than GPS can measure, so
     they are counted here, and with them the hole's score writes itself. */
  function askPutts(number, last = null) {
    ui.prompt.dataset.asked = String(number);
    ui.prompt.dataset.kind = 'putts';
    ui.promptMore.textContent = 'Ångra';
    ui.promptTitle.textContent = [last, 'Hur många puttar?'].filter(Boolean).join(' · ');
    ui.promptKeys.replaceChildren(...[1, 2, 3, 4].map(value => {
      const key = chip(String(value), false, () => finishHole(number, value));
      key.dataset.puttsKey = String(value);
      return key;
    }));
    /* It stays until they are holed: putting takes longer than a prompt's patience. */
    clearTimeout(promptTimer);
    ui.prompt.hidden = false;
  }

  function finishHole(number, putts) {
    markUndo();
    shots = setPutts(shots, number, putts, ours);
    saveShots();
    const { strokes } = holeTally(roundShots(), number);
    const own = round.scores[number];
    const byHand = Number.isFinite(own?.strokes) && !own.logged;
    setScore(byHand ? { putts } : { strokes, putts, picked: false, logged: true }, number);
    closePrompt();
    /* The total is said out loud, with a way to put it right: a lock can be missed. */
    ui.locked.dataset.asked = String(number);
    note(byHand ? `Hål ${number}: kortet säger ${own.strokes}` : `Hål ${number}: ${strokes} · ${scoreName(strokes, course.holes[number - 1].par)}`, { edit: true, end: atTheTurn(round, course.holes, number) });
    refreshWheel();
    endIfOver(number);
  }

  $('[data-prompt-close]').onclick = closePrompt;
  $('[data-prompt-more]').onclick = () => {
    if (ui.prompt.dataset.kind === 'putts') { takeBack(); return; }
    state.scoreHole = Number(ui.prompt.dataset.asked);
    closePrompt();
    refreshScore();
    showSheet(ui.scoreSheet);
  };

  function cardRows(holes) {
    const sum = pick => holes.reduce((total, each) => total + (pick(each) ?? 0), 0);
    const score = each => round.scores[each.n];
    const shown = each => (score(each)?.picked ? '–' : score(each)?.strokes ?? '');
    const kind = each => {
      const strokes = score(each)?.strokes;
      if (!Number.isFinite(strokes)) return '';
      return strokes < each.par ? 'is-under' : strokes > each.par ? 'is-over' : '';
    };
    const words = each => [`Hål ${each.n}`, `par ${each.par}`, Number.isFinite(score(each)?.strokes) ? `${score(each).strokes} slag` : score(each)?.picked ? 'struket' : null].filter(Boolean).join(', ');
    const here = each => (each.n === scoredHole().n ? 'is-now' : '');
    const cell = (each, text, extra = '') => `<button data-card-hole="${each.n}" class="${extra} ${here(each)}" aria-label="${words(each)}">${text}</button>`;
    /* The row a finger hits, once: a screen reader need not pass three buttons a hole. */
    const label = (each, text) => `<span class="${here(each)}">${text}</span>`;
    return `<div class="map-card-row map-card-head"><span>Hål</span>${holes.map(each => label(each, each.n)).join('')}<span>Σ</span></div>
      <div class="map-card-row"><span>Par</span>${holes.map(each => label(each, each.par)).join('')}<span>${sum(each => each.par)}</span></div>
      <div class="map-card-row map-card-score"><span>Slag</span>${holes.map(each => cell(each, `<i>${shown(each)}</i>`, kind(each))).join('')}<span>${sum(each => score(each)?.strokes) || ''}</span></div>`;
  }

  function refreshScore() {
    const h = scoredHole(), own = round.scores[h.n] ?? {};
    ui.scoreTitle.textContent = [`Hål ${h.n}`, `Par ${h.par}`, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    const stroke = value => {
      const key = chip(String(value), !own.picked && own.strokes === value, () => setScore({ strokes: value, picked: false, logged: false }), value === h.par ? 'is-par' : '');
      key.dataset.strokeKey = String(value);
      return key;
    };
    const keys = strokeKeys(h.par, own.picked ? null : own.strokes);
    const more = chip('+', false, () => setScore({ strokes: Math.max(own.strokes ?? 0, keys.at(-1)) + 1, picked: false, logged: false }));
    more.dataset.strokeMore = '';
    more.setAttribute('aria-label', 'Fler slag');
    ui.strokeKeys.replaceChildren(...keys.map(stroke), more);
    ui.puttKeys.replaceChildren(...[0, 1, 2, 3, 4].map(value => {
      const key = chip(String(value), own.putts === value, () => setScore({ putts: own.putts === value ? null : value }));
      key.dataset.puttKey = String(value);
      return key;
    }));
    ui.fairwayRow.hidden = h.par < 4;
    ui.fairwayKeys.replaceChildren(...[['left', '← Vänster'], ['hit', 'Träff'], ['right', 'Höger →']].map(([value, label]) => {
      const key = chip(label, own.fairway === value, () => setScore({ fairway: own.fairway === value ? null : value }));
      key.dataset.fairwayKey = value;
      return key;
    }));
    ui.scoreDone.textContent = state.fromRound ? 'Tillbaka till rundan'
      : isRoundComplete(round, course.holes) && !round.endedAt ? 'Se rundan'
      : h.n === course.holes.length || fillingIn() ? 'Klart' : `Vidare till hål ${h.n + 1} ›`;
    ui.endRound.hidden = !holesScored(round, course.holes) && !roundShots().length;
    ui.handicap.textContent = Number.isFinite(round.handicap) ? String(round.handicap) : '–';
    const received = strokesReceived(round.handicap, h, course.holes);
    const name = Number.isFinite(own.strokes) && !own.picked ? scoreName(own.strokes, h.par) : own.picked ? 'Struket' : '';
    const points = received === null ? null : own.picked ? 0 : Number.isFinite(own.strokes) ? stablefordPoints(h.par, own.strokes, received) : null;
    ui.scoreWord.textContent = [name, points === null ? null : `${points} poäng`,
      received ? `${received} erhållna slag` : null].filter(Boolean).join(' · ');
    const totals = roundTotals(round, course.holes);
    const toPar = toParText(totals.toPar);
    ui.scoreLabel.textContent = totals.strokes ? `Score ${toPar}` : 'Score';
    ui.scoreSum.textContent = totals.played
      ? [`${totals.strokes} slag`, totals.strokes ? toPar : null, totals.points === null ? null : `${totals.points} poäng`, totals.putts ? `${totals.putts} putt` : null].filter(Boolean).join(' · ')
      : 'Rundan har inte börjat';
    ui.scoreStats.textContent = [totals.fairwaysTried ? `Fairway ${totals.fairways}/${totals.fairwaysTried}` : null,
      totals.greensTried ? `GIR ${totals.greens}/${totals.greensTried}` : null,
      hitGreen(own, h.par) ? 'GIR här' : null].filter(Boolean).join(' · ');
    const nines = [course.holes.slice(0, 9), course.holes.slice(9)].filter(part => part.length);
    ui.card.innerHTML = nines.map(cardRows).join('');
  }

  ui.card.onclick = event => {
    const target = event.target.closest('[data-card-hole]');
    if (!target) return;
    state.scoreHole = Number(target.dataset.cardHole);
    refreshScore();
  };
  const stepScored = direction => {
    const count = course.holes.length;
    state.scoreHole = ((scoredHole().n - 1 + direction + count) % count) + 1;
    refreshScore();
  };
  $('[data-score-prev]').onclick = () => stepScored(-1);
  $('[data-score-next]').onclick = () => stepScored(1);
  ui.scoreDone.onclick = () => {
    if (state.fromRound) {
      state.fromRound = false;
      state.scoreHole = null;
      showRound(thisRecord());
      return;
    }
    if (isRoundComplete(round, course.holes) && !round.endedAt) {
      state.scoreHole = null;
      endRound();
      return;
    }
    const next = scoredHole().n + 1, filling = fillingIn();
    state.scoreHole = null;
    showSheet(null);
    if (filling || next > course.holes.length || state.hole === next) return;
    pickHole(next);
    state.playing = next;
    state.follow = true;
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

  /* ---- the end of a round ---- */
  /* The round is over: the GPS and the awake screen with it, and the player sees what
     it came to. A lock afterwards simply goes on, so a tap here loses nothing. */
  function endRound() {
    finishOpenShot();
    closePrompt();
    round.endedAt = Date.now();
    saveRound();
    if (gps.active) {
      stopGps();
      remember(`${GPS_KEY}:${course.slug}`, '');
    }
    diary.add('round-ended', holesScored(round, course.holes));
    showRound(keepRecord(thisRecord()));
  }
  const endIfOver = number => { if (!round.endedAt && roundIsOver(round, course.holes, number)) endRound(); };
  ui.endRound.onclick = endRound;
  ui.lockedEnd.onclick = () => {
    ui.locked.hidden = true;
    endRound();
  };

  function showRound(record, { back = false } = {}) {
    const own = record.id === round.id && record.course === course.slug;
    state.roundShown = record;
    ui.roundTitle.textContent = record.courseName;
    renderRound(ui.roundBody, {
      record,
      summary: roundSummary(record, shots),
      clubName,
      /* Another course's card is only to be read: its holes are not loaded here. */
      onHole: own ? number => {
        state.fromRound = true;
        state.scoreHole = number;
        refreshScore();
        showSheet(ui.scoreSheet);
      } : null,
    });
    ui.roundBack.hidden = !back;
    ui.roundNew.hidden = !own;
    ui.roundDrop.hidden = own;
    ui.roundDrop.textContent = 'Ta bort rundan';
    clearTimeout(droppingTimer);
    droppingTimer = 0;
    ui.roundSheet.scrollTop = 0;
    if (ui.roundSheet.hidden) showSheet(ui.roundSheet);
  }
  ui.roundNew.onclick = () => {
    freshRound();
    state.playing = 1;
    state.handPicked = false;
    state.follow = true;
    goHole(1);
    refreshStart();
    showSheet(ui.startSheet);
  };
  /* Gone for good, and its lengths with it, so it takes a second tap. */
  let droppingTimer = 0;
  ui.roundDrop.onclick = () => {
    if (!droppingTimer) {
      ui.roundDrop.textContent = 'Säker? Tryck igen';
      droppingTimer = setTimeout(() => { droppingTimer = 0; ui.roundDrop.textContent = 'Ta bort rundan'; }, 4000);
      return;
    }
    clearTimeout(droppingTimer);
    droppingTimer = 0;
    const record = state.roundShown;
    rounds = dropRound(rounds, record);
    remember(ROUNDS_KEY, storeRounds(rounds));
    shots = dropRoundShots(shots, record);
    remember(SHOTS_KEY, storeHistory(shots));
    undoPoint = null;
    relearnBag();
    diary.add('round-dropped');
    openRounds();
  };
  $('[data-round-share]').onclick = async () => {
    const record = state.roundShown, text = roundText(record, roundSummary(record, shots), dateText(record.date));
    try {
      if (navigator.share) await navigator.share({ title: record.courseName, text });
      else {
        await navigator.clipboard.writeText(text);
        status('Rundan kopierad');
      }
    } catch (error) {
      if (error.name !== 'AbortError') status('Rundan kunde inte delas');
    }
  };
  function refreshRounds() {
    renderRounds(ui.roundsBody, { rounds, trend: roundTrend(rounds), onOpen: record => showRound(record, { back: true }) });
  }

  function freshRound() {
    finishOpenShot();
    const { handicap } = round;
    round = { ...newRound(), handicap, id: Date.now() };
    state.scoreHole = null;
    state.fromRound = false;
    state.started = false;
    undoPoint = null;
    ui.locked.hidden = true;
    closePrompt();
    saveRound();
    refreshTrail();
    refreshScore();
    refreshWheel();
  }

  /* ---- the start of a round ---- */
  /* Everything a round needs before its first shot, on one card and filled in from last
     time. Starting from this tap also lets the phone ask for the position. */
  function refreshStart() {
    const length = courseLength(course.holes, state.tee);
    ui.startTitle.textContent = course.name;
    ui.startFacts.textContent = [`${course.holes.length} hål`, `par ${course.par}`, length ? `${length.toLocaleString('sv-SE')} m` : null].filter(Boolean).join(' · ');
    ui.startTeeSection.hidden = (course.tees?.names?.length ?? 0) < 2;
    ui.startTees.replaceChildren(...teeChips(refreshStart));
    ui.startHandicap.textContent = Number.isFinite(round.handicap) ? String(round.handicap) : '–';
  }
  const stepStartHandicap = step => {
    setHandicap(Number.isFinite(round.handicap) ? round.handicap + step : 18);
    refreshStart();
  };
  $('[data-start-more]').onclick = () => stepStartHandicap(1);
  $('[data-start-less]').onclick = () => stepStartHandicap(-1);
  $('[data-start-go]').onclick = () => {
    if (round.endedAt) freshRound();
    round.begunAt = Date.now();
    saveRound();
    diary.add('round-started', teeName());
    showSheet(null);
    if (!gps.active) startGps();
  };
  const roundUnderWay = () => !round.endedAt && (Boolean(round.begunAt) || holesScored(round, course.holes) > 0 || roundShots().length > 0);
  let tipGiven = false;
  function firstTip() {
    if (tipGiven || course.greensApproximate) return;
    tipGiven = true;
    if (savedText(HINT_KEY, '')) return;
    status('Tryck på kartan för att mäta ett slag', 8000, true);
    remember(HINT_KEY, '1');
  }

  /* ---- the test round's log ---- */
  $('[data-diary]').onclick = async () => {
    const name = `banvy-provrunda-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([diary.file()], name, { type: 'application/json' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
    const link = document.createElement('a');
    link.href = URL.createObjectURL(file);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    status('Loggen är sparad');
  };

  /* ---- the clubs ---- */
  /* Every round's shots, on every course: a club's length is drawn from them all. */
  let shots = parseHistory(savedText(SHOTS_KEY, null));
  const ours = shot => shot.course === course.slug && shot.round === round.id;
  const roundShots = () => shots.filter(ours);
  const stale = openShot(shots);
  if (stale && (!ours(stale) || Date.now() - stale.at > STALE_SHOT_MS)) shots = closeHole(shots, stale.hole);
  const saveShots = () => {
    remember(SHOTS_KEY, storeHistory(shots));
    saveRound();
    refreshTrail();
  };
  /* One step back, whatever the last step was. */
  let undoPoint = null;
  const markUndo = () => { undoPoint = { shots, scores: JSON.stringify(round.scores) }; };
  let trail = [], trailFrom = null;
  function refreshTrail() {
    const own = roundShots().filter(shot => shot.hole === state.hole);
    trail = own.filter(shot => shot.to && !isPutt(shot));
    trailFrom = openShot(own)?.from ?? null;
  }
  /* A lock counts on the hole being played, not one a player is only looking at. */
  const holeInPlay = () => course.holes[holeNumberInPlay() - 1];
  function holeNumberInPlay() {
    if (!state.player) return state.hole;
    const { point } = state.player;
    /* A hole chosen by hand counts while the player is anywhere near it: holes can lie
       so close that the line alone cannot tell them apart. */
    if (state.handPicked && nearestHole(point, [hole()]).distance <= FOLLOW_HOLE_METRES) return state.hole;
    return nearestHole(point, [course.holes[state.playing - 1], hole()], state.playing).hole;
  }
  function finishOpenShot() {
    const open = openShot(shots);
    if (!open) return;
    shots = closeHole(shots, open.hole);
    saveShots();
  }

  /* Longest first, the putter last, whatever order the bag was saved in. */
  const wheelClubs = clubs => [...clubs].sort((a, b) => b.carry - a.carry);
  let playingBag = learnedBag(bag, clubStats(shots));
  const clubName = id => bag.find(club => club.id === id)?.name ?? id;

  const wheel = createClubWheel($('[data-wheel]'), {
    onChoose() {
      state.wheelAuto = false;
      refreshWheel();
    },
    onLock: lockClub,
    onSlip: how => diary.add('slip', how),
  });
  /* The hold in one tap, for those who reach the wheel by screen reader. */
  $('[data-wheel-lock]').onclick = () => {
    const club = wheel.current();
    if (club) lockClub(club);
  };
  wheel.setClubs(wheelClubs(playingBag));

  function relearnBag() {
    const next = learnedBag(bag, clubStats(shots));
    const changed = next.some((club, k) => club.carry !== playingBag[k].carry);
    playingBag = next;
    if (changed) wheel.setClubs(wheelClubs(playingBag));
  }

  const nearOpenShot = open => open && state.player && Math.hypot(state.player.point[0] - open.from[0], state.player.point[1] - open.from[1]);

  function refreshWheel() {
    const h = hole(), { player } = state;
    const open = openShot(roundShots());
    const walked = nearOpenShot(open);
    const byTheBall = open !== null && walked !== null && walked < WHEEL_AWAY_METRES;
    if (state.justLocked && !byTheBall) {
      state.justLocked = false;
      state.wheelAuto = true;
    }
    const reading = shotReading(origin(), state.target ?? h.green.c, store.heightAt, air());
    const onGreen = player?.onCourse && surfaceAt(player.point, h) === 'green';
    const suggested = onGreen ? playingBag.find(isPutter) : recommendClub(reading.plays ?? reading.distance, playingBag)?.club;
    if (suggested) {
      wheel.suggest(suggested.id);
      if (state.wheelAuto) wheel.rest(suggested.id);
    }
    wheel.setLocked(byTheBall && wheel.current()?.id === open.club);
    const walking = open && player && !byTheBall;
    const first = !open && !savedText(HINT_LOCK_KEY, '');
    const words = walking ? clubName(open.club) : first ? 'Håll för slag' : '';
    const length = walking ? `${metres(walked)} m` : '';
    if (ui.hintNote.textContent !== words) ui.hintNote.textContent = words;
    if (ui.hintMetres.textContent !== length) ui.hintMetres.textContent = length;
    ui.wheelHint.hidden = !words || state.mode !== 'hole';
  }

  let noteTimer = 0, sameTimer = 0, lockTimer = 0;
  function note(text, { penalty = false, edit = false, end = false } = {}) {
    ui.lockedText.textContent = text;
    ui.lockedPenalty.hidden = !penalty;
    ui.lockedEdit.hidden = !edit;
    ui.lockedEnd.hidden = !end;
    ui.locked.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { ui.locked.hidden = true; }, NOTE_MS);
  }
  const closeSame = () => {
    clearTimeout(sameTimer);
    ui.same.hidden = true;
    state.sameClub = null;
  };

  /* Long enough to mean it, and the shot starts from this spot, this club. */
  function lockClub(club) {
    state.wheelAuto = false;
    const { player } = state;
    const trusted = player?.onCourse && player.accuracy <= PLACING_ACCURACY_METRES && clock() - player.at <= FRESH_FIX_MS;
    if (!trusted) {
      /* Waiting, but not for long: past this the player may have walked off. */
      if (!state.pendingLock) {
        diary.add('lock-waited', player ? Math.round(player.accuracy) : null);
        clearTimeout(lockTimer);
        lockTimer = setTimeout(() => {
          state.pendingLock = null;
          status('Ingen säker position. Håll klubban igen vid bollen.');
        }, LOCK_WAIT_MS);
        status('Väntar på GPS-positionen', 4000);
      }
      state.pendingLock = { club };
      if (gps.active) gps.ask(); else startGps();
      return;
    }
    clearTimeout(lockTimer);
    state.pendingLock = null;
    remember(HINT_LOCK_KEY, '1');
    /* Locked on the next tee before the map has seen the player stand there. */
    const teeBegun = state.owed ?? teeWatch.candidate;
    if (teeBegun !== null) moveOn(teeBegun);
    const open = openShot(roundShots());
    if (open?.hole === holeInPlay().n && nearOpenShot(open) < SAME_SPOT_METRES && !isPutter(club)) {
      state.sameClub = club;
      ui.locked.hidden = true;
      ui.same.hidden = false;
      clearTimeout(sameTimer);
      sameTimer = setTimeout(closeSame, SAME_SPOT_MS);
      return;
    }
    strike(club);
  }

  function strike(club) {
    closeSame();
    if (round.endedAt) {
      if (Date.now() - round.endedAt > PLAY_ON_MS) freshRound();
      else delete round.endedAt;
    }
    const h = holeInPlay(), { point, accuracy } = state.player;
    const open = openShot(roundShots());
    if (open && open.hole !== h.n) finishOpenShot();
    const before = open?.hole === h.n ? open : null;
    const lie = surfaceAt(point, h, course.features.water);
    const rise = before ? store.heightAt(point[0], point[1]) - store.heightAt(before.from[0], before.from[1]) : null;
    markUndo();
    diary.add('lock', [h.n, club.id, Math.round(accuracy)]);
    shots = lockShot(shots, { hole: h.n, club, point, accuracy, at: Date.now(), lie, rise, farthest: reachOf(before && bag.find(each => each.id === before.club)), meta: { course: course.slug, round: round.id } });
    saveShots();
    state.justLocked = true;
    const closed = before ? shots.at(-2) : null;
    if (closed && accuracy <= MEASURABLE_ACCURACY_METRES) relearnBag();
    /* The reward for the lock: what the last shot did. */
    const reward = closed ? `${clubName(closed.club)} ${Math.round(shotLength(closed))} m${closed.suspect ? '?' : ''}` : null;
    const count = roundShots().filter(shot => shot.hole === h.n).length;
    if (isPutter(club)) {
      ui.locked.hidden = true;
      askPutts(h.n, reward);
    } else note(reward ?? `Slag ${count} · ${club.name} låst`, { penalty: Boolean(closed) });
    /* The tee shot says itself whether the fairway was hit. */
    if (closed && h.par >= 4 && roundShots().filter(shot => shot.hole === h.n).length === 2 && !round.scores[h.n]?.fairway) {
      const side = sideOfPlay(closed.to, playedPath(h, teePoint()));
      const fairway = closed.toLie === 'fairway' ? 'hit' : { vänster: 'left', höger: 'right' }[side];
      if (fairway) setScore({ fairway }, h.n);
    }
    refreshFloat();
    refreshWheel();
    invalidate();
  }

  function takeBack() {
    diary.add('undo');
    if (undoPoint) {
      shots = undoPoint.shots;
      round.scores = JSON.parse(undoPoint.scores);
      undoPoint = null;
    }
    saveShots();
    refreshScore();
    ui.locked.hidden = true;
    closePrompt();
    state.wheelAuto = true;
    state.justLocked = false;
    refreshWheel();
    invalidate();
  }
  $('[data-locked-undo]').onclick = takeBack;
  $('[data-locked-penalty]').onclick = () => {
    markUndo();
    shots = addPenalty(shots);
    saveShots();
    note('Plikt +1');
  };
  $('[data-locked-edit]').onclick = () => {
    state.scoreHole = Number(ui.locked.dataset.asked);
    ui.locked.hidden = true;
    refreshScore();
    showSheet(ui.scoreSheet);
  };
  $('[data-same-club]').onclick = () => {
    const club = state.sameClub;
    closeSame();
    markUndo();
    shots = changeClub(shots, club);
    saveShots();
    note(`Bytt till ${club.name}`);
    refreshWheel();
  };
  $('[data-same-shot]').onclick = () => strike(state.sameClub);
  $('[data-same-out]').onclick = () => {
    const club = state.sameClub;
    closeSame();
    markUndo();
    shots = retakeShot(shots, { club, at: Date.now() });
    saveShots();
    note('Omslag · ett slag till');
    refreshWheel();
  };

  function refreshClubs() {
    const stats = clubStats(shots);
    ui.clubsNote.textContent = stats.size
      ? 'Din längd med rullen inräknad, mätt med GPS. Stapeln är där slagen oftast hamnar och strecket din vanliga längd. Gråa siffror är bagens tills du har fem slag.'
      : 'Håll klubban på hjulet vid bollen, så fylls listan med dina egna längder.';
    renderClubs(ui.clubs, { clubs: wheelClubs(bag).filter(club => club.carry > 0), stats });
  }

  /* ---- the light ---- */
  const { lat: latitude, lon: longitude } = course.geo.origin;
  const lightSwatch = light => `linear-gradient(180deg, rgb(${light.zenith.map(n => Math.round(n * 255))}), rgb(${light.horizon.map(n => Math.round(n * 255))}) 62%, rgb(${light.grade.map(n => Math.round(Math.min(n, 1) * 120))}) 62%)`;
  const nowChip = chip('Nu', false, () => pickNow(), 'map-light-chip');
  nowChip.dataset.now = '';
  nowChip.dataset.key = 'nu';
  nowChip.setAttribute('aria-label', 'Ljuset just nu på banan');
  nowChip.style.setProperty('--swatch', lightSwatch(lightNow(new Date(), latitude, longitude)));
  ui.lights.replaceChildren(nowChip, ...MAP_LIGHTS.map(light => {
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
    for (const button of ui.lights.children) button.setAttribute('aria-pressed', String(button.dataset.key === state.lightKey));
    if (changed) invalidate();
  }

  function setLight(key) {
    state.lightKey = key;
    remember(LIGHT_KEY, key);
    refreshLight();
  }

  function pickNow() {
    if (state.lightKey === 'nu') { setLight(DEFAULT_LIGHT); return; }
    setLight('nu');
    const { elevationDegrees, azimuth } = state.light;
    status(elevationDegrees > 0
      ? `Solen står ${Math.round(elevationDegrees)}° över horisonten i ${compassName(azimuth)}`
      : 'Solen har gått ner');
  }
  setInterval(() => { if (state.lightKey === 'nu' && !document.hidden) refreshLight(); }, NOW_REFRESH_MS);

  /* ---- the wind ---- */
  function applyWeather(reading) {
    state.weather = reading;
    const trusted = air();
    ui.wind.hidden = !trusted;
    if (trusted) {
      ui.windSpeed.textContent = `${Math.round(trusted.windMs)} m/s`;
      ui.wind.setAttribute('aria-label', `Vind ${Math.round(trusted.windMs)} meter per sekund. Tryck för väder.`);
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
  const offlineExtras = [...treeFiles, ...landExtras];
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
    onRelease() { state.draggingTarget = false; },
    onTouched() {
      if (ui.status.classList.contains('is-low')) ui.status.hidden = true;
      state.flight = null;
      state.gridAwake = performance.now() + GRID_AWAKE_MS;
      showSheet(null);
      if (state.greenGrid) invalidate();
    },
    /* A press on the measuring point takes hold of it. */
    onPress(point) {
      state.draggingTarget = false;
      if (!state.target || state.mode !== 'hole') return;
      const s = camera.project(...lifted(state.target));
      state.draggingTarget = Math.hypot(s.x - point.x, s.y - point.y) < GRAB_PIXELS;
    },
    onPan(from, to) {
      if (state.atEye && !state.draggingTarget) {
        /* A finger on the view turns the head, one to one with the ground under it. */
        const perPixel = camera.state.fov * Math.PI / 180 / camera.state.height;
        state.follow = false;
        lookAround((from.x - to.x) * perPixel, (from.y - to.y) * perPixel);
        return;
      }
      if (state.draggingTarget) {
        const hit = camera.pick(to.x, to.y, store.heightAt, state.exaggeration);
        if (hit) {
          state.target = hit;
          state.numbersDirty = true;
          invalidate();
        }
        return;
      }
      state.follow = false;
      state.viewMoved = true;
      const a = camera.onPlane(from.x, from.y), b = camera.onPlane(to.x, to.y);
      if (!a || !b) return;
      camera.state.x += a[0] - b[0];
      camera.state.z += a[1] - b[1];
      invalidate();
    },
    onTwoFingers({ centre, from, zoom, turn, lean }) {
      if (state.atEye) {
        /* Two fingers bring the far end closer, as binoculars do. */
        state.follow = false;
        camera.state.fov = clamp(camera.state.fov * zoom, MIN_EYE_FOV_DEGREES, MAX_EYE_FOV_DEGREES);
        lookAround(0, 0);
        return;
      }
      state.follow = false;
      state.viewMoved = true;
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
      if (state.atEye) return;
      state.follow = false;
      state.viewMoved = true;
      camera.state.bearing += turn;
      camera.state.tilt = clamp(camera.state.tilt + lean, MIN_TILT, MAX_TILT);
      invalidate();
    },
    onDoubleTap(point) {
      if (state.atEye) return;
      state.follow = false;
      state.viewMoved = true;
      const hit = camera.pick(point.x, point.y, store.heightAt, state.exaggeration);
      if (!hit) return;
      const { bearing, tilt, distance } = camera.state;
      flyTo({ x: hit[0], y: shown(hit[0], hit[1]), z: hit[1], bearing, tilt, distance: clamp(distance * 0.55, MIN_DISTANCE, MAX_DISTANCE) }, 350);
    },
    onTap(point) {
      if (state.mode === 'course') {
        const tapped = overlay.holeAt(point.x, point.y);
        if (tapped) {
          state.handPicked = true;
          teeWatch.manual();
          state.owed = null;
          state.follow = Boolean(state.player);
          goHole(tapped);
        }
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

  $('[data-reading-close]').onclick = () => {
    state.target = null;
    refreshNumbers();
    invalidate();
  };

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
      diary.add('quality', state.quality);
      try { localStorage.setItem(QUALITY_KEY, String(state.quality)); } catch { /* it holds for this visit */ }
      resize();
    }
  }

  function resize() {
    fitLayout();
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
    if (time !== undefined && !state.greenGrid) notePace(time);
    /* A dragged point reads its numbers once a frame, not once a pointer event. */
    if (state.numbersDirty) {
      state.numbersDirty = false;
      refreshNumbers();
    }
    if (state.flight) {
      const elapsed = (time ?? started) - state.flightStart;
      Object.assign(camera.state, state.flight.at(elapsed));
      if (state.flight.done(elapsed)) state.flight = null;
    } else {
      /* Stand the pivot on the ground as finer heights arrive, gently: a jump
         here would shake the whole picture. At eye level it is the eye that stands. */
      const want = state.atEye ? eyeView(origin(), camera.state.bearing, state.eyePitch).y : shown(camera.state.x, camera.state.z);
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
    const planes = frustumPlanes(clip);
    const selection = selectPatches({
      root: store.root,
      isReady: store.isReady,
      eye,
      planes,
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
      /* A tree still reads well past where the 1 m ground ends, so it stands as far as a
         wide view of a hole reaches. Beyond that the painted canopy takes over. */
      const treeReach = state.atEye ? EYE_TREE_REACH_METRES : clamp(distance * TREE_REACH_PER_DISTANCE, pixelsPerRadian * pixelRatio() / 2.6, MOST_TREE_REACH_METRES);
      const forest = store.forest({ planes, eye, reach: treeReach, exaggeration: state.exaggeration });
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
        treeFade: [treeReach * 0.8, treeReach],
        forest,
        treeBudget: QUALITY_STEPS[state.quality].trees,
        /* From the ground the air starts well out, whatever the map's own reach. */
        fog: state.atEye ? [EYE_FOG_METRES, 9000] : [distance * 2.2, Math.max(distance * 14, 9000)],
        /* The greengrid reads the green by itself, as it does in the simulator. */
        contour: [interval, state.contours && !state.greenGrid && !state.atEye ? blend(0.42, 0.2) : 0, 5],
        greenGrid: state.greenGrid && {
          time: reducedMotion ? 0 : (performance.now() / 1000) % 3600,
          scale: Math.max(1, PULSE_LEAST_PIXELS * metresPerPixel / PULSE_WIDTH_METRES),
        },
        tint: [course.heightLow, course.heightHigh],
      });
      state.stats.triangles = drawn.triangles;
      state.stats.trees = drawn.trees;
      state.stats.patches = drawn.patches;
      state.stats.frames++;
      store.markUsed(selection);
      if (boot && !boot.classList.contains('done')) boot.classList.add('done');
    }

    /* A view moved by hand reaches the buttons here: gestures only ask for a frame. */
    refreshFloat();
    overlay.draw({
      camera,
      ground: shown,
      course,
      mode: state.mode,
      hole: hole(),
      origin: origin(),
      tee: state.player?.onCourse ? null : teePoint(),
      /* The player is the eye here, with nothing to mark. */
      player: state.atEye ? null : state.player,
      carryArcs: !state.atEye,
      emphasis: display.get('sun') ? 1.3 : 1,
      mirrored: display.get('left'),
      target: state.mode === 'hole' ? state.target : null,
      hazards: state.showHazards && !state.greenView ? state.hazards : [],
      shotFrom: state.mode === 'hole' ? trailFrom : null,
      trail,
      pinRings: Boolean(state.greenGrid),
    });

    state.stats.lastDrawMs = performance.now() - started;
    const settlingOn = state.atEye ? eyeView(origin(), camera.state.bearing, state.eyePitch).y : shown(camera.state.x, camera.state.z);
    if (state.flight || backlog > 0 || shadesWaiting > 0 || Math.abs(settlingOn - camera.state.y) > 0.05) invalidate();
    if (store.stats().busy === 0 && !state.flight) {
      refreshProfile();
      /* Read once the 1 m ground under the green is in. */
      if (state.greenView && !state.gridRead && store.onMetreGround(hole().green.ring)) {
        state.gridRead = true;
        state.greenGrid = buildGreenGrid({ ring: hole().green.ring, heightAt: store.heightAt });
        renderer.uploadGreenGrid(state.greenGrid);
        state.gridAwake = performance.now() + GRID_AWAKE_MS;
        refreshNumbers();
        invalidate();
      }
    }
    if (state.greenGrid && !reducedMotion && performance.now() < state.gridAwake) {
      clearTimeout(gridTimer);
      gridTimer = setTimeout(invalidate, GRID_FRAME_MS);
    }
  }

  resize();
  say('hämtar terrängen');
  refreshNumbers();
  refreshScore();
  if (course.greensApproximate) status('Greenernas form är ungefärlig på den här banan', 6000);
  /* A round set up on the course's own page in the start menu (?runda=1): the tee and
     the handicap were chosen and kept there, so it begins here without the start card,
     and the position is asked for at once. A round already under way on this course
     carries on instead. The word leaves the address, so a reload does not begin
     another. */
  const planned = params.get('runda') === '1';
  if (planned) {
    if (!roundUnderWay()) {
      if (round.endedAt || holesScored(round, course.holes) > 0) freshRound();
      const known = savedText(HANDICAP_KEY, '');
      round.handicap = known !== '' && Number.isFinite(Number(known)) ? Number(known) : null;
      round.begunAt = Date.now();
      saveRound();
      diary.add('round-started', teeName());
      state.follow = true;
      refreshScore();
      status(`Rundan är igång från tee ${teeName() ?? ''}`.trim(), 3200);
    }
    if (!gps.active) startGps();
    try {
      params.delete('runda');
      globalThis.history.replaceState(globalThis.history.state, '', `${location.pathname}?${params.toString()}${location.hash}`);
    } catch { /* the word stays; a round under way carries on all the same */ }
  }
  /* A plain link on a phone means a round may be about to start. Any other link was
     written to show something, and a round under way carries straight on. */
  if (!planned && isPhone() && !params.has('hal') && !roundUnderWay() && !savedFresh(LOOK_KEY) && !savedFresh(`${GPS_KEY}:${course.slug}`)) {
    refreshStart();
    showSheet(ui.startSheet);
  } else firstTip();

  /* A round that was going on when the tab was lost picks up where it was. Only with
     the permission already given: the prompt belongs to a tap on the button. */
  if (savedFresh(`${GPS_KEY}:${course.slug}`)) {
    navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'granted' && !gps.active) startGps();
    }).catch(() => {});
  }

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
    rounds: () => rounds,
    diary,
    shots: () => shots,
    wheel: () => wheel.current()?.id,
    /* A fixed moment for Nu, so a harness can stand at any hour of the year. */
    setClock(date) { state.lightClock = date; refreshLight(); },
    heightAt: store.heightAt,
    stats: () => ({ ...state.stats, ...store.stats(), camera: { ...camera.state } }),
    fix: (latitude, longitude, accuracy = 4) => receiveFix({ latitude, longitude, accuracy }),
    refix: () => receiveFix(state.lastCoords),
    /* Time on a tee passes faster on a harness than on a course. */
    skipTime(milliseconds) { state.clockAhead += milliseconds; },
    worldOf: (latitude, longitude) => course.frame.toWorld(...gpsToLocal({ latitude, longitude }, course.geo)),
  };
}

start().catch(fail);
