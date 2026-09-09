import io
import unittest
from lm_ortho import authorization, source_url, validate_header, probe_sources, IntakeError

TIFF = b'II*\x00' + bytes(12)

class ReaderTests(unittest.TestCase):
    def test_range_requires_actual_tiff_and_pinned_source_size(self):
        self.assertTrue(validate_header(206, 'bytes 0-15/1024', TIFF, 1024))
        self.assertFalse(validate_header(200, None, b'', 1024))
        self.assertFalse(validate_header(206, 'bytes 0-15/1024', b'<html>denied</htm', 1024))
        self.assertFalse(validate_header(206, 'bytes 0-15/2048', TIFF, 1024))
        self.assertFalse(validate_header(206, 'bytes 0-15/1024', TIFF + b'X', 1024))

    def test_credentials_and_urls_never_go_in_the_plan(self):
        self.assertEqual(authorization({'LANTMATERIET_USERNAME':'user','LANTMATERIET_PASSWORD':'pass'}), 'Basic dXNlcjpwYXNz')
        with self.assertRaises(IntakeError): authorization({})
        with self.assertRaises(IntakeError): authorization({'LANTMATERIET_BEARER_TOKEN':'bad\nvalue'})
        with self.assertRaises(IntakeError): source_url('https://elsewhere.test/bild/data/orto/a.tif')
        with self.assertRaises(IntakeError): source_url('https://user:pass@dl1.lantmateriet.se/bild/data/orto/a.tif')

    def test_whole_file_responses_are_not_read(self):
        class Response:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): raise AssertionError('must not download whole asset')
        class Opener:
            def open(self, *args, **kwargs): return Response()
        result = probe_sources([{'id':'image','href':'https://dl1.lantmateriet.se/bild/data/orto/a.tif'}], 'Bearer test', Opener())
        self.assertFalse(result['authorized'])
        self.assertEqual(result['assets'][0]['status'], 200)


class GridTests(unittest.TestCase):
    def test_downloaded_crop_preserves_centres_and_rejects_tampering(self):
        import tempfile
        import json
        from pathlib import Path
        import numpy as np
        import rasterio
        from rasterio.transform import from_origin
        from lm_ortho import digest
        from lm_ortho_read import read_window, FRAME_E, FRAME_N
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            file = root / 'sample.tif'
            transform = from_origin(FRAME_E - 8, FRAME_N + 8, 0.16, 0.16)
            pixels = np.zeros((4,100,100), dtype='uint8')
            pixels[0] = np.tile(np.arange(100, dtype='uint8'), (100,1))
            pixels[1] = pixels[0].T
            pixels[2:] = 100
            with rasterio.open(file,'w',driver='GTiff',width=100,height=100,count=4,dtype='uint8',crs='EPSG:3006',transform=transform) as dst:
                dst.write(pixels)
            record = dict(id='sample', rasterFile=file.name, sha256=digest(file), width=100,height=100,
                boundsEpsg3006=[FRAME_E-8,FRAME_N-8,FRAME_E+8,FRAME_N+8],geoTransform=list(transform.to_gdal()),
                sources=[{'capturedAt':'2026-04-10'}])
            (root/'acquisition.json').write_text(json.dumps({'groundId':'visby','access':{'authorized':True},'windows':[record]}))
            output,aff=read_window(0,0,8,cache=root)
            self.assertEqual(output.shape,(50,50,3))
            self.assertEqual(tuple(output[0,0]),(25,25,100))
            self.assertEqual(tuple(output[-1,-1]),(74,74,100))
            self.assertAlmostEqual(aff['x0']+0.5*aff['metres'],-3.92)
            with self.assertRaisesRegex(ValueError,'outside'): read_window(100,100,8,cache=root)
            file.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError,'checksum'): read_window(0,0,8,cache=root)

if __name__ == '__main__': unittest.main()
