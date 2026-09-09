"""Reproduce the explicit visual traces for holes 1-9 from pinned LM pixel grids.

Coordinates below are manually reviewed pixel-edge positions, not model shifts.
The source PNGs and baseline overlays were inspected at native resolution.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from pyproj import Transformer
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'johannesbergbuild/cache/lm-ortho'
BASELINE = ROOT / 'johannesbergbuild/course-model.json'
BASELINE_SHA256 = '9cdec310df0f70a39b86f440fb6397309c7c175b668fba26683148864f392e69'
if hashlib.sha256(BASELINE.read_bytes()).hexdigest() != BASELINE_SHA256:
    raise ValueError('Course model differs from the reviewed baseline; do not silently rebase originalRingSha256. Restore the pinned baseline before regenerating this review.')
MODEL = json.loads(BASELINE.read_text('utf-8'))
INVERSE = Transformer.from_crs(3006,4326,always_xy=True)
SPECS=[]
UNRESOLVED=[]

def add(hole, kind, coords, index=None, mode='surfaces', uncertainty=0.8, note=''):
    SPECS.append(dict(hole=hole,kind=kind,coords=coords,index=index,mode=mode,uncertainty=uncertainty,note=note))

# Putting surfaces follow the close-mown inner boundary, excluding the collar.
add(1,'green',[[192,279],[205,277],[218,285],[234,303],[247,325],[258,341],[278,351],[306,365],[329,387],[345,404],[352,422],[351,439],[343,454],[329,463],[312,466],[298,462],[285,451],[275,435],[261,416],[242,403],[224,396],[204,386],[190,373],[181,351],[177,326],[179,304],[184,287]],uncertainty=1.2,note='Irregular putting surface has a long northwestern lobe; the former circular ring covered only its southeastern half. Inner edge is softer on the north approach. Southern edge was checked in an enlarged native crop to exclude the dark collar stripe.')
add(1,'bunker',[[260,303],[273,304],[287,310],[302,315],[316,321],[325,330],[326,338],[321,346],[311,350],[299,350],[283,344],[270,336],[261,326],[256,315]],index=1,uncertainty=1.3,note='Visible brown sand outline adjoining the wooded green edge; northern lip partly shaded.')
UNRESOLVED.append(dict(hole=1,kind='bunker',index=0,reason='Legacy northern bunker is below dense tree shade. Orthophoto cannot establish its edge or removal; retained inherited geometry.'))

add(2,'green',[[231,253],[252,239],[280,233],[304,239],[324,254],[335,274],[335,297],[324,320],[309,343],[289,361],[268,371],[247,373],[225,367],[209,352],[201,334],[201,309],[211,282]],note='Putting surface is an oblique oval southeast of the inherited circular boundary.')
add(2,'bunker',[[377,249],[390,248],[400,254],[405,267],[403,280],[395,294],[380,308],[370,324],[366,345],[365,365],[359,382],[348,392],[334,397],[321,395],[312,387],[308,374],[309,361],[320,342],[329,325],[337,307],[349,288],[357,268],[365,254]],index=0,note='Entire connected dog-bone sand body is visible; former ring was a narrow sliver.')

add(3,'green',[[270,289],[291,285],[315,288],[341,299],[364,315],[384,337],[397,361],[401,384],[398,406],[388,427],[370,445],[348,458],[326,461],[302,455],[280,443],[261,425],[247,403],[240,381],[240,358],[246,332],[254,307]],note='Inner putting boundary excludes the broad striped collar.')
add(3,'bunker',[[228,206],[244,201],[260,198],[276,193],[285,197],[291,206],[293,219],[288,229],[274,235],[252,239],[235,240],[223,235],[218,226],[219,214]],index=0,note='Northern sand body, traced at the sand/turf lip.')
add(3,'bunker',[[262,439],[274,440],[287,449],[304,457],[324,462],[340,466],[348,474],[351,487],[346,498],[335,504],[320,506],[301,502],[282,496],[266,489],[256,480],[252,466],[254,452]],index=1,note='Southern curved sand body, including its wider western end.')

add(4,'green',[[1010,550],[1026,545],[1047,548],[1070,557],[1094,563],[1117,568],[1141,579],[1160,596],[1173,614],[1176,631],[1170,649],[1157,663],[1139,671],[1121,672],[1101,667],[1081,658],[1059,651],[1039,647],[1018,640],[1002,629],[992,614],[989,596],[992,576],[998,560]],note='Elongated green south and east of the old outline, with shallow waist on its north side.')
add(4,'bunker',[[196,203],[210,197],[226,198],[243,204],[254,213],[258,223],[252,233],[240,236],[224,233],[207,226],[194,219],[191,212]],index=0)
add(4,'bunker',[[302,256],[316,254],[335,260],[354,267],[374,274],[391,283],[402,294],[408,308],[405,318],[395,324],[382,324],[370,317],[359,307],[344,300],[326,294],[310,287],[299,278],[294,268],[296,260]],index=1)
add(4,'bunker',[[906,583],[917,581],[930,586],[941,597],[948,611],[951,628],[945,640],[935,646],[922,649],[907,647],[897,639],[889,628],[887,613],[891,599],[897,589]],index=2)
add(4,'bunker',[[938,679],[948,673],[958,673],[970,679],[982,680],[994,677],[1007,670],[1019,666],[1031,666],[1041,672],[1046,682],[1041,697],[1036,711],[1035,728],[1029,739],[1016,744],[999,742],[983,742],[971,742],[961,736],[952,724],[944,711],[936,698],[932,688]],index=3)

add(5,'green',[[218,219],[234,216],[251,222],[263,234],[271,255],[274,278],[275,306],[280,331],[287,355],[289,379],[285,400],[276,414],[264,418],[251,412],[235,398],[222,378],[210,352],[201,328],[195,303],[193,280],[196,257],[202,237]],uncertainty=1.3,note='Putting boundary extends south beneath tree shadow; shaded southern edge follows the visible mowing edge.')
add(5,'bunker',[[339,214],[351,212],[362,216],[366,226],[363,238],[354,250],[341,261],[329,272],[318,279],[308,277],[303,269],[304,256],[312,240],[322,224]],index=0)

add(6,'green',[[211,266],[224,261],[242,263],[262,270],[283,275],[309,279],[329,290],[344,306],[354,326],[358,345],[353,362],[340,371],[320,372],[298,366],[274,357],[250,347],[229,334],[213,317],[204,300],[202,284],[205,273]],note='Inner putting surface has an irregular northern edge; southeastern collar and approach excluded.')
add(6,'bunker',[[253,203],[264,200],[276,204],[288,214],[299,219],[312,223],[320,231],[321,241],[315,249],[304,254],[288,257],[273,254],[259,247],[249,238],[245,227],[245,215]],index=0)
add(6,'bunker',[[245,365],[257,362],[271,366],[286,374],[301,387],[316,391],[331,390],[344,394],[354,403],[360,418],[360,430],[353,438],[340,439],[326,436],[308,436],[290,437],[273,432],[258,424],[247,412],[240,397],[236,382],[239,371]],index=1)

add(7,'green',[[282,248],[294,247],[304,253],[311,267],[314,287],[312,310],[309,332],[303,353],[292,373],[278,386],[264,393],[251,393],[239,387],[231,377],[225,362],[224,344],[228,326],[234,306],[243,288],[255,269],[267,255]],uncertainty=1.0,note='Putting green is a narrow north-south oval southeast of the inherited polygon.')
add(7,'bunker',[[347,260],[358,267],[365,282],[367,298],[365,313],[358,328],[347,334],[337,331],[330,323],[329,308],[331,291],[336,273]],index=0,uncertainty=2.0,note='Sand body is clearly visible on its western side, with tree shadows over the eastern lip; eastern boundary has lower confidence.')

add(8,'green',[[299,1110],[315,1106],[330,1113],[345,1128],[358,1149],[367,1171],[373,1196],[373,1217],[365,1235],[351,1247],[331,1253],[310,1251],[292,1243],[279,1229],[269,1211],[265,1189],[264,1167],[269,1146],[280,1124]],uncertainty=1.0,note='Inner oval green is displaced southeast relative to the old pointed polygon; collar excluded.')
add(8,'bunker',[[351,195],[362,192],[372,197],[379,207],[378,220],[370,236],[363,253],[357,275],[349,293],[343,315],[337,337],[330,351],[321,357],[310,357],[301,350],[297,342],[300,329],[308,307],[313,283],[321,261],[328,241],[334,221],[341,204]],index=0)
add(8,'bunker',[[189,1096],[201,1089],[216,1090],[230,1080],[240,1081],[249,1091],[252,1105],[248,1119],[240,1132],[235,1143],[224,1148],[210,1148],[197,1143],[187,1130],[182,1116],[182,1104]],index=1)

add(9,'green',[[241,273],[259,261],[282,250],[308,239],[332,236],[350,241],[362,253],[370,271],[371,286],[364,302],[350,316],[332,328],[311,339],[288,348],[266,352],[247,348],[233,337],[224,321],[221,305],[227,288]],note='Oblique putting oval lies southeast of the inherited angular polygon.')
add(9,'bunker',[[315,338],[330,332],[346,329],[359,332],[371,340],[375,351],[370,363],[357,373],[341,380],[323,386],[311,383],[302,374],[299,362],[302,349]],index=0)

# Full-hole 0.32 m windows: physical mowing surfaces, independent of tee colours.
add(1,'tees',[[[219,132],[231,129],[242,135],[253,149],[271,169],[289,190],[294,201],[290,211],[280,215],[268,211],[252,196],[239,178],[225,159],[216,142]],[[307,314],[318,315],[325,326],[327,339],[322,347],[312,351],[300,348],[292,340],[291,329],[297,319]]],mode='hole',uncertainty=1.2,note='One continuous elongated back platform and a separate round forward platform. The old pair of rectangles divided the back platform and omitted the forward one. Tee-marker colours are not inferred.')
add(2,'tees',[[[270,183],[279,181],[288,184],[295,191],[298,201],[294,211],[286,216],[276,215],[269,209],[265,199],[265,189]],[[318,286],[328,282],[339,286],[345,294],[343,306],[335,315],[324,317],[315,312],[310,302],[311,293]]],mode='hole',uncertainty=1.0,note='Two distinct close-mown physical platforms east of hole 1 green; marker colours cannot be resolved.')
add(3,'tees',[[[249,493],[265,489],[284,494],[303,505],[323,520],[334,533],[335,543],[327,553],[314,558],[298,555],[279,546],[263,534],[248,519],[243,507]],[[548,599],[565,588],[585,584],[605,589],[619,600],[624,615],[620,630],[610,645],[596,657],[579,664],[561,665],[546,657],[536,645],[532,630],[537,612]],[[915,503],[934,496],[955,491],[973,494],[986,504],[990,516],[986,529],[975,539],[958,545],[939,549],[922,545],[911,536],[907,523],[909,512]]],mode='actual-tees',uncertainty=1.0,note='Three clearly visible oval tee platforms south of the pond, replacing two inherited placeholders beneath the trees. A supplemental native-resolution window includes the full middle platform, cropped in the original full-hole window. Marker colours unresolved.')
add(4,'tees',[[[134,137],[145,133],[157,136],[168,145],[173,156],[172,164],[165,170],[153,172],[140,168],[132,160],[129,149]],[[310,145],[324,141],[342,146],[357,158],[363,171],[359,182],[347,187],[332,185],[317,178],[307,166],[305,154]],[[483,212],[496,209],[508,212],[518,220],[521,231],[515,240],[503,243],[491,240],[482,232],[479,221]]],mode='hole',uncertainty=1.4,note='Three distinct putting-height tee platforms are visible. The inherited extra rectangular pad between the first two is on ordinary sloping turf without a current tee outline; omit that placeholder. Marker colours unresolved.')
add(5,'tees',[[[1197,165],[1210,163],[1225,169],[1232,180],[1228,190],[1217,196],[1204,195],[1192,189],[1189,177]],[[1082,150],[1096,145],[1111,148],[1126,157],[1130,169],[1124,181],[1110,187],[1095,186],[1082,179],[1075,168],[1076,157]],[[968,140],[980,137],[991,142],[997,152],[995,163],[986,169],[974,168],[965,163],[962,152]]],mode='hole',uncertainty=1.0,note='Three circular or oval tee platforms, ordered back to forward, follow their inner close-mown edges. Marker colours unresolved.')
add(6,'tees',[[[589,442],[598,441],[605,447],[607,456],[603,465],[594,468],[586,464],[583,456],[584,448]],[[521,418],[530,416],[539,421],[544,428],[542,436],[535,441],[525,440],[517,433],[516,425]]],mode='hole',uncertainty=1.0,note='Two small built tee platforms at the forest path; inner cut surfaces replace oversized rotated rectangles. Marker colours unresolved.')
add(7,'tees',[[[208,195],[220,192],[232,198],[245,211],[251,226],[246,238],[234,243],[221,240],[208,231],[200,219],[198,207]],[[315,244],[328,243],[340,251],[350,263],[351,272],[343,279],[332,281],[320,276],[310,264],[307,253]]],mode='hole',uncertainty=1.0,note='Two physical tee platforms southeast of hole 6 green, well southeast of the inherited rectangles. Marker colours unresolved.')
add(8,'tees',[[[293,321],[313,318],[336,319],[356,324],[369,331],[373,340],[363,347],[342,350],[319,349],[301,345],[291,336]],[[166,319],[183,316],[202,319],[213,326],[214,335],[205,343],[188,345],[172,341],[163,333]]],mode='actual-tees',uncertainty=2.0,note='Two close-mown platforms resolve in the supplemental native image. The rear platform has weak contrast and shade along its northern edge, reflected in 2 m uncertainty. No tee-marker colours inferred.')
UNRESOLVED.append(dict(holes=list(range(1,10)),kind='tee-marker-colours',reason='Orthophotos establish physical tee turf but cannot reliably assign the five official tee colours or permanent measured tee points. Physical platforms are traced; colour-to-platform assignment remains a separate course-information check.'))
add(9,'tees',[[[175,674],[184,670],[193,674],[202,685],[207,698],[205,710],[198,717],[187,718],[177,712],[170,701],[169,688]],[[160,531],[168,527],[176,531],[183,542],[186,554],[182,565],[174,571],[166,568],[159,561],[155,550],[155,540]]],mode='hole',uncertainty=1.2,note='Two elongated physical platforms west of hole 8 fairway. Both inherited rectangles lie in ordinary turf south of these platforms; replace them. Marker colours unresolved.')

add(1,'fairway',[[[200,530],[215,527],[232,532],[244,543],[247,562],[244,587],[238,614],[234,649],[229,680],[218,710],[209,739],[206,766],[210,794],[219,817],[228,839],[239,859],[247,880],[260,901],[274,919],[284,936],[272,945],[257,933],[243,917],[230,901],[218,887],[207,873],[195,853],[183,832],[176,809],[166,797],[160,784],[164,763],[172,737],[181,709],[186,679],[187,647],[184,620],[184,593],[185,563],[190,540]]],mode='hole',uncertainty=2.0,note='Trace follows the June fairway mowing boundary and narrow approach, excluding the large pale rough area north of the landing zone.')
add(2,'fairway',[[[351,530],[366,528],[380,535],[388,548],[391,567],[393,594],[399,623],[408,662],[417,700],[423,739],[423,778],[416,814],[404,842],[388,861],[370,870],[350,870],[333,861],[322,846],[315,825],[312,802],[312,775],[311,741],[310,708],[309,678],[315,647],[326,620],[334,593],[335,570],[333,553],[338,539]],[[279,955],[297,950],[312,954],[324,965],[331,980],[332,994],[326,1008],[312,1021],[293,1035],[276,1048],[267,1065],[261,1086],[252,1104],[239,1117],[218,1126],[203,1121],[204,1107],[215,1090],[224,1074],[231,1058],[241,1039],[251,1020],[258,999],[262,979],[268,964]]],mode='hole',uncertainty=2.0,note='Two genuinely separated short-cut areas: the landing fairway and the approach beyond the pond gap. Old north extension was largely unmown rough.')
add(3,'fairway',[[[779,308],[808,286],[846,265],[893,252],[942,244],[996,235],[1050,229],[1101,223],[1149,214],[1184,200],[1219,187],[1246,180],[1275,183],[1299,192],[1322,206],[1340,222],[1344,235],[1333,245],[1314,251],[1289,253],[1265,258],[1239,268],[1211,278],[1178,285],[1140,291],[1103,294],[1068,292],[1031,292],[993,297],[956,304],[921,313],[890,324],[861,338],[835,354],[813,369],[791,377],[777,371],[767,358],[764,339],[767,323]],[[1417,138],[1437,131],[1463,132],[1486,141],[1508,154],[1524,168],[1545,179],[1567,188],[1579,203],[1580,218],[1564,224],[1550,220],[1532,208],[1518,195],[1500,184],[1479,177],[1458,175],[1436,168],[1420,156]]],mode='hole',uncertainty=1.6,note='Landing fairway and bridge-separated approach follow their inner mowing edges. Pond banks, rough collars and the green collar are excluded.')
add(4,'fairway',[[[697,221],[719,208],[744,204],[771,208],[801,218],[836,226],[875,228],[913,233],[950,239],[985,249],[1018,263],[1049,279],[1078,296],[1101,311],[1125,321],[1158,330],[1192,339],[1223,348],[1259,357],[1288,368],[1321,378],[1354,383],[1380,386],[1400,397],[1413,410],[1404,423],[1385,422],[1363,428],[1339,435],[1317,438],[1290,432],[1267,421],[1242,413],[1215,411],[1187,407],[1157,400],[1128,391],[1102,380],[1077,367],[1053,352],[1033,340],[1014,332],[994,334],[976,340],[956,342],[937,338],[916,327],[894,318],[866,313],[839,313],[811,313],[783,309],[760,302],[735,295],[713,285],[695,273],[685,259],[684,244],[689,230]]],mode='hole',uncertainty=1.8,note='Clearly mown fairway starts substantially west of the old polygon and curves around the exposed rock islands. Continuous short-cut entrance to the green retained.')
add(5,'fairway',[[[676,188],[699,179],[724,177],[744,184],[756,197],[756,213],[745,228],[727,241],[708,251],[687,269],[668,291],[649,315],[629,336],[607,354],[581,370],[556,386],[532,406],[507,428],[483,449],[458,468],[430,487],[402,506],[377,525],[355,543],[330,565],[310,590],[296,613],[278,636],[258,650],[238,657],[217,662],[199,672],[182,685],[169,678],[180,657],[199,636],[218,616],[236,593],[251,569],[271,542],[294,514],[322,487],[350,462],[379,438],[406,417],[435,395],[464,373],[490,350],[518,327],[548,306],[578,284],[601,260],[626,234],[650,209]]],mode='hole',uncertainty=2.0,note='Inner fairway cut follows the visible southwest corridor and wraps the rocky island near its upper end; tree shade softens portions of the southeastern edge.')
add(6,'fairway',[[[345,345],[358,348],[369,362],[376,380],[379,398],[387,411],[402,423],[417,438],[426,452],[422,465],[410,474],[397,475],[385,469],[377,459],[374,444],[372,427],[367,408],[360,392],[350,378],[337,371]]],uncertainty=1.5,note='Small closely mown approach tongue adjoining the southeastern green collar; the old polygon occupied rough north of this tongue.')
add(7,'fairway',[[[508,450],[523,445],[538,452],[554,469],[569,489],[589,509],[611,528],[635,548],[655,572],[674,599],[690,627],[705,654],[723,681],[744,709],[766,739],[785,769],[798,805],[805,846],[809,889],[809,933],[805,976],[797,1016],[786,1057],[776,1098],[768,1140],[764,1180],[759,1219],[747,1257],[734,1276],[717,1278],[713,1257],[713,1230],[716,1198],[716,1165],[719,1133],[726,1100],[734,1066],[739,1031],[739,994],[736,959],[733,923],[728,888],[728,854],[724,822],[716,789],[706,763],[694,741],[679,726],[657,715],[635,705],[615,690],[594,672],[571,657],[553,630],[538,601],[528,575],[514,552],[497,535],[486,516],[484,494],[490,474],[498,459]]],mode='hole',uncertainty=2.5,note='Long turning fairway follows the visible mowing boundary around the rock/tree islands. Eastern tree shadows obscure some sections, recorded with 2.5 m delineation uncertainty.')
add(8,'fairway',[[[406,316],[428,311],[447,317],[462,330],[469,346],[469,361],[459,380],[443,395],[422,408],[401,419],[372,432],[344,445],[314,461],[289,480],[269,502],[254,529],[244,559],[234,594],[225,632],[216,672],[210,710],[205,751],[205,790],[208,829],[210,863],[205,895],[199,914],[179,912],[171,890],[167,861],[166,827],[165,793],[166,753],[168,711],[172,670],[178,630],[186,590],[196,551],[211,514],[229,479],[250,448],[274,421],[304,397],[335,372],[362,349],[385,329]]],mode='hole',uncertainty=2.5,note='The true landing fairway begins below the elevated tees, then turns south. The inherited northern strip was rough; eastern boundary has partial tree shade.')
add(9,'fairway',[[[144,232],[156,228],[169,231],[180,237],[192,241],[199,250],[203,260],[199,273],[189,282],[176,287],[161,287],[148,282],[141,273],[139,262],[141,247]]],mode='hole',uncertainty=1.4,note='Par-3 approach is the short-cut tongue immediately south of the green. The former long rectangle was semi-rough between tee and green and had no fairway mowing boundary.')

def main():
    hashes=json.loads(subprocess.check_output(['node','-e',"const fs=require('fs'),c=require('crypto'),m=JSON.parse(fs.readFileSync('johannesbergbuild/course-model.json'));let o={};function h(v){return c.createHash('sha256').update(JSON.stringify(v)).digest('hex')};for(let x of m.holes){o[x.n]={green:h(x.green.ring),fairway:h(x.fairway.rings),tees:h(x.tees.pads.map(p=>p.ring)),bunker:x.bunkers.map(b=>h(b.ring))}}process.stdout.write(JSON.stringify(o))"],cwd=ROOT,text=True))
    result=dict(schemaVersion=1,groundId='johannesberg',course='johannesberg',frame={k:MODEL[k] for k in ['origin','mPerLat','mPerLon']},reviewedOn='2026-09-09',features=[],unresolved=UNRESOLVED)
    overlays={}
    for spec in SPECS:
        window=f'eighteen-{spec["hole"]:02d}-{spec["mode"]}'
        meta=json.loads((CACHE/(window+'.json')).read_text('utf-8'))
        bounds=meta['boundsEpsg3006'];res=meta['resolutionMetres']
        def converted(ring):
            out=[]
            for px,py in ring:
                lon,lat=INVERSE.transform(bounds[0]+px*res,bounds[3]-py*res)
                out.append([round((lon-MODEL['origin']['lon'])*MODEL['mPerLon'],3),round((MODEL['origin']['lat']-lat)*MODEL['mPerLat'],3)])
            return out
        collection=spec['kind'] in ['fairway','tees']
        rings=spec['coords'] if collection else [spec['coords']]
        evidence=dict(sourceFiles=[dict(path='johannesbergbuild/cache/lm-ortho/'+meta['rasterFile'],sha256=meta['sha256']),dict(path='johannesbergbuild/cache/lm-ortho/'+meta['rgbFile'],sha256=meta['rgbSha256'])],sourceCaptureDates=sorted({s['capturedAt'][:10] for s in meta['sources']}),uncertaintyM=spec['uncertainty'],note=spec['note'] or 'Visible sand/turf boundary manually traced at native source resolution.',panelExtent=dict(crs='EPSG:3006',bounds=bounds),panelPixelSize=[meta['width'],meta['height']],pixelConvention='pixel-edge coordinates: E=minE+x*resolution, N=maxN-y*resolution')
        evidence['sourcePixelRings' if collection else 'sourcePixelRing']=spec['coords']
        original=hashes[str(spec['hole'])][spec['kind']]
        if spec['index'] is not None:original=original[spec['index']]
        f=dict(id=f'johannesberg-hole-{spec["hole"]:02d}-{spec["kind"]}'+(f'-{spec["index"]}' if spec['index'] is not None else ''),hole=spec['hole'],kind=spec['kind'],status='accepted',originalRingSha256=original,evidence=evidence)
        if spec['index'] is not None:f['index']=spec['index']
        f['rings' if collection else 'ring']=[converted(r) for r in rings] if collection else converted(rings[0])
        result['features'].append(f)
        if window not in overlays:overlays[window]=Image.open(CACHE/(window+'.png')).convert('RGB')
        d=ImageDraw.Draw(overlays[window]);color={'green':'#00ff66','bunker':'#ff30ff','tee':'#00ffff','tees':'#00ffff','fairway':'#ffee22'}[spec['kind']]
        for ring in rings:d.line([tuple(p) for p in ring+[ring[0]]],fill=color,width=2)
    target=ROOT/'johannesbergbuild/mapping/lm-review-front9.json'
    target.write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n','utf-8')
    for window,img in overlays.items():img.save(CACHE/(window+'-front9-reviewed.png'))
    print(json.dumps(dict(features=len(result['features']),unresolved=len(result['unresolved']))))

if __name__=='__main__':main()
