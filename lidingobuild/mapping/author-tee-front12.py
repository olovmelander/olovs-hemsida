"""Explicit observations on retained native 2025 RGB images; no fitted distances."""
from pathlib import Path
from hashlib import sha256
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / 'lidingobuild/cache/lm-ortho'
# Native pixels, with separate platform identity and illustrative colour anchors.
TRACES = {
    10: {
        'pads': [
            'lidingo-tee-10-a-ortho2019',
            [[488,1005],[501,958],[516,914],[531,873],[549,854],[569,850],[593,858],[610,876],[615,893],[604,924],[584,955],[564,994],[548,1024],[528,1038],[507,1035],[491,1023]],
            [[656,590],[673,574],[695,574],[717,585],[733,603],[739,624],[730,642],[713,651],[691,648],[675,636],[660,614]],
        ], 'marks': [None,(1,534,985),(1,563,907),(2,700,610),None],
        'note': 'Long yellow/blue deck and forward red oval visibly follow the current 2025 mowing. Rear white platform is obscured by canopy and its historical footprint is retained as unresolved. Orange is not located by a resolved guide/image platform association.'
    },
    11: {
        'pads': [
            [[238,379],[257,366],[286,360],[307,365],[317,383],[326,415],[327,447],[317,467],[291,482],[266,481],[253,468],[246,438]],
            [[231,289],[248,279],[276,277],[295,283],[310,297],[314,310],[303,322],[279,331],[252,332],[235,324],[225,309]],
        ], 'marks': [(0,284,452),(0,276,407),(0,284,398),(1,276,311),(1,261,296)],
        'note': 'Broad rear white/yellow/blue deck and separate short forward red/orange deck east of Kyttingevagen; the previous single tee omitted the forward deck.'
    },
    12: {
        'pads': [
            [[242,308],[256,272],[275,249],[288,245],[308,252],[327,273],[346,302],[350,319],[334,333],[303,344],[274,351],[254,345],[242,332]],
            [[619,612],[632,601],[648,602],[667,613],[679,629],[675,645],[660,657],[643,657],[626,647],[616,631]],
        ], 'marks': [(0,278,282),(0,283,287),(0,324,315),(1,648,629),None],
        'note': 'Rear triangular white/yellow/blue deck north of hole 11 green and separate circular red deck southeast beyond that green; orange omitted by this guide edition and not independently located.'
    },
    7: {
        'pads': [
            [[608,477],[629,481],[657,494],[691,504],[714,520],[728,537],[728,551],[714,565],[696,563],[668,549],[641,539],[614,525],[603,508]],
            [[413,387],[425,375],[440,375],[462,385],[488,399],[501,414],[500,427],[488,434],[471,433],[447,421],[424,410],[413,400]],
            [[251,321],[300,337],[286,366],[243,350]],
        ], 'marks': [(0,695,540),(0,667,521),(0,630,507),(1,453,402),(2,271,344)],
        'note': 'Rear elongated east-west deck shared by white/yellow/blue, middle red oval south of the paved path, and small square orange deck farther west. Guide order corroborated against the green and path network.'
    },
    9: {
        'pads': [
            [[615,412],[636,402],[670,393],[684,397],[696,410],[696,424],[684,434],[652,446],[630,450],[620,440]],
            [[356,270],[367,255],[381,258],[403,273],[424,285],[448,289],[458,300],[450,318],[438,327],[414,326],[390,313],[369,294],[356,284]],
            [[244,411],[258,394],[282,384],[304,388],[322,401],[328,418],[318,432],[295,444],[270,451],[251,442],[242,428]],
        ], 'marks': [(0,667,416),(1,428,305),(1,387,285),(2,299,412),(2,265,430)],
        'note': 'Three decks beside the road: eastern rear white, long middle yellow/blue and southwest forward red/orange. All were cross-identified with the guide; the separate H5 decks south of the road are excluded.'
    },
    3: {
        'pads': [
            [[467,623],[484,613],[503,617],[522,630],[536,648],[537,660],[523,676],[504,684],[490,678],[477,659]],
            [[461,414],[483,395],[501,391],[519,400],[547,423],[559,442],[551,461],[527,486],[512,490],[492,479],[468,456],[456,435]],
            [[337,290],[350,268],[365,260],[382,266],[401,282],[426,314],[430,332],[417,349],[404,358],[387,353],[364,333],[343,310]],
        ], 'marks': [(0,512,654),(1,516,447),(2,405,329),(2,378,301),(2,364,283)],
        'note': 'Three isolated maintained decks east of the pond; rear white, middle yellow, forward blue/red/orange corroborated by the club guide.'
    },
    4: {
        'pads': [
            [[580,1123],[594,1115],[605,1121],[615,1136],[619,1154],[613,1167],[600,1176],[589,1170],[579,1152]],
            [[768,864],[782,857],[795,870],[810,901],[826,937],[848,967],[854,985],[843,1001],[828,1006],[813,996],[796,970],[782,940],[774,909]],
            [[585,661],[596,652],[609,655],[620,668],[632,687],[634,702],[624,711],[610,710],[596,696],[586,679]],
        ], 'marks': [(0,598,1153),(1,827,976),(1,790,898),(2,609,684),None],
        'note': 'Three decks inside the eastern path: small rear white, elongated yellow/blue, northern red. The guide orange start lies farther ahead and is separately unresolved in this window.'
    },
    5: {
        'pads': [
            [[297,280],[315,266],[336,269],[352,284],[361,305],[356,329],[340,345],[319,344],[300,333],[291,311]],
            [[207,415],[220,402],[237,402],[248,411],[253,428],[247,446],[234,458],[219,460],[206,451],[201,434]],
        ], 'marks': [(0,324,294),(0,331,302),(0,325,327),(1,231,426),(1,217,444)],
        'note': 'Rear deck under partial tree shadow and a distinct forward oval west of the path. Guide associates white/yellow/blue and red/orange respectively; shade limits rear boundary interpretation to about one metre.'
    },
    6: {
        'pads': [
            [[228,230],[242,221],[256,225],[270,243],[283,267],[289,282],[281,294],[265,297],[252,286],[238,263]],
            [[301,329],[317,310],[334,286],[349,273],[362,271],[377,284],[380,301],[372,322],[352,349],[335,367],[322,369],[304,353],[296,344]],
            [[388,404],[402,388],[423,383],[443,387],[460,402],[466,422],[459,440],[443,453],[423,457],[404,449],[390,435],[384,419]],
            [[564,445],[580,426],[602,446],[585,467]],
        ], 'marks': [(0,248,243),(1,355,300),(2,414,408),(2,437,436),(3,583,446)],
        'note': 'Four progressively forward decks southeast of the fifth green. Guide establishes white, yellow, shared blue/red, and small orange deck beside the path and pond.'
    },
    1: {
        'pads': [
            [[226,311],[246,291],[290,274],[327,266],[345,275],[355,307],[355,331],[342,347],[293,366],[260,375],[243,366],[231,344]],
            [[291,525],[310,519],[327,526],[338,548],[347,577],[342,593],[322,600],[307,593],[298,569]],
        ], 'marks': [(0,270,310),(0,281,318),(0,311,333),(1,310,547),(1,326,578)],
        'note': 'Broad rear deck and separate forward deck south of the looping path. Guide associates white/yellow/blue with rear and red/orange with forward deck.'
    },
    2: {
        'pads': [
            [[243,337],[260,333],[276,341],[292,358],[303,378],[301,389],[286,398],[267,390],[252,374],[242,354]],
            [[306,607],[324,603],[338,612],[352,638],[366,667],[362,681],[348,690],[333,686],[320,668],[308,640]],
            [[584,774],[604,764],[626,766],[642,779],[654,805],[653,820],[639,830],[614,835],[601,825],[590,803]],
        ], 'marks': [(0,266,358),(1,326,630),(2,611,788),(2,630,812),None],
        'note': 'Three tee decks progress southeast. The old northernmost adopted tee overlaps the neighbouring fairway tip; guide and photo instead identify the small deck beside the trees as white, the long deck by the diagonal path as yellow, and the southeast oval as blue/red. Orange start remains unresolved.'
    },
}


def write_review_overlays(holes):
    """Annotate copies for review; all ledger coordinates remain native pixels."""
    from PIL import Image, ImageDraw, ImageFont

    destination = ROOT / 'lidingobuild/cache/tee-front12-review'
    destination.mkdir(parents=True, exist_ok=True)
    font_file = Path('C:/Windows/Fonts/arial.ttf')
    font = ImageFont.truetype(str(font_file), 17) if font_file.exists() else ImageFont.load_default()
    colours = dict(white='white', yellow='yellow', blue='#53baff', red='#ff6363', orange='#ffa93b')
    for hole in holes:
        image = Image.open(ROOT / hole['image']['path']).convert('RGB')
        draw = ImageDraw.Draw(image)
        for i, pad in enumerate(hole['pads']):
            pixels = [tuple(point) for point in pad['pixels']]
            colour = '#ffce77' if pad.get('status') == 'retained-unresolved' else '#61fff4'
            draw.line(pixels, fill=colour, width=2)
            x = sum(point[0] for point in pixels[:-1]) / (len(pixels)-1)
            y = sum(point[1] for point in pixels[:-1]) / (len(pixels)-1)
            draw.text((x, y), chr(65+i), font=font, fill='white', stroke_width=2, stroke_fill='black')
        for mark in hole['marks']:
            if 'pixel' not in mark:
                continue
            x, y = mark['pixel']
            draw.ellipse((x-4, y-4, x+4, y+4), fill=colours[mark['colour']], outline='black', width=1)
        stem = f'hole-{hole["hole"]:02d}'
        image.save(destination / f'{stem}-overlay.png')
        contact = Image.new('RGB', (380*len(hole['pads']), 430), (25, 25, 25))
        for i, pad in enumerate(hole['pads']):
            pixels = pad['pixels']
            box = (max(0, int(min(p[0] for p in pixels))-15), max(0, int(min(p[1] for p in pixels))-15),
                   min(image.width, int(max(p[0] for p in pixels))+16), min(image.height, int(max(p[1] for p in pixels))+16))
            crop = image.crop(box)
            scale = min(360/crop.width, 380/crop.height)
            crop = crop.resize((round(crop.width*scale), round(crop.height*scale)))
            contact.paste(crop, (380*i+(380-crop.width)//2, 40))
            label = f'H{hole["hole"]} pad {chr(65+i)} [{box[0]}, {box[1]}]'
            if pad.get('status') == 'retained-unresolved':
                label += ' retained'
            ImageDraw.Draw(contact).text((380*i+8, 8), label, fill='white', font=font)
        contact.save(destination / f'{stem}-pads.png')


def main():
    holes = []
    for number, trace in sorted(TRACES.items()):
        stem = f'lidingo-{number:02d}-tees'
        source = json.loads((CACHE / f'{stem}.json').read_text(encoding='utf8'))
        image_path = CACHE / f'{stem}.png'
        image = {key: source[key] for key in ['geoTransform', 'width', 'height']}
        image.update(path=image_path.relative_to(ROOT).as_posix(), sha256=sha256(image_path.read_bytes()).hexdigest(),
                     sourceIds=[s['id'] for s in source['sources']], resolutionMetres=.16)
        pads = []
        for i, ring in enumerate(trace['pads']):
            if isinstance(ring, str):
                features = json.loads((ROOT/'lidingobuild/mapping/playing-surfaces.geojson').read_text(encoding='utf8'))['features']
                feature = next(f for f in features if f['id'] == ring)
                g = image['geoTransform']
                pixels = [[(e-g[0])/g[1], (n-g[3])/g[5]] for e,n in feature['geometry']['coordinates'][0]]
                pads.append(dict(id=ring, pixels=pixels, baselineFeature=feature, status='retained-unresolved',
                                 uncertaintyMetres=3, note=trace['note']))
            else:
                pads.append(dict(id=f'lidingo-tee-{number:02d}-{chr(97+i)}-lm2025', pixels=ring+[ring[0]],
                                 uncertaintyMetres=1, note=trace['note']))
        marks = []
        for colour, mark in zip(['white','yellow','blue','red','orange'], trace['marks']):
            marks.append(dict(colour=colour, status='guide-and-orthophoto-associated',
                              padId=pads[mark[0]]['id'], pixel=list(mark[1:]), note=trace['note']) if mark else
                         dict(colour=colour, status='unresolved', note='Guide forward start has no confidently resolved distinct platform in the reviewed 2025 image; no marker pair asserted.'))
        holes.append(dict(hole=number, image=image, pads=pads, marks=marks, note=trace['note']))
    (ROOT / 'lidingobuild/mapping/tee-review-front12-2026-09-09.json').write_text(
        json.dumps(dict(schemaVersion=1, groundId='lidingo', horizontalCrs='EPSG:3006',
                        capturedAt='2025-05-31', holes=holes),ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if '--overlays' in sys.argv:
        write_review_overlays(holes)


if __name__ == '__main__':
    main()
