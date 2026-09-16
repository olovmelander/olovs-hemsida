import bpy,runpy,json,math
from pathlib import Path
root=Path(__file__).resolve().parents[2]
api=runpy.run_path(str(root/'tools/blender-golfer/animation.py'))
for scene_name in ['Banvy | Golfer atelier','Banvy | Male golfer atelier']:
    scene=bpy.data.scenes[scene_name];bpy.context.window.scene=scene
    rig=next(o for o in scene.objects if o.type=='ARMATURE');motion=api['Motion'](rig)
    for name,duration,club,loop in api['CLIPS']:
        previous={};worst=(0,None,0);per_bone={}
        for i in range(round(duration*30)+1):
            motion.pose(name,i/30,duration,club)
            for pb in rig.pose.bones:
                q=pb.rotation_quaternion
                if pb.name in previous:
                    angle=abs(q.rotation_difference(previous[pb.name]).angle);angle=min(angle,2*math.pi-angle)*180/math.pi
                    if angle>worst[0]:worst=(angle,pb.name,i/30/duration)
                    if angle>per_bone.get(pb.name,(0,0))[0]:per_bone[pb.name]=(angle,i/30/duration)
                previous[pb.name]=q.copy()
        if worst[0]>25:print(scene_name,name,sorted(per_bone.items(),key=lambda x:-x[1][0])[:4])
