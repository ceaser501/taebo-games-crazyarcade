# buildmaps.py OUT.js map.json... : turns reconstructed layouts into the game's map table.
import sys, json, re, os
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'ca') + '/'
out, *files = sys.argv[1:]
KO = {'Village': '빌리지', 'Patrit': '해적', 'Camp': '캠프', 'Factory': '공장', 'Forest': '숲', 'forest': '숲', 'Tomb': '묘지',
      'Ice': '아이스', 'Desert': '사막', 'Cookie': '쿠키', 'Mine': '광산', 'mine': '광산', 'Ocean': '바다', 'Island': '섬', 'Xmas': '크리스마스',
      'Space': '우주', 'Pirate': '해적'}
BGM = {'Village': 'Village', 'Patrit': 'Patrit', 'Camp': 'Camp', 'Factory': 'Factory', 'Forest': 'Forest', 'forest': 'Forest',
       'Tomb': 'Tomb', 'Ice': 'Ice', 'Desert': 'Desert', 'Cookie': 'Cookie', 'Mine': 'Mine', 'mine': 'Mine', 'Ocean': 'Ocean',
       'Island': 'Ocean', 'Xmas': 'Xmas', 'Space': 'space'}
BUSH = re.compile(r'/(Herb\d*|Plant0[23]|BasicBlock_Pass\d*|Grass\d*Bush|Bush\d*)$')
cache = {}
def tileset(t):
    if t not in cache: cache[t] = json.load(open(A + 'tile_%s.json' % t))['sprites']
    return cache[t]
def breaker(t, name):
    # The crumbling animation: the sprite itself (9 frames) or a separate ...break sprite.
    sp = tileset(t); base = name.split('/')[1]
    m = re.match(r'(.*?)(\d*)$', base); stem, num = m.group(1), m.group(2)
    for cand in (base + 'break', base + 'Break', stem + 'Break' + num, stem + 'break' + num):
        for k in sp:
            if k.split('/')[1].lower() == cand.lower(): return k
    return name if len(sp[name]) >= 8 else None
def kind(t, name):
    if BUSH.search(name): return 'bush'
    return 'soft' if breaker(t, name) else 'hard'
def footprint(t, name):
    s, sx, sy, w, h, dx, dy = tileset(t)[name][0]
    cw = max(1, round((w + min(0, dx)) / 40)) if w > 48 else 1
    ch = 1 if cw == 1 else max(1, round(cw * 0.75))
    return cw, ch
from PIL import Image
import numpy as np
def recon_error(f):
    im = np.asarray(Image.open(f[:-5] + '_dbg.png').convert('RGB'), dtype=np.float32)
    a, b = im[:, :600], im[:, 600:]
    sm = lambda x: np.asarray(Image.fromarray(x.astype(np.uint8)).resize((60, 52), Image.BOX), dtype=np.float32)
    return float(np.abs(sm(a) - sm(b)).mean())
maps = []
for f in files:
    m = json.load(open(f)); mid = os.path.basename(f)[:-5]; t = m['theme']
    err = recon_error(f); nobj = sum(1 for r in m['objs'] for o in r if o)
    if err > 26 or nobj < 25:
        print('skip', mid, round(err, 1), nobj); continue
    pre = re.match(r'[A-Za-z]+', mid).group(0); num = mid[len(pre):]
    tiles, tix = [], {}
    def ti(name, k=None):
        if name not in tix:
            tix[name] = len(tiles); kk = k or kind(t, name)
            tiles.append([name, kk] + (list(footprint(t, name)) + [breaker(t, name) if kk == 'soft' else None] if k not in ('floor', 'hard') or (k == 'hard' and name != '$cover') else []))
        return tix[name]
    floor = [ti(m['floor'][r][c], 'floor') for r in range(13) for c in range(15)]
    objs = [-1] * 195
    for r in range(13):
        for c in range(15):
            n = m['objs'][r][c]
            if n: objs[r * 15 + c] = ti(n)
    # Multi-cell objects block their whole footprint (anchor is the bottom-left cell).
    for i, o in enumerate(list(objs)):
        if o < 0 or len(tiles[o]) < 4: continue
        cw, ch = tiles[o][2], tiles[o][3]
        c, r = i % 15, i // 15
        for dc in range(cw):
            for dr in range(ch):
                cc, rr = c + dc, r - dr
                if (dc or dr) and 0 <= cc < 15 and 0 <= rr < 13 and objs[rr * 15 + cc] < 0:
                    objs[rr * 15 + cc] = ti('$cover', 'hard')
    # Spawns: farthest-point picks among cells free of solid objects with a free neighbour.
    def solid(i): return objs[i] >= 0 and tiles[objs[i]][1] == 'hard'
    cand = [i for i in range(195) if not solid(i) and any(0 <= (i % 15) + dc < 15 and 0 <= (i // 15) + dr < 13 and not solid(i + dc + 15 * dr) for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    corners = [(0, 0), (14, 12), (14, 0), (0, 12)]
    spawns = []
    for cx, cy in corners:
        best = min(cand, key=lambda i: abs(i % 15 - cx) + abs(i // 15 - cy))
        if best not in spawns: spawns.append(best)
    while len(spawns) < 8:
        best = max(cand, key=lambda i: min(abs(i % 15 - s % 15) + abs(i // 15 - s // 15) for s in spawns))
        spawns.append(best)
    maps.append(dict(id=mid, name=KO.get(pre, pre) + num, theme=t, bgm=BGM.get(pre, 'Village'), tiles=tiles, floor=floor, objs=objs,
                     spawns=[[s % 15, s // 15] for s in spawns]))
js = '// Official battle maps rebuilt from the minimaps in FxMap.idd (Etc/<map>_mm) by matching the\n' \
     '// theme\'s tiles cell by cell. Generated; tiles: [sprite, kind, footprint w, h].\n' \
     'export const MAPS = ' + json.dumps(maps, ensure_ascii=False, separators=(',', ':')) + ';\n'
open(out, 'w').write(js)
print(len(maps), 'maps', len(js) // 1024, 'KB')
