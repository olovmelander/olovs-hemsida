"""Source-grid, band-selection, mask and integrity regression tests."""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'visbybuild/mapping'))
from lm_ortho_read import FRAME_E, FRAME_N, read_window


class RGBITest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cache = Path(self.tmp.name)
        self.transform = from_origin(FRAME_E, FRAME_N, .16, .16)
        self.data = np.stack([np.arange(100,dtype=np.uint8).reshape(10,10)+b*30 for b in range(4)])
        self.write()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, masked=False):
        file = self.cache/'source.tif'
        with rasterio.open(file,'w',driver='GTiff',height=10,width=10,count=4,dtype='uint8',crs='EPSG:3006',transform=self.transform) as dst:
            dst.write(self.data)
            mask=np.full((10,10),255,dtype=np.uint8)
            if masked: mask[4,4]=0
            dst.write_mask(mask)
        self.record=dict(id='fixture',rasterFile=file.name,sha256=hashlib.sha256(file.read_bytes()).hexdigest(),
            width=10,height=10,boundsEpsg3006=[FRAME_E,FRAME_N-1.6,FRAME_E+1.6,FRAME_N],
            geoTransform=list(self.transform.to_gdal()),sources=[dict(capturedAt='2026-04-10')])
        self.report=dict(groundId='visby',access=dict(authorized=True),windows=[self.record])
        (self.cache/'acquisition.json').write_text(json.dumps(self.report))

    def test_rgb_and_rgbi_identical_grid(self):
        rgb,a=read_window(.8,.8,1.6,cache=self.cache)
        rgbi,b=read_window(.8,.8,1.6,cache=self.cache,bands=(1,2,3,4))
        np.testing.assert_array_equal(rgb,rgbi[:,:,:3])
        np.testing.assert_array_equal(rgbi,np.moveaxis(self.data,0,-1))
        self.assertEqual(a['geoTransform'],b['geoTransform'])
        cir,_=read_window(.8,.8,1.6,cache=self.cache,bands=(4,1,2))
        np.testing.assert_array_equal(cir,rgbi[:,:,[3,0,1]])

    def test_missing_pixels_rejected(self):
        self.write(masked=True)
        with self.assertRaisesRegex(ValueError,'missing source pixels'):read_window(.8,.8,1.6,cache=self.cache,bands=(4,))

    def test_corruption_rejected(self):
        with (self.cache/'source.tif').open('ab') as f:f.write(b'changed')
        with self.assertRaisesRegex(ValueError,'checksum'):read_window(.8,.8,1.6,cache=self.cache)

    def test_invalid_bands_and_uncovered_crop(self):
        for bands in [(0,),(5,),(1,1),(),(True,)]:
            with self.assertRaises(ValueError):read_window(.8,.8,1.6,cache=self.cache,bands=bands)
        with self.assertRaisesRegex(ValueError,'outside'):read_window(100,100,1.6,cache=self.cache)

if __name__=='__main__':unittest.main()
