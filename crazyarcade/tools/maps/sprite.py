import sys, os, struct
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rle

def parse(b):
    """Returns (header, atlases[(w,h,data)], frames[dict]) or raises."""
    n, fmt, na, nb = struct.unpack_from('<4i', b, 0)
    if not (0 < n < 5000 and 0 < na < 500): raise ValueError('not a sprite')
    o = 16
    sizes = []
    for _ in range(na):
        h, w = struct.unpack_from('<2i', b, o); o += 8; sizes.append((w, h))
    frames = []
    for _ in range(n):
        v = struct.unpack_from('<12i', b, o); o += 48
        frames.append(dict(ox=v[0], oy=v[1], key=v[2], atlas=v[3], x=v[4], y=v[5], w=v[6]-v[4], h=v[7]-v[5], cw=v[8], ch=v[9], ax=v[10], ay=v[11]))
    atlases = []
    for w, h in sizes:
        ln = struct.unpack_from('<I', b, o)[0]; o += 4
        atlases.append((w, h, b[o:o+ln])); o += ln
    return (n, fmt, na, nb), atlases, frames, o
