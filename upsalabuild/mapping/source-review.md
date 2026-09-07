# Interactive Upsala source review

Open [source-review.html](source-review.html) through the repository's local web
server. The viewer loads the current `ground-map.geojson` and the separately
reviewed `municipal-objects-2026-09-07.geojson` each time it opens. Reload data
after rebuilding the GIS export; there is no generated geometry embedded in HTML.

```powershell
node tools/serve.mjs . 8631
```

Then open
[the local review map](http://127.0.0.1:8631/upsalabuild/mapping/source-review.html).
Opening the HTML as `file://` cannot load the neighbouring GeoJSON in normal
browsers; the page explains the local-server command if that happens.

Drag to pan, scroll or use the buttons to zoom, and click an object to inspect
its source. Search accepts a category, name, source ID or `hole 8` style reference.
Search results can focus a feature and enable its hidden source/category. Keyboard
map controls are arrow keys, +/− and Home. The initial extent covers Upsala's
ground, while panning retains surrounding context from the source files.

The source and category toggles separate playing surfaces, practice equipment,
bunkers, water/drainage, infrastructure, woodland, tree evidence and marker/route
references. Municipal observations appear purple with dashed outlines. Each
popup keeps method, accuracy, review/source status, product year/capture date,
registration date, adoption recommendation and retained metadata accessible.
Missing values display as **Unknown**.

Crown candidates appear as translucent circles with their estimated canopy
radius. Tree source points remain points: the municipal records do not document
trunk-base semantics separately, and neither these records nor leaf-type context
prove individual species. Registration is explicitly distinguished from capture.
An accepted source observation is not automatically a placement in the app.

The map uses a local longitude/latitude display frame with a 100 m grid, preserving
the same GeoJSON coordinates across both sources. It is a review display, not a
new registration or survey. Light/dark coordinate backgrounds use no external
tiles, service credentials, third-party scripts or JavaScript dependencies.

The Chrome check on 7 September 2026 loaded 6,058 records at the pre-rebuild
checkpoint and passed search, source-popup selection, unknown species display,
map clicks, zoom, pointer panning, category/source toggles and desktop/mobile
layout checks, with no page errors or external requests. This count will change
when the adjacent current GIS export is refreshed. Ignored browser evidence is
in `upsalabuild/cache/review-2026-09-07/source-review-browser-check.json` and the
desktop/mobile screenshots beside it.

Final rebuilt-data verification loaded **6,082 records** (5,851 ground + 231
municipal) and repeated the interaction checks successfully. Final popups retain
app-adoption status for drainage, reviewed path sources and evidence-only tree
observations. No page errors or external requests occurred. The final cache
record is `source-review-final-browser-check.json`.
