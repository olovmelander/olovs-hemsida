"""Retain small, reproducible evidence from the second local preview."""
from round2 import *

def main():
    performance=read(WORK/'performance-summary.json')
    regressions=[dict(scenario=c['scenario'],metric=k,percent=v,before=c['before'][k],after=c['after'][k])
        for c in performance['comparison'] for k,v in c['percentChange'].items() if v>10]
    performance['regressionsAbove10Percent']=regressions
    investigation=WORK/'performance-investigation.json'
    if regressions:
        assert investigation.exists(),'Measured regression requires an explicit investigation'
        performance['investigation']=read(investigation)
        assert performance['investigation']['sourceRuns']['initialSha256']==digest(WORK/'performance-runs.json'),'Investigation refers to an older measurement'
        assert performance['investigation']['sourceRuns']['followupSha256']==digest(WORK/'gpu-followup-runs.json'),'Follow-up measurement changed'
    else:performance['investigation']='No measured median load, frame, vegetation-planning, transfer or encoded-vegetation regression above 10% in this interleaved local comparison.'
    save(DOC/'performance.json',performance)
    captures=read(WORK/'captures/report.json');before=read(OUT/'captures/after/report.json');pairs=[]
    for br,ar in zip(before['runs'],captures['runs']):
        for av in ar['views']:
            bv=next(v for v in br['views'] if (v['hole'],v['cam'])==(av['hole'],av['cam']))
            pairs.append(dict(scenario=ar['scenario'],hole=av['hole'],camera=av['cam'],beforeFile='captures/after/'+bv['file'],
                afterFile='round2/captures/'+av['file'],beforeSha256=bv['sha256'],afterSha256=av['sha256'],cameraIdentical=bv['camera']==av['camera']))
    save(DOC/'screenshots.json',dict(root='output/visby-tree-pilot',pairs=pairs))
    save(DOC/'publication.json',read(WORK/'publication.json'))
    validation=read(DOC/'validation.json');validation['tests']=dict(python=16,node=35);save(DOC/'validation.json',validation)
    print(dict(screenshotPairs=len(pairs),regressionsAbove10Percent=regressions))

if __name__=='__main__':main()
