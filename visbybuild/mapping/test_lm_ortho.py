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

if __name__ == '__main__': unittest.main()
