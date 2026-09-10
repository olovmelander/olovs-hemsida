"""Acquire the small southern context crop without changing the course ledger.

The filename records the original search purpose, not verified building use.
Provider credentials stay in the existing bounded LM intake implementation.
"""
import importlib.util
import json
import math
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('nvgk_ortho_intake',ROOT/'nvgkbuild/mapping/lm-ortho-acquire.py')
intake=importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)

def main():
    plan=json.loads((ROOT/'geo_data/course-v2/norrfallsviken/reference/lm-ortho-plan-2026-09-09.json').read_text(encoding='utf-8'))
    source=next(s for s in plan['sources'] if s['id']=='o69875_6775_25_mr24')
    assert plan['nativeResolutionMetres']==.16 and plan['horizontalCrs']=='EPSG:3006'
    anchor=source['boundsEpsg3006'];raw=[678640,6988140,678750,6988250]
    bounds=[round(anchor[i]+math.floor((raw[i]-anchor[i])/.16)*.16,6) for i in range(2)]
    bounds += [round(anchor[i]+math.ceil((raw[i+2]-anchor[i])/.16)*.16,6) for i in range(2)]
    width=round((bounds[2]-bounds[0])/.16);height=round((bounds[3]-bounds[1])/.16)
    assert 0<width*height<500_000
    assert all(anchor[i]<=bounds[i] and bounds[i+2]<=anchor[i+2] for i in range(2))
    window=dict(id='southern-maintenance-context',boundsEpsg3006=bounds,width=width,height=height,
                resolutionMetres=.16,sourceIds=[source['id']],features=[],
                purpose='Southern pale construction/roof surfaces and surrounding context; golf-facility identity and ownership unconfirmed')
    plan['sources']=[source];plan['windows']=[window]
    cache=ROOT/'nvgkbuild/cache/facilities-reference/ortho-extra'
    cache.mkdir(parents=True,exist_ok=True)
    intake.write_json(cache/'plan.json',plan)
    intake.acquire(plan,[window],cache,cache/'acquisition.json')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        # Third-party provider exception text can contain request details.
        print(json.dumps(dict(state='failed',errorType=type(exc).__name__)),file=sys.stderr)
        raise SystemExit(1)
