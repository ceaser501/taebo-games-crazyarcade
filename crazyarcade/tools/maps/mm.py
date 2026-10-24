# mm.py OUTDIR name... : decode Etc/<name>_mm minimaps (8-byte header + zlib sprite) to PNG
import sys, os, zlib, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idx, sprite, rle
from PIL import Image
out, *names = sys.argv[1:]
h, recs = idx.parse('FxMap.idx'); d = open('FxMap.idd', 'rb'); R = {r[0]: r for r in recs}
for n in names:
    r = R.get('Etc/%s_mm' % n)
    if not r: print('missing', n); continue
    d.seek(r[1]); b = d.read(r[2]); z = zlib.decompress(b[8:])
    hd, atl, fr, _ = sprite.parse(z); x = fr[0]; w, hh, data = atl[x['atlas']]
    im = Image.frombytes('RGBA', (w, hh), bytes(rle.decode(data, w, hh)[0]))
    im.save(os.path.join(out, n + '.png')); print(n, im.size, len(fr))
