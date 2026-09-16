"""Retain comparison measurements and exact evidence identities."""
from round3 import *

def main():
    check_lock();performance=read(WORK/'performance-summary.json')
    regressions=[dict(scenario=c['scenario'],metric=k,percent=v,before=c['before'][k],after=c['after'][k])
        for c in performance['comparison'] for k,v in c['percentChange'].items() if v>10]
    performance['regressionsAbove10Percent']=regressions
    performance['sourceRunsSha256']=digest(WORK/'performance-runs.json')
    investigation=WORK/'performance-investigation.json'
    if regressions or investigation.exists():
        assert investigation.exists(),'Measured regression requires an explicit investigation'
        evidence=read(investigation)
        assert evidence['initialSha256']==digest(WORK/'performance-runs.json'),'Stale investigation'
        for name,value in evidence.get('additionalRunHashes',{}).items():
            assert '/' not in name and '\\' not in name and digest(WORK/name)==value
        performance['investigation']=evidence
    else:performance['investigation']='No measured median load, frame, planning, transfer or vegetation-byte regression above 10% in this comparison.'
    raw=read(WORK/'performance-runs.json')['runs']
    assert len(raw)==18
    for r in raw:
        assert r['state']['objects']['loaded']['records']==(3169 if r['mode']=='before' else 3230)
        assert not r['state']['perf']['courseData']['fallbackReasons'] and not r['errors']
        assert r['state']['groundResidual']['max']<.01
    save(DOC/'performance.json',performance)
    pairs=[]
    for br,ar in zip(read(PREVIOUS/'captures/report.json')['runs'],read(WORK/'captures/report.json')['runs']):
        for av in ar['views']:
            bv=next(v for v in br['views'] if (v['hole'],v['cam'])==(av['hole'],av['cam']))
            pairs.append(dict(scenario=ar['scenario'],hole=av['hole'],camera=av['cam'],beforeFile='round2/captures/'+bv['file'],
                afterFile='round3/captures/'+av['file'],beforeSha256=bv['sha256'],afterSha256=av['sha256'],cameraIdentical=bv['camera']==av['camera']))
    assert len(pairs)==40 and all(p['cameraIdentical'] for p in pairs)
    save(DOC/'screenshots.json',dict(root='output/visby-tree-pilot',pairs=pairs))
    save(DOC/'publication.json',read(WORK/'publication.json'))
    files=sorted((ROOT/'tools/visby-tree-pilot').glob('round3*'))
    files += [ROOT/'tools/visby-tree-pilot'/name for name in ['compile-preview.mjs','preview.mjs','performance.mjs','test_round3.py']]
    files += [WORK/'tool-run.json',WORK/'runtime-probes.json',WORK/'facility-evidence.json',WORK/'captures/report.json']
    save(DOC/'reproduction-lock.json',dict(sha256={str(p.relative_to(ROOT)).replace('\\','/'):digest(p) for p in files if p.is_file()},
        explanation='Final tool and output identities. Earlier inputs remain protected by input-lock.json. Re-running captures/probes changes their diagnostic identities and requires a new evidence checkpoint.'))
    check_lock();print(dict(screenshotPairs=len(pairs),regressionsAbove10Percent=regressions))

if __name__=='__main__':main()
