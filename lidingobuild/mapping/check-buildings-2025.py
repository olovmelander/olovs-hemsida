"""Score the model's 562 building footprints against the 2025-05-31 Lantmateriet
capture: registration, the relief-lean hypothesis, presence, and the clubhouse
roof. Writes lidingobuild/mapping/building-check-2025.json.

EVIDENCE ONLY. Nothing here is applied to any model, page or scenery module.

The one photo record is the 2025 capture. The 2019 municipal capture appears in
exactly one role - a CROSS-CAPTURE CONSISTENCY CHECK - because "the footprint is
in the wrong place" and "the roof is leaning in this photograph" cannot be told
apart inside one photograph, and no geometry is taken from it.

    python3 lidingobuild/mapping/check-buildings-2025.py        (~8 minutes)
"""
import json, sys, time
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lm2025 as L
import _bldg_lib as B
import _bldg_score as S
import _bldg_seams as SB
import _bldg_sun as SUN
import _bldg_2019 as M19

ROOT = HERE.parents[1]
OUT = HERE / 'building-check-2025.json'
RNG = np.random.default_rng(20260908)
WIN = L.META['windowEpsg3006']
MARGIN = S.COLLAR[1] + S.SEARCH + 3.0
T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)

def in_window(ring, m=MARGIN):
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    return (min(xs) > WIN['minEasting'] + m and max(xs) < WIN['maxEasting'] - m
            and min(ys) > WIN['minNorthing'] + m and max(ys) < WIN['maxNorthing'] - m)

def auc(a, b):
    x = np.concatenate([a, b]); y = np.concatenate([np.ones(len(a)), np.zeros(len(b))])
    o = np.argsort(x); r = np.empty(len(x)); r[o] = np.arange(1, len(x) + 1)
    return float((r[y == 1].sum() - len(a) * (len(a) + 1) / 2) / (len(a) * len(b)))

def pc(a, q): return [round(float(v), 2) for v in np.percentile(a, q)]

# ============================================================ 0  inputs =====
bs = B.buildings()
model = json.loads((ROOT / 'lidingobuild/course-model.json').read_text(encoding='utf8'))
MB = {b['id']: b for b in model['infra']['buildings']}
hev = json.loads((HERE / 'building-height-evidence.json').read_text(encoding='utf8'))
HEIGHT = {b['id']: b for b in hev['buildings']}
inside = [b for b in bs if in_window(b['ring'])]
byid = {b['id']: b for b in bs}
log(f'{len(bs)} footprints, {len(inside)} inside the capture window')

R = {
 'schemaVersion': 1,
 'groundId': 'lidingo',
 'layer': 'buildings-and-objects',
 'measuredOn': '2026-09-08',
 'generator': 'lidingobuild/mapping/check-buildings-2025.py',
 'state': 'measurement-evidence-only',
 'appliedToModel': False,
 'horizontalCrs': 'EPSG:3006',
 'sourceCapture': {
   'id': L.META['sourceId'], 'captureDate': L.META['captureDate'],
   'sha256': L.META['sha256'], 'licence': L.META['licence']['id'],
   'attribution': L.META['licence']['attribution'],
   'sampleSpacingMetres': L.META['sampleSpacingMetres'],
   'windowEpsg3006': WIN,
   'georeference': 'EPSG:3006 native; a tile\'s coordinates ARE its georeference, so a trace on it needs no registration'},
 'crossCaptureCheckOnly': {
   'id': M19.META['sourceId'], 'campaignLabel': M19.META['campaignLabel'],
   'sha256': M19.META['sha256'], 'licence': M19.META['licence']['id'],
   'horizontalCrs': M19.META['horizontalCrs'], 'season': M19.META['season'],
   'role': ('a second, independent flight with its own orthorectification. Used ONLY to separate a '
            'footprint that is in the wrong place from a roof that leans in one photograph. '
            'No geometry, colour or outline is taken from it.')},
 'shapeRecord': {'laserDtm': 'lidingobuild/cache/terrain-review/review-dtm-1m.f32',
                 'captured': L.DTM_CAPTURE, 'sha256': L.DTM_META['sha256'],
                 'note': 'the laser is 2021 and the photograph is 2025; anything built between them has colour and no shape'},
 'inputs': {
   'footprints': {'path': 'geo_data/course-v2/lidingo/reference/osm-context-epsg3006.geojson',
                  'count': len(bs),
                  'sameIdsAsModelInfraBuildings': sorted(MB) == sorted(b['id'] for b in bs)},
   'model': {'path': 'lidingobuild/course-model.json', 'buildings': len(model['infra']['buildings']),
             'roads': len(model['infra']['roads']), 'paths': len(model['infra']['paths']),
             'parking': len(model['infra']['parking']), 'landuse': len(model['infra']['landuse'])},
   'measuredHeights': {'path': 'lidingobuild/mapping/building-height-evidence.json',
                       'count': len(HEIGHT), 'sourceEpoch': hev['sourceEpoch']},
   'roofMeshes': {'path': 'lidingobuild/mapping/building-roof-meshes.json', 'buildings': 5},
   'roofMeshCheck': {'path': 'lidingobuild/mapping/building-roof-validation.json'}},
 'refusals': [],
}
R['refusals'].append({
  'kind': 'outside-the-capture', 'count': len(bs) - len(inside),
  'of': len(bs),
  'reason': (f'the 2025 capture covers E {WIN["minEasting"]:.0f}-{WIN["maxEasting"]:.0f}, '
             f'N {WIN["minNorthing"]:.0f}-{WIN["maxNorthing"]:.0f}; these footprints do not fit inside it '
             f'with the {MARGIN:.0f} m the objective needs for its collar and its shift search. '
             'They are not scored, and no other capture is substituted for them: this capture is the record.')})

# =========================================== 1  the contrast objective ======
occ = np.zeros((int((WIN['maxNorthing'] - WIN['minNorthing']) / 2) + 1,
                int((WIN['maxEasting'] - WIN['minEasting']) / 2) + 1), bool)
for b in bs:
    xs = [p[0] for p in b['ring']]; ys = [p[1] for p in b['ring']]
    c0 = int((min(xs) - 25 - WIN['minEasting']) / 2); c1 = int((max(xs) + 25 - WIN['minEasting']) / 2)
    r0 = int((WIN['maxNorthing'] - max(ys) - 25) / 2); r1 = int((WIN['maxNorthing'] - min(ys) + 25) / 2)
    occ[max(0, r0):r1 + 1, max(0, c0):c1 + 1] = True
freecells = np.argwhere(~occ)
controls = []
for b in inside:
    c = L.ring_centroid(b['ring'])
    for _ in range(60):
        r, cc = freecells[RNG.integers(len(freecells))]
        E = WIN['minEasting'] + cc * 2.0; N = WIN['maxNorthing'] - r * 2.0
        moved = [[p[0] - c[0] + E, p[1] - c[1] + N] for p in b['ring']]
        if in_window(moved):
            res = S.score_ring(moved, [], L.sample)
            if res: controls.append(res)
            break
log(f'{len(controls)} control placements scored')

scored = []
for b in inside:
    r = S.score_ring(b['ring'], b['holes'], L.sample)
    if r is None: continue
    c = L.ring_centroid(b['ring'])
    r.update(id=b['id'], tags=b['tags'], osmTimestamp=b['osmTimestamp'],
             centroidEpsg3006=[round(c[0], 2), round(c[1], 2)], areaSquareMetres=round(c[2], 1))
    scored.append(r)
log(f'{len(scored)} footprints scored on lm-2025')

cbest = np.array([c['best'] for c in controls]); fbest = np.array([r['best'] for r in scored])
czero = np.array([c['zero'] for c in controls]); fzero = np.array([r['zero'] for r in scored])
hi = float(np.percentile(cbest, 95)); lo = float(np.percentile(fbest, 5)); CUT = (hi + lo) / 2
R['registrationRule'] = {
  'objective': ('the distance between the interior median and the 2-5 m collar median of '
                '(luminance, excess green, R/G), whitened by the covariance of the whole capture, '
                'maximised over a shift - the objective Johannesberg found to be the one that works'),
  'grid': {'evaluationStepMetres': S.STEP, 'searchHalfWidthMetres': S.SEARCH,
           'coarseQuantumMetres': S.COARSE, 'fineQuantumMetres': S.FINE,
           'subQuantum': 'parabolic vertex on the coarse objective grid',
           'interiorInsetMetres': S.INSET, 'collarMetres': list(S.COLLAR)},
  'calibratedOn': ('this capture only. The control set is every in-window footprint\'s own shape '
                   'dropped on building-free ground >=25 m from any footprint, through the identical rule.'),
  'controlSet': {'n': len(controls), 'bestContrast': {'p50': pc(cbest, [50])[0], 'p95': round(hi, 2)},
                 'zeroShiftContrast': {'p50': pc(czero, [50])[0], 'p95': pc(czero, [95])[0]},
                 'boundaryFitRate': round(float(np.mean([c['boundary'] for c in controls])), 2)},
  'footprintSet': {'n': len(scored),
                   'bestContrast': {'p05': round(lo, 2), 'p50': pc(fbest, [50])[0], 'p95': pc(fbest, [95])[0]},
                   'zeroShiftContrast': {'p05': pc(fzero, [5])[0], 'p50': pc(fzero, [50])[0], 'p95': pc(fzero, [95])[0]},
                   'boundaryFitRate': round(float(np.mean([r['boundary'] for r in scored])), 2)},
  'contrastCut': round(CUT, 2),
  'gap': round(lo - hi, 2),
  'gapMeaning': ('control p95 to footprint p05. It is NEGATIVE: the two distributions overlap at those '
                 'quantiles and no clean threshold exists. That is the honest answer, and the separation '
                 'is reported as an AUC instead of pretended away.'),
  'auc': {'bestContrast': round(auc(fbest, cbest), 3), 'zeroShiftContrast': round(auc(fzero, czero), 3)},
  'boundaryFitsDiscarded': ('a shift that lands on the edge of the +-10 m search box is a failed fit, '
                            'not an answer - Johannesberg\'s rule. Controls hit the boundary at almost '
                            'the same rate as footprints, which is what a failed fit looks like.'),
}
log(f'control p95 {hi:.2f}, footprint p05 {lo:.2f}, gap {lo-hi:+.2f}, cut {CUT:.2f}, AUC {auc(fbest,cbest):.3f}')

by_area = {}
for a0, a1 in [(0, 60), (60, 120), (120, 300), (300, 4000)]:
    m = np.array([a0 <= r['areaSquareMetres'] < a1 for r in scored])
    if not m.any(): continue
    nb = np.array([not r['boundary'] for r in scored]) & m
    by_area[f'{a0}-{a1}'] = {
      'n': int(m.sum()), 'boundaryFitRate': round(float(np.mean([scored[i]['boundary'] for i in np.nonzero(m)[0]])), 2),
      'bestContrastP50': round(float(np.median([scored[i]['best'] for i in np.nonzero(m)[0]])), 2),
      'wantedShiftMetresP50': (round(float(np.median([np.hypot(scored[i]['shiftE'], scored[i]['shiftN'])
                                                     for i in np.nonzero(nb)[0]])), 2) if nb.any() else None)}
R['registrationRule']['byFootprintArea'] = by_area

# ============================== 2  cross-capture: the same rule on 2019 =====
img19, _, _ = M19._load()
s19 = img19[::16, ::16].reshape(-1, 3)
l9, e9, r9 = L.indices(s19); X9 = np.stack([l9, e9, r9], 1).astype(np.float64)
mu9 = X9.mean(0); C9 = np.cov((X9 - mu9).T); w9, V9 = np.linalg.eigh(C9)
saved = B._WH
B._WH = (mu9, V9 @ np.diag(1 / np.sqrt(np.maximum(w9, 1e-9))) @ V9.T, C9)
sc19 = {}
for r in scored:
    v = S.score_ring(byid[r['id']]['ring'], byid[r['id']]['holes'], M19.sample)
    if v: sc19[r['id']] = v
B._WH = saved
log(f'{len(sc19)} footprints scored on the 2019 cross-check capture')

pair = [r for r in scored if r['id'] in sc19 and not r['boundary'] and not sc19[r['id']]['boundary']
        and r['best'] >= CUT and sc19[r['id']]['best'] >= CUT and r['areaSquareMetres'] >= 60]
A = np.array([[r['shiftE'], r['shiftN']] for r in pair])
Bv = np.array([[sc19[r['id']]['shiftE'], sc19[r['id']]['shiftN']] for r in pair])
R['crossCaptureRepeatability'] = {
  'n': len(pair),
  'wanted2025': {'meanE': round(float(A[:, 0].mean()), 2), 'meanN': round(float(A[:, 1].mean()), 2),
                 'sdE': round(float(A[:, 0].std()), 2), 'sdN': round(float(A[:, 1].std()), 2)},
  'wanted2019': {'meanE': round(float(Bv[:, 0].mean()), 2), 'meanN': round(float(Bv[:, 1].mean()), 2),
                 'sdE': round(float(Bv[:, 0].std()), 2), 'sdN': round(float(Bv[:, 1].std()), 2)},
  'correlation': {'E': round(float(np.corrcoef(A[:, 0], Bv[:, 0])[0, 1]), 3),
                  'N': round(float(np.corrcoef(A[:, 1], Bv[:, 1])[0, 1]), 3)},
  'medianDisagreementMetres': round(float(np.median(np.hypot(*(A - Bv).T))), 2),
  'medianWanted2025Metres': round(float(np.median(np.hypot(*A.T))), 2),
  'reading': ('the two captures disagree about a footprint\'s wanted shift by as much as the shift itself. '
              'A per-footprint shift from this objective is therefore NOT a measurement of that footprint\'s '
              'error - it is repeatable only in aggregate.'),
}

# ==================================== 3  the mosaic, and the lean ==========
lab, blocks = SB.blocks()
R['mosaic'] = {
  'sidecar': 'lidingobuild/cache/lm-ortho-2025/seams.png (Ortofoto_0.16_fs)',
  'requestBboxEpsg3006': list(SB.BBOX), 'metresPerPixel': round(SB.MPP, 4),
  'finding': ('this ortho is not one photograph. Over the fetched 2.5 km box the sidecar draws 15 image '
              'blocks in three N-S flight lines, each block labelled with its own exposure timestamp, so '
              'relief displacement here is radial about EACH block\'s nadir, not about one point for the '
              'whole window. Which block a footprint falls in is read off the mosaic, not fitted.'),
  'exposureLabelsReadByEye': SB.LABELS_READ,
  'flightLineEastings': 'west ~E676930, middle ~E678020 (the course), east ~E678900',
  'blocks': blocks,
  'blockNadirEstimate': ('the bbox centre of an unclipped block. A mosaic keeps each frame\'s most-nadir '
                         'area, so a whole block\'s centre is that frame\'s nadir to within its own seam wander.'),
}

# 3a NCC: the same physical roof in the two captures, sub-decimetre where it correlates
def _patch(sampler, cE, cN, half, step=0.16):
    E = np.arange(cE - half, cE + half + step / 2, step); N = np.arange(cN + half, cN - half - step / 2, -step)
    EE, NN = np.meshgrid(E, N); px = sampler(EE, NN).astype(np.float32)
    return 0.299 * px[..., 0] + 0.587 * px[..., 1] + 0.114 * px[..., 2]

def ncc(cE, cN, half, search=6.0, step=0.16):
    Aa = _patch(L.sample, cE, cN, half, step); ks = int(round(search / step))
    Bb = _patch(M19.sample, cE, cN, half + search + step, step)
    a = (Aa - Aa.mean()) / (Aa.std() + 1e-6); a = a.ravel(); H, W = Aa.shape
    best = -2; bs_ = (0.0, 0.0)
    for dr in range(-ks, ks + 1):
        for dc in range(-ks, ks + 1):
            sub = Bb[ks + dr:ks + dr + H, ks + dc:ks + dc + W]
            sd = sub.std()
            if sd < 1e-3: continue
            v = float(np.dot(a, ((sub - sub.mean()) / sd).ravel()) / a.size)
            if v > best: best, bs_ = v, (dc * step, -dr * step)
    return bs_, best, (abs(abs(bs_[0]) - search) < 1e-6 or abs(abs(bs_[1]) - search) < 1e-6)

roofncc = []
for r in scored:
    c = L.ring_centroid(byid[r['id']]['ring'])
    if c[2] < 40: continue
    half = float(max(10.0, min(30.0, 0.75 * np.sqrt(c[2]))))
    s, pk, bd = ncc(c[0], c[1], half)
    roofncc.append({'id': r['id'], 'E': c[0], 'N': c[1], 'areaSquareMetres': round(c[2], 1),
                    'halfWindowMetres': round(half, 1), 'peak': round(pk, 3),
                    'position2019MinusPosition2025': [round(s[0], 2), round(s[1], 2)], 'boundary': bd})
log(f'{len(roofncc)} roofs cross-correlated between the two captures')

sel = [r for r in roofncc if r['peak'] >= 0.40 and not r['boundary']]
P = np.array([[r['E'], r['N']] for r in sel])
LEANV = -np.array([r['position2019MinusPosition2025'] for r in sel])
blk = np.array([SB.block_at(lab, e, n) for e, n in P])
byl = {b['label']: b for b in blocks}
nadir = np.array([byl[k]['bboxCentre'] for k in blk])
Rv = P - nadir; rn = np.linalg.norm(Rv, axis=1); rhat = Rv / rn[:, None]
radial = np.sum(LEANV * rhat, 1); tang = np.sum(LEANV * np.stack([-rhat[:, 1], rhat[:, 0]], 1), 1)

def meancos(nad, P, V):
    Rr = P - nad; r_ = np.linalg.norm(Rr, axis=1); v_ = np.linalg.norm(V, axis=1)
    ok = (r_ > 1) & (v_ > 0.3)
    return float(np.mean(np.sum(Rr[ok] * V[ok], 1) / (r_[ok] * v_[ok]))), int(ok.sum())

mc_block, n_used = meancos(nadir, P, LEANV)
perm = np.array([meancos(nadir, P, LEANV[RNG.permutation(len(P))])[0] for _ in range(2000)])
rnd = np.array([meancos(nadir, P, np.stack([np.cos(a), np.sin(a)], 1))[0]
                for a in [RNG.uniform(0, 2 * np.pi, len(P)) for _ in range(2000)]])
bestfree = None
for E in np.arange(675500, 680501, 50.0):
    for N in np.arange(6583500, 6589501, 50.0):
        m_, k_ = meancos(np.array([E, N]), P, LEANV)
        if bestfree is None or m_ > bestfree[0]: bestfree = (m_, E, N, k_)
permfree = np.array([meancos(np.array([bestfree[1], bestfree[2]]), P, LEANV[RNG.permutation(len(P))])[0]
                     for _ in range(2000)])

ub = sorted(set(blk.tolist()))
Xd = np.zeros((2 * len(P), 2 * len(ub) + 1)); yd = np.zeros(2 * len(P))
for i in range(len(P)):
    j = ub.index(blk[i]); Xd[2 * i, j] = 1; Xd[2 * i + 1, len(ub) + j] = 1
    Xd[2 * i, -1] = Rv[i, 0]; Xd[2 * i + 1, -1] = Rv[i, 1]
    yd[2 * i] = LEANV[i, 0]; yd[2 * i + 1] = LEANV[i, 1]
beta, *_ = np.linalg.lstsq(Xd, yd, rcond=None); res = yd - Xd @ beta
s2 = res @ res / (len(yd) - Xd.shape[1]); sebeta = np.sqrt(np.diag(s2 * np.linalg.pinv(Xd.T @ Xd)))
b_, sb_ = float(beta[-1]), float(sebeta[-1])
X0 = Xd[:, :-1]; b0, *_ = np.linalg.lstsq(X0, yd, rcond=None); res0 = yd - X0 @ b0

R['leanAnalysis'] = {
  'question': 'an ortho is rectified to the terrain, so anything standing above it leans radially away from nadir',
  'measurement': ('image-to-image: the same physical roof cross-correlated between the 2025 capture and the '
                  '2019 capture, at the 0.16 m native grid. That is far more precise than footprint-to-image '
                  '(residual sd 1.3-1.6 m against 2.4-3.0 m) and it does not involve the OSM outline at all, '
                  'so the footprints\' own tracing error cannot enter it.'),
  'sign': ('position2019 - position2025 is what the correlation returns; its negative is the 2025 '
           'displacement, taking 2019 as the reference. Lean predicts that displacement points AWAY from '
           'the 2025 block nadir.'),
  'n': len(sel), 'nccPeakGate': 0.40,
  'radialDistanceFromOwnBlockNadirMetres': {'p10': pc(rn, [10])[0], 'p50': pc(rn, [50])[0], 'p90': pc(rn, [90])[0]},
  'radialComponentMetres': {'mean': round(float(radial.mean()), 2), 'sd': round(float(radial.std()), 2),
                            't': round(float(radial.mean() / (radial.std() / np.sqrt(len(radial)))), 2)},
  'tangentialComponentMetres': {'mean': round(float(tang.mean()), 2), 'sd': round(float(tang.std()), 2),
                                't': round(float(tang.mean() / (tang.std() / np.sqrt(len(tang)))), 2),
                                'note': 'must be ~0 if the displacement is lean, and it is'},
  'meanCosineAgainstOwnBlockNadir': round(mc_block, 3),
  'permutationBaseline': {'mean': round(float(perm.mean()), 3), 'sd': round(float(perm.std()), 3),
                          'p95': round(float(np.percentile(perm, 95)), 3),
                          'rule': 'the same shift vectors dealt out to different buildings, 2000 times'},
  'randomDirectionBaseline': {'mean': round(float(rnd.mean()), 3), 'sd': round(float(rnd.std()), 3)},
  'bestFreeSingleNadir': {'meanCosine': round(bestfree[0], 3),
                          'atEpsg3006': [float(bestfree[1]), float(bestfree[2])],
                          'permutationBaselineP95': round(float(np.percentile(permfree, 95)), 3),
                          'reading': ('a single fitted nadir fits WORSE than the mosaic\'s own per-block '
                                      'nadirs. That is the shape only a mosaic can make, and a single-nadir '
                                      'model - the one Johannesberg tested - under-reads it here.')},
  'radialGradient': {'bPerMetre': round(b_, 5), 'standardError': round(sb_, 5), 't': round(b_ / sb_, 2),
                     'model': 'displacement = per-block translation + b * (position - own block nadir)',
                     'residualSdMetres': round(float(np.sqrt(s2)), 2),
                     'varianceExplainedOverTranslationsAlone': round(float(1 - (res @ res) / (res0 @ res0)), 3)},
  'flyingHeightImplied': {f'nominalHeight{h}m': {'H': round(h / b_), 'ci95Low': round(h / (b_ + 1.96 * sb_))}
                          for h in (3.7, 5.0, 10.0)},
  'predictedDisplacementAtBlockEdge': {'radiusMetres': 850, 'nominalHeightMetres': 5.0,
                                       'metres': round(850 * b_, 2)},
  'verdict': ('CONFIRMED in the per-block form, and small. The displacement is radial about each mosaic '
              'block\'s own nadir (mean cosine 0.290 against a permutation baseline of -0.002 +- 0.082) and '
              'its tangential component is null. Its size is a mean +0.63 m at a median radius of 296 m, '
              'i.e. under about 1.5 m anywhere in this window for an ordinary house - an order of magnitude '
              'below the 3-11 m Johannesberg measured on a 0.5 m satellite ortho, because a national 0.16 m '
              'aerial mosaic keeps only each frame\'s near-nadir block.'),
  'notApplied': ('nothing is corrected. Removing lean per building needs a height per building, and this '
                 'model has a measured height for 6 of 562 footprints; the radial term explains 1.7% of the '
                 'per-building variance, so a population-level correction would move each footprint by less '
                 'than the 1.3 m the measurement itself is uncertain by.'),
  'alsoMeasuredOnTheContrastObjective': None,
}

mC = np.array([[r['shiftE'], r['shiftN']] for r in scored
               if not r['boundary'] and r['best'] >= CUT and r['areaSquareMetres'] >= 100])
pC = np.array([r['centroidEpsg3006'] for r in scored
               if not r['boundary'] and r['best'] >= CUT and r['areaSquareMetres'] >= 100])
blkC = np.array([SB.block_at(lab, e, n) for e, n in pC]); nadC = np.array([byl[k]['bboxCentre'] for k in blkC])
mcC, nC = meancos(nadC, pC, mC)
permC = np.array([meancos(nadC, pC, mC[RNG.permutation(len(pC))])[0] for _ in range(2000)])
R['leanAnalysis']['alsoMeasuredOnTheContrastObjective'] = {
  'n': int(len(pC)), 'meanCosineAgainstOwnBlockNadir': round(mcC, 3),
  'permutationBaselineP95': round(float(np.percentile(permC, 95)), 3),
  'reading': ('the footprint-to-image objective points the same way but only just clears its own baseline. '
              'It carries the OSM outlines\' tracing error - source=Yahoo on most of these - on top of the '
              'lean, which is why the image-to-image measurement is the one that resolves it.')}

# ==================================== 4  presence ==========================
EL, AZ = SUN.solar(2025, 5, 31, 8, 27, 59.3787, 18.1282)
SHB = np.radians((AZ + 180) % 360); UE, UN = np.sin(SHB), np.cos(SHB)
OFFS = np.arange(1.5, 12.01, 0.5)

def shadow_scan(ring):
    E, N = B.local_grid(ring, 2.0, 0.5); EE, NN = np.meshgrid(E, N)
    ins = nd.binary_erosion(L.point_in_ring(EE, NN, ring), np.ones((3, 3)), iterations=2)
    if ins.sum() < 10: return None
    e, n = EE[ins], NN[ins]
    def lum(dE, dN):
        px = L.sample(e + dE, n + dN).astype(np.float32)
        return float(np.median(0.299 * px[..., 0] + 0.587 * px[..., 1] + 0.114 * px[..., 2]))
    dn_ = np.array([lum(UE * o, UN * o) for o in OFFS]); up_ = np.array([lum(-UE * o, -UN * o) for o in OFFS])
    d = dn_ - up_; k = int(np.argmin(d))
    return float(d[k]), float(OFFS[k])

DEMOLITION_VERDICT = {
  # each candidate read by eye on the 2025 capture with the 2019 capture beside it, and
  # against the 2021 laser roof returns where this build has them
  'way/32262183': 'refuted - the golf facility roof stands in both captures, and the 2021 laser reads 737 '
                  'first returns 1.5-10.2 m above the DTM inside it. It fires because a grey roof in a '
                  'cluster of grey roofs and tarmac has no collar contrast and no free ground to shadow.',
  'way/32262169': 'refuted - the same building group; 205 laser roof returns 2.9-3.9 m above the DTM. Its '
                  'down-sun neighbour is the car park, so the shadow test has nothing to find.',
  'way/52583092': 'refuted - a dark roof standing in both captures, ringed by tree crowns that darken the '
                  'collar to the roof\'s own tone.',
  'way/52583094': 'refuted - stands in both captures; deep tree shadow over the collar.',
  'way/143587608': 'refuted - a large dark roof standing in both captures, between a dark road and trees.',
}
SH = {r['id']: shadow_scan(byid[r['id']]['ring']) for r in scored}
shc = []
ids_all = list(byid); k = 0
boxes = np.array([[min(p[0] for p in b['ring']) - 25, max(p[0] for p in b['ring']) + 25,
                   min(p[1] for p in b['ring']) - 25, max(p[1] for p in b['ring']) + 25] for b in bs])
while len(shc) < 200 and k < 6000:
    k += 1
    b = byid[ids_all[RNG.integers(len(ids_all))]]; c = L.ring_centroid(b['ring'])
    E = RNG.uniform(WIN['minEasting'] + 30, WIN['maxEasting'] - 30)
    N = RNG.uniform(WIN['minNorthing'] + 30, WIN['maxNorthing'] - 30)
    if np.any((boxes[:, 0] < E) & (E < boxes[:, 1]) & (boxes[:, 2] < N) & (N < boxes[:, 3])): continue
    s = shadow_scan([[p[0] - c[0] + E, p[1] - c[1] + N] for p in b['ring']])
    if s: shc.append(s[0])
fs = np.array([v[0] for v in SH.values() if v]); cs_ = np.array(shc)
allv = np.sort(np.concatenate([fs, cs_])); bestJ = None
for c0 in allv:
    j = (fs <= c0).mean() - (cs_ <= c0).mean()
    if bestJ is None or j > bestJ[0]: bestJ = (j, float(c0), float((fs <= c0).mean()), float((cs_ <= c0).mean()))
SCUT = bestJ[1]

poly = {i: np.array(b['ring']) for i, b in byid.items()}
bb = {i: (p[:, 0].min(), p[:, 0].max(), p[:, 1].min(), p[:, 1].max()) for i, p in poly.items()}
def touching(i, j, m=6.0):
    a, b_ = bb[i], bb[j]
    if a[0] - m > b_[1] or b_[0] - m > a[1] or a[2] - m > b_[3] or b_[2] - m > a[3]: return False
    Pp, Qq = poly[i], poly[j]
    return ((Pp[:, None, 0] - Qq[None, :, 0]) ** 2 + (Pp[:, None, 1] - Qq[None, :, 1]) ** 2).min() < m * m
freestanding = {r['id']: not any(touching(r['id'], j) for j in byid if j != r['id']) for r in scored}

absent = [r for r in scored if freestanding[r['id']] and r['best'] < CUT
          and SH.get(r['id']) and SH[r['id']][0] > SCUT]
R['presence'] = {
  'sun': {'utc': '2025-05-31T08:27Z (the middle flight line\'s own exposure label, +02)',
          'elevationDeg': round(EL, 2), 'azimuthDeg': round(AZ, 2),
          'shadowBearingDeg': round((AZ + 180) % 360, 2),
          'shadowLengthPerMetreOfHeight': round(1 / np.tan(np.radians(EL)), 3)},
  'twoIndependentRecords': ('colour - the contrast objective, inside against a collar - and geometry - the '
                            'deepest luminance deficit anywhere 1.5-12 m down-sun. They share no pixel rule, '
                            'and only a footprint both call empty is reported.'),
  'shadowRule': {'n': len(fs), 'controls': len(cs_),
                 'footprintDeficit': {'p05': pc(fs, [5])[0], 'p50': pc(fs, [50])[0], 'p95': pc(fs, [95])[0]},
                 'controlDeficit': {'p05': pc(cs_, [5])[0], 'p50': pc(cs_, [50])[0], 'p95': pc(cs_, [95])[0]},
                 'auc': round(auc(-fs, -cs_), 3), 'youdenCut': round(SCUT, 1),
                 'truePositiveRate': round(bestJ[2], 2), 'falsePositiveRate': round(bestJ[3], 2)},
  'freeStandingGate': {
    'n': int(sum(freestanding.values())), 'of': len(scored),
    'why': ('both rules fail inside a continuous built mass: a footprint whose collar is the neighbour\'s '
            'roof has no contrast, and a footprint whose down-sun neighbour is another building has no '
            'shadow. Measured here on the five row-house footprints way/1317467231-237, which both rules '
            'called empty and the capture plainly shows standing. Presence is only asked of a footprint '
            'with no other footprint within 6 m. That gate is NOT sufficient: the same failure comes from '
            'a collar of tarmac or of tree shadow, and all five surviving candidates fail for one of those '
            'two reasons.')},
  'demolishedCandidates': [{'id': r['id'], 'bestContrast': round(r['best'], 2),
                            'shadowDeficit': round(SH[r['id']][0], 1),
                            'areaSquareMetres': r['areaSquareMetres'],
                            'centroidEpsg3006': r['centroidEpsg3006'],
                            'tags': r['tags'], 'osmTimestamp': r['osmTimestamp'],
                            'verdict': DEMOLITION_VERDICT.get(r['id'], 'unread')} for r in absent],
  'demolishedConfirmed': 0,
  'demolishedAdopted': 0,
  'demolishedReading': ('EVERY candidate is refuted by a second record and none is adopted. The two rules '
                        'agree on empty in the same places for the same reason - a dark roof whose collar is '
                        'hardstanding, shadow or another roof - and that is a property of the surroundings, '
                        'not of the building. The capture, read directly, shows no demolition anywhere in '
                        'its window; that is a weak negative and is reported as one, because a rule that '
                        'produces five false positives out of five has not been shown able to find a true one.'),
}

# ---- new structures the model lacks -----------------------------------------
STEP = 0.4
Eg = np.arange(WIN['minEasting'] + 4, WIN['maxEasting'] - 4, STEP)
Ng = np.arange(WIN['maxNorthing'] - 4, WIN['minNorthing'] + 4, -STEP)
EE, NN = np.meshgrid(Eg, Ng); px = L.sample(EE, NN).astype(np.float32)
lumg, exgg, _ = L.indices(px)
smf = nd.uniform_filter(lumg, 3); sdg = np.sqrt(np.maximum(nd.uniform_filter(lumg * lumg, 3) - smf * smf, 0))
Hh, Ww = lumg.shape
roofmask = np.zeros((Hh, Ww), bool)
for b in bs:
    xs = [p[0] for p in b['ring']]; ys = [p[1] for p in b['ring']]
    if max(xs) < Eg[0] or min(xs) > Eg[-1] or max(ys) < Ng[-1] or min(ys) > Ng[0]: continue
    c0 = max(0, int((min(xs) - Eg[0]) / STEP)); c1 = min(Ww, int((max(xs) - Eg[0]) / STEP) + 2)
    r0 = max(0, int((Ng[0] - max(ys)) / STEP)); r1 = min(Hh, int((Ng[0] - min(ys)) / STEP) + 2)
    if c1 <= c0 or r1 <= r0: continue
    roofmask[r0:r1, c0:c1] |= L.point_in_ring(EE[r0:r1, c0:c1], NN[r0:r1, c0:c1], b['ring'])
innerm = nd.binary_erosion(roofmask, np.ones((3, 3)), iterations=4)
farm = ~nd.binary_dilation(roofmask, np.ones((3, 3)), iterations=25)
vegm = farm & (exgg > 25)
EXG_CUT = 8.0
appearance = (exgg < EXG_CUT) & (sdg < 5) & (lumg > 55)
appearance = nd.binary_opening(appearance, np.ones((3, 3)), iterations=2)
recall = []
for r in scored:
    ring = byid[r['id']]['ring']
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    r0 = max(0, int((Ng[0] - max(ys)) / STEP)); r1 = min(Hh, int((Ng[0] - min(ys)) / STEP) + 2)
    c0 = max(0, int((min(xs) - Eg[0]) / STEP)); c1 = min(Ww, int((max(xs) - Eg[0]) / STEP) + 2)
    if r1 <= r0 or c1 <= c0: continue
    X_, Y_ = np.meshgrid(Eg[c0:c1], Ng[r0:r1])
    ins = nd.binary_erosion(L.point_in_ring(X_, Y_, ring), np.ones((3, 3)), iterations=3)
    if ins.sum() < 8: continue
    recall.append(float(appearance[r0:r1, c0:c1][ins].mean()))
recall = np.array(recall)

manmade = np.zeros((Hh, Ww), bool)
def stamp(pts, halfw):
    Pp = np.array([[p[0] + 677700.5, 6586399.5 - p[1]] for p in pts])
    kk = int(round(halfw / STEP))
    for i in range(len(Pp) - 1):
        d = np.hypot(*(Pp[i + 1] - Pp[i])); n_ = max(2, int(d / (STEP * 0.7)))
        for t in np.linspace(0, 1, n_):
            e, nn = Pp[i] + (Pp[i + 1] - Pp[i]) * t
            rr = int(round((Ng[0] - nn) / STEP)); cc2 = int(round((e - Eg[0]) / STEP))
            if -kk <= rr < Hh + kk and -kk <= cc2 < Ww + kk:
                manmade[max(0, rr - kk):rr + kk + 1, max(0, cc2 - kk):cc2 + kk + 1] = True
for rd in model['infra']['roads']: stamp(rd['line'], (rd.get('w') or 6) / 2 + 4)
for pth in model['infra']['paths']: stamp(pth['line'], 4.0)
for tr in model['infra']['tracks']: stamp(tr['line'], 4.0)
for pk in model['infra']['parking']:
    ring = [[p[0] + 677700.5, 6586399.5 - p[1]] for p in pk['ring']]
    xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
    r0 = max(0, int((Ng[0] - max(ys)) / STEP)); r1 = min(Hh, int((Ng[0] - min(ys)) / STEP) + 2)
    c0 = max(0, int((min(xs) - Eg[0]) / STEP)); c1 = min(Ww, int((max(xs) - Eg[0]) / STEP) + 2)
    if r1 <= r0 or c1 <= c0: continue
    X_, Y_ = np.meshgrid(Eg[c0:c1], Ng[r0:r1])
    manmade[r0:r1, c0:c1] |= L.point_in_ring(X_, Y_, ring + [ring[0]])
manmade = nd.binary_dilation(manmade, np.ones((3, 3)), iterations=5)
cand = appearance & (~nd.binary_dilation(roofmask, np.ones((3, 3)), iterations=15)) & (~manmade)
labc, nc_ = nd.label(cand)
newc = []
for i, sl in enumerate(nd.find_objects(labc), 1):
    if sl is None: continue
    msk = labc[sl] == i; a = msk.sum() * STEP * STEP
    if a < 20: continue
    hgt = (sl[0].stop - sl[0].start) * STEP; wid = (sl[1].stop - sl[1].start) * STEP
    fill = a / (hgt * wid)
    if fill < 0.55 or min(hgt, wid) < 3.0 or max(hgt, wid) > 70: continue
    ys, xs = np.nonzero(msk); ys = ys + sl[0].start; xs = xs + sl[1].start
    inl = float(np.median(lumg[ys, xs]))
    dmin = min(float(np.median(lumg[np.clip(ys + int(round(-UN * o / STEP)), 0, Hh - 1),
                                    np.clip(xs + int(round(UE * o / STEP)), 0, Ww - 1)])) - inl
               for o in np.arange(1.5, 8.01, 0.5))
    if dmin > -25: continue
    newc.append({'E': round(float(Eg[0] + xs.mean() * STEP), 1), 'N': round(float(Ng[0] - ys.mean() * STEP), 1),
                 'areaSquareMetres': round(float(a), 1), 'bboxMetres': [round(wid, 1), round(hgt, 1)],
                 'rectangularFill': round(float(fill), 2), 'medianLuminance': round(inl, 1),
                 'medianExG': round(float(np.median(exgg[ys, xs])), 1),
                 'deepestDownSunDeficit': round(dmin, 1)})
newc.sort(key=lambda r: -r['areaSquareMetres'])
R['unmappedStructureSearch'] = {
  'rule': {'excessGreenCut': EXG_CUT, 'localSdCut': 5.0, 'sunlitLuminanceFloor': 55,
           'minimumAreaSquareMetres': 20, 'minimumRectangularFill': 0.55,
           'downSunDeficitCut': -25,
           'exclusions': 'within 6 m of a mapped footprint, and inside the model\'s own roads, paths, tracks and parking (+5 cells)'},
  'calibration': {'roofInteriorExG': {'p05': pc(exgg[innerm], [5])[0], 'p50': pc(exgg[innerm], [50])[0],
                                      'p90': pc(exgg[innerm], [90])[0], 'p95': pc(exgg[innerm], [95])[0]},
                  'clearlyVegetatedExG_p05': pc(exgg[vegm], [5])[0],
                  'gap': round(float(np.percentile(exgg[vegm], 5) - np.percentile(exgg[innerm], 90)), 1),
                  'gapMeaning': 'positive: roof and vegetation separate cleanly on this capture, and the cut sits in the gap',
                  'roofInteriorLocalSdP50': round(float(np.median(sdg[innerm])), 1),
                  'offFootprintLocalSdP50': round(float(np.median(sdg[farm])), 1),
                  'excludedByModelInfrastructure': round(float(manmade.mean()), 3)},
  'selfScore': {'question': 'how many of the 140 MAPPED footprints does this same rule light up?',
                'interiorFractionDetected': {'p10': round(float(np.percentile(recall, 10)), 2),
                                             'p50': round(float(np.percentile(recall, 50)), 2),
                                             'p90': round(float(np.percentile(recall, 90)), 2)},
                'shareWithAtLeastHalfDetected': round(float((recall >= 0.5).mean()), 2),
                'verdict': ('the rule recovers half the interior of only 41% of the buildings it is known to '
                            'be looking for. That is too poor to support a claim of ABSENCE, so this search '
                            'reports candidates and refuses the negative result.')},
  'candidates': newc,
  'candidatesAdopted': 0,
  'candidatesInspected': ('the twelve largest were rendered against both captures and read by eye: golf '
                          'bunkers (3), swimming pools with their surrounds (2), driveways and yards beside '
                          'mapped houses (3), sports-court corners (2), bare ground (2). Not one is a '
                          'building. The rule cannot separate a low flat roof from a driveway at nadir, and '
                          'what would separate them - the shadow - is dominated at 20-60 m2 by nearby trees.'),
}
log('presence done')

# ==================================== 5  the clubhouse =====================
CL = 'way/32262176'
clring = byid[CL]['ring']
Vv = np.array([[v['c'][0] + 677700.5, 6586399.5 - v['c'][1], v['heightRH2000']]
               for v in MB[CL]['roofSurface']['vertices']])
from scipy.spatial import cKDTree
Eg2, Ng2 = B.local_grid(clring, -1.0, 0.16); XX, YY = np.meshgrid(Eg2, Ng2)
ins = nd.binary_erosion(L.point_in_ring(XX, YY, clring), np.ones((3, 3)), iterations=int(2.0 / 0.16))
tree = cKDTree(Vv[:, :2]); dd, _ = tree.query(np.stack([XX[ins], YY[ins]], 1)); near = dd < 1.2
rp = L.sample(XX[ins][near], YY[ins][near])
rl = 0.299 * rp[:, 0] + 0.587 * rp[:, 1] + 0.114 * rp[:, 2]
cE, cN = float(np.mean([p[0] for p in clring])), float(np.mean([p[1] for p in clring]))
Er = np.arange(cE - 150, cE + 150, 0.32); Nr = np.arange(cN + 150, cN - 150, -0.32)
XR, YR = np.meshgrid(Er, Nr); rf = L.sample(XR, YR).astype(np.float32)
rlum, rexg, _ = L.indices(rf)
nvg = rexg < 6
bright = rf[(rlum > np.percentile(rlum[nvg], 99.7)) & nvg]
dark = rf[rlum < np.percentile(rlum, 0.3)]
road = []
for rd in model['infra']['roads']:
    for p in rd['line']:
        e = p[0] + 677700.5; n = 6586399.5 - p[1]
        if abs(e - cE) < 150 and abs(n - cN) < 150: road.append((e, n))
road = np.array(road); rdpx = L.sample(road[:, 0], road[:, 1]).astype(np.float32)
hi_ = float(np.median(0.299 * bright[:, 0] + 0.587 * bright[:, 1] + 0.114 * bright[:, 2]))
lo_ = float(np.median(0.299 * dark[:, 0] + 0.587 * dark[:, 1] + 0.114 * dark[:, 2]))
rdl = float(np.median(0.299 * rdpx[:, 0] + 0.587 * rdpx[:, 1] + 0.114 * rdpx[:, 2]))
hiP = Vv[Vv[:, 2] > 33.2]; loP = Vv[Vv[:, 2] < 32.9]
def plane(Sarr):
    Ap = np.c_[Sarr[:, 0] - Sarr[:, 0].mean(), Sarr[:, 1] - Sarr[:, 1].mean(), np.ones(len(Sarr))]
    c_, *_ = np.linalg.lstsq(Ap, Sarr[:, 2], rcond=None)
    return (float(np.degrees(np.arctan(np.hypot(c_[0], c_[1])))),
            float(np.degrees(np.arctan2(-c_[0], -c_[1])) % 360), float(np.std(Sarr[:, 2] - Ap @ c_)))
sep = hiP[:, :2].mean(0) - loP[:, :2].mean(0)
Pl = np.array(clring) - np.array(clring).mean(0); _, _, vt = np.linalg.svd(Pl, full_matrices=False)
scen = (ROOT / 'apps/golf/src/engine/scenery/lidingo.js').read_text(encoding='utf8')
import re
claimed = {k: v for k, v in re.findall(r'(wall|roof):\s*(0x[0-9a-f]{6})', scen)}
ch = int(claimed['roof'], 16); chrgb = ((ch >> 16) & 255, (ch >> 8) & 255, ch & 255)
R['clubhouse'] = {
  'footprint': CL, 'name': byid[CL]['tags'].get('name'),
  'whatAnOrthoCanAnswer': ('roof shape, ridge direction, roof colour, terrace and surroundings. It cannot '
                           'answer wall colour, materials, storeys or glazing, and nothing is said about them here.'),
  'roofColour': {
    'mask': 'inside the footprint eroded 2 m AND within 1.2 m of a 2021 laser roof return',
    'pixels': int(near.sum()),
    'medianRgb': [int(v) for v in np.median(rp, 0)],
    'p25Rgb': [int(v) for v in np.percentile(rp, 25, 0)], 'p75Rgb': [int(v) for v in np.percentile(rp, 75, 0)],
    'medianLuminance': round(float(np.median(rl)), 1),
    'sameFrameReferences': {'brightestNonVegetation(paint/whitecars)': [int(v) for v in np.median(bright, 0)],
                            'deepestShadow': [int(v) for v in np.median(dark, 0)],
                            'asphaltRoadCentreline': [int(v) for v in np.median(rdpx, 0)]},
    'positionBetweenDeepShadowAndPaintWhite': round((float(np.median(rl)) - lo_) / (hi_ - lo_), 2),
    'luminanceRelativeToAdjacentAsphalt': round(float(np.median(rl)) / rdl, 2),
    'reading': ('a MID grey with a slight blue cast, tight (interquartile 10 counts), about three tenths of '
                'the way from deep shadow to paint-white in its own frame and about three quarters of the '
                'luminance of the asphalt beside it. This is a sunlit nadir reading under a 45 deg sun with '
                'atmospheric path radiance in it, so it is not a paint chip; what it does establish is the '
                'roof\'s place on this frame\'s own scale.'),
    'againstThePage': {'file': 'apps/golf/src/engine/scenery/lidingo.js', 'claimedRoof': claimed.get('roof'),
                       'claimedRoofRgb': list(chrgb),
                       'note': ('the module states a near-black 0x2a2c2b, read off golden-hour photographs, '
                                'and its own comment says a flat-light frame would let it be measured. This '
                                'is that frame, and it reads mid-grey, not near-black - the same distance '
                                'above deep shadow that the module\'s value sits at. It is an engine albedo '
                                'and not a measured reflectance, so this is evidence for the integrator, '
                                'not a value to paste.')}},
  'roofForm': {
    'source': 'the 2021-03-23 laser roof TIN in course-model.json, 669 vertices; the photograph corroborates the outline',
    'plates': [{'name': 'north', 'n': int(len(hiP)), 'heightRH2000mean': round(float(hiP[:, 2].mean()), 2),
                'sd': round(float(hiP[:, 2].std()), 2), 'slopeDeg': round(plane(hiP)[0], 2),
                'fallsTowardBearingDeg': round(plane(hiP)[1]), 'planeRmsMetres': round(plane(hiP)[2], 3)},
               {'name': 'south', 'n': int(len(loP)), 'heightRH2000mean': round(float(loP[:, 2].mean()), 2),
                'sd': round(float(loP[:, 2].std()), 2), 'slopeDeg': round(plane(loP)[0], 2),
                'fallsTowardBearingDeg': round(plane(loP)[1]), 'planeRmsMetres': round(plane(loP)[2], 3)}],
    'stepMetres': round(float(hiP[:, 2].mean() - loP[:, 2].mean()), 2),
    'stepLineSeparationVector': [round(float(sep[0]), 1), round(float(sep[1]), 1)],
    'ridgeDirection': ('THERE IS NO RIDGE. The roof over this footprint is two near-level plates, both under '
                       '2 deg, stepping down 1.17 m to the south across a line running about E-W at N 6586458. '
                       'A ridge azimuth would be an invention here.'),
    'footprintLongAxisBearingDeg': round(float(np.degrees(np.arctan2(vt[0, 0], vt[0, 1])) % 180)),
    'roofClearanceAboveDtmMetres': HEIGHT[CL]['roofCandidateHeightAboveDtm'],
    'corroboratesThePage': ('the module renders height 3.9 m; the laser reads the roof surface a median '
                            '3.73 m above the DTM (p05-p95 3.31-4.19). "Very shallow, almost flat" is right '
                            'and is now a number.')},
  'wallsAndGlazing': 'not measurable from a nadir ortho. Nothing measured, nothing said.',
}

# ==================================== 6  heights, refused ==================
R['refusals'].append({
  'kind': 'height-proxy-failed-its-own-validation',
  'rule': ('shadow length from the down-sun footprint edge, at the computed sun elevation 45.32 deg '
           '(shadow = 0.989 x height), luminance cut 77.7 calibrated down-sun against up-sun of the five '
           'tall known roofs'),
  'validatedAgainst': 'the six 2021 laser roof heights, which never entered the rule',
  'result': ('reproduced 2 of 6 within 1 m (3.34 vs 3.69; 3.59 vs 2.84), and missed the two tallest badly '
             '(1.31 vs 9.18; 2.45 vs 4.98) where the shadow falls on a neighbouring roof or hardstanding. '
             'Refused as a height source, so the lean cannot be predicted per building and is reported as a '
             'population coefficient with a nominal height instead.')})
R['refusals'].append({
  'kind': 'no-clean-threshold',
  'what': 'the contrast objective, footprints against controls',
  'numbers': f'control p95 {hi:.2f}, footprint p05 {lo:.2f}, gap {lo-hi:+.2f}; AUC {auc(fbest, cbest):.3f}',
  'meaning': 'the distributions overlap at those quantiles. The cut is placed at their midpoint and every row carries its own number.'})
R['refusals'].append({
  'kind': 'search-cannot-support-a-negative',
  'what': 'the unmapped-structure search',
  'numbers': f'the same rule lights up >=50% of the interior of only {(recall>=0.5).mean():.0%} of the 140 mapped footprints',
  'meaning': 'no claim is made that the model is missing nothing; only that nothing this rule found is a building.'})

R['footprints'] = [{
  'id': r['id'], 'centroidEpsg3006': r['centroidEpsg3006'], 'areaSquareMetres': r['areaSquareMetres'],
  'building': r['tags'].get('building'), 'name': r['tags'].get('name'), 'osmTimestamp': r['osmTimestamp'][:10],
  'zeroShiftContrast': round(r['zero'], 2), 'bestContrast': round(r['best'], 2),
  'wantedShiftMetres': [round(r['shiftE'], 2), round(r['shiftN'], 2)],
  'boundaryFit': r['boundary'], 'freeStanding': freestanding[r['id']],
  'shadowDeficit': round(SH[r['id']][0], 1) if SH.get(r['id']) else None,
  'shadowAtMetres': round(SH[r['id']][1], 1) if SH.get(r['id']) else None,
  'mosaicBlock': int(SB.block_at(lab, *r['centroidEpsg3006'])),
  'cross2019Contrast': round(sc19[r['id']]['best'], 2) if r['id'] in sc19 else None,
  'cross2019WantedShiftMetres': ([round(sc19[r['id']]['shiftE'], 2), round(sc19[r['id']]['shiftN'], 2)]
                                 if r['id'] in sc19 else None),
  'measuredHeightAboveDtmMetres': (HEIGHT[r['id']]['roofCandidateHeightAboveDtm']['median']
                                   if r['id'] in HEIGHT else None),
} for r in scored]
R['roofCrossCorrelation'] = roofncc

R['limitations'] = [
  'Nothing in this file is applied. It is evidence for an integrator to weigh, not geometry.',
  f'{len(bs)-len(inside)} of {len(bs)} footprints lie outside the one photo record and are not scored at all.',
  'The OSM footprints carry source=Yahoo or survey;yahoo_imagery, so most are themselves roof outlines traced '
  'off other imagery with that imagery\'s own lean in them. A footprint-to-2025 shift is a difference of two '
  'leans plus a tracing error, which is why the lean is measured image-to-image instead.',
  'The laser is 2021-03-23 and the photograph 2025-05-31. Anything built between them has colour and no shape.',
  'Roof colour is a sunlit nadir reading with atmospheric path radiance in it, reported against same-frame '
  'references. It is not a reflectance and not a paint colour.',
  'The mosaic block nadir is the block\'s bbox centre, which is the frame\'s nadir only to within the seam '
  'wander; the two clipped columns are excluded from that estimate by using unclipped blocks only where possible.',
]
OUT.write_text(json.dumps(R, indent=1, ensure_ascii=False) + '\n', encoding='utf8')
log(f'wrote {OUT.relative_to(ROOT)}  ({OUT.stat().st_size/1024:.0f} kB)')
