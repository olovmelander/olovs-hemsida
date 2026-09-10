"""Execute only the dedicated Upsala builder through the already running MCP."""
import json
from pathlib import Path
from blender_mcp_client import request

path=Path(__file__).with_name('build_models.py').resolve()
response=request('execute_code',{'code':'import runpy, traceback\ntry:\n    runpy.run_path('+repr(str(path))+', run_name="__main__")\nexcept Exception:\n    print(traceback.format_exc())\n'},timeout=180)
if 'Traceback (most recent call last)' in response.get('result',{}).get('result',''):
    raise RuntimeError(response['result']['result'])
print(json.dumps(response,ensure_ascii=False,indent=2))

