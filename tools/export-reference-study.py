#!/usr/bin/env python3
"""Export all pokeSprite filenames using the PMD sheets, then audit coverage and pixels."""
import hashlib, json, pathlib
from PIL import Image, ImageDraw, ImageOps

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT.parent / '確認用画像/reference-study'
catalog = json.loads((OUT / 'catalog.json').read_text())
inventory = json.loads((OUT / 'source-inventory.json').read_text())
by_id = {r['id']: r for r in catalog['records']}
sheet_cache = {}

def sheet(rec, variant, action):
    a = rec['variants'][variant]['anims'][action]
    file = OUT / rec['src'] / a['file']
    if file not in sheet_cache:
        sheet_cache[file] = Image.open(file).convert('RGBA')
    return sheet_cache[file], a

def cell(rec, variant, action, row, frame):
    im, a = sheet(rec, variant, action)
    row = row if a['rows'] > 1 else 0
    return im.crop((frame*a['fw'], row*a['fh'], (frame+1)*a['fw'], (row+1)*a['fh']))

def indexed(im, colors):
    palette = [0, 0, 0] + [v for h in colors for v in bytes.fromhex(h)]
    palette += [0] * (768 - len(palette))
    lookup = {tuple(bytes.fromhex(h)): n+1 for n, h in enumerate(colors)}
    out = Image.new('P', im.size, 0)
    out.putpalette(palette)
    out.putdata([lookup[p[:3]] if p[3] else 0 for p in im.getdata()])
    out.info['transparency'] = 0
    return out

exported = []
for item in inventory:
    rec = by_id[item['id']]
    file = pathlib.Path(item['input'])
    original = ROOT / 'pokeSprite' / file
    if hashlib.sha256(original.read_bytes()).hexdigest() != item['sourceSha256']:
        raise RuntimeError(f'Source changed: {original}')
    variant = 'shiny' if 'shiny' in file.name else 'normal'
    row = 4 if file.name.startswith('back') else 0
    reverse = 'reverse' in file.name
    is_icon = file.parent.name == 'box-icons'
    out = OUT / item['output']
    out.parent.mkdir(parents=True, exist_ok=True)
    source_im = Image.open(original)
    if is_icon:
        im = cell(rec, variant, 'Idle', 7, 0)
        bbox = im.getbbox()
        im = im.crop(bbox).resize(((bbox[2]-bbox[0])//2, (bbox[3]-bbox[1])//2), Image.Resampling.NEAREST)
        size = (max(source_im.width, im.width+4), max(source_im.height, im.height+4))
        canvas = Image.new('RGBA', size)
        canvas.paste(im, ((size[0]-im.width)//2, (size[1]-im.height)//2))
        canvas.save(out)
        mode = 'PMD Idle SW icon, native pixel density'
    elif file.suffix.lower() == '.png':
        im = cell(rec, variant, 'Idle', row, 0)
        if reverse:
            im = ImageOps.mirror(im)
        im.save(out)
        mode = 'PMD Idle first frame'
    else:
        a = rec['variants'][variant]['anims']['Idle']
        frames, durations, elapsed, previous = [], [], 0, 0
        for f, ticks in enumerate(a['durations']):
            im = cell(rec, variant, 'Idle', row, f)
            if reverse:
                im = ImageOps.mirror(im)
            frames.append(indexed(im, rec['variants'][variant]['palette']))
            elapsed += ticks * 1000 / 60
            boundary = round(elapsed / 10) * 10
            durations.append(max(10, boundary-previous))
            previous = boundary
        frames[0].save(out, save_all=True, append_images=frames[1:], duration=durations,
                       loop=0, transparency=0, disposal=2, optimize=False)
        mode = 'PMD Idle loop (GIF timing rounded to 10ms; sheets retain exact ticks)'
    output_im = Image.open(out)
    exported.append({**item, 'mode': mode, 'sourceSize': list(source_im.size),
                     'outputSize': list(output_im.size), 'frames': getattr(output_im, 'n_frames', 1),
                     'sha256': hashlib.sha256(out.read_bytes()).hexdigest()})

checks, warnings = [], []
for rec in catalog['records']:
    for variant, v in rec['variants'].items():
        union = set()
        for name, a in v['anims'].items():
            im, _ = sheet(rec, variant, name)
            assert im.size == (a['fw']*a['frames'], a['fh']*a['rows'])
            assert a['rows'] in (1, 8)
            assert len(a['durations']) == a['frames'] and min(a['durations']) > 0
            for key in ('hit', 'rush', 'ret'):
                assert a[key] is None or 0 <= a[key] < a['frames']
            assert set(im.getchannel('A').getdata()) <= {0, 255}
            native = im.resize((im.width//2, im.height//2), Image.Resampling.NEAREST)
            assert im.tobytes() == native.resize(im.size, Image.Resampling.NEAREST).tobytes()
            colors = {p[:3] for p in im.getdata() if p[3]}
            union.update(colors)
            assert len(colors) <= 15
            edge_cells = []
            for r in range(a['rows']):
                for f in range(a['frames']):
                    box = cell(rec, variant, name, r, f).getbbox()
                    assert box, (rec['id'], variant, name, r, f, 'empty')
                    if box[0] == 0 or box[1] == 0 or box[2] == a['fw'] or box[3] == a['fh']:
                        edge_cells.append([r, f])
            if edge_cells:
                warnings.append({'id':rec['id'], 'variant':variant, 'action':name, 'edgeCells':edge_cells})
            checks.append({'id':rec['id'], 'variant':variant, 'action':name, 'cells':a['frames']*a['rows'], 'colors':len(colors)})
        assert len(union) <= 15
    # A filename bearing reverse must be a real horizontal mirror, including GIF frames.
    dest = OUT / rec['src']
    for side in ('front', 'back', 'front-shiny', 'back-shiny'):
        a, b = Image.open(dest / (side+'.gif')), Image.open(dest / (side+'-reverse.gif'))
        assert a.n_frames == b.n_frames
        for f in range(a.n_frames):
            a.seek(f); b.seek(f)
            assert ImageOps.mirror(a.convert('RGBA')).tobytes() == b.convert('RGBA').tobytes()

report = {'sourceImages':len(inventory), 'exportedMatchingImages':len(exported),
          'forms':len(catalog['records']), 'variants':len(catalog['records'])*2,
          'sheets':len(checks), 'cells':sum(x['cells'] for x in checks),
          'checks':checks, 'edgeWarnings':warnings, 'structuralPass':True,
          'visualApproval':False}
(OUT / 'asset-map.json').write_text(json.dumps(exported, ensure_ascii=False, indent=2)+'\n')
(OUT / 'asset-map.js').write_text('window.PMD_ASSETS = '+json.dumps(exported, ensure_ascii=False)+';\n')
(OUT / 'validation.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')

# Compact visual review of all forms, both palettes and three complementary directions.
overview = Image.new('RGB', (1260, len(catalog['records'])*140), '#d2d6de')
draw = ImageDraw.Draw(overview)
for i, rec in enumerate(catalog['records']):
    y = i*140
    draw.text((8, y+5), rec['id'], fill='#20232a')
    for vi, variant in enumerate(('normal','shiny')):
        for ri, row in enumerate((0,2,4)):
            im = cell(rec, variant, 'Idle', row, 0)
            im = im.crop(im.getbbox())
            x = 10+vi*600+ri*160
            overview.paste(im, (x, y+30), im)
    source = Image.open(ROOT / 'pokeSprite' / rec['src'] / 'front.png').convert('RGBA')
    overview.paste(source, (1080,y+22),source)
overview.save(OUT / 'overview.png')
print(json.dumps({k:v for k,v in report.items() if k not in ('checks','edgeWarnings')},ensure_ascii=False))
print(f'Edge-touch warnings: {len(warnings)} (review original source and additions separately)')
