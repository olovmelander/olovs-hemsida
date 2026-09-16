"""Shared, anatomically oriented golfer motion, authored in Blender metres.

Axes: face -Y, character left +X, up +Z. A right-handed shot travels +X.
The glTF conversion is (x,z,-y): face +Z and the shot still travels +X.
"""
import math
import bpy
from mathutils import Vector, Matrix, Euler, Quaternion

V=Vector
PI=math.pi
FPS=60
LENGTHS={'Driver':1.08,'Wood':1.015,'Iron':.94,'Wedge':.88,'Putter':.84}
CLIPS=[('Idle',3.2,'Iron',True),('Walk',1.1,'Iron',True),('WalkBackward',1.2,'Iron',True),
       ('StrafeLeft',1.2,'Iron',True),('StrafeRight',1.2,'Iron',True),('Jog',.8,'Iron',True),
       ('TurnLeft',.9,'Iron',False),('TurnRight',.9,'Iron',False),
       *[('Address'+c,2.,c,True) for c in LENGTHS],
       ('SwingDriver',2.5,'Driver',False),('SwingWood',70/30,'Wood',False),('SwingIron',65/30,'Iron',False),
       ('ChipWedge',50/30,'Wedge',False),('Putt',50/30,'Putter',False),('ClubChange',1.2,'Iron',False),('Celebrate',2.,'Iron',False)]

def clamp(x,a=0,b=1):return min(b,max(a,x))
def smooth(x):x=clamp(x);return x*x*(3-2*x)
def mix(a,b,t):return a+(b-a)*t

def curve(keys,t):
    """Time-aware Hermite interpolation; motion continues THROUGH impact keys."""
    t=clamp(t)
    for i in range(len(keys)-1):
        t0,a=keys[i];t1,b=keys[i+1]
        if t<=t1:
            dt=t1-t0;u=clamp((t-t0)/dt)
            before=keys[max(0,i-1)];after=keys[min(len(keys)-1,i+2)]
            result=[]
            for j,(x,y) in enumerate(zip(a,b)):
                m0=0 if i==0 or before[1][j]==x or x==y else (y-before[1][j])/(t1-before[0])
                m1=0 if i+2==len(keys) or after[1][j]==y or x==y else (after[1][j]-x)/(after[0]-t0)
                result.append((2*u**3-3*u*u+1)*x+(u**3-2*u*u+u)*dt*m0+(-2*u**3+3*u*u)*y+(u**3-u*u)*dt*m1)
            return result
    return list(keys[-1][1])

def frame(axis,reference):
    y=V(axis).normalized();z=V(reference)-y*y.dot(V(reference))
    if z.length<1e-5:z=y.cross(V((1,0,0)))
    z.normalize();x=y.cross(z).normalized()
    return Matrix((x,y,z)).transposed()

def solve(a,b,l1,l2,pole):
    delta=b-a;distance=delta.length
    if distance>l1+l2+1e-5:raise ValueError('Unreachable limb: %.5f > %.5f'%(distance,l1+l2))
    d=clamp(distance,abs(l1-l2)+1e-5,l1+l2-1e-5);axis=delta.normalized()
    along=(l1*l1-l2*l2+d*d)/(2*d)
    perpendicular=V(pole)-axis*axis.dot(V(pole))
    if perpendicular.length<1e-5:perpendicular=axis.cross(V((1,0,0)))
    return a+axis*along+perpendicular.normalized()*math.sqrt(max(0,l1*l1-along*along))

def contact_offset(club):
    # A point on the lower striking face, not the shaft end or head centre.
    x,y,z={'Driver':(.045,-.065,-.002),'Wood':(.045,-.065,-.002),'Iron':(.034,-.033,-.004),'Wedge':(.034,-.033,-.004),'Putter':(.033,-.051,0)}[club]
    return V((x,y,-LENGTHS[club]+z))

def club_rotation(direction,face):
    shaft=V(direction).normalized()
    # Track the heel-to-toe axis (normal to the swing plane). Projecting the
    # target direction onto the shaft instead becomes singular at half swing.
    toe_ref=V((-face[1],face[0],0));toe=toe_ref-shaft*shaft.dot(toe_ref);toe.normalize()
    front=shaft.cross(toe).normalized()
    return Matrix((toe,-front,-shaft)).transposed()

class Motion:
    def __init__(self,rig):
        self.rig=rig;self.rest={b.name:b.matrix_local.copy() for b in rig.data.bones}
        self.heads={b.name:b.head_local.copy() for b in rig.data.bones}
        self.lengths={b.name:b.length for b in rig.data.bones}
        self.axes={b.name:(b.tail_local-b.head_local).normalized() for b in rig.data.bones}
        self.grips={}
        for side,s in [('L',1),('R',-1)]:
            knuckles=sum((self.heads['Finger%dA_'%j+side] for j in range(4)),V())/4
            centre=knuckles+V((-s*.024,.002,.015))
            self.grips[side]=self.rest['Hand_'+side].inverted()@centre
        self.soles={side:[] for side in ['L','R']}
        for ob in rig.children:
            if ob.type!='MESH' or 'Club_' in ob.name:continue
            names={g.index:g.name for g in ob.vertex_groups}
            for vertex in ob.data.vertices:
                for group in vertex.groups:
                    name=names[group.group]
                    if name in ['Foot_L','Foot_R'] and group.weight>.98:
                        self.soles[name[-1]].append(vertex.co-self.heads[name])
        self.max_adjustment=0

    def orient(self,name,head,tail,reference=(0,1,0),rest_reference=(0,1,0)):
        rotation=frame(V(tail)-V(head),reference)@frame(self.axes[name],rest_reference).transposed()
        result=rotation.to_4x4()@self.rest[name];result.translation=head
        return result

    def hand(self,side,axis,thumb):
        return self.orient('Hand_'+side,V(),V(axis),thumb,(0,-1,0))

    def foot(self,side,x,y,lift,pitch=0,yaw=0):
        rotation=Euler((pitch,0,yaw)).to_matrix()
        points=self.soles[side] or [V((0,-.07,-.099))]
        ankle_z=.006-min((rotation@p).z for p in points)+lift
        pivot=V((0,-.20 if pitch>=0 else .055,.028-self.heads['Foot_'+side].z))
        correction=pivot-rotation@pivot if abs(pitch)>1e-8 else V()
        result=rotation.to_4x4()@self.rest['Foot_'+side]
        result.translation=V((x+correction.x,y+correction.y,ankle_z));return result

    def elbow_pole(self,side,p,kind,golf,bodyrot,shoulder,hip_offset):
        s=1 if side=="L" else -1
        pole=bodyrot@V((s*.12,1,.05))
        if golf:pole=bodyrot@V((s*.38,.72,-.25))
        if kind.startswith('Swing'):
            lead=[(.0,[.22,-.12,1.18]),(.24,[.12,-.32,1.14]),(.35,[-.06,-.40,1.36]),(.44,[0,-.40,1.48]),(.49,[-.06,-.40,1.39]),(.55,[.12,-.23,1.15]),(.60,[.19,-.22,1.16]),(.65,[.30,-.18,1.15]),(.74,[.39,.10,1.29]),(.90,[.21,.28,1.38]),(1,[.21,.28,1.38])]
            trail=[(.0,[-.21,-.09,1.18]),(.24,[-.36,0,1.18]),(.35,[-.43,.07,1.19]),(.44,[-.42,.02,1.28]),(.49,[-.36,0,1.21]),(.55,[-.25,-.08,1.12]),(.60,[-.13,-.13,1.11]),(.65,[-.04,-.18,1.27]),(.74,[.10,-.13,1.40]),(.90,[.05,-.11,1.46]),(1,[.05,-.11,1.46])]
            preferred=V(curve(lead if side=='L' else trail,p))+hip_offset
            pole=preferred-shoulder
        if kind=='Celebrate' and side=='L':pole=V((.7,.35,-.25))
        return pole

    def pose(self,kind,t,duration,club):
        p=t/duration;wave=math.sin(2*PI*p)
        moving=kind in ['Walk','WalkBackward','StrafeLeft','StrafeRight','Jog']
        golf=kind.startswith(('Address','Swing')) or kind in ['ChipWedge','Putt']
        hip=V((0,0,.972+.002*wave));lean=0;twist=0;chest=0;sidebend=0
        feet={side:self.foot(side,s*.115,0,0) for side,s in [('L',1),('R',-1)]}
        hands={};hand_m={};arm_swing={'L':0,'R':0}
        grip_origin=None;shaft=V((.06,.66,-.75)).normalized();face=V((0,-1,0))
        if moving:
            jogging=kind=='Jog';strafe=kind.startswith('Strafe')
            stride=.30 if jogging else .16 if strafe else .24
            stance=.5 if jogging else .62
            hip.z=.925+(.042 if jogging else .014)*(.5-.5*math.cos(4*PI*p))
            hip.x=.012*math.sin(2*PI*(p-.12));lean=.10 if jogging else .025
            twist=.045*math.cos(2*PI*p);chest=-twist*.65
            for side,s in [('L',1),('R',-1)]:
                phase=(p+(0 if side=='L' else .5))%1
                travel=mix(-stride,stride,phase/stance) if phase<stance else mix(stride,-stride,smooth((phase-stance)/(1-stance)))
                lift=0 if phase<stance else (.12 if jogging else .075)*math.sin(PI*(phase-stance)/(1-stance))**2
                pitch=mix(-.16,0,smooth(phase/.14)) if phase<.14 else .27*smooth((phase-(stance-.16))/.16) if phase<stance else .27*(1-smooth((phase-stance)/.19))-.16*smooth((phase-.90)/.10)
                if kind=='WalkBackward':travel=-travel;pitch=-pitch*.6
                if strafe:
                    direction=1 if kind=='StrafeLeft' else -1
                    feet[side]=self.foot(side,s*.17-travel*direction,0,lift,0)
                    arm_swing[side]=s*.025*wave
                else:
                    feet[side]=self.foot(side,s*.115,travel,lift,pitch)
                    # Ipsilateral hand opposes its foot; the other arm comes forward.
                    arm_swing[side]=-travel*(.52 if jogging else .43)
        elif kind.startswith('Turn'):
            # Root heading is applied by the runtime using manifest.turnAngle.
            for side,s in [('L',1),('R',-1)]:
                lift=.045*math.sin(PI*clamp((p-(0 if s==1 else .4))/.55))**2
                feet[side]=self.foot(side,s*.13,0,lift)
            hip.z-=.012*math.sin(PI*p)**2
        if golf:
            short=club in ['Putter','Wedge'];putt=club=='Putter'
            width=.15 if putt else .18 if short else .215
            hip=V((0,.02,{'Driver':.956,'Wood':.935,'Iron':.900,'Wedge':.875,'Putter':.866}[club]))
            lean={'Driver':.28,'Wood':.32,'Iron':.39,'Wedge':.43,'Putter':.46}[club]
            sidebend=-.055 if not putt else 0
            shaft=V({'Driver':(.015,-.30,-.954),'Wood':(-.025,-.29,-.957),'Iron':(-.055,-.26,-.964),'Wedge':(-.07,-.23,-.971),'Putter':(0,-.18,-.984)}[club]).normalized()
            face=V((1,0,0));address_rot=club_rotation(shaft,face)
            ball=V(({'Driver':.10,'Wood':.045,'Iron':0,'Wedge':-.018,'Putter':0}[club],-{'Driver':.72,'Wood':.69,'Iron':.64,'Wedge':.60,'Putter':.58}[club],.02135))
            address=ball-address_rot@contact_offset(club)
            addr=[*address,*shaft,0,0,0,0]
            vals=addr
            if kind.startswith('Swing'):
                # Grip and shaft describe a connected takeaway, lag, impact and release.
                keys=[(0,addr),(.10,addr),(.24,[-.20,-.38,1.06,-.79,-.39,-.47,-.17,-.36,-.014,0]),
                    (.35,[-.35,-.21,1.39,-.55,.21,.81,-.30,-.70,-.020,0]),
                    (.44,[-.36,-.07,1.64,.77,.39,.50,-.38,-.98,-.020,0]),
                    (.49,[-.33,-.09,1.56,.46,.19,.87,-.13,-.81,-.007,0]),
                    (.515,[-.25,-.19,1.35,-.55,.18,.81,-.01,-.61,.004,0]),
                    (.535,[-.20,-.26,1.20,-.98,-.14,.08,.04,-.46,.012,0]),
                    (.55,[-.16,-.30,1.10,-.73,-.12,-.67,.09,-.32,.018,0]),
                    (.60,[*address,*shaft,.19,.14,.031,0]),
                    (.65,[.25,-.34,1.07,.68,-.23,-.70,.43,.58,.054,.018]),
                    (.74,[.42,-.11,1.40,.76,.22,.61,.71,1.02,.069,.050]),
                    (.80,[.36,.025,1.60,.15,.47,.87,.84,1.20,.073,.065]),
                    (.85,[.29,.08,1.66,-.50,.74,.44,.91,1.31,.075,.073]),
                    (.90,[.24,.10,1.67,-.65,.73,-.20,.94,1.36,.075,.075]),
                    (1,[.24,.10,1.67,-.65,.73,-.20,.94,1.36,.075,.075])]
                vals=curve(keys,p)
                lean*=1-.65*smooth((p-.66)/.24)
            elif kind=='ChipWedge':
                vals=curve([(0,addr),(.12,addr),(.40,[-.16,-.41,1.0,-.53,-.25,-.81,-.07,-.17,-.008,0]),
                    (.60,addr),(.82,[.24,-.40,1.04,.50,-.24,-.83,.16,.28,.025,.006]),(1,[.24,-.40,1.04,.50,-.24,-.83,.16,.28,.025,.006])],p)
            elif kind=='Putt':
                angle=curve([(0,[0]),(.12,[0]),(.40,[-.10]),(.60,[0]),(.83,[.13]),(1,[.13])],p)[0]
                pivot=V((0,address.y,1.42));rot=Matrix.Rotation(-angle,3,'Y')
                origin=pivot+rot@(address-pivot);direction=rot@shaft
                vals=[*origin,*direction,0,0,0,0]
            grip_origin=V(vals[:3]);shaft=V(vals[3:6]).normalized();twist,chest,shift,rise=vals[6:]
            hip.x+=shift;hip.z+=rise
            face=V((1,0,0))
            feet={'L':self.foot('L',width,-.01,0,0,.12),'R':self.foot('R',-width,.01,0,.66*smooth((p-.62)/.22) if kind.startswith('Swing') else 0,0)}
            for side,s in [('L',1),('R',-1)]:
                hand_m[side]=self.hand(side,shaft,(-.15*s,-1,0))
                along=.066 if side=='L' else .142
                hands[side]=grip_origin+shaft*along-hand_m[side].to_3x3()@self.grips[side]
        else:
            bodyrot=Euler((lean,0,chest)).to_matrix()
            for side,s in [('L',1),('R',-1)]:
                shoulder=hip+bodyrot@(self.heads['UpperArm_'+side]-self.heads['Hips'])
                jog=kind=='Jog'
                hands[side]=shoulder+V((s*.055,arm_swing[side]-(.17 if jog else .008),-.40 if jog else -.561))
                hand_m[side]=self.hand(side,V((s*.02,-.04,-1)),(0,-1,0))
            if kind=='Celebrate':
                amount=math.sin(PI*p)**2
                hands['L']=hands['L'].lerp(V((.46,-.18,1.78)),amount)
            if kind=='ClubChange':
                amount=math.sin(PI*p)**2
                hands['R']=hands['R'].lerp(V((-.18,-.34,1.16)),amount)
                hands['L']=hands['L'].lerp(V((.12,-.35,1.13)),amount)
                shaft=V((0,.65-amount*.55,-.78)).normalized()
        # Keep the handle fixed. Small posture adjustments solve reach for both
        # hands together, rather than independently detaching either wrist.
        bodyrot=Euler((lean,sidebend,chest)).to_matrix()
        start_hip=hip.copy()
        hiprot=Euler((0,0,twist)).to_matrix()
        for iteration in range(40):
            for side in ['L','R']:
                shoulder=hip+bodyrot@(self.heads['UpperArm_'+side]-self.heads['Hips'])
                delta=hands[side]-shoulder;reach=self.lengths['UpperArm_'+side]+self.lengths['Forearm_'+side]-.002
                if delta.length>reach:hip+=delta.normalized()*(delta.length-reach)*.7
            for side in ['L','R']:
                offset=hiprot@(self.heads['Thigh_'+side]-self.heads['Hips'])
                ankle=feet[side].translation
                horizontal=V((hip.x+offset.x-ankle.x,hip.y+offset.y-ankle.y,0)).length
                reach=self.lengths['Thigh_'+side]+self.lengths['Shin_'+side]-.001
                limit=ankle.z+math.sqrt(max(0,reach*reach-horizontal*horizontal))-offset.z
                hip.z=min(hip.z,limit)
            if golf and iteration>3:
                for side,s in [('L',1),('R',-1)]:
                    shoulder=hip+bodyrot@(self.heads['UpperArm_'+side]-self.heads['Hips'])
                    delta=hands[side]-shoulder
                    reach=self.lengths['UpperArm_'+side]+self.lengths['Forearm_'+side]-.001
                    safe_target=shoulder+delta.normalized()*min(delta.length,reach)
                    pole=self.elbow_pole(side,p,kind,golf,bodyrot,shoulder,hip-start_hip)
                    elbow=solve(shoulder,safe_target,self.lengths['UpperArm_'+side],self.lengths['Forearm_'+side],pole)
                    forearm=(safe_target-elbow).normalized()
                    angle=forearm.angle(shaft)
                    max_flex=math.radians(65)
                    axis=shaft if angle<=max_flex else forearm.rotation_difference(shaft).slerp(Quaternion(),1-max_flex/angle)@forearm
                    target_m=self.hand(side,axis,(-.15*s,-1,0))
                    q=hand_m[side].to_quaternion().slerp(target_m.to_quaternion(),.45)
                    hand_m[side]=q.to_matrix().to_4x4()
                    hands[side]=grip_origin+shaft*(.066 if side=='L' else .142)-hand_m[side].to_3x3()@self.grips[side]
        self.max_adjustment=max(self.max_adjustment,(hip-start_hip).length)
        world={'Root':self.rest['Root'].copy()}
        hiprot=Euler((0,0,twist)).to_matrix()
        for name in ['Hips','Spine','Chest','Neck','Head']:
            pos=hip+bodyrot@(self.heads[name]-self.heads['Hips'])
            rotation=hiprot if name=='Hips' else bodyrot
            if name=='Head' and golf:
                rotation=Euler((.44*(1-.55*smooth((p-.67)/.25)) if kind.startswith('Swing') else .44,0,chest*.40 if p>.63 and kind.startswith('Swing') else chest*.05)).to_matrix()
            world[name]=rotation.to_4x4()@self.rest[name];world[name].translation=pos
        for side,s in [('L',1),('R',-1)]:
            a=hip+hiprot@(self.heads['Thigh_'+side]-self.heads['Hips']);b=feet[side].translation
            l1=self.lengths['Thigh_'+side];l2=self.lengths['Shin_'+side]
            if (b-a).length>l1+l2-.001:
                # Rare toe-off extrema: reduce stride rather than lengthening a shin.
                horizontal=V((b.x-a.x,b.y-a.y,0));max_horizontal=math.sqrt(max(0,(l1+l2-.001)**2-(b.z-a.z)**2))
                if horizontal.length>max_horizontal:
                    b.x=a.x+horizontal.x*max_horizontal/horizontal.length;b.y=a.y+horizontal.y*max_horizontal/horizontal.length
                    feet[side].translation=b
            knee=solve(a,b,l1,l2,(0,-1,0))
            world['Thigh_'+side]=self.orient('Thigh_'+side,a,knee)
            world['Shin_'+side]=self.orient('Shin_'+side,knee,b)
            world['Foot_'+side]=feet[side]
            shoulder=hip+bodyrot@(self.heads['UpperArm_'+side]-self.heads['Hips'])
            pole=self.elbow_pole(side,p,kind,golf,bodyrot,shoulder,hip-start_hip)
            elbow=solve(shoulder,hands[side],self.lengths['UpperArm_'+side],self.lengths['Forearm_'+side],pole)
            hinge=(elbow-shoulder).cross(hands[side]-elbow).normalized()
            # A hinge normal stays perpendicular to BOTH segments. Using the
            # elbow pole as the forearm's roll reference flipped it at full flexion.
            world['UpperArm_'+side]=self.orient('UpperArm_'+side,shoulder,elbow,hinge,(-1,0,0))
            world['Forearm_'+side]=self.orient('Forearm_'+side,elbow,hands[side],hinge,(-1,0,0))
            if not golf:
                # A carrying or raised hand follows its forearm's neutral wrist.
                # Keeping it pointed down bent the celebration wrist backwards.
                hand_m[side]=world['Forearm_'+side]@self.rest['Forearm_'+side].inverted()@self.rest['Hand_'+side]
            world['Hand_'+side]=hand_m[side];world['Hand_'+side].translation=hands[side]
        if not golf:grip_origin=world['Hand_R']@self.grips['R']
        clubrot=club_rotation(shaft,face)
        world['ClubGrip']=clubrot.to_4x4()@self.rest['ClubGrip'];world['ClubGrip'].translation=grip_origin
        for name in self.rest:
            if name in world:continue
            bone=self.rig.data.bones[name];parent=bone.parent.name
            world[name]=world[parent]@self.rest[parent].inverted()@self.rest[name]
            side=name[-1];s=1 if side=='L' else -1
            gripping=golf or side=='R' or kind=='Celebrate'
            curl=(1.20 if 'B_' in name else .78) if gripping else (.22 if 'B_' in name else .10)
            if name.startswith('Thumb'):curl*=.38
            axis=self.rest[name].to_quaternion().inverted()@V((0,s,0))
            world[name]=world[name]@Quaternion(axis,curl).to_matrix().to_4x4()
        if kind.startswith('Turn'):
            turn=Matrix.Rotation((1 if kind=='TurnLeft' else -1)*PI*.5*smooth(p),4,'Z')
            world={name:turn@matrix for name,matrix in world.items()}
        for name,matrix in world.items():
            bone=self.rig.data.bones[name];parent=bone.parent.name if bone.parent else None
            basis=self.rest[name].inverted()@(self.rest[parent]@world[parent].inverted() if parent else Matrix.Identity(4))@matrix
            pb=self.rig.pose.bones[name];pb.rotation_mode='QUATERNION';pb.matrix_basis=basis
        return world,grip_origin+clubrot@contact_offset(club),clubrot@V((0,-1,0))

def bake(rig,scene):
    variant='male' if rig.name.startswith('Male_') else 'female'
    rig.animation_data_create();rig.animation_data.action=None
    for track in list(rig.animation_data.nla_tracks):rig.animation_data.nla_tracks.remove(track)
    for action in list(bpy.data.actions):
        if action.get('banvy_golfer') and (action.get('banvy_character')=='male')==(variant=='male'):
            bpy.data.actions.remove(action)
    motion=Motion(rig);actions=[];clips=[];scene.render.fps=FPS
    for name,duration,club,loop in CLIPS:
        action=bpy.data.actions.new(('Male | ' if variant=='male' else '')+name)
        action.use_fake_user=True;action['banvy_golfer']=True;action['clip_name']=name
        if variant=='male':action['banvy_character']='male'
        rig.animation_data.action=action;actions.append(action)
        frames=round(duration*FPS);duration=frames/FPS;previous={}
        for f in range(frames+1):
            try:motion.pose(name,f/FPS,duration,club)
            except Exception as error:raise RuntimeError('%s frame %d: %s'%(name,f,error)) from error
            for pb in rig.pose.bones:
                if pb.name in previous and previous[pb.name].dot(pb.rotation_quaternion)<0:pb.rotation_quaternion.negate()
                previous[pb.name]=pb.rotation_quaternion.copy()
                pb.keyframe_insert('location',frame=f+1,group=pb.name);pb.keyframe_insert('rotation_quaternion',frame=f+1,group=pb.name)
        for slot in action.slots:
            for layer in action.layers:
                for strip in layer.strips:
                    bag=strip.channelbag(slot)
                    if bag:
                        for fc in bag.fcurves:
                            for k in fc.keyframe_points:k.interpolation='LINEAR'
        entry={'name':name,'duration':duration,'loop':loop,'club':club}
        if name in ['Walk','WalkBackward','StrafeLeft','StrafeRight','Jog']:
            stance=.5 if name=='Jog' else .62;stride=.30 if name=='Jog' else .16 if name.startswith('Strafe') else .24
            entry.update(speed=2*stride/(stance*duration),stance=stance,travelDirection={'Walk':[0,0,1],'WalkBackward':[0,0,-1],'Jog':[0,0,1],'StrafeLeft':[1,0,0],'StrafeRight':[-1,0,0]}[name])
        if name.startswith('Turn'):entry['turnAngle']=(1 if name=='TurnLeft' else -1)*PI/2
        if name.startswith('Swing') or name in ['ChipWedge','Putt']:
            impact=duration*.60;_,contact,normal=motion.pose(name,impact,duration,club)
            entry.update(impact=impact,contact=[contact.x,contact.z,-contact.y],shotDirection=[1,0,0],faceDirection=[normal.x,normal.z,-normal.y])
        clips.append(entry)
    # Bone-parented audit markers are exported as empty nodes, without draw calls.
    collection=rig.users_collection[0]
    for ob in list(collection.objects):
        if ob.get('golfer_motion_marker'):bpy.data.objects.remove(ob,do_unlink=True)
    def marker(name,bone,local):
        ob=bpy.data.objects.new(('Male_' if variant=='male' else '')+name,None);collection.objects.link(ob)
        ob.parent=rig;ob.parent_type='BONE';ob.parent_bone=bone;ob.location=V(local)-V((0,rig.data.bones[bone].length,0))
        ob['golfer_motion_marker']=True;ob.empty_display_size=.025;return ob
    for side in ['L','R']:marker('Grip_'+side,'Hand_'+side,motion.grips[side])
    for side in ['L','R']:
        for label,y in [('Toe',-.20),('Heel',.055)]:
            point=V((motion.heads['Foot_'+side].x,y,.028))
            marker('Pivot'+label+'_'+side,'Foot_'+side,motion.rest['Foot_'+side].inverted()@point)
    marker('ShaftAxis','ClubGrip',motion.rest['ClubGrip'].inverted()@(motion.heads['ClubGrip']+V((0,0,-.2))))
    for club in LENGTHS:
        point=motion.heads['ClubGrip']+contact_offset(club)
        marker('Contact_'+club,'ClubGrip',motion.rest['ClubGrip'].inverted()@point)
        marker('Face_'+club,'ClubGrip',motion.rest['ClubGrip'].inverted()@(point+V((0,-.05,0))))
    rig['animation_revision']=2;rig['forward']='Blender -Y / glTF +Z';rig['shot_direction']='Blender +X / glTF +X'
    rig.animation_data.action=actions[0]
    if actions[0].slots:rig.animation_data.action_slot=actions[0].slots[0]
    scene.frame_set(1);bpy.context.view_layer.update()
    return actions,clips,{'max_posture_reach_adjustment_m':motion.max_adjustment,'fps':FPS,'revision':2}
