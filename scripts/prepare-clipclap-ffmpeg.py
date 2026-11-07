"""Fetch the pinned Windows runtime, verify it and stage its license notices."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='Use an already downloaded ZIP')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'scripts/clipclap-ffmpeg.json').read_text())
    cache = ROOT / 'packages/desktop/resources/ffmpeg'
    cache.mkdir(parents=True, exist_ok=True)
    downloads = ROOT / '.clipclap-cache'
    downloads.mkdir(exist_ok=True)
    archive = args.archive or downloads / manifest['filename']
    if not archive.exists():
        print(f"Downloading {manifest['filename']}")
        with urllib.request.urlopen(manifest['url']) as source, archive.open('wb') as out:
            shutil.copyfileobj(source, out)
    with archive.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest()
    if digest != manifest['sha256']:
        raise RuntimeError(f'Checksum mismatch: {digest}')
    prefix = manifest['filename'].removesuffix('.zip') + '/'
    with zipfile.ZipFile(archive) as z:
        for name in ('bin/ffmpeg.exe', 'bin/ffprobe.exe', 'LICENSE.txt'):
            with z.open(prefix + name) as source, (cache / Path(name).name).open('wb') as out:
                shutil.copyfileobj(source, out)
    (cache / 'PROVENANCE.json').write_text(json.dumps(manifest, indent=2) + '\n')
    shutil.copyfile(ROOT / 'docs/clipclap/FFMPEG.md', cache / 'SOURCE-AND-LICENSE.md')
    (ROOT / 'docs/images/catalog').mkdir(parents=True, exist_ok=True)
    print('Verified FFmpeg, ffprobe and license notices are ready for packaging.')

if __name__ == '__main__':
    main()
