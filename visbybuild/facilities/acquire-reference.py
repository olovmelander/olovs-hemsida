"""Reacquire the seven bounded 2026 Visby facility orthophoto windows.

Uses the existing repository Lantmateriet account configuration, never prints
credential values. The retained acquisition module checks headers, transforms,
hashes and pixel validity. Does not change runtime geography.
"""
from pathlib import Path
import os
import sys

ROOT=Path(__file__).resolve().parents[2]
for line in (ROOT/'.env').read_text(encoding='utf8').splitlines() if (ROOT/'.env').exists() else []:
    if '=' not in line or line.lstrip().startswith('#'):continue
    key,value=line.split('=',1)
    if key.strip() in ('LANTMATERIET_USERNAME','LANTMATERIET_PASSWORD','LANTMATERIET_BEARER_TOKEN'):
        os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
sys.path.insert(0,str(ROOT/'visbybuild/mapping'))
import lm_ortho
os.chdir(ROOT)
sys.argv=['lm_ortho','--plan','geo_data/course-v2/visby/reference/lm-ortho-plan-2026-09-09.json',
    '--only','clubhouse-finish,range-practice,context-2-3,context-1-4,context-2-4,context-3-4,context-4-4']
raise SystemExit(lm_ortho.main())
