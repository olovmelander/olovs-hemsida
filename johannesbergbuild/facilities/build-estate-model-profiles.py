"""Author source-grounded, explicitly inferred estate massing profiles.

No course, runtime, socket or Blender mutation. Heights are modelling estimates.
"""
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'johannesbergbuild/facilities'
inventory = json.loads((OUT/'site-inventory.json').read_text('utf-8'))
panels = json.loads((OUT/'orthophoto-panels.json').read_text('utf-8'))
web = json.loads((OUT/'web-reference-sources.json').read_text('utf-8'))
photos = {p['id']: p for p in web['photos']}
panel_by_id = {p['id']:p for p in panels['panels']}


def pin(path):
    path = ROOT/path
    return dict(path=path.relative_to(ROOT).as_posix(),sha256=hashlib.sha256(path.read_bytes()).hexdigest())


# i: floor/ground reference, eave, ridge, roof form, wall, roof, confidence.
# Floor reference is deliberately distinct from the lowest terrain at a slope.
DATA = {
 126:(17.25,21.65,22.9,'compound-gable','barn-red','pale-metal','medium'),
 127:(28.7,35.6,40.5,'compound-mansard','manor-blush','charcoal-metal','medium'),
 128:(20.2,23.25,26.8,'compound-gable','barn-red','tile-red','medium'),
 129:(24.1,30.5,35.3,'mansard','warm-plaster','tile-red','medium'),
 130:(28.4,32.1,36.1,'mansard','warm-plaster','charcoal-metal','medium'),
 132:(18.2,20.25,21.9,'hipped','off-white','tile-red','medium'),
 133:(24.0,30.5,35.3,'mansard','warm-plaster','tile-red','medium'),
 134:(26.7,31.8,36.2,'mansard','manor-blush','charcoal-metal','medium'),
 135:(22.2,28.9,31.6,'compound-gable','barn-red','pale-metal','medium'),
 136:(28.4,32.1,36.1,'mansard','warm-plaster','charcoal-metal','medium'),
 137:(23.8,30.7,34.15,'gable','warm-plaster','tile-red','medium'),
 138:(23.7,26.5,30.7,'mansard','warm-plaster','tile-red','medium'),
 139:(24.0,33.8,38.7,'mansard','warm-plaster','zinc-grey','medium'),
 140:(21.4,27.55,31.9,'gable','barn-red','tile-red','medium'),
 141:(21.4,26.3,29.3,'gable','barn-red','charcoal-metal','low'),
 142:(24.35,27.15,28.15,'hipped','warm-plaster','tile-red','low-medium'),
 143:(24.3,27.4,31.3,'mansard','warm-plaster','tile-red','medium'),
 186:(11.3,13.65,15.15,'hipped','dark-timber','charcoal-metal','low'),
 270:(16.95,19.1,19.95,'gable','barn-red','tile-red','medium'),
 305:(23.5,29.0,31.0,'gable','utility-brown','charcoal-metal','low'),
 306:(12.7,15.0,15.35,'lean-to','barn-red','pale-metal','low'),
}
MANSARD = {
 127:(.80,61,38.8),129:(.72,65,34.2),130:(.74,65,34.9),
 133:(.74,65,34.2),134:(.80,65,34.9),136:(.74,65,34.9),
 138:(.80,66,29.5),139:(.82,65,37.3),143:(.70,65,30.5),
}
PHOTO_IDS = {
 127:['dji-0003','dji-0004','dji-0011','20210617-p1022081-hdr-enhanced'],
 129:['dji-0003','dji-0004','img-3042'],
 130:['stra-flygeln-1','dji-0003'],133:['dji-0003','dji-0004','img-3042'],
 134:['jbs-54_orig','dji-0003','dji-0004'],136:['v-stra-flygeln-2','dji-0003'],
 138:['jbs-flygbild-spa-1080','dji-0003','dji-0004'],139:['jbs-flygbild-spa-1080','dji-0003'],
 132:['club-media-4558-original','club-media-3970-original','club-media-6642-original'],
 143:['dji-0003','dji-0004'],186:['club-media-6713-original'],
 306:['club-media-6713-original','club-media-5983-original'],
}
HEIGHT_NOTES = {
 127:'Spatial check of retained candidate CSV on native ortho separates the ~32.7 m glazed northwest conservatory from >38 m main roof returns. Main eaves/ridge and three roof components are inferred from those locations and official facade proportions; no single whole-building percentile is used.',
 130:'Courtyard-side terrain/floor is about28.4 m; downhill facade has exposed lower wall. Shallow upper mansard returns at35–36 m do not justify a simple shallow gable.',
 136:'Use courtyard-side floor about28.4 m and extend a foundation/lower storey down the slope. Surrounding-ground median24.09 m is not the courtyard floor. Roof elevations match east wing.',
 134:'Front/courtyard-side terrain is about26.7 m, with substantial downslope ground variation. Main roof candidates constrain35–36 m upper planes; tower top is a separate photographic estimate outside reliable roof-return support.',
 138:'Upper approach-side floor estimated23.7 m. Extend lower/basement walls toward20–21 m ground where visible; do not use one mean surrounding height as every facade floor.',
 139:'Upper street-side floor estimated24.0 m; golf/pool side terrain is lower. Multiple visible storeys and stepped foundation are required. Main roof38.7 m and small rear turret41.0 m are separate approximate components.',
 141:'Only27 candidate returns cover this large dark roof. Their34.8 m high group is rejected as an unsupported overall roof height. Conservative visible-barn envelope is ground21.4/eave26.3/ridge29.3 m; vertical uncertainty approximately3 m.',
 305:'Legacy trace-tower identity and10 m height remain unverified. Spatially overlaid2021 candidates above29 m align the isolated dark roof in2025 imagery, with no nearby tree crown; its long narrow shadow corroborates a taller object. Use neutral rectangular mass ground23.5/eave29.0/ridge31.0 m, approximately7.5 m total, without claiming surveyed height or utility function.',
 306:'Six candidate returns are too sparse and potentially vegetated to define height. Use low shelter envelope about2.3–2.65 m above ground, consistent with visible small shelter. Existing reviewed roof perimeter retained; ground walls/poles remain inferred.',
 186:'Nine roof candidates weakly support15 m RH2000 top. Small dark roof is tree-occluded. Adopt low hut massing, without a dispensing/shop role claim.',
}


def component(f,name,u0,u1,v0,v1,axis,eave,ridge,roof_type,rotate=False):
    """Box from offsets in the inventory principal axis frame, not a new footprint."""
    a=math.radians(axis); u=(math.sin(a),math.cos(a));v=(math.cos(a),-math.sin(a))
    uc,vc=(u0+u1)/2,(v0+v1)/2; c=f['geometry']['centroidEPSG3006']
    centre=[round(c[k]+uc*u[k]+vc*v[k],3) for k in range(2)]
    length,width=u1-u0,v1-v0
    if rotate:length,width,axis=width,length,(axis+90)%180
    return dict(id=name,centerEPSG3006=centre,lengthM=round(length,3),widthM=round(width,3),
                axisDegGridNorth=round(axis,3),eaveRh2000M=eave,ridgeRh2000M=ridge,type=roof_type,
                box=[*centre,round(length,3),round(width,3),round(axis,3),eave,ridge],
                geometryBasis='Approximate oriented massing box within/along inherited footprint; preserve original wall ring and clip overlapping component walls.',
                dimensionsMeasured=False)


profiles=[]
for f in inventory['facilities']:
    i=f['modelBuildingIndex']
    if i==131:continue
    floor,eave,ridge,form,wall,roofmat,confidence=DATA[i]
    g=f['geometry'];axis=g['orientationDegGridNorth'];dims=g['dimensionsM'];l,w=dims['longAxis'],dims['shortAxis']
    comps=[component(f,'main',-l/2,l/2,-w/2,w/2,axis,eave,ridge,form.replace('compound-',''))]
    if i==126:
        comps=[component(f,'main-hall',-4.45,11.4,-17.8,13,axis,21.65,22.9,'gable',True),
               component(f,'north-wing',-24.8,-4.45,7.3,13,axis,21.5,22.25,'gable')]
    elif i==127:
        comps=[component(f,'main-manor',-17,10.6,-5.8,12.3,axis,35.6,40.5,'mansard'),
               component(f,'northeast-wing',7.3,22.2,-9.2,5.4,axis,31.7,35.2,'hipped'),
               component(f,'northwest-conservatory',-17,7.2,-12.6,-5.8,axis,30.4,33.2,'glazed-hipped')]
    elif i==128:
        comps=[component(f,'long-courtyard-wing',-32.2,9.4,3.2,13.7,axis,23.25,26.8,'gable'),
               component(f,'cross-courtyard-wing',7.4,19.4,-27.3,3.5,axis,23.1,26.8,'gable',True),
               component(f,'hipped-corner-junction',4.3,18.2,-.3,13.7,axis,23.2,26.8,'hipped')]
    elif i==135:
        comps=[component(f,'long-hall',-44.7,38.1,-14.5,10.6,axis,28.9,31.6,'gable'),
               component(f,'end-cross-wing',22.3,38.1,-14.5,24.8,axis,27.5,30.4,'gable',True)]
    # Full-box centre is exact oriented rectangle centre, which can differ from
    # polygon centroid for small inherited irregularities. Compound components
    # above are consciously specified in centroid-relative UV coordinates.
    roof=dict(type=form,ridgeAxisDegreesGridNorth=axis,components=comps,overhangMetresEstimate=.25,
        ridgeAxisConvention='Clockwise from EPSG:3006 grid north, undirected modulo180 degrees.',
        geometryStatus='Inferred model roof; pixel-visible appearance and laser support do not constitute measured architecture.')
    if i in MANSARD:
        ratio,pitch,break_h=MANSARD[i]
        roof.update(breakpointRatio=ratio,lowerPitchDegrees=pitch,breakHeightRh2000M=break_h,
            breakpointRatioMeaning='Inner half-width at mansard break divided by half-width at eaves; explicit break/eave/ridge heights override rounded pitch.')
        for c in comps:
            if c['type']=='mansard':c.update(breakpointRatio=ratio,lowerPitchDegrees=pitch,breakHeightRh2000M=break_h)
    features=[]
    if i in [129,130,133,134,136,138,139,143]:
        features.append(dict(kind='dormerRows',countPerLongSideEstimate={129:2,130:5,133:2,134:4,136:5,138:3,139:3,143:2}[i],
            widthMetresEstimate=1.0,heightMetresEstimate=1.3,exactCountVerified=False,
            basis='Repeated dormers visible in official photos/native roof; count and metric placement regularized for modelling.'))
    if i in [129,133]:
        features += [dict(kind='centralFacadeGable',side='both-long-sides',widthMetresEstimate=4.0,
            detail='Pale curved central frontispiece with arched window; side balconies and white trim.',exactPlacementVerified=False),
            dict(kind='balconies',levelsEstimate=2,widthMetresEstimate=3.0,depthMetresEstimate=.8,
            detail='Central iron-railed balconies supported by official villa style photo; exact east/west facade layout unresolved.')]
    if i in [130,136]:
        features += [dict(kind='centralEntrance',side='courtyard-facing',widthMetresEstimate=3.7,projectionMetresEstimate=1.2,
            detail='Raised pale gable over small porch; white vertical pilasters, red/brown foundation band and entrance steps.'),
            dict(kind='solarPanels',placement='shallow upper roof plane',coverageFractionEstimate=.60,
            panelCountVerified=False,detail='Dark rectangular array visible on2025 native ortho; continuous simplified array rather than invented exact module count.')]
    if i==127:
        features += [dict(kind='portico',centerUVMetres=[-3.2,12.3],facing='positive-v',widthMetresEstimate=7.0,
            depthMetresEstimate=2.7,floorRh2000M=29.0,topRh2000M=32.9,columnCount=4,columnSection='square',
            columnWidthMetresEstimate=.42,detail='Three arches on four square pale piers, flat balcony roof and dark iron balustrade; central stair approach.'),
            dict(kind='frontGables',count=3,side='positive-v',detail='Curved pale gables with round/oval upper windows; central gable larger; slim roof finials simplified.'),
            dict(kind='cupola',centerUVMetres=[-3.2,3.2],widthMetresEstimate=2.0,baseRh2000M=40.2,topRh2000M=42.2,
            detail='Small open dark cupola at central roof crown; height/position estimated from facade and oblique sources.'),
            dict(kind='conservatory',componentId='northwest-conservatory',detail='Pale glazed frame with repeated vertical mullions and polygonal/hipped glazed roof; not opaque white box.')]
    if i==134:
        tower=component(f,'northwest-tower',-13.5,-8.1,1.6,7.2,axis,37.0,39.0,'pyramidal')
        features += [dict(kind='tower',**tower,baseRh2000M=31.8,placementConfidence='medium-low',
            detail='Pale square tower and dark pyramidal cap at northwest/front corner, visible official Karolinerhuset photo. Main wall footprint retained; feature bounded inside existing footprint.'),
            dict(kind='frontVeranda',side='positive-v',widthMetresEstimate=13,depthMetresEstimate=2.5,
            floorRh2000M=26.7,topRh2000M=29.9,postsEstimate=4,detail='Long shaded entrance veranda with slender pale supports, dark roof and central entrance steps.'),
            dict(kind='centralFacadeGable',side='positive-v',widthMetresEstimate=7,detail='Broad low curved central dormer/frontispiece with paired windows.')]
    if i==139:
        tower=component(f,'rear-roof-turret',7.5,13.5,-8.3,-2.3,axis,37.2,41.0,'pyramidal')
        features += [dict(kind='tower',**tower,baseRh2000M=35.7,placementConfidence='medium-low',
            detail='Small pale/zinc rear roof turret with pyramidal cap, subordinate to the large event-building roof.'),
            dict(kind='solarPanels',placement='upper mansard fields',coverageFractionEstimate=.52,panelCountVerified=False),
            dict(kind='facadeBands',levelsEstimate=3,detail='Pale plaster, warm exposed timber/orange-brown trim bands, corner framing and repeated tall rectangular windows.'),
            dict(kind='exteriorStair',placement='golf-facing lower facade',detail='Visible multi-level outside stair and terrace connection; precise tread geometry and route remain an appearance approximation.')]
    if i==138:
        features += [dict(kind='spaAnnex',detail='Separate low red mansard block adjoining large event building, with dormers, chimney and pale walls. Preserve both source footprints; no invented connecting wall footprint.'),
            dict(kind='poolDeckContext',modelAsBuilding=False,detail='Outdoor rectangular pool and deck visible southwest of annex in official aerial; handled by site builder, not by extending building walls.')]
    if i==143:features.append(dict(kind='chimneys',countEstimate=2,exactCountVerified=False,detail='Small dark chimney features visible among tree-obscured red roof planes.'))
    if i==132:
        features.append(dict(kind='openPavilion',postCountEstimate=8,wallStyle='none',postSectionMetresEstimate=.13,
            detail='Open hip-roof terrace pavilion beside clubhouse, confirmed by2018front and2024opposite-gable photographs; not a closed shed. Actual geometry belongs to clubhouse profile.'))
    if i==305:features.append(dict(kind='unidentifiedVerticalStructure',detail='Plain narrow rectangular warm-brown mass with dark pitched roof. No invented doors, windows, tower legs, spire or utility-purpose label. Estimated7.5 m total height replaces unsupported10 m legacy assumption.'))
    if i==306:features.append(dict(kind='shelterPosts',countEstimate=4,sectionMetresEstimate=.1,detail='Conservative open shelter; perimeter/poles inferred, not measured walls.'))
    evidence=[dict(id='ortho-'+str(i),kind='native-2025-orthophoto',**pin(panel_by_id[f['roofEvidence']['nativePanelId']]['path']),
                   captureDate='2025-06-14',panelId=f['roofEvidence']['nativePanelId'])]
    for pid in PHOTO_IDS.get(i,[]):
        p=photos[pid]
        evidence.append(dict(id=pid,kind='official-reference-photo',**pin(p['path']),sourceUrl=p['sourceUrl'],
                             captureDate=p.get('captureDate'),metricCalibration=False))
    if i==305:
        evidence.append(dict(id='trace-tower-spatial-height-check',kind='annotated-2021-candidates-on-2025-native-ortho',
            **pin('johannesbergbuild/cache/facilities-reference/orthophoto/trace-tower-height-check.png'),
            note='Red points>=29mRH2000 align isolated roof, yellow lower returns; enlarged analytical overlay only.'))
        evidence.append(dict(id='trace-tower-candidate-points',kind='retained-2021-point-locations',
            **pin('johannesbergbuild/cache/facilities-reference/laser/trace-tower-candidate-points.csv')))
    height_report='roof-height-service-hall-evidence.json' if i==126 else 'roof-height-evidence.json'
    roof_evidence=json.loads((OUT/height_report).read_text('utf-8'))
    laser=next(b for b in roof_evidence['facilities'] if b['sourceBuildingId']==f['sourceBuildingId'])
    uncertainty=3.0 if i==141 else 1.5 if i in [186,305,306] else 1.0
    profile=dict(facilityId=f['id'],label='Clubhouse terrace pavilion' if i==132 else f['label'],sourceBuildingId=f['sourceBuildingId'],modelBuildingIndex=i,
        role='Open roofed clubhouse terrace pavilion' if i==132 else f['role'],roleConfidence='high' if i==132 else f['confidence']['role'],
        detailFrame=dict(originEPSG3006=g['centroidEPSG3006'],axisDegGridNorth=axis,
            originMeaning='Centroid of retained source footprint, not bounding-box centre.',
            uAxis='[sin(bearing),cos(bearing)] in EPSG:3006 east/north',
            vAxis='[cos(bearing),-sin(bearing)] in EPSG:3006 east/north; right side of positive-u axis',
            pointFormula='EPSG = origin + uMetres*uAxis + vMetres*vAxis'),
        footprint=dict(ringEPSG3006=g['ringEPSG3006'],ringLocal=g['ringLocal'],status=f['geometryStatus'],
            source='site-inventory.json',wallFootprintNewlyMeasured=False,
            policy='Preserve inherited wall-context outline; component boxes guide roof/massing only. Range shelter footprint is a reviewed roof perimeter, so its poles/walls remain inferred.'),
        heights=dict(groundRh2000M=floor,floorReferenceRh2000M=floor,eaveRh2000M=eave,ridgeRh2000M=ridge,
            confidence=confidence,estimatedVerticalUncertaintyMetres=uncertainty,measured=False,
            groundMeaning='Estimated upper entrance/floor reference, not lowest terrain, not a surveyed floor. Foundation/lower walls must follow retained exterior terrain.',
            laserGroundAnnulusQuantiles=laser['adjacentGround']['heightRH2000'],
            laserRoofCandidateQuantiles=laser['roofCandidates']['heightRH2000'],
            laserCandidateCount=laser['roofCandidates']['points'],
            estimationBasis=HEIGHT_NOTES.get(i,'Approximate eave/ridge envelope inferred jointly from native roof appearance, inherited width and2021 candidate-plane elevation/slope; candidates are unclassified and eaves are not measured.'),
            source=pin('johannesbergbuild/facilities/'+height_report)),
        roof=roof,materials=dict(wall=wall,roof=roofmat,trim='off-white',foundation='foundation-grey',
            windows='blue-grey-glass' if i not in [305,306] else None,
            confidence='photo-supported appearance' if PHOTO_IDS.get(i) else 'roof colour observed; wall material conservative contextual estimate'),
        distinctiveFeatures=features,evidence=evidence,
        implementation=dict(wallPolicy='Use components for differing-height compound masses and clip to inherited footprint; never extrude conservatory/annex to highest main eave.',
            terrainPolicy='Extend foundation downward to per-vertex exterior-ground sampling; do not flatten sloping site or use lowest ground as every entrance floor.',
            facadePolicy='Repeated window/dormer positions and all metric ornament dimensions are modelling approximations, not surveyed openings.',
            replacementEligible=True),
        gaps=['2021 laser and2025 orthophoto predate possible later changes.','No surveyed eaves, ridge, roof pitch or facade opening dimensions.'])
    if i==305:profile['gaps'].append('Identity unresolved: rectangular visible object may be modelled, but its purpose and exact architectural detail remain unknown.')
    if i==132:
        profile['implementation'].update(geometryOwner='clubhouse-model-profile',emitEstateGeometry=False,
            wallPolicy='Open posts and hipped roof only, no opaque wall box; avoid duplicate geometry already authored with clubhouse.')
    profiles.append(profile)

palette={
 'manor-blush':dict(baseColorHex='#e2c4b4',roughness=.88,description='Warm pale pink/cream rendered plaster'),
 'warm-plaster':dict(baseColorHex='#e7decb',roughness=.88,description='Warm cream rendered plaster'),
 'barn-red':dict(baseColorHex='#793029',roughness=.9,description='Conservative muted red timber/barn wall'),
 'dark-timber':dict(baseColorHex='#3d3730',roughness=.94,description='Dark weathered timber; uncertain hidden hut facade'),
 'weathered-timber':dict(baseColorHex='#675a48',roughness=.96,description='Neutral utility-placeholder material, not confirmed identity'),
 'utility-brown':dict(baseColorHex='#966b56',roughness=.94,description='Warm brown appearance of unidentified vertical structure; brick/timber construction not established'),
 'tile-red':dict(baseColorHex='#a95336',roughness=.86,description='Orange/red roof tiles; texture and exact tile size unmeasured'),
 'charcoal-metal':dict(baseColorHex='#283039',roughness=.62,metallic=.15,description='Dark standing-seam-looking roof'),
 'pale-metal':dict(baseColorHex='#adb5b4',roughness=.64,metallic=.12,description='Light sheet roof'),
 'zinc-grey':dict(baseColorHex='#98aab0',roughness=.58,metallic=.22,description='Pale grey/zinc appearance on event building'),
 'off-white':dict(baseColorHex='#eeeade',roughness=.86,description='Pale frame, cornice and pilaster trim'),
 'foundation-grey':dict(baseColorHex='#68675f',roughness=.96,description='Dark grey lower foundation/skirt'),
 'blue-grey-glass':dict(baseColorHex='#465d62',roughness=.24,metallic=.08,description='Muted reflective glazing; no photographic texture'),
}
output=dict(schemaVersion=1,courseId='johannesberg',createdOn='2026-09-10',
    status='modelable-inferred-estate-profiles-not-surveyed-architecture',
    purpose='Actual Blender estate modelling input for21 non-clubhouse buildings; clubhouse has separate authored profile.',
    coordinates=dict(horizontal='EPSG:3006',vertical='EPSG:5613 / RH2000',units='metres',
        boxColumns=['centerE','centerN','length','width','axisDegGridNorth','estimatedEaveRH2000','estimatedRidgeRH2000']),
    sourceInventory=pin('johannesbergbuild/facilities/site-inventory.json'),
    sourcePanelIndex=pin('johannesbergbuild/facilities/orthophoto-panels.json'),
    sourceWebIndex=pin('johannesbergbuild/facilities/web-reference-sources.json'),
    limitations=['All final architectural dimensions/heights are estimates, not surveyed values.',
        'Use outside-ground samples for foundation skirts. Ground/floor reference differs from downhill terrain.',
        'Image-derived component boxes are massing guides; inherited footprints stay the wall-position contract.',
        'Old-stable/current unknown service roles remain uncertain; no labels invented from roof appearance.',
        'trace-tower305 has an estimated7.5 m visible rectangular mass supported by spatially matched roof candidates; role, precise height and construction remain unverified.'],
    materialPalette=palette,profiles=profiles)
path=OUT/'estate-model-profiles.json';path.write_text(json.dumps(output,indent=2,ensure_ascii=False)+'\n','utf-8')
assert len(profiles)==21 and len({p['sourceBuildingId']for p in profiles})==21
assert all(p['heights']['groundRh2000M']<p['heights']['eaveRh2000M']<p['heights']['ridgeRh2000M']for p in profiles)
print('Wrote21 source-pinned estate profiles:',hashlib.sha256(path.read_bytes()).hexdigest())
