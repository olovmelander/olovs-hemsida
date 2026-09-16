"""Consequential contracts of the sparse-canopy recovery and held-out protocol."""
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import Point,box
import round2_benchmark as experiment
from prepare import read,digest,ROOT

class RecoveryContracts(unittest.TestCase):
    def detect(self,a,maximum=80,centre=30):
        with tempfile.TemporaryDirectory() as d:
            with rasterio.open(Path(d)/'chm.tif','w',driver='GTiff',width=60,height=60,count=1,dtype='float32',crs='EPSG:3006',transform=from_origin(0,60,1,1),nodata=np.nan) as dst:dst.write(a.astype('float32'),1)
            with patch.object(experiment,'OUT',Path(d)):
                return experiment.components(dict(id='synthetic',size=20,easting=centre,northing=30),maximum)

    def test_sparse_tree_recovers_actual_height_and_pixel_centre(self):
        a=np.zeros((60,60));a[25:28,25:28]=4
        candidates=self.detect(a);self.assertEqual(len(candidates),1)
        p=candidates[0];self.assertEqual(p['height'],4);self.assertEqual(p['supportedCells'],9)
        self.assertEqual((p['point'].x,p['point'].y),(26.5,33.5))
        self.assertEqual(p['geometry'].area,9)

    def test_missing_or_low_returns_do_not_become_a_tree(self):
        a=np.full((60,60),np.nan);a[25:28,25:28]=2.5
        self.assertEqual(self.detect(a),[])
        a[25,25]=4;a[25:28,26:28]=np.nan
        self.assertEqual(self.detect(a),[])

    def test_large_connected_group_is_not_collapsed(self):
        a=np.zeros((60,60));a[20:35,20:35]=12
        self.assertEqual(self.detect(a),[])

    def test_only_centres_inside_island_are_consolidated(self):
        island=dict(point=Point(2,2),geometry=box(0,0,4,4),id='island')
        a=dict(point=Point(1,1),id='a');b=dict(point=Point(3,3),id='b');c=dict(point=Point(4.1,2),id='adjacent')
        self.assertEqual([p['id'] for p in experiment.recover([a,b,c],[island])],['adjacent','island'])

    def test_overlapping_halo_windows_preserve_interior_candidate(self):
        a=np.zeros((60,60));a[25:28,25:28]=4
        first=self.detect(a);second=self.detect(a,centre=34)
        self.assertTrue(first[0]['geometry'].equals(second[0]['geometry']))
        self.assertEqual(first[0]['point'],second[0]['point'])

    def test_evaluated_code_and_reference_remain_frozen(self):
        doc=ROOT/'geo_data/course-v2/visby/vegetation/pilot/round2';lock=read(doc/'detector-lock.json')
        self.assertEqual(digest(doc/'reference.geojson'),lock['freshReferenceSha256'])
        self.assertEqual(digest(ROOT/'tools/visby-tree-pilot/round2_benchmark.py'),lock['detectorCodeSha256'])
        self.assertEqual(digest(ROOT/'tools/visby-tree-pilot/round2-detect.R'),lock['rCodeSha256'])
        self.assertEqual(digest(ROOT/'tools/visby-tree-pilot/round2-annotations.json'),read(doc/'reference-lock.json')['annotationSha256'])

if __name__=='__main__':unittest.main()
