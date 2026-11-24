/* Writes Bro Hof's reference-annotations (review-2026-11-24; one sample, carried verbatim by rounds r1 and r2) from the
   drafts of tools/tree-pipeline/photo/reference-draft.mjs and the interpreter's decisions below, and the windows files
   with the windows that could not be interpreted moved to `dropped`. Agent-led interpretation (Claude, 2026-11-24), not
   a survey. Run from the repository root after the drafts exist in the cache:
   node geo_data/course-v2/bro-hof/vegetation/review-2026-11-24/scripts/reference-annotate.mjs */
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'geo_data/course-v2/bro-hof/vegetation/review-2026-11-24';
const P = 'brohofbuild/cache/trees-2026-11-24/reference-panels';
const ROOF = 'a roof the pit-free CHM keeps as canopy (a roof in the 2025 and 2021 photos)';
const FELLED = 'trees of the 2020 laser that the 2025 photo does not show: felled since, scored for no one';
const THICKET = 'low or leafless thicket whose crowns neither the laser nor the photos separate';
const MASS = 'a joined broadleaf mass whose crowns neither the laser nor the photos separate';

/* windows that no source lets one interpret crown by crown, dropped before any detector ran or was scored */
const DROPPED = {
  'C3-s16-forest': 'closed thicket, leafless in both the laser and the April photo; the June photo shows no crown edges that match the laser lobes',
  'C4-c11-closed': 'closed mixed stand: the broadleaf half shows no crown edges and the photo shift over the canopy could not be measured (k unusable)',
  'C12-c7-east': 'closed mixed stand at the east edge of the image strips (shift over the canopy 10 m); crowns in the photos cannot be tied to laser lobes',
  'C13-se-east': 'closed young broadleaves, leafless in the laser; crowns do not separate in either photo',
  'C16-s18-wood': 'closed tall broadleaves, leafless in the laser; only one or two domes separate in the June photo',
  'H1-farm': 'closed broadleaf grove, leafless in the laser: its tops stand about 4 m apart on one even canopy and no photo decides which are crowns',
  'H3-s14-wood': 'leaning shore broadleaves with several stems each; crowns do not separate in either photo',
  'H5-s14-group': 'dense broadleaf grove, leafless in the laser: no crown edges in either photo',
};

/* per window: keep = draft crowns kept as drafted; crowns = drafts joined into one crown (at = its centre, metres from
   the window's SW corner); amb = ambiguity boxes; reject = candidates that are not trees; drop = part of a listed crown.
   default 'keep' keeps every inside draft not named; default 'ambiguous' boxes every inside draft not named. */
const SPEC = {
  'C1-castle-park': { default: 'ambiguous',
    crowns: [
      { at: [2, 23.5], labels: ['D61', 'D65', 'D68', 'D74'], type: 'broadleaf' },
      { at: [23, 26], labels: ['D54', 'D55', 'D58', 'D62', 'D67', 'D69'], type: 'broadleaf' },
      { at: [35.5, 24.5], labels: ['D59', 'D63', 'D64', 'D66', 'D70', 'D72'], type: 'broadleaf' },
      { at: [51, 13.5], labels: ['D76', 'D85'], type: 'broadleaf' },
      { at: [46, 2.5], labels: ['D92', 'D94', 'D97'], type: 'broadleaf' },
      { at: [14.8, 44], labels: ['D32'], type: 'broadleaf' },
    ],
    amb: [[[-1, 34.5, 13, 55], MASS], [[-1, 29.5, 6, 34.5], MASS], [[24, 30.3, 55, 55], MASS], [[9, -1, 34, 15.5], MASS], [[34, 10, 43, 18], MASS], [[42, 8, 47.5, 12], MASS], [[48.5, 0, 55, 9], MASS]] },
  'C2-c17-avenue': { default: 'ambiguous',
    keep: ['D7', 'D8', 'D9'],
    crowns: [{ at: [30.8, 57.3], labels: ['D3'], type: 'broadleaf' }, { at: [26, 46.6], labels: ['D4'], type: 'broadleaf' }, { at: [21, 34.3], labels: ['D6'], type: 'broadleaf' }, { at: [9.5, 6.8], labels: ['D10', 'D11', 'D12'], type: 'broadleaf' }],
    reject: { D5: 'a cut stump (2.8 m; a white trunk with a thick short shadow in the April 2021 photo, no crown in 2025)' },
    ambLabels: { D13: 'a 6.7 m snag or pollard (a white trunk with a thick short shadow in April 2021): a tree or not, not decidable' } },
  'C5-c13-edge': { default: 'keep',
    crowns: [
      { at: [19.8, 35.8], labels: ['D24', 'D25'], type: 'conifer' }, { at: [26.6, 33.5], labels: ['D28', 'D32'], type: 'conifer' }, { at: [21.5, 32], labels: ['D34', 'D36'], type: 'conifer' },
      { at: [29.8, 29.3], labels: ['D38', 'D42'], type: 'conifer' }, { at: [23, 20.8], labels: ['D53', 'D58'], type: 'conifer' }, { at: [24.5, 14.8], labels: ['D68', 'D72'], type: 'conifer' },
      { at: [4.8, 24.3], labels: ['D48', 'D51'], type: 'conifer' }, { at: [8.8, 20.3], labels: ['D55', 'D59'], type: 'conifer' }, { at: [10.8, 17], labels: ['D64', 'D65'], type: 'conifer' },
      { at: [29, 3.8], labels: ['D82', 'D84'], type: 'conifer' }],
    amb: [[[35.5, 31, 40, 39.5], MASS], [[35, 8, 39.5, 15], MASS]] },
  'C6-s2-grove': { default: 'ambiguous',
    keep: ['D9', 'D11', 'D14', 'D16', 'D18', 'D19', 'D21', 'D24', 'D28', 'D43', 'D44', 'D47', 'D50', 'D53', 'D54'],
    crowns: [
      { at: [41.8, 42], labels: ['D10'], type: 'broadleaf' }, { at: [32, 38.5], labels: ['D17'], type: 'broadleaf' }, { at: [37.5, 30.3], labels: ['D23'], type: 'broadleaf' },
      { at: [20.6, 19.4], labels: ['D31', 'D36', 'D38'], type: 'broadleaf' }, { at: [11.5, 8.8], labels: ['D48'], type: 'broadleaf' }, { at: [1, 25.8], labels: ['D27'], type: 'broadleaf' }],
    amb: [[[35, 16.5, 44, 23.5], 'two tops 4.5 m apart (14 and 11 m) in one broad crown: one or two trees, not decidable'], [[23, 22, 30, 26.2], MASS], [[0, 11.5, 9.5, 18], THICKET]] },
  'C7-c4-avenue': { default: 'ambiguous',
    keep: ['D6', 'D14'],
    crowns: [{ at: [54.5, 58.3], labels: ['D1'], type: 'broadleaf' }, { at: [59.6, 53.6], labels: ['D2'], type: 'broadleaf' }, { at: [49, 50.8], labels: ['D4'], type: 'broadleaf' }, { at: [43, 44], labels: ['D5'], type: 'broadleaf' }, { at: [26, 23.6], labels: ['D8'], type: 'broadleaf' },
      { at: [17, 17], labels: ['D12'], type: 'broadleaf', note: 'the colour infrared of 2025 shows two crowns of different red side by side' }, { at: [21.6, 18.8], labels: ['D11'], type: 'broadleaf' }, { at: [18.4, 6], labels: ['D13'], type: 'broadleaf' }],
    reject: { D3: 'a single 4 m return beside the path with no crown in either photo (a post or sign)', D7: 'a boulder (2.8 m)', D9: 'a boulder (2.8 m)' } },
  'C8-s5-planted': { default: 'ambiguous',
    keep: ['D9', 'D11'],
    crowns: [{ at: [37.2, 32], labels: ['D1'], type: 'broadleaf' }, { at: [8.3, 28.4], labels: ['D4', 'D6'], type: 'broadleaf' }, { at: [26, 26.3], labels: ['D7'], type: 'broadleaf' }, { at: [15.1, 25.6], labels: ['D8'], type: 'broadleaf' }, { at: [32.5, 23.2], labels: ['D10'], type: 'broadleaf' }],
    type: { D9: ['broadleaf', 'young planted tree: a thin leafless trunk shadow in April 2021, a full crown shadow in June 2025 (the April share reads the green grass under it)'], D11: ['broadleaf', 'young planted tree, as its neighbours'] },
    ambLabels: { D2: 'a 3.7 m top with no crown shadow in June 2025: gone or a part of its neighbour, not decidable', D5: 'a 4.2 m top with no clear crown shadow in June 2025, not decidable' } },
  'C9-s8-grove': { default: 'ambiguous',
    keep: ['D11', 'D13', 'D16', 'D28'],
    crowns: [{ at: [16.6, 19], labels: ['D14', 'D17', 'D18'], type: 'conifer' }, { at: [5, 10.8], labels: ['D19', 'D21'], type: 'conifer' }, { at: [9.6, 5.2], labels: ['D24', 'D25'], type: 'broadleaf' }, { at: [22.1, 6.6], labels: ['D22', 'D23', 'D26'], type: 'conifer' }] },
  'C11-churchyard': { default: 'ambiguous',
    crowns: [
      { at: [9, 37.6], labels: ['D10', 'D17'], type: 'broadleaf' }, { at: [2.5, 20.6], labels: ['D24', 'D25', 'D26', 'D27', 'D29'], type: 'broadleaf' },
      { at: [25, 37.4], labels: ['D11', 'D15', 'D21', 'D23'], type: 'broadleaf' }, { at: [41.2, 36.2], labels: ['D12', 'D18', 'D19'], type: 'broadleaf' },
      { at: [-1.5, 37], labels: ['D9', 'D16', 'D20'], type: 'broadleaf', note: 'centre outside the window' }],
    reject: { D32: `${ROOF}: the church`, D33: `${ROOF}: the church`, D34: `${ROOF}: the church`, D36: `${ROOF}: the church porch` },
    ambLabels: { D14: 'a 6.8 m bridge between two big crowns: a hedge tree or a branch, not decidable', D22: 'a shoulder between two big crowns, not decidable' } },
  'C14-c2-group': { default: 'ambiguous',
    keep: ['D8', 'D16', 'D20', 'D35'],
    crowns: [
      { at: [6.2, 32.8], labels: ['D9', 'D10', 'D11', 'D12', 'D13'], type: 'broadleaf' }, { at: [16.6, 25.4], labels: ['D14', 'D15'], type: 'broadleaf' }, { at: [22.8, 24.6], labels: ['D17'], type: 'broadleaf' },
      { at: [15.2, 17], labels: ['D18', 'D22', 'D24'], type: 'broadleaf' }, { at: [23, 12.5], labels: ['D23', 'D27'], type: 'broadleaf' }, { at: [29.5, 13.4], labels: ['D25'], type: 'broadleaf' }, { at: [33, 6], labels: ['D31', 'D32'], type: 'broadleaf' }],
    amb: [[[13, 7, 22.4, 12.3], MASS], [[27.5, 16, 32, 21], 'a 13 m shoulder of the crown beside it or a tree of its own, not decidable'], [[17, -1, 24, 5], MASS]] },
  'C15-park-garden': { default: 'ambiguous',
    crowns: [{ at: [19.5, 37.5], labels: ['D3', 'D7'], type: 'broadleaf' }, { at: [26, 33], labels: ['D6', 'D8', 'D11', 'D14'], type: 'broadleaf' }, { at: [17.5, -2], labels: ['D21', 'D22'], type: 'broadleaf', note: 'centre outside the window' }],
    reject: Object.fromEntries(['D10', 'D15', 'D16', 'D17', 'D18', 'D19', 'D20'].map(l => [l, ROOF])),
    amb: [[[7.5, 27, 17, 40], 'a crown of the 2020 laser the June 2025 photo does not show beside its neighbour: felled or hidden, not decidable'], [[17, 26.5, 23, 31], 'the low edge of the crown beside it, not decidable']] },
  'C17-se-row': { default: 'ambiguous',
    keep: ['D5'],
    crowns: [{ at: [18.8, 18.2], labels: ['D16', 'D17', 'D18', 'D19'], type: 'broadleaf' }, { at: [16.5, 31.5], labels: ['D9', 'D12', 'D13'], type: 'broadleaf' }, { at: [18.2, 39], labels: ['D6', 'D7', 'D8'], type: 'broadleaf' }, { at: [28, 0.9], labels: ['D22', 'D23', 'D24'], type: 'broadleaf' }, { at: [23.6, 7.5], labels: ['D21'], type: 'broadleaf' }],
    amb: [[[13, 23, 23, 28], 'two tops between two domes of the row: one of them or a tree of their own, not decidable']] },
  'C18-s3-group': { default: 'keep',
    crowns: [
      { at: [21.5, 35.3], labels: ['D10', 'D11'], type: 'conifer' }, { at: [12.8, 22.3], labels: ['D23', 'D24'], type: 'conifer' }, { at: [10.8, 11.3], labels: ['D36', 'D40'], type: 'conifer' }, { at: [21.5, 10.3], labels: ['D39', 'D41'], type: 'conifer' },
      { at: [26.3, 26.6], labels: ['D16', 'D19'], type: 'broadleaf' }, { at: [27.8, 3.3], labels: ['D48', 'D52'], type: 'conifer' }],
    amb: [[[15.5, 13.8, 31, 25.8], MASS], [[23.6, 6, 31.5, 13.8], MASS]],
    ambLabels: { D15: 'a 7.7 m top in a gap: understorey or a low branch, not decidable', D17: 'a 3.9 m shrub at the edge, not decidable' } },

  'H2-avenue': { default: 'ambiguous',
    crowns: [{ at: [15.6, 57.6], labels: ['D5'], type: 'broadleaf' }, { at: [10.3, 50.3], labels: ['D7', 'D9'], type: 'broadleaf' }, { at: [9.6, 40.2], labels: ['D14'], type: 'broadleaf' }, { at: [2.5, 33.4], labels: ['D20'], type: 'broadleaf' }],
    reject: { D28: 'a 2.8 m shrub' },
    amb: [[[42, 33, 60, 60], `${FELLED} (bare ground there in 2025), and the thicket round them`], [[52, 4, 60, 33], THICKET]] },
  'H4-c15-closed': { default: 'keep',
    crowns: [
      { at: [2, 18], labels: ['D33', 'D38'], type: 'conifer' }, { at: [12.8, 14.8], labels: ['D42', 'D48'], type: 'conifer' }, { at: [4, 3.8], labels: ['D72', 'D75'], type: 'conifer' }, { at: [7.5, 9.3], labels: ['D56', 'D61'], type: 'conifer' },
      { at: [19, 6.8], labels: ['D63', 'D68'], type: 'conifer' }, { at: [22.8, 3.8], labels: ['D73', 'D76'], type: 'conifer' }, { at: [26.8, 4.8], labels: ['D70', 'D74'], type: 'conifer' }] },
  'H6-s9-shore': { default: 'ambiguous',
    crowns: [{ at: [27.5, 45], labels: ['D3', 'D5', 'D6', 'D9'], type: 'broadleaf' }, { at: [47.5, 43], labels: ['D4', 'D7', 'D8', 'D10', 'D11', 'D12'], type: 'broadleaf' }, { at: [36, 3.4], labels: ['D21'], type: 'broadleaf' }, { at: [24.5, 0.4], labels: ['D23'], type: 'broadleaf' }],
    amb: [[[44, 3, 57, 25.5], FELLED], [[5, -1, 17.5, 13.5], 'two crowns of the 2020 laser that the June 2025 photo shows as lawn or hides in shadow: felled or hidden, not decidable']] },
  'H8-c7-east': { default: 'keep',
    crowns: [{ at: [14.5, 24.8], labels: ['D10', 'D12'], type: 'conifer' }, { at: [2.5, 20.3], labels: ['D14', 'D20'], type: 'unknown' }],
    amb: [[[0, 0, 17.3, 18], `${FELLED} (a clearing by the Castle 7 tee in 2025)`]],
    ambLabels: { D47: 'a leafless top among the conifers, not decidable' } },
  'H9-c7-east-edge': { default: 'ambiguous',
    keep: ['D13', 'D14', 'D33'],
    crowns: [{ at: [35.5, 27], labels: ['D23', 'D26', 'D27', 'D32'], type: 'broadleaf' }, { at: [2, 26.5], labels: ['D29'], type: 'broadleaf' }, { at: [5, 14], labels: ['D40'], type: 'broadleaf' }, { at: [15, 13.8], labels: ['D41'], type: 'broadleaf' }],
    amb: [[[20, 0, 33, 40], THICKET], [[33, 32, 40, 40], MASS], [[33, 0, 40, 21.8], MASS], [[0, 5, 13, 12], THICKET], [[8.5, 15, 13.5, 20], THICKET]] },
  'H10-s3-grove': { default: 'ambiguous',
    crowns: [{ at: [18, 26.8], labels: ['D12', 'D13'], type: 'broadleaf' }, { at: [25.4, 21.2], labels: ['D18', 'D24', 'D25'], type: 'broadleaf' }, { at: [17.6, 16.6], labels: ['D29'], type: 'broadleaf' }, { at: [13.2, 12], labels: ['D34'], type: 'broadleaf' }, { at: [16.8, 8.2], labels: ['D39'], type: 'broadleaf' }, { at: [22.6, 8.4], labels: ['D40'], type: 'broadleaf' }],
    amb: [[[0, 12.5, 12, 30], THICKET], [[0, 0, 30, 6], MASS], [[0, 6, 10, 12.5], MASS], [[22, 25, 30, 30], MASS], [[20.5, 11.5, 26, 15.5], THICKET], [[27, 0, 30, 18], MASS]] },
  'H11-c6-ridge': { default: 'ambiguous',
    keep: ['D12', 'D15', 'D18', 'D21', 'D39', 'D40'],
    crowns: [{ at: [15.6, 18.6], labels: ['D24', 'D26', 'D28'], type: 'conifer' }, { at: [1.5, 12], labels: ['D33'], type: 'conifer' }, { at: [18, 6], labels: ['D36', 'D38'], type: 'conifer' }],
    amb: [[[22.5, 4, 30, 26], THICKET]],
    type: { D12: ['conifer', 'a young pine'], D39: ['conifer', 'a pine'] },
    ambLabels: { D16: 'a 6 m top beside a young pine, not decidable', D34: 'a 3.6 m top under the pine beside it, not decidable', D13: 'a 2.6 m shrub' } },
  'H12-park2': { default: 'ambiguous',
    crowns: [
      { at: [24.5, 51.8], labels: ['D8', 'D9', 'D11', 'D14', 'D18'], type: 'broadleaf', note: 'leafless branches and a bare-branch shadow on green lawn in April 2021: the April share reads the lawn' },
      { at: [33, 45], labels: ['D12', 'D16', 'D17', 'D19', 'D21', 'D22'], type: 'broadleaf', note: 'as its neighbour' },
      { at: [6, 16], labels: ['D29', 'D30', 'D31', 'D32', 'D33', 'D34', 'D35', 'D36', 'D37', 'D38', 'D39'], type: 'broadleaf', note: 'one broad crown over lawn; a bare-branch shadow in April 2021' }],
    reject: { D20: 'a hedge corner (2.5 m)', D23: 'a 3.5 m post at the road (nothing in either photo)', D25: `${ROOF}: the pavilion`, D26: `${ROOF}: the pavilion`, D40: 'a hedge (2.9 m)', D41: 'a wall edge (2.1 m)' },
    amb: [[[44, 44, 55, 55], 'the edge of park trees whose crowns lie outside the window, not decidable']] },
  'H13-c8-grove': { default: 'ambiguous',
    keep: ['D37', 'D40', 'D49'],
    crowns: [{ at: [31, 30.6], labels: ['D13', 'D14'], type: 'broadleaf' }, { at: [20.6, 28.8], labels: ['D12', 'D16'], type: 'broadleaf' }, { at: [27.6, 21], labels: ['D23'], type: 'broadleaf' }, { at: [22.8, 17], labels: ['D28'], type: 'broadleaf' }, { at: [34.7, 12], labels: ['D36'], type: 'broadleaf' }, { at: [22.5, 2.4], labels: ['D46', 'D52'], type: 'broadleaf' }],
    amb: [[[23, 24, 40, 28.5], MASS], [[30, 14, 40, 25], MASS], [[25.5, 0, 34, 15], THICKET], [[34, 0, 40, 9], MASS], [[0, 5, 11, 20.5], THICKET], [[17, 32, 25, 37], MASS], [[20, 20.5, 25, 23.5], MASS]] },
  'H14-s13-shore': { default: 'ambiguous',
    crowns: [{ at: [14, 35], labels: ['D2', 'D4', 'D5', 'D8', 'D10', 'D11'], type: 'broadleaf' }, { at: [6.2, 24.4], labels: ['D12', 'D13'], type: 'broadleaf' }, { at: [9, 13.6], labels: ['D19'], type: 'broadleaf' }, { at: [13.7, 6.1], labels: ['D25'], type: 'broadleaf' }],
    amb: [[[-1, 28, 8, 40], THICKET], [[18.5, 34, 28, 40], THICKET], [[8, 15.5, 19, 20], THICKET], [[0, 7.5, 7, 15.5], THICKET], [[12.5, 9, 19, 15.5], THICKET]] },
  'H16-s1-garden': { default: 'ambiguous',
    keep: ['D4'],
    crowns: [{ at: [11.6, 39.3], labels: ['D1'], type: 'broadleaf' }, { at: [21.4, 34.2], labels: ['D2', 'D6'], type: 'broadleaf' }, { at: [33.6, 37.4], labels: ['D3'], type: 'broadleaf' }, { at: [29.4, 34], labels: ['D5', 'D7'], type: 'broadleaf' }, { at: [35, 31], labels: ['D8', 'D9'], type: 'broadleaf' }, { at: [32.8, 21.8], labels: ['D13', 'D14', 'D19'], type: 'broadleaf' }, { at: [3.2, 17.4], labels: ['D16', 'D18', 'D20', 'D21'], type: 'broadleaf' }],
    reject: Object.fromEntries(['D12', 'D15', 'D17', 'D22', 'D28'].map(l => [l, ROOF])),
    amb: [[[14, 2, 29, 16], `${FELLED}: a 13 m tree at the house corner, of which a small crown stands in 2025`], [[25, 23, 30.5, 28], 'a shoulder between two crowns, not decidable'], [[28, 9, 38, 15.5], THICKET]] },
  'H17-c12-mixed': { default: 'ambiguous',
    keep: ['D15', 'D16', 'D17', 'D18', 'D19', 'D26', 'D32', 'D37'],
    crowns: [{ at: [19.6, 33.6], labels: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'], type: 'broadleaf', note: 'one broad crown in the June 2025 photo' }, { at: [27.5, 10.6], labels: ['D21', 'D24', 'D27'], type: 'broadleaf' }, { at: [28, 3], labels: ['D35', 'D38'], type: 'broadleaf' }],
    amb: [[[19.5, 4, 24, 8], 'a 14 m shoulder of the crown beside it or a tree of its own, not decidable'], [[33, 5, 39, 15], THICKET], [[0, 7.5, 5.2, 14], THICKET], [[15.5, 5, 20, 9.5], THICKET], [[15, 19.5, 20.5, 23.5], THICKET]] },
  'H19-c8-ridge': { default: 'ambiguous',
    keep: ['D14', 'D16', 'D17', 'D18', 'D26', 'D28', 'D30', 'D31'],
    crowns: [{ at: [9.6, 38], labels: ['D10'], type: 'broadleaf' }, { at: [18.2, 37.6], labels: ['D9', 'D13'], type: 'broadleaf' }, { at: [36.8, 10.6], labels: ['D33'], type: 'broadleaf' }],
    amb: [[[25, 28, 28.6, 31], 'a 7.6 m top beside a pine, not decidable'], [[34.5, 26, 39, 30], THICKET]] },
  'H21-c12-scatter': { default: 'ambiguous',
    keep: ['D14', 'D18', 'D19', 'D22', 'D23', 'D25', 'D27', 'D28', 'D30', 'D31', 'D32', 'D35', 'D37', 'D39', 'D42', 'D45', 'D47', 'D50', 'D54', 'D55', 'D57', 'D58', 'D59', 'D60', 'D61', 'D63', 'D68', 'D70', 'D71'],
    crowns: [{ at: [19.3, 38.3], labels: ['D21', 'D24'], type: 'conifer' }, { at: [43, 35.8], labels: ['D26', 'D29'], type: 'conifer' }],
    type: { D18: ['unknown', 'not decidable in the April photo'], D25: ['unknown', 'not decidable in the April photo'] },
    amb: [[[0, 0, 19.5, 29], THICKET], [[0, 29, 6, 34], THICKET], [[3, 43, 13, 45], THICKET], [[10, 38, 13.8, 42], THICKET], [[27, 28.6, 31, 32], 'an 8.7 m shoulder, not decidable']] },
};

const base = JSON.parse(fs.readFileSync(path.join(DIR, 'reference-windows.json'), 'utf8'));
const declared = [...base.windows, ...base.dropped.filter(d => d.bbox).map(({ reason, ...w }) => w)];
const windows = { ...base, windows: declared.filter(w => !DROPPED[w.id]), dropped: declared.filter(w => DROPPED[w.id]).map(w => ({ ...w, reason: DROPPED[w.id] })) };
for (const s of ['', '-r2']) fs.writeFileSync(path.join(DIR, `reference-windows${s}.json`), JSON.stringify(windows, null, 1) + '\n');

const inBox = (x, y, boxes) => boxes.some(([b]) => x >= b[0] && x < b[2] && y >= b[1] && y < b[3]);
const out = {
  schemaVersion: 1,
  reviewId: 'review-2026-11-24',
  interpreter: 'agent-led interpretation (Claude, 2026-11-24) of the 0.5 m pit-free CHM (laser of 2020-11-06 west of E 650000 and 2021-03-23 east of it) and the 2025-06-14 and 2021-04-16 RGBI photos at their native 0.16 m (natural colour and colour infrared), each photo moved onto the canopy where its relief displacement could be measured; not a survey, not the club, not human approval.',
  protocol: [
    'Every window was drafted by the written grouping rule of Johannesberg\'s round 3 (tools/tree-pipeline/photo/reference-draft.mjs: a numbered apex of an over-segmenting filter within 2 m of a taller kept one, or less than 0.6 m above the dip toward a taller kept one within 3 m, is part of that crown; 3.5 m for a crown leafless in April), then each window was looked at on four panels (CHM, June 2025 natural colour and colour infrared, April 2021 natural colour) before any detector under test ran.',
    'Conifers: drafted tops closer than about 2.4 m on one laser lobe are joined into one crown (a 15-20 m pine or spruce has a crown 3-5 m wide); the rest are kept as drafted. Touching conifers in closed stands (C5, C18, H4, H8) match separate laser lobes and cannot be confirmed one by one in the photos, as on the earlier grounds.',
    'Broadleaves: the draft rule splits a broad park crown into many tops, so crowns are placed by hand at the centre of each dome that the laser lobes and the June 2025 photo agree on; joined masses, shoulders and thickets where they do not are ambiguity boxes, scored for no one.',
    'Roofs, hedges, stumps, boulders and posts the pit-free CHM keeps as canopy are rejected.',
    'Trees of the laser that the June 2025 photo no longer shows (felled between 2020/21 and 2025) are ambiguity boxes: the sample measures finding trees that stand; felling is decided in the candidate review.',
    'Type: from the April 2021 photo (leafless branches or evergreen needles) and the June 2025 colour infrared; a leafless crown over a green lawn reads as vegetated there, so park and planted trees are typed from their bare-branch shadows, not from the share.',
    'Stratum: the census rule (share of CHM of at least 3 m in a 16 m square round the top) of the tallest drafted top of each crown; a single broad crown can therefore read as edge or closed.',
    'Windows whose crowns no source separates were dropped before any detector ran, with the reason (reference-windows.json, dropped): they are mostly closed leafless broadleaf stands, which this sample therefore does not measure.',
  ],
  windows: [],
};
let totals = { calibration: 0, evaluation: 0 };
for (const window of windows.windows) {
  const spec = SPEC[window.id];
  if (!spec) throw new Error(`no interpretation for ${window.id}`);
  const draft = JSON.parse(fs.readFileSync(path.join(P, `${window.id}.draft.json`), 'utf8'));
  const by = new Map(draft.crowns.map(c => [c.label, c]));
  const named = new Set();
  const get = label => { const c = by.get(label); if (!c) throw new Error(`${window.id}: no draft crown ${label}`); if (named.has(label)) throw new Error(`${window.id}: ${label} named twice`); named.add(label); return c; };
  const crowns = [], rejected = {}, ambiguous = [];
  for (const [box, reason] of spec.amb || []) ambiguous.push({ box, reason });
  for (const [label, reason] of Object.entries(spec.reject || {})) for (const n of get(label).from) rejected[String(n)] = `${reason} (draft ${label})`;
  for (const [label, reason] of Object.entries(spec.ambLabels || {})) { const [x, y] = get(label).at; ambiguous.push({ box: [x - 1.5, y - 1.5, x + 1.5, y + 1.5], reason: `${reason} (draft ${label})` }); }
  for (const c of spec.crowns || []) {
    const drafts = c.labels.map(get), top = drafts.reduce((a, b) => (b.height > a.height ? b : a));
    crowns.push({ from: [...new Set(drafts.flatMap(d => d.from))].sort((a, b) => a - b), at: c.at, type: c.type, stratum: top.stratum, note: `drafts ${c.labels.join(', ')} as one crown${c.note ? `; ${c.note}` : ''}` });
  }
  for (const label of spec.keep || []) { const c = get(label); crowns.push({ from: c.from, type: spec.type?.[label]?.[0] ?? c.type, stratum: c.stratum, note: `draft ${label} (April 2021 share ${c.aprilShare})${spec.type?.[label] ? `; ${spec.type[label][1]}` : ''}` }); }
  for (const c of draft.crowns) {
    if (named.has(c.label)) continue;
    const note = `draft ${c.label} (April 2021 share ${c.aprilShare})`;
    if (!c.inside) { crowns.push({ from: c.from, type: c.type, stratum: c.stratum, note: `${note}, margin` }); continue; }
    if (inBox(c.at[0], c.at[1], spec.amb || [])) continue;
    if (spec.default === 'keep') crowns.push({ from: c.from, type: spec.type?.[c.label]?.[0] ?? c.type, stratum: c.stratum, note });
    else ambiguous.push({ box: [c.at[0] - 1.5, c.at[1] - 1.5, c.at[0] + 1.5, c.at[1] + 1.5], reason: `a drafted top (${c.height} m) neither photo decides (draft ${c.label})` });
  }
  out.windows.push({ window: window.id, crowns, rejected, ambiguous });
  const inside = crowns.filter(c => !/margin$|outside the window/.test(c.note)).length;
  totals[window.role] += inside;
  console.log(window.id.padEnd(18), window.role.padEnd(11), String(inside).padStart(3), 'inside crowns', String(ambiguous.length).padStart(3), 'ambiguity boxes', Object.keys(rejected).length, 'rejected');
}
console.log(JSON.stringify(totals));
for (const s of ['', '-r2']) fs.writeFileSync(path.join(DIR, `reference-annotations${s}.json`), JSON.stringify(out, null, 1) + '\n');
