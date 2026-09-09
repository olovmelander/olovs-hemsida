"""Convert the explicitly reviewed back-nine pixel decisions into legacy metres.

Panels: geobuild/mapping/render-ortho-review.py, 1000 px, 90 m green windows;
native full-hole TIFFs first and native surface TIFFs last. This is a manual
boundary ledger, not an automatic classifier. Raw photographs remain ignored.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from pyproj import Transformer
from shapely.geometry import Polygon
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
PANELS = ROOT/'johannesbergbuild/cache/lm-review/back9-native/panels.json'
BASELINE = ROOT/'johannesbergbuild/cache/lm-baseline/eighteen.json'
OUT = ROOT/'johannesbergbuild/mapping/lm-review-back9.json'

def pixels(text):
    return [[float(n) for n in p.split(',')] for p in text.split()]

# hole, kind, index, panel kind, boundary (pixel edges), interpretation
DECISIONS = [
 (10,'green',None,'greens','426,347 452,346 477,355 500,375 519,402 535,435 544,468 556,499 576,530 600,565 614,592 616,613 605,635 583,650 556,658 531,656 506,646 482,630 458,605 431,570 407,533 387,497 370,459 357,424 358,397 375,374 399,356','Putting surface follows the inner mowing edge; surrounding collar excluded.'),
 (10,'bunker',0,'greens',None,'The old bunker polygon covers established vegetation in the 2025 photograph; no exposed sand remains.'),
 (11,'green',None,'greens','349,499 355,476 376,455 405,440 436,431 467,431 502,439 542,454 582,476 617,498 645,524 666,552 674,580 665,608 645,633 620,650 591,661 565,662 535,655 504,642 473,626 444,608 417,590 389,568 367,544 354,524','Trace the striped putting turf inside its dark collar; the legacy outline sits too far north.'),
 (11,'bunker',0,'greens','322,369 327,354 343,345 370,339 407,334 440,324 467,313 484,311 498,319 503,335 501,351 494,362 475,369 447,373 416,382 387,394 359,402 340,401 327,390','Visible north bunker sand edge, including the lower-left lobe missed by the old polygon.'),
 (11,'bunker',1,'greens','319,618 330,604 344,603 361,614 382,628 409,637 440,640 472,644 491,653 505,668 511,682 504,690 485,694 463,690 438,682 413,676 387,671 360,668 339,659 326,647 318,633','Trace the connected south bunker sand; its old polygon covered only the east end.'),
 (12,'green',None,'greens','401,552 415,526 439,506 467,490 496,480 526,476 553,479 580,489 606,507 630,527 645,550 649,576 639,598 620,614 594,628 563,640 535,653 507,666 479,670 454,659 429,641 411,618 400,591','Inner putting edge, with about two metres uncertainty under the northern tree shadow. Rough above the green is excluded.'),
 (12,'bunker',0,'greens','236,610 243,594 262,582 284,578 309,563 329,564 347,579 357,600 366,627 368,649 358,668 338,677 317,677 291,666 265,650 246,633','Full visible sand footprint below the old outline; the rock north of the sand is excluded.'),
 (13,'green',None,'greens','447,414 470,399 493,396 518,400 539,412 556,433 563,459 568,489 578,516 588,545 592,578 588,611 576,642 558,665 539,672 520,658 507,635 491,609 469,584 446,562 430,539 418,512 414,484 419,457 429,432','Irregular elongated putting green inside the collar, separate from the approach and western sand.'),
 (13,'bunker',0,'greens','423,615 432,602 446,596 458,600 466,616 472,645 479,670 489,692 498,718 508,748 518,778 518,794 509,806 490,812 467,810 445,810 430,806 422,795 425,779 436,755 442,735 442,715 434,690 426,666 422,640','The sand is a narrow curved strip east of the trees, not the legacy wide polygon covering the wooded knoll.'),
 (14,'green',None,'greens','371,523 379,495 394,470 417,446 443,427 468,413 494,403 516,404 542,415 566,433 592,456 613,479 624,501 624,520 609,539 586,553 561,567 537,584 515,610 491,632 469,644 445,644 422,634 400,616 384,591 373,561','Trace the kidney-shaped putting surface inside the mowing collar; bright approach grass is excluded.'),
 (15,'green',None,'greens','411,528 419,504 437,482 464,464 496,449 531,435 565,421 596,410 626,407 653,413 677,428 698,450 716,477 731,505 740,530 735,549 720,563 697,573 669,578 636,581 601,586 563,593 525,601 489,610 463,612 442,600 428,578 417,552','Putting surface follows the clear striped turf/collar transition; excludes the long western approach.'),
 (15,'bunker',0,'greens','282,360 295,339 314,324 331,319 347,322 361,334 371,353 388,367 410,376 427,389 438,404 441,418 431,433 410,445 386,456 363,467 348,467 333,453 317,434 300,414 286,396 280,379','Full visible upper bunker with two lobes, substantially larger than the old sand ring.'),
 (15,'bunker',1,'greens','498,630 509,623 531,621 554,616 576,606 590,606 604,618 614,640 622,665 629,686 627,705 615,721 600,728 580,727 558,718 539,705 522,690 508,671 499,651','Trace the lower bunker to its visible sand margin; legacy ring omitted the south half.'),
 (16,'green',None,'greens','424,458 437,435 454,420 475,412 496,414 519,425 539,440 557,462 573,488 588,518 599,548 612,579 620,609 620,633 610,653 592,668 571,675 550,670 525,660 502,645 481,625 465,601 451,572 438,541 429,512 422,485','Actual putting turf begins southeast of the legacy outline, inside the dark fringe.'),
 (16,'bunker',0,'greens','311,481 321,459 337,443 352,440 366,445 372,462 373,484 379,504 390,526 401,546 400,558 390,565 373,568 351,562 332,550 318,534 307,514 304,497','Visible west bunker around its full lower lobe; no extension into the grass north of the sand.'),
 (16,'bunker',1,'greens','650,537 659,523 674,516 688,519 702,530 714,546 722,568 728,590 735,613 740,634 735,651 723,660 707,663 691,657 680,645 676,626 675,606 670,585 662,567 654,552','Trace the east bunker sand, which lies well south of its old polygon.'),
 (16,'bunker',2,'greens','530,779 538,764 555,752 573,743 591,740 606,747 616,761 623,778 627,795 621,808 605,818 585,822 565,824 547,824 534,816 528,799','Southern bunker now follows visible sand rather than the grass immediately north.'),
 (17,'green',None,'greens','390,546 399,518 416,492 438,468 464,448 491,432 521,417 548,409 574,410 597,420 619,438 638,462 651,486 657,510 649,534 632,555 608,577 581,594 552,611 523,628 497,640 474,643 451,635 428,620 410,600 396,575','Trace the oval putting surface and exclude its mowing collar; legacy northeast corner extended beyond putting turf.'),
 (18,'green',None,'greens','427,376 444,356 464,349 487,351 509,362 529,380 543,404 551,432 557,462 563,494 566,524 565,555 559,587 550,616 536,639 519,650 500,653 482,648 467,635 460,617 457,593 455,568 449,544 438,517 426,492 418,467 414,440 415,412 419,391','Putting turf inside the collar; the old angular south point is replaced by the rounded visible edge.'),
 (18,'bunker',0,'greens','590,619 602,596 613,572 621,547 631,526 645,518 660,519 672,529 677,541 672,556 661,576 650,600 646,623 646,644 645,660 637,671 621,676 604,674 592,665 585,651 584,636','Complete connected right bunker sand; old ring ended about five metres too far north.'),
]

def main():
    panels=json.loads(PANELS.read_text())
    model=json.loads(BASELINE.read_text())
    frame={k:model[k] for k in ['origin','mPerLat','mPerLon']}
    if panels['frame'] != frame:
        raise ValueError('Panel frame changed')
    inverse=Transformer.from_crs(3006,4326,always_xy=True)
    features=[]
    for hole,kind,index,mode,raw,note in DECISIONS:
        panel=next(p for p in panels['panels'] if p['id']==f'{mode}-hole-{hole:02}')
        plain=Path(panel['plainPath'])
        if hashlib.sha256(plain.read_bytes()).hexdigest() != panel['plainSha256']:
            raise ValueError('Panel image changed')
        h=next(h for h in model['holes'] if h['n']==hole)
        old=h['green']['ring'] if kind=='green' else h['fairway']['rings'] if kind=='fairway' else [p['ring'] for p in h['tees']['pads']] if kind=='tees' else h['bunkers'][index]['ring']
        # Node's number serialization is the contract for baseline geometry pins.
        digest=subprocess.check_output(['node','-e','const fs=require("fs"),c=require("crypto");console.log(c.createHash("sha256").update(JSON.stringify(JSON.parse(fs.readFileSync(0,"utf8")))).digest("hex"))'],input=json.dumps(old),text=True).strip()
        sources=[]
        for s in panel['sources']:
            path=Path(s['path']).with_suffix('.png')
            sources.append({'path':path.relative_to(ROOT).as_posix() if path.is_absolute() else path.as_posix(),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        f=dict(id=f'lm-2025-eighteen-h{hole:02}-{kind}'+(f'-{index}' if index is not None else ''),hole=hole,kind=kind,status='accepted',originalRingSha256=digest,
               evidence=dict(sourceFiles=sources,sourceCaptureDates=['2025-06-14'],uncertaintyM=2.0 if hole==12 and kind=='green' else 1.0,note=note,
               panelExtent=panel['extentEPSG3006'],panelPixelSize=panel['pixelSize'],panelImageSha256=panel['plainSha256'],source='Lantmateriet orto-o2-2025 RGBI; manual boundary interpretation'))
        if index is not None: f['index']=index
        if raw is None: f['action']='remove'
        else:
            lists=[pixels(part) for part in raw.split('|')]
            rings=[]
            for pixelring in lists:
                w,s,e,n=panel['extentEPSG3006']; width,height=panel['pixelSize']
                ring=[]
                for x,y in pixelring:
                    if not (0<=x<=width and 0<=y<=height): raise ValueError('Out-of-panel trace')
                    lon,lat=inverse.transform(w+x*(e-w)/width,n-y*(n-s)/height)
                    ring.append([round((lon-frame['origin']['lon'])*frame['mPerLon'],2),round((frame['origin']['lat']-lat)*frame['mPerLat'],2)])
                p=Polygon(ring)
                if not p.is_valid or p.area<1: raise ValueError(f'Invalid trace {f["id"]}')
                rings.append(ring)
            if kind in ['fairway','tees']: f['rings']=rings; f['evidence']['sourcePixelRings']=lists
            else: f['ring']=rings[0]; f['evidence']['sourcePixelRing']=lists[0]
        features.append(f)
    OUT.write_text(json.dumps(dict(schemaVersion=1,groundId='johannesberg',course='johannesberg',frame=frame,reviewedOn='2026-09-09',features=features,unresolved=[]),indent=2)+'\n')
    sheet=Image.new('RGB',(1350,1410),'#222222')
    for hole in range(10,19):
        panel=next(p for p in panels['panels'] if p['id']==f'greens-hole-{hole:02}')
        im=Image.open(panel['plainPath']).convert('RGB'); draw=ImageDraw.Draw(im)
        for f in features:
            if f['hole']!=hole or 'sourcePixelRing' not in f['evidence']: continue
            ring=[tuple(p) for p in f['evidence']['sourcePixelRing']]
            draw.line(ring+[ring[0]],fill='#00ffff' if f['kind']=='green' else '#ffff00',width=3)
        im.save(PANELS.parent/f'greens-hole-{hole:02}-reviewed.png')
        x=((hole-10)%3)*450;y=((hole-10)//3)*470
        ImageDraw.Draw(sheet).text((x+10,y+5),f'Hole {hole}: reviewed boundaries',fill='white')
        sheet.paste(im.resize((450,450)),(x,y+20))
    sheet.save(PANELS.parent/'back9-greens-reviewed-contact.png')
    print(f'{len(features)} reviewed back-nine features written')

if __name__=='__main__': main()
