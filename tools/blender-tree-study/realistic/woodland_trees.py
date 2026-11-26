"""Author the detailed non-pine tree templates in a separate Blender scene.

From the repository root:
  blender -b -P tools/blender-tree-study/realistic/woodland_trees.py -- <work>
  node tools/blender-tree-study/realistic/pack_woodland_trees.mjs <work>

Coordinates are metres in the player's Y-up template frame until the preview
meshes are linked. Course coordinates never enter this generator.
"""
import json
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from realistic_trees import Wood, flat, preview
from playing_height_trees import GOLDEN, UP, along, fit, light_canopy, radial

BARK = {'björk': 'birch', 'al': 'alder', 'ek': 'oak', 'gran': 'spruce'}


class Branches:
    def __init__(self):
        self.wood = []
        self.shoots = []

    def add(self, points, radii, sides, coarse=3, detail=False):
        self.wood.append((points, radii, sides, coarse, detail))
        return points

    def shoot(self, foot, vector, spread):
        self.shoots.append((foot, vector, spread))


def trunk(tree, height, radius, lean, base, breadth, phase):
    foot = UP * -.045
    # The lowest ring flares at the base. The next two anchor the bole around
    # the original survey point even in the strongly leaning forms.
    nodes = [foot, UP * min(height * .025, base * .13), UP * min(height * .12, base * .43) + lean * .04,
             UP * base * .68 + lean * .31 + radial(phase+1.1)*radius*.035,
             UP * base + lean]
    return tree.add(nodes, [breadth*v for v in (1.53,1.1,.94,.79,.66)], 12, 8)


def spray_broadleaf(tree, key, axis, facing, width, height, rng, hanging=False):
    # The secondary rachis is real tapered wood. Leaf-bearing twigs attach at
    # alternate nodes and carry small sprays all along their outer internodes.
    groups = rng.choice((4,5,6)) if key == 'ek' else 6 if key == 'björk' else 7
    first = rng.uniform(.44,.70) if key=='ek' else .23
    for j in range(groups):
        u = first + (.96-first)*(j+rng.uniform(.15,.85))/groups
        root = along(axis, u)
        bearing = facing + (1 if j%2 else -1)*rng.uniform(.48,1.44)
        outward = radial(bearing)
        remaining = width * (.56 + .34*math.sin(math.pi*u)) * rng.uniform(.72,1.10)
        if key == 'björk':
            # Pendulous birch: hanging threadlets spring from arched secondaries.
            elbow = root + outward*remaining*.50 + UP*height*rng.uniform(.008,.035)
            tip = elbow + outward*remaining*.35 - UP*height*rng.uniform(.080,.177)
        elif key == 'al':
            elbow = root + outward*remaining*.46 + UP*height*rng.uniform(.017,.045)
            tip = elbow + outward*remaining*.43 + UP*height*rng.uniform(.015,.066)
        else:
            elbow = root + outward*remaining*.56 + UP*height*rng.uniform(-.015,.026)
            rise = rng.uniform(-.067,-.009) if hanging else rng.uniform(-.018,.058)
            tip = elbow + radial(bearing+rng.uniform(-.57,.57))*remaining*.68 + UP*height*rise
        if j in (1,4):
            twig_r = max(.013,height*.0023*(1-u*.44))
            tree.add([root,elbow,tip], [twig_r,twig_r*.54,.009], 3, detail=True)
        # Distinct buds lie on real paths, leaving apertures between forks.
        for k in range(5):
            t = (k+.5)/5
            pos = along([root,elbow,tip],t)
            segment = (elbow-root if t<.5 else tip-elbow).normalized()
            side = radial(bearing + (-1 if k%2 else 1)*1.38)
            leaf_axis = (segment*.83 + side*rng.uniform(.28,.60)).normalized()
            tree.shoot(pos,leaf_axis*remaining*rng.uniform(.17,.34),rng.uniform(.83,1.20))


def oak(tree,h,r,form,rng,az):
    # Both mature open-grown forms and the more upright woodland individual
    # carry weight on elbows and secondary forks, with light wells below them.
    lean = radial(az)*r*(.11,.17,.06)[form]
    girth = h*(.036,.033,.040)[form]
    bole = trunk(tree,h,r,lean,h*(.33,.40,.28)[form],girth,az)
    n = (6,5,7)[form]
    for i in range(n):
        a = az+i*GOLDEN+rng.uniform(-.25,.25)
        outward,side = radial(a),radial(a+math.pi/2)
        p = along(bole,.67+.31*rng.random())
        central = i==0 or (i==1 and form==1)
        low = i==(2,3,1)[form]
        reach = r*rng.uniform(.03,.22) if central else r*rng.uniform(.64,.96)
        tiph = h*(rng.uniform(.89,1.0) if central else rng.uniform(.46,.59) if low else rng.uniform(.66,.91))
        sidebend = side*r*rng.uniform(-.24,.24)
        arm = [p,p+outward*reach*.24+UP*h*.105,
               p+outward*reach*.53+sidebend+UP*h*rng.uniform(.14,.21),
               outward*reach*.72+lean+UP*tiph*.87+sidebend*.50,
               outward*reach+lean+UP*tiph]
        thick = girth*rng.uniform(.47,.65)
        tree.add(arm,[thick*v for v in (1,.88,.72,.45,.16)],7,5)
        count=rng.choice((4,5,6))
        for j in range(count):
            u = .17 + .80*(j+rng.uniform(.02,.48))/count
            foot = along(arm,u)
            a2 = a + (1 if j%2 else -1)*rng.uniform(.55,1.50)
            d, cross = radial(a2), radial(a2+math.pi/2)
            extension = r*(.49-.20*u)*rng.uniform(.78,1.17)
            rise = h*(.14-.054*u)*rng.uniform(.69,1.21)
            hanging = low or (not central and (j+i+form)%3==0)
            if hanging: rise*=rng.uniform(-.16,.42)
            end = foot+d*extension+UP*rise
            axis = [foot,foot+d*extension*.40+UP*rise*.17,
                    foot+d*extension*.64+cross*extension*rng.uniform(-.23,.23)+UP*rise*.66,end]
            rr = thick*(.38-.16*u)
            tree.add(axis,[rr,rr*.78,rr*.41,rr*.07],4,3)
            # Two bare, knuckled secondaries in the lower interior leave a
            # continuous view of the junction and a skylight beyond its fork.
            if j==0 and i in (1,n-1): continue
            spray_broadleaf(tree,'ek',axis,a2,r*rng.uniform(.20,.33),h,rng,hanging)


def upright_broadleaf(tree,key,h,r,form,rng,az):
    birch = key=='björk'
    leaders = (2,3,2)[form] if birch else (3,2,4)[form]
    split = ((.36,.20,.48) if birch else (.10,.25,.065))[form]
    lean = radial(az)*r*((.12,.08,.29) if birch else (.08,.20,.10))[form]
    girth = h*(.019 if birch else .025)
    bole = trunk(tree,h,r,lean,h*split,girth,az)
    for i in range(leaders):
        a = az + i*math.tau/leaders+rng.uniform(-.24,.24)
        facing,side = radial(a),radial(a+math.pi/2)
        foot = along(bole,.87+.13*rng.random())
        summit = h * (1 if i==0 else rng.uniform(.79,.94))
        span = r*((.16 if birch else .27) if i==0 else rng.uniform(.46,.74))
        axis = [foot]
        for j in range(1,6):
            t=j/5
            kink = side*r*.062*math.sin(t*math.tau*.8+i)
            axis.append(foot+UP*((summit-foot.y)*t)+facing*span*(t**1.15)+kink)
        stem = girth*(.91 if i==0 else .61)
        tree.add(axis,[stem*v for v in (1,.84,.63,.45,.26,.045)],8,5)
        limbs = (12 if birch else 11) - (1 if i else 0)
        for j in range(limbs):
            u = .09 + .88*(j+rng.uniform(.06,.83))/limbs
            p = along(axis,u)
            angle = a+GOLDEN*j+rng.uniform(-.32,.32)
            drift = radial(angle)
            # A few entire limbs grow into the crown, changing depth as the
            # tree rotates. Its lowest limbs and the summit are shorter.
            if i and drift.dot(facing)<-.3:
                drift = (drift+facing*.63).normalized()
            breadth = (.38 + .65*math.sin(math.pi*min(1,u+.13))**.79) if birch else (.51 + .47*math.sin(math.pi*u))
            length = r*breadth*(1-.63*u)*rng.uniform(.64,.98)
            rise = h*(1-.7*u)*rng.uniform(.115,.230) if birch else h*(1-.48*u)*rng.uniform(.074,.169)
            bend = radial(angle+math.pi/2)*length*rng.uniform(-.18,.18)
            middle = p+drift*length*.54+bend+UP*rise*(.88 if birch else .46)
            tip = p+drift*length+UP*rise
            if birch: tip -= UP*rise*.30
            branch = [p,p.lerp(middle,.49)+UP*rise*.09,middle,tip]
            rr=stem*(1-.63*u)*(.37 if birch else .46)
            tree.add(branch,[rr,rr*.75,rr*.42,.011],4,3)
            spray_broadleaf(tree,key,branch,angle,r*(.25 if birch else .34),h,rng)
        # The leader's last extension carries a few terminal shoots too.
        tree.shoot(axis[-2],axis[-1]-axis[-2],.74)


def spruce(tree,h,r,form,rng,az):
    # Flat, opposing combs of needles on old downward boughs, tighter radial
    # shoots on ascending tips. The three crowns differ in live-crown length
    # and in the balance of horizontal versus descending wood.
    base = (.115,.22,.085)[form]
    n = (14,15,13)[form]
    tilt = radial(az)*r*(.065,.11,.045)[form]
    axis = [UP*(h*t)+tilt*(t**1.4)+radial(az+1.6)*r*.038*math.sin(t*math.pi*1.45)
            for t in (0,.033,.12,.23,.34,.45,.56,.68,.79,.88,.95,1)]
    axis[0].y=-.045
    bole=h*.018
    tree.add(axis,[bole*1.48,bole*1.09]+[bole*(1-j/11)**.78+.008 for j in range(2,12)],10,6)
    def leader_at(y):
        for p,q in zip(axis,axis[1:]):
            if q.y>=y: return p.lerp(q,(y-p.y)/(q.y-p.y))
        return axis[-1]
    for whorl in range(n):
        t=base+(.935-base)*(whorl+.12+rng.uniform(-.08,.18))/(n-1)
        if t>.96: continue
        # Sample this leader by elevation; its segments use irregular spacing.
        branches = (6 if whorl<n*.63 else 5) - (1 if (whorl+form)%4==0 else 0)
        az += rng.uniform(.48,1.3)
        for j in range(branches):
            a=az+j*math.tau/branches+rng.uniform(-.31,.31)
            f,s=radial(a),radial(a+math.pi/2)
            z=h*(t+rng.uniform(-.022,.020))
            p=leader_at(z)
            span=r*((1-t)**(.66,.83,.59)[form])*(.89+.13*math.sin(t*math.pi))*rng.uniform(.73,1.13)
            droop=span*(.26,.17,.38)[form]*(1-t)
            # The lowest whorls bear their own weight above the foot. A bough
            # growing close to the root turns out before its elbow hits soil.
            droop=min(droop,max(0,z-h*(.043+.011*math.sin(a+form))))
            tip=p+f*span+UP*(span*(.33*t)-droop*.63)
            elbow=p+f*span*.65+s*span*rng.uniform(-.11,.11)-UP*droop
            path=[p,p+f*span*.26-UP*droop*.48,elbow,tip]
            rr=bole*(1-t)*.29
            tree.add(path,[rr,rr*.70,rr*.38,.009],3,3)
            for k in range(6):
                u=.15+.8*k/5
                origin=along(path,u)
                for sign in (-1,1):
                    wing=span*(.13+.23*math.sin(u*math.pi))*(1-u*.29)*rng.uniform(.75,1.08)
                    drop=wing*rng.uniform(.50,.87)*(1-t)
                    drop=min(drop,max(0,origin.y-h*(.028+.008*math.cos(a+u*3))))
                    end=origin+(s*sign*.83+f*.42)*wing-UP*drop
                    # Suspended shoots on both margins make the bough widths
                    # read as layered fans, including their hanging lower ends.
                    for v in (.22,.62,.94):
                        root=origin.lerp(end,v)
                        direction=(s*sign*.40+f*.46-UP*((1-t)*(.43+v*.90)) + UP*(.26*t)).normalized()
                        twig=direction*max(.14,wing*(.58-.25*v))
                        room=max(0,root.y-h*(.018+.006*math.sin(a+u*4+v)))
                        if twig.y < -room:
                            lateral=Vector((twig.x,0,twig.z)).normalized()
                            twig=lateral*math.sqrt(twig.length_squared-room*room)-UP*room
                        tree.shoot(root,twig,(.62+.58*(1-t))*(1-.22*v))
    # Short interwhorl shoots fill the upper leader between older, heavier
    # planes. Their asymmetric spacing gives each sapling-length apex a taper.
    for k in range(20):
        t=.53+.44*(k+.4)/20
        f=radial(az+k*GOLDEN)
        p=leader_at(h*t)
        reach=r*(1-t)*rng.uniform(.48,.95)
        end=p+f*reach+UP*reach*.21
        tree.add([p,end],[bole*(1-t)*.12,.008],3,3,detail=True)
        for step in (.22,.52,.78,.95):
            for sign in (-1,1):
                side=radial(az+k*GOLDEN+sign*1.06)
                direction=(side*.67+f*.48-UP*rng.uniform(.10,.64)).normalized()
                tree.shoot(p.lerp(end,step),direction*(reach*(.28+.21*(1-step))),.36+.72*(1-t))
    for k in range(22):
        t=.885+.115*k/21
        p=leader_at(h*t)
        d=(radial(k*GOLDEN)*.46+UP).normalized()
        tree.shoot(p,d*(.12+.5*(1-t)),.28+.36*(1-t))


def bake_tree(tree,key,h,r,seed,tier,limit):
    hero=tier=='hero'
    wood=Wood()
    noise=random.Random(seed+716)
    for path,radii,fine,coarse,small in tree.wood:
        if not hero:
            if small: continue
            keep=list(range(0,len(path)-1,2))+[len(path)-1]
            path,radii=[path[i] for i in keep],[radii[i] for i in keep]
        first = len(wood.P)
        sides = fine if hero else coarse
        wood.tube(path,radii,sides,BARK[key],h,noise)
        if key == 'björk':
            # Silver bark develops on the older limbs. Fine birch switches
            # retain warm brown bark, visible between their pendant leaves.
            for index in range(first,len(wood.P)):
                radius = radii[(index-first)//(sides+1)]
                young = max(0,min(1,(.095-radius)/.071))
                wood.C[index] = tuple(c*(1-young)+young*d for c,d in zip(wood.C[index],(.13,.078,.047)))
    trunk_part=dict(P=wood.P,N=wood.N,U=wood.U,I=wood.I,C=wood.C)
    budget=(limit-len(wood.I)//3)//2
    count=int(budget*.82) if key=='ek' else budget
    if count<240: raise ValueError(f'{key}/{tier} wood leaves only {count} sprigs')
    crown=dict(P=[],N=[],U=[],I=[])
    rng=random.Random(seed+893)
    population=tree.shoots.copy()
    rng.shuffle(population)
    # A card carries one complete published sprig, rooted at its stem. Far
    # tier cards occupy more area so the branch silhouette holds at the swap.
    size=r*{'björk':8.8,'ek':7.25,'al':9.7,'gran':12.6}[key]/math.sqrt(budget)
    for i in range(count):
        foot,shoot,vigor = tree.shoots[-1-i] if key=='gran' and i<22 else population[i%len(population)]
        a=shoot.normalized()
        around=a.cross(UP)
        if around.length<.02: around=radial(i*GOLDEN)
        around.normalize()
        j=rng.uniform(-1,1)
        direction=(a+around*j*(.38 if key=='gran' else .75)+UP*rng.uniform(-.11,.18)).normalized()
        offset=rng.uniform(.09,.92)
        anchor=foot+shoot*offset
        roll=rng.uniform(-.95,.95)
        if key=='gran':
            surface=(UP*.87+around*roll).normalized()
        else:
            # Each woody twig fans leaf blades in several inclinations. The
            # birch sprays hang about their wood rather than standing upright.
            surface=(UP*rng.uniform(.14,.86)+around*roll+radial(rng.uniform(0,math.tau))*.56).normalized()
        across=direction.cross(surface)
        if across.length<.02: across=around
        across.normalize()
        face=across.cross(direction).normalized()
        diameter=size*vigor*rng.uniform(.79,1.23)
        aspect=({'björk':.61,'gran':.79,'al':.90,'ek':.92}[key])*rng.uniform(.77,1.13)
        if key=='gran' and anchor.y<diameter*1.72:
            # Needled fans drape until there is insufficient room, then turn
            # sideways and taper individually. This acts on the entire sprig,
            # preserving the irregular outline of a bough in both mesh tiers.
            floor=h*(.007+.009*(.5+.5*math.sin(anchor.x*.83+anchor.z*.61)))
            room=max(.015,anchor.y-floor)
            free=min(1,room/max(.2,diameter*1.30))
            if direction.y<0: direction.y*=free
            direction.normalize()
            flat=direction.cross(UP)
            if flat.length>.02:
                flat.normalize()
                if flat.dot(across)<0: flat.negate()
                across=flat.lerp(across,free).normalized()
            face=across.cross(direction).normalized()
            downward=abs(across.y)*aspect*.5 + max(-direction.y*.88,direction.y*.12)
            if downward>0: diameter=min(diameter,room/downward)
        outer=Vector((anchor.x,(anchor.y-h*.54)*r/h*2.1,anchor.z)).normalized()
        cell=rng.randrange(4)
        flip=rng.random()<.5
        first=len(crown['P'])
        twist = rng.uniform(-.12,.12) if key=='ek' else 0
        for u,v in ((0,0),(1,0),(1,1),(0,1)):
            vertex=anchor+across*((u-.5)*aspect*diameter)+direction*((v-.12)*diameter)
            if twist: vertex+=face*(twist*(2*u-1)*v*diameter)
            local=(across*((u-.5)*.95)+direction*((v-.5)*.51)+outer*.74).normalized()
            crown['P'].append(vertex)
            crown['N'].append((outer*.45+local*.34+face*.24+UP*.08).normalized())
            crown['U'].append(((cell%2+.02+.96*(1-u if flip else u))*.5,
                               (cell//2+.98-.96*v)*.5))
        crown['I'].extend(first+j for j in (0,1,2,0,2,3))
    fit((trunk_part,crown),h,r)
    # Wind every bark triangle about its authored radial normals. This also
    # handles the tight elbow where a silver birch's twig turns downwards.
    for i in range(0,len(wood.I),3):
        a,b,c=trunk_part['I'][i:i+3]
        p=trunk_part['P']
        face=(p[b]-p[a]).cross(p[c]-p[a])
        n=trunk_part['N']
        if face.dot(n[a]+n[b]+n[c])<0:
            trunk_part['I'][i+1],trunk_part['I'][i+2]=c,b
    light_canopy(crown)
    return dict(key=key,tier=tier,trunk=trunk_part,crown=crown)


def build(out):
    out.mkdir(parents=True,exist_ok=True)
    scene=bpy.data.scenes.new('Banvy woodland specimens')
    catalog=json.loads(Path('apps/golf/public/models/trees/realistic-v2.json').read_text(encoding='utf-8'))
    for row,item in enumerate(catalog['species']):
        key=item['key']
        if key not in BARK: continue
        for form,spec in enumerate(item['variants']):
            seed,h,r=spec['seed'],spec['templateHeight'],spec['templateRadius']
            rng=random.Random(seed+4118)
            az=rng.uniform(0,math.tau)
            tree=Branches()
            if key=='ek': oak(tree,h,r,form,rng,az)
            elif key=='gran': spruce(tree,h,r,form,rng,az)
            else: upright_broadleaf(tree,key,h,r,form,rng,az)
            for level,tier in enumerate(('hero','full')):
                model=bake_tree(tree,key,h,r,seed,tier,spec['tiers'][tier]['tris'])
                preview(scene,model,row*26,form*56+level*28)
                data={}
                for label in ('trunk','crown'):
                    obj=model[label]
                    data[label] = dict(position=flat(obj['P'],3),normal=flat(obj['N'],3),
                                       uv=flat(obj['U'],2),index=obj['I'])
                    if label=='trunk': data[label]['color']=flat(obj['C'],3)
                (out/f'{key}-{form}-{tier}.json').write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
                print(key,form,tier,len(model['trunk']['I'])//3,len(model['crown']['I'])//3,flush=True)


if __name__=='__main__':
    build(Path(sys.argv[sys.argv.index('--')+1]))
