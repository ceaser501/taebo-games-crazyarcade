# Crazy Arcade PatchData .idx reader. After a 16-byte header the file is one XOR chain: every
# byte is XORed with the plaintext byte four places earlier. Plaintext records are
#   u32 name length, name (cp949), u32 offset, u32 size, u32 x, u32 y
# and the first record's length is not stored (it seeds the chain).
import struct, sys

def decode(block, seed):
    p = bytearray(seed)
    for c in block: p.append(c ^ p[-4])
    return bytes(p[4:])

def records(plain, n):
    o, out = 0, []
    while True:
        name = plain[o:o+n]; off, size, x, y = struct.unpack_from('<4I', plain, o + n)
        out.append((name.decode('cp949', 'replace'), off, size, x, y))
        o += n + 16
        if o >= len(plain): return out
        n = struct.unpack_from('<I', plain, o)[0]; o += 4
        if n > 512: raise ValueError('bad record length')

def parse(path):
    d = open(path, 'rb').read()
    head = struct.unpack_from('<4I', d, 0)
    for n in range(1, 256):
        plain = decode(d[16:], bytes([n, 0, 0, 0]))
        if struct.unpack_from('<I', plain, n)[0] != 0: continue
        try: return head, records(plain, n)
        except (ValueError, struct.error): pass
    raise ValueError('cannot parse ' + path)

if __name__ == '__main__':
    head, recs = parse(sys.argv[1])
    print(sys.argv[1], head, len(recs), 'end', max(r[1] + r[2] for r in recs))
    for r in recs[:int(sys.argv[2]) if len(sys.argv) > 2 else 20]: print(r)
