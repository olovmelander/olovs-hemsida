"""Where are Visby's six numbered tees? Ask the photograph at the card's own
   distance, and say plainly which holes it answers and which it does not.

WHY THIS EXISTS. Every hole carries six numbered tee marks and all six sit on
ONE point -- the model says so itself, `placement: 'shared-camera-reference-on-
observed-platform; numeric tee position unknown'`. The card spans 6230 m to
4216 m, about 112 m a hole, so six marks on one point is not a small error: it
is the whole tee dimension missing. One deck a hole is mapped, 7-32 m long and
aligned with the hole, which cannot hold six tees 112 m apart.

WHICH PICTURE IS THE INSTRUMENT, and the trap in asking. Two dated captures
cover this course: Lantmateriet's 0.16 m national flight of 2026-04-10 and
Region Gotland's 0.25 m summer 2022 capture. Measured against the seventeen
mapped decks the summer frame looks far the better instrument -- every deck
greener than its own collar and 4.7x smoother, against 16 of 17 and 13 of 17 on
the April one. That comparison is worthless: the mapped decks were TRACED on
the Gotland 2022 image, so it is being asked to reproduce itself. The April
flight is the independent record, and 16 of 17 and 13 of 17 across a different
sensor, season and year is the real corroboration. So the reading runs on the
April frame and the summer frame is a second opinion, never the ruler.

WHAT DOES NOT WORK HERE, measured. An absolute colour cut is useless on this
links: a threshold keeping 90% of the mapped mown turf keeps 51% of everything
else, because in April the fescue rough greens up with the fairway. The
Ribbingsfors rule -- a tee deck is laser-flat -- says nothing on Kronholmen:
35% of the played box is flatter than 0.10 m over 5 m, so flatness cannot
detect a deck here and is carried only as a corroboration a reading may have or
lack. And a WHOLE-CORRIDOR component sweep was tried first and abandoned: it
recovered four of eleven mapped decks and its output moved wholesale when the
greenness cut moved by one unit, because on a par 3 the tee, the fairway and
the green are one mown component.

WHAT DOES WORK is the repo's own green-tracer shape: put the hypothesis where
the CARD puts it -- arc length `route - cardMetres` along the hole's observed
line, extrapolated behind its start for a back tee -- and grow a region there
under several loose-to-tight readings, keeping the largest that stays compact.
The card distance is not evidence of a platform; it is where to look. What is
measured is whether a compact mown deck stands there, and the acceptance bar is
calibrated on the seventeen mapped decks and nothing else.

WHAT IT WRITES. `tee-decks.json`: per hole and per numbered tee, either an
accepted reading with its outline and every measurement behind it, or a refusal
with its reason. Nothing enters the model here; adopting a reading is a
separate, reviewed step.

  python3 visbybuild/mapping/trace-tees.py [--holes 1,2,3] [--calibrate]
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import ortho_read as O                                          # noqa: E402

HERE = os.path.dirname(__file__)
METRES = 0.5                     # a deck is 8-30 m; half-metre pixels are ample
SEARCH = 26.0                    # how far from the card's own point to look
AREA = (30.0, 700.0)             # m^2; the mapped decks run 42-252
COLLAR = 14.0                    # metres: the ground a deck is judged against
READINGS = (2.0, 3.0, 4.0, 5.5, 7.0, 9.0)   # loose to tight, greenness over collar
MIN_RECTANGULARITY = 0.60
MAX_SMOOTHNESS_RATIO = 1.00
MIN_D_EXG = 4.0


# ---------------------------------------------------------------- geometry ---

def polyline_length(line):
    return sum(math.dist(line[index], line[index + 1]) for index in range(len(line) - 1))


def point_at(line, arc):
    """The point at arc length `arc`, extrapolated past both ends along the
    first and last segments -- a back tee stands behind the line's own start,
    which is exactly the quantity being measured."""
    travelled = 0.0
    for index in range(len(line) - 1):
        ax, az = line[index]; bx, bz = line[index + 1]
        length = math.dist((ax, az), (bx, bz))
        if length == 0: continue
        first, last = index == 0, index == len(line) - 2
        if (first and arc < 0) or (last and arc > travelled + length) or travelled <= arc <= travelled + length:
            t = (arc - travelled) / length
            return (ax + t * (bx - ax), az + t * (bz - az))
        travelled += length
    return line[-1]


def arc_of(line, point):
    best = None
    travelled = 0.0
    for index in range(len(line) - 1):
        ax, az = line[index]; bx, bz = line[index + 1]
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz)
        if length == 0: continue
        t = ((point[0] - ax) * dx + (point[1] - az) * dz) / (length * length)
        first, last = index == 0, index == len(line) - 2
        clamped = t if (first and t < 0) or (last and t > 1) else min(1.0, max(0.0, t))
        offset = math.dist(point, (ax + clamped * dx, az + clamped * dz))
        if best is None or offset < best[1]:
            best = (travelled + clamped * length, offset)
        travelled += length
    return best


def min_area_rect(points):
    """Rotating callipers over the convex hull; returns (area, long, short)."""
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3: return (0.0, 0.0, 0.0)
    def half(seq):
        out = []
        for p in seq:
            while len(out) >= 2 and ((out[-1][0] - out[-2][0]) * (p[1] - out[-2][1])
                                     - (out[-1][1] - out[-2][1]) * (p[0] - out[-2][0])) <= 0:
                out.pop()
            out.append(p)
        return out
    hull = half(pts)[:-1] + half(pts[::-1])[:-1]
    best = None
    for index in range(len(hull)):
        ax, az = hull[index]; bx, bz = hull[(index + 1) % len(hull)]
        length = math.hypot(bx - ax, bz - az)
        if length == 0: continue
        ux, uz = (bx - ax) / length, (bz - az) / length
        us = [(x - ax) * ux + (z - az) * uz for x, z in hull]
        vs = [-(x - ax) * uz + (z - az) * ux for x, z in hull]
        side_a, side_b = max(us) - min(us), max(vs) - min(vs)
        if best is None or side_a * side_b < best[0]:
            best = (side_a * side_b, max(side_a, side_b), min(side_a, side_b))
    return best or (0.0, 0.0, 0.0)


def outline(cells, affine):
    """The component's own pixel boundary as a local-metre ring, so the ring is
    exactly the set that was measured."""
    have = set(cells)
    edges = {}
    for r, c in cells:
        for dr, dc, a, b in ((-1, 0, (r, c), (r, c + 1)), (1, 0, (r + 1, c + 1), (r + 1, c)),
                             (0, -1, (r + 1, c), (r, c)), (0, 1, (r, c + 1), (r + 1, c + 1))):
            if (r + dr, c + dc) not in have:
                edges.setdefault(a, []).append(b)
    start = min(edges)
    ring, node = [start], start
    while node in edges and edges[node]:
        nxt = edges[node].pop()
        if not edges[node]: del edges[node]
        if nxt == start: break
        ring.append(nxt); node = nxt
    return [list(O.to_local(affine, c, r)) for r, c in ring]


def simplify(ring, tolerance=0.9):
    if len(ring) < 4: return ring
    def walk(points):
        if len(points) < 3: return points
        ax, az = points[0]; bx, bz = points[-1]
        length = math.hypot(bx - ax, bz - az)
        worst, index = -1.0, 0
        for i in range(1, len(points) - 1):
            x, z = points[i]
            d = (abs((bx - ax) * (az - z) - (ax - x) * (bz - az)) / length if length
                 else math.dist(points[i], points[0]))
            if d > worst: worst, index = d, i
        if worst <= tolerance: return [points[0], points[-1]]
        return walk(points[:index + 1])[:-1] + walk(points[index:])
    return walk(list(ring) + [ring[0]])[:-1]


# ------------------------------------------------------------------ reading ---

def box_median(values, radius, block=8):
    """A local background over several metres, cheaply.

    An exact sliding median over a 57 x 57 window on a 1,800 x 1,800 frame
    materialises forty gigabytes and never returns -- that was measured. Block
    the frame down first, take the window median on the small array and lift it
    back: a fourteen-metre background does not need half-metre detail. A
    median, not a mean, because the bright sand and gravel a tee deck sits
    among would drag a mean straight through the threshold."""
    rows, cols = values.shape
    padded = np.pad(values, ((0, (-rows) % block), (0, (-cols) % block)), mode='edge')
    small = np.median(padded.reshape(padded.shape[0] // block, block,
                                     padded.shape[1] // block, block), axis=(1, 3))
    reach = max(1, int(round(radius / block)))
    from numpy.lib.stride_tricks import sliding_window_view
    windows = sliding_window_view(np.pad(small, reach, mode='edge'), (2 * reach + 1, 2 * reach + 1))
    smoothed = np.median(windows.reshape(small.shape[0], small.shape[1], -1), axis=2)
    return np.repeat(np.repeat(smoothed, block, axis=0), block, axis=1)[:rows, :cols]


def grow(mask, seed):
    """Four-connected flood from one seed."""
    rows, cols = mask.shape
    r0, c0 = seed
    if not (0 <= r0 < rows and 0 <= c0 < cols and mask[r0, c0]): return []
    seen = np.zeros(mask.shape, bool)
    seen[r0, c0] = True
    stack, cells = [(r0, c0)], []
    while stack:
        r, c = stack.pop()
        cells.append((r, c))
        if len(cells) > 40000: return cells
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and mask[nr, nc] and not seen[nr, nc]:
                seen[nr, nc] = True
                stack.append((nr, nc))
    return cells


class Frame:
    """One orthophoto window with the two local fields a deck is judged by."""

    def __init__(self, cx, cz, size, layer='lm016'):
        self.image, self.affine = O.window(cx, cz, size, layer, METRES)
        r, g, b = (self.image[..., i].astype(np.float32) for i in range(3))
        exg = 2 * g - r - b
        lum = (r + g + b) / 3.0
        reach = int(round(COLLAR / METRES))
        self.greener = exg - box_median(exg, reach)
        rough = np.abs(lum - box_median(lum, 2))
        self.texture = box_median(rough, reach)
        self.smooth = box_median(rough, 2)

    def read(self, target, radius=SEARCH):
        """The largest compact mown patch within `radius` of `target`.

        Loose to tight: a loose reading leaks into the fairway a tee sits on, a
        tight one erodes the deck to nothing, and which is which differs hole
        by hole -- so take every reading and keep the largest that is still
        compact, which is the rule the green tracer here already uses."""
        seeds = []
        span = int(round(radius / METRES))
        for dr in range(-span, span + 1, max(1, int(round(3.0 / METRES)))):
            for dc in range(-span, span + 1, max(1, int(round(3.0 / METRES)))):
                if dr * dr + dc * dc <= span * span:
                    seeds.append((dr, dc))
        base = O.to_pixel(self.affine, *target)
        origin = (int(round(base[1])), int(round(base[0])))
        best = None
        for cut in READINGS:
            mask = (self.greener >= cut) & (self.smooth <= MAX_SMOOTHNESS_RATIO * self.texture)
            tried = set()
            for dr, dc in seeds:
                cell = (origin[0] + dr, origin[1] + dc)
                if cell in tried: continue
                cells = grow(mask, cell)
                tried.update(cells)
                if not cells: continue
                area = len(cells) * METRES * METRES
                if not (AREA[0] <= area <= AREA[1]): continue
                pts = [O.to_local(self.affine, c + 0.5, r + 0.5) for r, c in cells]
                rect_area, rect_long, rect_short = min_area_rect(pts)
                if rect_area <= 0: continue
                rectangularity = area / rect_area
                if rectangularity < MIN_RECTANGULARITY or rect_short < 4.0 or rect_long > 55.0: continue
                mx = float(np.mean([p[0] for p in pts])); mz = float(np.mean([p[1] for p in pts]))
                if math.dist((mx, mz), target) > radius: continue
                index = np.array(cells)
                d_exg = float(np.median(self.greener[index[:, 0], index[:, 1]]))
                if d_exg < MIN_D_EXG: continue
                ratio = float(np.median(self.smooth[index[:, 0], index[:, 1]])
                              / max(1e-6, np.median(self.texture[index[:, 0], index[:, 1]])))
                reading = {
                    'centre': [round(mx, 2), round(mz, 2)], 'areaSquareMetres': round(area, 1),
                    'sizeMetres': [round(rect_long, 1), round(rect_short, 1)],
                    'rectangularity': round(rectangularity, 3),
                    'greennessOverCollar': round(d_exg, 1), 'smoothnessRatio': round(ratio, 3),
                    'readingCut': cut, 'metresFromCardPoint': round(math.dist((mx, mz), target), 1),
                    'ring': [[round(x, 2), round(z, 2)] for x, z in simplify(outline(cells, self.affine))],
                }
                if best is None or area > best['areaSquareMetres']:
                    best = reading
        return best


# -------------------------------------------------------------------- main ---

def main(argv):
    model = json.load(open(os.path.join(HERE, '..', 'course-model.json')))
    header = json.load(open(os.path.join(HERE, '..', 'cache', 'dtm', 'dtm-1m.json')))
    dtm = np.fromfile(os.path.join(HERE, '..', 'cache', 'dtm', 'dtm-1m.f32'),
                      dtype=np.float32).reshape(header['rows'], header['cols'])
    only = {int(n) for n in argv[argv.index('--holes') + 1].split(',')} if '--holes' in argv else None

    def flatness(cx, cz, half=3):
        col = int(round(cx - header['x0'])); row = int(round(cz - header['z0']))
        window = dtm[max(0, row - half):row + half + 1, max(0, col - half):col + half + 1]
        return round(float(np.nanmax(window) - np.nanmin(window)), 3) if window.size else None

    report = {
        'method': ('numbered tee decks read at the card\'s own distance along each observed route, '
                   'on the independent 2026 national flight'),
        'capture': {
            'detector': 'lm016, Lantmateriet 0.16 m national orthophoto 2026-04-10, read at 0.5 m',
            'secondOpinion': 'gotland, Region Gotland 0.25 m summer 2022',
            'note': ('the mapped decks were traced ON the Gotland 2022 image, so its agreement with them '
                     'is self-agreement; the April flight is the independent record'),
        },
        'rules': {
            'hypothesis': ("the model's own derivation: the back tee on the observed platform, each shorter tee "
                           "walked up the observed route by the card's difference from the back tee"),
            'searchRadiusMetres': SEARCH, 'areaSquareMetresRange': list(AREA),
            'collarMetres': COLLAR, 'readingCuts': list(READINGS),
            'minRectangularity': MIN_RECTANGULARITY, 'minGreennessOverCollar': MIN_D_EXG,
            'maxSmoothnessRatio': MAX_SMOOTHNESS_RATIO,
            'flatnessIsCorroborationOnly': ('35% of the played box is flatter than 0.10 m over 5 m, so a '
                                            'flatness test cannot detect a deck on this links'),
        },
        'calibration': [], 'holes': [],
    }

    # calibrate: can the reading recover the seventeen MAPPED decks from their
    # own centres, on a capture they were not traced from?
    for hole in model['holes']:
        if only and hole['n'] not in only: continue
        for pad in hole['tees']['pads']:
            ring = pad['ring']
            cx = sum(p[0] for p in ring) / len(ring); cz = sum(p[1] for p in ring) / len(ring)
            frame = Frame(cx, cz, 140)
            reading = frame.read((cx, cz), 12.0)
            mapped_area = abs(sum(ring[i][0] * ring[(i + 1) % len(ring)][1]
                                  - ring[(i + 1) % len(ring)][0] * ring[i][1]
                                  for i in range(len(ring)))) / 2
            report['calibration'].append({
                'hole': hole['n'], 'mappedAreaSquareMetres': round(mapped_area, 1),
                'recovered': reading is not None,
                'centreDeltaMetres': reading['metresFromCardPoint'] if reading else None,
                'areaRatio': round(reading['areaSquareMetres'] / mapped_area, 2) if reading else None,
                'greennessOverCollar': reading['greennessOverCollar'] if reading else None,
            })
            print(f"  calib h{hole['n']:2d} "
                  f"{'recovered %5.1f m, area x%.2f' % (reading['metresFromCardPoint'], reading['areaSquareMetres'] / mapped_area) if reading else 'NOT recovered'}")

    for hole in model['holes']:
        if only and hole['n'] not in only: continue
        line = [tuple(point) for point in hole['line']]
        length = polyline_length(line)
        # the hypothesis is exactly what the model derives, so this corroborates
        # what ships rather than a second, differently-derived point: the back
        # tee sits on the observed platform and each shorter tee walks up the
        # observed route by the card's own difference from it
        pads = hole['tees']['pads']
        if pads:
            centres = [(sum(p[0] for p in pad['ring']) / len(pad['ring']),
                        sum(p[1] for p in pad['ring']) / len(pad['ring'])) for pad in pads]
            anchor = min(centres, key=lambda c: math.dist(c, line[0]))
        else:
            anchor = tuple(hole['tees']['marks'][0]['c'])
        anchor_arc = arc_of(line, anchor)[0]
        walk_limit = max(0.0, length - anchor_arc - 20.0)
        targets = []
        for tee in hole['t']:
            forward = hole['t'][0] - tee
            targets.append(anchor if forward <= 0 or forward > walk_limit
                           else point_at(line, anchor_arc + forward))
        xs = [p[0] for p in targets]; zs = [p[1] for p in targets]
        cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
        size = min(900, max(max(xs) - min(xs), max(zs) - min(zs)) + 4 * SEARCH + 4 * COLLAR)
        frame = Frame(cx, cz, size)
        tees, taken = [], []
        for index, tee in enumerate(hole['t']):
            target = targets[index]
            reading = frame.read(target)
            if reading:
                # two numbered tees on one deck is real (a long deck carries
                # several markers); two numbered tees on one READING is not a
                # second measurement, and is recorded as the shared deck it is
                shared = next((other for other in taken
                               if math.dist(other['centre'], reading['centre']) < 3.0), None)
                reading['sharesDeckWithTeeIndex'] = shared['teeIndex'] if shared else None
                reading['flatness5mMetres'] = flatness(*reading['centre'])
                arc, offset = arc_of(line, tuple(reading['centre']))
                reading['distanceToGreenMetres'] = round(length - arc, 1)
                reading['lateralMetres'] = round(offset, 1)
                reading['teeIndex'] = index
                taken.append(reading)
            tees.append({
                'teeIndex': index, 'cardMetres': tee,
                'cardPoint': [round(target[0], 2), round(target[1], 2)],
                'reading': reading,
                'refusal': None if reading else 'no compact mown deck within %.0f m of the card point' % SEARCH,
            })
        read = sum(1 for tee in tees if tee['reading'])
        distinct = len({tuple(tee['reading']['centre']) for tee in tees if tee['reading']})
        report['holes'].append({'hole': hole['n'], 'par': hole['par'], 'card': hole['t'],
                                'lineLengthMetres': round(length, 1), 'tees': tees,
                                'teesRead': read, 'distinctDecks': distinct})
        print(f"h{hole['n']:2d} par{hole['par']} read={read}/6 distinct={distinct}")

    recovered = sum(1 for row in report['calibration'] if row['recovered'])
    report['selfScore'] = {
        'mappedDecksRecovered': recovered, 'mappedDecksSought': len(report['calibration']),
        'meaning': ('the mapped decks were traced on the 2022 summer capture, so recovering them on the '
                    '2026 April flight is a cross-capture test of the reading, not of the trace'),
        'teesRead': sum(hole['teesRead'] for hole in report['holes']),
        'teesSought': 6 * len(report['holes']),
        'distinctDecks': sum(hole['distinctDecks'] for hole in report['holes']),
    }
    out = os.path.join(HERE, 'tee-decks.json')
    json.dump(report, open(out, 'w'), indent=1)
    print(f"\nrecovered {recovered}/{len(report['calibration'])} mapped decks; "
          f"read {report['selfScore']['teesRead']}/{report['selfScore']['teesSought']} numbered tees "
          f"on {report['selfScore']['distinctDecks']} distinct decks\n{out}")


if __name__ == '__main__':
    main(sys.argv[1:])
