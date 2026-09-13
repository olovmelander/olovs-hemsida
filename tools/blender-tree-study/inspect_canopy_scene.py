import bpy,json
print(json.dumps({'blender':bpy.app.version_string,'binary':bpy.app.binary_path,
 'activeScene':bpy.context.scene.name,'scenes':[{'name':s.name,'objects':len(s.objects)} for s in bpy.data.scenes]}))
