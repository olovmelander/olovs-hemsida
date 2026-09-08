"""Acquire primary municipality metadata, without assuming a licence from access."""
from pathlib import Path
import datetime
import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[4]
OUT = ROOT / 'geo_data/course-v2/lidingo/mapping'
NAMES = {31: 'ortho-2019-dataset', 32: 'ortho-2019-distribution', 20: 'ortho-series'}
NS = {'dct': 'http://purl.org/dc/terms/', 'dcat': 'http://www.w3.org/ns/dcat#'}
RDF = '{http://www.w3.org/1999/02/22-rdf-syntax-ns#}resource'


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    sources = []
    for identifier, name in NAMES.items():
        url = f'https://metadata.lidingo.se/store/3/resource/{identifier}'
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read(1000000)
            content_type = response.headers.get('Content-Type')
        target = OUT / f'municipal-{name}.rdf'
        target.write_bytes(data)
        # The published response contains non-UTF8 label bytes despite declaring
        # UTF8. Licence and URL assertions are ASCII and survive replacement.
        parsed = ET.fromstring(data.decode('utf8', errors='replace'))
        sources.append({'url': url, 'path': target.relative_to(ROOT).as_posix(),
            'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
            'contentType': content_type,
            'licenceUrls': [e.attrib[RDF] for e in parsed.findall('.//dct:license', NS)],
            'accessUrls': [e.attrib[RDF] for e in parsed.findall('.//dcat:accessURL', NS)],
            'keywords': [e.text for e in parsed.findall('.//dcat:keyword', NS)]})
    distribution = next(s for s in sources if s['url'].endswith('/32'))
    assert distribution['licenceUrls'] == ['http://creativecommons.org/publicdomain/zero/1.0/']
    assert len(distribution['accessUrls']) == 1
    assert 'servicename=wms_ortofoto_2019_oppendata' in distribution['accessUrls'][0]
    report = {'schemaVersion': 1, 'groundId': 'lidingo',
        'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'state': 'primary-source-licence-confirmed', 'provider': 'Lidingo stad',
        'sourceId': 'imagery-municipal-2019', 'licence': 'CC0-1.0',
        'licenceUrl': distribution['licenceUrls'][0], 'sources': sources,
        'decision': 'The official municipal distribution metadata explicitly licenses the exact retained 2019 WMS endpoint under CC0. This replaces the previous secondary-catalogue-only rights status.',
        'remainingUnknowns': ['Exact capture date and product GSD', 'Local positional residuals',
            'Contemporary condition after the 2019 campaign', 'No newer municipal campaign identified from this series record'],
        'encodingNote': 'Exact upstream RDF bytes retained. Some label bytes are not valid UTF8 despite the XML declaration; ASCII licence and endpoint values parsed without ambiguity.'}
    target = OUT / 'municipal-ortho-2019-licence.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    print(json.dumps({'report': target.relative_to(ROOT).as_posix(), 'licence': report['licence']}))


if __name__ == '__main__':
    main()
