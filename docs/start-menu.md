# The start menu, the settings and the statistics (7 November 2026)

The owner asked for a menu before the course list: the detailed 3D course, the light
3D map and the settings each as a card, the courses for the mode chosen, a settings
page for everything, all "visually stunning", in the spirit of a launch monitor's
home screen. They then asked for a statistics page that goes into everything the
rounds and the club wheel measure, and for the course posters to be recaptured in
the current graphics and used by both modes.

## What the audit found on the old front door

- **The mode was decided by device, silently.** A card opened the light map on a
  phone and the detailed course on a desktop. A small chip on each card ("Karta" on
  a desktop, "3D" on a phone) was the only way to the other mode, and "Karta" stood
  beside the list's own "Sverigekarta" switch, which is a different map.
- **No settings before a course.** Quality, graphics backend, frame cap, light and
  developer overlay sat in the detailed course's drawer, behind a boot of up to 40
  seconds. The map's light, looks and detail level lived in the map's own menu, and
  the bag could only be edited inside one of the two programs.
- **No way back to where you were.** The last course led the list, but not the mode
  it was played in.
- **The posters showed September's painted graphics.** They predated the realistic
  trees, the tour turf, the temporal AA and the water reflections.

## The flow

The bare route (`hub.js`) is four screens on one page, chosen by the hash, so the
browser's back and forward walk them and a link opens any of them. The bare route
still loads no 3D engine.

| Hash | Screen | Module |
|---|---|---|
| (none) | Start menu | `shell/home.js` |
| `#3d`, `#karta` | Courses for Detaljerad 3D or Lätt 3D | `shell/rail.js` |
| `#statistik` | Statistik | `shell/stats-page.js` (loaded on first visit) |
| `#installningar` | Inställningar | `shell/settings-page.js` (loaded on first visit) |

- **Start menu.** Backdrop: the last course played, or Veckefjärden's island green.
  It shows the course count, a **Fortsätt** card (last course, in the mode it was
  played, one tap), and four cards: the two modes (the one the device is best at is
  marked), Statistik and Inställningar. The small cards state what they hold: the
  round count and scoring average, and what a launch will use. Keys 1 to 4 open them.
- **Course list.** The mode is a two-way switch at the top and changes every card in
  place (`setMode`, a replaced history step, so one back reaches the menu). Every
  call to action says what it opens. In the player the same list keeps its glass
  over the running course. Its back button leaves for the start menu, and a pick in
  Lätt 3D is a plain navigation to the map.
- **Launch.** `settings-store.mjs launchUrl` writes the mode into the link. Lätt 3D
  always carries `karta=1`. Detaljerad 3D carries `karta=0` only on a phone, which
  would otherwise open the map. The start settings ride along as the URL grammar the
  player already reads. Switching course inside the player (`router.js goToCourse`)
  adds them only where the running link is silent.
- **The other way in.** The player's drawer has **Byt bana** (the list) and
  **Startmenyn** (a link). The map's **Alla banor** opens the Lätt 3D list, and the
  map records its course for Fortsätt.

## Settings: one home for each value

`main.js`, `engine/`, `loader/` and `packages/course-v2` feed the prepared startup
data's source revision, so they were **not edited**: every setting reaches its
program the way it already listens.

| Setting | Stored in | Reaches the program as |
|---|---|---|
| Grafikkvalitet (Auto/Hög/Låg) | `banvy-settings-v1` | `?q=hi\|lo` |
| Grafikmotor (Auto/WebGL2) | `banvy-settings-v1` | `?gl=1` |
| Ljus när banan öppnas | `banvy-settings-v1` | `?ljus=` (incl. `nu`) |
| Kameravy vid start | `banvy-settings-v1` | `?vy=` |
| Bildfrekvens | `banvy-fps` | read by `frame-pacer.mjs` |
| Utvecklarläge | `banvy:dev-overlay` | read by `dev-overlay.mjs` |
| Kartans ljus, Solläge, Större text, Hjulet till vänster, Hinderavstånd, Höjdkurvor, Detaljnivå | the map's own keys | read by `map-session.js` / `map-display.mjs` |
| Spelhandicap | `banvy-map-handicap-v1` | the map's next round |
| Min bag | `banvy-caddie-bag-v1` | both programs (the same editor, `ui/bag-editor.mjs`) |

An untouched setup launches the same plain link as before. A stored value outside
its set is ignored, never put in a URL. **Återställ** clears preferences only,
never the bag, the handicap, rounds, shots or courses kept offline.
`settings-store.test.mjs` holds the keys and light names against the programs that
read them.

## Statistik

Everything is counted by `stats-model.mjs` from the map's own records: kept rounds
(`banvy-map-rounds-v1`), locked shots (`banvy-map-shots-v1`) and the bag. A round
finished on the course is on the page the moment it opens. The page has:

- one headline figure: the scoring average against par per 18 holes, with the last
  five rounds against the ones before;
- six readings: rounds, best round, fairways hit, greens in regulation, putts per
  green, Stableford;
- **Så spelar du**: up to four observations, each needing enough holes behind it
  (miss side off the tee, the costliest par type, putting, form, a gap in the bag,
  the longest shot);
- the trend line (crosshair and readout on hover, a tap on touch, arrow keys);
- the score distribution as a segmented bar with each par type's average;
- the tee shot as a fairway with left/hit/right shares, greens and putting;
- a club-length chart (spread, typical length, the bag's carry, wide or narrow gaps);
- courses, and every round with its scorecard (circles under par, squares over).

Period and course filters scope every figure. Every chart has a table view.

The score scale is diverging (blue under par, grey par, orange over). It was
validated with the dataviz validator against the cards' surface `#0f1d16`:
lightness band, CVD and normal-vision separation pass, and the grey midpoint is
neutral on purpose. The darkest steps sit under 3:1, which the labels, the
scorecard's shapes and the table views cover.

With no rounds the page explains how they are made and can show an **example**.
The example is deterministic, labelled "Exempel" on the page and in the header,
never stored and never mixed with a real record.

## The posters, recaptured

`tools/make-posters.mjs --write` re-shot every listed framing (13 courses, 65
posters) in the current graphics. The pinned look gained `?aa=traa`, since `det=1`
keeps MSAA on its own, and the temporal AA is what the water's reflections of
their shores ride on. The retired `?ghibli=1` was dropped. Each course's lead
poster is also written whole as `backdrop.webp` (1600 px) for the start menu.
Both modes use the same posters. The set is 5,074 kB against 4,346 kB before:
the realistic trees carry more detail. The cards still fetch extras one at a time,
only while on screen. The 13 backdrops add 2,383 kB to the repository, and the
start menu fetches one of them, about 110-280 kB.

Seen on the sheet: Visby's lead poster has a stair-stepped far coastline on its
left edge. That is a renderer artifact, not a capture one.

## Gates

`tools/check-chooser-ui.mjs` now opens the list at `#3d` for its measurements and
adds:
- the start menu at 390x844, 1440x900 and 1366x768: four cards whole on screen,
  the recommended mode, Fortsätt, 44 px targets;
- launch URLs per mode and device, with settings;
- the mode switch, Escape and the browser's back;
- settings landing in the right keys, and a reset that leaves the bag alone;
- the statistics page empty, with the example and from a kept round.
