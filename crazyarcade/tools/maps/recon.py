# recon.py THEME MINIMAP.png OUT.json [debug.png]
# Rebuilds a 15x13 map from its official 148x128 minimap by trying every floor/object pair of the
# theme's tiles in each cell, bottom row first (objects from lower rows overlap upper cells).
import sys, os, json, numpy as np
from PIL import Image
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'ca') + '/'
theme, mmfile, out = sys.argv[1:4]
dbg = sys.argv[4] if len(sys.argv) > 4 else None
J = json.load(open(A + 'tile_%s.json' % theme))
sheets = [Image.open(A + f).convert('RGBA') for f in J['sheets']]
floors, objs = [], []
for name, frames in J['sprites'].items():
    s, sx, sy, w, h, dx, dy = frames[0]
    if s < 0: continue
    im = np.asarray(sheets[s].crop((sx, sy, sx + w, sy + h)), dtype=np.float32)
    ent = dict(name=name, im=im, w=w, h=h, dx=dx, dy=dy, n=len(frames))
    if w == 40 and h == 40 and dx == 0 and dy == -39 and len(frames) == 1: floors.append(ent)
    else: objs.append(ent)
COLS, ROWS, T = 15, 13, 40
mm = Image.open(mmfile).convert('RGB').resize((600, 520), Image.BILINEAR)
M = np.asarray(mm, dtype=np.float32)
def blur(x):  # what survives a 1/4 downscale
    im = Image.fromarray(np.clip(x, 0, 255).astype(np.uint8))
    return np.asarray(im.resize((10, 10), Image.BOX).resize((40, 40), Image.BILINEAR), dtype=np.float32)
def paste(canvas, ox, oy, e):  # alpha-composite e with its top-left at canvas coords (ox, oy)
    H, W = canvas.shape[:2]
    x0, y0 = max(0, ox), max(0, oy); x1, y1 = min(W, ox + e['w']), min(H, oy + e['h'])
    if x0 >= x1 or y0 >= y1: return
    src = e['im'][y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    a = src[..., 3:4] / 255.0
    canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1] * (1 - a) + src[..., :3] * a
grid_f = [[None] * COLS for _ in range(ROWS)]; grid_o = [[None] * COLS for _ in range(ROWS)]
def region_overlays(c, r):  # decided objects drawn after this cell that reach into it
    lst = []
    for rr in range(r, ROWS):
        for cc in range(COLS):
            if rr == r and cc >= c: continue
            o = grid_o[rr][cc]
            if o is None: continue
            ox = cc * T + o['dx']; oy = rr * T + 39 + o['dy']
            if ox < (c + 1) * T and ox + o['w'] > c * T and oy < (r + 1) * T and oy + o['h'] > r * T:
                lst.append((rr, cc, o))
    return lst
for r in range(ROWS - 1, -1, -1):
    for c in range(COLS):
        target = M[r * T:(r + 1) * T, c * T:(c + 1) * T]
        over = region_overlays(c, r)
        best = (1e18, None, None)
        for f in floors:
            base = f['im'][..., :3].copy()
            for o in [None] + objs:
                cv = base.copy()
                below = []
                # same-row objects to the left are drawn before this cell's object
                for rr, cc, oo in over:
                    if rr == r: paste(cv, cc * T + oo['dx'] - c * T, oo['dy'] + 39, oo)
                if o is not None: paste(cv, o['dx'], 39 + o['dy'], o)
                for rr, cc, oo in over:
                    if rr > r: paste(cv, cc * T + oo['dx'] - c * T, (rr - r) * T + 39 + oo['dy'], oo)
                err = float(((blur(cv) - target) ** 2).mean())
                if err < best[0]: best = (err, f, o)
        grid_f[r][c] = best[1]; grid_o[r][c] = best[2]
res = dict(theme=theme, floor=[[grid_f[r][c]['name'] for c in range(COLS)] for r in range(ROWS)],
           objs=[[(grid_o[r][c]['name'] if grid_o[r][c] else None) for c in range(COLS)] for r in range(ROWS)])
json.dump(res, open(out, 'w'))
if dbg:
    cv = np.zeros((520, 600, 3), np.float32)
    for r in range(ROWS):
        for c in range(COLS): cv[r * T:(r + 1) * T, c * T:(c + 1) * T] = grid_f[r][c]['im'][..., :3]
    for r in range(ROWS):
        for c in range(COLS):
            o = grid_o[r][c]
            if o: paste(cv, c * T + o['dx'], r * T + 39 + o['dy'], o)
    Image.fromarray(np.hstack([np.clip(cv, 0, 255).astype(np.uint8), np.asarray(mm)])).save(dbg)
for r in range(ROWS): print(' '.join((grid_o[r][c]['name'].split('/')[1][:7] if grid_o[r][c] else '.').ljust(7) for c in range(COLS)))
