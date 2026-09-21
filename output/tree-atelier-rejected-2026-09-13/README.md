# Rejected tree catalogue

`ghibli-v2.json` records the rejected catalogue, including its asset hashes and
sizes. Its 60 GLB exports were removed from the current tree during the September
2026 repository cleanup. The approved player uses the Ghibli fluffy/Visby Hero
catalogues instead. Comparison screenshots and Blender authoring scripts remain.

For an exact historical comparison, recover the exports from commit
`fa2c8a967b529ce640cde4547fe463cfb987b088` in a separate checkout:

```sh
git restore --source=fa2c8a967b529ce640cde4547fe463cfb987b088 --worktree -- 'output/tree-atelier-rejected-2026-09-13/*.glb'
```

These recovered exports are ignored; do not add them to a new change.
