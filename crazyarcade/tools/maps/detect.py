# detect.py MINIMAP.png... : best-matching tileset for each minimap by palette distance
import sys, os, json, glob, numpy as np
from PIL import Image
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'ca') + '/'
pals = {}
SHORT = set(os.environ.get('TILESETS', '').split(',')) - {''}
for jf in sorted(glob.glob(A + 'tile_Tile*.json')):
    t = jf.split('tile_')[1][:-5]
    if SHORT and t not in SHORT: continue
    J = json.load(open(jf))
    sheets = [Image.open(A + f).convert('RGBA') for f in J['sheets']]
    cols = []
    for name, frames in J['sprites'].items():
        s, sx, sy, w, h, dx, dy = frames[0]
        if s < 0 or w == 0: continue
        im = sheets[s].crop((sx, sy, sx + w, sy + h)).resize((max(1, w // 4), max(1, h // 4)), Image.BOX)
        a = np.asarray(im, dtype=np.float32).reshape(-1, 4); cols.append(a[a[:, 3] > 200][:, :3])
    if not cols: continue
    P = np.unique((np.concatenate(cols) // 4).astype(np.int32), axis=0) * 4
    pals[t] = P.astype(np.float32)
for f in sys.argv[1:]:
    m = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32).reshape(-1, 3)[::3]
    scores = []
    for t, P in pals.items():
        d = ((m[:, None, :] - P[None, :, :]) ** 2).sum(-1).min(1)
        scores.append((float(np.sqrt(d).mean()), t))
    scores.sort(); print(f.split('/')[-1], scores[:3])
