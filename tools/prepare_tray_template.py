#!/usr/bin/env python3
"""The macOS menu-bar icon's start-up image: resources/trayTemplate.png and
trayTemplate@2x.png, the tray art (src/desktop/tray/controller-solid.png,
Zacksly "PS5 Button Icons and Controls", CC BY 3.0) as a template image:
black with alpha, which macOS tints for a light or dark menu bar.

  python3 tools/prepare_tray_template.py

It is placed like the renderer's tray icon (src/desktop/tray/trayIcon.ts:
94% wide, low, leaving the top right for the status mark), with no status
mark: it shows only until the renderer draws the live icon. The output is
committed; rerun only when the art changes.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = Image.open(ROOT / "src/desktop/tray/controller-solid.png").convert("RGBA")

for size, name in ((22, "trayTemplate.png"), (44, "trayTemplate@2x.png")):
    cw = round(size * 0.94)
    ch = round(ART.height * cw / ART.width)
    oy = round(size - ch - size / 24)
    alpha = ART.resize((cw, ch), Image.LANCZOS).getchannel("A")
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(Image.new("RGBA", (cw, ch), (0, 0, 0, 255)), (0, oy), alpha)
    # The touchpad cut out (TOUCHPAD in trayIcon.ts), so it reads as a DualSense.
    pad = Image.new("L", (size * 4, size * 4), 0)
    x0, y0 = (0.3 * cw + cw * 0.012) * 4, (oy + 0.035 * ch) * 4
    x1, y1 = (0.7 * cw - cw * 0.012) * 4, (oy + 0.3 * ch) * 4
    ImageDraw.Draw(pad).rounded_rectangle((x0, y0, x1, y1), radius=size * 0.03 * 4, fill=255)
    pad = pad.resize((size, size), Image.LANCZOS)
    out.putalpha(Image.composite(Image.new("L", out.size, 0), out.getchannel("A"), pad))
    out.save(ROOT / "resources" / name, optimize=True)
    print(f"resources/{name}: {size} x {size}")
