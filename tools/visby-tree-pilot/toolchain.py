"""Record/verify the exact local offline toolchain. Never silently upgrade it."""
from prepare import *
import importlib.metadata
import platform

FILE=ROOT/'tools/visby-tree-pilot/toolchain-lock.json'
BASE=OUT/'toolchain'
PACKAGES=['numpy','rasterio','scipy','shapely','Pillow','matplotlib']

def current():
    files=sorted(BASE.glob('*.zip'))+sorted(BASE.glob('*.exe'))+[BASE/'R-4.5.3/bin/Rscript.exe']
    return dict(version=1,platform=platform.platform(),python=platform.python_version(),
        pythonPackages={name:importlib.metadata.version(name) for name in PACKAGES},r=read(BASE/'installed.json'),
        archives=[dict(file=str(p.relative_to(BASE)).replace('\\','/'),bytes=p.stat().st_size,sha256=digest(p)) for p in files])

def main():
    if '--record' in sys.argv:
        if FILE.exists():raise ValueError('A lock already exists; reviewing a new environment is an explicit separate experiment')
        lock=current();save(FILE,lock)
        archives=[a['file'] for a in lock['archives'] if a['file'].endswith('.zip')]
        (ROOT/'tools/visby-tree-pilot/toolchain-lock.R').write_text('pinned_archives <- c('+','.join(json.dumps(x) for x in archives)+')\n',encoding='utf-8')
    else:
        expected=read(FILE);actual=current()
        for key in ['python','pythonPackages','archives']:assert expected[key]==actual[key],f'Toolchain mismatch: {key}'
        assert expected['r']['R']==actual['r']['R']
        assert expected['r']['packages']==actual['r']['packages']
        print('Exact R executable, package archives and Python versions verified')

if __name__=='__main__':main()
