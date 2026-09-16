"""Persist the 33 contact sheets actually inspected in this pilot.

This is a source/representation inspection, not a claim that every stem was
identified. Detailed crown decisions live in corrections.geojson separately.
"""
from prepare import *

NOTES={
1:'Tiny owned sliver; neighbouring roofs and gardens are context.',2:'Open field/path; fringe crown only.',
3:'Power-line returns cross northern strip; shed outside/at fringe. No tree inference from linear returns.',
4:'Open lake.',5:'Lake and reed bank, no interpretable tall trees.',6:'Shore woodland with distinct edge lobes; density interior.',
7:'Dense mixed woodland at western belt.',8:'Woodland and path edge; keep opening.',9:'Separated crowns along paths and green; individual review priority.',
10:'Northern power-line corridor and lower separated crowns; wires are not trees.',11:'Lake/reed margin.',12:'Island green, water and east woodland edge.',
13:'Western closed canopy and separated play-side crowns.',14:'Dense western stand, isolated eastern edge trees.',15:'Open playing surface with southern woodland.',
16:'Low pond-edge vegetation; older imagery alone insufficient for trees.',17:'Wooded road verge and power-line returns; small structure separate.',
18:'Tiny owned northern tip; most visible woodland outside scope.',19:'Lake/reed fringe, small owned land.',20:'Water voids dominate; only southern shore crowns.',
21:'Lake and bare bank; no new shoreline trees.',22:'Woodland island beside playing ground; dense core and separated edge crowns.',
23:'Path crossroads and scattered low crowns; distinct individual priority.',24:'Narrow tree row between paths; retain small gaps.',25:'Several narrow tree rows and clear paths.',
26:'Pond-edge low crowns plus southeast group.',27:'Power lines north of road and distinguishable southern trees.',28:'Narrow belt through dense conifer woodland.',
29:'Dense woodland belt; no exhaustive individual stem interpretation.',30:'Dense woodland belt continued.',31:'Connected mixed woodland in clipped facility corner.',
32:'Pond shore, isolated crowns and southern woodland; voids remain unknown.',33:'Riparian row separated from fairway by stream.',34:'Treeless pond, grass and bridge.',
35:'Dense wooded island and bare playing surface.',36:'Broken woodland edge beside grass; small gaps are material.',37:'Groups with open path/tee corridors.',
38:'Open green and road, trees on eastern edge.',39:'Power-line corridor crosses cell; very small owned tree area.',40:'Shore woodland within extended southern belt.',
41:'Dense conifers alongside narrow cleared linear corridor.',42:'Dense stand west, narrower fairway tree belt east.',43:'Two wooded belts separated by visible cleared corridor.',
44:'Dense west woodland and play-side tree row.',45:'Dense woodland and narrower edge row.',46:'Dense clipped woodland belt.',47:'Dense woodland around tee/path and small roof.',
48:'Pond, reed margin and open tee; no automatic reed promotion.',49:'Narrow low tree belt through open golf ground.',50:'Separated low crowns along northeast boundary; isolated southwest tree.',
51:'Woodland strips and clear playing gap.',52:'Mixed dense woodland at edge of green.',53:'Woodland groups separated by path and open ground.',54:'Road/woodland, utility returns at northern edge.',
55:'Tiny owned open utility strip; visible peripheral trees mostly out of scope.',56:'Dense southern woodland belt.',57:'A few isolated crowns in open grass.',58:'Connected woodland island with distinct boundary.',
59:'Narrow tree rows and isolated crowns around bunker/path.',60:'Low scattered crowns beside short-course ground.',61:'Low tree row and a larger tree group beside green.',
62:'Open green with narrow western tree belt.',63:'Connected woodland belt and small openings beside tee/path.',64:'Continuous woodland edge under open grass.',65:'Two isolated low crowns in otherwise open ground.',
66:'Open playing ground; peripheral low crowns.',67:'Paths divide groups; retain gaps and crown groups.',68:'Open fairway enclosed by woodland.',69:'Boundary crosses woodland and neighbouring cultivated plots; cultivation is not woodland.',
70:'Dense mixed woodland southern belt.',71:'Open fairway with eastern woodland edge.',72:'Open playing surface with small peripheral crown groups.',73:'Short-course tree island with separated north crowns.',
74:'Several crown groups separated by paths; dense interiors.',75:'Short-course isolated crowns and taller eastern group.',76:'Green surrounded by connected canopy, clear paths.',77:'Dense forest row and path gap.',
78:'Open fairway and low disconnected west crowns.',79:'Greens/bunkers/open turf; low image-only tree remains unresolved.',80:'Distinguishable group in open ground, some crowns remain stand represented.',
81:'Open ground and a few southwest crowns.',82:'Woodland and neighbouring roofs; preserve roof exclusions.',83:'Tiny owned edge; neighbouring garden plots are context.',84:'Dense woodland in small clipped corner.',
85:'Rock/open patches within woodland; retain visible gaps.',86:'Woodland edge against fairway.',87:'Mixed woodland edge with individual conifer tops.',88:'Path/tree row around open green.',
89:'Open golf surface with scattered edge crowns.',90:'Trees bordering short-course green; path gap visible.',91:'Large roof alongside woodland; elevated roof is not canopy.',92:'Treeless pond and played ground.',
93:'One distinguishable northwest crown in open cell.',94:'Sparse low tree row beside path.',95:'Open golf ground and neighbouring yard edge.',96:'Boundary crosses gardens/roofs; only owned fringe is considered.',
97:'Dense woodland within southern extension.',98:'Evaluation woodland edges; protected from correction.',99:'Fairway bounded by woodland and separated edge crowns.',100:'Long wooded belt separating grass areas.',
101:'Range bays, low scrub and few taller southwest crowns; roof returns separate.',102:'Small wooded group, individual path-side crowns and open practice ground.',
103:'Buildings/green/woodland together; retain roof and turf exclusions.',104:'Open golf surface and pond; sparse low trees.',105:'Open golf ground; northeastern woodland fringe.',
106:'Narrow road-edge trees and neighbouring rocky slope.',107:'Road/tree verge clipped by boundary, utility/linear returns not trees.',108:'Tiny owned sliver in rocky terrain; no tall owned canopy.',
109:'Southern dense woodland belt.',110:'Rocky clearings and woodland; evaluation protected.',111:'Woodland around playing ground; distinguishable edge versus dense core.',
112:'Open driving range with west woodland edge.',113:'Open range and northeast woodland; low heights unresolved.',114:'Practice building and woodland east of green/path.',
115:'Campus roofs, court, separate crowns and southern woodland.',116:'Clubhouse/parking roofs remain excluded; distinguishable trees beside them.',117:'Woodland near neighbouring houses; boundary controls review only.',
118:'Clipped property/roof fringe; do not infer facility use.',119:'Power-line clearing crosses southern belt; linear height returns are not crowns.',120:'Dense woodland around green and a small structure.',
121:'Mixed dense woodland with interior open patch; retain gap.',122:'Rocky margin of driving range and woodland edge; no tree on bare rock from imagery alone.',
123:'Woodland in eastern belt; some low/uncertain edge vegetation.',124:'Small clipped area of continuous woodland.',125:'Dense canopy east of campus, overlapping crowns remain a stand.',
126:'Car park, two isolated crowns and wooded eastern edge; roof/parking stays clear.',127:'Dense woodland in clipped northern corner; preserve density interior.',
128:'Tiny owned woodland sliver at eastern edge.',129:'Woodland and utility clearing in clipped eastern strip; wires not trees.',
130:'Clipped woodland edge with utility corridor to southeast.',131:'Small owned strip of dense woodland.',
}

def main():
 cells=read(DOC/'coverage-source-inventory.geojson')
 assert len(NOTES)==len(cells['features']), 'Every inspected cell needs an explicit note'
 for i,f in enumerate(cells['features'],1):
  sheet=OUT/f'review/contact-{(i-1)//4+1:02}.png';p=f['properties']
  p.update(inspected=True,status='source-inspected-with-placement-exceptions',inspectionNote=NOTES[i],
    contactSheet=sheet.relative_to(OUT).as_posix(),contactSheetSha256=digest(sheet),
    inspectedLayers=['RGB 2024','CIR 2024','LiDAR height 2026','baseline individual centres'],
    individualVerification='Detailed sampled decisions only; remaining identities are not certified',
    representation='Density woodland where crowns overlap; source-reviewed individuals where distinguishable; open/unknown retained',
    inspector='agent-visual-review',inspectionDate='2026-09-16')
 save(DOC/'coverage-inspection.geojson',cells)
 print('Recorded',len(cells['features']),'visual source inspections')

if __name__=='__main__':main()
