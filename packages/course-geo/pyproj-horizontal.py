#!/usr/bin/env python3
"""Horizontal PROJ binding for proj.mjs; explicitly selected through
COURSE_GEO_PYPROJ_PYTHON. Uses authority axis order, an offline PROJ database,
and fixed-point formatting like cs2cs -f. Vertical cct remains separate.
"""
import argparse
import json
import math
import os
import sys

os.environ["PROJ_NETWORK"] = "OFF"
import pyproj

pyproj.network.set_network_enabled(False)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--metadata", action="store_true")
parser.add_argument("--source")
parser.add_argument("--target")
parser.add_argument("--decimals", type=int, default=6, choices=range(16))
args = parser.parse_args()

if args.metadata:
    print(json.dumps({"implementation": "PROJ through pyproj.Transformer.from_crs",
                      "pyprojVersion": pyproj.__version__, "projVersion": pyproj.proj_version_str,
                      "axisOrder": "authority", "alwaysXY": False,
                      "network": "OFF", "scope": "horizontal-only"}))
    sys.exit(0)
if not args.source or not args.target:
    parser.error("--source and --target are required for a transformation")

try:
    source = pyproj.CRS(args.source)
    target = pyproj.CRS(args.target)
    if len(source.axis_info) != 2 or len(target.axis_info) != 2:
        raise ValueError("only two-dimensional horizontal CRSs are supported")
    transform = pyproj.Transformer.from_crs(source, target, always_xy=False)
    rows = []
    for number, line in enumerate(sys.stdin, 1):
        values = list(map(float, line.split()))
        if len(values) != 2 or not all(map(math.isfinite, values)):
            raise ValueError(f"input row {number} must contain two finite coordinates")
        rows.append(values)
    if rows:
        first, second = transform.transform(*zip(*rows), errcheck=True)
        for a, b in zip(first, second):
            if not math.isfinite(a) or not math.isfinite(b):
                raise ValueError("PROJ returned non-finite coordinates")
            print(f"{a:.{args.decimals}f}\t{b:.{args.decimals}f}")
except (ValueError, pyproj.exceptions.ProjError) as error:
    print(f"pyproj horizontal transform failed: {error}", file=sys.stderr)
    sys.exit(1)
