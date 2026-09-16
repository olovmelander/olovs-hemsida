"""Publish small local-pilot findings, retaining raw evidence in the ignored cache."""
from prepare import *

def main():
    doc=ROOT/'geo_data/course-v2/visby/vegetation/pilot'
    performance=read(OUT/'performance-summary.json')
    performance['investigation']=[
        dict(metric='startup transport',finding='Initial inherited manifest was incompatible: 843 requests / 11.49 MB. Rebuilt local lossless packages restore five requests with the pilot graph.',status='fixed'),
        dict(metric='encoded vegetation bytes',before=933322,after=1309480,percentChange=40.303132252320204,
             finding='24 tiles expand from 64x64 to 256x256 cells. Encoded vegetation grows by 376,158 bytes; total packaged ground transfer grows 5.64%, from 6.67 to 7.05 MB.',status='investigated; retained for local accuracy experiment'),
        dict(metric='vegetation planning CPU',finding='The finer tiles add 1,474,560 cells to the existing compatible field decoder/planner. Median planting cost grows 13.9–32.3 ms (10.2–30.7% depending on mode). Total boot regressions remain below 10%; maximum observed median boot increase is 1.2%.',status='investigated; no runtime format or quality reduction'),
        dict(metric='frame intervals',finding='No greater-than-10% median or p95 frame regression in the repeated hole-16 runs. High-quality intervals are effectively unchanged; low-quality median falls from 18.1 to 12.2 ms. Do not generalize this local result to other hardware.',status='checked')]
    performance['terrainGrounding']='Rendered exports include the existing 0.25 m trunk burial. After adding it back, maximum discrepancy from runtime terrain is below 0.007 m, including 1 cm export rounding; this is rendering conformance, not terrain survey accuracy.'
    performance['rawRunsSha256']=digest(OUT/'performance-runs.json')
    save(doc/'performance.json',performance)
    baseline=read(OUT/'baseline.json');publication=read(OUT/'publication.json')
    save(doc/'baseline-lock.json',dict(capturedAt=baseline['capturedAt'],root=next(f for f in baseline['identities'] if f['url']=='courses/v2-index.json'),
        course=baseline['entry']['manifest'],ground=baseline['course']['groundManifest'],routing=baseline['course']['routing'],
        baselineRecordsSha256=digest(OUT/'baseline-records.json'),sourceEvidenceSha256=digest(OUT/'source-evidence.json'),
        pilotGround=publication['references']['ground'],pilotSourceManifestSha256=digest(OUT/'pilot-source-manifest.json')))
    shots={}
    for mode in ['before','after']:
        runs=read(OUT/'captures'/mode/'report.json')['runs']
        shots[mode]=[dict(scenario=r['scenario'],backend=r['state']['stats']['backend'],views=[{k:v[k] for k in ['hole','cam','file','sha256']} for v in r['views']]) for r in runs]
    save(doc/'screenshots.json',dict(directory='output/visby-tree-pilot/captures',note='All screenshot cameras match. Capture boot timings precede the startup-pack fix; use performance.json for the final transport comparison.',captures=shots))
    print('Final local findings saved')

if __name__=='__main__':main()
