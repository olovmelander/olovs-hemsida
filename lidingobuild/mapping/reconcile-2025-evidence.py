"""Apply the adversarial verification's corrections to the 2025 evidence files.

Six layers were measured on the 2025 capture and each was then checked by an
agent whose default was that the measurement is wrong. All six came back
`sound-with-corrections` with no stray edits, every headline number reproduced
independently from the raw rasters - and each check found statements in the
delivered file that its OWN COMPUTED FIELDS contradict. That is the failure this
repository has been bitten by more than once: a file that disagrees with itself,
whose prose is what a later reader quotes.

This pass corrects those statements FROM THE FILES' OWN COMPUTED FIELDS wherever
one exists, records the correction beside it, and attaches to every file a
`verification` block naming what was checked, what was reproduced, and what was
found. Nothing measured is recomputed here and no threshold is changed; if a
number could not be derived from the file it is marked as coming from the
verification pass rather than silently inserted.

  python3 lidingobuild/mapping/reconcile-2025-evidence.py [--check]

--check exits non-zero if any file still carries an uncorrected statement, so a
re-run of a tracer that reintroduces one is caught.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAP = ROOT / 'lidingobuild/mapping'
CHECK = '--check' in sys.argv
changes = []


def load(name):
    return json.loads((MAP / name).read_text(encoding='utf8'))


def save(name, doc):
    if CHECK:
        return
    (MAP / name).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf8')


def note(name, what):
    changes.append(f'{name}: {what}')


# The height model's own capture date is NOT recorded. Every tracer quoted
# lm2025.DTM_CAPTURE, which asserted 2021-03-23 - the capture date of the
# co-located Laserdata Skog POINT CLOUD, a different product. The manifest holds
# capturedAt null for terrain-lm-1m over an item published 2021-03-23..2025-05-31.
DTM_PROVENANCE = {
    'captureDate': None,
    'captureDateNote': ('not recorded: source-manifest terrain-lm-1m carries capturedAt null and the item is '
                        'published over 2021-03-23..2025-05-31. 2021-03-23 is the capture date of the '
                        'Laserdata Skog point cloud (laser-lm-skog, campaign 21c031), a DIFFERENT product, '
                        'and an earlier draft of lm2025.py asserted it for the height model; it propagated '
                        'into six evidence files before an adversarial check caught it.'),
    'blindSpotIsMeasuredNotDated': ('the shape record still predates work the photograph shows: hole 13 carries '
                                    'sand over ground the height model reads as flat, and the club reports '
                                    'building a bunker there. That is a measurement, not an inference from a '
                                    'date the source does not state.'),
}


def fix_shape_record(name, doc):
    sr = doc.get('shapeRecord')
    if isinstance(sr, dict) and sr.get('captureDate') == '2021-03-23':
        sr.update(DTM_PROVENANCE)
        note(name, 'shapeRecord.captureDate 2021-03-23 -> null; that date belongs to the point cloud')
    return doc


def verification(layer, verdict, reproduced, corrected, standing):
    return {
        'checkedBy': 'an adversarial verification agent whose default was that the measurement is wrong',
        'checkedOn': '2026-09-08',
        'layer': layer,
        'verdict': verdict,
        'reproducedIndependently': reproduced,
        'correctedInThisFile': corrected,
        'standingLimitations': standing,
        'note': ('the check re-derived headline numbers from the raw rasters with its own code and confirmed '
                 'that no tracked file outside this layer was modified. Corrections below are to STATEMENTS, '
                 'not to measurements: no threshold, rule or measured value changed.'),
    }


# ---------------------------------------------------------------- shoreline --
name = 'coast-2025.json'
doc = fix_shape_record(name, load(name))
arg = doc['adoptionArgument']
islands = len(doc['islands']['context2m']) + len(doc['islands']['fine1m'])
assert islands == doc['islands']['countFine'] + doc['islands']['countContext']
if '20 measured islands' in arg['whatIsNew']:
    arg['whatIsNew'] = arg['whatIsNew'].replace('20 measured islands', f'{islands} measured islands')
    note(name, f'adoptionArgument.whatIsNew: "20 measured islands" -> {islands}, the file\'s own count')
if '124 scorable vertices' in arg['recordTwo']:
    arg['recordTwo'] = arg['recordTwo'].replace('124 scorable vertices', '87 scorable vertices')
    note(name, 'adoptionArgument.recordTwo: "124 scorable vertices" -> 87, which is what the score reports')
arg['whatRestsOnOneRecord'] = {
    'statement': ('about 90% of the emitted shoreline is the 2 m context ring, and the 10 island rings exist on '
                  'the laser alone. The fine pair is scored against OSM; these were not, and the file did not '
                  'say so.'),
    'contextRingScoredInTheVerification': {
        'againstOsmCoastlineWay': 15733694,
        'scorableVertices': 224, 'ofWhichNeverComparedBefore': 137,
        'medianMetres': 5.27, 'p90Metres': 9.94, 'worstMetres': 13.08, 'within25MetresFraction': 1.0,
        'source': 'measured by the verification pass, not by trace-coast.py; re-run it to reproduce',
    },
    'islandRings': 'single record (the laser plate). No independent check exists on disk; naming is separately refused.',
}
doc['verification'] = verification(
    'shoreline and sea', 'sound-with-corrections',
    ('the flat/level census (354,554 flat cells = 35.46 ha, 55 components over 500 m2, 11 accepted at the '
     'borrowed 0.70 cut and 44 refused, gap 0.0618, this ground\'s own gap 0.1171) reproduced exactly with '
     'independently written code, as did both plate areas, both levels and the OSM score'),
    ['the doubled island count', 'the scorable-vertex count', 'the DTM capture date',
     'the single-record status of the context ring and the islands'],
    ['the shape is the height model and the photograph cannot see this feature at all - 0 of 98,571 sea-plate '
     'samples fall inside the capture, which is 159 m clear of it. A dated blind spot with no second record.',
     'OSM\'s coastline is tagged source=landsat (30 m); read the few-metre agreement as POSITION, never as '
     'shape, and note that a later contributor aligning it to a Lantmateriet product cannot be excluded from '
     'its history, which would make part of the agreement circular.',
     'seaDistanceToPlay counts hole lines and tee pads only; including greens and fairways moves the median '
     '977.4 -> 1068.2 m and leaves the nearest distance unchanged at 604.3 m.'])
save(name, doc)

# ----------------------------------------------------------------- fairways --
name = 'fairway-trace-2025.json'
doc = fix_shape_record(name, load(name))
gaps = doc['calibration']['tier1_mown']['marginalGaps']
p25 = gaps['excessGreen_positiveP25_minus_negativeP75']
tex = gaps['texture_negativeP25_minus_positiveP75']
if '20-30 units' in gaps['readingOfThose']:
    gaps['readingOfThose'] = (
        f'the BULK separates by {p25} units of excess green and {tex} of texture at the quartiles '
        f'(median to median it is 25.5 and 5.74); the TAILS overlap, which is why the cut is joint and not '
        f'a threshold on either index. An earlier wording said "20-30" and "6-9", which contradicted the two '
        f'fields printed immediately above it.')
    note(name, f'marginalGaps.readingOfThose: quartile gaps restated as {p25} and {tex} from its own fields')
scored = {p['hole'] for p in doc['score']['tier2_fairwayGrade']['perRing']}
tagged = sum('independentSecondRecord' not in piece for piece in doc['acceptedGeometry'])
for piece in doc['acceptedGeometry']:
    piece['independentSecondRecord'] = piece['hole'] in scored
    piece['secondRecordNote'] = ('an unchanged OSM fairway ring covers this hole and was held out of the rule'
                                 if piece['hole'] in scored else
                                 'ONE record plus a rule: the only other reading of this hole is the 2019 hand '
                                 'trace that set the tier-2 cut, so this piece is a candidate and not a '
                                 'corroborated surface')
if tagged:
    note(name, f'acceptedGeometry: {tagged} pieces tagged independentSecondRecord ({len(scored)} holes '
               f'corroborated, {len({p["hole"] for p in doc["acceptedGeometry"]}) - len(scored)} on one record)')
doc['score']['emittedRingsNotTheMask'] = {
    'medianIou': 0.665,
    'statement': ('0.674 is the MASK against the held-out rings; the rings that actually ship score 0.665. '
                  'Publish the number for the artefact, not for the intermediate.'),
    'source': 'measured by the verification pass',
}
doc['score']['selectionEffect'] = {
    'statement': ('the five scoring holes are the fairway-grade-cleanest of the twelve in this photograph '
                  '(median fairway-grade 0.732 against 0.554, mown 0.963 against 0.881), so 0.665 is agreement '
                  'on the easier half.'),
    'source': 'measured by the verification pass',
}
doc['verification'] = verification(
    'fairways, semi and rough', 'sound-with-corrections',
    ('both marginal gaps (11.64 and 1.81), the ring areas about the first vertex to 0.050 m2 on all fourteen '
     'rings, and the emitted-ring IoU of 0.665 were reproduced independently'),
    ['the quartile-gap overstatement (2.1x and 3.3x)', 'mask IoU published where the ring IoU belongs',
     'no per-piece flag for whether a second record covers the hole'],
    ['seven of the twelve adopted holes rest on ONE record plus a rule',
     'the held-out rings are excluded from the negative set and the collar (15.1% of negatives, 65,890 m2) '
     'and the cut is unchanged either way - so "they set no threshold" is nearly but not exactly true',
     'tier 1 (mown) is correctly refused as a fairway class at a median 2.13x area, and kept as candidate '
     'mown turf'])
save(name, doc)

# ------------------------------------------------------------------ bunkers --
name = 'bunker-trace-2025.json'
doc = fix_shape_record(name, load(name))
repro = doc.get('reproducedAgainstPublishedInputs')
if isinstance(repro, dict) and 'provenance' not in repro:
    repro['provenance'] = ('these six figures were TYPED from a separate ad-hoc run of detect-bunkers.py, not '
                           'computed by this script. The verification pass reproduced all six, but a typed '
                           'number in an evidence file is the failure mode this build has written down three '
                           'times - recompute them or keep this declaration.')
    note(name, 'reproducedAgainstPublishedInputs: declared as typed from a separate run, not computed here')
blob = json.dumps(doc, ensure_ascii=False)
old = 'past the 1.74x every confirmed bunker stays inside'
if old in blob:
    doc = json.loads(blob.replace(old, 'past the 1.74x p90 that confirmed bunkers reach (max 3.72x)'))
    note(name, 'refusal string: "1.74x every confirmed bunker stays inside" -> "1.74x p90 (max 3.72x)"; '
               'four confirmed bunkers grow to 1.77-3.72x')
doc['calibrationLoop'] = {
    'statement': ('the sand sample used to calibrate includes five mapped rings this same pass finds hold no '
                  'sand. Closing that loop moves the cut 119.11 -> 128.77 and the gap 53.5 -> 72.8, and the '
                  'accepted count 71 -> 64 - while confirmed and recovered both stay at 34. So the 34 are '
                  'stable and the away-from-mapped census is not.'),
    'source': 'measured by the verification pass',
}
doc['verification'] = verification(
    'bunkers and sand', 'sound-with-corrections',
    ('the confirmation gap (7.93 m), the 34 confirmations, the sub-metre registration and the strongest '
     'candidate were all reproduced; nothing is adopted, so nothing here reaches the model'),
    ['the typed reproduction block is now declared as typed', 'the 1.74x refusal string'],
    ['the 37 accepts away from any mapped bunker are NOT a stable census - see calibrationLoop',
     'the strongest candidate reads sand 2018, turf 2019, sand 2025, and this file measures the 2018 frame\'s '
     'own sand/turf gap as NEGATIVE (-31.0), so 2018 cannot decide it. If it is ever adopted it is on this '
     'course\'s standing two-record rule (2025 colour + a dish), never on 2018 corroboration.',
     'the four blind-spot components and the 54 dry rows are one-record candidates and must not be adopted '
     'on colour alone'])
save(name, doc)

# ---------------------------------------------------------------- tee decks --
name = 'tee-deck-2025.json'
doc = fix_shape_record(name, load(name))
ONE_RECORD = 'platform-with-one-record-only; not a tee claim'
for deck in doc['decks']:
    if deck['id'].endswith('-042') and deck['adoption'] != ONE_RECORD:
        assert deck['edgeStepMetres'] < 0, deck['edgeStepMetres']
        deck['adoption'] = ONE_RECORD
        deck['downgradedBy'] = (
            'the verification pass. It is the only adopted deck with a NEGATIVE edge step (-0.128, a hollow); '
            'deck 041 sits tens of metres away on the same hole and is REFUSED as a hollow at -0.153; its '
            '|step| is below the confusers\' own p90 of 0.139; and its card corroboration is flagged '
            'non-discriminating (alongHoleLineExtentMetres 0.0). The file\'s own reason for refusing the '
            'hollows - "reads as drainage" - applies to it verbatim and was not applied. It buys no coverage.')
        note(name, 'deck 042 downgraded to one-record: a hollow at -0.128 m adopted while 041 was refused at -0.153')
summary = {}
for deck in doc['decks']:
    summary[deck['adoption']] = summary.get(deck['adoption'], 0) + 1
doc['adoptionSummary'] = summary
doc['calibration'].setdefault('gaps', {})
doc['calibration']['gaps']['edgeStepMatchedPopulations'] = {
    'teeComponentsP25': 0.134, 'confuserComponentsP90': 0.139, 'gapMetres': -0.005,
    'statement': ('the headline +0.098 m gap put 18 hand-traced RINGS against 56 detected COMPONENTS - not '
                  'comparable objects. Measured like with like at the rule\'s own 25 m2 floor the '
                  'distributions TOUCH. The edge step is an ENRICHMENT (9 of 80 confuser components pass, '
                  '11 of 19 held-out tees recovered), not a separation. Everything downstream survives this: '
                  'the decks and the coverage gain do not depend on the claim.'),
    'source': 'measured by the verification pass',
}
doc['calibration']['calibrationRecovery'] = {
    'calibrationSet': '13 of 18 (72.2%)', 'heldOut': '11 of 19 (57.9%)',
    'heldOutMedianIou': 0.567, 'calibrationMedianIou': 0.346,
    'statement': ('an earlier wording said 10 of 18 "the same rate, so there is no overfit", which its own '
                  'file contradicts at 13. Recall IS higher on the calibration set - but median IoU is '
                  'markedly BETTER on the held-out set, which is not the signature of overfitting.'),
}
doc['verification'] = verification(
    'tee decks', 'sound-with-corrections',
    'the negative flatness and slope gaps, the deck inventory and the coverage table were reproduced',
    ['the headline gap restated across matched populations (-0.005 m, the distributions touch)',
     'the calibration recovery corrected to 13 of 18', 'deck 042 downgraded to one record'],
    ['57.9% held-out recall means blindness to flush-built decks',
     'the card cannot confirm that a platform is in the right PLACE, only at the right distance',
     'the 13 unserved Orange marks are correctly refused rather than invented: the height model cannot see a '
     'deck built after it'])
save(name, doc)

# --------------------------------------------------------------- tree cover --
name = 'tree-cover-2025.json'
doc = load(name)
blob = json.dumps(doc, ensure_ascii=False)
outside = None
for key in ('woodRingsWhollyOutside',):
    idx = blob.find(f'"{key}"')
    if idx >= 0:
        outside = json.loads(blob[blob.index('[', idx):blob.index(']', idx) + 1])
if outside is not None:
    n = len(outside)
    words = {5: 'Five', 6: 'Six', 7: 'Seven'}
    right = words.get(n, str(n))
    before = blob
    for wrong in ('Six', 'six'):
        if wrong == right or wrong.lower() == right.lower():
            continue
        blob = blob.replace(f'{wrong} of the eighteen wood rings lie wholly outside',
                            f'{right if wrong[0].isupper() else right.lower()} of the eighteen wood rings '
                            f'lie wholly outside')
    if blob != before:
        doc = json.loads(blob)
        note(name, f'"six wood rings wholly outside" -> {n}, derived from the file\'s own '
                   f'woodRingsWhollyOutside {outside}')
doc['adoptionIsNotPassive'] = {
    'statement': ('packages/course-pack/emit-pack.mjs reads `<build>/tree-cover.json` directly, so '
                  'lidingobuild/tree-cover.json goes LIVE the moment emit-pack runs on this build. There is no '
                  'wiring step and no candidate stage. Calling it "a candidate for the orchestrator to wire in" '
                  'understated it.'),
    'decisionTaken': ('adopted whole, with the one-record limitation stated: 41.7% of the raster (75,734 cells) '
                      'has no second record under it, because the review crops are hole boxes plus 90 m. The '
                      'checked part beats the model\'s own wood rings by 2.2-2.5x under every variation the '
                      'verification could apply, and the alternative - no raster at all, which is what this '
                      'ground has today - is worse everywhere.'),
}
doc['verification'] = verification(
    'tree cover and forest', 'sound-with-corrections',
    ('the classifier\'s IoU 0.774 / recall 0.947 against the laser canopy, and the wood rings\' own 0.321 / '
     '0.346, were reproduced under every variation tried'),
    ['the wood-ring count that contradicted the file\'s own computed lists',
     'the one-record status of 41.7% of the raster, now stated as a taken decision rather than a caveat'],
    ['the raster is one record over 41.7% of its area',
     'the shape record is the height model and the colour record is 2025; a stand felled or grown between them '
     'is seen by only one of the two'])
save(name, doc)

# ---------------------------------------------------------------- buildings --
name = 'building-check-2025.json'
doc = fix_shape_record(name, load(name))
doc['leanVerdictCorrected'] = {
    'was': 'CONFIRMED, mean cosine against a global permutation baseline, t = 4.81 on 88 buildings',
    'is': ('confirmed AT THE FRAME LEVEL on four frames (4 of 4 outward, means +0.35/+0.81/+0.40/+0.67 m, '
           't = 5.15 on df 3). The within-frame gradient is NOT significant (t 1.68), and against a '
           'WITHIN-BLOCK permutation baseline (mean 0.283, p95 0.324) the mean cosine gives p = 0.401 - so the '
           'cosine alone cannot separate relief lean from a per-frame constant offset. "t = 4.81 on 88 '
           'buildings" was pseudoreplication over 4 frames.'),
    'tangentialNull': ('withdrawn as stated: it is null only POOLED. Within blocks it runs +1.00 (t 2.33), '
                       '-0.60 and +0.76 (t 3.37).'),
    'consequence': 'none for the model - nothing was applied, and nothing is applied now.',
    'source': 'measured by the verification pass',
}
doc['roofColourStatementCorrected'] = {
    'measuredRoofPosition': 0.302, 'pageColourPosition': 0.031,
    'statement': ('both roof and page colour were described as "the same distance above deep shadow", which '
                  'reads as the opposite of what the numbers say: the measured roof sits 0.302 of the way from '
                  'deep shadow to paint-white and the page\'s 0x2a2c2b sits at 0.031. The page is an order of '
                  'magnitude darker than the roof this capture measures.'),
    'whatMayBeSaid': ('a roof colour and a ridge direction, both readable from directly above and verifiable. '
                      'NOT a facade: wall colour, materials, storeys and glazing are refused, because guessing '
                      'them invents an appearance for a real business.'),
}
doc['verification'] = verification(
    'buildings and objects', 'sound-with-corrections',
    ('the roof colour and roof form were reproduced digit for digit from the raw pixels; the contrast '
     'calibration and its negative gap were reproduced on a different grid; the sun bearing the pixels prefer '
     '(311.58 deg) matches the astronomy from a hand-read flight timestamp, which is a genuine two-record '
     'agreement'),
    ['the lean verdict, restated at the frame level with the within-block baseline',
     'the tangential-null argument, withdrawn as stated', 'the roof-colour sentence'],
    ['nothing is adopted and nothing is applied: this is evidence',
     'the "two independent records" for presence is two statistics on ONE image; the records that actually '
     'refuted demolition are the 2019 capture and the 2021 laser returns',
     'the relief lean here is ~0.6 m at a median 296 m radius - an order of magnitude below Johannesberg\'s '
     '3-11 m - because this "capture" is 15 timestamped frames in three flight lines, so the lean is radial '
     'about EACH BLOCK\'s nadir and never about one point'])
save(name, doc)

for line in changes:
    print(' -', line)
print(f'{len(changes)} corrections {"would be" if CHECK else ""} applied across six evidence files')
if CHECK and changes:
    sys.exit(1)
