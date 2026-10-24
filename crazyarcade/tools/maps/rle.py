import sys, os, struct, zlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idx

def rle(data, w, h, stats=None):
    """Decode op stream: top two bits = kind, low six = count. Returns RGBA bytes."""
    out = bytearray(w * h * 4)
    p = 0; i = 0; n = w * h
    while i < len(data) and p < n:
        op = data[i]; i += 1
        kind, cnt = op >> 6, op & 63
        if stats is not None: stats[kind] = stats.get(kind, 0) + 1
        if kind == 2:            # transparent run
            p += cnt
        elif kind == 1:          # one colour repeated
            b, g, r = data[i:i+3]; i += 3
            for _ in range(cnt):
                out[p*4:p*4+4] = bytes((r, g, b, 255)); p += 1
        elif kind == 0:          # literal pixels
            for _ in range(cnt):
                b, g, r = data[i:i+3]; i += 3
                out[p*4:p*4+4] = bytes((r, g, b, 255)); p += 1
        else:
            if stats is not None: stats.setdefault('k3', []).append((op, data[i:i+4].hex()))
    return out, i, p

def runs(data, n, size, put, full=None):
    """Walks one op stream over n pixels; size is bytes per value (3 colour, 1 alpha).
    Kind 3 (alpha streams only) is a run at full value, passed to full()."""
    p = i = 0
    while i < len(data) and p < n:
        op = data[i]; i += 1
        kind, cnt = op >> 6, op & 63
        if kind == 2: p += cnt
        elif kind == 1:
            v = data[i:i+size]; i += size
            for _ in range(cnt): put(p, v); p += 1
        elif kind == 0:
            for _ in range(cnt): put(p, data[i:i+size]); i += size; p += 1
        elif full is not None:
            for _ in range(cnt): full(p); p += 1
        else: raise ValueError('op %02x at %d' % (op, i - 1))
    return i, p

def decode(data, w, h):
    """Atlas pixels -> RGBA. Streams start with c0 (colour only) or c1 + u32 length (colour, then alpha)."""
    n = w * h
    out = bytearray(n * 4)
    def col(p, v):
        if p < n: out[p*4:p*4+4] = bytes((v[2], v[1], v[0], 255))
    if not data: return out, 0, n
    if data[0] == 0xc0:
        used, px = runs(data[1:], n, 3, col); used += 1
        return out, used, px
    if data[0] == 0xc1:
        ln = int.from_bytes(data[1:5], 'little')
        cu, px = runs(data[5:5+ln], n, 3, col)
        def al(p, v):
            if p < n: out[p*4+3] = v[0]
        def opaque(p):
            if p < n: out[p*4+3] = 255
        au, apx = runs(data[5+ln:], n, 1, al, opaque)
        return out, 5 + ln + au, px
    raise ValueError('unknown stream %02x' % data[0])

def png(path, w, h, rgba):
    raw = b''.join(b'\0' + rgba[y*w*4:(y+1)*w*4] for y in range(h))
    def chunk(t, b): return struct.pack('>I', len(b)) + t + b + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
