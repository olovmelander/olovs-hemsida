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
  Since 25 November it leads with the clubs (*The lobby*, below).
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

## A course, before the round (8 November)

The owner asked to start a round as other golf apps do: choose the tee and the
rest first, then play. In the start menu a course card no longer launches at
once. It opens the course's own page (`shell/course-sheet.js`, a native
`<dialog>`), with:
- the course in its posters, rolling, with its par, holes and the length from the
  chosen tee;
- the weather on the course now (temperature, sky, wind and gusts), from the
  reading the app keeps half an hour per course, never under `det=1` or a
  webdriver;
- how you have played it before (rounds, best, average per 18), from the map's
  records, with a link to that course in Statistik;
- **Spela i**: Detaljerad 3D, Lätt 3D or Simulator, preselected from the list's mode
  (always visible since 25 November, below);
- **Tee**: chips in the tee's own colour, preselected from the tee last played
  there. It is kept under the map's own key (`banvy-map-tee-v1:<slug>`), so
  both programs start on the same tee;
- **Starta på**: hole 1 or 10 on an eighteen;
- for Lätt 3D, the **playing handicap** (kept as the map's handicap), and for
  Detaljerad 3D, the **light** for this visit (the settings' light preselected);
- the **Scorekort**: par, index and the chosen tee's length, nine by nine with Ut
  and In, and with rounds kept there a **Snitt** row of your own average per hole
  (blue under par, orange over);
- the **Banguide**: each hole in the course's own name and note, one card at a
  time, brought to the starting hole.

The card and the guide are read from the course's own pack (`course-scorecard.mjs`),
by the one URL the round asks for next, so nothing is copied into the manifest and
the round reads the pack from the cache. `course-scorecard.test.mjs` holds every
published pack's card against its manifest's holes and par, with a length for every
tee.

**Starta rundan** opens the map with `runda=1`. The map then begins the round at
once, with no start card, and asks for the position; the word leaves the address,
so a reload does not begin another round. A round already under way on that course
carries on. **Bara titta på banan** opens the map without a round, and **Spela i
3D** opens the detailed course with `tee=` and `hal=`. Escape, the close button,
the backdrop or any change of screen closes the page. On a phone it fills the
screen, posters on top and the button under the thumb.

## The lobby (25 November)

The redesign's first recommendation ([the UI redesign](ui-redesign-2026-11-25.md),
B1 and G#1, adopted by the owner) asks *where* before *how*. The start menu now leads
with the clubs (`home.js` `renderClubs`):

- **Var spelar du?** is the title, over the course count. *Fortsätt* and *Nära dig*
  keep their place above the clubs.
- **Klubbar** lists every club by Swedish name. Each row has the course's picture,
  the club's name, its town and its layouts in the club page's order (*The Stadium
  Course · The Castle Course*), or a single course's holes and par. A game under way
  is named in green. *Sök, sortera och karta* opens the list, with its search, sort
  and Sverigekarta, in the mode a row would use.
- **A row opens the club page** in the mode last launched (`banvy-last-mode`), else
  in the device's own: Lätt 3D on a phone, Detaljerad 3D on a computer. The page shows
  the mode and changes it in one tap. It lies over the lobby rather than over the list
  (`overHome` in the history entry), so one Back returns to the lobby with the row in
  focus. The same address from the list, or from a link, keeps the list behind it.
- **Eller börja med ett sätt att spela:** the three modes follow, compact (one line
  of 64 px each at 900 px and narrower, three cards of 112 px wider), then Statistik
  and Inställningar. Keys 1 to 5 still open them.

Past twelve clubs the lobby lists the golfer's own clubs and gets a search of its own
(*A hundred clubs*, below). Still to come (the redesign's Phase 2 and 3): its filter
and map toggle, the phone's tab bar and layout chips on the list's club cards.

## A hundred clubs (25 November)

The owner asked what happens with more than a hundred clubs. Listing every club
would push the ways to play, Statistik and Inställningar about ten phone screens down.
Each row would also fetch an 800 px poster for a 56 px picture (73 kB on average),
and the Sverigekarta's pins would pile up. So once there are more than twelve clubs
(`lobby-model.mjs` `LOBBY_ALL_CLUBS`), the lobby lists the golfer's own clubs and
searches the rest. At twelve clubs or fewer it lists every club as before, so today's
eleven look the same.

- **Search.** A field under *Klubbar* uses the list's own search, moved into
  `club-search.mjs` for both:
  - it finds a club by name, layout, town, region words, par or holes, with every
    word matching one layout;
  - the best hits come first: a name that begins with the words, then a word of the
    name, then layouts and towns, then the rest, with numbers in order (2 before 10);
  - it shows five hits on a phone and eight on a computer;
  - *Visa alla N träffar* opens the list with the same words in its search;
  - `/` reaches the field, and Escape empties it.
- ***Dina klubbar*** lists five clubs on a phone and eight on a computer:
  - a game under way;
  - then the courses launched lately, each saying when (*Öppnad i går*). They come
    from `banvy-recent-courses-v1`, which `rememberLaunch` keeps with the last
    course, so every way in adds to it;
  - then the rounds the map kept (*Spelad 23 nov*);
  - then, where the phone has already given its position, the nearest clubs within
    200 km, each with its distance.

  A club already on a card above (a game under way, *Nära dig*, *Senast öppnad*) is
  left out of the short list.
- ***Klubbar nära mig*** asks for the position only when tapped. If it is refused,
  the lobby says so and offers *Försök igen*. *Alla N klubbar* opens the full list.
- **Thumbnails.** A row shows `thumb.webp`, the poster's middle square at 168 px,
  4–8 kB each. `tools/make-posters.mjs` writes it with the poster. Its `--thumbs`
  mode writes it from the shipped `hero-1.webp` without a boot or a GPU. The service
  worker keeps thumbnails with the posters (`banvy-posters`, now 96 entries).
- **The Sverigekarta** groups pins that would stand on each other into one count
  (`pin-groups.mjs`):
  - pins closer than 44 px join a group, through any chain of them, and groups whose
    middles would touch merge;
  - a tap or Enter zooms in on the group's clubs, at least one step. The keyboard
    lands on the first club, or on the smaller group still holding it, where Enter
    goes on;
  - this only happens with more than twelve clubs on the map, so every club keeps
    its own pin today, as `check-chooser-ui` expects. Today's opening view already
    has pins 4–9 px apart at Örnsköldsvik and Västerås; grouping those too would
    change that gate.
- **Key hints.** The mode cards' hints stay hidden while the search has the keys,
  and keep clear of the arrow in the compact cards.

A new club still needs its entry in `course-places.mjs` to be on the map and in
the distance sort.

## One page per club (25 November)

A club with several layouts (Bro Hof, Upsala, Johannesberg, Veckefjärden) no longer
opens a picker dialog in front of the course page. Its card, map pin or *Nära dig*
opens the course page directly, which became the club page:

- **Bana** lists the club's layouts, the host's own course first (*The Stadium Course |
  The Castle Course*), each with its holes and par. In Lätt 3D a layout also says
  *Tidigare nedladdad*, and a game under way in the chosen mode is named in green
  (*GPS-runda pågår · Hål 4 · Tee Röd*). Switching layout happens in place. It keeps
  the mode, handicap, light and open sections, the tee by its name (Gul stays Gul),
  and the start hole where the layout has it. The address is rewritten without a
  new history step, so one Back still reaches the list.
- **Which layout opens:** the one with a game under way in this mode, else the one
  last chosen at the club (`banvy-club-layout-v1:<club>`, written on a switch and a
  launch), else the course last played, else the host course
  (`course-clubs.mjs` `clubLayouts`, `preferredLayout`).
- **Spela i** is always visible: three tiles in a row on a phone (icon over name), or
  with their sub-lines on a wider screen. It replaces the *Byt läge* disclosure.
- `#<mode>/klubb/<club>` links still work and land on the same page. The picker
  dialog (`club-picker.js`) remains only in the player's own *Byt bana* list.

Mode switches now keep the golfer's place:
- Lätt 3D's *Spela hål N i simulatorn* carries the hole and tee (`playUrl` takes
  them).
- Detaljerad 3D's drawer has a *Byt läge* row with Lätt 3D and Simulator, both on
  the displayed hole and tee.
- The Simulator's menu offers *Visa hålet i Detaljerad 3D* and *Lätt 3D*, which save
  the game first, as *Spara och lämna* does.

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
`#statistik/<course>` opens the page on one course, at Hål för hål. The course
page links there from its history, and each row under Banor opens its course.

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
- the start menu at 390x844, 1440x900 and 1366x768: since 25 November every club
  listed and the first row whole on the first screen, then the five destinations,
  touch-sized; Fortsätt; 44 px targets;
- launch URLs per mode and device, with settings;
- the mode switch, Escape and the browser's back;
- settings landing in the right keys, and a reset that leaves the bag alone;
- the statistics page empty, with the example and from a kept round;
- since 8 November: the course page (its scorecard from the pack, the length and
  card following the tee, the guide, your Snitt row and averages), the link from
  it to `#statistik/<course>` and back, Banor rows and Spela, a round under way,
  a course kept offline, and the backup round trip.

`tools/check-hub-journeys.mjs` walks the lobby on a phone and a desktop (25 November):
the clubs by name, Bro Hof's layouts with the host course first, a row opening its
club page over the lobby in the last mode or the device's, and Back to the row.

`tools/check-lobby-scale.mjs` (25 November, in the release journeys) serves today's
catalogue with 110 made-up clubs beside it, on a phone and a desktop:
- a first visit: no club of its own, the five destinations on the first screen,
  *Klubbar nära mig* refused and then given;
- a returning golfer: five or eight clubs of their own, newest first, never the one
  on the card above, the destinations within 1.6 screens;
- the search: by layout, by town, no hit, 110 hits with *Visa alla* into the list
  and back, Escape, and a hit's club page;
- the map: no drawn mark on another, and a group opened from the keyboard.

It then opens today's catalogue as it is and checks every club is listed and every
pin drawn.

`tools/check-map-field.mjs` checks the start menu's mode cards and the near-course
card, the round started from a plain link, and a finished round's Se statistik.
