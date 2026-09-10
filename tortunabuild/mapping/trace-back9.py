"""Manual, provisional observations on retained 2026 national orthophoto crops.

Coordinates below are image pixel edges, not generated course shapes. Source
images stay private; this records the observations and their exact transforms.
"""
import hashlib
import json
from pathlib import Path
from shapely.geometry import Polygon

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'tortunabuild/mapping'
INDEX = {kind: {row['hole']: row for row in json.loads((ROOT / f'tortunabuild/cache/mapping-review/{kind}-index.json').read_text())}
         for kind in ['green', 'tee', 'hole']}
OBS = []

def add(hole, kind, pixels, crop='green', uncertainty=1.5, note=None):
    OBS.append({'hole':hole,'kind':kind,'crop':crop,'pixels':pixels,'uncertainty':uncertainty,'note':note})

# Green boundaries, viewed individually at the unchanged 512 x 512 crop size.
add(10,'green',[[260,205],[277,207],[291,216],[299,231],[299,252],[289,271],[272,285],[251,296],[229,304],[213,296],[204,280],[207,257],[217,235],[236,216]])
add(11,'green',[[239,222],[259,220],[277,227],[294,242],[305,263],[300,282],[283,294],[260,301],[239,296],[220,280],[215,257],[223,236]],uncertainty=4,note='West and south boundary partly hidden in tree shadow; conservative interpreted closure pending human review.')
add(12,'green',[[222,208],[247,206],[270,214],[286,230],[293,249],[291,271],[283,292],[267,307],[247,310],[232,301],[221,284],[214,262],[210,241],[214,221]])
add(13,'green',[[234,214],[252,211],[271,220],[288,237],[299,260],[299,281],[287,296],[268,303],[247,303],[227,294],[213,281],[208,263],[210,243],[219,225]])
add(14,'green',[[235,206],[255,208],[273,222],[286,245],[291,269],[282,293],[266,310],[247,315],[225,309],[212,293],[206,270],[211,248],[221,225]])
add(15,'green',[[226,225],[247,215],[270,213],[287,223],[300,244],[302,264],[296,286],[281,303],[258,312],[234,313],[209,305],[190,291],[181,273],[186,254],[205,237]])
add(16,'green',[[235,220],[260,215],[284,220],[302,235],[308,255],[301,275],[285,291],[263,301],[240,303],[220,296],[205,283],[200,266],[207,245],[220,230]],uncertainty=3,note='Western green edge partly shadowed by adjacent trees; provisional interpretation.')
add(17,'green',[[228,216],[251,209],[272,212],[291,225],[301,244],[302,264],[291,285],[276,299],[255,308],[234,312],[209,308],[190,299],[181,287],[185,268],[196,246],[212,229]])
add(18,'green',[[252,225],[271,219],[285,228],[290,244],[283,265],[271,288],[253,302],[236,300],[223,288],[219,272],[224,253],[237,236]],uncertainty=2)

# Green-side sand: only present, visible outlines from the national image.
add(10,'bunker',[[169,246],[180,246],[184,253],[180,265],[171,277],[163,290],[154,292],[148,286],[148,274],[153,261],[160,251]])
add(10,'bunker',[[235,321],[243,322],[247,329],[246,342],[239,354],[227,362],[213,367],[203,367],[198,362],[200,355],[211,351],[220,347],[226,337],[229,327]])
add(11,'bunker',[[323,288],[331,289],[335,295],[331,304],[326,316],[323,327],[316,332],[304,329],[292,324],[282,317],[284,311],[298,305],[311,295]],uncertainty=2.5,note='Northwest bunker margin meets tree shadow.')
add(12,'bunker',[[186,223],[193,221],[198,228],[199,250],[201,273],[211,293],[215,306],[211,313],[203,315],[194,311],[190,303],[189,281],[184,254],[181,235],[181,229]])
add(12,'bunker',[[299,292],[308,291],[320,285],[331,286],[337,292],[336,301],[330,307],[316,311],[302,311],[296,306],[295,299]])
add(13,'bunker',[[250,318],[263,316],[277,316],[289,313],[296,314],[299,321],[295,328],[281,331],[267,330],[254,332],[246,329],[243,324],[245,320]])
add(14,'bunker',[[323,218],[332,209],[338,207],[342,216],[338,229],[331,242],[325,245],[315,242],[309,236],[310,229]])
add(14,'bunker',[[194,295],[201,296],[210,306],[220,315],[228,326],[229,332],[223,337],[214,337],[205,331],[199,321],[191,311],[189,302]])
add(15,'bunker',[[211,198],[217,190],[225,190],[231,198],[230,205],[223,211],[214,215],[204,225],[198,225],[194,219],[195,212],[200,208]])
add(15,'bunker',[[191,319],[209,320],[229,322],[254,322],[274,320],[283,318],[288,324],[287,334],[283,340],[274,343],[253,342],[228,341],[208,340],[189,340],[183,335],[183,328],[186,322]])
add(16,'bunker',[[279,178],[287,178],[296,183],[302,191],[306,200],[305,205],[300,207],[293,203],[286,197],[279,190],[275,184],[276,180]])
add(16,'bunker',[[331,271],[339,272],[346,279],[351,290],[354,299],[352,305],[346,310],[340,307],[335,300],[332,291],[325,281],[326,275]])
add(17,'bunker',[[172,317],[180,316],[193,320],[205,324],[214,329],[217,334],[214,341],[208,346],[198,348],[183,344],[172,339],[166,332],[164,325],[166,320]])
add(18,'bunker',[[299,250],[307,251],[316,258],[318,265],[314,273],[306,283],[302,298],[296,307],[288,311],[279,308],[276,302],[278,293],[284,282],[288,269],[292,255]])

# Sand elsewhere along observed fairway corridors.
add(10,'bunker',[[312,326],[323,325],[329,327],[331,330],[326,332],[314,332],[309,330],[309,328]],crop='hole',uncertainty=2)
add(12,'bunker',[[337,270],[341,270],[343,274],[344,279],[348,282],[350,287],[347,290],[343,289],[341,284],[337,281],[335,275]],crop='hole',uncertainty=2)
add(12,'bunker',[[383,256],[386,258],[387,264],[389,270],[391,273],[391,277],[388,278],[385,274],[383,268],[382,261]],crop='hole',uncertainty=2)
add(13,'bunker',[[134,207],[139,207],[142,209],[140,212],[135,212],[133,210]],crop='hole',uncertainty=2)
add(13,'bunker',[[118,227],[122,228],[125,231],[125,234],[121,235],[118,232],[116,230]],crop='hole',uncertainty=2)
add(13,'bunker',[[130,228],[135,228],[140,230],[142,233],[139,235],[135,234],[130,233],[128,230]],crop='hole',uncertainty=2)
add(13,'bunker',[[255,227],[260,226],[265,229],[269,231],[267,234],[262,234],[258,232],[253,234],[249,233],[250,230]],crop='hole',uncertainty=2)
add(15,'bunker',[[299,181],[303,180],[308,182],[311,187],[312,191],[309,194],[305,192],[303,189],[299,186]],crop='hole',uncertainty=2)
add(17,'bunker',[[249,182],[253,182],[256,185],[261,188],[263,192],[260,195],[256,195],[253,192],[249,189],[248,186]],crop='hole',uncertainty=2)

# Visible worn/mown tee platforms. Tee colour cannot be recovered from imagery.
add(10,'tee',[[226,267],[252,263],[282,265],[310,267],[338,267],[347,273],[346,284],[330,287],[300,286],[272,285],[248,286],[228,283]],crop='tee',uncertainty=2,note='Back10 platform observed along south edge of the tree belt; source tee reference is nearby, not a surveyed marker.')
add(10,'tee',[[364,267],[401,264],[432,259],[455,260],[470,268],[469,277],[449,282],[420,286],[393,285],[366,280]],crop='tee',uncertainty=2)
add(11,'tee',[[158,265],[182,261],[215,258],[248,253],[262,256],[265,264],[259,273],[234,279],[201,283],[173,287],[158,282]],crop='tee',uncertainty=2)
add(13,'tee',[[149,291],[176,300],[199,317],[225,340],[240,352],[245,366],[238,375],[227,373],[208,359],[187,341],[166,326],[146,312],[140,302]],crop='tee',uncertainty=3,note='Observed southeast-of-pond platform with angled footprint. Colour and source tee point reconciliation remain open.')
add(14,'tee',[[241,210],[255,208],[262,214],[261,242],[263,270],[261,300],[250,303],[242,294],[240,262],[239,234]],crop='tee',uncertainty=2)
add(14,'tee',[[334,357],[346,354],[352,361],[351,391],[356,414],[353,436],[344,441],[337,435],[336,410],[332,386]],crop='tee',uncertainty=2)
add(16,'tee',[[187,326],[216,316],[247,302],[276,289],[295,291],[302,301],[296,312],[267,326],[240,340],[212,349],[191,344]],crop='tee',uncertainty=3,note='Southwest-of-pond observed platform; displaced from GolfTraxx source back-tee point.')
add(17,'tee',[[165,289],[191,277],[218,261],[245,245],[271,232],[286,233],[297,243],[294,253],[266,268],[238,285],[211,302],[190,311],[172,308],[164,300]],crop='tee',uncertainty=2)
add(17,'tee',[[368,151],[392,134],[418,118],[445,103],[462,102],[472,110],[468,121],[444,137],[419,154],[395,170],[378,175],[368,167]],crop='tee',uncertainty=2)
add(18,'tee',[[221,264],[234,248],[255,233],[276,220],[287,223],[293,235],[287,247],[268,262],[246,279],[230,286],[221,280]],crop='tee',uncertainty=2)
add(18,'tee',[[230,132],[241,135],[248,150],[249,171],[245,190],[236,200],[226,194],[224,174],[226,151]],crop='tee',uncertainty=3,note='Narrow forward platform beside the cart path; interpreted maintained edge.')

# Fairway/approach outlines at the larger hole-crop scale. Rough transitions are
# lower-confidence than sand and putting surfaces; no procedural widening.
add(10,'fairway',[[177,307],[192,297],[211,294],[230,300],[251,308],[273,311],[294,309],[315,298],[337,285],[356,272],[370,257],[381,244],[389,236],[399,239],[399,251],[391,267],[379,280],[364,294],[346,309],[326,320],[304,327],[285,329],[264,326],[244,321],[225,316],[204,313],[185,315]],crop='hole',uncertainty=5,note='Conservative maintained strip around the southern edge of the hole; dry spring grass makes its inner rough transition uncertain.')
add(11,'fairway',[[132,286],[141,279],[151,279],[162,287],[166,299],[163,310],[152,318],[141,316],[132,307]],crop='hole',uncertainty=4,note='Short approach apron adjacent to partly shadowed green; no invented full-length par3 fairway.')
add(12,'fairway',[[282,363],[294,352],[309,344],[324,334],[338,323],[352,315],[364,309],[368,302],[366,293],[359,281],[350,269],[341,255],[334,237],[329,215],[328,195],[323,177],[316,159],[311,140],[309,120],[313,102],[326,101],[334,114],[339,133],[344,150],[350,169],[357,186],[363,206],[367,227],[374,245],[385,262],[393,282],[391,297],[382,311],[365,323],[348,336],[331,349],[310,363],[295,371],[286,371]],crop='hole',uncertainty=4,note='Two-leg maintained corridor follows current imagery around dogleg; adjoining rough is not promoted to fairway.')
add(13,'fairway',[[93,196],[115,197],[139,198],[160,199],[183,200],[208,196],[231,195],[254,192],[272,198],[293,207],[312,219],[329,231],[347,242],[366,253],[382,263],[392,271],[385,281],[373,281],[356,275],[338,266],[320,254],[302,246],[281,236],[263,223],[249,218],[231,219],[214,224],[192,227],[169,225],[150,221],[130,217],[111,215],[94,214]],crop='hole',uncertainty=4)
add(14,'fairway',[[206,183],[225,181],[246,186],[265,195],[281,211],[289,229],[289,247],[275,250],[259,235],[241,222],[219,215],[206,199]],crop='green',uncertainty=3,note='Short visible approach between pond and green; overlaps green priority area at southern edge.')
add(15,'fairway',[[157,238],[165,220],[174,197],[186,176],[201,160],[219,150],[237,149],[253,154],[271,162],[289,167],[308,171],[327,177],[348,183],[369,182],[386,183],[394,193],[387,203],[373,206],[355,202],[334,197],[312,190],[291,184],[271,180],[249,179],[231,176],[215,176],[201,188],[190,205],[181,224],[172,242],[161,247]],crop='hole',uncertainty=4,note='Observed dogleg around rough/construction land; exact spring cut transition provisional.')
add(16,'fairway',[[129,333],[151,326],[177,311],[202,296],[226,282],[248,269],[271,254],[294,239],[317,225],[338,211],[359,195],[380,181],[398,172],[414,164],[427,165],[433,171],[428,180],[410,189],[392,201],[371,216],[350,232],[330,249],[308,264],[284,280],[258,295],[232,310],[207,325],[182,341],[157,351],[137,349]],crop='hole',uncertainty=4)
add(17,'fairway',[[157,278],[171,259],[188,242],[210,224],[229,211],[250,202],[271,190],[292,179],[315,169],[339,159],[363,150],[385,149],[399,155],[401,165],[390,172],[371,174],[353,179],[331,185],[309,193],[289,205],[270,216],[253,228],[233,245],[214,259],[194,275],[178,284],[164,286]],crop='hole',uncertainty=5,note='Conservative current mowing strip north of water-edge tree belt; dry spring cut transition remains provisional.')
add(18,'fairway',[[145,365],[139,353],[146,337],[159,319],[171,300],[183,282],[199,264],[214,246],[229,226],[245,205],[264,183],[281,164],[297,149],[313,133],[326,126],[334,136],[331,151],[322,170],[307,190],[290,211],[274,231],[258,250],[241,272],[224,293],[207,315],[190,337],[174,360],[158,372]],crop='hole',uncertainty=5,note='Observed diagonal mowing corridor west of cart path and east of pond; spring grass cut transition provisional.')

features = []
counts = {}
for obs in OBS:
    row = INDEX[obs['crop']][obs['hole']]
    src = ROOT / row['file']
    if hashlib.sha256(src.read_bytes()).hexdigest() != row['sha256']:
        raise ValueError(f"Review crop changed: {src}")
    west, south, east, north = row['boundsEpsg3006']
    ring = [[round(west+x*(east-west)/row['width'],3),round(north-y*(north-south)/row['height'],3)] for x,y in obs['pixels']]
    ring.append(ring[0])
    polygon = Polygon(ring)
    if not polygon.is_valid or polygon.area < 2:
        raise ValueError(f"Invalid trace {obs['hole']} {obs['kind']}: {polygon.area}")
    key = f"tortuna-h{obs['hole']:02}-{obs['kind']}"
    counts[key] = counts.get(key,0)+1
    features.append({'type':'Feature','id':f'{key}-{counts[key]:02}',
      'properties':{'id':f'{key}-{counts[key]:02}','kind':obs['kind'],'hole':obs['hole'],
        'sourceId':'imagery-lm-ortho','sourceFeatureId':f'{key}-{counts[key]:02}',
        'sourceCrop':row['file'],'sourceCropSha256':row['sha256'],'sourceWindows':row['sourceWindows'],
        'method':'manual-orthophoto-interpretation','observedOn':'2026-09-09',
        'reviewStatus':'agent-visual-review; human-review-pending','accuracyStatus':'interpretation-estimate; not-surveyed',
        'horizontalUncertaintyMetres':obs['uncertainty'],'boundaryNote':obs['note'],
        'areaSquareMetres':round(polygon.area,2),'originalPixels':obs['pixels'],
        'cropBoundsEpsg3006':row['boundsEpsg3006'],'cropSize':[row['width'],row['height']]},
      'geometry':{'type':'Polygon','coordinates':[ring]}})
collection = {'type':'FeatureCollection','name':'Tortuna back nine provisional observed surfaces',
  'crs':{'type':'name','properties':{'name':'EPSG:3006'}},'horizontalCrs':'EPSG:3006',
  'notes':['No human approval, stem survey or current coloured tee census is claimed.',
           'H12 and H15 tee pads remain unresolved here; source reference positions must not generate synthetic pads.',
           'H11/H16 partial green shadows are explicit interpreted closures.'],
  'features':features}
(OUT/'surfaces-back9.geojson').write_text(json.dumps(collection,indent=2)+'\n',encoding='utf8')
print(json.dumps({'features':len(features),'kinds':{kind:sum(f['properties']['kind']==kind for f in features) for kind in ['green','tee','fairway','bunker']},'areaSquareMetres':round(sum(f['properties']['areaSquareMetres'] for f in features),2)}))
