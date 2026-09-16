"""Fetch the official CC0 Blender Studio anatomy bundle used by refine_golfer.py."""
from pathlib import Path
import urllib.request,zipfile,hashlib,json
root=Path(__file__).resolve().parents[2]
out=root/'output/golfer-source';out.mkdir(parents=True,exist_ok=True)
url='https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip'
archive=out/'human-base-meshes-bundle-v1.4.1.zip'
if not archive.exists():
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=120) as response:
        archive.write_bytes(response.read())
with zipfile.ZipFile(archive) as z:
    source=z.read('human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend')
    (out/'human_base_meshes_bundle.blend').write_bytes(source)
print(json.dumps({'url':url,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'assetLicense':'CC0'}))
