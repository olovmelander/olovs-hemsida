import unittest
import tempfile
import prepare as p
from prepare import *
from stands import refine

class SourceWindows(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.cache=p.CACHE;self.report=p.REPORT;p.CACHE=Path(self.tmp.name);p.REPORT={'windows':[]}
 def tearDown(self):p.CACHE=self.cache;p.REPORT=self.report;self.tmp.cleanup()
 def tile(self,id,w,bands=4,valid=True):
  name=id+'.tif';t=from_origin(w,.32,.16,.16)
  with rasterio.open(p.CACHE/name,'w',driver='GTiff',width=2,height=2,count=bands,dtype='uint8',crs='EPSG:3006',transform=t) as f:
   f.write(np.stack([np.full((2,2),v,dtype='uint8') for v in [20,40,60,200][:bands]]))
   if not valid:f.write_mask(np.zeros((2,2),dtype='uint8'))
  p.REPORT['windows'].append(dict(id=id,rasterFile=name,boundsEpsg3006=[w,0,w+.32,.32],sha256=digest(p.CACHE/name),sources=['fixture']))
 def test_four_bands_across_adjacent_source_tiles(self):
  self.tile('west',0);self.tile('east',.32);a,t,s=p.rgbi_window([0,0,.64,.32])
  self.assertEqual(a.shape,(4,2,4));self.assertTrue(np.all(a[0]==20));self.assertTrue(np.all(a[3]==200));self.assertEqual(t.e,-.16);self.assertEqual(len(s),2)
 def test_no_fabricated_infrared(self):
  self.tile('rgb-only',0,3)
  with self.assertRaises(ValueError):p.rgbi_window([0,0,.32,.32])
 def test_missing_source_is_not_black_valid_data(self):
  self.tile('void',0,valid=False)
  with self.assertRaisesRegex(ValueError,'Incomplete'):p.rgbi_window([0,0,.32,.32])
 def test_partial_coverage_rejected(self):
  self.tile('half',0)
  with self.assertRaisesRegex(ValueError,'Incomplete'):p.rgbi_window([0,0,.64,.32])

class StandEvidence(unittest.TestCase):
 def test_unknown_and_excluded_never_recovered(self):
  old=np.tile(np.array([255,40,50,1],dtype='uint8'),(2,3,1));old[0,1,3]=5;old[0,2,3]=0
  height=np.array([[np.nan,12,12],[0,2.5,20]],dtype='float32');a=refine(height,old)
  self.assertTrue(np.all(a[0,:,0]==0));self.assertEqual(a[0,1,3]&4,4);self.assertEqual(a[1,0,0],0);self.assertEqual(a[1,2,1]/4,20)
 def test_source_coordinate_seam_is_exact(self):
  jobs=read(OUT/'stand-output/index.json');index={a['tile']['id']:a for a in read(OUT/'stand-inputs/index.json')}
  with rasterio.open(OUT/'chm.tif') as src:
   for j in jobs:
    if j['cellMetres']!=1:continue
    b=index[j['tileId']]['tile']['bounds'];w=from_bounds(b['minEasting'],b['minNorthing'],b['maxEasting'],b['maxNorthing'],transform=src.transform)
    self.assertTrue(np.allclose([w.col_off,w.row_off,w.width,w.height],np.round([w.col_off,w.row_off,w.width,w.height]),rtol=0,atol=1e-7));self.assertEqual(w.width,256)
 def test_protected_stand_values_preserved(self):
  from stands import mask
  hold=shape(read(DOC/'protected-evaluation.geojson')['features'][0]['geometry']);jobs={j['tileId']:j for j in read(OUT/'stand-output/index.json')}
  for item in read(OUT/'stand-inputs/index.json'):
   j=jobs[item['tile']['id']]
   if not j['protectedTile']:continue
   self.assertEqual(j['cellMetres'],4);b=item['tile']['bounds'];t=from_origin(b['minEasting'],b['maxNorthing'],4,4);m=mask([hold],t,64,True)
   old=np.fromfile(OUT/'stand-inputs'/item['file'],dtype='uint8').reshape(64,64,4);new=np.fromfile(OUT/j['file'],dtype='uint8').reshape(64,64,4)
   self.assertTrue(np.array_equal(old[m],new[m]))

if __name__=='__main__':unittest.main(verbosity=2)
