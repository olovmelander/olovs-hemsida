from prepare import *
import shutil

def main():
 exports=OUT/'exports';exports.mkdir(exist_ok=True)
 for p in DOC.iterdir():
  if p.suffix in ['.geojson','.json','.md']:shutil.copy2(p,exports/p.name)
 cells=read(DOC/'coverage-accounting.geojson')['features']
 for f in cells:f['properties'].pop('sources',None)
 with rasterio.open(OUT/'chm.tif') as src:rasterBounds=list(src.bounds)
 data=dict(scope=read(DOC/'facility-scope.geojson'),core=read(DOC/'facility-core.geojson'),corridor=read(DOC/'playing-corridor.geojson'),hold=read(DOC/'protected-evaluation.geojson'),
  cells=collection(cells),lines=read(DOC/'routing-lines.geojson'),corrections=read(DOC/'corrections.geojson'),reference=read(DOC/'reference.geojson'),
  source=read(DOC/'source-inventory.json'),coverage=read(DOC/'coverage-summary.json'),benchmark=read(DOC/'benchmark.json'),summary=read(DOC/'corrections.json'),
  overview=read(OUT/'review/overview.json'),rasterBounds=rasterBounds,
  records={mode:[dict(id=p['properties']['id'],easting=p['properties']['easting'],northing=p['properties']['northing'],radiusMetres=p['properties']['radiusMetres']) for p in read(DOC/f'{mode}-individual-coverage.geojson')['features']] for mode in ['before','after']},
  captures={mode:read(OUT/f'captures/{mode}/report.json') for mode in ['before','after']})
 # Keep large renderer diagnostics in their own evidence file.
 for mode in data['captures']:
  for run in data['captures'][mode]['runs']:run.pop('state',None)
 save(OUT/'review-data.json',data);shutil.copy2(ROOT/'tools/veckefjarden-tree-pilot/review.html',OUT/'review.html')
 print('Viewer and GIS exports ready')

if __name__=='__main__':main()
