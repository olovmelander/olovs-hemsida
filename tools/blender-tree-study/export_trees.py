"""Export the Ghibli tree catalogue as runtime assets for the app.

Runs in a BACKGROUND Blender, never on the live bridge:

    "C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" --background --python \
        tools/blender-tree-study/export_trees.py -- --out apps/golf/public/models/trees \
        [--species tall,gran,björk,al,ek] [--variants 4] [--tiers full,lite] [--hero-variants 2]

It executes ghibli_catalog.py with its render modes switched off, then builds
every (species, variant, tier) at the origin and writes one GLB each — one
"crown" node and one or more "trunk*" nodes, POSITION + NORMAL (the bent
custom normals) + COLOR_0 (crown: the baked depth tint as a grey multiplier;
trunk: the bark colour itself), no textures, no materials — named by the
sha256 of its bytes, plus ghibli-v1.json describing them: species, seeds,
per-variant template height/radius (from the hero or full crown bounds),
triangle counts and hashes. Nothing here touches the engine; the loader in
apps/golf/src/engine/ghibli-trees.mjs reads the manifest.
"""
import bpy, sys, os, json, hashlib, argparse, math

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--species", default="tall,gran,björk,al,ek")
ap.add_argument("--variants", type=int, default=4)
ap.add_argument("--tiers", default="full,lite")
ap.add_argument("--hero-variants", type=int, default=2)
args = ap.parse_args(argv)
assert bpy.app.background, "run this in a background Blender, never on the live bridge"

# ------------------------------------------------------------ load the generator with every render mode off
src = open(os.path.join(HERE, "ghibli_catalog.py"), encoding="utf-8").read()
src = (src.replace("__OUTDIR__", os.path.abspath(args.out).replace("\\", "/"))
          .replace("__ONLY__", '["none"]').replace("__NV__", "1")
          .replace("__TIERS__", "False").replace("__HERO__", "False").replace("__STAND__", "False"))
ns = {"__name__": "ghibli_catalog"}
exec(compile(src, "ghibli_catalog.py", "exec"), ns)
SPECIES, LOD_TIERS, tris = ns["SPECIES"], ns["LOD_TIERS"], ns["tris"]
sc = ns["sc"]
bpy.context.window.scene = sc if bpy.context.window else None

def species_key(name):
    return name.split(" ")[0]

def bake_trunk_colour(o):
    """COLOR_0 on a trunk = its material's mid colour, so one white material draws it."""
    me = o.data
    mat = me.materials[0] if me.materials else None
    col = tuple(mat.diffuse_color[:3]) if mat else (0.4, 0.3, 0.2)
    ca = me.color_attributes.get("Depth") or me.color_attributes.new(name="Depth", type="FLOAT_COLOR", domain="POINT")
    for i in range(len(me.vertices)):
        ca.data[i].color = (*col, 1.0)
    me.color_attributes.active_color = ca

def bounds(objs):
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    return {"height": max(zs), "radius": max(max(abs(x) for x in xs), max(abs(y) for y in ys)), "minZ": min(zs)}

def build(name, seed, tier):
    ns["LOD"] = LOD_TIERS[tier]; ns["_lodcount"][0] = 0
    before = set(o.name for o in sc.objects)
    builder, P = SPECIES[name]
    c, t, H = builder((0, 0, 0), seed, P)
    made = [o for o in sc.objects if o.name not in before]
    crown = [o for o in made if o.name.startswith("crown")]
    trunks = [o for o in made if o not in crown]
    assert len(crown) == 1, made
    for i, o in enumerate(trunks):
        o.name = "trunk" if i == 0 else f"trunk{i + 1}"
        bake_trunk_colour(o)
    crown[0].name = "crown"
    me = crown[0].data
    if "Depth" in me.color_attributes:
        me.color_attributes.active_color = me.color_attributes["Depth"]
    return crown[0], trunks, H, made

def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False, export_animations=False,
                              export_extras=False, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_materials="NONE", export_texcoords=False, export_normals=True, export_skins=False,
                              export_morph=False)

os.makedirs(args.out, exist_ok=True)
tiers = args.tiers.split(",")
manifest = {"schemaVersion": 1, "kind": "ghibli-trees", "units": "metres, y up, base at 0",
            "colour": "COLOR_0 on a crown is a grey depth multiplier for the species colour; on a trunk it is the bark colour",
            "generatorSha256": hashlib.sha256(open(os.path.join(HERE, "ghibli_catalog.py"), "rb").read()).hexdigest(),
            "species": []}
names = {species_key(n): n for n in SPECIES}
for key in args.species.split(","):
    name = names[key]
    si = list(SPECIES).index(name)
    entry = {"key": key, "name": name, "variants": []}
    for v in range(args.variants):
        seed = 1000 * (si + 1) + 17 * v
        var = {"seed": seed, "tiers": {}}
        want = list(tiers) + (["hero"] if v < args.hero_variants else [])
        for tier in want:
            crown, trunks, H, made = build(name, seed, tier)
            tmp = os.path.join(args.out, f"tmp-{key}-{v}-{tier}.glb")
            export_glb([crown] + trunks, tmp)
            data = open(tmp, "rb").read(); sha = hashlib.sha256(data).hexdigest()
            final = os.path.join(args.out, f"{sha}.glb")
            os.replace(tmp, final)
            b = bounds([crown] + trunks)
            var["tiers"][tier] = {"file": f"{sha}.glb", "sha256": sha, "bytes": len(data),
                                  "tris": {"crown": tris(crown), "trunk": sum(tris(t) for t in trunks)}}
            if tier in ("hero", "full") and "templateHeight" not in var:
                var["templateHeight"] = round(b["height"], 3); var["templateRadius"] = round(b["radius"], 3)
            for o in made: bpy.data.objects.remove(o, do_unlink=True)
            print(f"{key} v{v} {tier}: {var['tiers'][tier]['tris']} -> {sha[:12]} ({len(data)} B)")
        entry["variants"].append(var)
    manifest["species"].append(entry)
with open(os.path.join(args.out, "ghibli-v1.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, indent=1, ensure_ascii=False)
print("wrote", os.path.join(args.out, "ghibli-v1.json"))
