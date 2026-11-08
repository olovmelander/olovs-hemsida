#!/usr/bin/env bash
# Round 4: two-fold cross-fitted photo crowns on the CALIBRATION windows only
# (train on one half of calibration, detect on the other, and back), so that
# the fusion is tuned on crowns the detector did not train on.
# usage: crossfit.sh <tag> <patch metres> <epochs> <lr> [per-crop]
set -euo pipefail
TAG=$1; PM=$2; EP=$3; LR=$4; PC=${5:-6}; SNAP=${6:-}
C=johannesbergbuild/cache/trees-2026-11-08/photo
PY=johannesbergbuild/cache/venv-photo/Scripts/python.exe
export HF_HOME=$PWD/johannesbergbuild/cache/hf
A=C1-h10-south,C3-h4-meadow,C5-h17-18,K1-h10-spruce
B=C2-h11-edge,C4-h16-spruce-edge,C6-h3-isolated,K2-h9-mixed
node -e '
const fs=require("fs");const r=JSON.parse(fs.readFileSync(process.argv[1]+"/regions-cal.json"));
for (const [n,ids] of [["A",process.argv[2]],["B",process.argv[3]]]) fs.writeFileSync(process.argv[1]+"/regions-cal-"+n+".json",JSON.stringify(r.filter(x=>ids.split(",").includes(x.id))));' $C $A $B
$PY -I tools/tree-pipeline/photo/crowns.py train --raster $C/ortho-2025.json --train $C/train-r4.json --out $C/w-$TAG-A.pt --windows $A --epochs $EP --lr $LR --patch-metres $PM --per-crop $PC ${SNAP:+--snap-to $SNAP} 2>&1 | grep -E "^epoch" | tail -1
$PY -I tools/tree-pipeline/photo/crowns.py train --raster $C/ortho-2025.json --train $C/train-r4.json --out $C/w-$TAG-B.pt --windows $B --epochs $EP --lr $LR --patch-metres $PM --per-crop $PC ${SNAP:+--snap-to $SNAP} 2>&1 | grep -E "^epoch" | tail -1
$PY -I tools/tree-pipeline/photo/crowns.py detect --raster $C/ortho-2025.json --regions $C/regions-cal-B.json --weights $C/w-$TAG-A.pt --out $C/cal-$TAG-onB.json --patch-metres $PM 2>&1 | grep crowns
$PY -I tools/tree-pipeline/photo/crowns.py detect --raster $C/ortho-2025.json --regions $C/regions-cal-A.json --weights $C/w-$TAG-B.pt --out $C/cal-$TAG-onA.json --patch-metres $PM 2>&1 | grep crowns
node -e '
const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));
a.regions=[...a.regions,...b.regions];a.weights="cross-fitted: "+a.weights+" + "+b.weights;a.weightsSha256=null;fs.writeFileSync(process.argv[3],JSON.stringify(a));' $C/cal-$TAG-onA.json $C/cal-$TAG-onB.json $C/cal-$TAG-xfit.json
echo "$C/cal-$TAG-xfit.json"
