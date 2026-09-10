# Source-ground sampling

`facility-ground.json` stores absolute RH2000 ground at 1 m, decoded from all 64 published Ribbingsfors level-0 terrain chunks. Its two panels cover clubhouse/range/estate (`x=400..1000`, `z=-720..-100`) and maintenance yard (`x=-425..-255`, `z=90..280`). Each panel has `x0,z0,width,height,spacingM,heightsRH2000M`. Samples are row-major: columns east, rows south.

Runtime `(x,z)` corresponds to Blender `(X=x,Y=-z)`. Blender vertical `Z` is the sampled RH2000 height. Do not subtract the origin's 69.14 m height.

```python
import json, math
from pathlib import Path
ground = json.loads(Path('ribbingsforsbuild/facilities/reference/facility-ground.json').read_text())

def ground_rh2000(blender_x, blender_y):
    x, z = blender_x, -blender_y
    for panel in ground['panels']:
        c, r = x-panel['x0'], z-panel['z0']
        w, h = panel['width'], panel['height']
        if not (0 <= c <= w-1 and 0 <= r <= h-1):
            continue
        ci, ri = min(math.floor(c), w-2), min(math.floor(r), h-2)
        tx, ty = c-ci, r-ri
        a = panel['heightsRH2000M']
        at = lambda cc, rr: a[rr*w+cc]
        return ((1-tx)*at(ci,ri)+tx*at(ci+1,ri))*(1-ty) + ((1-tx)*at(ci,ri+1)+tx*at(ci+1,ri+1))*ty
    raise ValueError(f'Outside exported ground: {x}, {z}')
```

Direct source sampling in Node, without this extracted JSON:

```js
import { loadTerrain } from './ribbingsforsbuild/laser-lib.mjs';
const source = loadTerrain();
source.hAt(479, -456.5); // 77.2299995 RH2000; clubhouse ground anchor
```

Export samples are rounded to 0.001 m for compact JSON; that precision does not imply millimetre survey accuracy. These are ground elevations, not eave/ridge observations. Exterior foundations should sample corners and edges rather than rely only on a central anchor.
