"""Explicit orthophoto facility and water traces, with reproducible pixel affines."""
import json,math
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
CACHE=ROOT/'nvgkbuild/cache/lm-ortho'
sources={}
def panel(source_id,width=None,height=None,crop=None):
    source=json.loads((CACHE/f'{source_id}.json').read_text());sources[source_id]=source
    x,y,w,h=crop or [0,0,source['width'],source['height']]
    width=width or w;height=height or h;t=source['geoTransform']
    return {'id':source_id+'-environment','sourceId':source_id,'sourceSha256':source['sha256'],
      'geoTransform':[t[0]+x*t[1],w*t[1]/width,0,t[3]+y*t[5],0,h*t[5]/height],
      'width':width,'height':height,'sourcePixelWindow':[x,y,w,h]}
im=Image.open(ROOT/'nvgkbuild/cache/environment-review/facilities-half.png')
fac=panel('facilities-range',im.width,im.height)
mats=panel('facilities-range',crop=[570,760,170,250])
features=[]
def add(identifier,kind,pixels,p=fac,**extra):
    t=p['geoTransform'];key='line' if kind in ['path','ditch'] else 'ring'
    f={'id':identifier,'kind':kind,'sourceId':p['sourceId'],'panel':p,key+'Pixels':pixels,
      key+'Epsg3006':[[round(t[0]+q[0]*t[1],6),round(t[3]+q[1]*t[5],6)] for q in pixels],
      'evidence':'Manual trace of visible 2024-06-27 orthophoto boundaries; heights and obscured details are not measured by this image.',**extra}
    features.append(f);return f
add('lm-range-field','range',[[336,389],[359,366],[399,342],[445,316],[493,288],[543,262],[595,237],[649,219],[704,207],[760,201],[815,190],[865,179],[912,173],[952,182],[984,205],[1002,240],[1008,282],[1009,329],[1012,377],[1009,425],[1001,463],[984,490],[950,509],[906,521],[856,531],[800,535],[745,536],[690,539],[636,543],[582,547],[530,549],[481,548],[435,541],[398,526],[373,503],[356,473],[345,439]])
add('lm-practice-green','practice_green',[[274,272],[285,267],[297,268],[307,277],[312,289],[311,304],[305,318],[296,328],[284,332],[275,328],[270,321],[270,311],[274,300],[278,287]])
add('lm-range-hardstanding','paved_path',[[315,395],[323,393],[329,411],[333,435],[341,459],[357,491],[349,496],[337,472],[327,448],[322,424]],material='unverified-hard-surface')
for i,(x,y) in enumerate([(74,35),(77,52),(81,69),(86,86),(90,102),(96,121),(101,137),(107,153),(114,171),(121,188),(130,207),(137,223)]):
    pixels=[[round(x+5*math.cos(a*math.pi/4),2),round(y+5*math.sin(a*math.pi/4),2)] for a in range(8)]
    add(f'lm-range-mat-{i+1:02d}','range_mat',pixels,mats,material='green-artificial-turf')
for identifier,pixels in [('near',[[465,441],[476,438],[488,442],[491,450],[486,458],[475,459],[465,452]]),('centre',[[519,326],[556,317],[564,344],[526,353]]),('far-strip',[[822,323],[915,317],[917,333],[824,339]])]:
    add('lm-range-target-'+identifier,'range_target_surface',pixels,material='unverified-turf-surface')
add('lm-padel-court','sports_court',[[68,104],[99,101],[105,162],[74,165]],material='blue-sports-surface')
add('lm-range-access-path','path',[[347,353],[348,369],[328,389],[313,395]],width=1.5)
add('lm-range-drain','ditch',[[925,150],[971,163],[1016,183],[1031,230],[1040,277],[1043,330],[1044,386],[1036,446],[1019,493],[993,525]],width=1.0)
# Roof sections keep the surveyed OSM wall footprint. The source supports roof
# plan and solar-panel extents; pitch/eave heights remain display estimates.
add('lm-clubhouse-main-roof','clubhouse_roof_section',[[162,139],[189,124],[214,167],[187,183]],ridgeAxis='long',eaveHeight=3.6,ridgeHeight=5.8)
add('lm-clubhouse-cross-roof','clubhouse_roof_section',[[191,129],[210,119],[226,145],[207,157]],ridgeAxis='short',eaveHeight=3.6,ridgeHeight=5.7)
add('lm-clubhouse-solar-north','roof_solar',[[167,142],[177,137],[184,149],[174,154]])
add('lm-clubhouse-solar-south','roof_solar',[[177,158],[187,153],[197,169],[187,175]])
add('lm-clubhouse-terrace','terrace',[[213,151],[221,147],[230,162],[219,169]],height=0.7)
add('lm-range-shelter','building',[[305,458],[342,482],[321,510],[285,485]],height=3.0,roofHeight=4.7)
add('lm-practice-shed','building',[[355,290],[382,299],[373,326],[347,317]],height=2.5,roofHeight=3.8)
# Water outlines use the already inspected whole-hole panel affines.
def hp(n):return json.loads((ROOT/f'nvgkbuild/cache/lm-review/{n:02d}-hole.json').read_text())
add('lm-pond-14','water',[[359,585],[380,568],[410,578],[448,603],[480,620],[511,647],[519,682],[523,726],[538,752],[570,778],[607,797],[641,814],[682,832],[717,852],[746,878],[772,909],[798,945],[817,976],[815,1007],[795,1014],[773,993],[750,970],[722,947],[692,931],[665,925],[639,939],[623,969],[607,1003],[588,1043],[570,1074],[549,1083],[526,1078],[509,1056],[499,1028],[488,1003],[470,988],[448,975],[426,953],[407,938],[384,937],[359,943],[337,940],[319,922],[307,894],[302,861],[302,825],[309,788],[321,752],[335,716],[346,680],[350,640]],hp(14),replaceNearHole=14)
add('lm-pond-17','water',[[918,1039],[937,1023],[965,1009],[998,988],[1025,988],[1049,1001],[1058,1029],[1063,1064],[1073,1098],[1082,1132],[1089,1166],[1101,1196],[1106,1220],[1098,1238],[1079,1247],[1055,1247],[1026,1240],[1003,1228],[985,1205],[972,1177],[960,1150],[950,1122],[937,1096],[921,1073]],hp(17),replaceNearHole=17)
for n in [14,17]:sources[f'norrfallsviken-{n:02d}-hole']=json.loads((CACHE/f'norrfallsviken-{n:02d}-hole.json').read_text())
review={'schemaVersion':1,'groundId':'norrfallsviken','reviewedOn':'2026-09-09','captureDate':'2024-06-27','sources':list(sources.values()),'features':features,
 'retainedObservations':['Storsanden beach and the eastern rocky coastline agree with the OSM broad outlines in the inspected native orthophotos; shoreline remains a dated waterline, not a survey control.',
 'The 2025 laser individual crowns and stand fields already cover the course forest; no invented individual trees are introduced.',
 'Range target shapes are observed surfaces; their current range distances and target labels are not identified.',
 'Clubhouse wall footprint remains OSM because roof lean cannot determine a footprint correction. Roof geometry is an image-based display model; heights, windows and terrace elevation remain estimates.']}
(ROOT/'nvgkbuild/mapping/review-environment-2026-09-09.json').write_text(json.dumps(review,indent=2)+'\n',encoding='utf-8',newline='\n')
