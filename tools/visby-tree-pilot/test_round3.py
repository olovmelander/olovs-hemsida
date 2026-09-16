"""Independent contracts for grid ownership and source-weighted crown merging."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import numpy as np
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box,mapping
from round3 import owns
import round3_author as author

class ReviewContracts(unittest.TestCase):
    def test_shared_grid_edges_have_one_owner_including_four_cell_corner(self):
        cells=[[0,0,100,100],[100,0,200,100],[0,100,100,200],[100,100,200,200]]
        for point in [(100,50),(50,100),(100,100),(0,0),(199.999,199.999)]:
            self.assertEqual(sum(owns(cell,*point) for cell in cells),1)
        self.assertEqual(sum(owns(cell,200,100) for cell in cells),0)

    def test_merged_crown_uses_unique_measured_cells_and_height_weighted_centre(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);a=np.zeros((10,10),dtype=np.float32)
            for column in range(2,7):a[5:8,column]=column
            with rasterio.open(root/'chm.tif','w',driver='GTiff',width=10,height=10,count=1,dtype='float32',crs='EPSG:3006',transform=from_origin(0,10,1,1),nodata=np.nan) as dst:dst.write(a,1)
            features=[dict(geometry=mapping(box(2,2,5,5))),dict(geometry=mapping(box(4,2,7,5)))]
            with patch.object(author,'OUT',root):g,x,y,h,count=author.merged_measurement(features)
            self.assertEqual(g.area,15)
            self.assertEqual(count,15,'Overlapping detections must not count source returns twice')
            self.assertEqual((x,y,h),(5,3.5,6))
            self.assertNotEqual(x,g.centroid.x,'Image/outline centroid must not replace the height-weighted position')

if __name__=='__main__':unittest.main()
