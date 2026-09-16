"""Preserve the failed preflight before a bounded runtime-gate correction."""
from prepare import *
import shutil
def main():
 target=OUT/'trial-1';assert not target.exists();target.mkdir()
 for name in ['publication.json','pilot-records.json','pilot-record-drafts.json','pilot-source-manifest.json']:
  shutil.copy2(OUT/name,target/name)
 shutil.copytree(OUT/'stand-output',target/'stand-output');shutil.copytree(DOC,target/'evidence')
 source=(OUT/'captures/after').resolve();destination=(target/'captures').resolve()
 assert source.is_relative_to(OUT.resolve()) and destination.is_relative_to(OUT.resolve()) and source.is_dir()
 shutil.move(str(source),str(destination))
 save(DOC/'trial-1-validation.json',read(target/'evidence/validation.json'))
 save(DOC/'runtime-holds.json',dict(holds=[dict(id='calcampus-ref-01',decision='held-runtime-not-drawn',
  evidence='Present in registry but absent from individual renderer instances on both routings in WebGPU high, WebGL high and WebGL low; source crown adjacent to campus roof.',
  policy='Hold this promotion; preserve source annotation and baseline, do not relocate it or alter building/turf exclusions.')]))
 print('Preserved trial 1; runtime hold documented')
if __name__=='__main__':main()
