#!/usr/bin/env python3
"""Fetch selected SpriteCollab folders at a pinned revision, preserving provenance."""
import argparse, hashlib, json, pathlib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('folders', nargs='+', help='e.g. 0006 0006/0001')
parser.add_argument('--revision', default='334639a66c5c70bccfe4e32fbb7d9b7c5043bae9')
args = parser.parse_args()
if len(args.revision) != 40 or any(c not in '0123456789abcdef' for c in args.revision):
    parser.error('revision must be a full commit SHA')
cache = ROOT / '.cache/SpriteCollab'

def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'pokemon-arena-reference-setup'})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()

def save(relative, data):
    dest = cache / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.read_bytes() != data:
        raise RuntimeError(f'Refusing to overwrite different existing file: {dest}')
    if not dest.exists():
        dest.write_bytes(data)

for folder in args.folders:
    if any(len(p) != 4 or not p.isdigit() for p in folder.split('/')):
        parser.error('folders must be slash-separated four-digit IDs')
    source = f'https://api.github.com/repos/PMDCollab/SpriteCollab/contents/sprite/{folder}?ref={args.revision}'
    entries = json.loads(get(source))
    records = []
    for item in entries:
        if item['type'] != 'file':
            continue
        name = item['name']
        if pathlib.Path(name).name != name:
            raise RuntimeError('Unsafe upstream filename')
        data = get(f'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/{args.revision}/sprite/{folder}/{name}')
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if blob != item['sha']:
            raise RuntimeError(f'Git blob verification failed: {name}')
        save(f'sprite/{folder}/{name}', data)
        records.append({'file': name, 'gitBlob': blob, 'sha256': hashlib.sha256(data).hexdigest()})
    provenance = {'repository': 'https://github.com/PMDCollab/SpriteCollab', 'revision': args.revision, 'folder': folder, 'files': records}
    save(f'sprite/{folder}/provenance.json', (json.dumps(provenance, indent=2)+'\n').encode())
    print(f'{folder}: {len(records)} files verified', flush=True)
for name in ['LICENSE.md', 'credit_names.txt']:
    save(f'reference-metadata/{args.revision}/{name}', get(f'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/{args.revision}/{name}'))
print('License and author directory saved.')
