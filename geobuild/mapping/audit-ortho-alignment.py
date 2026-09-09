#!/usr/bin/env python3
"""Independently audit the adopted Veckefjarden source-to-model evidence chain.

python geobuild/mapping/audit-ortho-alignment.py
Reads the baseline from Git, actual local TIFF/PNG bytes, the canonical review
ledger, and the rebuilt model. Only the numerical audit report is written.
Any source, affine, local-vector, baseline, or adopted-model mismatch fails.
This verifies registration and explicit adoption, not source survey accuracy.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image
from pyproj import Transformer
import rasterio
from rasterio.enums import ColorInterp, Resampling
from rasterio.transform import Affine
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    if Path(path).suffix.lower() == '.json':
        # Match repository manifest metadata hashing across Windows/Linux.
        return hashlib.sha256(Path(path).read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    with Path(path).open('rb') as handle:
        return hashlib.file_digest(handle, 'sha256').hexdigest()


def relative(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def local_path(value):
    path = Path(value)
    return (path if path.is_absolute() else ROOT / path).resolve()


def js_hashes(values):
    command = "const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')).map(v=>c.createHash('sha256').update(JSON.stringify(v)).digest('hex'))));"
    result = subprocess.run(['node', '-e', command], input=json.dumps(values), text=True, capture_output=True, check=True, cwd=ROOT)
    return json.loads(result.stdout)


def rings_for(feature):
    if feature['kind'] == 'tee-set':
        return [pad['ring'] for pad in feature['pads']]
    return feature['rings'] if feature['kind'] == 'fairway' else [feature['ring']]


def stored(hole, feature):
    kind = feature['kind']
    if kind == 'green':
        return hole['green']['ring']
    if kind == 'fairway':
        return hole['fairway']['rings']
    if kind == 'tee-set':
        return [p['ring'] for p in hole['tees']['pads']]
    collection = hole['bunkers'] if kind == 'bunker' else hole['tees']['pads']
    return collection[feature['index']]['ring'] if feature['index'] < len(collection) else None


def area_centroid(rings):
    total, weighted = 0., np.zeros(2)
    for ring in rings:
        p = np.asarray(ring, dtype=float)
        following = np.roll(p, -1, axis=0)
        cross = p[:, 0] * following[:, 1] - following[:, 0] * p[:, 1]
        signed = float(cross.sum()) / 2
        if abs(signed) < 1e-9:
            continue
        centre = ((p + following) * cross[:, None]).sum(axis=0) / (6 * signed)
        total += abs(signed)
        weighted += abs(signed) * centre
    return total, weighted / total if total else None


def inside(point, ring):
    x, y = point
    hit = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]:
            hit = not hit
    return hit


class Audit:
    def __init__(self):
        self.errors = []
        self.sources = {}
        self.panels = {}
        self.panel_index = {}
        for file in sorted((ROOT / 'geobuild/cache').glob('lm-*/panels.json')):
            report = json.loads(file.read_text(encoding='utf-8'))
            for panel in report.get('panels', []):
                self.panel_index.setdefault(panel.get('plainSha256'), []).append((file, panel))

    def require(self, condition, message):
        if not condition:
            self.errors.append(message)
        return bool(condition)

    def source(self, record):
        path = local_path(record['path'])
        key = relative(path)
        if key not in self.sources:
            actual = digest(path)
            with rasterio.open(path) as raster:
                result = dict(path=key, sha256=actual, bytes=path.stat().st_size,
                              crs=str(raster.crs), width=raster.width, height=raster.height,
                              geoTransform=list(raster.transform.to_gdal()), boundsEPSG3006=list(raster.bounds),
                              bandCount=raster.count, dtypes=list(raster.dtypes))
                self.require(raster.crs.to_epsg() == 3006 and raster.count == 4 and raster.dtypes == ('uint8',) * 4,
                             key + ': actual raster is not native EPSG:3006 four-band uint8')
                self.require(np.allclose([raster.transform.a,raster.transform.b,raster.transform.d,raster.transform.e],
                                         [.16,0,0,-.16], rtol=0, atol=1e-10), key + ': actual native affine differs')
            self.sources[key] = result
        result = self.sources[key]
        self.require(result['sha256'] == record['sha256'], key + ': source SHA-256 mismatch')
        self.require(np.allclose(result['geoTransform'], record['geoTransform'], rtol=0, atol=1e-8), key + ': source affine metadata mismatch')
        self.require(result['width'] == record['width'] and result['height'] == record['height'], key + ': source dimensions mismatch')
        return path

    def panel(self, evidence):
        expected = evidence['panelImageSha256']
        for source in evidence['sourceFiles']:
            self.source(source)
        if expected not in self.panels:
            candidates = self.panel_index.get(expected, [])
            selected = next(((file,panel) for file,panel in candidates if local_path(panel['plainPath']).exists()
                             and digest(local_path(panel['plainPath'])) == expected), None)
            if not self.require(selected is not None, expected + ': reviewed panel bytes missing or changed'):
                return
            file, panel = selected
            path = local_path(panel['plainPath'])
            with Image.open(path) as image:
                pixels = np.asarray(image.convert('RGB'))
                size = image.size
            width, height = evidence['panelPixelSize']
            west, south, east, north = evidence['panelExtent']
            gt = evidence['panelGeoTransform']
            expected_gt = [west,(east-west)/width,0,north,0,-(north-south)/height]
            self.require(list(size) == [width,height], expected + ': panel image dimensions mismatch')
            self.require(np.allclose(gt, expected_gt, rtol=0, atol=1e-8), expected + ': pixel-edge affine mismatch')
            self.require(np.allclose(panel['geoTransform'], gt, rtol=0, atol=1e-8), expected + ': panel report affine mismatch')
            world = [float(v) for v in path.with_suffix('.pgw').read_text().splitlines()]
            self.require(np.allclose(world, [gt[1],gt[4],gt[2],gt[5],gt[0]+gt[1]/2,gt[3]+gt[5]/2], rtol=0, atol=1e-8),
                         expected + ': PNG world file is not at pixel centres')
            crs = rasterio.crs.CRS.from_wkt(path.with_suffix('.prj').read_text())
            self.require(crs.to_epsg() == 3006, expected + ': PNG projection is not EPSG:3006')
            # Recompute sample values from actual TIFF bytes. Do not import the
            # rendering implementation or trust its recorded validation flag.
            positions = [(row,col) for row in [0,height//2,height-1] for col in [0,width//2,width-1]]
            reconstructed = [None] * len(positions)
            transform = Affine.from_gdal(*gt)
            for source in evidence['sourceFiles']:
                with rasterio.open(local_path(source['path'])) as src, WarpedVRT(src, crs=3006, transform=transform,
                         width=width, height=height, resampling=Resampling.bilinear,
                         add_alpha=ColorInterp.alpha not in src.colorinterp) as vrt:
                    for i,(row,col) in enumerate(positions):
                        window = Window(col,row,1,1)
                        if vrt.dataset_mask(window=window)[0,0] > 0:
                            reconstructed[i] = vrt.read([1,2,3], window=window)[:,0,0]
            maximum = 0
            for (row,col), actual in zip(positions,reconstructed):
                self.require(actual is not None, expected + ': panel sample lacks a source pixel')
                if actual is not None:
                    maximum = max(maximum,int(np.abs(actual.astype(int)-pixels[row,col].astype(int)).max()))
            self.require(maximum == 0, expected + ': source-to-panel RGB sample mismatch')
            self.panels[expected] = dict(path=relative(path), sha256=expected, reportPath=relative(file),
                                        pixelSize=[width,height], geoTransform=gt, rgbSamplesCompared=len(positions),
                                        maximumRgbChannelDifference=maximum)
        else:
            self.require(np.allclose(self.panels[expected]['geoTransform'], evidence['panelGeoTransform'], rtol=0, atol=1e-8),
                         expected + ': reused panel has inconsistent affine evidence')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ledger', type=Path, default=ROOT/'geobuild/mapping/lm-ortho-review.json')
    parser.add_argument('--model', type=Path, default=ROOT/'geobuild/course-model.json')
    parser.add_argument('--baseline-ref', default='HEAD')
    parser.add_argument('--out', type=Path, default=ROOT/'geo_data/course-v2/veckefjarden/acquisition/ortho-alignment-audit.json')
    args = parser.parse_args()
    baseline_bytes = subprocess.run(['git','show',args.baseline_ref+':geobuild/course-model.json'], cwd=ROOT, check=True, capture_output=True).stdout
    baseline_commit = subprocess.run(['git','rev-parse',args.baseline_ref], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    baseline = json.loads(baseline_bytes)
    model = json.loads(args.model.read_text(encoding='utf-8'))
    ledger = json.loads(args.ledger.read_text(encoding='utf-8'))
    audit = Audit()
    frame = {key:model[key] for key in ['origin','mPerLat','mPerLon']}
    audit.require(frame == ledger['frame'] == {key:baseline[key] for key in frame}, 'Model/ledger/baseline coordinate frames differ')
    original_holes = {h['n']:h for h in baseline['holes']}
    actual_holes = {h['n']:h for h in model['holes']}
    inverse = Transformer.from_crs(3006,4326,always_xy=True)
    forward = Transformer.from_crs(4326,3006,always_xy=True)
    features = ledger['features']
    original_geometries = [None if f.get('action') == 'add' else stored(original_holes[f['hole']],f) for f in features]
    original_hashes = js_hashes(original_geometries)
    records = []
    for feature,original,original_hash in zip(features,original_geometries,original_hashes):
        error_start = len(audit.errors)
        feature_id,kind = feature['id'],feature['kind']
        audit.require(feature['status'] == 'accepted', feature_id + ': feature is not accepted')
        audit.require(original_hash == feature['originalRingSha256'], feature_id + ': reviewed baseline geometry differs from Git baseline')
        rings = rings_for(feature)
        expected_model_geometry = rings if kind in ['fairway','tee-set'] else rings[0]
        audit.require(stored(actual_holes[feature['hole']],feature) == expected_model_geometry, feature_id + ': actual model vertices differ from accepted ledger')
        parts = feature['evidence'].get('sourcePanels',[feature['evidence']])
        audit.require(len(parts) == len(rings), feature_id + ': source part count does not match adopted ring count')
        checked_vertices, retained = 0, 0
        max_affine,max_roundtrip,max_quantized = 0.,0.,0.
        for ring,part in zip(rings,parts):
            audit.panel(part)
            if part.get('retainedHistorical'):
                retained += 1
                old_pad = original_holes[feature['hole']]['tees']['pads'][part['retainedOriginalPadIndex']]
                audit.require(ring == old_pad['ring'], feature_id + ': retained historical perimeter was changed')
                audit.require(part.get('uncertaintyM',0) >= 3 and bool(part.get('note')), feature_id + ': retained historical perimeter needs its unresolved-boundary note')
                continue
            pixels = np.asarray(part['sourcePixelRing'], dtype=float)
            gt = part['panelGeoTransform']
            projected = np.column_stack((gt[0]+pixels[:,0]*gt[1]+pixels[:,1]*gt[2], gt[3]+pixels[:,0]*gt[4]+pixels[:,1]*gt[5]))
            provided = np.asarray(part['sourceRingEPSG3006'], dtype=float)
            if not audit.require(projected.shape == provided.shape == np.asarray(ring).shape, feature_id + ': source/local vertex counts differ'):
                continue
            affine_error = float(np.linalg.norm(projected-provided,axis=1).max())
            max_affine = max(max_affine,affine_error)
            audit.require(affine_error < 1e-7, feature_id + ': pixel-edge affine does not reproduce recorded projected vertices')
            lon,lat = inverse.transform(projected[:,0],projected[:,1])
            x,z = (lon-frame['origin']['lon'])*frame['mPerLon'],(frame['origin']['lat']-lat)*frame['mPerLat']
            expected = [[round(float(a),2),round(float(b),2)] for a,b in zip(x,z)]
            audit.require(np.allclose(ring,expected,rtol=0,atol=1e-9), feature_id + ': adopted local vertices do not equal the quantized source transformation')
            re, rn = forward.transform(lon,lat)
            max_roundtrip = max(max_roundtrip,float(np.linalg.norm(np.column_stack((re,rn))-projected,axis=1).max()))
            local = np.asarray(ring)
            qe,qn = forward.transform(frame['origin']['lon']+local[:,0]/frame['mPerLon'],frame['origin']['lat']-local[:,1]/frame['mPerLat'])
            error = float(np.linalg.norm(np.column_stack((qe,qn))-projected,axis=1).max())
            max_quantized = max(max_quantized,error)
            audit.require(error < .02, feature_id + ': local-vector roundtrip error exceeds 2 cm quantization allowance')
            checked_vertices += len(ring)
        before_rings = [] if original is None else original if kind in ['fairway','tee-set'] else [original]
        old_area,old_centre = area_centroid(before_rings)
        new_area,new_centre = area_centroid(rings)
        records.append(dict(id=feature_id,hole=feature['hole'],kind=kind,action=feature.get('action','replace'),
                            state='passed' if len(audit.errors)==error_start else 'failed',
                            originalRingSha256=original_hash,adoptedRings=len(rings),sourceTracedRings=len(rings)-retained,
                            retainedHistoricalRings=retained,sourceVerticesChecked=checked_vertices,
                            maximumPixelAffineErrorMetres=max_affine,maximumProjectionRoundtripErrorMetres=max_roundtrip,
                            maximumStoredVertexQuantizationErrorMetres=max_quantized,
                            interpretationUncertaintyMetres=feature['evidence']['uncertaintyM'],
                            beforeAreaSquareMetres=round(old_area,3),afterAreaSquareMetres=round(new_area,3),
                            areaChangeSquareMetres=round(new_area-old_area,3),
                            areaWeightedCentroidShiftMetres=round(float(np.linalg.norm(new_centre-old_centre)),3) if old_centre is not None else None))
        print(feature_id + ': ' + records[-1]['state'],flush=True)
    inventories = []
    for n,hole in sorted(actual_holes.items()):
        old = original_holes[n]
        selected = [f for f in features if f['hole']==n]
        tee_set = next((f for f in selected if f['kind']=='tee-set'),None)
        traced_tee_indices = [i for i,p in enumerate(tee_set['pads']) if not p.get('retainedHistorical')] if tee_set else [f['index'] for f in selected if f['kind']=='tee']
        historical = [i for i,p in enumerate(tee_set['pads']) if p.get('retainedHistorical')] if tee_set else []
        bunker_indices = sorted(f['index'] for f in selected if f['kind']=='bunker')
        fairway = next((f for f in selected if f['kind']=='fairway'),None)
        markers = []
        for index,marker in enumerate(hole['tees']['marks']):
            previous = old['tees']['marks'][index]
            selected_pad = tee_set.get('referencePads',[None]*len(hole['tees']['marks']))[index] if tee_set else None
            explicitly_decided = bool(tee_set and 'referencePads' in tee_set)
            if selected_pad is not None:
                pad = hole['tees']['pads'][selected_pad]
                audit.require(inside(marker['c'],pad['ring']),f'hole {n} reference {index}: outside explicitly associated pad')
                audit.require(marker.get('sourceReviewId')==tee_set['id'] and marker.get('sourcePadId')==tee_set['pads'][selected_pad]['id'],f'hole {n} reference {index}: association evidence mismatch')
                audit.require(marker.get('prov')=='orthophoto-platform-reference' and marker.get('associationConfidence')=='provisional',f'hole {n} reference {index}: physical reference incorrectly presented as a surveyed daily marker')
                if index==0:
                    audit.require(hole['line'][0]==marker['c'],f'hole {n}: route start differs from explicit platform reference')
            elif explicitly_decided:
                audit.require(marker['c']==previous['c'] and marker.get('associationConfidence')=='unresolved',f'hole {n} reference {index}: unresolved reference moved or promoted')
            else:
                audit.require(marker['c']==previous['c'],f'hole {n} reference {index}: changed without explicit association evidence')
            markers.append(dict(index=index,teeIdx=marker.get('teeIdx'),before=previous['c'],after=marker['c'],
                                shiftMetres=round(float(np.linalg.norm(np.asarray(marker['c'])-previous['c'])),3),
                                decision='provisional-physical-platform-reference' if selected_pad is not None else 'unresolved-retained-reference',
                                selectedPadIndex=selected_pad,sourceReviewId=marker.get('sourceReviewId'),
                                dailyMarkerPositionVerified=False,
                                containedByCurrentPadIndices=[i for i,p in enumerate(hole['tees']['pads']) if inside(marker['c'],p['ring'])]))
        inventories.append(dict(hole=n,green=dict(total=1,sourceReviewed=any(f['kind']=='green' for f in selected)),
                                bunkers=dict(total=len(hole['bunkers']),sourceReviewedIndices=bunker_indices,
                                             unresolvedIndices=[i for i in range(len(hole['bunkers'])) if i not in bunker_indices]),
                                teePlatforms=dict(total=len(hole['tees']['pads']),sourceTracedIndices=traced_tee_indices,
                                                  retainedHistoricalIndices=historical,
                                                  unresolvedIndices=[i for i in range(len(hole['tees']['pads'])) if i not in traced_tee_indices],
                                                  inferredPadGenerationDisabled=hole['tees'].get('inferPads') is False),
                                fairways=dict(totalComponents=len(hole['fairway']['rings']),sourceReviewedComponents=len(fairway['rings']) if fairway else 0,
                                              unresolvedComponents=0 if fairway else len(hole['fairway']['rings'])),
                                teeReferences=markers))
    report = dict(schemaVersion=1,groundId='veckefjarden',kind='independent-orthophoto-alignment-evidence-audit',
                  auditedAt=datetime.now(timezone.utc).isoformat(),state='passed' if not audit.errors else 'failed',
                  inputs=dict(ledgerPath=relative(args.ledger),ledgerSha256=digest(args.ledger),modelPath=relative(args.model),
                              modelSha256=digest(args.model),baselineCommit=baseline_commit,
                              baselineModelSha256=hashlib.sha256(baseline_bytes).hexdigest()),
                  methodology=dict(sourceVerification='Read actual cached native TIFF bytes and compare recorded SHA-256, CRS, affine, dimensions and band dtype.',
                                   panelVerification='Read actual PNG/world/CRS files; recompute nine bilinear RGB sample pixels from cited TIFFs on the complete panel affine and compare exact channel values.',
                                   geometryVerification='Recompute every pixel-edge affine, inverse projection and centimetre-quantized legacy vertex; compare accepted ledger and actual rebuilt model independently.',
                                   changeMetrics='Polygon area and area-weighted centroid. Tee-set metrics compare complete inventory totals, not paired motion of individual platforms.',
                                   retainedHistorical='Retained historical rings must equal the Git baseline and are excluded from source-traced vertex and resolved-platform counts.'),
                  accuracy=dict(nativePixelResolutionMetres=.16,storedLocalCoordinateStepMetres=.01,
                                sourceAbsoluteHorizontalAccuracyMetres=None,
                                maximumProjectionRoundtripErrorMetres=max((r['maximumProjectionRoundtripErrorMetres'] for r in records),default=0),
                                maximumStoredVertexQuantizationErrorMetres=max((r['maximumStoredVertexQuantizationErrorMetres'] for r in records),default=0),
                                interpretationUncertaintyRangeMetres=[min(r['interpretationUncertaintyMetres'] for r in records),max(r['interpretationUncertaintyMetres'] for r in records)],
                                limitation='Numerical source registration, pixel resolution and boundary interpretation uncertainty are distinct from absolute surveying accuracy. No daily marker positions are verified.'),
                  summary=dict(features=len(records),featuresPassed=sum(r['state']=='passed' for r in records),
                               featureKinds=dict(Counter(r['kind'] for r in records)),
                               sourceVerticesChecked=sum(r['sourceVerticesChecked'] for r in records),
                               sourceTracedRings=sum(r['sourceTracedRings'] for r in records),
                               retainedHistoricalRings=sum(r['retainedHistoricalRings'] for r in records),
                               actualNativeTiffHashesVerified=len(audit.sources),actualReviewPanelHashesVerified=len(audit.panels),
                               exactPanelRgbSamplesCompared=sum(p['rgbSamplesCompared'] for p in audit.panels.values()),
                               provisionalPhysicalPlatformReferences=sum(m['selectedPadIndex'] is not None for h in inventories for m in h['teeReferences']),
                               unresolvedTeeReferences=sum(m['selectedPadIndex'] is None for h in inventories for m in h['teeReferences']),
                               errors=len(audit.errors)),sources=list(audit.sources.values()),panels=list(audit.panels.values()),
                  features=records,holes=inventories,errors=audit.errors)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps(dict(state=report['state'],**report['summary'])),flush=True)
    return 0 if not audit.errors else 1


if __name__=='__main__':
    raise SystemExit(main())
