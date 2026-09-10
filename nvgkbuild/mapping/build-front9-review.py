"""Retain manually reviewed orthophoto pixel outlines and derive grid vertices.

Pixel lists were read against the native crop panels from review-panels.py;
no automatic classification or fitted shift is applied.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PANELS = ROOT/'nvgkbuild/cache/lm-review'
CACHE = ROOT/'nvgkbuild/cache/lm-ortho'
holes = {n:{'hole':n,'notes':'Visible mowing boundaries reviewed in the 2024-06-27 orthophoto. Movable tee colours and daily cup positions are not surveyed.'} for n in range(1,10)}


def feature(n,kind,pixels,identifier=None,panel_name=None,evidence=None):
    panel_name=panel_name or f'{n:02d}-'+('tees' if kind=='tee' else 'green')
    panel=json.loads((PANELS/f'{panel_name}.json').read_text())
    t=panel['geoTransform']
    return {'id':identifier or f'lm-h{n:02d}-{kind}','sourceId':panel['sourceId'],
            'evidence':evidence or 'Manual trace of the putting-surface mowing break; surrounding collar is excluded.',
            'panel':panel,'ringPixels':pixels,
            'ringEpsg3006':[[round(t[0]+p[0]*t[1]+p[1]*t[2],6),round(t[3]+p[0]*t[4]+p[1]*t[5],6)] for p in pixels]}


greens={
1:[[159,181],[169,169],[188,158],[210,157],[230,165],[243,181],[252,204],[259,232],[265,258],[260,278],[249,291],[232,300],[214,299],[198,289],[184,268],[174,244],[165,220],[157,198]],
2:[[166,187],[185,176],[208,173],[231,178],[251,188],[264,204],[269,225],[263,244],[248,260],[231,271],[211,269],[192,259],[178,246],[167,228],[162,206]],
3:[[157,198],[174,188],[196,182],[222,181],[245,187],[261,201],[267,220],[267,240],[259,258],[243,271],[222,279],[199,279],[180,273],[165,262],[155,248],[150,231],[150,214]],
4:[[77,222],[93,202],[119,184],[143,173],[165,153],[185,135],[211,127],[237,131],[264,142],[287,162],[304,184],[314,209],[315,238],[307,260],[291,281],[274,295],[252,296],[230,287],[207,279],[188,276],[169,279],[149,291],[130,301],[108,303],[90,293],[78,276],[72,256],[72,240]],
5:[[120,236],[136,224],[160,218],[191,211],[229,207],[260,201],[285,183],[310,165],[336,156],[359,154],[379,162],[392,178],[400,202],[399,222],[391,240],[377,252],[354,264],[331,272],[300,273],[271,270],[247,268],[225,271],[203,278],[181,283],[158,289],[143,287],[131,278],[123,263],[119,250]],
6:[[176,191],[189,179],[207,174],[225,176],[241,185],[253,200],[263,221],[270,245],[267,269],[257,286],[241,297],[222,300],[202,296],[184,285],[174,271],[169,251],[168,228],[170,207]],
7:[[179,189],[198,179],[225,173],[254,166],[281,160],[305,159],[328,166],[343,181],[349,198],[347,216],[337,231],[316,246],[293,258],[267,267],[240,272],[216,270],[195,263],[178,252],[168,238],[165,222],[169,207]],
9:[[166,249],[178,231],[195,214],[216,195],[235,188],[253,190],[270,201],[285,222],[300,239],[309,257],[308,276],[299,289],[283,295],[265,296],[243,295],[218,298],[197,307],[180,306],[166,296],[159,281],[160,264]]}
for n,pixels in greens.items():holes[n]['green']=feature(n,'green',pixels)
holes[4]['green']['id']='lm-shared-green-04-08'
holes[4]['green']['evidence']='One continuous bean-shaped putting surface with two lobes and a mown connecting neck. The club local rules independently identify the shared H4/H8 green.'
holes[8]['green']={**holes[4]['green']}
for n,pixel in [(4,[242,214]),(8,[127,249])]:
    g=holes[n]['green'];t=g['panel']['geoTransform']
    g['pointPixels']=pixel
    g['pointEpsg3006']=[round(t[0]+pixel[0]*t[1],6),round(t[3]+pixel[1]*t[5],6)]
    holes[n]['notes']+=' Shared H4/H8 putting surface; reference is the centre of its respective lobe, not a verified daily cup.'
holes[1]['bunkers']=[feature(1,'bunker',[[120,274],[124,268],[135,265],[145,267],[154,272],[162,280],[174,283],[182,289],[187,299],[183,309],[173,316],[161,320],[150,319],[142,312],[135,308],[128,306],[122,300],[119,291]],evidence='Clearly bounded pale sand immediately southwest of H1 green, with a recessed face and rounded edge. The old model omitted this bunker.')]

# Complete visible platform sets. These are mowing breaks, not padded rectangles
# around card-derived references. Trees and connecting paths are excluded.
tees={
1:[[[163,416],[177,410],[207,403],[233,401],[247,406],[250,418],[244,429],[222,438],[193,446],[173,448],[163,441]]],
2:[[[201,199],[212,180],[230,165],[248,168],[263,181],[261,202],[250,222],[237,244],[223,256],[207,253],[198,240],[197,221]],[[164,265],[171,256],[185,260],[190,272],[182,289],[173,296],[162,290],[159,279]]],
3:[[[158,157],[174,144],[184,146],[198,165],[209,190],[222,218],[239,245],[250,269],[242,281],[226,284],[211,270],[199,249],[189,224],[177,200],[164,177]]],
4:[[[425,967],[434,951],[452,952],[470,966],[483,992],[485,1015],[477,1030],[461,1037],[444,1031],[431,1014],[425,989]],[[416,691],[426,679],[440,678],[451,689],[457,708],[454,727],[446,741],[433,744],[422,734],[416,715]]],
5:[[[247,188],[258,188],[272,197],[288,213],[302,233],[301,244],[286,255],[273,244],[259,225],[248,208]],[[311,266],[322,256],[339,261],[356,277],[369,295],[365,308],[351,315],[334,310],[321,297],[314,282]]],
6:[[[388,186],[410,173],[431,177],[455,190],[457,204],[442,230],[423,253],[406,266],[387,259],[373,249],[371,231],[378,207]],[[239,339],[254,330],[268,340],[270,355],[265,380],[257,400],[243,404],[228,395],[227,380],[232,359]]],
7:[[[506,193],[534,187],[576,184],[616,183],[651,187],[674,197],[684,209],[682,223],[670,232],[651,234],[624,229],[596,223],[569,221],[544,223],[520,222],[505,215]]],
8:[[[210,877],[216,866],[239,862],[255,869],[264,883],[263,905],[254,922],[235,926],[214,923],[208,911]],[[336,551],[345,539],[359,537],[371,545],[377,559],[375,580],[366,592],[349,597],[337,589],[332,572]]],
9:[[[916,255],[930,251],[953,254],[978,263],[994,274],[998,283],[988,292],[970,292],[947,287],[928,283],[916,274]],[[603,250],[616,242],[635,242],[655,249],[673,258],[680,269],[675,279],[658,284],[637,282],[617,277],[605,268]]]
}
for n,rings in tees.items():
    holes[n]['tees']=[feature(n,'tee',ring,identifier=f'lm-h{n:02d}-tee-{i+1}',evidence='Visible closely mown platform edge, traced independently of the old rectangle and scorecard distances; shaded edge interpretation remains approximate.') for i,ring in enumerate(rings)]

# Associations are explicitly reviewed and retain uncertainty. Forward card
# references without a separately visible platform are left unresolved.
associations={1:[(0,1)],2:[(0,1),(1,2),(2,2)],3:[(0,1),(1,1),(2,1)],4:[(0,1),(1,2)],5:[(0,1)],6:[(0,1),(1,2)],7:[],8:[(0,1),(1,2)],9:[(0,1),(1,2)]}
for n,refs in associations.items():
    holes[n]['teeReferences']=[{'index':index,'padId':f'lm-h{n:02d}-tee-{pad}',
      'evidence':'Explicit navigation association to the visible rear/forward platform in this hole corridor; tee colour and movable marker location are not independently resolved in the orthophoto.'} for index,pad in refs]
    unresolved=[i for i in range(3) if i not in [index for index,pad in refs]]
    holes[n]['unresolvedTeeReferences']=unresolved
    if unresolved:holes[n]['notes']+=' Card references '+','.join(map(str,unresolved))+' have no distinct visible platform; no synthetic platform is created.'

holes[5]['notes']+=' The second visible pad lies too close to the rear deck to establish the 63 m shorter Red/Orange reference; its colour ownership remains unresolved.'
holes[7]['notes']+=' The clearly visible rear deck is approximately 143 m from the green, versus 110/91/72 m on the later card. It remains a physical platform with unresolved colour ownership. Retain inherited navigation references without drawing physical markers at them.'
sources=[json.loads((CACHE/f'norrfallsviken-{n:02d}-hole.json').read_text()) for n in range(1,10)]
review={'schemaVersion':1,'groundId':'norrfallsviken','reviewedOn':'2026-09-09','captureDate':'2024-06-27','sources':sources,'holes':list(holes.values())}
out=ROOT/'nvgkbuild/mapping/review-front9-2026-09-09.json'
out.write_text(json.dumps(review,indent=2,ensure_ascii=False)+'\n',encoding='utf-8',newline='\n')
print(out)
