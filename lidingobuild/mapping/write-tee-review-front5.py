"""Retained manual observations on the native 2025 tee windows (pixel edges)."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
holes = []

def hole(n, pads, markers, note=''):
    platforms = [dict(id=f'lidingo-tee-{n:02d}-{letter}-lm2025', pixels=points,
                      uncertaintyMetres=uncertainty, note=description)
                 for letter, points, uncertainty, description in pads]
    records = [dict(platformId=f'lidingo-tee-{n:02d}-{letter}-lm2025', pixel=point)
               for letter, point in markers]
    holes.append(dict(hole=n, windowId=f'lidingo-{n:02d}-tees',
        association='Club-linked guide platform grouping and order corroborated with native 2025 turf; representative starts, not measured daily markers.',
        note=note, platforms=platforms, markers=records))

hole(1, [
 ('a', [[233,307],[315,269],[335,267],[348,276],[357,300],[358,332],[348,345],[276,375],[250,375],[235,362],[225,340],[225,323]],1,'Main rear platform; white/yellow at rear and blue forward.'),
 ('b', [[293,538],[315,527],[326,532],[337,549],[345,579],[340,591],[322,600],[308,597],[299,581],[293,558]],1,'Separate forward red/orange platform south of crossing path, omitted by previous model.')],
 [('a',[279,313]),('a',[279,313]),('a',[308,342]),('b',[311,548]),('b',[324,582])])

hole(2, [
 ('a', [[253,333],[264,327],[283,335],[299,350],[309,371],[307,382],[295,389],[279,388],[262,377],[252,363],[249,346]],1,'White tee northwest of the path; old main pad association moved to a non-tee area.'),
 ('b', [[268,548],[280,541],[291,546],[298,560],[300,577],[292,588],[280,587],[269,578],[262,561]],1.5,'Small yellow platform partly shaded by tree.'),
 ('c', [[306,618],[318,609],[329,611],[343,624],[356,647],[363,667],[360,680],[349,688],[336,685],[324,673],[315,656],[304,636]],1,'Additional physical long platform beside path, no current colour assignment in guide.'),
 ('d', [[580,773],[591,758],[615,751],[638,753],[653,770],[660,794],[657,811],[645,825],[620,834],[598,832],[588,818],[583,796]],1,'Blue/red shared platform south of crossing path; previously missing.'),
 ('e', [[807,1067],[821,1056],[837,1058],[850,1069],[859,1092],[859,1111],[851,1124],[838,1131],[823,1126],[813,1110],[807,1086]],1.5,'Small forward orange platform beside fairway and eastern path; previously missing.')],
 [('a',[280,362]),('b',[281,567]),('d',[618,790]),('d',[618,790]),('e',[834,1094])],
 'Retire old hole2 a: that area is beside the hole4 approach, not the hole2 white platform. A third pathside physical platform is retained without colour furniture.')

hole(3, [
 ('a', [[463,619],[478,607],[493,602],[509,607],[521,620],[533,643],[539,657],[534,671],[524,681],[510,687],[495,684],[484,673],[473,656],[465,638]],1,'Rear white platform east of pond.'),
 ('b', [[458,414],[480,396],[497,389],[516,395],[534,410],[550,429],[556,446],[551,466],[536,483],[518,491],[504,489],[487,479],[471,462],[458,443],[453,426]],1,'Middle yellow platform, edge differs from coarse OSM.'),
 ('c', [[334,288],[346,270],[358,259],[372,260],[389,269],[410,287],[426,306],[432,323],[428,338],[415,352],[399,357],[384,352],[366,339],[347,322],[335,306]],1,'Forward blue/red/orange platform with distinguishable mown edge.')],
 [('a',[502,650]),('b',[508,451]),('c',[408,329]),('c',[380,302]),('c',[370,289])])

hole(4, [
 ('a', [[948,1145],[952,1133],[963,1119],[976,1117],[989,1125],[1000,1143],[1002,1163],[997,1179],[985,1190],[972,1187],[962,1176],[954,1161]],1,'Rear white platform; mow edge inset from historical outline.'),
 ('b', [[764,867],[770,857],[781,854],[793,863],[800,882],[813,913],[829,947],[846,977],[850,992],[844,1004],[833,1010],[821,1004],[808,989],[795,963],[784,936],[774,905],[765,885]],1,'Long yellow/blue platform; trace current inner maintained edge, not slope apron.'),
 ('c', [[577,661],[583,649],[594,651],[608,665],[621,682],[632,695],[633,704],[625,713],[614,713],[602,703],[590,688],[582,676]],1,'Forward red platform inside path bend.')],
 [('a',[977,1155]),('b',[831,980]),('b',[785,877]),('c',[602,681]),('c',[602,681])],
 'Orange guide site lies beside the fairway beyond the red platform; in 2025 it is not separable as a complete tee platform. Do not invent a raised tee from the guide.')
holes[-1]['markers'][-1].update(unresolved=True, reason='Orange guide site is continuous fairway mowing in 2025; a distinct full tee boundary and precise reference cannot be confirmed. Camera fallback remains on reviewed red turf.')

hole(5, [
 ('a', [[295,287],[308,279],[325,284],[340,292],[353,305],[359,321],[350,336],[333,346],[317,345],[305,334],[295,319],[290,303]],2,'Main white/yellow/blue platform. Tree shadow conceals the northeast edge; conservative visible maintained portion only.'),
 ('b', [[203,419],[209,408],[222,400],[235,402],[245,410],[252,423],[251,438],[242,451],[229,461],[216,459],[206,452],[202,438]],1,'Red/orange platform west of path, missing from old model.')],
 [('a',[322,301]),('a',[322,301]),('a',[325,327]),('b',[229,417]),('b',[225,437])])

holes[-1]['platforms'][0]['extentStatus'] = 'visible-maintained-subset; full-platform-boundary-unresolved'
# Independent full-guide and expanded-image review identifies H4 Orange on
# the existing H2 White deck. Preserve that exact physical footprint, with a
# separate per-hole colour association; never construct a scorecard-fitted pad.
plan = json.loads((ROOT/'geo_data/course-v2/lidingo/reference/lm-ortho-plan-2026-09-09.json').read_text(encoding='utf8'))
h2, h4 = holes[1], holes[3]
w2 = next(w for w in plan['windows'] if w['id'] == h2['windowId'])
w4 = next(w for w in plan['windows'] if w['id'] == h4['windowId'])
def h2_to_h4(p):
    e = w2['boundsEpsg3006'][0] + p[0]*.16
    n = w2['boundsEpsg3006'][3] - p[1]*.16
    return [round((e-w4['boundsEpsg3006'][0])/.16, 8), round((w4['boundsEpsg3006'][3]-n)/.16, 8)]
shared_id = 'lidingo-tee-04-d-lm2025'
h4['platforms'].append(dict(id=shared_id, pixels=[h2_to_h4(p) for p in h2['platforms'][0]['pixels']],
    uncertaintyMetres=1, note='Orange H4 shares the clearly bounded H2 white platform southwest of the H4 fairway tip. Full guide topology and native imagery independently corroborate the shared deck.'))
h4['markers'][4] = dict(platformId=shared_id, pixel=h2_to_h4([265,346]),
    association='Full club H4 guide shows Orange at the H2 White deck; representative position inside its observed footprint, daily placement unknown.')
h4['sharedPlatforms'] = [dict(platformId=shared_id, samePhysicalPlatformAs=h2['platforms'][0]['id'])]
h4['note'] = 'Orange shares H2 White deck beside the H4 fairway tip; independent expanded-image/full-guide review resolves the previous uncertainty.'
h4['independentReview'] = 'lidingobuild/mapping/tee-review-forward-2026-09-09.json'
(ROOT/'lidingobuild/mapping/tee-review-front5.json').write_text(
    json.dumps(dict(holes=holes),indent=2)+'\n',encoding='utf8')
