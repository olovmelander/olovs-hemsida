"""Record current rest landmarks and pose directions through Blender MCP."""
import bpy,json
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
result={}
for variant,scene_name in [('female','Banvy | Golfer atelier'),('male','Banvy | Male golfer atelier')]:
    scene=bpy.data.scenes[scene_name];bpy.context.window.scene=scene
    rig=next(o for o in scene.objects if o.type=='ARMATURE')
    result[variant]={'rest':{b.name:{'head':list(b.head_local),'tail':list(b.tail_local)} for b in rig.data.bones},'poses':{}}
    actions=[a for a in bpy.data.actions if a.get('banvy_golfer') and (a.get('banvy_character')=='male')==(variant=='male')]
    for a in actions:
        name=a.get('clip_name',a.name)
        if name not in ['Idle','Walk','SwingIron','Putt']:continue
        rig.animation_data.action=a
        samples=[]
        for t in [0,.25,.43,.59,.85]:
            scene.frame_set(int(1+t*(a.frame_range[1]-1)))
            p={n:list(rig.pose.bones[n].matrix.translation) for n in ['Head','Hips','UpperArm_L','Forearm_L','Hand_L','UpperArm_R','Forearm_R','Hand_R','Foot_L','Foot_R','ClubGrip']}
            samples.append({'phase':t,'joints':p})
        result[variant]['poses'][name]=samples
    rig.animation_data.action=next(a for a in actions if a.get('clip_name',a.name)=='Idle');scene.frame_set(1)
(root/'output/golfer-source/audit-before/landmarks.json').write_text(json.dumps(result,indent=2))
for v,r in result.items():
    print(v, {n:r['rest'][n] for n in ['Hand_L','Finger0A_L','Finger0B_L','Finger2A_L','Finger2B_L','ThumbA_L','ThumbB_L']})
    print('Idle',r['poses']['Idle'][0])
