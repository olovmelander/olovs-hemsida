#!/usr/bin/env python3
"""Serialize manually inspected front-nine LM sand traces and retained decisions.

Run after render-upsala-lm-review.py has made the referenced ignored panels.
Coordinates below were picked by visual inspection of plain imagery, not by
threshold segmentation. The script transforms, validates and records them.
"""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw
from pyproj import Transformer
from shapely.geometry import Polygon, Point

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT/'upsalabuild/cache/lm-review-front9-2026-09-09'
CAPTURE = ROOT/'geo_data/course-v2/upsala/reference/lm-ortho-capture-2026-09-09.json'

# Each polygon is an open ring in its recorded display-panel pixel-edge frame.
TRACES = [
    dict(hole=1, sourceId='w452928633', panel='h01-east',
         reason='The old triangular eastern edge omits the plainly visible east and southeast sand lobe. Trace the continuous exposed sand edge, excluding the darker grass collar.',
         ring=[[396,307],[418,308],[438,316],[457,329],[474,349],[486,369],[497,397],[505,426],[511,459],[513,484],[511,506],[504,524],[493,538],[478,549],[461,557],[445,557],[430,552],[413,541],[400,527],[389,505],[379,482],[372,459],[365,435],[355,413],[348,395],[346,378],[350,359],[360,340],[373,323],[385,312]]),
    dict(hole=2, sourceId='w438983953', panel='h02-distal',
         reason='The source triangle clips the visible east side of the oval sand footprint and extends into the southern grass collar. The entire exposed edge is visible.',
         ring=[[397,276],[411,279],[427,288],[440,303],[453,322],[466,345],[477,370],[485,393],[488,411],[485,427],[476,443],[463,457],[449,465],[432,469],[414,468],[399,461],[385,452],[375,440],[367,425],[362,409],[360,388],[360,362],[361,337],[365,313],[373,294],[385,281]]),
    dict(hole=3, sourceId='w438986830', mergedSourceIds=['w438986828'], panel='h03-west', neckPixel=[555,438],
         reason='The west greenside sand is one connected three-lobed bunker. The two old polygons leave an artificial grass gap across a fully visible sand neck. Trace the single outer edge and retire the secondary split footprint.',
         ring=[[376,229],[403,230],[429,238],[452,251],[474,269],[494,292],[511,315],[528,342],[541,370],[555,388],[572,400],[595,407],[621,411],[644,418],[663,435],[680,457],[692,481],[699,504],[700,519],[694,538],[683,559],[667,579],[650,589],[633,592],[619,589],[610,582],[605,570],[603,554],[606,532],[607,514],[603,496],[596,482],[586,473],[575,468],[562,466],[550,470],[541,480],[535,494],[528,509],[517,519],[502,526],[487,529],[470,527],[450,520],[435,511],[421,499],[417,484],[420,470],[428,453],[435,434],[440,414],[444,394],[443,378],[439,363],[432,350],[423,342],[411,338],[399,338],[388,342],[379,350],[374,361],[371,376],[370,391],[367,408],[360,421],[350,427],[336,425],[321,420],[306,409],[295,395],[286,379],[279,361],[276,341],[278,321],[284,302],[293,284],[306,267],[323,250],[341,240],[359,233]]),
    dict(hole=7, sourceId='w438981594', panel='h07-distal',
         reason='The old outline truncates the clear northern sand cap by approximately 2.5 m and extends beyond the southern sand edge into grass. Trace both lobes and preserve the visible grass indentation on the east.',
         ring=[[395,96],[417,98],[443,109],[465,126],[480,149],[487,172],[489,194],[485,220],[478,242],[465,262],[449,278],[433,290],[420,307],[416,323],[417,342],[423,366],[435,389],[447,410],[458,433],[464,457],[467,484],[468,513],[468,541],[465,565],[459,580],[448,591],[435,598],[419,601],[402,598],[383,590],[367,578],[352,561],[342,542],[334,520],[332,499],[334,477],[339,453],[343,430],[344,409],[340,392],[333,375],[325,354],[316,334],[306,314],[300,289],[297,266],[292,244],[290,222],[291,198],[297,175],[307,153],[320,134],[337,119],[357,107],[377,100]]),
    dict(hole=7, sourceId='w438982463', panel='h07-small',
         reason='The small southern bunker is a clearly visible oval. The old polygon omits its north and east sides and includes a southern strip of grass. The local outline correction materially changes this small footprint.',
         ring=[[389,307],[411,310],[432,318],[452,335],[467,357],[475,379],[476,400],[469,418],[457,432],[440,440],[421,444],[402,443],[382,436],[365,426],[349,411],[336,396],[328,379],[328,358],[337,340],[351,325],[369,314]]),
]

GREEN_NOTES = {
    1: 'The OSM footprint follows the visible turf; small angular/collar differences do not establish a shift beyond approximately 1.5 m interpretation uncertainty.',
    2: 'The putting surface is the pale central footprint; the southeast approach spur is a different mowing surface. Existing green broadly follows the putting edge.',
    3: 'Existing outline broadly follows the putting surface between pond and sand. Retain the reference center and original edge; no whole-green displacement is supported.',
    4: 'The visible asymmetric putting footprint corroborates the original polygon. Small edge/collar differences are within approximately 1.5 m visual interpretation uncertainty.',
    5: 'Visible parts agree broadly with the original putting outline. Tree shadow obscures a section of the southern edge, so a complete replacement is not justified.',
    6: 'The putting surface lies inside the distinct approach collar beside the pond. Existing polygon agrees broadly; no whole-green registration change is supported.',
    7: 'Original polygon follows the putting area, with locally angular edges; the broad northwest apron remains outside the putting claim. No large shift is supported.',
    8: 'The original green broadly follows the rounded putting edge, and the existing Sahara trace matches the visible exposed sand. Retain both.',
    9: 'The original green follows the pale putting footprint. Its southern angular tip differs locally from the collar transition, within approximately 1.5 m interpretation uncertainty.',
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', type=Path, default=CACHE/'baseline-model.json')
    parser.add_argument('--out', type=Path, default=ROOT/'upsalabuild/mapping/lm-review-front9-2026-09-09.json')
    args = parser.parse_args()
    model = json.loads(args.baseline.read_text(encoding='utf-8'))
    capture = json.loads(CAPTURE.read_text(encoding='utf-8'))
    frame = {key:model[key] for key in ['origin','mPerLat','mPerLon']}
    inverse = Transformer.from_crs(3006,4326,always_xy=True)
    forward = Transformer.from_crs(4326,3006,always_xy=True)
    def local(e,n):
        lon,lat = inverse.transform(e,n)
        return [round((lon-frame['origin']['lon'])*frame['mPerLon'],3),round((frame['origin']['lat']-lat)*frame['mPerLat'],3)]
    sources = []
    for n in range(1,10):
        ledger_path = ROOT/f'upsalabuild/cache/lm-ortho/stora-{n:02d}-surfaces.json'
        ledger = json.loads(ledger_path.read_text())
        native = ledger_path.with_suffix('.tif')
        assert digest(native) == ledger['sha256'], f'{native}: stale native hash'
        date = next(w for w in capture['windows'] if w['id'] == ledger['id'])
        assert date['coverageFraction'] == 1
        sources.append({**ledger,'localPath':native.relative_to(ROOT).as_posix(),'captureEvidence':date})
    features = []
    for trace in TRACES:
        panel_path = CACHE/trace['panel']/'panels.json'
        panel = json.loads(panel_path.read_text())['panels'][0]
        source = sources[trace['hole']-1]
        assert panel['sources'][0]['sha256'] == source['sha256'], f'{panel_path}: rerender stale panel'
        h = next(h for h in model['holes'] if h['n']==trace['hole'])
        original = next(b for b in h['bunkers'] if b['sourceId']==trace['sourceId'])
        gt = panel['geoTransform']
        def projected(pixel):
            x,y = pixel
            return [round(gt[0]+x*gt[1]+y*gt[2],6),round(gt[3]+x*gt[4]+y*gt[5],6)]
        national = [projected(p) for p in trace['ring']]
        ring = [local(*p) for p in national]
        poly = Polygon(ring)
        assert poly.is_valid and poly.area > 1 and not poly.contains(Point(h['green']['c']))
        roundtrip_error = 0
        for (x,z),(e,n) in zip(ring,national):
            actual = forward.transform(frame['origin']['lon']+x/frame['mPerLon'], frame['origin']['lat']-z/frame['mPerLat'])
            roundtrip_error = max(roundtrip_error, ((actual[0]-e)**2+(actual[1]-n)**2)**0.5)
        assert roundtrip_error < .001
        date = source['captureEvidence']
        feature = {'id':f'upsala-stora-{trace["hole"]:02d}-{trace["sourceId"]}-lm2025-review-20260909','kind':'bunker','hole':trace['hole'],'sourceId':trace['sourceId'],'status':'accepted','action':'merge' if trace.get('mergedSourceIds') else 'replace','originalShape':original,'ring':ring,'sourceGeometryEPSG3006':{'type':'Polygon','coordinates':[national+[national[0]]]},'originalPixelRing':trace['ring'],'tracePanel':{k:v for k,v in panel.items() if k != 'shapes'},'evidence':{'source':'Lantmateriet authenticated Ortofoto Nedladdning, orto-o2-2025','sourceCaptureDates':sorted(set(i['capturedAt'][:10] for i in date['contributingImages'])),'captureEvidencePath':CAPTURE.relative_to(ROOT).as_posix(),'captureEvidenceSha256':digest(CAPTURE),'captureDateFootprintCoverageFraction':date['coverageFraction'],'sourceFiles':[{'path':source['localPath'],'sha256':source['sha256'],'rgbSha256':source['rgbSha256'],'resolutionMetres':source['resolutionMetres']}],'sourceHorizontalAccuracyM':None,'uncertaintyM':0.5,'acceptance':trace['reason'],'note':'Manual visual boundary interpretation from the full RGB footprint. Display upsampling adds no source resolution. Sand depth, grass-bank breaklines and later changes remain unmeasured.'},'comparison':{'originalAreaM2':round(Polygon(original['ring']).area,3),'acceptedAreaM2':round(poly.area,3),'maximumRoundTripErrorM':round(roundtrip_error,6)}}
        if trace.get('mergedSourceIds'):
            originals = [next(b for b in h['bunkers'] if b['sourceId']==i) for i in trace['mergedSourceIds']]
            neck = local(*projected(trace['neckPixel']))
            assert poly.contains(Point(neck)) and not any(Polygon(s['ring']).contains(Point(neck)) for s in [original]+originals)
            feature.update(mergedSourceIds=trace['mergedSourceIds'],originalMergedShapes=originals,neckObservation={'pixel':trace['neckPixel'],'pointEPSG3006':projected(trace['neckPixel']),'localPoint':neck,'observation':'Visible exposed sand within the former inter-polygon gap; no internal grass lip.'})
        features.append(feature)
        overlay = Image.open(ROOT/panel['overlayPath']).convert('RGB')
        draw = ImageDraw.Draw(overlay)
        draw.line([tuple(p) for p in trace['ring']+[trace['ring'][0]]], fill='#ffff00',width=3)
        overlay.save(CACHE/trace['panel']/'accepted-overlay.png')
    changed = {f['sourceId']:f for f in features}
    merged = {i:f for f in features for i in f.get('mergedSourceIds',[])}
    reviews = []
    for h in model['holes']:
        if h['n']>9:
            continue
        for kind,shape in [('green',h['green'])]+[('bunker',b) for b in h['bunkers']]:
            source_id=shape['sourceId']
            note = GREEN_NOTES[h['n']] if kind=='green' else 'Reviewed on the native whole-hole source and green/detail panel where relevant. The old outline broadly follows visible sand; small collar and angular-edge differences do not justify a replacement in this pass.'
            status = 'retained-corroborated'
            uncertainty = 1.5 if kind=='green' else 1
            if kind=='green' and h['n']==5:
                status = 'retained-partly-obscured'
                uncertainty = 2
            if source_id=='w438983955':
                status = 'retained-partly-obscured'
                uncertainty = 2
                note = 'The northern exposed sand cap and east upper edge extend beyond the OSM polygon, but tree shadow hides the southern/eastern sand boundary. Retain the full original explicitly pending unobscured imagery; do not infer a complete replacement.'
            if source_id in changed:
                status = 'replaced-with-reviewed-trace'
                note = changed[source_id]['evidence']['acceptance']
            if source_id in merged:
                status = 'merged-into-reviewed-connected-bunker'
                note = f'Visible sand connection joins this source to {merged[source_id]["sourceId"]}; remove this separate runtime polygon after tracing the combined footprint.'
            if source_id=='upsala-stora-hole8-sahara-sand-2025':
                note = 'The previously adopted Sahara sand trace agrees closely with the authenticated 2025 exposed-sand boundary; retain its original evidence and geometry.'
            reviews.append({'hole':h['n'],'kind':kind,'sourceId':source_id,'status':status,'originalShape':shape,'sourceWindowId':f'stora-{h["n"]:02d}-surfaces','interpretationUncertaintyM':uncertainty,'note':note})
    result = {'schemaVersion':1,'reviewedAt':'2026-09-09','scope':'Stora H1-9 greens and all 26 currently assigned bunker footprints','completeSurvey':False,'frame':frame,'baselineModelSha256':digest(args.baseline),'method':'Manual plain/overlay visual inspection of authenticated native 0.16 m RGBI windows. Trace sand edges by hand in north-up georeferenced panels; pyproj EPSG:3006 to WGS84 followed by the exact declared legacy frame. No whole-course translation, fitted registration or threshold contours.','limitations':['Nine original greens are corroborated or explicitly retained, not independently surveyed.','H5 southern green edge and H3 northern assigned bunker remain partly obscured.','No claim covers every tree, water edge, mowing strip, tee, building or later course change.','Image ground sample distance and boundary interpretation uncertainty do not measure absolute horizontal accuracy.'],'sources':sources,'reviews':reviews,'features':features}
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'file':args.out.as_posix(),'reviewed':len(reviews),'accepted':len(features),'mergedSecondaryFootprints':len(merged),'features':[{'id':f['id'],**f['comparison']} for f in features]},indent=2))


if __name__=='__main__':
    main()
