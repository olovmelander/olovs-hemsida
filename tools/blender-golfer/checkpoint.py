"""Save the golfer work outside the repository, without touching the Git index."""
import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--label', default='golfer-lab')
parser.add_argument('--directory', type=Path, default=Path.home() / 'Banvy-golfer-checkpoints')
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9_-]+', args.label):
    parser.error('Use letters, numbers, underscores or hyphens for the label.')
now = datetime.now(timezone.utc)
paths = [
    'experiments/golfer', 'tools/blender-golfer', 'docs/graphics/golfer-2026-09-16',
    'apps/golf/public/models/golfer', 'apps/golf/golfer-study.html',
    'apps/golf/src/golfer-study.mjs', 'apps/golf/src/engine/golfer.mjs',
    'apps/golf/src/engine/golfer-course.mjs', 'apps/golf/src/main.js',
    'apps/golf/vite.config.js', 'apps/golf/package.json', 'apps/golf/public/_headers',
    'puttombuild/facilities/blender_mcp_client.py', '.gitignore',
]
files = set()
for name in paths:
    path = ROOT / name
    if path.is_file():
        files.add(path)
    elif path.is_dir():
        files.update(p for p in path.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
args.directory.mkdir(parents=True, exist_ok=True)
archive = args.directory / f'{now:%Y%m%dT%H%M%SZ}-{args.label}.zip'
manifest = {
    'createdAt': now.isoformat(), 'label': args.label,
    'gitHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    'note': 'Local working-tree snapshot. Shared app files may include unrelated edits; restore those selectively. Not a Git commit or deployment.',
    'files': {},
}
with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as saved:
    for path in sorted(files):
        relative = path.relative_to(ROOT).as_posix()
        data = path.read_bytes()
        manifest['files'][relative] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        saved.writestr(relative, data)
    saved.writestr('CHECKPOINT.json', json.dumps(manifest, indent=2))
with zipfile.ZipFile(archive) as saved:
    assert saved.testzip() is None
    for path, expected in manifest['files'].items():
        assert hashlib.sha256(saved.read(path)).hexdigest() == expected['sha256'], path
print(json.dumps({'archive': str(archive), 'files': len(files), 'bytes': archive.stat().st_size, 'verified': True}))
