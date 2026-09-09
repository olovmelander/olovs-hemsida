"""Convert explicitly reviewed panel pixel boundaries into course coordinates.

The input contains manual decisions, never automatic image classification.
Usage: python geobuild/mapping/trace-ortho-review.py decisions.json --out review.json

A fairway decision may use parts: [{panel, pixels, report?}, ...] to replace
all rings from separate reviewed panels. Every part retains its source hashes,
pixel-edge affine and pixel ring; single-ring decisions remain supported.
Tee-set decisions use pads: [{id, panel, pixels, note?, report?}, ...] and
optional referencePads. A retained historical pad instead supplies
retainedOriginalPadIndex, panel, note, uncertaintyM (at least 3 metres).
"""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

from pyproj import Transformer


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('decisions', type=Path)
    parser.add_argument('--model', type=Path, default=Path('geobuild/course-model.json'))
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    decisions = json.loads(args.decisions.read_text(encoding='utf-8'))
    model = json.loads(args.model.read_text(encoding='utf-8'))
    frame = {key: model[key] for key in ['origin', 'mPerLat', 'mPerLon']}
    inverse = Transformer.from_crs(3006, 4326, always_xy=True)
    def read_panel(part, default_report):
        report_path = Path(part.get('report', default_report))
        report = json.loads(report_path.read_text(encoding='utf-8'))
        if report['frame'] != frame:
            raise ValueError('Panel/model frames differ')
        panel = next(p for p in report['panels'] if p['id'] == part['panel'])
        plain = Path(panel['plainPath'])
        expected_hash = panel.get('plainSha256')
        if expected_hash and sha(plain) != expected_hash:
            raise ValueError('Reviewed panel bytes changed')
        return panel, plain

    def trace_part(part, default_report):
        panel, plain = read_panel(part, default_report)
        west, south, east, north = panel['extentEPSG3006']
        width, height = panel['pixelSize']
        pixels = part['pixels']
        if len(pixels) < 3 or any(not (0 <= x <= width and 0 <= y <= height) for x, y in pixels):
            raise ValueError('Boundary is outside reviewed panel')
        projected = [[west + x * (east - west) / width,
                      north - y * (north - south) / height] for x, y in pixels]
        ring = []
        for easting, northing in projected:
            lon, lat = inverse.transform(easting, northing)
            ring.append([round((lon - frame['origin']['lon']) * frame['mPerLon'], 2),
                         round((frame['origin']['lat'] - lat) * frame['mPerLat'], 2)])
        return ring, {
            'panel': panel['id'], 'sourceFiles': panel['sources'],
            'sourcePixelRing': pixels, 'sourceRingEPSG3006': projected,
            'panelExtent': panel['extentEPSG3006'], 'panelPixelSize': panel['pixelSize'],
            'panelGeoTransform': panel['geoTransform'], 'panelImageSha256': sha(plain),
        }

    features = []
    for decision in decisions['features']:
        default_report = decision.get('report', decisions.get('report', ''))
        kind = decision['kind']
        hole = next(h for h in model['holes'] if h['n'] == decision['hole'])
        parts = decision['pads'] if kind == 'tee-set' else decision.get('parts', [decision])
        if not parts or ('parts' in decision and decision['kind'] != 'fairway'):
            raise ValueError('Nonempty parts are supported only for full fairway replacement')
        traced = []
        for part in parts:
            if kind == 'tee-set' and 'retainedOriginalPadIndex' in part:
                old = hole['tees']['pads'][part['retainedOriginalPadIndex']]
                if old.get('prov') == 'synth' or not part.get('note') or part.get('uncertaintyM', 0) < 3:
                    raise ValueError('Historical retention excludes synthetic pads and requires a note and uncertainty of at least 3 metres')
                panel, plain = read_panel(part, default_report)
                traced.append((old['ring'], {
                    'panel': panel['id'], 'sourceFiles': panel['sources'],
                    'panelExtent': panel['extentEPSG3006'], 'panelPixelSize': panel['pixelSize'],
                    'panelGeoTransform': panel['geoTransform'], 'panelImageSha256': sha(plain),
                    'retainedOriginalPadIndex': part['retainedOriginalPadIndex'],
                    'retainedHistorical': True, 'note': part['note'],
                    'uncertaintyM': part['uncertaintyM'],
                    'acceptance': 'Historical boundary retained unchanged; orthophoto does not resolve the obscured perimeter',
                }))
            else:
                traced.append(trace_part(part, default_report))
        rings = [ring for ring, _ in traced]
        first_evidence = traced[0][1]
        source_files = list({(source['path'], source['sha256']): source
                             for _, evidence in traced for source in evidence['sourceFiles']}.values())
        if kind == 'green':
            original = hole['green']['ring']
        elif kind == 'bunker':
            if decision.get('action') == 'add':
                if decision['index'] != len(hole['bunkers']):
                    raise ValueError('New bunker must occupy the next empty slot')
                original = None
            else:
                original = hole['bunkers'][decision['index']]['ring']
        elif kind == 'tee':
            original = hole['tees']['pads'][decision['index']]['ring']
        elif kind == 'tee-set':
            original = [pad['ring'] for pad in hole['tees']['pads']]
        elif kind == 'fairway':
            original = hole['fairway']['rings']
        else:
            raise ValueError('Unsupported boundary class')
        # Use the consumer's JSON number serialization (e.g. 500.0 becomes 500).
        original_sha = subprocess.run([
            'node', '-e', "const fs=require('node:fs'),c=require('node:crypto');"
            "process.stdout.write(c.createHash('sha256').update(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')))).digest('hex'));"
        ], input=json.dumps(original), text=True, capture_output=True, check=True).stdout
        feature = {key: decision[key] for key in ['id', 'hole', 'kind', 'index', 'action', 'referencePads'] if key in decision}
        if kind == 'tee-set':
            pads = []
            for part, (ring, evidence) in zip(parts, traced):
                pad = {key: part[key] for key in ['id', 'note'] if key in part}
                pad['ring'] = ring
                if evidence.get('retainedHistorical'):
                    old = hole['tees']['pads'][part['retainedOriginalPadIndex']]
                    pad.update(retainedHistorical=True, prov=old.get('prov'), sourceId=old.get('id'),
                               boundaryInterpretationUncertaintyMetres=part['uncertaintyM'])
                pads.append(pad)
            geometry = {'pads': pads}
        else:
            geometry = {'rings': rings} if kind == 'fairway' else {'ring': rings[0]}
        feature.update(status='accepted', originalRingSha256=original_sha,
                       **geometry,
                       evidence={
                           **first_evidence,
                           'source': 'Lantmateriet Ortofoto Nedladdning, orto-u2-2024',
                           'sourceFiles': source_files,
                           'sourceCaptureDates': ['2024-06-27'],
                           'uncertaintyM': decision['uncertaintyM'],
                           'note': decision['note'],
                           'pixelConvention': 'pixel edges; E=west+x*widthMetres/pixelsWide; N=north-y*heightMetres/pixelsHigh',
                           'projection': 'pyproj EPSG:3006 to EPSG:4326, then declared legacy frame; no fitted offset',
                           'acceptance': 'manual visible-boundary interpretation; no positional survey accuracy claim',
                       })
        if 'parts' in decision or kind == 'tee-set':
            feature['evidence']['sourcePanels'] = [evidence for _, evidence in traced]
            feature['evidence']['sourcePixelRings'] = [evidence.get('sourcePixelRing') for _, evidence in traced]
            feature['evidence']['sourceRingsEPSG3006'] = [evidence.get('sourceRingEPSG3006') for _, evidence in traced]
        features.append(feature)
    result = dict(schemaVersion=1, groundId='veckefjarden', frame=frame,
                  reviewedOn='2026-09-09', features=features)
    for policy in ['reviewedTeeHoles', 'suppressInferredTeeHoles']:
        if policy in decisions:
            result[policy] = decisions[policy]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
    print(f'{args.out}: {len(features)} explicitly reviewed boundaries')


if __name__ == '__main__':
    main()
