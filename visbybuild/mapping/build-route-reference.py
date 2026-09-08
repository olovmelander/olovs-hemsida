"""Source-derived route identity observations; no surveyed or tee-colour claims."""
import json
from pathlib import Path
from shapely.geometry import shape
from shapely.validation import explain_validity
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
osm=json.loads((ROOT/'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson').read_text('utf8'))
greens=[f for f in osm['features'] if f['properties']['tags'].get('golf')=='green']
green_indices=[0,1,None,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]
# Source pixels are observations, not fitted to scorecard distances. Each start
# is an unnamed representative location until its visible pad is recorded.
starts=[[538,2740],[630,2510],[960,1687],[1580,811],[895,585],[967,987],[980,1742],[1390,1604],[1160,2218],[930,2760],[1729,3102],None,[2220,2447],[2561,2272],[2307,1925],[1724,1862],[2015,2768],[1851,3158]]
via={2:[[850,2220],[900,1990]],3:[[1010,1460],[1090,1230],[1200,1100],[1290,940]],4:[[1320,640]],6:[[900,1280]],8:[[1220,1920],[1080,2140]],9:[[900,2410],[715,2585]],10:[[1250,2710],[1510,2810]],11:[[2080,3000],[2250,2955]],13:[[2380,2550],[2520,2570],[2690,2530]],15:[[2140,1880],[1970,1765]],16:[[1840,2020],[1950,2180],[2015,2380],[2005,2530]],18:[[1560,2950],[1260,2900]]}
tee_rings={
3:[[951,1666],[976,1672],[967,1710],[944,1704]],
4:[[1573,797],[1594,807],[1586,827],[1566,816]],
5:[[890,560],[905,561],[903,609],[887,609]],
6:[[963,975],[981,983],[970,1002],[953,994]],
7:[[952,1740],[966,1729],[1014,1739],[1009,1755],[970,1751]],
8:[[1389,1592],[1400,1598],[1393,1610],[1383,1605]],
9:[[1147,2226],[1159,2232],[1174,2207],[1162,2201]],
10:[[912,2752],[941,2748],[947,2763],[917,2770]],
11:[[1719,3087],[1750,3101],[1740,3119],[1709,3105]],
13:[[2205,2447],[2217,2435],[2235,2444],[2225,2462]],
14:[[2548,2276],[2565,2285],[2573,2267],[2555,2258]],
15:[[2293,1925],[2305,1912],[2322,1923],[2310,1938]],
16:[[1706,1836],[1718,1830],[1749,1870],[1736,1879]],
17:[[2011,2757],[2026,2763],[2018,2781],[2003,2775]],
18:[[1831,3150],[1862,3138],[1873,3161],[1841,3174]]}
replacement_greens={3:[[1347,830],[1368,827],[1374,833],[1369,844],[1352,864],[1341,870],[1323,868],[1317,862],[1322,849],[1333,838]]}
# Per-hole 11/18 diagrams distinguish the two coastal pads around green 17:
# hole 11 is southeast (sea on its right), hole 18 southwest (sea on its left).
tee_rings[11],tee_rings[18]=tee_rings[18],tee_rings[11]
project=lambda p:[round(686900.25+0.5*p[0],3),round(6372149.75-0.5*p[1],3)]
unproject=lambda p:[round((p[0]-686900.25)*2,2),round((6372149.75-p[1])*2,2)]
rows=[]
for number,index in enumerate(green_indices,1):
    green=greens[index] if index is not None else None
    if green:
        c=shape(green['geometry']).centroid
        center=[round(c.x,3),round(c.y,3)]
        pixel=unproject(center)
    else:
        poly=shape({'type':'Polygon','coordinates':[[project(p) for p in replacement_greens[number]+[replacement_greens[number][0]]]]})
        c=poly.centroid;center=[round(c.x,3),round(c.y,3)];pixel=unproject(center)
    start=starts[number-1]
    pixels=([start]+via.get(number,[])+[pixel]) if start else []
    rows.append({'holeNumber':number,'status':'provisional-source-derived-not-surveyed','identityConfidence':'high' if number!=3 else 'medium','greenSourceId':green['id'] if green else None,'greenPixel':pixel,'greenEpsg3006':center,'greenCentreMethod':'OSM polygon centroid; hole identity independently correlated with Caddee overview and 2022 orthophoto' if green else 'Manual approximate centre of reconstructed green region in 2022 orthophoto; trace pending','greenRingPixels':None,'teePixel':start,'teeEpsg3006':project(start) if start else None,'teeRingPixels':None,'teeIdentity':'unnamed representative observed start; no numbered tee or official measured distance assertion' if start else 'pending visible pad identification','routePixels':pixels,'routeEpsg3006':[project(p) for p in pixels],'routeStatus':'indicative source-observed centreline; independent review pending' if start else 'pending representative tee observation','provenance':['gotland-ortho-2022','caddee-main-overview',f'caddee-main-hole-{number:02d}']+(['openstreetmap-golf'] if green else []),'notes':[]})
rows[2]['notes']=['Main hole 3 uses the dormant northbound corridor from approximately (975,1620) through (1090,1230) and (1200,1100). The green maintained curve to (1478,1268) is separate nine-hole 9. Green in 2022 appears reconstructed; OSM does not include it.']
rows[8]['notes']=['OSM polygon appears overbroad (elongated green plus approach/apron); exact 2022 putting boundary requires tracing. Centroid is not a measured pin.']
rows[13]['notes']=['OSM polygon appears smaller and offset relative to visible 2022 green boundary; trace pending.']
rows[15]['notes']=['Main hole 16 is the east corridor, right/east of water: approximately (1785,1770) through (1850,2050), (1930,2320) to green (2038,2689). The north-south strip around x1600 is separate nine-hole 3.']
for row in rows:
    n=row['holeNumber']
    ring=tee_rings.get(n)
    if n in [1,2]:
        source_id={1:'way/1311553674',2:'way/1311556977'}[n]
        found=next(f for f in osm['features'] if f['id']==source_id)
        ring=[unproject(p) for p in found['geometry']['coordinates'][0][:-1]]
        row['teeSurfaceSourceId']=source_id
    if ring:
        row['teeRingPixels']=ring
        row['teeRingEpsg3006']=[project(p) for p in ring]+[project(ring[0])]
        row['teeSurfaceMethod']='retained OSM tee footprint' if n in [1,2] else 'manually observed rectangular mowing edge in retained 2022 orthophoto; tree-shadow edges uncertain'
        row['teePadConfidence']='medium' if n in [3,7,10,13,14,15] else 'high'
        row['teeIdentity']='unnamed representative visible tee pad; no numbered tee or official measured distance assertion'
        # A representative location is derived from the observed ring rather
        # than from an earlier approximate click.
        c=shape({'type':'Polygon','coordinates':[row['teeRingEpsg3006']]}).centroid
        row['teeEpsg3006']=[round(c.x,3),round(c.y,3)]
        row['teePixel']=unproject(row['teeEpsg3006'])
        row['routePixels'][0]=row['teePixel']
        row['routeEpsg3006'][0]=row['teeEpsg3006']
    if n in replacement_greens:
        row['greenRingPixels']=replacement_greens[n]
        row['greenRingEpsg3006']=[project(p) for p in replacement_greens[n]]+[project(replacement_greens[n][0])]
        row['greenCentreMethod']='centroid of manually observed putting boundary in retained 2022 orthophoto; dormant/reconstruction contrast limits confidence'
rows[2]['notes'].append('Putting boundary has faint contrast in 2022; exact current green extent requires independent review.')
rows[8]['notes']=['Large elongated OSM green retained: the guide and photo both show an internal bunker/island, so size alone does not establish an error. Putting versus apron boundary remains unverified.']
rows[11]['notes']=['No unambiguous standalone tee pad identified in 2022 source; trees/rough at rejected (2365,2865) must not be promoted to a tee. Hole identity and green remain mapped, representative start pending.']
rows[13]['notes']=['OSM centre agrees with visible 2022 putting area on close inspection. Exact ring may differ; retained OSM geometry remains independently unverified.']
rows[10]['notes']=['The visible coastal tee southeast of green 17 belongs to hole 11; the southwest pad belongs to hole 18. Identification corroborated with the per-hole diagrams and water side. Representative pad may not correspond to the present longest numbered tee.']
rows[15]['notes']=['Main hole 16 starts on the visible pad around (1724,1862) and uses the east corridor, right/east of water, through (1840,2020), (1950,2180), (2015,2380), (2005,2530) to green (2038,2689). The north-south strip around x1600 is separate nine-hole 3.']
rows[17]['notes']=['Visible coastal tee southwest of green 17; the southeast pad belongs to hole 11. Independent numbered-tee identity remains pending.']
rows[8]['greenPixel']=[610,2720]
rows[8]['greenEpsg3006']=project(rows[8]['greenPixel'])
rows[8]['greenCentreMethod']='representative visible putting-surface target south of internal bunker; OSM polygon centroid is near the bunker island and is unsuitable as a navigation target'
rows[8]['routePixels'][-1]=rows[8]['greenPixel']
rows[8]['routeEpsg3006'][-1]=rows[8]['greenEpsg3006']
rows[8]['notes'].append('Target is an observed putting-surface point, not an official measured green centre or pin. Internal bunker material takes precedence over the broad OSM green footprint.')
# Hole 12 has a navigation reference on observed mown fairway, deliberately
# separate from all physical tee fields and surface geometry.
r=rows[11]
r['virtualStartPixel']=[2285,2830]
r['virtualStartEpsg3006']=project(r['virtualStartPixel'])
r['routePixels']=[r['virtualStartPixel'],[2200,2750],[2160,2640],r['greenPixel']]
r['routeEpsg3006']=[project(p) for p in r['routePixels']]
r['routeStatus']='virtual flyover start on visible lower fairway; physical tee unresolved'
r['notes'].append('Explicit navigation placeholder on observed lower fairway at (2285,2830); this is not a physical tee or a scorecard measurement start and supplies no pad geometry. Root implementation decision 2026-09-07.')
out={'schemaVersion':1,'courseId':'visby','courseScope':'Main 18-hole course only; separate nine-hole identities excluded','status':'provisional-source-derived-not-surveyed','completeness':'All 18 green identities correlated; representative tees and replacement green rings being completed','sourceImage':'visbybuild/cache/geodata-2026-09-07/gotland-2022-0p5m.png','sourceImageSha256':'aac5fa4a1ce429258cd020e0a139939576ac67bde02e010fc822feb446111153','pixelConvention':'Full retained image; pixel centres: E=686900.25+0.5*x, N=6372149.75-0.5*y; EPSG:3006','horizontalCrs':'EPSG:3006','sourceYear':2022,'captureDate':None,'licence':'Exact orthophoto and Caddee reuse terms unresolved; local provisional derivative only; no publication clearance','registrationAccuracyMetres':None,'interpretationUncertaintyMetres':5,'reviewer':'Codex machine visual interpretation; independent human review pending','sources':{'gotland-ortho-2022':'geo_data/course-v2/visby/reference/gotland-ortho-2022.json','openstreetmap-golf':'geo_data/course-v2/visby/reference/osm-golf-epsg3006.geojson','caddee-main-overview':'visbybuild/cache/club-sources-2026-09-07-full/caddee-18-overview.png','caddee-main-hole-pattern':'visbybuild/cache/club-sources-2026-09-07-full/caddee-18-hole-NN.png'},'holes':rows}
out['completeness']='All 18 green identities correlated; 17 visible representative tee pads retained; hole 12 physical tee unresolved with separate virtual fairway flyover start'
for row in rows:
    for kind in ['green','tee']:
        ring=row.get(kind+'RingEpsg3006')
        if ring:
            poly=shape({'type':'Polygon','coordinates':[ring]})
            assert poly.is_valid and poly.area>1,(row['holeNumber'],kind,explain_validity(poly))
            row[kind+'AreaSquareMetres']=round(poly.area,2)
(ROOT/'visbybuild/mapping/route-reference.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n','utf8')
img=Image.open(ROOT/out['sourceImage']).convert('RGB');draw=ImageDraw.Draw(img)
font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',28)
for row in rows:
    if row['routePixels']:draw.line([tuple(p) for p in row['routePixels']],fill='#ffff30',width=3)
    for kind,color in [('green','#ff69e0'),('tee','#00ffff')]:
        p=row[kind+'Pixel'];ring=row[kind+'RingPixels']
        if ring:draw.line([tuple(p) for p in ring+[ring[0]]],fill=color,width=3)
        if p:
            draw.ellipse((p[0]-5,p[1]-5,p[0]+5,p[1]+5),fill=color)
            draw.text((p[0]+6,p[1]+6),f"{kind[0].upper()}{row['holeNumber']}",font=font,fill=color,stroke_fill='black',stroke_width=2)
cache=ROOT/'visbybuild/cache/route-reference-review';cache.mkdir(exist_ok=True,parents=True)
img.save(cache/'route-observations-overlay.png')
for name,bounds in [('route-north',(700,350,1800,1800)),('route-west',(430,1600,1510,2860)),('route-east',(1620,1550,2860,2920)),('route-south',(700,2600,2600,3250))]:img.crop(bounds).save(cache/(name+'.png'))
print(json.dumps({'holes':len(rows),'observedStarts':sum(r['teePixel'] is not None for r in rows)}))
