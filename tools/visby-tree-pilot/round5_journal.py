"""Validate and persist an explicitly inspected source-board decision."""
from round5 import *

PATH=ROOT/'tools/visby-tree-pilot/round5-decisions.json'

def decide(number,treatment,note,accept=(),stand=(),hold=None,reject=None):
    sid=f'r5-{number:03}'
    data=read(PATH) if PATH.exists() else dict(reviewer='Agent visual inspection of colour/CIR 2026-04-10, LiDAR 2024 and seasonal RGB 2022; explicit full-facility cell review',scenes={},additionalObservations=[],baseHolds={})
    row=next(s for s in read(WORK/'candidate-summary.json') if s['scene']==sid)
    hold=hold or {};reject=reject or {}
    assert sorted([*accept,*stand,*map(int,hold),*map(int,reject)])==sorted(p['number'] for p in row['focus']),(sid,row)
    assert not [p for p in row['focus'] if p['number'] in accept and p['priorIssues']], 'Older unresolved case requires explicit follow-up'
    assert treatment in ['open','individuals','woodland','mixed','uncertain']
    data['scenes'][sid]=dict(inspected=True,treatment=treatment,accept=list(accept),stand=list(stand),hold={str(k):v for k,v in hold.items()},reject={str(k):v for k,v in reject.items()},note=note)
    save(PATH,data)

def held(numbers,reason):return {n:reason for n in numbers}
