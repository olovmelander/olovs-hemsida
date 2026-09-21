/* Run the authoring script through Blender MCP, restoring the UI even on errors. */
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { blenderRequest } from '../blender-flag/blender-bridge.mjs';
const filename=fileURLToPath(new URL('./build_clubs.py',import.meta.url));
const source=await fs.readFile(filename,'utf8');
const scope=JSON.stringify({__file__:filename,__name__:'__main__'});
const code=`import bpy, traceback
_club_previous_scene_name = bpy.context.window.scene.name
try:
    _club_scope = ${scope}
    _club_scope['ONLY_IRONS'] = ${process.argv.includes('--irons') ? 'True' : 'False'}
    _club_scope['ONLY_WOODS'] = ${process.argv.includes('--woods') ? 'True' : 'False'}
    _club_scope['ONLY_HYBRID'] = ${process.argv.includes('--hybrid') ? 'True' : 'False'}
    _club_scope['ONLY_WEDGES'] = ${process.argv.includes('--wedges') ? 'True' : 'False'}
    _club_scope['ONLY_PUTTER'] = ${process.argv.includes('--putter') ? 'True' : 'False'}
    exec(compile(${JSON.stringify(source)}, ${JSON.stringify(filename)}, 'exec'), _club_scope)
except Exception:
    raise RuntimeError(traceback.format_exc())
finally:
    if _club_previous_scene_name in bpy.data.scenes:
        bpy.context.window.scene = bpy.data.scenes[_club_previous_scene_name]
`;
const reply=await blenderRequest('execute_code',{code});
console.log(reply.result || reply);
