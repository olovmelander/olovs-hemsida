"""Independently verify expanded canopy grids and unchanged original float bits."""
from pathlib import Path
import hashlib, json
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
PINS={
    'chm':'f7648dd78beb6f34afc9a76702c64f6e72c5d444975f1677801bcb61c3d33e76',
    'ground':'c2b6e8626b87c12f2d4be314e6739ac82536351fa23c673eea2426eb6687fb05',
    'allReturns':'5cad68a3d0b79f8f363b93f11fe9e7e7afffad85b09579cfe72bdf70dd8482ae',
    'firstReturns':'9d496c47ab2f254d2eb73d4a1e10f5d2c90327b54bee83e071cf79bdf2930868',
}


def main():
    receipt_path='geo_data/course-v2/tortuna/vegetation/expanded-canopy-evidence.json'
    receipt_bytes=(ROOT/receipt_path).read_bytes()
    receipt=json.loads(receipt_bytes)
    expected=dict(minEasting=596120.5,maxNorthing=6616435.5,width=2560,height=3072,sampleSpacingMetres=1)
    if receipt['grid']!=expected or receipt['tiles']!=120 or receipt['newlyAcquiredTiles']!=60 or receipt['retainedOriginalTiles']!=60:
        raise ValueError('Expanded grid/coverage differs')
    if receipt['source']['id']!='21c035-661_59' or receipt['source']['capturedAt']!='2021-04-05T12:00:00Z':
        raise ValueError('Expected retained April 2021 campaign')
    cells=np.zeros((12,10),dtype=np.uint8)
    for tile in receipt['perTile']:
        west,south,east,north=tile['bbox']
        if east-west!=256 or north-south!=256:
            raise ValueError('Unexpected tile size')
        col=(west-expected['minEasting'])/256;row=(expected['maxNorthing']-north)/256
        if col!=int(col) or row!=int(row) or not 0<=col<10 or not 0<=row<12:
            raise ValueError('Tile does not align to expanded lattice')
        cells[int(row),int(col)]+=1
        if tile['acquisition']=='new-bounded-source-window' and not tile['nodeStatistics']['nodeCountsExact']:
            raise ValueError('Point count check missing')
    if not np.all(cells==1):
        raise ValueError('Expanded tiles overlap or leave a hole')
    records={};arrays={}
    for layer,pin in PINS.items():
        entry=receipt['files'][layer]
        payload=(ROOT/entry['data']).read_bytes()
        sha=hashlib.sha256(payload).hexdigest()
        if sha!=entry['sha256'] or len(payload)!=2560*3072*4 or entry['bytes']!=len(payload):
            raise ValueError('Expanded output hash or byte count differs')
        sidecar=json.loads((ROOT/entry['sidecar']).read_text())
        if (sidecar['width'],sidecar['height'],sidecar['originEasting'],sidecar['originNorthing'],sidecar['sampleSpacingMetres'],sidecar['format'])!=(2560,3072,596121,6616435,1,'float32-le'):
            raise ValueError('Expanded cell-centre sidecar differs')
        values=np.frombuffer(payload,dtype='<f4').reshape(3072,2560)
        overlap=values[256:2816,512:2048].copy().tobytes()
        original=(ROOT/f'tortunabuild/cache/canopy/{layer}.f32').read_bytes()
        if hashlib.sha256(original).hexdigest()!=pin or overlap!=original or receipt['originalOverlap'][layer]['extractedSha256']!=pin:
            raise ValueError('Original float bits changed')
        if np.isinf(values).any():
            raise ValueError('Infinite expanded raster value')
        finite=values[np.isfinite(values)]
        if layer in ['allReturns','firstReturns'] and (len(finite)!=values.size or np.any(finite<0) or np.any(finite!=np.floor(finite))):
            raise ValueError('Return count raster is not complete nonnegative integer counts')
        if layer=='chm' and (finite.min()<0 or finite.max()>60):
            raise ValueError('Canopy height leaves source algorithm limits')
        records[layer]=dict(data=entry['data'],sha256=sha,bytes=len(payload),finiteCells=int(len(finite)),unknownCells=int(np.isnan(values).sum()),
            minimum=float(finite.min()),maximum=float(finite.max()),originalOverlapBytes=len(overlap),originalOverlapSha256=pin,originalByteIdentityPreserved=True)
        arrays[layer]=values
    if np.any(arrays['firstReturns']>arrays['allReturns']):
        raise ValueError('First-return counts exceed all returns')
    if np.any(np.isfinite(arrays['chm'])&(arrays['allReturns']==0)):
        raise ValueError('Unknown no-return cell was converted to a measured canopy value')
    report=dict(schemaVersion=1,groundId='tortuna',state='expanded-canopy-byte-and-coverage-verified',
        receipt=dict(path=receipt_path,sha256=hashlib.sha256(receipt_bytes).hexdigest()),grid=expected,
        tilesCoverExactlyOnce=True,originalSourceRastersUnchanged=True,sourceEpoch=receipt['source']['capturedAt'],
        nativeDtmModified=False,layers=records,canopyCellsAboveTwoMetres=int((arrays['chm']>2).sum()),
        limitations=['Canopy remains dated April 2021 source evidence.',
            'Unknown cells remain unknown; cloud-derived ground supports canopy measurement and never replaces the native terrain raster.'])
    destination=ROOT/'geo_data/course-v2/tortuna/vegetation/expanded-canopy-review.json'
    destination.write_bytes((json.dumps(report,indent=2,allow_nan=False)+'\n').encode('utf-8'))
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
