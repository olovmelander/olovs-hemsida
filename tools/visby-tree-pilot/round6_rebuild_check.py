"""Rebuild retained decisions and require byte-identical preview identities."""
from round6 import *
import subprocess

def main():
    check_lock()
    files=['pilot-record-drafts.json','pilot-records.json','pilot-footprints.geojson','pilot-source-manifest.json',
        'stand-output/index.json','publication.json','after/courses/v2-index.json','after/courses/index.json']
    before={name:digest(WORK/name) for name in files}
    subprocess.run([sys.executable,'-W','ignore::DeprecationWarning','tools/visby-tree-pilot/round6_author.py'],cwd=ROOT,check=True)
    subprocess.run(['node','tools/visby-tree-pilot/round6-compile.mjs'],cwd=ROOT,check=True)
    after={name:digest(WORK/name) for name in files}
    assert before==after,'Retained decisions no longer rebuild identically'
    check_lock();save(DOC/'rebuild-check.json',dict(status='passed',sha256=after,
        meaning='Object IDs/records, footprints, all indexed stand hashes, source manifest, publication and startup/root catalogues match the captured generation byte for byte.'))
    print('Deterministic rebuild passed')

if __name__=='__main__':main()
