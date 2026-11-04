"""
Generate the e2e fixture images for the Blurry Photo Cleaner test suite.

Stdlib only (zlib/struct/random) — no third-party packages, so the suite is
reproducible on any machine with Python 3.8+.

Outputs (in this directory):
  fixture-sharp-checkerboard.png   KNOWN SHARP  — high-contrast checkerboard + noise
  fixture-sharp-text.png           KNOWN SHARP  — high-contrast text-like bars + noise
  fixture-blurred-checkerboard.png BLURRED COPY of the checkerboard fixture
  fixture-blurred-text.png         BLURRED COPY of the text fixture
  fixture-not-an-image.txt         invalid file (plain text) — must be skipped with a
                                   visible "couldn't be opened" message
  fixture-fake.heic                invalid file — HEIC-branded bytes with no decodable
                                   image data; fails decode in every browser

Run:  python generate_fixtures.py
"""

import os
import random
import struct
import zlib

random.seed(20261104)  # deterministic output
SIZE = 480             # 400–800 px range per the plan
HERE = os.path.dirname(os.path.abspath(__file__))


# ---------------------------------------------------------------------------
# Minimal PNG encoder (8-bit RGB, filter type 0 per scanline)
# ---------------------------------------------------------------------------

def encode_png(path, rows):
    height = len(rows)
    width = len(rows[0]) // 3

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(row) for row in rows)
    with open(path, "wb") as out:
        out.write(b"\x89PNG\r\n\x1a\n")
        out.write(chunk(b"IHDR", header))
        out.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        out.write(chunk(b"IEND", b""))


# ---------------------------------------------------------------------------
# Sharp patterns (high local contrast / high detail → high Laplacian variance)
# ---------------------------------------------------------------------------

def clamp8(value):
    return 0 if value < 0 else (255 if value > 255 else value)


def make_checkerboard(width, height, cell=12, noise=35):
    """Black/white checkerboard with per-pixel luminance noise."""
    rows = []
    for y in range(height):
        row = bytearray(width * 3)
        cy = (y // cell) % 2
        for x in range(width):
            base = 255 if ((x // cell) % 2) ^ cy else 0
            v = clamp8(base + random.randint(-noise, noise))
            row[3 * x] = row[3 * x + 1] = row[3 * x + 2] = v
        rows.append(row)
    return rows


def make_text_pattern(width, height, noise=20):
    """White background with high-contrast text-like bars and dot details."""
    rows = [bytearray(b"\xff" * (width * 3)) for _ in range(height)]

    def fill_rect(x0, y0, w, h, v=0):
        for y in range(max(0, y0), min(height, y0 + h)):
            row = rows[y]
            for x in range(max(0, x0), min(width, x0 + w)):
                row[3 * x] = row[3 * x + 1] = row[3 * x + 2] = v

    def fill_circle(cx, cy, r, v=0):
        for y in range(cy - r, cy + r + 1):
            if 0 <= y < height:
                dx = int((r * r - (y - cy) ** 2) ** 0.5)
                fill_rect(cx - dx, y, 2 * dx + 1, 1, v)

    # Three blocks of "text lines": bars of varying length with word gaps.
    y = 24
    for _block in range(3):
        while y < height - 40:
            thickness = random.choice([6, 8, 10, 12])
            x = 24
            while x < width - 60:
                word = random.randint(40, 180)
                fill_rect(x, y, min(word, width - 24 - x), thickness)
                x += word + random.randint(12, 28)
            y += thickness + random.randint(8, 14)
        y += 36

    # Dot details (like punctuation) for extra local contrast.
    fill_circle(width - 60, height - 60, 14)
    fill_circle(60, height - 48, 8)
    fill_circle(width - 90, 60, 10)

    # Mild luminance noise keeps the pattern photo-like in texture.
    for row in rows:
        for i in range(0, len(row), 3):
            n = random.randint(-noise, noise)
            for c in range(3):
                row[i + c] = clamp8(row[i + c] + n)
    return rows


# ---------------------------------------------------------------------------
# Blur: box blur x3 (separable) — a standard Gaussian approximation
# ---------------------------------------------------------------------------

def blur_horizontal(rows, width, height, radius):
    out = []
    for row in rows:
        prefix = [[0] * (width + 1) for _ in range(3)]
        for x in range(width):
            for c in range(3):
                prefix[c][x + 1] = prefix[c][x] + row[3 * x + c]
        orow = bytearray(width * 3)
        for x in range(width):
            lo = max(0, x - radius)
            hi = min(width - 1, x + radius)
            n = hi - lo + 1
            for c in range(3):
                orow[3 * x + c] = (prefix[c][hi + 1] - prefix[c][lo]) // n
        out.append(orow)
    return out


def transpose(rows, width, height):
    out = [bytearray(height * 3) for _ in range(width)]
    for y in range(height):
        row = rows[y]
        for x in range(width):
            orow = out[x]
            orow[3 * y] = row[3 * x]
            orow[3 * y + 1] = row[3 * x + 1]
            orow[3 * y + 2] = row[3 * x + 2]
    return out


def gaussianish_blur(rows, width, height, radius=5, passes=3):
    """Three box-blur passes approximate a Gaussian (sigma ~ 5.5 px at r=5)."""
    for _ in range(passes):
        rows = blur_horizontal(rows, width, height, radius)
        rows = transpose(blur_horizontal(transpose(rows, width, height),
                                         height, width, radius),
                         height, width)
    return rows


# ---------------------------------------------------------------------------
# Invalid files
# ---------------------------------------------------------------------------

def write_invalid_fixtures():
    with open(os.path.join(HERE, "fixture-not-an-image.txt"), "w", encoding="ascii") as f:
        f.write("This file is deliberately not an image.\n"
                "The app must skip it with a visible counted message.\n")

    # Minimal ISO-BMFF 'ftyp' box carrying the HEIC brand, followed by junk and
    # no decodable image data: every browser must fail to decode it.
    payload = (b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00heicmif1"
               + b"\x00" * 256)
    with open(os.path.join(HERE, "fixture-fake.heic"), "wb") as f:
        f.write(payload)


# ---------------------------------------------------------------------------

def main():
    sharp_checker = make_checkerboard(SIZE, SIZE)
    sharp_text = make_text_pattern(SIZE, SIZE)

    encode_png(os.path.join(HERE, "fixture-sharp-checkerboard.png"), sharp_checker)
    encode_png(os.path.join(HERE, "fixture-sharp-text.png"), sharp_text)

    blurred_checker = gaussianish_blur([bytearray(r) for r in sharp_checker], SIZE, SIZE)
    blurred_text = gaussianish_blur([bytearray(r) for r in sharp_text], SIZE, SIZE)

    encode_png(os.path.join(HERE, "fixture-blurred-checkerboard.png"), blurred_checker)
    encode_png(os.path.join(HERE, "fixture-blurred-text.png"), blurred_text)

    write_invalid_fixtures()
    print("Fixtures written to", HERE)


if __name__ == "__main__":
    main()
