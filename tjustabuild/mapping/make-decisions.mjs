#!/usr/bin/env node
/* Tjusta's routing decisions, written as data with their reasons.

   node tjustabuild/mapping/make-decisions.mjs      writes tjustabuild/mapping/decisions.json

   The club publishes no hole map, and OSM has the course's outline, 19 greens and 6 tees from Bing
   (about 2012) but no hole ways. The routing was first read on the 2025-06-14 photo and the
   2021-04-18 leaf-off photo against the par-72 card and the club's local rules (2023, valid from
   2025): out of bounds left of the road on 1, left of the service road on 6 and of the road on 7,
   right of the field on 11 and of the ditch and field on 13; a coffee break after 9; the club's
   photo of 18 across the farm pond. Then golfisverige.com's hole plates were registered on the photo
   (register-guide-plates.py, guide-plates.json): each plate's yellow tee and flag, read through its
   fit. They agreed on 1, 2, 5-8, 13, 14 and 17, and moved four things: 9 and 16 had been swapped
   (9 is the west corridor, to the ringed green south of the black barn; the plate's "next tee" points
   west to 10); 10 tees from a clearing south of the row house, not from the farm yard; 15 tees from
   the north arm of the L-shaped deck whose lower part is 8's; and 4, 11 and 18 tee from the next deck.
   The first look and the blind second look (2026-11-26) had doubted most of those same tees.

   Every green seed and most tee points are candidates of the tracer's own detectors (the turf
   model's green components and tee_platforms' level decks); a tee the laser does not show as level
   is drawn as a ring or an oval on the photo, and says so. The tracer measures every outline again;
   the ring review looks at each one. A wrong one is fixed here and traced again. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const deck = (at, tees, why) => ({ src: 'platform', at, tees, why });
const ring = (points, tees, why, reach) => ({ src: 'ring', ring: points, tees, ...(reach === undefined ? {} : { reach }), why });
const oval = (c, size, rot, tees, why) => ({ src: 'ellipse', c, size, rot, tees, why });
const seed = (at, why) => ({ seed: at, why });
/* A green drawn as an oval on the photo (centre, half-axes east-west and north-south, turn in degrees), for the tracer to
   snap to the putting surface's edge within `reach` metres: where the turf model's own component took in collar, apron or
   a tree's shadow (the blind look of 26 November named each of these). */
/* A green drawn as a closed curve through points read off the photo (a Catmull-Rom spline, eight to a span), where the
   putting surface is no oval. */
const loop = (points, why, reach = 1) => {
  const m = points.length, ring = [];
  for (let i = 0; i < m; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((k) => points[(i + k + m) % m]);
    for (let s = 0; s < 8; s++) {
      const u = s / 8;
      ring.push([0, 1].map((k) => Math.round(0.5 * (2 * p1[k] + (p2[k] - p0[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u
        + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * u * u * u) * 10) / 10));
    }
  }
  return { ring, reach, why };
};
const oval2 = (c, a, b, turn, why, reach = 1.5) => ({
  ring: Array.from({ length: 28 }, (_, i) => {
    const u = 2 * Math.PI * i / 28, x = a * Math.cos(u), y = b * Math.sin(u), r = turn * Math.PI / 180;
    return [Math.round((c[0] + x * Math.cos(r) - y * Math.sin(r)) * 10) / 10, Math.round((c[1] + x * Math.sin(r) + y * Math.cos(r)) * 10) / 10];
  }),
  reach, why });

const holes = {
  1: { why: 'From the decks by the car park east-north-east along the field, Kimstavägen on the left (OB, local rule 1b).',
    bends: [[669250, 6611580]],
    pads: [deck([669121.4, 6611463.2], ['gul'], 'OSM tee way, a level deck; 395 m to the green'), deck([669149.2, 6611499.3], ['rod'], 'OSM tee way, 349 m')],
    green: oval2([669469.1, 6611615.7], 10.1, 9.3, -15, 'the raised putting surface with a bunker short left (OSM\'s green): one even oval on the May 2023 and July 2019 photos. On the 2025 photo it stands among concentric mowing rings of the same green, and the search begun from the turf model\'s component stopped on one of those, 3 m out on the west and north', 1) },
  2: { why: 'North over Kimstavägen and up the fairway along the field edge to the green in the north corner.',
    bends: [[669490, 6611790], [669560, 6611900]],
    pads: [deck([669425.8, 6611682.5], ['gul'], 'level deck north of the road; 377 m'), deck([669468.7, 6611721.5], ['rod'], 'level deck; 320 m')],
    green: seed([669601.9, 6612010.6], 'OSM green at the north end of the OSM fairway') },
  3: { why: 'Par 3 from behind the 2nd green south-east to the green in the clearing.',
    bends: [],
    pads: [oval([669628, 6612057], [18, 8], 108, ['gul', 'rod'],
      'the striped rectangle behind the 2nd green, the plate\'s long narrow tee (read by eye: the plate\'s own fit fails on a par 3); the laser\'s level platform round it is twice its size and takes in the apron')],
    green: oval2([669657.3, 6611928.1], 7.4, 8.2, 0, 'the round striped putting surface in the clearing east of the 2nd fairway, not in OSM: 15 m by 16 on the 2025 and 2023 photos alike. The turf model\'s component was twice that, taking in the collar and the dry apron south of it', 1) },
  4: { why: 'From the decks east of the 3rd green straight south-west over the trees to the bunkered green by the road: the plate draws a straight line of 257 m, the card\'s length (OSM draws a dogleg fairway round the trees).',
    bends: [],
    pads: [ring([[669684.9, 6611889.1], [669688.9, 6611886.3], [669697, 6611897.9], [669693, 6611900.7]], ['gul'],
      'the mown deck with a tee box at its far end, by the path spur, on the 2025 and 2023 photos; its near end is 259 m from the green (the card 257) and the plate puts the yellow tee there. The first two looks had the yellow tee on the shaded platform 10 m ahead of it (the blind look doubted it three times); the May 2023 photo showed this deck'),
      deck([669643.6, 6611834.8], ['rod'], 'the small level patch 10 m from the plate\'s line, 56 m ahead of the yellow tee: the card gives Röd 201 against Gul 257. No photo year shows a red tee box and the plate draws none, so this is the laser\'s nearest level ground to where it must stand: a fault until someone has seen the hole'),
      ring([[669670.6, 6611872.8], [669669.4, 6611874.2], [669669.8, 6611874.8], [669676.1, 6611881], [669677.3, 6611882.8], [669679.3, 6611884.3], [669680.1, 6611884.3],
        [669680.8, 6611883.8], [669683.2, 6611880.3], [669683.2, 6611879.4], [669680.8, 6611877], [669679.1, 6611876.7], [669674.8, 6611873], [669672.5, 6611873.3]], [],
        'a level platform of the laser between the yellow deck and the box ahead of it, under crowns, with a worn patch at its near end on the 2023 photo: part of the tee line, with no colour on the card. Kept as the laser drew it', 0),
      deck([669668.9, 6611869.7], [], 'the mown tee box 20 m ahead of the yellow deck, on the 2019, 2023 and 2025 photos, 234 m from the green: a tee the card gives no colour (the card has Röd at 201)')],
    green: seed([669536.5, 6611676.3], 'OSM green, two bunkers behind it to the north') },
  5: { why: 'Par 5 south across Kimstavägen and down the long straight fairway beside the wetland.',
    bends: [],
    pads: [deck([669515.1, 6611611.2], ['gul'], 'rectangular deck by the road; 430 m'), deck([669486.9, 6611553.9], ['rod'], 'deck at the top of the fairway; 372 m')],
    green: seed([669467.1, 6611182.3], 'green at the south end of the two OSM fairway pieces') },
  6: { why: 'Par 3 north-west to the bunkered green; the service road on the left is OB (local rule 1c).',
    bends: [],
    pads: [deck([669454.3, 6611140.5], ['gul', 'rod'], 'deck by the yard at the road; 128 m, the card 127/127')],
    green: oval2([669373.8, 6611240], 13.7, 9.8, 0, 'the striped oval putting surface, two bunkers south of it; the component also took in the collar west, north and east of it') },
  7: { why: 'Par 5 south down the meadow corridor; Kimstavägen on the left is OB (local rule 1d).',
    bends: [],
    pads: [deck([669322.8, 6611195], ['gul'], 'raised deck west of the service road; 506 m'), deck([669329.2, 6611113.9], ['rod'], 'deck at the head of the meadow; 424 m')],
    green: oval2([669403.4, 6610696.4], 10.7, 13, 0, 'the oval putting surface north of the small pond, bunker short of it; the component\'s east edge followed a tree\'s shadow in a 3 m notch', 1) },
  8: { why: 'West along the north half of the wide field to the green below the wood.',
    bends: [],
    pads: [ring([[669368.4, 6610664.8], [669368.4, 6610659.2], [669370.6, 6610658], [669379, 6610657.4], [669381.6, 6610659.8], [669382, 6610666.5], [669376, 6610667], [669371, 6610665]],
      ['gul'], 'the west-facing lower part of the L-shaped deck between the 7th and 14th greens, where the plate puts the yellow tee; the north arm is 15\'s. Kept as drawn so the two do not grow into one', 0),
      deck([669327.6, 6610664.9], ['rod'], 'deck in the field; 252 m')],
    green: oval2([669080.2, 6610722.1], 9, 9, 0, 'the round putting surface with concentric mowing below the wood at the west end of the field: the pale disc and its first ring. The turf model\'s component took in the dry patch east of it, and the first redraw the apron south of it (the blind look\'s doubts)') },
  9: { why: 'North up the west corridor to the ringed green south of the black barn and the bale stack (the plate); the coffee break after 9 (local rule 8a). The plate\'s "next tee" points west, to 10.',
    bends: [[669069, 6611064]],
    pads: [ring([[669119.7, 6610838.6], [669119.5, 6610841.1], [669121, 6610842.9], [669120.5, 6610844.1], [669120.5, 6610851.6], [669122.1, 6610853.2], [669124.3, 6610853.2],
      [669125.5, 6610852.1], [669125.5, 6610850.3], [669126, 6610849.5], [669126, 6610846.5], [669125.5, 6610845.5], [669126, 6610843.9], [669124.6, 6610841.9], [669124.4, 6610840.8], [669121.5, 6610837.9]], ['gul'],
      'the southernmost deck of the west corridor, the lit mown patch on the 2021 photo, where the plate puts the yellow tee; kept as the laser drew it, since refined on the 2025 photo it narrowed into the shade (the blind look\'s doubt)', 0),
      deck([669111.5, 6610904.2], ['rod'], 'deck at the corridor foot')],
    green: seed([669146.7, 6611214.5], 'the green with concentric mowing rings south of the black barn, the plate\'s flag') },
  10: { why: 'From a clearing south of the row house west across the meadow, round the north of the west pond, to the green at the head of the strip (the plate: plays 10 m downhill).',
    bends: [[668772, 6611333]],
    pads: [deck([668975.6, 6611248.7], ['gul'], 'the level patch in the clearing south of the row house, where the plate puts the yellow tee (13 m off)'),
      oval([668914, 6611275], [9, 6], 30, ['rod'], 'the round mown platform with a tee rectangle between the path and the wood, 79 m ahead; the plate\'s line passes it. Not level in the laser, so drawn on the photo')],
    green: loop([[668710, 6611237.2], [668714.5, 6611235.2], [668717.6, 6611231], [668718.6, 6611226], [668716.5, 6611221.5], [668711, 6611218.5], [668704.8, 6611219.5], [668700, 6611223], [668699.3, 6611227], [668701.8, 6611232], [668705.5, 6611235.6]],
      'the green at the head of the west strip, the plate\'s flag. Its rim shows round the north end and down the north-west side on every photo year; the mown tongue runs on south-west as the approach with no rim across it, so the front is set where the leaf-off photo of 2021 turns from green to dormant turf and the 2023 mowing pattern changes, uncertain by some 3 m; the east side lies under the wood\'s shadow on all four years and follows the 2021 edge and the 2023 mowing arcs. The turf model\'s component ran 15 m down the approach', 0.8) },
  11: { why: 'Par 5 south down the strip between the wood and the ditch, bending west and back into the green (the plate); the field on the right is OB (local rule 1e). The plate\'s line measures 518 m on its fit, the weakest of the 18, so its bulge is drawn four fifths as wide, which gives the card\'s 500.',
    bends: [[668625, 6610810], [668637, 6610734]],
    pads: [deck([668693.2, 6611162.2], ['gul'], 'level deck where the plate puts the yellow tee (4 m off)'), deck([668656.3, 6611091.8], ['rod'], 'OSM tee way, a level deck')],
    green: seed([668699.2, 6610706.2], 'OSM green at the south end of the strip, where it turns into the wood') },
  12: { why: 'Par 3 west over the edge of the west pond to the green beside the ditch.',
    bends: [],
    pads: [ring([[668703.4, 6610673.1], [668716.2, 6610674.4], [668717.2, 6610672.2], [668717.5, 6610669], [668703.5, 6610669]], ['gul'],
      'the mown tee strip south of the 11th green, 14 m by 5, with its worn tee box at the east end (bare on the 2023 photo); the plate, fitted on the 11th and 12th greens (its own fit fails on a par 3), puts the yellow tee on it. The first ring held only the tee box (the blind look\'s doubt)'),
      deck([668696, 6610654.2], ['rod'], 'the small level deck where the plate draws a forward tee (4 m off)')],
    green: oval2([668587.4, 6610639.1], 13.3, 10.5, -8, 'the oval putting surface west of the pond, the plate\'s flag (OSM\'s green): one even oval on the May 2023 photo, whose edge is the outer edge of the pale band round the stripes on the 2025 photo. The search begun from the component ran 4.5 m out over a bare patch at the south-east', 1) },
  13: { why: 'East-south-east from the decks by the ditch; the ditch and field on the right are OB (local rule 1f).',
    bends: [[668773, 6610500], [668848, 6610485]],
    pads: [deck([668584.3, 6610593.4], ['gul'], 'OSM tee way, a level deck; about 308 m'), deck([668648.8, 6610574.7], ['rod'], 'OSM tee way, a level deck; about 237 m')],
    green: oval2([668880, 6610497.1], 9.6, 7.4, 17, 'the oval putting surface at the east end of the fairway, two bunkers short of it; a pine\'s shadow covers its south-east third on the 2025 photo, where the component followed the shadow, so the oval is fitted on the leaf-off photo of 2021, which shows the whole rim', 0.8) },
  14: { why: 'East along the south half of the wide field to the green south of the small pond.',
    bends: [],
    pads: [deck([669015.1, 6610564.2], ['gul'], 'deck at the west end of the field; 366 m'), deck([669054.7, 6610585.5], ['rod'], 'deck; 324 m')],
    green: seed([669376.3, 6610620.7], 'green south of the small pond') },
  15: { why: 'North-west from the deck between the 7th and 14th greens up the open fairway to the green in the wood edge.',
    bends: [],
    pads: [ring([[669373, 6610677], [669375, 6610678.6], [669378, 6610678.6], [669381.5, 6610673], [669382, 6610667], [669376, 6610667], [669375.5, 6610673]],
      ['gul'], 'the north arm of the L-shaped deck whose lower part is 8\'s, where the plate puts the yellow tee; the plate\'s line is the card\'s 332 m. Kept as drawn', 0),
      deck([669334.2, 6610709], ['rod'], 'deck; 278 m')],
    green: oval2([669247.8, 6610976.5], 8.6, 12.1, 30, 'the egg-shaped putting surface at the north end of the fairway from the field, the plate\'s flag; its rim is whole on the leaf-off photo of 2021. The component kept a 2 m tail of collar at the south end', 1) },
  16: { why: 'Par 5 (par 4 on the older card) north up the middle corridor to the green with a bunker short left, south of the farm buildings.',
    bends: [[669165, 6610950], [669180, 6611150]],
    pads: [deck([669161, 6610859], ['gul'], 'deck at the south end of the middle corridor, where the plate puts the yellow tee'), deck([669155.8, 6610906.1], ['rod'], 'deck')],
    green: oval2([669241.6, 6611228.3], 13.3, 8.6, -5, 'the striped oval putting surface with a bunker short left, the plate\'s flag; the component ran 10 m down the approach south-west of it') },
  17: { why: 'Par 3 north-east to the round green east of the 1st fairway.',
    bends: [],
    pads: [deck([669316.4, 6611346.5], ['gul'], 'deck in the rough north of the service road; 183 m'), deck([669359.4, 6611392.2], ['rod'], 'rectangular deck; 121 m')],
    green: oval2([669421.9, 6611494.7], 10.9, 12.1, 0, 'the round putting surface inside its pale collar ring; the component took in the collar at both north corners and along the south') },
  18: { why: 'West-south-west round the farm pond to the green below the clubhouse terrace (the club\'s photo of 18 across the pond).',
    bends: [[669272, 6611393]],
    pads: [ring([[669419.5, 6611545.5], [669426.5, 6611554.5], [669434, 6611550], [669427, 6611542.5]], ['gul'],
      'the mown rectangle with a tee marker north-east of the round mown oval, where the plate puts the yellow tee (7 m off). Not level in the laser, so drawn on the photo'),
      deck([669356.7, 6611500.8], ['rod'], 'the mown rectangle beside the plate\'s line 96 m ahead of the yellow tee (1.3 m off), a level deck; the plate draws no red tee. The deck first chosen, 35 m behind it, is rough with bushes on both photos'),
      deck([669416.4, 6611538.7], [], 'the round mown oval between the 17th green and the yellow tee, a level deck on all four photo years: a tee the card gives no colour')],
    green: oval2([669129, 6611421.6], 10.6, 11.3, 0, 'the round putting surface below the barn, bunkers right and behind (OSM\'s green): one even oval on the May 2023 and July 2019 photos. The search begun from the component kept 2 m of collar at the north-west, the last of the knob the blind look named', 1) },
};

const out = {
  schemaVersion: 1,
  groundId: 'tjusta',
  slug: 'tjusta',
  horizontalCrs: 'EPSG:3006',
  coordinateOrder: ['easting', 'northing'],
  reviewedOn: '2026-11-26',
  reviewer: 'Claude Opus 5.5 (agent), on the 2025-06-14 0.16 m and 2021-04-18 leaf-off RGBI orthophotos, the 1 m laser terrain and the par-72 card',
  greenOpenMetres: 3,
  greenInsetMetres: 2.5,
  greenReachMetres: 2,
  note: 'No club hole map exists online; the routing is read from the photos against the card, the local rules and the club\'s photos (make-decisions.mjs says how). Each pad is a level deck of the terrain and each green a component of the turf model, both from the tracer\'s own detectors. Tees with a card residual over 5 m are named in the walkthrough. The owner is asked to confirm the routing.',
  holes: Object.fromEntries(Object.entries(holes).map(([n, h]) => [n, {
    why: h.why,
    bends: h.bends,
    pads: h.pads.map(({ why, ...p }) => ({ ...p, why })),
    green: h.green,
  }])),
};
const file = path.join(ROOT, 'tjustabuild/mapping/decisions.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`wrote ${path.relative(ROOT, file)}: ${Object.keys(holes).length} holes, ${Object.values(holes).reduce((s, h) => s + h.pads.length, 0)} pads`);
