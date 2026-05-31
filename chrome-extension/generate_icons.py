"""
Run once to generate placeholder PNG icons for the extension.
Requires: pip install Pillow
"""

import os
from PIL import Image, ImageDraw, ImageFont

SIZES = [16, 48, 128]
OUT_DIR = os.path.join(os.path.dirname(__file__), 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

for size in SIZES:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Rounded background
    padding = max(1, size // 10)
    draw.rounded_rectangle(
        [padding, padding, size - padding, size - padding],
        radius=max(2, size // 6),
        fill=(15, 22, 41, 255),     # dark navy
    )

    # Blue accent band at top
    band_h = max(2, size // 8)
    draw.rounded_rectangle(
        [padding, padding, size - padding, padding + band_h],
        radius=max(2, size // 6),
        fill=(79, 127, 255, 255),
    )

    # Letter "T" centered — only legible at 48+ px
    if size >= 48:
        font_size = size // 3
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
        text = "T"
        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (size - tw) // 2
        y = (size - th) // 2 + 2
        draw.text((x, y), text, fill=(201, 184, 255, 255), font=font)
    else:
        # Just a small dot for 16px
        cx = size // 2
        cy = size // 2 + 2
        r = max(2, size // 6)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(79, 127, 255, 255))

    path = os.path.join(OUT_DIR, f'icon{size}.png')
    img.save(path)
    print(f'  Saved {path}')

print('Done. Icons are in the icons/ folder.')
