"""Model and bake the individual leaves of Banvy's woodland branchlets in Blender.

From the repository root run Blender with -b -P this-file -- <workdir>, then
node tools/blender-tree-study/realistic/pack_woodland_sprigs.mjs <workdir>.
Metre scale comes from the finished cards: the median hero oak card is 1.70 m,
birch 1.11 m and alder 1.13 m. Each cell is a branch bearing many small shoots.
"""
import math
import os
import random
import sys
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from sprig_atlas import Sprig, ensure_scene, material

SPECS = {
    # Blade length as a fraction of a card, maximum half-width and petiole.
    'ek':    (.034,.048,.34,.10),
    'björk': (.031,.049,.34,.30),
    'al':    (.043,.064,.40,.23),
}


def plan(x,y,z=0): return Vector((x,y,z))


def blade(s,key,p,angle,length,rng):
    lo,hi,width,stalk = SPECS[key]
    along = plan(math.cos(angle),math.sin(angle),rng.uniform(-.34,.35)).normalized()
    side = plan(-along.y,along.x,rng.uniform(-.62,.62)).normalized()
    mid = along.cross(side).normalized()
    root = p+along*(stalk*length)
    s.tube([p,root],[.0016,.0008],(.34,.29,.18),3)
    warm=rng.uniform(-1,1);tone=rng.uniform(.66,1.03)
    base=(tone*(1+.065*warm),tone*(1+.024*rng.random()),tone*(1-.085*warm))
    phase=rng.uniform(-.26,.26)
    tilt=rng.uniform(.12,.32);curl=rng.uniform(-.053,.10)
    rows=[]
    for j in range(25):
        t=j/24
        if key=='ek':
            # Rounded lobes and broad outer half on Quercus robur.
            envelope=math.sin(math.pi*t**1.16)**.74*(.63+.37*t)
        elif key=='björk':
            # Rhomboidal base, long finely serrated tip of silver birch.
            envelope=(t/.34)**.72 if t<.34 else max(0,(1-t)/.66)**.80
        else:
            envelope=math.sin(math.pi*t**1.30)**.58
        row=[]
        for u in (-1,-.105,0,.105,1):
            side_phase=phase if u<0 else -phase+.19
            if key=='ek':
                teeth=.63+.37*(.5-.5*math.cos(t*math.tau*4.8+side_phase))
            elif key=='björk':
                teeth=.89+.11*(.5+.5*math.sin(t*91+side_phase))
            else: teeth=.95+.05*math.cos(t*77+side_phase)
            span=u*length*width*envelope*teeth
            curve=length*(curl*t*t + abs(span/length)*tilt)
            tip=t
            if key=='al':
                # A shallow central notch in an otherwise rounded alder blade.
                tip-=max(0,(t-.83)/.17)**2*.078*(1-abs(u))
            v=root+along*(length*tip)+side*span+mid*curve
            rib=(1.085 if u==0 else .98 if abs(u)<.2 else .94)+t*.035
            row.append(s.vert(v,tuple(min(1,c*rib) for c in base),.88+.10*(1-abs(u))))
        rows.append(row)
    s.strip(rows,5)


def shoot(s,key,points,rng,depth):
    spec=SPECS[key]
    count=(10 if key=='ek' else 9) + rng.randrange(4)
    for j in range(count):
        t=.06+.90*(j+rng.uniform(.04,.94))/count
        steps=(len(points)-1)*t
        idx=min(len(points)-2,int(steps))
        x=points[idx].lerp(points[idx+1],steps-idx)
        branch=points[idx+1]-points[idx]
        side=1 if j%2 else -1
        # The more open basal internodes and clustered terminal oak buds
        # are retained on each independent secondary stem.
        angle=math.atan2(branch.y,branch.x)+side*rng.uniform(.55,1.55)
        if key=='björk': angle+=rng.uniform(-.25,.25)
        length=rng.uniform(spec[0],spec[1])*(.88+.12*math.sin(t*math.pi))
        blade(s,key,x,angle,length,rng)


def model(key,seed):
    rng=random.Random(seed)
    twig=Sprig()
    axis=[]
    drift=rng.uniform(-.10,.10)
    for k in range(14):
        t=k/13
        axis.append(plan(.51+drift*t+.029*math.sin(5*t+rng.random()*.22),.026+t*.86,
                         .016*math.sin(t*7)))
    twig.tube(axis,[.0066*(1-k/16)+.0009 for k in range(14)],(.34,.25,.17),6)
    for b in range(13):
        t=.075+.862*(b+rng.uniform(.04,.88))/13
        source=min(12,int(t*13))
        p=axis[source].lerp(axis[source+1],t*13-source)
        sign=1 if b%2 else -1
        span=(.22+.19*math.sin(t*math.pi)**.72)*(1-.54*t)*rng.uniform(.87,1.16)
        rise=rng.uniform(.092,.216)*(1-.39*t)
        if key=='björk':rise-=.046
        end=p+plan(sign*span,rise,rng.uniform(-.045,.045))
        bend=plan(sign*span*.10,.045 if key=='björk' else -.025,.013)
        rachis=[p.lerp(end,j/6)+bend*math.sin(j/6*math.pi) for j in range(7)]
        twig.tube(rachis,[.0041*(1-j/7)+.00065 for j in range(7)],(.37,.28,.18),5)
        for j in range(8):
            u=.14+.84*(j+rng.uniform(.06,.94))/8
            k=min(5,int(u*6))
            start=rachis[k].lerp(rachis[k+1],u*6-k)
            side=1 if j%2 else -1
            angle=math.atan2(rise,span*sign)+side*rng.uniform(.57,1.37)
            reach=(.095+.070*math.sin(math.pi*u))*rng.uniform(.81,1.16)
            direction=plan(math.cos(angle),math.sin(angle),rng.uniform(-.20,.19))
            tip=start+direction*reach
            bend=plan(rng.uniform(-.010,.010),-.043 if key=='björk' else rng.uniform(-.016,.019),.008)
            branch=[start,start.lerp(tip,.48)+bend,tip]
            twig.tube(branch,[.0023,.00165,.00065],(.37,.32,.20),4)
            shoot(twig,key,branch,rng,2)
        shoot(twig,key,rachis,rng,1)
    shoot(twig,key,axis[8:],rng,1)
    # Frame the full bough with a gutter. Keep the calibrated blade size even
    # on unusually narrow branchlets. Fitting laid-out leaves by rejection
    # would lose most of their outer shoots at the four atlas cell edges.
    xs=[v.x for v in twig.V];ys=[v.y for v in twig.V]
    scale=min(.945/(max(xs)-min(xs)),.945/(max(ys)-min(ys)),1.02)
    centre=plan((min(xs)+max(xs))*.5,(min(ys)+max(ys))*.5)
    twig.V=[(v-centre)*scale+plan(.5,.5) for v in twig.V]
    return twig


def render(out):
    out.mkdir(exist_ok=True,parents=True)
    scene=ensure_scene();scene.cycles.samples=4
    colour,normal=material('woodland-leaf-pigment','colour'),material('woodland-leaf-normal','normal')
    for idx,key in enumerate(SPECS):
        objects=[]
        for cell in range(4):
            sprig=model(key,9231+idx*713+cell*61)
            offset=plan(cell%2-1,-(cell//2))
            me=bpy.data.meshes.new(f'woodland-{key}-{cell}')
            me.from_pydata([tuple(p+offset) for p in sprig.V],[],sprig.F);me.update()
            colors=me.color_attributes.new('Col','FLOAT_COLOR','POINT')
            colors.data.foreach_set('color',[c for rgba in sprig.C for c in rgba])
            for face in me.polygons:
                if face.normal.z<0: face.flip()
                face.use_smooth=True
            me.update()
            ob=bpy.data.objects.new(me.name,me);scene.collection.objects.link(ob);objects.append(ob)
        for label,mat,view in (('colour',colour,'Standard'),('normal',normal,'Raw')):
            for ob in objects:
                ob.data.materials.clear();ob.data.materials.append(mat)
            scene.view_settings.view_transform=view;scene.view_settings.look='None'
            scene.render.filepath=str((out/f'{key}-{label}.png').resolve())
            bpy.ops.render.render(write_still=True,scene=scene.name)
        for ob in objects:
            mesh=ob.data;bpy.data.objects.remove(ob,do_unlink=True);bpy.data.meshes.remove(mesh)


if __name__=='__main__': render(Path(sys.argv[sys.argv.index('--')+1]))
