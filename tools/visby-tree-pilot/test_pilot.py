"""Tests for consequential pilot contracts, using synthetic edge cases."""
import unittest
import numpy as np
from shapely.geometry import Point,box
from rasterio.transform import from_origin
from stand_fields import refine,mask_geometries
from benchmark import match,select_method

class PilotContracts(unittest.TestCase):
    def test_one_reference_cannot_credit_two_detections(self):
        refs=[{'point':Point(0,0)},{'point':Point(10,0)}]
        preds=[{'point':Point(.1,0)},{'point':Point(.2,0)},{'point':Point(14.01,0)}]
        self.assertEqual(len(match(refs,preds)),1)

    def test_assignment_maximizes_valid_matches(self):
        refs=[{'point':Point(0,0)},{'point':Point(4,0)}]
        preds=[{'point':Point(3,0)},{'point':Point(-3.5,0)}]
        self.assertEqual(len(match(refs,preds)),2)

    def test_evaluation_cannot_choose_detector(self):
        a=dict(f1=.7,crownIoU=.3,centreMedianMetres=2)
        b=dict(f1=.6,crownIoU=.9,centreMedianMetres=0)
        metrics={'A':{'calibration':a,'evaluation':dict(b)},'B':{'calibration':b,'evaluation':dict(a)}}
        self.assertEqual(select_method(metrics,['A','B']),'A')
        metrics['B']['evaluation']['f1']=1
        self.assertEqual(select_method(metrics,['A','B']),'A')

    def test_gap_nodata_and_semantic_exclusion_survive_refinement(self):
        old=np.full((2,2,4),255,dtype=np.uint8);old[:,:,3]=1;old[0,1,3]=5
        h=np.full((8,8),12,dtype=float);h[2,2]=0;h[1,1]=np.nan
        blocked=np.zeros((8,8),bool);blocked[6,2]=True
        out=refine(h,old,blocked)
        self.assertEqual(int(out[2,2,0]),0)
        self.assertEqual(int(out[1,1,3])&1,0)
        self.assertFalse(np.any(out[:4,4:,0]))
        self.assertEqual(int(out[6,2,0]),0)
        self.assertEqual(int(out[6,2,3])&4,4)
        self.assertEqual(int(out[7,7,0]),255)

    def test_individual_crown_exclusion_crosses_tile_seam(self):
        crown=Point(4,4).buffer(1.4)
        left=mask_geometries([crown],from_origin(0,8,1,1),4)
        right=mask_geometries([crown],from_origin(4,8,1,1),4)
        whole=mask_geometries([crown],from_origin(0,8,1,1),8)
        np.testing.assert_array_equal(np.concatenate([left,right],axis=1),whole[:4])
        self.assertTrue(left[3,3] and right[3,0])

    def test_pixel_edges_and_north_south_axis(self):
        mask=mask_geometries([box(10.1,19.1,10.9,19.9)],from_origin(10,20,1,1),4)
        self.assertTrue(mask[0,0]);self.assertEqual(int(mask.sum()),1)

if __name__=='__main__':unittest.main()
