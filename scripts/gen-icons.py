#!/usr/bin/env python3
"""Writes the PWA icons: indigo square with a white radar glyph. Run: python3 scripts/gen-icons.py"""
import math, struct, zlib, pathlib

BG, FG = (79, 70, 229), (255, 255, 255)

def png(size, pixel):
    raw = b''.join(b'\x00' + bytes(c for x in range(size) for c in pixel(x, y)) for y in range(size))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')

def glyph(size):
    c, r1, r2, w = size / 2, size * 0.32, size * 0.15, size * 0.045
    dot = (size * 0.66, size * 0.34, size * 0.06)
    def pixel(x, y):
        d = math.hypot(x - c, y - c)
        ring = abs(d - r1) < w / 2 or abs(d - r2) < w / 2
        on_dot = math.hypot(x - dot[0], y - dot[1]) < dot[2]
        # sweep line from centre towards the dot
        vx, vy = dot[0] - c, dot[1] - c
        t = ((x - c) * vx + (y - c) * vy) / (vx * vx + vy * vy)
        px, py = c + t * vx, c + t * vy
        on_line = 0 <= t <= 1 and math.hypot(x - px, y - py) < w / 2
        return FG if (ring or on_dot or on_line) else BG
    return pixel

out = pathlib.Path('apps/web/public/icons'); out.mkdir(parents=True, exist_ok=True)
for s in (180, 192, 512):
    (out / f'icon-{s}.png').write_bytes(png(s, glyph(s)))
    print('wrote', out / f'icon-{s}.png')
