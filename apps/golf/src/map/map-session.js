/* The map session: every course as a light 3D map for a real round on the phone.
   ?bana=<slug>&karta=1, optionally &hal=<n>. Nothing here imports three.js or
   the player: it is a separate, far smaller program over the same course data.

   The frame only ever draws because something changed. There is no loop: a phone
   in a pocket between shots spends nothing on the map. */
import '../styles/course-map.css';
import { DEFAULT_BAG, gpsToLocal, nearestHole, parseBag } from '../engine/caddie.js';
import { createShortcutKeys, nextInCycle } from '../engine/keyboard-shortcuts.mjs';
import { compassName as windCompass, fetchWeather, weatherWord } from '../engine/weather.js';
import { isPhone } from '../shell/map-default.mjs';
import { distanceText } from '../shell/nearest-course.mjs';
import { clubIdFor, clubLayouts, layoutLabel } from '../shell/course-clubs.mjs';
import { detailedUrl, hubUrl, mapUrl, playUrl, reliveUrl } from '../shell/router.js';
import { MODES, rememberLaunch } from '../shell/settings-store.mjs';
import { getCloudState, initCloud, notifyLocalChange, savePlayerProfile } from '../shell/cloud.mjs';
import { liveFrozen, liveGuardChange, publishLive } from '../shell/live-rounds.mjs';
import { frustumPlanes, selectPatches } from './map-lod.mjs';
import { createCamera, createFlight, EYE_FOV_DEGREES, MAX_DISTANCE, MAX_EYE_FOV_DEGREES, MAX_TILT, MIN_DISTANCE, MIN_EYE_FOV_DEGREES, MIN_TILT } from './map-camera.mjs';
import { loadMapCourse } from './map-course.mjs';
import { savedCourseStatus } from './map-offline-status.mjs';
import { createGps, createGuidanceFix, createScreenLock, courseDownload, downloadCourse, offlineStatus } from './map-field.mjs';
import { createMapRenderer } from './map-gl.mjs';
import { shotUndo } from './map-shot-undo.mjs';
import { addPenalty, beforePutterLock, changeClub, closeHole, clubStats, correctClub, holeTally, isMeasured, isPutt, isPutter, learnedBag, lockShot, MEASURABLE_ACCURACY_METRES, openShot, parseHistory, reachOf, reopenPuttOnlyScores, retakeShot, SAME_SPOT_METRES, scoreAfterPutting, setPutts, shotAim, shotLength, shotReviewText, storeHistory, surfaceAt } from './map-shots.mjs';
import { createGuidancePlanner } from './map-guidance.mjs';
import { loadMapShotGeometry } from './map-shot-geometry.mjs';
import { readMapShot } from './map-strategy.mjs';
import { createClubWheel } from './map-wheel.mjs';
import { createPanelHistory } from '../ui/panel-history.mjs';
import { shotHud } from './map-shot-hud.mjs';
import { createDiary } from './map-diary.mjs';
import { activeFrameMs, createDisplay } from './map-display.mjs';
import { dateText, markCardOverflow, renderClubs, renderHoleHistory, renderRound, renderRounds } from './map-panels.mjs';
import { atTheTurn, courseLength, dropRound, dropRoundShots, holeHistory, holesScored, isRoundComplete, keepRound, parseRounds, roundEntry, roundIsOver, roundRecord, roundSummary, roundText, roundTrend, storeRounds } from './map-rounds.mjs';
import { createTeeWatch } from './map-follow.mjs';
import { attachGestures } from './map-gestures.mjs';
import { SHADE_BELOW_SUN } from './map-horizon.mjs';
import { AUTUMN_RAMPS, compassName, DEFAULT_LIGHT, lightByKey, lightNow, MAP_LIGHTS } from './map-light.mjs';
import { bearingOf, contourInterval, elevationProfile, greenNumbers, hazardsAhead, placeOnProfile, playedPath, principalBearing, reachableHazards, sideOfPlay, smoothProfile, stripX, shotReading } from './map-measure.mjs';
import { createOverlay } from './map-overlay.mjs';
import { hitGreen, MAX_HANDICAP, MIN_HANDICAP, newRound, parseRound, roundTotals, scoreName, stablefordPoints, strokeKeys, strokesReceived } from './map-score.mjs';
import { createDetailTexture } from './map-detail.mjs';
import { createMapPainter } from './map-paint.mjs';
import { createTileStore, fetchKeptFile } from './map-tiles.mjs';
import { catalogueFor, createTreeRules, loadTreeAtlases, speciesCount } from './map-trees.mjs';
import { buildGreenGrid, slopeColor, SLOPE_STEPS } from './map-greengrid.mjs';
import { landRecord, loadForestPicture, loadShores, loadWaterPicture } from './map-land.mjs';
import { clubRecord, loadClubBuildings } from './map-club-buildings.mjs';

const params = new URLSearchParams(location.search);
const slug = params.get('bana');
const BASE = import.meta.env.BASE_URL;
const COURSE_TILT = 0.72;
/* The quick views of a hole. Each runs from where the ball is to the green, whichever
   way that points, so the picture stays lined up with the player as they walk. They
   differ in how far the camera leans: the hole as a map, the golfer's own eye behind
   the ball, and straight down. */
const QUICK_VIEWS = Object.freeze({ hole: { tilt: 0.9 }, above: { tilt: 0.06 } });
const VIEW_NAMES = Object.freeze({ course: 'Banan', hole: 'Hela hålet', above: 'Ovanifrån', green: 'Green' });
/* How far the trees stand: twelve times the camera's distance, at most 12 km, and
   9 km from Min vy, about where the air has taken the ground (owner request,
   8 November: the woods ended a kilometre or two out). Past the 1 m tiles they are
   the far wood (map-far-forest.mjs). ?treereach=before is 2.4 times, 6 km and 3 km,
   with the budgets as they were. */
const TREE_REACH_BEFORE = params.get('treereach') === 'before';
const TREE_REACH = TREE_REACH_BEFORE
  ? Object.freeze({ perDistance: 2.4, most: 6000, eye: 3000 })
  : Object.freeze({ perDistance: 12, most: 12000, eye: 9000 });
/* Houses stand further than trees: a roof reads from further off than a crown, and
   zoomed out over a course they went with the 1 m ground (owner, 27 November). */
const HOUSE_REACH = Object.freeze({ perDistance: 20, least: 1500, most: 12000, eye: 9000 });
/* Zoomed out, the trees in view outnumbered the budget and the far woods thinned to a
   scatter (owner, 27 November: "show a lot more trees on all zoom levels"). Four times
   the budget on a device that holds the pace, and the trees a thinned wood keeps stand
   larger so it keeps its cover (map-gl.mjs uThin). ?treebudget=before is the budget as
   it was, ?treethin=0 the trees at their own size. */
const TREE_BUDGET_BEFORE = params.get('treebudget') === 'before';
const TREE_THIN = params.get('treethin') !== '0';
/* Min vy: standing at the ball, at a golfer's height, on the ground as it really is.
   The relief is drawn at its true height here: raised, a gentle rise becomes a wall. */
const EYE_HEIGHT_METRES = 1.8, EYE_LOOK_METRES = 120, EYE_PITCH = 0.04, EYE_PITCH_LIMIT = 0.5;
const VIEW_KEY = 'banvy-map-view-v1';
const EYE_FOG_METRES = 700;
/* As low as the simulator's fly-in over a green: 26 m back and 21 m up. */
const GREEN_TILT = 0.89;
const RELIEF_STEPS = [1, 1.5, 2, 3];
/* What a device that cannot hold the pace gives up, in order: distant trees first,
   then sharpness. A map that moves smoothly is worth more than one that is sharp
   and stutters. A step down is remembered, so the next round starts there. Each step
   draws fewer trees and stands them less far (`reach`, a share of TREE_REACH). */
const QUALITY_STEPS = Object.freeze(TREE_REACH_BEFORE ? [
  { trees: 20000, reach: 1, pixelRatio: 2 },
  { trees: 12000, reach: 1, pixelRatio: 2 },
  { trees: 5000, reach: 1, pixelRatio: 1.6 },
  { trees: 2500, reach: 1, pixelRatio: 1.3 },
] : TREE_BUDGET_BEFORE ? [
  { trees: 40000, reach: 1, pixelRatio: 2 },
  { trees: 20000, reach: 0.6, pixelRatio: 2 },
  { trees: 6000, reach: 0.4, pixelRatio: 1.6 },
  { trees: 3000, reach: 0.25, pixelRatio: 1.3 },
] : [
  { trees: 160000, reach: 1, pixelRatio: 2 },
  { trees: 60000, reach: 0.8, pixelRatio: 2 },
  { trees: 16000, reach: 0.5, pixelRatio: 1.6 },
  { trees: 5000, reach: 0.3, pixelRatio: 1.3 },
]);
const QUALITY_KEY = 'banvy-map-quality-v1';
const SLOW_FRAME_MS = 36, PACE_SAMPLES = 24;
const BAG_KEY = 'banvy-caddie-bag-v1';
const TEE_KEY = 'banvy-map-tee-v1';
const LIGHT_KEY = 'banvy-map-light-v1';
const CONTOUR_KEY = 'banvy-map-contours-v1';
const NOW_REFRESH_MS = 60000;
const HAZARD_KEY = 'banvy-map-hazards-v1';
const RING_KEY = 'banvy-map-rings-v1';
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
const NOTE_MS = 15000, SAME_SPOT_MS = 12000;
/* About two lines of a hole's tip. */
const NOTE_CLAMP_LETTERS = 90;
/* A lock waiting for a good fix. Past this the player may have walked off. */
const LOCK_WAIT_MS = 10000;
/* A shot left open this long was never finished, and must not end at the next round. */
const STALE_SHOT_MS = 3 * 60 * 60 * 1000;
const HOLE_KEY = 'banvy-map-hole-v1';
const GPS_KEY = 'banvy-map-gps-v1';
const HINT_KEY = 'banvy-map-hint-v1';
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
const FIX_GAP_MS = 60000;
/* GPS wanders a few metres at a standstill. The picture stays put under that, or a
   player standing still would keep the map flying, and the battery with it. */
const REFRAME_METRES = 5;
const ANNOUNCE_LANDING_METRES = 20;
/* A player standing still may send no fixes at all, so a tee is looked at again. */
const TEE_RECHECK_MS = 4000;
const GRAB_PIXELS = 28;
/* Further than this from a hole's line, a player is not on that hole. */
const ON_THE_STRIP_METRES = 150;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const metres = value => (Number.isFinite(value) ? `${Math.round(value)}` : '–');
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
      <button class="map-hole-text" data-hole-text aria-label="Om hålet">
        <span class="map-hole-title-row"><b data-hole-title></b><em class="map-hole-score" data-hole-score hidden></em></span>
        <span data-hole-facts></span>
      </button>
      <button data-next aria-label="Nästa hål">›</button>
      <span class="map-terrain-bar" data-terrain-bar aria-hidden="true"></span>
    </div>
  </header>
  <div class="map-side">
    <button class="map-green" data-green aria-label="Avstånd till greenen. Tryck för att se greenen nära.">
      <span class="map-green-row"><i>Bak</i><span class="map-green-val"><b data-back-number>–</b><u class="map-unit" aria-hidden="true">m</u></span></span>
      <span class="map-green-row map-green-mid"><i>Mitt</i><span class="map-green-val"><b data-mid-number>–</b><u class="map-unit" aria-hidden="true">m</u></span></span>
      <span class="map-green-row"><i>Fram</i><span class="map-green-val"><b data-front-number>–</b><u class="map-unit" aria-hidden="true">m</u></span></span>
      <span class="map-green-plays" data-green-plays hidden></span>
      <span class="map-green-meta" data-green-meta>
        <span class="map-green-wind" data-green-wind hidden><svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" data-green-wind-arrow><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/></svg><span data-green-wind-text></span></span>
        <span class="map-green-gps" data-green-gps><i class="map-gps-dot" data-gps-dot data-state="off" aria-hidden="true"></i><small data-from></small></span>
      </span>
      <span class="map-green-cue" data-green-cue aria-hidden="true"><svg viewBox="0 0 16 16" width="11" height="11"><path d="M2 5.5h12M2 10.5h12M5.5 2v12M10.5 2v12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span data-green-cue-text>Greenvy</span></span>
    </button>
    <button class="map-wind" data-wind hidden aria-label="Vind och väder">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" data-wind-arrow><path d="M12 3l6 9h-4v9h-4v-9H6z" fill="currentColor"/></svg>
      <b data-wind-speed></b>
    </button>
  </div>
  <div class="map-thumb-cluster" data-thumb-cluster>
    <div class="map-wheel" data-wheel>
      <div class="map-wheel-band" aria-hidden="true"></div>
      <div class="map-wheel-list" data-wheel-list role="listbox" tabindex="0" aria-label="Klubba" aria-describedby="map-wheel-help"></div>
      <span class="map-sr" id="map-wheel-help">Välj klubba med piltangenterna eller genom att snurra. Tryck på Logga slag eller Enter för att logga slaget.</span>
    </div>
    <button class="map-tool map-tool-primary map-log-fab" data-wheel-lock><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><span data-wheel-lock-label>Logga slag</span></button>
  </div>
  <section class="map-bottom">
    <div class="map-float">
      <div class="map-view-wrap" data-view-wrap>
        <div class="map-view-menu" id="map-camera-views" data-views data-view-menu hidden role="group" aria-label="Kameravy">
          <button data-view="hole" aria-pressed="true">Hela hålet</button>
          <button data-view="green" aria-pressed="false" aria-label="Greenen nära">Green</button>
          <button data-view="above" aria-pressed="false">Ovanifrån</button>
          <button data-overview aria-pressed="false" aria-label="Hela banan">Banan</button>
        </div>
        <button class="map-view-toggle" data-view-toggle aria-expanded="false" aria-controls="map-camera-views" aria-label="Kameravy">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H8l1.6-2h4.8L16 6h2.5A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12.5" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>
          <span data-view-label>Hela hålet</span>
        </button>
      </div>
      <button class="map-gps-pill" data-gps aria-pressed="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span data-gps-label>GPS</span></button>
    </div>
    <div class="map-locked" data-locked hidden>
      <b data-locked-text></b>
      <button data-locked-edit hidden>Ändra</button>
      <button data-locked-end hidden>Avsluta</button>
      <button data-locked-penalty>Plikt +1</button>
      <button data-locked-undo>Ångra</button>
      <button class="map-locked-close" data-locked-close aria-label="Stäng meddelande">×</button>
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
    <div class="map-reading" data-reading hidden role="region" aria-label="Mätning och slag">
      <div class="map-reading-text" data-reading-text>
        <div class="map-shot-context"><span data-shot-title></span><span data-shot-source></span></div>
        <div class="map-shot-main"><b data-shot-distance></b><em data-shot-club></em></div>
        <span data-shot-detail></span>
        <p class="map-walked-shot" data-wheel-hint hidden><span>Från slaget</span> <span data-hint-note></span> <b data-hint-metres></b></p>
      </div>
      <div class="map-shot-actions">
        <button data-reading-close hidden aria-label="Rensa mätpunkt">Rensa</button>
        <button data-club-auto hidden>Föreslagen</button>
        <button data-aim-retry hidden>Försök igen</button>
      </div>
    </div>
    <span class="map-sr" role="status" aria-atomic="true" data-shot-status></span>
    <span class="map-sr" role="status" aria-atomic="true" data-log-status></span>
    <div class="map-legend" data-legend hidden aria-label="Greenens lutning i procent">
      <span>Lutning %</span><div data-legend-steps></div>
    </div>
    <p class="map-pending" data-pending-shot role="status" aria-atomic="true" hidden></p>
    <div class="map-tools">
      <button class="map-tool map-tool-menu" data-menu aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Meny</span><em class="map-menu-score-tag" data-menu-score-tag hidden></em></button>
      <button class="map-recentre" data-recentre hidden aria-label="Tillbaka till hålet"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="map-tool map-tool-aux" data-hole aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 21V4l11 4.5L7 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg><span>Hålet</span></button>
      <button class="map-tool map-tool-aux" data-score aria-expanded="false"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 9h6M9 13h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span data-score-label>Score</span></button>
    </div>
  </section>
  <aside class="map-desk-rail" data-desk-rail hidden aria-label="Sidopanel">
    <div class="map-desk-head">
      <a class="map-desk-back" href="${hubUrl()}" data-leave-guard aria-label="Till klubbarna">‹ Klubbar</a>
      <strong class="map-desk-course" data-desk-course></strong>
      <button type="button" class="map-desk-icon" data-shortcuts-btn aria-label="Kortkommandon (?)" aria-expanded="false" aria-controls="map-shortcuts-pop" title="Kortkommandon (?)">?</button>
      <button type="button" class="map-desk-collapse" data-desk-collapse aria-label="Dölj sidopanel (I)" title="Dölj sidopanel (I)">‹</button>
    </div>
    <div class="map-desk-tabs" role="tablist" aria-label="Sidopanel">
      <button type="button" role="tab" data-desk-tab="hole" aria-selected="true">Hålet</button>
      <button type="button" role="tab" data-desk-tab="score" aria-selected="false">Score</button>
      <button type="button" role="tab" data-desk-tab="menu" aria-selected="false">Meny</button>
    </div>
  </aside>
  <div class="map-desk-collapsed-bar" data-desk-collapsed-bar hidden>
    <button type="button" class="map-desk-open" data-desk-open aria-label="Visa sidopanel (I)" title="Visa sidopanel (I)">Panel ›</button>
    <button type="button" class="map-desk-icon" data-shortcuts-btn-alt aria-label="Kortkommandon (?)" aria-expanded="false" aria-controls="map-shortcuts-pop" title="Kortkommandon (?)">?</button>
  </div>
  <div class="bv-popover map-shortcuts-pop" id="map-shortcuts-pop" data-shortcuts-pop hidden role="dialog" aria-label="Tangentbordsgenvägar">
    <div class="map-shortcuts-head"><strong>Kortkommandon</strong><button type="button" class="map-sheet-close" data-shortcuts-close aria-label="Stäng">×</button></div>
    <ul class="map-facts">
      <li><span>Föregående / nästa hål</span><b><kbd>←</kbd> <kbd>→</kbd> · <kbd>P</kbd> <kbd>N</kbd></b></li>
      <li><span>Hoppa till hål</span><b><kbd>1</kbd>–<kbd>18</kbd></b></li>
      <li><span>Byt kameravy</span><b><kbd>C</kbd></b></li>
      <li><span>Greenvy på / av</span><b><kbd>G</kbd></b></li>
      <li><span>Hålguide / Banguide</span><b><kbd>B</kbd></b></li>
      <li><span>Centrera hålet</span><b><kbd>R</kbd></b></li>
      <li><span>Sidopanel / Ren vy</span><b><kbd>I</kbd> · <kbd>H</kbd></b></li>
      <li><span>Score / Meny</span><b><kbd>S</kbd> · <kbd>M</kbd></b></li>
      <li><span>Solläge / Ljus</span><b><kbd>U</kbd> · <kbd>L</kbd></b></li>
      <li><span>Ångra senaste</span><b><kbd>Z</kbd></b></li>
      <li><span>Rensa / stäng</span><b><kbd>Esc</kbd></b></li>
    </ul>
  </div>
  <button type="button" class="map-clean-exit" data-clean-exit hidden>Visa reglage</button>
  <div class="map-backdrop" data-backdrop hidden></div>
  <section class="map-sheet map-sheet-tall" data-score-sheet hidden aria-label="Scorekort">
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
    <div class="map-stepper map-handicap"><span>Spelhandicap</span><button data-handicap-less aria-label="Sänk spelhandicap">−</button><output data-handicap>Ingen</output><button data-handicap-more aria-label="Höj spelhandicap">+</button></div>
    <div class="map-actions">
      <button class="map-action" data-pick-up>Stryk hålet</button>
      <button class="map-action" data-end-round>Avsluta rundan</button>
    </div>
    <div class="map-score-undo" data-score-undo hidden>
      <span role="status" data-score-undo-text></span>
      <button type="button" data-score-undo-btn>Ångra</button>
    </div>
  </section>
  <section class="map-sheet map-sheet-tall" data-round-sheet hidden aria-label="Rundan">
    <div class="map-sheet-head"><button class="map-sheet-close" data-round-back hidden aria-label="Tillbaka till mina rundor">‹</button><b data-round-title></b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <div data-round-body></div>
    <div class="map-actions">
      <button class="map-action map-action-next" data-round-new>Ny runda</button>
      <button class="map-action" data-round-share>Dela rundan</button>
      <a class="map-action" href="${hubUrl('statistik')}" data-round-stats>Se statistik</a>
      <a class="map-action" data-round-relive hidden>Återupplev i 3D</a>
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
    <div data-start-hole-section hidden>
      <h3>Starthål</h3>
      <div class="map-chips" data-start-holes></div>
    </div>
    <div data-start-tee-section>
      <h3>Tee</h3>
      <div class="map-chips" data-start-tees></div>
    </div>
    <div class="map-stepper map-handicap"><span>Spelhandicap</span><button data-start-less aria-label="Sänk spelhandicap">−</button><output data-start-handicap>Ingen</output><button data-start-more aria-label="Höj spelhandicap">+</button></div>
    <button class="map-action" data-start-download>Spara för offline</button>
    <button class="map-action map-action-next map-start-go" data-start-go>Starta rundan</button>
    <button class="map-note-more map-start-look" data-close>Bara titta på banan</button>
  </section>
  <section class="map-sheet map-sheet-tall" data-hole-sheet hidden aria-label="Hålet">
    <div class="map-sheet-head">
      <button class="map-sheet-close" data-hole-prev aria-label="Hålet före">‹</button>
      <b data-hole-sheet-title></b>
      <button class="map-sheet-close" data-hole-next aria-label="Hålet efter">›</button>
      <button class="map-sheet-close" data-close aria-label="Stäng">×</button>
    </div>
    <button class="map-action map-action-next" data-play-hole hidden></button>
    <h3 class="map-sheet-first-h">Alla hål</h3>
    <div class="map-holes" data-holes></div>
    <div class="map-profile map-sheet-profile" data-profile>
      <svg viewBox="0 0 300 44" preserveAspectRatio="none" aria-hidden="true"><path data-profile-fill fill="rgba(120,205,120,.32)"/><path data-profile-line fill="none" stroke="#a6efa0" stroke-width="2" vector-effect="non-scaling-stroke"/><rect data-profile-walked y="0" width="0" height="44" fill="rgba(12,24,18,.62)"/></svg>
      <i class="map-mark map-mark-aim" data-profile-aim hidden></i>
      <i class="map-mark map-mark-you" data-profile-you hidden></i>
      <span data-profile-text></span><span class="map-plays" data-profile-plays></span>
    </div>
    <p class="map-conditions" data-shot-conditions hidden></p>
    <div data-hazard-section>
      <h3>Hinder · tryck för att mäta</h3>
      <ul class="map-hazards" data-hazard-list></ul>
    </div>
    <div data-shots-section hidden>
      <h3>Dina slag</h3>
      <ol class="map-shots" data-shots></ol>
      <p class="map-shots-hint" data-shots-hint hidden>Fel klubba eller plikt? Tryck på slaget.</p>
      <div class="map-shots-actions">
        <button class="map-action map-shots-penalty" data-hole-penalty hidden>Plikt +1</button>
        <button class="map-action" data-hole-undo hidden>Ångra senaste</button>
      </div>
    </div>
    <div data-history-section hidden>
      <h3>Så brukar du spela hålet</h3>
      <ul class="map-facts" data-history></ul>
    </div>
    <div class="map-tip" data-tip hidden>
      <p class="map-note is-clamped" data-note hidden></p>
      <button class="map-note-more" data-note-more hidden>Läs mer</button>
    </div>
  </section>
  <section class="map-sheet" data-clubs-sheet hidden aria-label="Mina klubbor">
    <div class="map-sheet-head"><button class="map-sheet-close" data-clubs-back aria-label="Tillbaka till menyn">‹</button><b>Mina klubbor</b><button class="map-sheet-close" data-close aria-label="Stäng">×</button></div>
    <p class="map-note" data-clubs-note></p>
    <ul class="map-clubs" data-clubs></ul>
    <div class="map-actions"><a class="map-action" data-leave-guard href="${hubUrl('installningar/bag')}">Redigera min bag</a></div>
  </section>
  <section class="map-sheet map-sheet-tall map-menu" data-menu-sheet hidden aria-label="Meny">
    <div class="map-sheet-head">
      <a class="map-sheet-back" data-menu-lobby href="${hubUrl()}" aria-label="Till klubbarna">‹ Klubbar</a>
      <b data-menu-title></b>
      <button class="map-sheet-close" data-close aria-label="Stäng">×</button>
    </div>
    <div class="map-menu-quick" data-menu-quick>
      <div class="map-menu-quick-actions">
        <button type="button" class="map-quick-btn is-score" data-menu-score><span data-menu-score-label>Scorekort</span></button>
        <button type="button" class="map-quick-btn" data-menu-hole>Hålguide & hinder</button>
      </div>
      <div class="bv-seg map-menu-views" data-menu-views role="group" aria-label="Kameravy">
        <button type="button" data-quick-view="hole" aria-pressed="true">Hålet</button>
        <button type="button" data-quick-view="green" aria-pressed="false">Green</button>
        <button type="button" data-quick-view="above" aria-pressed="false">Ovan</button>
        <button type="button" data-quick-view="course" aria-pressed="false">Banan</button>
      </div>
      <div class="map-menu-sun-row">
        <span class="map-menu-sun-label">Skärmläge</span>
        <div class="bv-seg map-sun-seg" data-sun-modes role="group" aria-label="Solläge">
          <button type="button" data-sun-mode="dag" aria-pressed="false">☀ Dag</button>
          <button type="button" data-sun-mode="auto" aria-pressed="true">Auto</button>
          <button type="button" data-sun-mode="natt" aria-pressed="false">Natt</button>
        </div>
        <input type="checkbox" data-sun hidden tabindex="-1" aria-hidden="true">
      </div>
    </div>
    <div class="map-menu-tabs" role="tablist" aria-label="Menyflikar">
      <button type="button" role="tab" data-menu-tab="runda" aria-selected="true">Runda</button>
      <button type="button" role="tab" data-menu-tab="visning" aria-selected="false">Visning</button>
      <button type="button" role="tab" data-menu-tab="bana" aria-selected="false">Bana & läge</button>
    </div>
    <div class="map-menu-pane" data-menu-pane="runda" role="tabpanel">
      <label class="map-row" data-menu-gps-row><span>GPS på banan<small data-menu-gps-sub>Följer din position under rundan</small></span><input type="checkbox" role="switch" data-menu-gps></label>
      <div data-tee-section>
        <h3>Tee</h3>
        <div class="map-chips" data-tees></div>
      </div>
      <h3>Runda & klubbor</h3>
      <button class="map-row map-row-next" data-rounds-open><span>Mina rundor</span><span class="map-row-value" data-rounds-count></span></button>
      <a class="map-row map-row-next" data-live-transfer href="${hubUrl('overlamna')}" hidden>Byt enhet för rundan</a>
      <button class="map-row map-row-next" data-clubs-open><span>Mina klubbor</span><span class="map-row-value" data-clubs-count></span></button>
      <a class="map-row map-row-next" href="${hubUrl('statistik')}"><span>Statistik</span><span class="map-row-value">Hela ditt spel</span></a>
      <a class="map-row map-row-next" data-course-stats style="display:none" href="${hubUrl('statistik')}"><span data-course-stats-name></span><span class="map-row-value" data-course-stats-count></span></a>
    </div>
    <div class="map-menu-pane" data-menu-pane="visning" role="tabpanel" hidden>
      <h3>Skärm & hand</h3>
      <label class="map-row"><span>Större text</span><input type="checkbox" role="switch" data-large></label>
      <label class="map-row"><span>Klubbhjulet till vänster</span><input type="checkbox" role="switch" data-left></label>
      <label class="map-row"><span>Låt skärmen släckas mellan slagen<small>Sparar batteri i fickan</small></span><input type="checkbox" role="switch" data-allow-sleep></label>
      <button type="button" class="map-row map-row-next" data-menu-clean><span>Ren vy</span><span class="map-row-value">Göm reglage</span></button>
      <h3>Ljus</h3>
      <div class="map-lights" data-lights></div>
      <h3>Kartan</h3>
      <label class="map-row"><span>Hinderavstånd</span><input type="checkbox" role="switch" data-hazards></label>
      <label class="map-row"><span>Avståndscirklar<small>100, 150, 200 och 250 m på kartan</small></span><input type="checkbox" role="switch" data-rings></label>
      <label class="map-row"><span>Höjdkurvor</span><input type="checkbox" role="switch" data-contours></label>
      <div class="map-row"><span>Höjdskala</span><div class="map-chips" data-reliefs></div></div>
    </div>
    <div class="map-menu-pane" data-menu-pane="bana" role="tabpanel" hidden>
      <div class="map-sibling-section" data-sibling-section hidden>
        <h3 data-sibling-title>Byt bana på klubben</h3>
        <div class="map-siblings" data-siblings></div>
      </div>
      <button class="map-action map-download" data-download>Spara banan för offline</button>
      <h3>Byt läge</h3>
      <a class="map-row map-row-next" data-full data-leave-guard>Detaljerad 3D</a>
      <a class="map-row map-row-next" data-play data-leave-guard>Öppna simulatorn</a>
      <h3>Navigering</h3>
      <a class="map-row map-row-next" data-club-overview href="${hubUrl(`klubb/${encodeURIComponent(clubIdFor(slug))}?bana=${encodeURIComponent(slug)}&lage=karta`)}">Till klubbsidan</a>
      <a class="map-row map-row-next" data-home href="${hubUrl()}">Alla klubbar</a>
      <button class="map-action" data-diary hidden>Spara provrundans logg</button>
    </div>
  </section>
  <div class="map-status" data-status hidden role="status"></div>`;
document.body.append(root);

const $ = selector => root.querySelector(selector);
/* Scroll does not bubble, but it can be caught on the way down: one listener keeps
   every scorecard's edge cue (map-panels.mjs) true as a nine is scrolled or resized. */
root.addEventListener('scroll', event => {
  if (event.target.classList?.contains('map-card-part')) markCardOverflow(event.target);
}, { capture: true, passive: true });
addEventListener('resize', () => root.querySelectorAll('.map-card-part').forEach(markCardOverflow));
const ui = {
  hole: $('[data-hole-title]'), holeScore: $('[data-hole-score]'), facts: $('[data-hole-facts]'), prev: $('[data-prev]'), next: $('[data-next]'),
  back: $('[data-back-number]'), mid: $('[data-mid-number]'), front: $('[data-front-number]'), greenPlays: $('[data-green-plays]'), greenCueText: $('[data-green-cue-text]'), from: $('[data-from]'),
  greenWind: $('[data-green-wind]'), greenWindArrow: $('[data-green-wind-arrow]'), greenWindText: $('[data-green-wind-text]'), gpsDot: $('[data-gps-dot]'),
  reading: $('[data-reading]'), status: $('[data-status]'),
  gps: $('[data-gps]'), gpsLabel: $('[data-gps-label]'), menuGps: $('[data-menu-gps]'), menuGpsSub: $('[data-menu-gps-sub]'), menu: $('[data-menu]'), menuScoreTag: $('[data-menu-score-tag]'),
  menuScoreBtn: $('[data-menu-score]'), menuScoreLabel: $('[data-menu-score-label]'), menuHoleBtn: $('[data-menu-hole]'), menuViews: $('[data-menu-views]'),
  sunModes: $('[data-sun-modes]'), allowSleep: $('[data-allow-sleep]'), menuClean: $('[data-menu-clean]'),
  siblingSection: $('[data-sibling-section]'), siblingTitle: $('[data-sibling-title]'), siblings: $('[data-siblings]'), clubOverview: $('[data-club-overview]'),
  score: $('[data-score]'), scoreLabel: $('[data-score-label]'), holeTool: $('[data-hole]'), holeText: $('[data-hole-text]'), holeBar: $('[data-hole-bar]'),
  holeSheet: $('[data-hole-sheet]'), holeSheetTitle: $('[data-hole-sheet-title]'), hazardSection: $('[data-hazard-section]'), hazardList: $('[data-hazard-list]'),
  recentre: $('[data-recentre]'),
  prompt: $('[data-prompt]'), promptTitle: $('[data-prompt-title]'), promptKeys: $('[data-prompt-keys]'),
  legend: $('[data-legend]'), views: $('[data-views]'),
  viewWrap: $('[data-view-wrap]'), viewToggle: $('[data-view-toggle]'), viewLabel: $('[data-view-label]'), viewMenu: $('[data-view-menu]'),
  tools: $('.map-tools'), backdrop: $('[data-backdrop]'), thumbCluster: $('[data-thumb-cluster]'),
  pendingShot: $('[data-pending-shot]'),
  deskRail: $('[data-desk-rail]'), deskCourse: $('[data-desk-course]'), deskCollapse: $('[data-desk-collapse]'), deskOpen: $('[data-desk-open]'), deskCollapsedBar: $('[data-desk-collapsed-bar]'),
  shortcutsPop: $('[data-shortcuts-pop]'), shortcutsBtns: [...root.querySelectorAll('[data-shortcuts-btn], [data-shortcuts-btn-alt]')], cleanExit: $('[data-clean-exit]'),
  wheel: $('[data-wheel]'), logShot: $('[data-wheel-lock]'), logShotLabel: $('[data-wheel-lock-label]'), walkedShot: $('[data-wheel-hint]'), hintNote: $('[data-hint-note]'), hintMetres: $('[data-hint-metres]'),
  promptMore: $('[data-prompt-more]'), holeNoteMore: $('[data-note-more]'), locked: $('[data-locked]'), lockedText: $('[data-locked-text]'), lockedPenalty: $('[data-locked-penalty]'), lockedEdit: $('[data-locked-edit]'), same: $('[data-same]'),
  clubsSheet: $('[data-clubs-sheet]'), clubs: $('[data-clubs]'), clubsNote: $('[data-clubs-note]'), clubsCount: $('[data-clubs-count]'),
  shotsSection: $('[data-shots-section]'), shotList: $('[data-shots]'), shotsHint: $('[data-shots-hint]'), holePenalty: $('[data-hole-penalty]'), holeUndo: $('[data-hole-undo]'),
  scoreSheet: $('[data-score-sheet]'), scoreTitle: $('[data-score-title]'), strokeKeys: $('[data-stroke-keys]'), puttKeys: $('[data-putt-keys]'),
  fairwayRow: $('[data-fairway-row]'), fairwayKeys: $('[data-fairway-keys]'), scoreDone: $('[data-score-done]'), scoreStats: $('[data-score-stats]'),
  scoreWord: $('[data-score-word]'), scoreSum: $('[data-score-sum]'), card: $('[data-card]'), handicap: $('[data-handicap]'),
  scoreUndo: $('[data-score-undo]'), scoreUndoText: $('[data-score-undo-text]'), scoreUndoBtn: $('[data-score-undo-btn]'),
  pickUp: $('[data-pick-up]'), endRound: $('[data-end-round]'), hazards: $('[data-hazards]'),
  roundSheet: $('[data-round-sheet]'), roundTitle: $('[data-round-title]'), roundBody: $('[data-round-body]'), roundBack: $('[data-round-back]'), roundNew: $('[data-round-new]'), roundDrop: $('[data-round-drop]'), lockedEnd: $('[data-locked-end]'),
  roundsSheet: $('[data-rounds-sheet]'), roundsBody: $('[data-rounds-body]'), roundsCount: $('[data-rounds-count]'),
  startSheet: $('[data-start-sheet]'), startTitle: $('[data-start-title]'), startFacts: $('[data-start-facts]'), startTeeSection: $('[data-start-tee-section]'), startTees: $('[data-start-tees]'), startHandicap: $('[data-start-handicap]'),
  historySection: $('[data-history-section]'), history: $('[data-history]'),
  sun: $('[data-sun]'), large: $('[data-large]'), left: $('[data-left]'),
  wind: $('[data-wind]'), windArrow: $('[data-wind-arrow]'), windSpeed: $('[data-wind-speed]'),
  menuSheet: $('[data-menu-sheet]'), lights: $('[data-lights]'),
  menuTitle: $('[data-menu-title]'), tip: $('[data-tip]'), note: $('[data-note]'), holes: $('[data-holes]'),
  teeSection: $('[data-tee-section]'), tees: $('[data-tees]'), reliefs: $('[data-reliefs]'), contours: $('[data-contours]'), rings: $('[data-rings]'),
  download: $('[data-download]'), full: $('[data-full]'), play: $('[data-play]'),
  overview: $('[data-overview]'), green: $('[data-green]'),
  profile: $('[data-profile]'), profileLine: $('[data-profile-line]'), profileFill: $('[data-profile-fill]'), profileText: $('[data-profile-text]'), profilePlays: $('[data-profile-plays]'),
  profileWalked: $('[data-profile-walked]'), profileYou: $('[data-profile-you]'), profileAim: $('[data-profile-aim]'),
};

const display = createDisplay(root, { read: key => savedText(key, null), write: remember });

/* The column and the foot, fitted to this phone. A phone's height says little by itself:
   a notch and a home bar take over 90 px from a screen that looks tall. So the column is
   measured against what is really left above the strip, and gives way a step at a time:
   fewer rows on the wheel, a tighter column, then the
   height strip. Where a note and the way-back button would reach the column they stand beside it,
   since the wheel is what a player is using just then. */
const PROMPT_ROOM_PIXELS = 128, TWO_ROWS_PIXELS = 96;
const sideways = matchMedia('(orientation: landscape) and (max-height: 520px)');
const desktopQuery = matchMedia('(min-width: 1024px) and (pointer: fine)');
const isDesktop = () => desktopQuery.matches;
function fitLayout() {
  root.classList.remove('is-compact', 'is-tight');
  ui.wheel.style.removeProperty('--rows');
  if (sideways.matches || isDesktop()) return;
  /* Measure vertical room between the top-right Distance Card and the bottom-right
     Thumb Cluster (Club Wheel + Logga slag) so they never touch even on compact phones. */
  const onGreen = ui.green.classList.contains('is-on');
  const heldPlays = [ui.greenPlays, ui.greenPlays.hidden, ui.greenPlays.textContent];
  const greenWasHidden = ui.green.hidden;
  ui.green.hidden = false;
  ui.greenPlays.hidden = false;
  if (!ui.greenPlays.textContent) ui.greenPlays.textContent = 'Spelas 000 m';
  ui.green.classList.remove('is-on');
  const gapBetweenCorners = () => ui.thumbCluster.getBoundingClientRect().top - ui.green.getBoundingClientRect().bottom;
  if (gapBetweenCorners() < 42) root.classList.add('is-compact');
  if (gapBetweenCorners() < 16) root.classList.add('is-tight');
  ui.green.hidden = greenWasHidden;
  heldPlays[0].hidden = heldPlays[1];
  heldPlays[0].textContent = heldPlays[2];
  ui.green.classList.toggle('is-on', onGreen);
}

let statusTimer = 0;
function status(text, hold = 3200, low = true) {
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

let courseName = '';
async function fail(error) {
  console.error(error);
  root.inert = true;
  boot.classList.add('map-load-failed');
  boot.removeAttribute('aria-hidden');
  boot.classList.remove('done');
  const heading = document.getElementById('bootTitle');
  heading.textContent = 'Kartan kunde inte öppnas';
  heading.tabIndex = -1;
  heading.focus();
  document.getElementById('bootSub').textContent = courseName || slug.replaceAll('-', ' ');
  const graphicsError = /WebGL|map shader|map program/i.test(error.message);
  bootMessage.setAttribute('role', 'alert');
  say(graphicsError ? '3D-grafiken kunde inte starta i webbläsaren.' : 'Banfilerna gick inte att läsa. Försök igen när du har täckning.');
  const retry = new URL(location.href);
  retry.searchParams.delete('kopia');
  document.getElementById('bootRetry').onclick = () => {
    if (retry.href === location.href) location.reload();
    else location.replace(retry.href);
  };
  const back = document.getElementById('bootReturn');
  const setup = new URLSearchParams();
  for (const key of ['hal', 'tee']) if (/^[1-9]\d*$/.test(params.get(key))) setup.set(key, params.get(key));
  back.href = hubUrl(`klubb/${encodeURIComponent(clubIdFor(slug))}?bana=${encodeURIComponent(slug)}&lage=karta${setup.size ? '&' + setup : ''}`);
  back.textContent = 'Till klubbsidan';
  document.getElementById('bootRecovery').hidden = false;
  if (!graphicsError && !params.has('kopia') && await savedCourseStatus(slug) === 'ready') {
    const saved = new URL(retry);
    saved.searchParams.set('kopia', '1');
    const link = document.getElementById('bootSaved');
    link.href = saved.href;
    link.hidden = false;
  }
}

async function start() {
  say('hämtar banan');
  const assetUrl = file => new URL(`${BASE}${file}`, location.href).href;
  const fetchAsset = file => fetchKeptFile(assetUrl(file));
  const course = await loadMapCourse(slug, { deferAppearance: true, savedCopy: params.get('kopia') === '1' });
  courseName = course.name;
  document.getElementById('bootTitle').textContent = course.name;
  document.getElementById('bootSub').textContent = 'Lätt 3D';
  document.title = `${course.name} — Lätt 3D | Banvy`;
  ui.play.href = `${BASE}${playUrl(slug)}`;
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
  /* The club's own buildings, simpler, in place of the footprints they stand for
     (map-club-buildings.mjs). ?clubhouses=0 is the layout's houses alone. */
  const clubFiles = params.get('clubhouses') === '0' ? null : clubRecord(course.ground.groundId);
  const clubExtras = clubFiles ? [{ file: clubFiles.file, sha256: clubFiles.sha256, bytes: clubFiles.bytes, href: assetUrl(clubFiles.file) }] : [];
  const groundCanvas = $('.map-ground');
  let store = null;
  let hydroRequest = null, hydro = null, visuals = null;
  const useLand = params.get('land') !== '0';
  function readHydro() {
    if (!hydroRequest) {
      hydroRequest = Promise.all([
        useLand ? loadWaterPicture(landFiles, fetchAsset) : null,
        shoresWanted ? loadShores(landFiles, fetchAsset) : null,
      ]).then(([land, shores]) => {
        hydro = { land, shores };
        queueMicrotask(refreshAppearance);
        return hydro;
      }).catch(error => {
        hydroRequest = null;
        throw error;
      });
    }
    return hydroRequest;
  }
  function refreshAppearance() {
    if (!visuals) return;
    // Each layer can arrive on its own. Only decoded ground pictures are drawable.
    const land = visuals.forest ? { ...visuals.forest, ...hydro?.land } : hydro?.land;
    const far = land?.forestBytes && !TREE_REACH_BEFORE && params.get('farforest') !== '0'
      ? { land, buildings: course.features.farBuildings, lines: [...course.features.roads, ...course.features.railways] } : null;
    try {
      store.setAppearance(createMapPainter(course, visuals.atlases, land, hydro?.shores), far, hydro !== null);
    } catch (error) {
      console.warn('Kartans utseende:', error.message);
    }
  }
  const renderer = createMapRenderer(groundCanvas, {
    onLost: () => store?.forgetGpu(),
    /* A tile that arrived while the context was gone went nowhere. */
    onRestored: () => {
      store?.forgetGpu();
      invalidate();
    },
  });
  renderer.uploadDetail(createDetailTexture());
  const camera = createCamera();
  const overlay = createOverlay($('.map-marks'));
  let raf = 0, frameRequestedAt = 0, sceneDirty = true;
  const requestFrame = () => {
    if (raf) return;
    frameRequestedAt = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const invalidate = () => { sceneDirty = true; requestFrame(); };

  store = createTileStore({
    ground: course.ground,
    baseHref: new URL(BASE, location.href).href,
    renderer,
    painter: createMapPainter(course),
    awaitingAppearance: true,
    rules,
    structures: course.features.structures,
    onChange: invalidate,
  });
  if (clubFiles) {
    loadClubBuildings(clubFiles, fetchAsset, course.ground.frame.fingerprint)
      .then(club => { if (club) store.setClubBuildings(club); })
      .catch(error => console.warn('Kartans klubbhus:', error.message));
  }

  // The HUD, position watch and terrain can start while photographic detail loads.
  // Only measured water and shores are dependencies of the shot planner.
  requestAnimationFrame(async () => {
    try {
      const catalogue = catalogueFor(slug);
      // An overview also draws water, even when no hole is being planned.
      readHydro().catch(error => console.warn('Kartans vatten:', error.message));
      const [atlases, forest, raster] = await Promise.all([
        loadTreeAtlases(catalogue, speciesCount(slug), entry => fetchAsset(entry.file)).catch(() => null),
        useLand ? loadForestPicture(landFiles, fetchAsset).catch(() => null) : null,
        course.appearance,
      ]);
      Object.assign(course, raster);
      visuals = { atlases, forest };
      if (atlases) renderer.uploadAtlases(atlases);
      refreshAppearance();
    } catch (error) {
      console.warn('Kartans utseende:', error.message);
    }
  });

  const state = {
    mode: 'hole',
    hole: 1,
    previewOnly: false,
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
    playing: 1,
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
    guidance: null,
    manualClub: null,
    reclaimWheel: true,
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
    showRings: savedText(RING_KEY, '0') === '1',
    menuTab: 'runda',
    deskOpen: desktopQuery.matches,
    deskTab: 'hole',
    hazards: [],
    weather: null,
    windTurn: null,
    scoreHole: null,
    pace: { start: 0, end: null, samples: [] },
    stats: { triangles: 0, trees: 0, patches: 0, frames: 0, pulseFrames: 0, lastDrawMs: 0 },
  };
  const diary = createDiary({ read: key => savedText(key, null), write: remember });
  diary.add('open', course.slug);
  const hole = () => course.holes[state.hole - 1];
  /* The tee played, by its colour's place in the course's list; a hole short of
     that many tees falls back as the player does. */
  const tee = (h = hole()) => {
    const { tees } = h;
    return tees[state.tee] ?? tees[course.tees?.def ?? 0] ?? tees[0] ?? { point: h.line[0], metres: h.lengths[0] };
  };
  const teePoint = () => tee().point;
  const origin = () => guidancePosition().point;
  const groundY = (x, z) => {
    const h = store.heightAt(x, z);
    return Number.isFinite(h) ? h : 0;
  };
  const shown = (x, z) => groundY(x, z) * state.exaggeration;
  const lifted = point => [point[0], shown(point[0], point[1]), point[1]];

  const mapHeader = $('.map-top'), mapFoot = $('.map-bottom'), cameraButtons = $('.map-float');
  function insets() {
    const { width, height } = camera.state;
    const gap = 12;
    const top = Math.ceil(mapHeader.getBoundingClientRect().bottom) + gap;
    const footCandidates = [mapFoot.getBoundingClientRect().top];
    const floatBox = cameraButtons.getBoundingClientRect();
    if (floatBox.height > 0) footCandidates.push(floatBox.top);
    const foot = Math.min(...footCandidates);
    const room = { top, bottom: height - Math.max(top + 48, Math.floor(foot) - gap), left: gap, right: gap };
    if (root.classList.contains('is-desk-open')) {
      const rail = ui.deskRail.getBoundingClientRect();
      if (rail.width) room.left = Math.max(room.left, Math.ceil(rail.right) + gap);
    }
    /* Measure active corner controls after CSS layout so camera framing keeps fairway centred. */
    for (const element of [ui.green, ui.wind, ui.thumbCluster]) {
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || getComputedStyle(element).display === 'none') continue;
      if (box.left + box.width / 2 < width / 2) room.left = Math.max(room.left, Math.ceil(box.right) + gap);
      else room.right = Math.max(room.right, width - Math.floor(box.left) + gap);
    }
    return room;
  }

  let lastFramingRoom = null;
  const canFrameShot = () => state.mode === 'hole' && !state.opening && !state.atEye && !state.greenView
    && !state.viewMoved && !state.draggingTarget && !root.classList.contains('has-sheet');
  function reframeForLayout() {
    if (!canFrameShot()) return;
    const room = insets();
    const dims = [camera.state.width, camera.state.height, room.top, room.bottom, room.left, room.right];
    if (lastFramingRoom && dims[0] === lastFramingRoom[0] && dims[1] === lastFramingRoom[1]
        && dims.slice(2).every((v, i) => Math.abs(v - lastFramingRoom[i + 2]) < 16)) return;
    const sizeChanged = !lastFramingRoom || dims[0] !== lastFramingRoom[0] || dims[1] !== lastFramingRoom[1];
    lastFramingRoom = dims;
    frameHole(sizeChanged ? 0 : 260);
  }
  function revealLanding(landing) {
    if (!landing || !canFrameShot()) return;
    const point = camera.project(...lifted(landing)), room = insets();
    if (!Number.isFinite(point.x) || point.x < room.left || point.x > camera.state.width - room.right
        || point.y < room.top || point.y > camera.state.height - room.bottom) frameHole(400);
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
    const rest = guidancePosition().source === 'tee' ? [from, ...h.line.slice(1)] : [from];
    if (state.guidance?.target) rest.push(state.guidance.target);
    for (const leg of state.guidance?.legs ?? []) rest.push(leg.point);
    const points = [...rest, ...h.green.ring.filter((_, i) => i % 3 === 0), h.green.c].map(lifted);
    /* Room above the flag, which stands taller than the green it marks. */
    points.push([h.pin[0], shown(h.pin[0], h.pin[1]) + Math.max(10, camera.state.distance * 0.05), h.pin[1]]);
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

  let lastHazardQuery = '';
  function refreshNumbers() {
    const h = hole(), from = origin();
    const hazardQuery = [state.mode, h.n, state.tee, ...from].join('/');
    if (hazardQuery !== lastHazardQuery) {
      lastHazardQuery = hazardQuery;
      state.hazards = state.mode === 'hole'
        ? hazardsAhead({ origin: from, path: playedPath(h, teePoint()), ...course.hazards })
        : [];
    }
    const { front, centre, back } = greenNumbers(from, h.green);
    /* A placeholder green has a middle but no real edge, so its front and back
       are marked as the estimates they are. */
    const edge = course.greensApproximate ? '≈' : '';
    ui.back.textContent = edge + metres(back ?? centre);
    const position = guidancePosition();
    const onTheGreen = state.mode === 'hole' && onMeasuredGreen(position);
    ui.green.classList.toggle('is-on', onTheGreen);
    ui.green.classList.toggle('is-green', state.greenView);
    ui.mid.textContent = onTheGreen ? (position.source === 'last-gps' ? 'Senast på green' : 'På green') : metres(centre);
    ui.front.textContent = edge + metres(front ?? centre);
    /* A rough fix (under trees, or a phone just woken) says so where the numbers are
       read, at the length the shot log already stops trusting: they can be that far out. */
    const rough = state.player?.onCourse && state.player.accuracy > MEASURABLE_ACCURACY_METRES;
    const dotState = gpsState === 'denied' || gpsState === 'unavailable' ? 'denied'
      : gpsState === 'outside' ? 'outside'
      : gpsState === 'searching' ? 'searching'
      : position.source === 'last-gps' ? 'stale'
      : position.source === 'gps' ? (rough ? 'rough' : 'live')
      : 'off';
    if (ui.gpsDot) ui.gpsDot.dataset.state = dotState;
    ui.from.textContent = position.source === 'last-gps' ? 'från senaste säkra GPS'
      : dotState === 'denied' ? 'Tillåt GPS'
      : dotState === 'outside' ? 'Utanför'
      : dotState === 'searching' ? 'Söker…'
      : position.source === 'gps' ? `±${Math.max(1, Math.round(state.player.accuracy))} m`
      : 'från tee';
    ui.from.classList.toggle('is-rough', position.source === 'last-gps' || dotState === 'stale' || dotState === 'rough' || dotState === 'denied');
    ui.gps.classList.toggle('is-rough', Boolean(rough) || position.source === 'last-gps');
    if (rough && roughNotedHole !== h.n) {
      roughNotedHole = h.n;
      status(`Osäker GPS (±${Math.round(state.player.accuracy)} m)`, 3200, true);
    }
    const fromWords = greenSpokenFrom();
    const spoken = onTheGreen ? (position.source === 'last-gps' ? 'Senaste säkra positionen var på greenen.' : 'Du är på greenen.') : `Till greenen ${fromWords}: fram ${ui.front.textContent}, mitt ${ui.mid.textContent}, bak ${ui.back.textContent} meter.`;
    ui.green.setAttribute('aria-label', `${spoken} Tryck för att ${state.greenView ? 'gå tillbaka till hålet' : 'se greenen nära'}.`);
    refreshGreenPlays();
    ui.hole.textContent = state.mode === 'course' ? course.name : `Hål ${h.n}`;
    ui.prev.hidden = ui.next.hidden = state.mode === 'course';
    const length = tee().metres ?? h.lengths[0];
    /* A fix redraws an open sheet, and a button replaced under a finger loses its tap. */
    if (!ui.menuSheet.hidden && !state.pressingSheet) refreshMenu();
    if (!ui.holeSheet.hidden && !state.pressingSheet) refreshHole();
    const percent = value => `${(value * 100).toFixed(1).replace('.', ',')} %`;
    ui.facts.textContent = previewing() ? (roundUnderWay() ? `Förhandsvisning · spelar hål ${state.playing}` : `Förhandsvisning · Par ${h.par}`) : state.greenGrid
      ? `Snitt ${percent(state.greenGrid.mean)} · max ${percent(state.greenGrid.max)}`
      : state.mode === 'course'
      ? `${course.holes.length} hål · par ${course.par} · Tryck på ett hål`
      : [`Par ${h.par}`, length ? `${length} m` : null, h.index ? `Index ${h.index}` : null].filter(Boolean).join(' · ');
    ui.holeText.setAttribute('aria-label', [ui.hole.textContent, ui.facts.textContent, 'Öppna hålinformation'].join('. '));
    const detailedTarget = `${BASE}${detailedUrl(slug, { hole: h.n, tee: state.tee + 1 })}`;
    const playTarget = `${BASE}${playUrl(slug, { hole: h.n, tee: state.tee + 1 })}`;
    if (ui.play.getAttribute('href') !== playTarget) {
      ui.play.href = playTarget;
      ui.play.textContent = `Spela hål ${h.n} i simulatorn`;
    }
    if (ui.full.getAttribute('href') !== detailedTarget) {
      ui.full.href = detailedTarget;
      ui.full.textContent = `Utforska hål ${h.n} i Detaljerad 3D`;
    }
    if (ui.clubOverview) {
      const clubHref = hubUrl(`klubb/${encodeURIComponent(clubIdFor(slug))}?bana=${encodeURIComponent(slug)}&lage=karta&hal=${h.n}&tee=${state.tee + 1}`);
      if (ui.clubOverview.getAttribute('href') !== clubHref) ui.clubOverview.href = clubHref;
    }
    ui.green.hidden = state.mode === 'course';
    ui.profile.hidden = state.mode === 'course';
    ui.legend.hidden = !state.greenView;
    ui.overview.setAttribute('aria-pressed', String(state.mode === 'course'));
    if (ui.greenCueText) ui.greenCueText.textContent = state.greenView ? 'Tillbaka' : 'Greenvy';

    refreshShotGuidance();
    refreshProfile();
    refreshFloat();
  }

  function onMeasuredGreen(position) {
    return position.source !== 'tee' && !course.greensApproximate
      && surfaceAt(position.point, hole()) === 'green';
  }

  function greenSpokenFrom() {
    return ui.from.textContent;
  }

  function refreshGreenPlays() {
    if (state.mode !== 'hole') {
      ui.greenPlays.hidden = true;
      return;
    }
    const h = hole(), from = origin();
    const { centre } = greenNumbers(from, h.green);
    const onTheGreen = onMeasuredGreen(guidancePosition());
    const reading = !onTheGreen ? shotReading(from, h.green.c, store.heightAt, air()) : null;
    const plays = reading?.plays != null ? Math.round(reading.plays) : null;
    const flat = Math.round(centre);
    const show = !onTheGreen && Number.isFinite(plays) && Math.abs(plays - flat) >= 2;
    ui.greenPlays.hidden = !show;
    const text = show ? `Spelas ${plays} m` : '';
    if (ui.greenPlays.textContent !== text) ui.greenPlays.textContent = text;
    if (!onTheGreen) {
      const spoken = `Till greenen ${greenSpokenFrom()}: fram ${ui.front.textContent}, mitt ${ui.mid.textContent}, bak ${ui.back.textContent} meter${show ? `, spelas ${plays} meter` : ''}.`;
      ui.green.setAttribute('aria-label', `${spoken} Tryck för att ${state.greenView ? 'gå tillbaka till hålet' : 'se greenen nära'}.`);
    }
  }

  /* Floating camera & smart GPS/recentre controls above the bottom dock. */
  function refreshFloat() {
    const walking = gps.active;
    const previewStart = canStartFromPreview();
    root.classList.toggle('is-map-preview', previewStart);
    if (ui.menuScoreBtn) ui.menuScoreBtn.hidden = previewStart;
    root.classList.toggle('has-map-target', Boolean(state.target));
    const say = (element, value) => { if (element.ariaLabel !== value) element.setAttribute('aria-label', value); };
    const elsewhere = state.hole !== state.playing || (state.previewOnly && roundUnderWay());
    const needsRecentre = state.mode === 'hole' && (state.viewMoved || state.greenView || elsewhere || (walking && !state.follow));
    /* When GPS is active, the GPS pill itself acts as Recentre when panned away;
       show the standalone Recentre button only when GPS is off. */
    ui.gps.classList.toggle('is-recentre', walking && needsRecentre);
    ui.recentre.hidden = walking || !needsRecentre;
    say(ui.recentre, elsewhere ? `Tillbaka till hål ${state.playing}` : 'Tillbaka till hålet');
    /* Kept in the layout, so the wheel keeps its place while the course is shown. */
    ui.wheel.classList.toggle('is-away', state.mode !== 'hole');
    ui.logShot.disabled = state.mode !== 'hole' && !state.pendingLock;
    const shownView = state.mode === 'course' ? 'course' : state.greenView ? 'green' : state.view;
    const viewName = VIEW_NAMES[shownView ?? 'hole'] ?? 'Hela hålet';
    if (ui.viewLabel.textContent !== viewName) ui.viewLabel.textContent = viewName;
    ui.viewToggle.setAttribute('aria-label', `Kameravy, ${viewName}`);
    for (const button of ui.views.querySelectorAll('[data-view]')) {
      const pressed = String(button.dataset.view === (state.mode === 'course' ? null : shownView));
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    }
    if (ui.menuViews) {
      for (const button of ui.menuViews.querySelectorAll('[data-quick-view]')) {
        const pressed = String(button.dataset.quickView === shownView);
        if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
      }
    }
    /* Show contextual recentre icon whenever panned away from hole (including when GPS is active on mobile). */
    ui.recentre.hidden = !needsRecentre;
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
    const points = smoothProfile(line.points, 3);
    const position = guidancePosition();
    const you = position.source === 'tee' ? null : placeOnProfile(position.point, path, line, ON_THE_STRIP_METRES);
    const walked = you?.share ?? 0;
    const shareOf = i => i / (points.length - 1);

    /* The height scale belongs to the ground still to come, so a rise before the
       green reads as one however big the hole's hills were. Ground already walked
       may run past it, and rests against the strip's edges. */
    const ahead = points.filter((_, i) => shareOf(i) >= walked);
    const low = Math.min(...ahead), high = Math.max(...ahead);
    const range = Math.max(high - low, 10);
    const y = value => clamp(34 - (value - low) / range * 26, 5, 37);
    const curve = points.map((value, i) => `${i ? 'L' : 'M'}${(stripX(shareOf(i), walked) * 300).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    ui.profileLine.setAttribute('d', curve);
    ui.profileFill.setAttribute('d', `${curve} L300 44 L0 44 Z`);

    const atShare = share => {
      const exact = clamp(share, 0, 1) * (points.length - 1);
      const i = Math.floor(exact), t = exact - i;
      const a = points[i], b = points[Math.min(points.length - 1, i + 1)];
      return a + (b - a) * t;
    };
    const mark = (element, place) => {
      element.hidden = !place;
      if (!place) return;
      element.dataset.share = place.share.toFixed(4);
      element.style.setProperty('--x', stripX(place.share, walked).toFixed(4));
      element.style.setProperty('--y', (y(atShare(place.share)) / 44).toFixed(4));
    };
    const target = state.guidance?.target;
    const aim = target ? placeOnProfile(target, path, line) : null;
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
    state.hole = clamp(number, 1, course.holes.length);
    state.scoreHole = null;
    setAim(null);
    state.justLocked = false;
    leaveGreen();
    refreshTrail();
    if (state.previewOnly) clearEntryAddress(true);
    if (!roundUnderWay()) remember(`${HOLE_KEY}:${course.slug}`, JSON.stringify({ value: state.hole, at: Date.now() }));
    if (!ui.scoreSheet.hidden) refreshScore();
    state.mode = 'hole';
    /* The tiles for this hole, ahead of need: the flight lands on 1 m ground
       instead of waiting for it. */
    store.prefetch(hole().tileIds.map(id => store.nodes.get(id)).filter(Boolean));
    refreshNumbers();
    if (fly) frameHole();
    invalidate();
  }

  function showCourse() {
    state.mode = 'course';
    setAim(null);
    planner.clear();
    state.follow = false;
    refreshNumbers();
    frameCourse();
  }

  /* ---- position ---- */
  const screenLock = createScreenLock();
  const clock = () => performance.now() + state.clockAhead;
  const gpsClock = () => Date.now() + state.clockAhead;
  const guidanceFix = createGuidanceFix();
  let guidanceTimer = 0, latestTimestamp = -Infinity;
  function guidancePosition() {
    return guidanceFix.origin(teePoint(), state.located && state.playing === state.hole, gpsClock());
  }
  function interruptGuidance() {
    clearTimeout(guidanceTimer);
    if (gps.active) setGpsState('retry');
    if (!guidanceFix.expiresAt) return;
    guidanceFix.interrupt();
    refreshNumbers();
    invalidate();
  }
  function scheduleGuidanceExpiry() {
    clearTimeout(guidanceTimer);
    if (!guidanceFix.expiresAt) return;
    const remaining = guidanceFix.expiresAt - gpsClock();
    if (remaining <= 0) {
      interruptGuidance();
      if (gps.active && !document.hidden) gps.ask();
    } else guidanceTimer = setTimeout(scheduleGuidanceExpiry, remaining);
  }
  const teeWatch = createTeeWatch();
  let teeTimer = 0, lastTeeTimestamp = -Infinity;
  const tentativeTee = () => guidanceFix.expiresAt > gpsClock() && teeWatch.candidate !== state.playing
    ? teeWatch.candidate : null;
  /* Mid-sentence on the card, or looking at something else: the tee can wait. */
  const busyElsewhere = () => state.mode === 'course' || state.greenView || sheets.some(([sheet]) => !sheet.hidden)
    || (!ui.prompt.hidden && ui.prompt.dataset.kind === 'putts');

  function moveOn(number, source = 'tee') {
    const previous = state.playing;
    if (previous === number) return;
    const played = state.started || Boolean(round.begunAt) || roundShots().some(shot => shot.hole === previous);
    finishOpenShot();
    undoPoint = null;
    closeSame();
    diary.add(source, number);
    state.follow = true;
    setPlayingHole(number);
    state.started = true;
    state.owed = null;
    state.handPicked = false;
    goHole(number);
    if (played) askScore(previous);
    status(`Hål ${number}`, 2500);
  }

  function forgetTee() {
    clearTimeout(teeTimer);
    teeWatch.reset();
    state.owed = null;
  }

  function checkTee(sampleTime) {
    clearTimeout(teeTimer);
    const { player } = state;
    const previous = teeWatch.candidate;
    state.owed = teeWatch.update({
      point: player.point, accuracy: player.accuracy, now: sampleTime,
      holes: course.holes, playing: state.playing,
      fresh: !state.started && !roundUnderWay(),
    });
    if (state.owed !== null && !busyElsewhere()) {
      moveOn(state.owed);
    } else {
      if (teeWatch.candidate !== previous) {
        refreshLogAction();
        if (!ui.holeSheet.hidden && !state.pressingSheet) refreshHole();
        const number = tentativeTee();
        if (number && !previewing() && !busyElsewhere()) status(`Tee vid hål ${number}. Välj Spela hål ${number} under Hål för att byta nu.`, 4000);
      }
      /* A timer asks the sensor for evidence. Only a new sample advances the round. */
      if (teeWatch.waiting && gps.active) teeTimer = setTimeout(() => gps.ask(), TEE_RECHECK_MS);
    }
  }

  let farStatus = null;
  function receiveFix(coords, timestamp) {
      if (![coords?.latitude, coords?.longitude, coords?.accuracy, timestamp].every(Number.isFinite)
          || coords.accuracy < 0 || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
        forgetTee();
        interruptGuidance();
        return;
      }
      const age = Date.now() - timestamp;
      if (age < 0 || timestamp < latestTimestamp) return;
      latestTimestamp = timestamp;
      const [x, z] = gpsToLocal(coords, course.geo);
      const point = course.frame.toWorld(x, z);
      const nearby = nearestHole(point, course.holes, state.hole);
      const accuracy = coords.accuracy;
      const onCourse = Boolean(nearby) && nearby.distance <= OFF_COURSE_METRES;
      diary.fix(accuracy);
      const first = !state.player?.onCourse;
      const now = clock();
      state.lastCoords = coords;
      state.player = { point, accuracy: clamp(accuracy, 3, 60), onCourse, at: now - age };
      const sampleTime = timestamp + state.clockAhead;
      const usable = guidanceFix.receive(state.player, sampleTime, gpsClock());
      scheduleGuidanceExpiry();
      lastAccuracyText = `±${Math.max(1, Math.round(accuracy))} m`;
      setGpsState(usable ? (onCourse ? 'live' : 'outside') : 'retry');
      if (!usable) {
        forgetTee();
        refreshNumbers();
        invalidate();
        return;
      }
      const known = state.located;
      if (sampleTime - state.lastFixAt > FIX_GAP_MS) state.lost = true;
      state.lastFixAt = sampleTime;
      if (onCourse) remember(`${GPS_KEY}:${course.slug}`, JSON.stringify({ value: true, at: Date.now() }));
      if (!onCourse) {
        forgetTee();
        state.located = false;
        farStatus = nearby ? `${distanceText(nearby.distance)} från närmaste hål` : 'Positionen ligger utanför banan';
        status(farStatus);
        refreshNumbers();
        invalidate();
        return;
      }
      /* A first rough fix far off, then the right one: the dot is on the tee, and the
         words saying it is a mile away go with it. */
      if (farStatus && ui.status.textContent === farStatus) ui.status.hidden = true;
      farStatus = null;
      /* Place a new round once. A returning player may be standing in an adjacent
         fairway, so finding the signal again never closes the hole they were playing. */
      if (state.lost) forgetTee();
      const placing = (!known || state.lost) && nearby.distance <= FOLLOW_HOLE_METRES;
      const initial = placing && !known && !round.playingHole && !roundShots().length
        && !holesScored(round, course.holes) && state.follow && !state.handPicked && !state.previewOnly;
      if (placing) {
        state.located = true;
        state.lost = false;
      }
      if (initial) setPlayingHole(nearby.hole);
      if (initial && nearby.hole !== state.hole) {
        goHole(nearby.hole);
      } else {
        refreshNumbers();
        const from = state.framedFrom;
        if (state.follow && guidancePosition().source === 'gps'
            && (!from || Math.hypot(point[0] - from[0], point[1] - from[1]) > REFRAME_METRES)) frameHole(first ? 900 : 500);
      }
      if (timestamp > lastTeeTimestamp) {
        lastTeeTimestamp = timestamp;
        checkTee(sampleTime);
      }
      if (state.pendingLock && !state.pendingLock.retry) {
        const pending = state.pendingLock;
        if (pending.round !== round.id || pending.hole !== state.playing) clearPendingLock();
        else if (gpsClock() >= pending.expires) expirePendingLock();
        else if (fixCanRecord()) {
          clearPendingLock();
          lockClub(pending.club, { superseded: true });
        }
      }
      invalidate();
  }
  const gps = createGps({
    onFix: receiveFix,
    onFailure(message, { denied = false } = {}) {
      diary.add('gps-failed', message);
      gpsStatus(message, denied ? 10000 : 3200);
      forgetTee();
      if (!gps.active) stopGps(denied ? 'denied' : 'unavailable');
      else interruptGuidance();
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !gps.active) return;
    scheduleGuidanceExpiry();
    if (!guidanceFix.expiresAt) gps.ask();
  });

  let gpsArmTimer = 0, gpsWaitTimer = 0, gpsArmed = false, gpsState = 'off', lastAccuracyText = '', gpsMessage = '', roughNotedHole = null;
  function gpsStatus(message, hold) {
    gpsMessage = message;
    status(message, hold);
  }
  function setGpsState(next) {
    const recovered = next === 'live' && gpsState !== 'live';
    gpsState = next;
    if (recovered || next !== 'searching') clearTimeout(gpsWaitTimer);
    if (recovered) {
      clearTimeout(gpsArmTimer);
      gpsArmed = false;
      if (gpsMessage && ui.status.textContent === gpsMessage) ui.status.hidden = true;
      gpsMessage = '';
    }
    const labels = { off: 'GPS', searching: 'Söker…', retry: 'Sök GPS', denied: 'Tillåt GPS', unavailable: 'GPS saknas', outside: 'Utanför' };
    const actions = {
      off: 'Starta GPS', searching: 'Söker GPS. Tryck för att hämta en ny position.',
      retry: 'Sök GPS. Positionen är osäker.',
      denied: 'Tillåt GPS i webbläsarens inställningar och tryck för att söka igen.',
      unavailable: 'GPS saknas i den här webbläsaren.', outside: 'Utanför banan. Stäng av GPS i Meny vid behov.',
      live: `GPS, noggrannhet ${lastAccuracyText}. Tryck för att centrera eller uppdatera position.`,
    };
    ui.gpsLabel.textContent = labels[next] ?? lastAccuracyText;
    ui.gps.setAttribute('aria-label', actions[next]);
    ui.gps.setAttribute('aria-pressed', String(gps.active));
    ui.gps.classList.remove('is-armed');
    if (ui.menuGps) {
      ui.menuGps.checked = gps.active;
      ui.menuGpsSub.textContent = gps.active
        ? (next === 'live' ? `Aktiv (${lastAccuracyText})` : labels[next] ?? 'Aktiv')
        : 'Följer din position under rundan';
    }
    syncAutoSun();
  }
  function disarmGps() {
    clearTimeout(gpsArmTimer);
    gpsArmed = false;
    setGpsState(gpsState);
  }

  function stopGps(reason = 'off') {
    clearTimeout(gpsArmTimer);
    clearTimeout(gpsWaitTimer);
    clearTimeout(guidanceTimer);
    forgetTee();
    if (reason === 'off') clearPendingLock();
    else expirePendingLock();
    gpsArmed = false;
    gps.stop();
    screenLock.release();
    /* A revoked permission interrupts a round at the last usable fix. An
       intentional switch-off hands the map back to its tee preview. */
    if (reason === 'off') {
      guidanceFix.clear();
      state.located = false;
    } else guidanceFix.interrupt();
    latestTimestamp = -Infinity;
    lastTeeTimestamp = -Infinity;
    state.player = null;
    setGpsState(reason);
    refreshNumbers();
    invalidate();
  }

  function startGps() {
    clearTimeout(gpsArmTimer);
    clearTimeout(gpsWaitTimer);
    gpsArmed = false;
    gps.start();
    if (!gps.active) return;
    if (!display.get('allowSleep')) screenLock.hold();
    state.follow = true;
    setGpsState('searching');
    gpsWaitTimer = setTimeout(() => {
      if (gps.active && gpsState === 'searching') gpsStatus('Väntar på GPS-signal…', 4500);
    }, 8000);
  }

  ui.gps.onclick = () => {
    if (!gps.active) {
      if (previewing()) {
        state.previewOnly = false;
        state.handPicked = false;
        state.follow = true;
        clearEntryAddress();
        if (roundUnderWay() && state.hole !== state.playing) goHole(state.playing);
        else refreshNumbers();
      }
      startGps();
      return;
    }
    const elsewhere = state.hole !== state.playing || (state.previewOnly && roundUnderWay());
    if (state.mode !== 'hole' || state.viewMoved || state.greenView || elsewhere || !state.follow) {
      recentre();
      return;
    }
    gps.ask();
    if (gpsState === 'retry' || gpsState === 'searching') {
      setGpsState('searching');
      gpsStatus('Söker ny GPS-position…', 2500);
    } else {
      status('GPS aktiv · stäng av i Meny vid behov', 2200);
    }
  };
  if (ui.menuGps) {
    ui.menuGps.onchange = () => {
      if (ui.menuGps.checked) {
        if (!gps.active) startGps();
      } else {
        stopGps();
        remember(`${GPS_KEY}:${course.slug}`, '');
        status('GPS avstängd', 2500);
      }
    };
  }

  /* Back to the shot in hand: to where the player is, or to the hole. */
  function recentre() {
    if (roundUnderWay()) {
      state.previewOnly = false;
      clearEntryAddress();
    }
    state.follow = true;
    state.handPicked = false;
    if (state.hole !== state.playing) {
      goHole(state.playing);
      return;
    }
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

  function setViewMenu(open) {
    if (open) panels.open({ name: 'camera', opener: '[data-view-toggle]' });
    else if (panels.current?.name === 'camera') panels.back();
  }
  ui.viewToggle.onclick = event => {
    event.stopPropagation();
    setViewMenu(ui.viewMenu.hidden);
  };
  document.addEventListener('pointerdown', event => {
    if (!ui.viewMenu.hidden && !ui.viewWrap.contains(event.target)) setViewMenu(false);
  }, true);

  /* A tap also brings the view back after a finger has moved it, as the round button
     does, and it keeps following the player from then on. */
  for (const button of ui.views.querySelectorAll('[data-view]')) {
    button.onclick = () => {
      setViewMenu(false);
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

  /* Browsing a neighbouring hole keeps the card and the shot log on the ball. */
  const pickHole = number => {
    diary.add('picked', number);
    if (!roundUnderWay() && !state.located && !state.previewOnly) state.playing = number;
    state.follow = false;
    state.handPicked = true;
    teeWatch.manual();
    state.owed = null;
    goHole(number);
  };
  const stepHole = direction => pickHole(((state.hole - 1 + direction + course.holes.length) % course.holes.length) + 1);
  $('[data-prev]').onclick = () => stepHole(-1);
  $('[data-next]').onclick = () => stepHole(1);
  /* A sideways swipe along the header turns the page, guarded by a < 25 deg angle check. */
  let swipeFrom = null, swiped = false;
  ui.holeBar.addEventListener('pointerdown', event => {
    swipeFrom = { x: event.clientX, y: event.clientY };
    swiped = false;
  });
  ui.holeBar.addEventListener('pointerup', event => {
    if (!swipeFrom) return;
    const dx = event.clientX - swipeFrom.x;
    const dy = event.clientY - swipeFrom.y;
    swipeFrom = null;
    if (state.mode === 'course' || Math.abs(dx) < 48 || Math.abs(dy) >= Math.abs(dx) * 0.47) return;
    swiped = true;
    stepHole(dx < 0 ? 1 : -1);
  });
  ui.holeBar.addEventListener('pointercancel', () => { swipeFrom = null; });
  ui.holeBar.addEventListener('click', event => {
    if (!swiped) return;
    swiped = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  /* Prevent scroll/wheel on sheets and HUD rails from accidentally orbiting the 3D canvas. */
  for (const el of root.querySelectorAll('.map-sheet, .map-desk-rail, .map-shortcuts-pop')) {
    el.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
    el.addEventListener('pointerdown', event => event.stopPropagation());
  }
  /* Quick actions inside Meny: Scorekort, Hålguide, Kameravy, Clean View */
  if (ui.menuScoreBtn) {
    ui.menuScoreBtn.onclick = () => {
      state.scoreHole = null;
      showSheet(ui.scoreSheet, { opener: ui.menu, replace: true });
    };
  }
  if (ui.menuHoleBtn) {
    ui.menuHoleBtn.onclick = () => {
      showSheet(ui.holeSheet, { opener: ui.menu, replace: true });
    };
  }
  if (ui.menuViews) {
    for (const button of ui.menuViews.querySelectorAll('[data-quick-view]')) {
      button.onclick = () => {
        const view = button.dataset.quickView;
        if (!isDesktop() || !state.deskOpen) showSheet(null);
        if (view === 'course') {
          if (state.mode !== 'course') showCourse();
          return;
        }
        state.mode = 'hole';
        if (view === 'green') {
          if (!state.greenView) frameGreen();
          return;
        }
        state.view = view;
        remember(VIEW_KEY, view);
        state.follow = true;
        frameHole(500);
        refreshNumbers();
      };
    }
  }
  function setCleanView(on) {
    const next = Boolean(on);
    root.classList.toggle('is-clean', next);
    ui.cleanExit.hidden = !next;
    if (next) {
      setShortcutsOpen(false);
      if (panels.current) panels.close();
      ui.cleanExit.focus({ preventScroll: true });
    } else {
      ui.menu.focus({ preventScroll: true });
    }
  }
  ui.cleanExit.onclick = () => setCleanView(false);
  if (ui.menuClean) ui.menuClean.onclick = () => setCleanView(true);
  function setShortcutsOpen(open) {
    const next = Boolean(open);
    ui.shortcutsPop.hidden = !next;
    for (const btn of ui.shortcutsBtns) btn.setAttribute('aria-expanded', String(next));
    if (next) ui.shortcutsPop.querySelector('[data-shortcuts-close]')?.focus({ preventScroll: true });
  }
  for (const btn of ui.shortcutsBtns) {
    btn.onclick = event => {
      event.stopPropagation();
      setShortcutsOpen(ui.shortcutsPop.hidden);
    };
  }
  $('[data-shortcuts-close]').onclick = () => setShortcutsOpen(false);
  document.addEventListener('pointerdown', event => {
    if (!ui.shortcutsPop.hidden && !ui.shortcutsPop.contains(event.target) && !event.target.closest('[data-shortcuts-btn], [data-shortcuts-btn-alt]')) {
      setShortcutsOpen(false);
    }
  }, true);
  ui.overview.onclick = () => {
    setViewMenu(false);
    if (state.mode === 'course') { state.follow = Boolean(state.player); goHole(state.hole); } else showCourse();
  };
  const menuTabs = [...ui.menuSheet.querySelectorAll('[data-menu-tab]')];
  function setMenuTab(tab) {
    state.menuTab = menuTabs.some(button => button.dataset.menuTab === tab) ? tab : 'runda';
    for (const button of menuTabs) {
      const selected = button.dataset.menuTab === state.menuTab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const pane of ui.menuSheet.querySelectorAll('[data-menu-pane]')) {
      pane.hidden = pane.dataset.menuPane !== state.menuTab;
    }
  }
  for (const [index, button] of menuTabs.entries()) {
    const tab = button.dataset.menuTab;
    const pane = ui.menuSheet.querySelector(`[data-menu-pane="${tab}"]`);
    button.id = `map-menu-tab-${tab}`;
    pane.id = `map-menu-pane-${tab}`;
    button.setAttribute('aria-controls', pane.id);
    pane.setAttribute('aria-labelledby', button.id);
    button.onclick = () => { setMenuTab(tab); panels.update({ tab }); };
    button.onkeydown = event => {
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: menuTabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      const choice = menuTabs[(next + menuTabs.length) % menuTabs.length];
      choice.focus();
      choice.click();
    };
  }
  /* ---- the sheets ---- */
  const sheets = [
    [ui.menuSheet, ui.menu, 'menu'], [ui.clubsSheet, ui.menu, 'clubs'],
    [ui.roundsSheet, ui.menu, 'rounds'], [ui.roundSheet, ui.score, 'round'], [ui.scoreSheet, ui.score, 'score'],
    [ui.holeSheet, ui.holeTool, 'hole'], [ui.startSheet, null, 'start'],
  ];
  for (const [sheet, , name] of sheets) {
    sheet.id = `map-${name}-sheet`;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.tabIndex = -1;
  }
  const invitations = [
    [ui.menu, ui.menuSheet], [ui.score, ui.scoreSheet], [ui.holeTool, ui.holeSheet], [ui.holeText, ui.holeSheet],
    [$('[data-clubs-open]'), ui.clubsSheet], [$('[data-rounds-open]'), ui.roundsSheet],
  ];
  for (const [button, sheet] of invitations) {
    button.setAttribute('aria-controls', sheet.id);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
  }
  /* Focus goes into a sheet and back to where it was, so a screen reader or a keyboard
     never has to find its way across the whole map. */
  let activeSheet = null, canonicalMapAddress = null;
  let refreshOffline = () => {};
  const panels = createPanelHistory({ history: window.history, key: 'banvyMapPanels', course: course.slug, render: renderPanels });
  window.addEventListener('popstate', event => {
    panels.restore(event.state);
    // A start or preview instruction may have been consumed while its sheet was open.
    if (canonicalMapAddress && location.href !== canonicalMapAddress) {
      window.history.replaceState(window.history.state, '', canonicalMapAddress);
    }
  });
  function showSheet(sheet, { opener, replace = false } = {}) {
    if (!sheet) { if (panels.current) panels.close(); return; }
    const [, owner, name] = sheets.find(([each]) => each === sheet);
    const active = document.activeElement;
    const trigger = opener ?? (active?.matches('button, a[href]') && !active.closest('[hidden]') ? active : owner);
    // Score edits are saved immediately. A golfer exploring the course must start
    // a round first, unless they explicitly opened a completed card to correct it.
    if (sheet === ui.scoreSheet && canStartFromPreview()
        && !(round.endedAt && panels.current?.name === 'round')) {
      openStart(state.hole, { opener: trigger });
      return;
    }
    const data = trigger?.getAttributeNames().find(key => key.startsWith('data-'));
    const selector = data ? `[${data}${trigger.getAttribute(data) ? '=' + CSS.escape(trigger.getAttribute(data)) : ''}]` : null;
    const panel = { name, opener: selector };
    if (sheet === ui.menuSheet) panel.tab = state.menuTab;
    if (sheet === ui.startSheet) panel.setup = { ...startSetup };
    if (sheet === ui.scoreSheet) { panel.hole = state.scoreHole; panel.round = round.id; }
    if (sheet === ui.roundSheet) { panel.round = state.roundShown.id; panel.course = state.roundShown.course; }
    panels.open(panel, { replace });
  }
  function renderPanels(path, previous) {
    const panel = path.at(-1), parent = path.at(-2);
    const cameraOpen = panel?.name === 'camera', wasCamera = !ui.viewMenu.hidden;
    const open = sheets.find(([, , name]) => name === panel?.name)?.[0] ?? null;
    const wasOpen = activeSheet, wasStart = wasOpen === ui.startSheet;
    let record;
    if (open === ui.roundSheet) {
      record = panel.round === round.id && panel.course === course.slug ? thisRecord()
        : rounds.find(each => each.id === panel.round && each.course === panel.course);
    }
    // A forward entry can outlive the round it referred to, e.g. after deletion.
    if ((open === ui.roundSheet && !record) || (open === ui.scoreSheet && panel.round !== round.id)
        || (open === ui.startSheet && roundUnderWay())) { panels.back(); return; }
    ui.viewMenu.hidden = !cameraOpen;
    ui.viewToggle.setAttribute('aria-expanded', String(cameraOpen));
    activeSheet = open;
    for (const [sheet] of sheets) sheet.hidden = sheet !== open;
    const rootTool = sheets.find(([, , name]) => name === path[0]?.name)?.[1];
    for (const [button, sheet] of invitations) {
      const expanded = button === rootTool || (sheet === open && ![ui.menu, ui.score].includes(button));
      button.setAttribute('aria-expanded', String(expanded));
    }
    ui.backdrop.hidden = !open;
    root.classList.toggle('has-sheet', Boolean(open));
    if (wasOpen === ui.scoreSheet && open !== ui.scoreSheet) resetEndConfirm();
    state.fromRound = open === ui.scoreSheet && parent?.name === 'round';
    if (open === ui.menuSheet) { setMenuTab(panel.tab); refreshMenu(); }
    if (open === ui.clubsSheet) refreshClubs();
    if (open === ui.roundsSheet) refreshRounds();
    if (open === ui.roundSheet) renderRoundSheet(record, parent?.name === 'rounds');
    if (open === ui.holeSheet) prepareHoleSheet();
    if (open === ui.scoreSheet) { state.scoreHole = panel.hole ?? null; refreshScore(); }
    if (open === ui.startSheet) { startSetup = restoreStartSetup(panel.setup); refreshStart(); }
    if (open === ui.startSheet || open === ui.menuSheet) refreshOffline();
    if (isDesktop() && state.deskOpen) syncDesktopDock();
    // On the way back, restore the actual inviting control inside its parent.
    // Dynamic round and score rows may have been rebuilt since the tap.
    const selector = previous.length > path.length ? previous[path.length].opener : null;
    const returnTo = selector && (open ?? root).querySelector(selector);
    if (open) {
      if (ui.status.classList.contains('is-low')) ui.status.hidden = true;
      if (!returnTo) open.scrollTop = 0;
      if (!isDesktop() || !state.deskOpen || open === ui.startSheet) (returnTo || open).focus({ preventScroll: true });
      if (returnTo) returnTo.scrollIntoView({ block: 'nearest' });
      diary.add('sheet', open.getAttribute('aria-label'));
    } else if (cameraOpen) {
      (ui.viewMenu.querySelector('[aria-pressed="true"]') ?? ui.viewMenu.querySelector('button')).focus({ preventScroll: true });
    } else if (wasOpen || wasCamera) {
      const owner = sheets.find(([sheet]) => sheet === wasOpen)?.[1];
      if (!isDesktop() || !state.deskOpen) (returnTo && !returnTo.closest('[hidden]') ? returnTo : wasCamera ? ui.viewToggle : owner ?? ui.gps).focus({ preventScroll: true });
      if (wasOpen) { reframeForLayout(); revealLanding(state.guidance?.target); }
    }
    if (wasStart && open !== ui.startSheet) {
      if (!roundUnderWay()) {
        remember(LOOK_KEY, JSON.stringify({ value: true, at: Date.now() }));
        state.previewOnly = true;
        state.follow = false;
        state.handPicked = true;
        clearEntryAddress(true);
        refreshNumbers();
      }
      firstTip();
    }
  }
  ui.backdrop.onclick = () => panels.close();
  root.addEventListener('pointerdown', event => { state.pressingSheet = Boolean(event.target.closest('.map-sheet')); }, true);
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, () => { state.pressingSheet = false; }, true);
  for (const selector of ['[data-clubs-back]', '[data-rounds-back]', '[data-round-back]']) {
    $(selector).onclick = () => panels.back();
  }
  function syncDesktopDock() {
    const desk = isDesktop();
    const docked = desk && state.deskOpen;
    root.classList.toggle('is-desktop', desk);
    root.classList.toggle('is-desk-open', docked);
    ui.deskRail.hidden = !docked;
    if (ui.deskCollapsedBar) ui.deskCollapsedBar.hidden = !desk || docked;
    ui.deskOpen.hidden = !desk || docked;
    const modalSheet = activeSheet === ui.startSheet;
    if (docked) {
      const subSheet = activeSheet && !modalSheet && ![ui.holeSheet, ui.scoreSheet, ui.menuSheet].includes(activeSheet) ? activeSheet : null;
      const shown = subSheet ?? { hole: ui.holeSheet, score: ui.scoreSheet, menu: ui.menuSheet }[state.deskTab] ?? ui.holeSheet;
      for (const [sheet] of sheets) {
        const isModal = sheet === ui.startSheet && modalSheet;
        sheet.hidden = !(sheet === shown || isModal);
        sheet.classList.toggle('is-desk-docked', sheet === shown);
        sheet.setAttribute('aria-modal', String(isModal));
      }
      ui.backdrop.hidden = !modalSheet;
      root.classList.toggle('has-sheet', modalSheet);
      for (const btn of ui.deskRail.querySelectorAll('[data-desk-tab]')) {
        btn.setAttribute('aria-selected', String(btn.dataset.deskTab === state.deskTab));
      }
      if (shown === ui.holeSheet) prepareHoleSheet();
      if (shown === ui.scoreSheet) refreshScore();
      if (shown === ui.menuSheet) { refreshMenu(); refreshOffline(); }
    } else {
      for (const [sheet] of sheets) {
        sheet.classList.remove('is-desk-docked');
        sheet.hidden = sheet !== activeSheet;
        sheet.setAttribute('aria-modal', 'true');
      }
      ui.backdrop.hidden = !activeSheet;
      root.classList.toggle('has-sheet', Boolean(activeSheet));
    }
    fitLayout();
    reframeForLayout();
    invalidate();
  }
  function selectDeskTab(tab) {
    if (tab === 'score' && canStartFromPreview() && !round.endedAt) {
      openStart(state.hole);
      return;
    }
    state.deskOpen = true;
    state.deskTab = tab;
    if (tab === 'score') state.scoreHole = null;
    if (panels.current) panels.close();
    syncDesktopDock();
  }
  function toggleDeskRail() {
    state.deskOpen = !state.deskOpen;
    if (!state.deskOpen && panels.current && activeSheet !== ui.startSheet) panels.close();
    syncDesktopDock();
  }
  ui.deskCourse.textContent = course.name;
  ui.deskCollapse.onclick = toggleDeskRail;
  ui.deskOpen.onclick = toggleDeskRail;
  for (const btn of ui.deskRail.querySelectorAll('[data-desk-tab]')) {
    btn.onclick = () => selectDeskTab(btn.dataset.deskTab);
  }
  desktopQuery.addEventListener('change', () => {
    state.deskOpen = desktopQuery.matches;
    syncDesktopDock();
  });

  function openTool(sheet, opener) {
    if (isDesktop()) {
      const tab = sheet === ui.holeSheet ? 'hole' : sheet === ui.scoreSheet ? 'score' : 'menu';
      if (state.deskOpen && state.deskTab === tab && !panels.current) { toggleDeskRail(); return; }
      selectDeskTab(tab);
      return;
    }
    const toggleOff = opener.getAttribute('aria-expanded') === 'true';
    if (panels.current) panels.close();
    if (!toggleOff) showSheet(sheet, { opener });
  }
  ui.menu.onclick = () => {
    state.menuTab = 'runda';
    openTool(ui.menuSheet, ui.menu);
  };
  $('[data-clubs-open]').onclick = event => showSheet(ui.clubsSheet, { opener: event.currentTarget });
  ui.score.onclick = () => {
    state.scoreHole = null;
    openTool(ui.scoreSheet, ui.score);
  };
  ui.holeNoteMore.onclick = () => {
    ui.note.classList.remove('is-clamped');
    ui.holeNoteMore.hidden = true;
  };
  $('[data-rounds-open]').onclick = event => showSheet(ui.roundsSheet, { opener: event.currentTarget });
  function prepareHoleSheet() {
    state.correcting = null;
    refreshHole();
  }
  const stepHoleSheet = direction => {
    const count = course.holes.length;
    const next = ((state.hole - 1 + direction + count) % count) + 1;
    pickHole(next);
    prepareHoleSheet();
  };
  $('[data-hole-prev]').onclick = () => stepHoleSheet(-1);
  $('[data-hole-next]').onclick = () => stepHoleSheet(1);
  ui.holeTool.onclick = ui.holeText.onclick = event => openTool(ui.holeSheet, event.currentTarget);
  for (const button of root.querySelectorAll('[data-close]')) button.onclick = () => {
    if (isDesktop() && state.deskOpen && !panels.current) { toggleDeskRail(); return; }
    showSheet(null);
  };
  const MAP_CAMERA_CYCLE = Object.freeze(['hole', 'green', 'above', 'course']);
  const LIGHT_CYCLE = Object.freeze(['nu', ...MAP_LIGHTS.map(each => each.key)]);
  const shortcuts = createShortcutKeys({
    holes: course.holes.length,
    onAction(action) {
      if (action.type === 'hole') { pickHole(action.hole); return; }
      if (action.type === 'prev') { stepHole(-1); return; }
      if (action.type === 'next') { stepHole(1); return; }
      if (action.type === 'camera') {
        const current = state.mode === 'course' ? 'course' : state.greenView ? 'green' : state.view;
        const next = nextInCycle(MAP_CAMERA_CYCLE, current);
        if (next === 'course') showCourse();
        else if (next === 'green') frameGreen();
        else {
          state.mode = 'hole';
          state.view = next;
          remember(VIEW_KEY, next);
          state.follow = true;
          frameHole(500);
          refreshNumbers();
        }
        return;
      }
      if (action.type === 'light') {
        const next = nextInCycle(LIGHT_CYCLE, state.lightKey);
        if (next === 'nu') pickNow(); else setLight(next);
        status(`Ljus: ${next === 'nu' ? 'Nu' : lightByKey(next)?.label ?? next}`, 1800, true);
        return;
      }
      if (action.type === 'clean') {
        setCleanView(!root.classList.contains('is-clean'));
        return;
      }
      if (action.type === 'markers') {
        openTool(ui.menuSheet, ui.menu);
      }
    },
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (root.classList.contains('is-clean')) { event.preventDefault(); setCleanView(false); return; }
      if (!ui.shortcutsPop.hidden) { event.preventDefault(); setShortcutsOpen(false); return; }
      if (panels.current) { event.preventDefault(); panels.back(); return; }
      if (state.target) { event.preventDefault(); setAim(null); refreshNumbers(); invalidate(); return; }
      if (state.greenView) { event.preventDefault(); recentre(); return; }
      return;
    }
    if (root.classList.contains('has-sheet') && activeSheet && event.key === 'Tab') {
      const stops = [...activeSheet.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
      const first = stops[0], last = stops.at(-1);
      if (!first || (event.shiftKey ? [first, activeSheet].includes(document.activeElement) : document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
      return;
    }
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target?.isContentEditable) return;
    const lower = event.key.length === 1 ? event.key.toLowerCase() : '';
    const undoKey = lower === 'z' && !event.altKey && !event.shiftKey;
    if (root.classList.contains('has-sheet')) {
      if (undoKey && !ui.scoreSheet.hidden && scoreUndo) { event.preventDefault(); undoScore(); }
      return;
    }
    if (undoKey && (scoreUndo || undoPoint)) {
      event.preventDefault();
      if (scoreUndo && (lastUndoWasScore || !undoPoint)) undoScore();
      else takeBack();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target?.closest?.('[data-wheel-list]') && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
    if (event.key === '?') { event.preventDefault(); setShortcutsOpen(ui.shortcutsPop.hidden); return; }
    if (lower === 'i') { event.preventDefault(); if (isDesktop()) toggleDeskRail(); else openTool(ui.holeSheet, ui.holeTool); return; }
    if (lower === 'b') { event.preventDefault(); openTool(ui.holeSheet, ui.holeTool); return; }
    if (lower === 'g') { event.preventDefault(); if (state.mode === 'hole') { if (state.greenView) recentre(); else frameGreen(); } return; }
    if (lower === 'r') { event.preventDefault(); recentre(); return; }
    if (lower === 's') { event.preventDefault(); state.scoreHole = null; openTool(ui.scoreSheet, ui.score); return; }
    if (lower === 'u') {
      event.preventDefault();
      const next = !display.get('sun');
      display.set('sun', next);
      syncSunUi();
      fitLayout();
      reframeForLayout();
      invalidate();
      status(next ? 'Dagläge på' : 'Nattläge på', 1600, true);
      return;
    }
    if (shortcuts.press(event.key)) event.preventDefault();
  });
  document.addEventListener('focusin', event => {
    if (root.classList.contains('has-sheet') && activeSheet && !activeSheet.contains(event.target)) activeSheet.focus({ preventScroll: true });
  });

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
  function previewing() {
    return state.mode === 'hole' && (state.previewOnly || state.hole !== state.playing);
  }

  function playHole(number, wasPlaying = roundUnderWay()) {
    forgetTee();
    state.follow = true;
    state.handPicked = false;
    state.previewOnly = false;
    clearEntryAddress();
    if (wasPlaying && number !== state.playing) {
      moveOn(number, 'picked-to-play');
      return;
    }
    setPlayingHole(number);
    goHole(number);
  }

  const playableHole = () => previewing() ? state.hole : tentativeTee();
  $('[data-play-hole]').onclick = event => {
    const number = Number(event.currentTarget.dataset.playHole);
    if (!number || number !== playableHole()) { refreshHole(); return; }
    if (canStartFromPreview()) { openStart(number, { opener: event.currentTarget }); return; }
    const wasPlaying = roundUnderWay();
    if (round.endedAt) freshRound();
    round.begunAt ??= Date.now();
    playHole(number, wasPlaying);
    showSheet(null);
    if (!wasPlaying && !gps.active) startGps();
  };

  function refreshHole() {
    const h = hole(), hasHole = state.mode === 'hole';
    ui.holeSheetTitle.textContent = hasHole ? [`Hål ${h.n}`, h.name].filter(Boolean).join(' · ') : course.name;
    ui.profile.hidden = !hasHole;
    const play = $('[data-play-hole]');
    const playNumber = playableHole();
    play.hidden = !playNumber;
    play.dataset.playHole = String(playNumber ?? '');
    if (playNumber) play.textContent = `Spela hål ${playNumber}`;
    ui.note.textContent = hasHole ? h.note ?? '' : '';
    ui.note.hidden = !ui.note.textContent;
    ui.tip.hidden = ui.note.hidden;
    ui.note.classList.add('is-clamped');
    ui.holeNoteMore.hidden = ui.note.textContent.length < NOTE_CLAMP_LETTERS;
    const played = hasHole ? roundShots().filter(shot => shot.hole === h.n) : [];
    ui.shotsSection.hidden = !played.length;
    const strokes = played.filter(shot => !isPutt(shot)), putts = played.length - strokes.length;
    ui.shotsHint.hidden = !strokes.length;
    ui.holePenalty.hidden = !holePenaltyTarget(strokes);
    ui.holeUndo.hidden = !undoPoint;
    ui.shotList.replaceChildren(...strokes.map(shotRow), ...(putts ? [puttsRow(putts)] : []));
    const history = hasHole ? holeHistory(rounds, shots, course.slug, h.n) : null;
    ui.historySection.hidden = !history;
    if (history) renderHoleHistory(ui.history, { history, clubName });
    ui.hazardSection.hidden = !hasHole || !state.hazards.length;
    ui.hazardList.replaceChildren(...state.hazards.map((hazard, index) => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-hazard-btn';
      button.dataset.measureHazard = String(index);
      const name = hazard.kind === 'water' ? 'Vatten' : 'Bunker';
      const where = hazard.side === 'mitt' ? 'mitt i' : hazard.side;
      const approx = hazard.approximate ? '≈' : '';
      const front = Math.round(hazard.front);
      const far = hazard.carry !== null ? `förbi ${approx}${Math.round(hazard.carry)} m` : hazard.openWater ? 'slut okänt' : '';
      button.setAttribute('aria-label', `Mät till ${name}, ${where}, ${front} meter${far ? `, ${far}` : ''}`);
      button.innerHTML = `<i class="map-dot is-${hazard.kind}"></i><span>${name}, ${where}</span><b>${approx}${front} m</b><small>${far}</small>`;
      button.onclick = () => {
        setAim(hazard.at);
        if (!isDesktop() || !state.deskOpen) showSheet(null);
        refreshNumbers();
        revealLanding(state.guidance?.target);
        invalidate();
      };
      row.append(button);
      return row;
    }));
    ui.holes.replaceChildren(...course.holes.map(each => chip(String(each.n), hasHole && each.n === h.n, () => {
      if (!isDesktop() || !state.deskOpen) showSheet(null);
      pickHole(each.n);
    })));
  }

  function puttsRow(count) {
    const item = document.createElement('li');
    item.innerHTML = '<div class="map-shot"><i></i><span>Puttar</span><b></b></div>';
    item.querySelector('b').textContent = String(count);
    return item;
  }

  const holePenaltyTarget = strokes => [...strokes].reverse().find(shot => shot.outcome === 'played')
    ?? [...strokes].reverse().find(shot => shot.outcome !== 'out')
    ?? null;

  /* The whole row is the way in, and the bag opens right under it. */
  function shotRow(shot, index) {
    const item = document.createElement('li'), button = document.createElement('button');
    const name = clubName(shot.club), length = shotLength(shot), open = state.correcting === shot;
    const result = shot.outcome === 'out' ? 'Omslag' : length === null ? '–' : `${Math.round(length)} m${shot.suspect ? '?' : ''}`;
    const penaltyFlag = shot.penalty > 0 ? `+${shot.penalty} plikt` : '';
    button.className = 'map-shot';
    button.innerHTML = '<i></i><span><em class="map-shot-name"></em><small class="map-shot-penalty" hidden></small></span><b></b>';
    button.children[0].textContent = String(index + 1);
    button.querySelector('.map-shot-name').textContent = name;
    const flagEl = button.querySelector('.map-shot-penalty');
    if (penaltyFlag) {
      flagEl.textContent = ` · ${penaltyFlag}`;
      flagEl.hidden = false;
    }
    button.children[2].textContent = result;
    button.setAttribute('aria-expanded', String(open));
    button.setAttribute('aria-label', `Slag ${index + 1}, ${name}${penaltyFlag ? `, ${penaltyFlag}` : ''}, ${result === '–' ? 'ingen längd än' : result}. Rätta klubban eller plikt.`);
    button.onclick = () => {
      state.correcting = open ? null : shot;
      refreshHole();
      const row = ui.shotList.children[index];
      row.firstChild.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    };
    item.append(button);
    if (open) {
      const review = shotReviewText(shot, clubName);
      if (review) {
        const detail = document.createElement('p');
        detail.className = 'map-shots-hint';
        detail.textContent = review;
        item.append(detail);
      }
      const clubs = document.createElement('div');
      clubs.className = 'map-chips map-shot-clubs';
      clubs.setAttribute('role', 'group');
      clubs.setAttribute('aria-label', `Rätt klubba för slag ${index + 1}`);
      clubs.replaceChildren(...wheelClubs(bag).filter(club => club.carry > 0).map(club => chip(club.name, club.id === shot.club, () => correctShot(shot, club, index))));
      item.append(clubs);
      if (shot.outcome !== 'out') {
        const actions = document.createElement('div');
        actions.className = 'map-chips map-shot-penalties';
        actions.setAttribute('role', 'group');
        actions.setAttribute('aria-label', `Plikt för slag ${index + 1}`);
        const kids = [chip('Plikt +1', false, () => {
          applyPenalty(shot, 1, index);
          status(`Plikt +1 · slag ${index + 1}`);
        })];
        if (shot.penalty > 0) {
          kids.push(chip('Ta bort plikt', false, () => {
            applyPenalty(shot, -shot.penalty, index);
            status(`Plikt borttagen · slag ${index + 1}`);
          }));
        }
        actions.replaceChildren(...kids);
        item.append(actions);
      }
    }
    return item;
  }

  function applyPenalty(shot, delta = 1, focusIndex = null) {
    if (!shot) return;
    state.correcting = null;
    markUndo();
    shots = addPenalty(shots, shot, delta);
    saveShots();
    if (round.scores[shot.hole]?.logged) {
      const { strokes, putts } = holeTally(roundShots(), shot.hole);
      setScore({ strokes, putts, picked: false, logged: true }, shot.hole, true);
    }
    relearnBag();
    refreshHole();
    refreshScore();
    refreshShotGuidance();
    invalidate();
    if (focusIndex !== null) ui.shotList.children[focusIndex]?.firstChild?.focus({ preventScroll: true });
  }

  ui.holePenalty.onclick = () => {
    const strokes = roundShots().filter(shot => shot.hole === hole().n && !isPutt(shot));
    const target = holePenaltyTarget(strokes);
    if (!target) return;
    const index = strokes.indexOf(target);
    applyPenalty(target, 1);
    status(`Plikt +1 · slag ${index + 1}`);
  };

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
      if (underWay) { state.manualClub = club.id; wheel.rest(club.id, { reclaim: true }); }
      refreshShotGuidance();
      invalidate();
    }
    refreshHole();
    ui.shotList.children[index].firstChild.focus({ preventScroll: true });
  }

  const teeChips = (after = () => {}) => (course.tees?.names ?? []).map((name, index) => chip(name, index === state.tee, () => {
    state.tee = index;
    if (state.previewOnly) clearEntryAddress(true);
    else remember(`${TEE_KEY}:${course.slug}`, String(index));
    setAim(null);
    refreshNumbers();
    if (state.mode === 'hole') frameHole(500);
    invalidate();
    after();
  }));

  /* Each takes effect at once. The picture is framed again: the column may have moved. */
  function syncSunUi() {
    const mode = display.get('sunMode');
    if (ui.sun) ui.sun.checked = display.get('sun');
    if (ui.sunModes) {
      for (const btn of ui.sunModes.querySelectorAll('[data-sun-mode]')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.sunMode === mode));
      }
    }
  }
  function syncAutoSun() {
    const elev = lightNow(state.lightClock ?? new Date(), course.geo.origin.lat, course.geo.origin.lon).elevationDegrees;
    const active = gps.active || (typeof roundUnderWay === 'function' && roundUnderWay());
    const changed = display.setAutoContext({ solarElevation: elev, activeRound: active });
    syncSunUi();
    if (changed) {
      fitLayout();
      reframeForLayout();
      invalidate();
    }
  }
  for (const name of ['sun', 'large', 'left']) {
    ui[name].checked = display.get(name);
    ui[name].onchange = () => {
      display.set(name, ui[name].checked);
      syncSunUi();
      fitLayout();
      diary.add('display', [name, ui[name].checked]);
      reframeForLayout();
      invalidate();
    };
  }
  if (ui.sunModes) {
    for (const btn of ui.sunModes.querySelectorAll('[data-sun-mode]')) {
      btn.onclick = () => {
        display.set('sunMode', btn.dataset.sunMode);
        syncSunUi();
        fitLayout();
        reframeForLayout();
        invalidate();
      };
    }
  }
  if (ui.allowSleep) {
    ui.allowSleep.checked = display.get('allowSleep');
    ui.allowSleep.onchange = () => {
      display.set('allowSleep', ui.allowSleep.checked);
      if (ui.allowSleep.checked) screenLock.release();
      else if (gps.active) screenLock.hold();
    };
  }
  syncSunUi();
  setInterval(() => { if (!document.hidden) syncAutoSun(); }, NOW_REFRESH_MS);

  /* Sibling-course quick switcher (e.g. Bro Hof Stadium ⇄ Castle) inside Meny → Bana & läge. */
  let siblingCourses = [];
  fetch(`${BASE}courses/index.json`).then(r => r.ok ? r.json() : null).then(data => {
    const list = Array.isArray(data) ? data : data?.courses;
    if (!Array.isArray(list)) return;
    siblingCourses = clubLayouts(list, course.slug).filter(item => item.slug !== course.slug);
    if (!siblingCourses.length || !ui.siblingSection) return;
    const host = list.find(item => item.slug === course.slug);
    if (ui.siblingTitle) ui.siblingTitle.textContent = `Byt bana på ${host?.club || course.name}`;
    ui.siblingSection.hidden = false;
    renderSiblings();
  }).catch(() => {});
  function renderSiblings() {
    if (!ui.siblings || !siblingCourses.length) return;
    ui.siblings.replaceChildren(...siblingCourses.map(other => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-row map-row-next map-sibling-btn';
      const label = layoutLabel(other);
      const sub = `${other.holes || 18} hål · par ${other.par || 72}`;
      btn.innerHTML = `<span>${label}<small>${sub}</small></span><span class="map-row-value">Öppna</span>`;
      let armed = 0;
      btn.onclick = () => {
        if (roundUnderWay() && !armed) {
          const val = btn.querySelector('.map-row-value');
          if (val) val.textContent = `Pausa hål ${state.playing}? Tryck igen`;
          armed = setTimeout(() => { armed = 0; if (val) val.textContent = 'Öppna'; }, 4500);
          return;
        }
        clearTimeout(armed);
        if (roundUnderWay()) saveRound();
        location.href = `${BASE}${mapUrl(other.slug)}`;
      };
      return btn;
    }));
  }

  function refreshMenu() {
    $('[data-home]').textContent = roundUnderWay() ? 'Till startmenyn · rundan sparas' : 'Till startmenyn';
    $('[data-live-transfer]').hidden = !(getCloudState().user && roundUnderWay());
    const hasHole = state.mode === 'hole';
    ui.menuTitle.textContent = course.name;
    const showDiary = params.get('debug') === '1' || savedText('banvy:dev-overlay', '') === '1';
    $('[data-diary]').hidden = !showDiary;
    const logged = shots.filter(shot => shot.to && !isPutt(shot)).length;
    ui.clubsCount.textContent = logged ? `${logged} slag` : '';
    ui.roundsCount.textContent = rounds.length ? `${rounds.length} ${rounds.length === 1 ? 'runda' : 'rundor'}` : '';
    /* with rounds kept on this course, a way to it in Statistik, hole by hole */
    const here = rounds.filter(record => record.course === course.slug).length;
    const courseStats = document.querySelector('[data-course-stats]');
    if (courseStats) {
      courseStats.style.display = here ? '' : 'none';
      courseStats.href = hubUrl(`statistik/${encodeURIComponent(course.slug)}`);
      courseStats.querySelector('[data-course-stats-name]').textContent = `${course.name}, hål för hål`;
      courseStats.querySelector('[data-course-stats-count]').textContent = here === 1 ? 'Din runda här' : `${here} rundor här`;
    }
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
    ui.rings.checked = state.showRings;
    setMenuTab(state.menuTab);
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

  ui.rings.onchange = () => {
    state.showRings = ui.rings.checked;
    remember(RING_KEY, state.showRings ? '1' : '0');
    invalidate();
  };

  /* ---- the card ---- */
  const roundKey = `${ROUND_KEY}:${course.slug}`;
  let accountChanged = false;
  let rounds = parseRounds(savedText(ROUNDS_KEY, null));
  const teeName = () => course.tees?.names?.[state.tee] ?? null;
  const keepRecord = record => {
    if (accountChanged || liveFrozen(course.slug, record.id)) return record;
    const stored = savedText(ROUNDS_KEY, null);
    rounds = keepRound(stored === null ? rounds : parseRounds(stored), record);
    remember(ROUNDS_KEY, storeRounds(rounds));
    notifyLocalChange('round', { course: record.course, id: record.id });
    return record;
  };
  let shots = parseHistory(savedText(SHOTS_KEY, null));
  let round = parseRound(savedText(roundKey, null)) ?? newRound();
  const leaveTransferred = () => {
    if (accountChanged) return true;
    if (!liveFrozen(course.slug, round.id)) return false;
    location.replace(hubUrl());
    return true;
  };
  if (leaveTransferred()) return;
  addEventListener('storage', e => { if (liveGuardChange(e.key)) leaveTransferred(); });
  addEventListener('banvy-account-changed', e => {
    if (e.detail?.cacheReplaced || e.detail?.previousUserId && e.detail.previousUserId !== e.detail.userId) {
      accountChanged = true;
      location.replace(hubUrl());
    }
  });
  if (!Number.isFinite(round.handicap)) {
    const known = Number(savedText(HANDICAP_KEY, ''));
    if (savedText(HANDICAP_KEY, '') !== '' && Number.isFinite(known)) round.handicap = known;
  }
  const scoredHole = () => course.holes[(state.scoreHole ?? state.playing) - 1];
  /* An earlier hole being put right: nothing to move on from. */
  const fillingIn = () => state.scoreHole !== null && state.scoreHole !== state.playing;
  /* A card left from another day is that day's: the same course played again is a
     new round, or the log would add both together. */
  const ours = shot => shot.course === course.slug && shot.round === round.id;
  const roundShots = () => shots.filter(ours);
  const reopenedScores = reopenPuttOnlyScores(round, roundShots());
  const lastShotAt = roundShots().at(-1)?.at;
  const lastActivity = Math.max(round.touchedAt ?? 0, round.begunAt ?? 0, lastShotAt ?? 0, Date.parse(round.startedAt) || 0);
  if (Date.now() - lastActivity > RESUME_MS) {
    /* Never ended by hand, and still worth keeping. */
    if (round.id && holesScored(round, course.holes)) keepRecord(roundRecord(round, course, { tee: teeName(), at: round.touchedAt }));
    const { handicap } = round;
    round = { ...newRound(), handicap };
  }
  round.id ??= Date.now();
  const thisRecord = () => roundRecord(round, course, { tee: teeName(), at: round.endedAt ?? Date.now() });
  const saveRound = () => {
    if (leaveTransferred()) return;
    if (roundUnderWay()) {
      round.begunAt ??= roundShots()[0]?.at ?? Date.now();
      round.playingHole = state.playing;
    }
    round.touchedAt = Date.now();
    remember(roundKey, JSON.stringify(round));
    if (round.begunAt) publishLive(course.slug, round.id);
    /* A round ended can still be put right. */
    if (round.endedAt) keepRecord(thisRecord());
  };

  function setPlayingHole(number) {
    if (!course.holes[number - 1]) return;
    if (number !== state.playing) clearPendingLock();
    if (number !== state.playing && guidanceFix.expiresAt <= gpsClock()) {
      // The previous hole's last known ball position cannot anchor a new hole.
      guidanceFix.clear();
      state.located = false;
    }
    state.playing = number;
    if (roundUnderWay()) {
      if (!state.previewOnly) clearEntryAddress();
      saveRound();
    }
  }

  let scoreUndo = null, lastUndoWasScore = false;
  function clearScoreUndo() {
    scoreUndo = null;
    ui.scoreUndo.hidden = true;
  }
  function pushScoreUndo(number, label, change) {
    const previous = round.scores[number] ?? {};
    const fields = new Map();
    for (const [key, value] of Object.entries(change)) {
      fields.set(key, { previous: previous[key], existed: Object.hasOwn(previous, key), value });
    }
    scoreUndo = { hole: number, fields };
    lastUndoWasScore = true;
    ui.scoreUndoText.textContent = label;
    ui.scoreUndoBtn.setAttribute('aria-label', `Ångra scoreändringen på hål ${number}`);
    ui.scoreUndo.hidden = false;
  }
  function undoScore() {
    if (!scoreUndo) return;
    const { hole: number, fields } = scoreUndo;
    clearScoreUndo();
    const row = round.scores[number];
    if (!row) return;
    for (const [key, field] of fields) {
      if (row[key] !== field.value) continue;
      if (field.existed) row[key] = field.previous;
      else delete row[key];
    }
    if (!Object.keys(row).length) delete round.scores[number];
    saveRound();
    refreshScore();
    status(`Hål ${number} återställt`, 2000, true);
  }
  ui.scoreUndoBtn.onclick = undoScore;

  function setScore(change, number = scoredHole().n, fromShot = false) {
    if (!fromShot) {
      const label = change.picked ? `Hål ${number} struket` : `Hål ${number} ändrat`;
      pushScoreUndo(number, label, change);
    } else if (scoreUndo?.hole === number) {
      for (const key of Object.keys(change)) scoreUndo.fields.delete(key);
      if (!scoreUndo.fields.size) clearScoreUndo();
    }
    undoPoint?.score(round.scores, number, change, fromShot);
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
    clearTimeout(noteTimer);
    ui.locked.hidden = true;
    closeSame();
    ui.prompt.dataset.asked = String(h.n);
    /* The strokes the wheel saw, as the likely answer: a putt or two may be missing. */
    const tally = holeTally(roundShots(), h.n);
    const puttsOnly = Number.isFinite(own?.putts) && tally.shots === tally.putts;
    const suggested = puttsOnly ? null : tally.strokes;
    ui.prompt.dataset.kind = 'score';
    ui.promptMore.textContent = 'Fler val';
    ui.promptTitle.textContent = puttsOnly
      ? `Hål ${h.n} · ${own.putts} ${own.putts === 1 ? 'putt' : 'puttar'}. Hur många slag totalt?`
      : [`Slag på hål ${h.n}?`, `par ${h.par}`, suggested ? `${suggested} loggade` : null].filter(Boolean).join(' · ');
    ui.promptKeys.replaceChildren(...strokeKeys(h.par, suggested).map(value => {
      const key = chip(String(value), value === suggested, () => {
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
    if (!undoPoint) {
      undoPoint = shotUndo(beforePutterLock(shots));
      undoPoint.capture(shots);
    }
    clearTimeout(noteTimer);
    ui.locked.hidden = true;
    closeSame();
    ui.prompt.dataset.asked = String(number);
    ui.prompt.dataset.kind = 'putts';
    ui.promptMore.textContent = 'Ångra';
    ui.promptTitle.textContent = [`Hål ${number}`, last, 'Hur många puttar?'].filter(Boolean).join(' · ');
    ui.promptKeys.replaceChildren(...[0, 1, 2, 3, 4].map(value => {
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
    const change = scoreAfterPutting(round.scores[number], holeTally(roundShots(), number));
    if (change) setScore(change, number, true);
    closePrompt();
    refreshShotGuidance();
    const score = round.scores[number];
    if (!score.picked && !Number.isFinite(score.strokes)) {
      askScore(number);
      return;
    }
    ui.locked.dataset.asked = String(number);
    const result = score.picked ? 'struket' : score.logged ? `${score.strokes} · ${scoreName(score.strokes, course.holes[number - 1].par)}` : `kortet säger ${score.strokes}`;
    note(`Hål ${number} · ${result}`, { edit: true, end: atTheTurn(round, course.holes, number) });
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
    return `<div class="map-card-part" style="--cols:${holes.length}">
      <div class="map-card-row map-card-head"><span>Hål</span>${holes.map(each => label(each, each.n)).join('')}<span>Σ</span></div>
      <div class="map-card-row"><span>Par</span>${holes.map(each => label(each, each.par)).join('')}<span>${sum(each => each.par)}</span></div>
      <div class="map-card-row map-card-score"><span>Slag</span>${holes.map(each => cell(each, `<i>${shown(each)}</i>`, kind(each))).join('')}<span>${sum(each => score(each)?.strokes) || ''}</span></div>
    </div>`;
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
      : fillingIn() || round.endedAt || (h.n === course.holes.length && roundIsOver(round, course.holes, h.n)) ? 'Klart'
      : `Vidare till hål ${h.n % course.holes.length + 1} ›`;
    ui.endRound.hidden = !holesScored(round, course.holes) && !roundShots().length;
    ui.handicap.textContent = Number.isFinite(round.handicap) ? String(round.handicap) : 'Ingen';
    const received = strokesReceived(round.handicap, h, course.holes);
    const name = Number.isFinite(own.strokes) && !own.picked ? scoreName(own.strokes, h.par) : own.picked ? 'Struket' : '';
    const points = received === null ? null : own.picked ? 0 : Number.isFinite(own.strokes) ? stablefordPoints(h.par, own.strokes, received) : null;
    const needsTotal = !own.picked && !Number.isFinite(own.strokes) && Number.isFinite(own.putts);
    ui.scoreWord.textContent = [needsTotal ? 'Ange totalt antal slag' : name, points === null ? null : `${points} poäng`,
      received ? `${received} erhållna slag` : null].filter(Boolean).join(' · ');
    const totals = roundTotals(round, course.holes);
    const toPar = toParText(totals.toPar);
    const scoreBadge = totals.strokes ? `Score ${toPar}` : 'Score';
    ui.scoreLabel.textContent = scoreBadge;
    if (ui.holeScore) {
      ui.holeScore.hidden = !totals.strokes;
      ui.holeScore.textContent = totals.strokes ? toPar : '';
    }
    if (ui.menuScoreTag) {
      ui.menuScoreTag.hidden = !totals.strokes;
      ui.menuScoreTag.textContent = totals.strokes ? toPar : '';
    }
    if (ui.menuScoreLabel) {
      ui.menuScoreLabel.textContent = totals.strokes ? `Scorekort · ${toPar}` : roundUnderWay() ? 'För score' : 'Scorekort';
    }
    const deskScoreTab = ui.deskRail.querySelector('[data-desk-tab="score"]');
    if (deskScoreTab) deskScoreTab.textContent = scoreBadge;
    ui.scoreSum.textContent = totals.played
      ? [`${totals.strokes} slag`, totals.strokes ? toPar : null, totals.points === null ? null : `${totals.points} poäng`, totals.putts ? `${totals.putts} putt` : null].filter(Boolean).join(' · ')
      : round.endedAt ? 'Rundan är avslutad' : roundUnderWay() ? 'Rundan är igång · inga hål förda' : 'Rundan har inte börjat';
    ui.scoreStats.textContent = [totals.fairwaysTried ? `Fairway ${totals.fairways}/${totals.fairwaysTried}` : null,
      totals.greensTried ? `GIR ${totals.greens}/${totals.greensTried}` : null,
      hitGreen(own, h.par) ? 'GIR här' : null].filter(Boolean).join(' · ');
    const nines = [course.holes.slice(0, 9), course.holes.slice(9)].filter(part => part.length);
    ui.card.innerHTML = nines.map(cardRows).join('');
    const currentCell = ui.card.querySelector('.map-card-score .is-now');
    if (currentCell) {
      const strip = currentCell.closest('.map-card-part');
      const cellBox = currentCell.getBoundingClientRect(), stripBox = strip.getBoundingClientRect();
      strip.scrollLeft += cellBox.left + cellBox.width / 2 - stripBox.left - stripBox.width / 2;
    }
    ui.card.querySelectorAll('.map-card-part').forEach(markCardOverflow);
  }

  ui.card.onclick = event => {
    const target = event.target.closest('[data-card-hole]');
    if (!target) return;
    state.scoreHole = Number(target.dataset.cardHole);
    panels.update({ hole: state.scoreHole });
    refreshScore();
  };
  const stepScored = direction => {
    const count = course.holes.length;
    state.scoreHole = ((scoredHole().n - 1 + direction + count) % count) + 1;
    panels.update({ hole: state.scoreHole });
    refreshScore();
  };
  $('[data-score-prev]').onclick = () => stepScored(-1);
  $('[data-score-next]').onclick = () => stepScored(1);
  ui.scoreDone.onclick = () => {
    if (state.fromRound) {
      state.fromRound = false;
      state.scoreHole = null;
      panels.back();
      return;
    }
    if (isRoundComplete(round, course.holes) && !round.endedAt) {
      state.scoreHole = null;
      endRound();
      return;
    }
    const number = scoredHole().n;
    const advance = !fillingIn() && !round.endedAt && !(number === course.holes.length && roundIsOver(round, course.holes, number));
    state.scoreHole = null;
    showSheet(null);
    if (advance) playHole(number % course.holes.length + 1);
  };
  ui.pickUp.onclick = () => setScore({ strokes: null, putts: null, picked: true, logged: false });
  const setHandicap = value => {
    const handicap = clamp(value, MIN_HANDICAP, MAX_HANDICAP);
    if (!savePlayerProfile('handicap', handicap)) { note('Handicap kunde inte sparas'); return; }
    round.handicap = handicap;
    saveRound();
    refreshScore();
  };
  $('[data-handicap-more]').onclick = () => setHandicap(Number.isFinite(round.handicap) ? round.handicap + 1 : 18);
  $('[data-handicap-less]').onclick = () => setHandicap(Number.isFinite(round.handicap) ? round.handicap - 1 : 18);

  /* ---- the end of a round ---- */
  /* The round is over: the GPS and the awake screen with it, and the player sees what
     it came to. A lock afterwards simply goes on, so a tap here loses nothing. */
  let endingTimer = 0;
  function resetEndConfirm() {
    clearTimeout(endingTimer);
    endingTimer = 0;
    ui.endRound.textContent = 'Avsluta rundan';
    ui.endRound.classList.remove('is-confirming');
  }
  function endRound() {
    resetEndConfirm();
    clearScoreUndo();
    finishOpenShot();
    closePrompt();
    round.endedAt = Date.now();
    saveRound();
    stopGps();
    remember(`${GPS_KEY}:${course.slug}`, '');
    diary.add('round-ended', holesScored(round, course.holes));
    showRound(keepRecord(thisRecord()), { replace: true });
  }
  const endIfOver = number => { if (!round.endedAt && roundIsOver(round, course.holes, number)) endRound(); };
  ui.endRound.onclick = () => {
    if (!endingTimer) {
      ui.endRound.textContent = 'Säker? Tryck igen';
      ui.endRound.classList.add('is-confirming');
      endingTimer = setTimeout(resetEndConfirm, 4000);
      return;
    }
    endRound();
  };
  ui.lockedEnd.onclick = () => {
    ui.locked.hidden = true;
    endRound();
  };

  function showRound(record, options) {
    state.roundShown = record;
    showSheet(ui.roundSheet, options);
  }
  function renderRoundSheet(record, back) {
    const own = record.id === round.id && record.course === course.slug;
    state.roundShown = record;
    ui.roundTitle.textContent = record.courseName;
    const stats = ui.roundSheet.querySelector('[data-round-stats]');
    if (stats) stats.href = hubUrl(`statistik/${encodeURIComponent(record.course)}/${encodeURIComponent(record.id)}`);
    /* a kept round with shots that were located can be watched again on the detailed course */
    const relive = ui.roundSheet.querySelector('[data-round-relive]');
    const located = record.course && shots.some(s => s.course === record.course && s.round === record.id && Array.isArray(s.from));
    relive.hidden = !located || record.id === round.id && !record.endedAt;
    if (located) relive.href = `${BASE}${reliveUrl(record.course, record.id)}`;
    renderRound(ui.roundBody, {
      record,
      summary: roundSummary(record, shots),
      clubName,
      /* Another course's card is only to be read: its holes are not loaded here. */
      onHole: own ? (number, opener) => {
        state.fromRound = true;
        state.scoreHole = number;
        showSheet(ui.scoreSheet, { opener });
      } : null,
    });
    ui.roundBack.hidden = !back;
    ui.roundNew.hidden = !own;
    ui.roundDrop.hidden = own;
    ui.roundDrop.textContent = 'Ta bort rundan';
    clearTimeout(droppingTimer);
    droppingTimer = 0;

  }
  ui.roundNew.onclick = () => {
    freshRound();
    state.previewOnly = false;
    clearEntryAddress();
    state.playing = 1;
    state.handPicked = false;
    state.follow = true;
    goHole(1);
    openStart(1, { replace: true });
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
    if (leaveTransferred()) return;
    rounds = dropRound(parseRounds(savedText(ROUNDS_KEY, storeRounds(rounds))), record);
    remember(ROUNDS_KEY, storeRounds(rounds));
    shots = dropRoundShots(parseHistory(savedText(SHOTS_KEY, storeHistory(shots))), record);
    remember(SHOTS_KEY, storeHistory(shots));
    notifyLocalChange('round-deleted', { course: record.course, id: record.id });
    undoPoint = null;
    relearnBag();
    diary.add('round-dropped');
    panels.back();
  };
  $('[data-round-share]').onclick = async () => {
    const record = state.roundShown, text = roundText(record, roundSummary(record, shots), dateText(record.date));
    /* the round as its picture, with its words beside it (shell/round-card.mjs); the
       words alone, as before, where a picture cannot be made */
    try {
      const { shareRoundCard } = await import('../shell/round-card.mjs');
      const done = await shareRoundCard(record, { poster: `${BASE}courses/${record.course}/hero-1.webp`, text, shots });
      if (done === 'saved') status('Bilden av rundan är sparad');
      if (done !== 'failed') return;
    } catch { /* the words alone */ }
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
    renderRounds(ui.roundsBody, { rounds, trend: roundTrend(rounds), onOpen: (record, opener) => showRound(record, { opener }) });
  }

  function freshRound() {
    clearScoreUndo();
    clearPendingLock();
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
    refreshShotGuidance();
  }

  /* ---- the start of a round ---- */
  /* Everything a round needs before its first shot, on one card and filled in from last
     time. Starting from this tap also lets the phone ask for the position. */
  let startSetup;
  function openStart(number = 1, options) {
    startSetup = { from: number, hole: number, tee: state.tee, handicap: round.handicap };
    showSheet(ui.startSheet, options);
  }
  function restoreStartSetup(draft) {
    const validHole = n => Number.isInteger(n) && n >= 1 && n <= course.holes.length;
    const from = validHole(draft?.from) ? draft.from : state.hole;
    const hole = validHole(draft?.hole) && [1, 10, from].includes(draft.hole) ? draft.hole : from;
    const tee = Number.isInteger(draft?.tee) && draft.tee >= 0 && draft.tee < (course.tees?.names?.length ?? 0) ? draft.tee : state.tee;
    const handicap = draft?.handicap === null || Number.isFinite(draft?.handicap) && draft.handicap >= MIN_HANDICAP && draft.handicap <= MAX_HANDICAP
      ? draft.handicap : round.handicap;
    return { from, hole, tee, handicap };
  }
  function refreshStart() {
    const length = courseLength(course.holes, startSetup.tee);
    ui.startTitle.textContent = course.name;
    const offered = [...new Set([1, 10, startSetup.from])].filter(number => number <= course.holes.length).sort((a, b) => a - b);
    $('[data-start-hole-section]').hidden = offered.length < 2;
    function choice(label, value, field, attribute) {
      const button = chip(label, value === startSetup[field], () => {
        startSetup[field] = value;
        panels.update({ setup: { ...startSetup } });
        refreshStart();
        ui.startSheet.querySelector(`[${attribute}="${value}"]`)?.focus({ preventScroll: true });
      });
      button.setAttribute(attribute, value);
      return button;
    }
    $('[data-start-holes]').replaceChildren(...offered.map(number => choice(`Hål ${number}`, number, 'hole', 'data-start-hole')));
    ui.startFacts.textContent = [`${course.holes.length} hål`, `par ${course.par}`, length ? `${length.toLocaleString('sv-SE')} m` : null].filter(Boolean).join(' · ');
    const tees = course.tees?.names ?? [];
    ui.startTeeSection.hidden = tees.length < 2;
    ui.startTees.replaceChildren(...tees.map((name, index) => choice(name, index, 'tee', 'data-start-tee')));
    ui.startHandicap.textContent = Number.isFinite(startSetup.handicap) ? String(startSetup.handicap) : 'Ingen';
  }
  const stepStartHandicap = step => {
    startSetup.handicap = clamp(Number.isFinite(startSetup.handicap) ? startSetup.handicap + step : 18, MIN_HANDICAP, MAX_HANDICAP);
    panels.update({ setup: { ...startSetup } });
    refreshStart();
  };
  $('[data-start-more]').onclick = () => stepStartHandicap(1);
  $('[data-start-less]').onclick = () => stepStartHandicap(-1);
  $('[data-start-go]').onclick = () => {
    if (round.handicap !== startSetup.handicap && !savePlayerProfile('handicap', startSetup.handicap)) {
      status('Handicap kunde inte sparas');
      return;
    }
    if (round.endedAt) freshRound();
    round.handicap = startSetup.handicap;
    state.tee = startSetup.tee;
    remember(`${TEE_KEY}:${course.slug}`, String(state.tee));
    round.begunAt = Date.now();
    playHole(startSetup.hole, false);
    diary.add('round-started', teeName());
    refreshScore();
    showSheet(null);
    if (!gps.active) startGps();
  };
  const roundUnderWay = () => !round.endedAt && (Boolean(round.begunAt) || holesScored(round, course.holes) > 0 || roundShots().length > 0);
  const canStartFromPreview = () => state.previewOnly && !roundUnderWay();
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
  let undoPoint = null;
  const entry = params.get('runda');
  const resumeUnavailable = entry === 'fortsatt' && !roundUnderWay();
  const entryState = roundEntry({
    round, active: roundUnderWay(), shotHole: roundShots().at(-1)?.hole,
    recentHole: savedFresh(`${HOLE_KEY}:${course.slug}`), requestedHole: params.get('hal'),
    intent: entry, preview: params.get('vy') === 'forhandsvisning', count: course.holes.length,
  });
  state.playing = entryState.playing;
  state.hole = entryState.shown;
  state.previewOnly = entryState.viewing;
  const previewTee = Number(params.get('tee')) - 1;
  if (state.previewOnly && Number.isInteger(previewTee) && course.tees?.names?.[previewTee]) state.tee = previewTee;
  state.handPicked = previewing();
  state.follow = !state.handPicked;
  if (reopenedScores || (roundUnderWay() && round.playingHole !== state.playing)) saveRound();
  const stale = openShot(shots);
  if (stale && (!ours(stale) || Date.now() - stale.at > STALE_SHOT_MS)) shots = closeHole(shots, stale.hole);
  let clubHistoryStats = clubStats(shots);
  const saveShots = () => {
    if (leaveTransferred()) return;
    // Only this recording card owns its shot set. Other courses may have
    // arrived from sync or another tab since the map last painted the trail.
    const persisted = savedText(SHOTS_KEY, null);
    if (persisted !== null) shots = [...parseHistory(persisted).filter(shot => !ours(shot)), ...roundShots()];
    undoPoint?.capture(shots);
    clubHistoryStats = clubStats(shots);
    remember(SHOTS_KEY, storeHistory(shots));
    notifyLocalChange('shots', { course: course.slug, id: round.id });
    saveRound();
    refreshTrail();
  };
  const uploadCurrentRound = () => {
    if (getCloudState().user && round.begunAt && !document.hidden && !leaveTransferred()) publishLive(course.slug, round.id);
  };
  initCloud().then(uploadCurrentRound);
  addEventListener('online', uploadCurrentRound);
  document.addEventListener('visibilitychange', uploadCurrentRound);
  /* One step back, whatever the last step was. */
  const markUndo = () => { undoPoint = shotUndo(shots); lastUndoWasScore = false; };
  let trail = [], trailFrom = null;
  function refreshTrail() {
    const own = roundShots().filter(shot => shot.hole === state.hole);
    trail = own.filter(shot => shot.to && !isPutt(shot));
    trailFrom = openShot(own)?.from ?? null;
  }
  /* A lock counts on the hole being played, not one a player is only looking at. */
  const holeInPlay = () => course.holes[state.playing - 1];
  function finishOpenShot() {
    const open = openShot(shots);
    if (!open) return;
    shots = closeHole(shots, open.hole);
    saveShots();
  }

  /* Longest first, the putter last, whatever order the bag was saved in. */
  const wheelClubs = clubs => [...clubs].sort((a, b) => b.carry - a.carry);
  let playingBag = learnedBag(bag, clubHistoryStats);
  const hudFields = Object.fromEntries(['title', 'source', 'distance', 'club', 'detail', 'conditions'].map(key => [key, $(`[data-shot-${key}]`)]));
  const mappedWaters = course.hazards.waters;
  let lastAnnouncement = '', lastAnnouncedTarget = null, lastLanding = null, lastKind = null;
  const planner = createGuidancePlanner({
    loadGeometry: async (h, signal) => {
      const water = await readHydro();
      signal.throwIfAborted();
      return loadMapShotGeometry(course, h, store, { signal, ...water });
    },
    createWorker: () => new Worker(new URL('./map-guidance-worker.mjs', import.meta.url), { type: 'module' }),
    onChange() {
      const before = lastLanding;
      refreshNumbers();
      if (state.follow && lastLanding && (!before || Math.hypot(lastLanding[0] - before[0], lastLanding[1] - before[1]) > REFRAME_METRES)) {
        revealLanding(lastLanding);
      }
      invalidate();
    },
  });
  addEventListener('online', () => planner.retry());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && navigator.onLine) planner.retry();
  });
  function setAim(point) {
    if (!point) wheel.rest(wheel.current()?.id, { reclaim: true });
    state.target = point;
    state.manualClub = null;
    state.reclaimWheel = true;
    lastLanding = lastKind = null;
  }
  const clubName = id => bag.find(club => club.id === id)?.name ?? id;

  const wheel = createClubWheel($('[data-wheel]'), {
    holdToLock: false,
    onChoose(club) {
      state.manualClub = club.id;
      refreshShotGuidance();
      invalidate();
    },
    onLock: lockClub,
    onSlip: how => diary.add('slip', how),
  });
  ui.logShot.onclick = () => {
    const pending = state.pendingLock;
    if (pending) {
      clearPendingLock();
      if (pending.retry) lockClub(pending.club);
      else status('Slagloggningen avbröts.', 2200);
      return;
    }
    if (canStartFromPreview()) { openStart(state.hole, { opener: ui.logShot }); return; }
    const club = wheel.current();
    if (club) lockClub(club);
  };
  wheel.setClubs(wheelClubs(playingBag));

  function relearnBag() {
    clubHistoryStats = clubStats(shots);
    const next = learnedBag(bag, clubHistoryStats);
    const changed = next.length !== playingBag.length || next.some((club, k) =>
      club.id !== playingBag[k].id || club.name !== playingBag[k].name || club.carry !== playingBag[k].carry);
    if (changed) {
      playingBag = next;
      wheel.setClubs(wheelClubs(playingBag));
      refreshShotGuidance();
      invalidate();
    }
  }

  function reloadPlayerHistory() {
    if (leaveTransferred()) return;
    rounds = parseRounds(savedText(ROUNDS_KEY, null));
    const received = parseHistory(savedText(SHOTS_KEY, null));
    const own = roundShots(), incoming = received.filter(ours);
    // Keep local shot references for undo when only another round changed.
    const ownChanged = JSON.stringify(own) !== JSON.stringify(incoming);
    shots = [...received.filter(shot => !ours(shot)), ...(ownChanged ? incoming : own)];
    if (ownChanged) undoPoint = null;
    bag = parseBag(savedText(BAG_KEY, null));
    if (state.manualClub && !bag.some(club => club.id === state.manualClub)) state.manualClub = null;
    relearnBag();
    refreshTrail();
    refreshNumbers();
    if (!ui.roundsBody.closest('[hidden]')) refreshRounds();
    invalidate();
  }
  addEventListener('banvy-sync-changed', event => { if (!event.detail?.accountChanged) reloadPlayerHistory(); });
  addEventListener('storage', event => {
    if ([ROUNDS_KEY, SHOTS_KEY, BAG_KEY].includes(event.key)) reloadPlayerHistory();
  });

  const nearOpenShot = open => open && state.player && Math.hypot(state.player.point[0] - open.from[0], state.player.point[1] - open.from[1]);

  function refreshShotGuidance() {
    const h = hole(), position = guidancePosition();
    const open = openShot(roundShots());
    const walked = open?.hole === h.n && position.source !== 'tee'
      ? Math.hypot(position.point[0] - open.from[0], position.point[1] - open.from[1]) : null;
    const byTheBall = walked !== null && walked < WHEEL_AWAY_METRES;
    if (state.justLocked && (!open || (position.source === 'gps' && walked !== null && walked >= WHEEL_AWAY_METRES))) {
      state.justLocked = false;
      setAim(null);
    }
    const walking = walked !== null && !byTheBall && position.source === 'gps' && !isPutt(open)
      && open.fromAccuracy <= MEASURABLE_ACCURACY_METRES && state.player.accuracy <= MEASURABLE_ACCURACY_METRES;
    const words = walking ? clubName(open.club) : '';
    const length = walking ? `${metres(walked)} m` : '';
    if (ui.hintNote.textContent !== words) ui.hintNote.textContent = words;
    if (ui.hintMetres.textContent !== length) ui.hintMetres.textContent = length;
    ui.walkedShot.hidden = !words || state.mode !== 'hole';
    if (state.mode === 'hole') updateGuidance(h, position);
    else {
      state.guidance = null;
      ui.reading.hidden = true;
    }
    wheel.setLocked(byTheBall && wheel.current()?.id === open.club);
  }

  function updateGuidance(h, position) {
    const from = position.point, manual = state.target;
    const teeShot = position.source === 'tee' || h.tees.some(mark => Math.hypot(from[0] - mark.point[0], from[1] - mark.point[1]) < 12);
    const result = planner.read(h, { origin: from, target: manual, tee: teeShot, preview: position.source === 'tee', bag: playingBag, carryBag: bag,
      weather: air(), greensApproximate: course.greensApproximate });
    let { status, shots: legs } = result;
    let target = legs[0]?.point ?? null, reading = legs[0]?.reading ?? null;
    let recommendedClub = legs[0]?.club ?? null;
    let reachable = true;
    if (manual) {
      target = manual;
      const shot = result.measurement ?? readMapShot({ from, to: manual, bag: playingBag, carryBag: bag, heightAt: store.heightAt, weather: air() });
      reading = shot.reading;
      recommendedClub = shot.club;
      reachable = shot.reachable;
      if (onMeasuredGreen(position) && surfaceAt(manual, h) === 'green') recommendedClub = playingBag.find(isPutter) ?? null;
      if (!legs.length) legs = [{ from, point: target }];
      status = 'measured';
    } else if (onMeasuredGreen(position)) {
      status = 'on-green';
      recommendedClub = playingBag.find(isPutter) ?? null;
      target = reading = null;
      legs = [];
    }
    // A new landing owns the wheel. Walking toward the same landing leaves a
    // deliberate club choice alone; likewise while a recorded stroke is locked.
    if (!manual && status !== 'loading') {
      const landing = target ?? (status === 'on-green' ? h.green.c : null);
      const kind = status === 'on-green' ? 'putt' : legs[0]?.kind;
      if (landing && (!lastLanding || lastKind !== kind || lastLanding[0] !== landing[0] || lastLanding[1] !== landing[1]) && !state.justLocked) {
        state.manualClub = null;
        state.reclaimWheel = true;
      }
      lastLanding = landing;
      lastKind = kind;
    }
    const selectedClub = playingBag.find(club => club.id === state.manualClub) ?? recommendedClub;
    state.guidance = { mode: manual ? 'manual' : 'auto', status, reason: status === 'unavailable' ? result.reason : undefined,
      source: position.source, origin: manual ? from : result.origin ?? from, target,
      legs, reading, recommendedClub, selectedClub, reachable };
    wheel.suggest(recommendedClub?.id ?? null);
    if (recommendedClub && !state.manualClub) {
      wheel.rest(recommendedClub.id, { reclaim: state.reclaimWheel });
      state.reclaimWheel = false;
    }
    showGuidance(state.guidance, h);
  }

  const shortClubLabel = name => name
    .replace(/^Driver$/, 'Dr')
    .replace(/^Putter$/, 'Putt')
    .replace(/^Järn\s+/, 'J')
    .replace(/^Hybrid\s+/, 'H')
    .replace(/^Trä\s+/, 'T')
    .replace(/^Pitchingwedge$/, 'PW')
    .replace(/^Gapwedge$/, 'GW')
    .replace(/^Sandwedge$/, 'SW')
    .replace(/^Lobwedge$/, 'LW');

  function refreshLogAction() {
    const pending = state.pendingLock;
    ui.pendingShot.hidden = !pending;
    if (pending) {
      const where = `Hål ${pending.hole} · ${pending.club.name}`;
      const message = `${pending.retry ? 'Slaget loggades inte – ingen säker GPS' : 'Väntar på GPS'} · ${where}`;
      if (ui.pendingShot.textContent !== message) ui.pendingShot.textContent = message;
      const action = pending.retry ? 'Försök igen' : 'Avbryt';
      if (ui.logShotLabel.textContent !== action) ui.logShotLabel.textContent = action;
      ui.logShot.classList.add('is-starting');
      const label = `${action} · ${where}`;
      if (ui.logShot.getAttribute('aria-label') !== label) ui.logShot.setAttribute('aria-label', label);
      return;
    }
    const club = wheel.current(), hole = state.playing;
    const starting = canStartFromPreview();
    const clubTag = club ? shortClubLabel(club.name) : '';
    const text = starting ? 'Starta runda' : previewing() || tentativeTee() ? `Logga · H${hole}` : clubTag ? `Logga · ${clubTag}` : 'Logga slag';
    if (ui.logShotLabel.textContent !== text) ui.logShotLabel.textContent = text;
    ui.logShot.classList.toggle('is-starting', starting);
    const label = starting ? `Starta runda från hål ${state.hole}` : `Logga slag${club ? ` med ${club.name}` : ''} på hål ${hole}`;
    if (ui.logShot.getAttribute('aria-label') !== label) ui.logShot.setAttribute('aria-label', label);
  }

  function showGuidance(shot, h) {
    const manual = shot.mode === 'manual';
    const hud = shotHud(shot, h, { approximateGreen: course.greensApproximate, waters: mappedWaters, manualClub: Boolean(state.manualClub) });
    for (const [key, element] of Object.entries(hudFields)) {
      if (element.textContent !== hud[key]) element.textContent = hud[key];
    }
    const hasDetailCard = manual
      || Boolean(state.manualClub && shot.recommendedClub)
      || shot.status === 'recovery'
      || shot.status === 'blocked'
      || shot.status === 'unavailable';
    const walkingOnly = !hasDetailCard && !ui.walkedShot.hidden;
    ui.reading.hidden = !hasDetailCard && !walkingOnly;
    ui.reading.classList.toggle('is-walking-only', walkingOnly);
    root.classList.remove('has-shot-distance');
    hudFields.conditions.hidden = !hud.conditions;
    const actions = [
      [$('[data-reading-close]'), manual],
      [$('[data-club-auto]'), Boolean(state.manualClub && shot.recommendedClub)],
      [$('[data-aim-retry]'), shot.reason === 'load-failed'],
    ];
    let actionsChanged = false;
    for (const [button, visible] of actions) {
      if (button.hidden === visible) {
        button.hidden = !visible;
        actionsChanged = true;
      }
    }
    refreshLogAction();
    if (actionsChanged && !sideways.matches) fitLayout();
    // Keep walking distances live on the card. Speak once when the advice itself changes.
    const key = [h.n, shot.mode, shot.status, manual ? shot.target : '', hud.title, shot.source,
      state.manualClub, shot.selectedClub?.id, shot.recommendedClub?.id].join('|');
    const newLanding = lastAnnouncedTarget && shot.target
      && Math.hypot(shot.target[0] - lastAnnouncedTarget[0], shot.target[1] - lastAnnouncedTarget[1]) >= ANNOUNCE_LANDING_METRES;
    if (shot.status !== 'loading' && (key !== lastAnnouncement || newLanding)) {
      lastAnnouncement = key;
      lastAnnouncedTarget = shot.target;
      $('[data-shot-status]').textContent = [hud.title, hud.distance, hud.club, hud.source, hud.detail].filter(Boolean).join('. ');
    }
  }

  let noteTimer = 0, sameTimer = 0, lockTimer = 0;
  function note(text, { penalty = false, edit = false, end = false } = {}) {
    closeSame();
    closePrompt();
    ui.lockedText.textContent = text;
    $('[data-log-status]').textContent = text;
    ui.lockedPenalty.hidden = !penalty;
    ui.lockedEdit.hidden = !edit;
    ui.lockedEnd.hidden = !end;
    ui.locked.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { ui.locked.hidden = true; }, NOTE_MS);
  }
  let sameChoice = null;
  const closeSame = () => {
    clearTimeout(sameTimer);
    ui.same.hidden = true;
    sameChoice = null;
  };
  function clearPendingLock() {
    if (!state.pendingLock) return;
    clearTimeout(lockTimer);
    state.pendingLock = null;
    refreshLogAction();
  }
  function expirePendingLock() {
    if (!state.pendingLock || state.pendingLock.retry) return;
    clearTimeout(lockTimer);
    state.pendingLock.retry = true;
    refreshLogAction();
  }
  const fixCanRecord = () => state.player?.onCourse && guidanceFix.expiresAt > gpsClock();

  function confirmedSameClub() {
    const choice = sameChoice;
    closeSame();
    if (choice && gpsClock() < choice.expires && fixCanRecord() && choice.open === openShot(shots)
        && ours(choice.open) && choice.open.hole === state.playing && nearOpenShot(choice.open) < SAME_SPOT_METRES) {
      return choice.club;
    }
    status('Kontrollera GPS-positionen och logga igen vid bollen.');
    return null;
  }

  /* Long enough to mean it, and the shot starts from this spot, this club. */
  function lockClub(club, { superseded = false } = {}) {
    if (state.pendingLock) return;
    if (canStartFromPreview()) { openStart(state.hole, { opener: ui.wheel }); return; }
    const underway = openShot(shots);
    if (underway && ours(underway) && isPutt(underway) && underway.hole === state.playing) {
      askPutts(underway.hole);
      return;
    }
    if (!superseded) {
      state.manualClub = club.id;
      refreshShotGuidance();
      invalidate();
    }
    const { player } = state;
    if (!fixCanRecord()) {
      diary.add('lock-waited', player ? Math.round(player.accuracy) : null);
      const pending = { club, round: round.id, hole: state.playing, expires: gpsClock() + LOCK_WAIT_MS, retry: false };
      state.pendingLock = pending;
      lockTimer = setTimeout(() => { if (state.pendingLock === pending) expirePendingLock(); }, LOCK_WAIT_MS);
      refreshLogAction();
      if (gps.active) gps.ask(); else startGps();
      return;
    }
    const open = openShot(roundShots());
    if (open?.hole === holeInPlay().n && nearOpenShot(open) < SAME_SPOT_METRES && !isPutter(club)) {
      sameChoice = { club, open, expires: gpsClock() + SAME_SPOT_MS };
      clearTimeout(noteTimer);
      ui.locked.hidden = true;
      closePrompt();
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
    const lie = surfaceAt(point, h, mappedWaters);
    const rise = before ? store.heightAt(point[0], point[1]) - store.heightAt(before.from[0], before.from[1]) : null;
    markUndo();
    diary.add('lock', [h.n, club.id, Math.round(accuracy)]);
    shots = lockShot(shots, { hole: h.n, club, point, accuracy, at: Date.now(), lie, rise,
      farthest: reachOf(before && bag.find(each => each.id === before.club)), meta: { course: course.slug, round: round.id },
      aim: state.playing === state.hole ? shotAim(state.guidance, club) : null });
    saveShots();
    state.justLocked = true;
    const closed = before ? shots.at(-2) : null;
    const measured = closed && isMeasured(closed);
    if (measured) relearnBag();
    /* The reward for the lock: what the last shot did. */
    const reward = measured ? `${clubName(closed.club)} ${Math.round(shotLength(closed))} m`
      : closed ? `${clubName(closed.club)} · osäker längd` : null;
    const count = roundShots().filter(shot => shot.hole === h.n).length;
    if (isPutter(club)) {
      ui.locked.hidden = true;
      askPutts(h.n, reward);
    } else {
      const logged = `Hål ${h.n} · slag ${count} loggat · ${club.name}`;
      note(reward ? `${logged} · Förra: ${reward}` : logged, { penalty: Boolean(closed) });
    }
    /* The tee shot says itself whether the fairway was hit. */
    if (measured && h.par >= 4 && roundShots().filter(shot => shot.hole === h.n).length === 2 && !round.scores[h.n]?.fairway) {
      const side = sideOfPlay(closed.to, playedPath(h, tee(h).point));
      const fairway = closed.toLie === 'fairway' ? 'hit' : { vänster: 'left', höger: 'right' }[side];
      if (fairway) setScore({ fairway }, h.n, true);
    }
    refreshFloat();
    refreshShotGuidance();
    invalidate();
  }

  function takeBack() {
    diary.add('undo');
    if (undoPoint) {
      shots = undoPoint.restore(shots, round.scores);
      undoPoint = null;
      status('Ändringen ångrad', 1800, true);
    }
    saveShots();
    relearnBag();
    refreshHole();
    refreshScore();
    ui.locked.hidden = true;
    closePrompt();
    state.manualClub = null;
    state.reclaimWheel = true;
    state.justLocked = false;
    const open = openShot(roundShots());
    if (open && isPutt(open)) askPutts(open.hole);
    refreshShotGuidance();
    invalidate();
  }
  $('[data-locked-undo]').onclick = takeBack;
  ui.holeUndo.onclick = takeBack;
  $('[data-locked-close]').onclick = () => {
    clearTimeout(noteTimer);
    ui.locked.hidden = true;
  };
  $('[data-locked-penalty]').onclick = () => {
    markUndo();
    shots = addPenalty(shots);
    saveShots();
    relearnBag();
    refreshHole();
    refreshScore();
    note('Plikt +1');
  };
  $('[data-locked-edit]').onclick = () => {
    state.scoreHole = Number(ui.locked.dataset.asked);
    ui.locked.hidden = true;
    refreshScore();
    showSheet(ui.scoreSheet);
  };
  $('[data-same-club]').onclick = () => {
    const club = confirmedSameClub();
    if (!club) return;
    markUndo();
    shots = changeClub(shots, club);
    saveShots();
    note(`Hål ${state.playing} · bytt till ${club.name}`);
    refreshShotGuidance();
  };
  $('[data-same-shot]').onclick = () => {
    const club = confirmedSameClub();
    if (club) strike(club);
  };
  $('[data-same-out]').onclick = () => {
    const club = confirmedSameClub();
    if (!club) return;
    markUndo();
    shots = retakeShot(shots, { club, at: Date.now(), aim: state.playing === state.hole ? shotAim(state.guidance, club) : null });
    saveShots();
    note(`Hål ${state.playing} · omslag · ett slag till`);
    refreshShotGuidance();
  };

  function refreshClubs() {
    const stats = clubStats(shots);
    ui.clubsNote.textContent = stats.size
      ? 'Din längd med rullen inräknad, mätt med GPS. Stapeln är där slagen oftast hamnar och strecket din vanliga längd. Gråa siffror är bagens tills du har fem slag.'
      : 'Välj klubba och tryck på Logga slag vid bollen för att mäta dina klubblängder.';
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
    if (ui.greenWind) ui.greenWind.hidden = !trusted;
    if (trusted) {
      const text = `${Math.round(trusted.windMs)} m/s`;
      ui.windSpeed.textContent = text;
      if (ui.greenWindText) ui.greenWindText.textContent = text;
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

  const startDownload = $('[data-start-download]');
  const megabytes = bytes => `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
  let packageRequest = null, saving = false, check = 0;
  function getPackage() {
    if (!packageRequest) packageRequest = courseDownload(store, course, {
      extras: [...treeFiles, ...landExtras, ...clubExtras], moduleUrl: import.meta.url,
    }).catch(error => { packageRequest = null; throw error; });
    return packageRequest;
  }
  function downloadLabel(menu, start = menu) {
    ui.download.textContent = menu;
    startDownload.textContent = start;
  }
  refreshOffline = async () => {
    if (saving) return;
    const current = ++check;
    try {
      const pack = await getPackage(), state = await offlineStatus(pack);
      if (current !== check || saving) return;
      if (state === 'ready') downloadLabel('Sparad', 'Sparad för spel offline');
      else if (state === 'repair') downloadLabel('Reparera offlinebanan');
      else downloadLabel(`Spara banan för offline · ${megabytes(pack.bytes)}`);
    } catch {
      if (current === check && !saving) downloadLabel('Kontrollera offlinebanan');
    }
  };
  async function saveOffline() {
    if (saving) return;
    saving = true; check++;
    ui.download.disabled = startDownload.disabled = true;
    downloadLabel('Förbereder offlinebanan…');
    try {
      const pack = await getPackage();
      if (await offlineStatus(pack) !== 'ready') {
        const result = await downloadCourse(pack, { onProgress: share => downloadLabel(`Sparar · ${Math.round(share * 100)} %`) });
        status(`Banan är sparad · ${megabytes(result.bytes)} · fungerar utan täckning`);
      }
      downloadLabel('Sparad', 'Sparad för spel offline');
    } catch (error) {
      downloadLabel('Försök spara offline igen');
      status(`Kunde inte spara: ${error.message}`);
    } finally { saving = false; ui.download.disabled = startDownload.disabled = false; }
  }
  ui.download.onclick = startDownload.onclick = saveOffline;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!ui.startSheet.hidden || !ui.menuSheet.hidden)) refreshOffline();
  });

  attachGestures($('.map-marks'), {
    onRelease() {
      if (state.draggingTarget) {
        state.draggingTarget = false;
        reframeForLayout();
      }
    },
    onTouched() {
      if (ui.status.classList.contains('is-low')) ui.status.hidden = true;
      state.flight = null;
      state.gridAwake = performance.now() + GRID_AWAKE_MS;
      setViewMenu(false);
      showSheet(null);
      if (state.greenGrid) invalidate();
    },
    /* A press on a manually placed measuring point takes hold of it — never hijack
       a fairway pan near an automatic guidance circle. */
    onPress(point) {
      state.draggingTarget = false;
      const target = state.target;
      if (!target || state.mode !== 'hole') return;
      const s = camera.project(...lifted(target));
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
          setAim(hit);
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
    onTap(point) {
      if (state.mode === 'course') {
        const tapped = overlay.holeAt(point.x, point.y);
        if (tapped) {
          pickHole(tapped);
        }
        return;
      }
      if (state.target) {
        const s = camera.project(...lifted(state.target));
        if (Math.hypot(s.x - point.x, s.y - point.y) < 30) {
          setAim(null);
          refreshNumbers();
          invalidate();
          return;
        }
      }
      const hit = camera.pick(point.x, point.y, store.heightAt, state.exaggeration);
      if (!hit) return;
      setAim(hit);
      refreshNumbers();
      invalidate();
    },
  });

  function focusWheelAfter(button) {
    if (document.activeElement === button) $('[data-wheel-list]').focus({ preventScroll: true });
  }
  $('[data-aim-retry]').onclick = () => {
    focusWheelAfter($('[data-aim-retry]'));
    planner.retry();
  };
  $('[data-club-auto]').onclick = () => {
    focusWheelAfter($('[data-club-auto]'));
    state.manualClub = null;
    state.reclaimWheel = true;
    refreshShotGuidance();
    invalidate();
  };
  $('[data-reading-close]').onclick = () => {
    focusWheelAfter($('[data-reading-close]'));
    setAim(null);
    refreshNumbers();
    invalidate();
  };

  const pixelRatio = () => Math.min(devicePixelRatio || 1, QUALITY_STEPS[state.quality].pixelRatio);

  /* Only moving frames count: a still map draws one frame and stops, so the time
     between two of those says nothing about the device. */
  function notePace(time) {
    const { pace } = state;
    const duration = activeFrameMs(pace, frameRequestedAt, time);
    if (duration !== null) pace.samples.push(duration);
    pace.start = time;
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
    reframeForLayout();
    invalidate();
  }
  addEventListener('resize', resize);
  addEventListener('orientationchange', resize);
  const hudSize = new ResizeObserver(() => {
    const box = root.getBoundingClientRect();
    if (box.width !== camera.state.width || box.height !== camera.state.height) resize();
    else { fitLayout(); reframeForLayout(); }
  });
  for (const element of [root, mapHeader, mapFoot, cameraButtons, ui.deskRail, ui.green, ui.wind, ui.thumbCluster]) hudSize.observe(element);
  document.addEventListener('visibilitychange', () => {
    state.pace.end = null;
    if (document.visibilityState === 'visible') invalidate();
  });

  /* Lakes freeze; the sea at Visby does not. */
  const frozenWater = !course.features.water.some(item => item.sea);
  let shadesWaiting = 0;

  const greenTime = () => reducedMotion ? 0 : (performance.now() / 1000) % 3600;
  const animateGreen = () => !reducedMotion && !document.hidden && !renderer.gl.isContextLost() && state.greenGrid?.pulses.length
    && performance.now() < state.gridAwake;
  function scheduleGreenPulse() {
    clearTimeout(gridTimer);
    if (animateGreen()) gridTimer = setTimeout(requestFrame, GRID_FRAME_MS);
    else if (state.greenGrid) renderer.releaseGreenFrame();
  }
  motionPreference.addEventListener('change', () => {
    reducedMotion = motionPreference.matches;
    if (state.greenGrid) {
      state.gridAwake = performance.now() + GRID_AWAKE_MS;
      invalidate();
    }
  });

  function frame(time) {
    raf = 0;
    const started = performance.now();
    const pulseOnly = !sceneDirty;
    sceneDirty = false;
    if (pulseOnly) {
      if (!animateGreen()) { renderer.releaseGreenFrame(); return; }
      if (renderer.drawGreenPulseFrame(greenTime())) {
        state.stats.frames++;
        state.stats.pulseFrames++;
        state.stats.lastDrawMs = performance.now() - started;
        scheduleGreenPulse();
        return;
      }
    }
    const measurePace = time !== undefined && !state.greenGrid && !document.hidden;
    if (measurePace) notePace(time);
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
          if (ui.greenWindArrow) ui.greenWindArrow.style.transform = `rotate(${turn}deg)`;
        }
      }
      /* Close up the map colours carry the surface and the light only models it;
         over a whole course the light has to do the work, since a hole's slopes
         are too gentle to read at that size. */
      const wide = clamp(Math.log2(distance / 350) / 3, 0, 1);
      const blend = (near, far) => near + (far - near) * wide;
      /* A tree still reads far past where the 1 m ground ends, so it stands about as far
         as the air lets the ground be seen. Beyond that the painted canopy takes over. */
      const step = QUALITY_STEPS[state.quality];
      const treeReach = step.reach * (state.atEye ? TREE_REACH.eye
        : clamp(distance * TREE_REACH.perDistance, pixelsPerRadian * pixelRatio() / 2.6, TREE_REACH.most));
      state.stats.treeReach = treeReach;
      const forest = store.forest({ planes, eye, reach: treeReach, exaggeration: state.exaggeration,
        holeTiles: state.mode === 'hole' ? hole().tileIds : [] });
      const houseReach = state.atEye ? HOUSE_REACH.eye : clamp(distance * HOUSE_REACH.perDistance, HOUSE_REACH.least, HOUSE_REACH.most);
      const houses = store.houses({ planes, eye, reach: houseReach, exaggeration: state.exaggeration });
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
        treeBudget: step.trees,
        treeThin: TREE_THIN,
        houses,
        houseFade: [houseReach * 0.85, houseReach],
        /* From the ground the air starts well out, whatever the map's own reach. */
        fog: state.atEye ? [EYE_FOG_METRES, 9000] : [distance * 2.2, Math.max(distance * 14, 9000)],
        /* The greengrid reads the green by itself, as it does in the simulator. */
        contour: [interval, state.contours && !state.greenGrid && !state.atEye ? blend(0.42, 0.2) : 0, 5],
        greenGrid: state.greenGrid && {
          time: greenTime(),
          scale: Math.max(1, PULSE_LEAST_PIXELS * metresPerPixel / PULSE_WIDTH_METRES),
        },
        tint: [course.heightLow, course.heightHigh],
      }, pulseOnly);
      state.stats.triangles = drawn.triangles;
      state.stats.trees = drawn.trees;
      state.stats.holeTrees = drawn.holeTrees;
      state.stats.detailedTrees = drawn.detailedTrees;
      state.stats.patches = drawn.patches;
      state.stats.frames++;
      store.markUsed(selection);
      if (boot && !boot.classList.contains('done')) { boot.classList.add('done'); boot.setAttribute('aria-hidden', 'true'); }
    }

    /* A view moved by hand reaches the buttons here: gestures only ask for a frame. */
    refreshFloat();
    const currentHole = hole(), currentOrigin = origin();
    const selectedClub = state.guidance?.selectedClub;
    const toGreen = Math.hypot(currentHole.green.c[0] - currentOrigin[0], currentHole.green.c[1] - currentOrigin[1]);
    const aimDist = state.guidance?.reading?.distance ?? 0;
    const clubCap = selectedClub && !isPutter(selectedClub) && selectedClub.carry > 0 ? selectedClub.carry + 40 : 120;
    const clubStat = selectedClub ? clubHistoryStats.get(selectedClub.id) : null;
    const clubArc = state.mode === 'hole' && !state.greenView && !state.atEye
      && selectedClub && !isPutter(selectedClub) && selectedClub.carry > 0
      && selectedClub.carry <= Math.max(toGreen, aimDist) + 30
      ? {
          carry: selectedClub.carry,
          shortest: clubStat?.known ? clubStat.shortest : null,
          reach: clubStat?.known ? clubStat.reach : null,
        }
      : null;
    const overlayReach = toGreen <= 130 ? toGreen + 25 : Math.max(clubCap, aimDist ? aimDist + 25 : 0);
    const overlayHazards = state.showHazards && !state.greenView && !state.atEye
      ? reachableHazards(state.hazards, overlayReach)
      : [];
    const safe = insets();
    overlay.draw({
      camera,
      ground: shown,
      course,
      mode: state.mode,
      hole: currentHole,
      origin: currentOrigin,
      tee: state.guidance?.source === 'tee' ? teePoint() : null,
      /* The player is the eye here, with nothing to mark. */
      player: state.atEye ? null : state.player,
      carryArcs: !state.atEye && state.showRings,
      clubArc,
      atEye: state.atEye,
      safe,
      emphasis: display.get('sun') ? 1.3 : 1,
      mirrored: display.get('left'),
      guidance: state.guidance,
      hazards: overlayHazards,
      shotFrom: state.mode === 'hole' ? trailFrom : null,
      trail,
      pinRings: Boolean(state.greenGrid),
    });

    state.stats.lastDrawMs = performance.now() - started;
    const settlingOn = state.atEye ? eyeView(origin(), camera.state.bearing, state.eyePitch).y : shown(camera.state.x, camera.state.z);
    if (state.flight || backlog > 0 || shadesWaiting > 0 || Math.abs(settlingOn - camera.state.y) > 0.05) invalidate();
    const busyTiles = store.stats().busy;
    root.classList.toggle('is-streaming', busyTiles > 0);
    if (busyTiles === 0 && !state.flight) {
      refreshProfile();
      refreshGreenPlays();
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
    scheduleGreenPulse();
    state.pace.end = measurePace ? performance.now() : null;
  }

  resize();
  say('hämtar terrängen');
  refreshNumbers();
  refreshScore();
  if (course.greensApproximate) status('Greenernas form är ungefärlig på den här banan', 6000);
  /* Consume launch instructions. A bookmark or reload can still describe a preview
     while ordinary round links resume the confirmed hole from the card. */
  function clearEntryAddress(keepPreview = false) {
    if (!keepPreview && !params.has('runda') && !params.has('hal') && params.get('vy') !== 'forhandsvisning') return;
    if (!keepPreview && params.has('tee') && (params.get('runda') === 'visa' || params.get('vy') === 'forhandsvisning')) state.tee = savedTee(course);
    params.delete('runda');
    if (keepPreview) {
      params.set('karta', '1');
      params.set('vy', 'forhandsvisning');
      if (params.has('tee') || state.tee !== savedTee(course)) params.set('tee', String(state.tee + 1));
      params.set('hal', String(state.hole));
    } else {
      params.delete('hal');
      params.delete('tee');
      if (params.get('vy') === 'forhandsvisning') params.delete('vy');
    }
    try {
      const search = params.toString();
      globalThis.history.replaceState(globalThis.history.state, '', `${location.pathname}${search ? '?' + search : ''}${location.hash}`);
      canonicalMapAddress = location.href;
    } catch { /* navigation may be unavailable in an embedded browser */ }
  }

  if (entry === '1') {
    if (!roundUnderWay()) {
      if (round.endedAt) freshRound();
      const known = savedText(HANDICAP_KEY, '');
      round.handicap = known !== '' && Number.isFinite(Number(known)) ? Number(known) : null;
      round.begunAt = Date.now();
      setPlayingHole(state.hole);
      diary.add('round-started', teeName());
      refreshScore();
      status(`Rundan är igång från tee ${teeName() ?? ''}`.trim(), 3200);
    }
    if (!gps.active) startGps();
  }
  const openOffline = state.previewOnly && params.get('offline') === '1';
  if (openOffline) params.delete('offline');
  if (entry || openOffline) clearEntryAddress(state.previewOnly);
  const offerStart = !entry && !state.previewOnly && isPhone() && !params.has('hal') && !roundUnderWay() && !savedFresh(LOOK_KEY) && !savedFresh(`${GPS_KEY}:${course.slug}`);
  /* Protect live GPS rounds from accidental jumps to Simulator / Detailed 3D / Bag editor. */
  for (const link of root.querySelectorAll('[data-leave-guard]')) {
    let armed = 0, original = '';
    link.addEventListener('click', event => {
      if (!(gps.active && roundUnderWay()) || armed) {
        clearTimeout(armed);
        armed = 0;
        return;
      }
      event.preventDefault();
      original = link.innerHTML;
      const valueEl = link.querySelector('.map-row-value');
      if (valueEl) valueEl.textContent = 'Rundan sparas · tryck igen';
      else link.textContent = `${link.textContent.trim()} · tryck igen`;
      armed = setTimeout(() => { armed = 0; link.innerHTML = original; }, 4000);
    });
  }

  if (window.history.state?.banvyMapPanels?.course === course.slug) {
    panels.restore(window.history.state);
  } else if (openOffline) {
    setMenuTab('bana');
    refreshMenu();
    if (isDesktop()) selectDeskTab('menu');
    else showSheet(ui.menuSheet);
  } else if (resumeUnavailable || offerStart) {
    openStart();
  } else firstTip();
  if (isDesktop()) syncDesktopDock();

  if (entry !== '1' && !state.previewOnly && !resumeUnavailable && savedFresh(`${GPS_KEY}:${course.slug}`)) {
    navigator.permissions?.query({ name: 'geolocation' }).then(result => {
      if (result.state === 'granted' && !gps.active) startGps();
      else if (result.state === 'denied' && !gps.active) setGpsState('denied');
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
    stats: () => ({ ...state.stats, ...store.stats(), appearanceReady: Boolean(visuals), framePending: Boolean(raf), camera: { ...camera.state } }),
    fix: (latitude, longitude, accuracy = 4, timestamp = Date.now()) => receiveFix({ latitude, longitude, accuracy }, timestamp),
    refix: () => receiveFix(state.lastCoords, Date.now()),
    /* Time on a tee passes faster on a harness than on a course. */
    skipTime(milliseconds) { state.clockAhead += milliseconds; scheduleGuidanceExpiry(); },
    worldOf: (latitude, longitude) => course.frame.toWorld(...gpsToLocal({ latitude, longitude }, course.geo)),
  };

  const pendingPutter = openShot(shots);
  if (pendingPutter && ours(pendingPutter) && isPutt(pendingPutter) && !round.endedAt) askPutts(pendingPutter.hole);
  else if (!previewing() && roundUnderWay() && Number.isFinite(round.scores[state.playing]?.putts)) askScore(state.playing);
}

start().catch(fail);
