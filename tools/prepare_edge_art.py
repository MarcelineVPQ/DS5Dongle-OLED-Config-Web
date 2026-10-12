#!/usr/bin/env python3
"""Turn daidr's DualSense Edge art (dualsense-tester, MIT) into
src/assets/dualsense-edge.svg for the live controller view.

  python3 tools/prepare_edge_art.py [path/to/dualsenseEdge.svg]

Source: assets-src/edge/dualsenseEdge.svg, downloaded unchanged from
https://github.com/daidr/dualsense-tester/blob/HEAD/design/dualsenseEdge.svg
(MIT, Copyright (c) 2023 Xuezhou Dai (daidr); assets-src/edge/LICENSE,
copied to src/assets/DAIDR-LICENSE.txt next to the output).

The source is line art (black outlines over a white page, with orange
"Active_*" shapes the tester shows for pressed inputs). This script builds the
app's drawing from those same shapes:

- the body's regions (Framework's subpaths: grips, center, touchpad, light
  strips) become filled areas, the Active_* shapes become the button caps,
  triggers, sticks, Fn buttons and back paddles, and the source's outlines
  stay on top as lines
- Sony's marks are left out: the PlayStation logo (the PS button becomes a
  plain round button) and the touchpad's pattern of PlayStation shapes (the
  touchpad gets a fine dot texture of our own, an SVG pattern)
- the same theme classes as src/assets/dualsense.svg (see
  tools/prepare_controller_art.py), so colorways, custom colors and themes
  paint it:  .bd body  .dk dark plastic  .cap button caps  .stk sticks
  .ln outlines  .ln-dk outlines on the dark parts  .led lightbar;
  plus .ol (a stroked outline around a filled part), .gloss (the glossy
  center's highlight) and .tp-dot (the touchpad texture)
- every part the app needs is tagged with data-part="..." (fails if a source
  shape is missing), including the Edge's own fn-l, fn-r, paddle-l, paddle-r
- scaled to the standard drawing's units (its body width), so stick travel,
  touch dots and outline widths in the app match both drawings

The output is committed; rerun only when the source art or this script changes.
Standard library only.
"""
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "assets-src/edge/dualsenseEdge.svg"
OUT = ROOT / "src/assets/dualsense-edge.svg"
SVG = "{http://www.w3.org/2000/svg}"

# Source units -> output units: the Edge's body (Border, 1220 wide) as wide
# as the standard drawing's (its viewBox, 544.7).
K = 544.70661 / 1220.0
OX, OY = 14.0, 22.0  # top-left of the area kept (source units)
W, H = 1284.0, 984.0  # its size

# ---- SVG path data: parse to absolute segments, transform, write back ----
TOK = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
NARGS = {"m": 2, "l": 2, "h": 1, "v": 1, "c": 6, "s": 4, "q": 4, "t": 2, "a": 7, "z": 0}


def subpaths(d):
    """Absolute subpaths: lists of (CMD, [numbers]) with M/L/C/S/Q/T/A/Z only."""
    toks = TOK.findall(d)
    out, cur = [], None
    x = y = sx = sy = 0.0
    cmd, i = None, 0
    while i < len(toks):
        if toks[i].isalpha():
            cmd = toks[i]
            i += 1
            if cmd in "zZ":
                cur.append(("Z", []))
                x, y = sx, sy
                continue
        n = NARGS[cmd.lower()]
        a = [float(v) for v in toks[i : i + n]]
        i += n
        rel, lc = cmd.islower(), cmd.lower()
        if lc == "m":
            x, y = (x + a[0], y + a[1]) if rel else (a[0], a[1])
            sx, sy = x, y
            cur = [("M", [x, y])]
            out.append(cur)
            cmd = "l" if rel else "L"  # implicit lineto after moveto
        elif lc == "h":
            x = x + a[0] if rel else a[0]
            cur.append(("L", [x, y]))
        elif lc == "v":
            y = y + a[0] if rel else a[0]
            cur.append(("L", [x, y]))
        elif lc == "a":
            x, y = (x + a[5], y + a[6]) if rel else (a[5], a[6])
            cur.append(("A", a[:5] + [x, y]))
        else:
            pts = []
            for j in range(0, n, 2):
                pts += [x + a[j], y + a[j + 1]] if rel else [a[j], a[j + 1]]
            cur.append((cmd.upper(), pts))
            x, y = pts[-2], pts[-1]
    return out


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def tx(x):
    return (x - OX) * K


def ty(y):
    return (y - OY) * K


def write(subs):
    parts = []
    for sp in subs:
        for c, a in sp:
            if c == "A":
                b = [a[0] * K, a[1] * K, a[2], a[3], a[4], tx(a[5]), ty(a[6])]
            else:
                b = [tx(v) if j % 2 == 0 else ty(v) for j, v in enumerate(a)]
            parts.append(c + " ".join(fmt(v) for v in b))
    return "".join(parts)


def bbox(subs):
    xs = [a[j] for sp in subs for c, a in sp if c != "A" for j in range(0, len(a), 2)]
    ys = [a[j] for sp in subs for c, a in sp if c != "A" for j in range(1, len(a), 2)]
    return min(xs), min(ys), max(xs), max(ys)


# ---- source shapes by id ----
src = ET.parse(SRC).getroot()
by_id = {e.get("id"): e for e in src.iter() if e.get("id")}


def shape(id_, sub=None):
    """A source path's data (transformed); sub = only these subpath indices."""
    e = by_id.get(id_)
    if e is None or e.tag != f"{SVG}path":
        sys.exit(f"missing path in the source art: {id_}")
    subs = subpaths(e.get("d"))
    return write(subs if sub is None else [subs[i] for i in sub])


def group_paths(id_):
    e = by_id.get(id_)
    if e is None or e.tag != f"{SVG}g":
        sys.exit(f"missing group in the source art: {id_}")
    return [write(subpaths(p.get("d"))) for p in e.iter(f"{SVG}path")]


FRAMEWORK = subpaths(by_id["Framework"].get("d"))
if len(FRAMEWORK) != 22:
    sys.exit(f"Framework has {len(FRAMEWORK)} regions, expected 22: check the region map below")


def region(*idx):
    return write([FRAMEWORK[i] for i in idx])


def path(d, cls=None, **attrs):
    a = "".join(f' {k.replace("_", "-")}="{v}"' for k, v in attrs.items())
    c = f' class="{cls}"' if cls else ""
    return f'<path{c} d="{d}"{a}/>'


out = []
add = out.append

# ---- defs: trigger fills (as the standard drawing), gloss, touchpad texture ----
add("<defs>")
for side in ("l2", "r2"):
    add(
        f'<linearGradient id="ctl-{side}-fill" x1="0" y1="1" x2="0" y2="0">'
        '<stop offset="0" class="fill-on"/><stop offset="0" class="fill-on" data-edge="1"/>'
        '<stop offset="0" class="fill-off" data-edge="1"/><stop offset="1" class="fill-off"/></linearGradient>'
    )
# The glossy black center: a soft highlight from the top of the face down.
add(f'<linearGradient id="ctl-gloss" gradientUnits="userSpaceOnUse" x1="0" y1="{fmt(ty(470))}" x2="0" y2="{fmt(ty(780))}">' '<stop offset="0" class="gloss-hi"/><stop offset="1" class="gloss-lo"/></linearGradient>')
# The Edge's touchpad is textured: a fine dot grid (ours, not the source's
# pattern of PlayStation shapes).
add('<pattern id="ctl-tp-dots" patternUnits="userSpaceOnUse" width="3.2" height="3.2">' '<circle cx="1.6" cy="1.6" r="0.55" class="tp-dot"/></pattern>')
add("</defs>")

# ---- trigger-stop sliders on the sides (behind the body) ----
for side in ("LT", "RT"):
    paths = group_paths(f"{side}Adapter")
    housing = by_id[f"{side}Adapter"].find(f"{SVG}path")
    add(f'<g class="adapter">{path(write(subpaths(housing.get("d"))[-1:]), "dk")}')
    for d in paths:
        add(path(d, "ln ln-dk"))
    add(path(shape(f"Active_{side}AdapterNode"), "ln ln-dk"))
    add("</g>")

# ---- the shell: Framework's regions as filled areas ----
# Region map (Framework subpath index -> what it is), from the source art:
#   18 the shell (all but the center) 3, 0 left / right shell (shoulders to grips)
#    4, 1 inner sides of the grips    2 under the touchpad   21 the lower edge
#   11 touchpad   9, 13 light strips beside it   10, 12 the strip above it
#    5, 6 / 16, 17 the bumpers' housings   7, 8 / 14, 15 between bumper and touchpad
#   20, 19 the Fn buttons (drawn as parts below)
# Base: the whole outline (Border's outer edge) in the dark plastic: what no
# region covers is the Edge's glossy black center and lower body.
OUTLINE = shape("Border", [1])
add(path(OUTLINE, "dk"))
add(path(OUTLINE, "gloss"))
add(f'<g class="bd">{path(region(3, 0))}{path(region(10, 12, 7, 8, 14, 15))}</g>')
add(path(region(4, 1, 2, 21, 5, 6, 16, 17), "dk"))
add(path(region(11), "dk tp"))
add(path(region(11), "tp-tex"))
# Lightbar: the strips on both sides of the touchpad.
add('<g data-part="lightbar">' + "".join(f'<g class="led-glow">{path(region(i), "led")}</g>' for i in (9, 13)) + "</g>")
# The source's outlines (its region seams and the outer edge).
add(path(shape("Framework"), "ln"))
add(path(shape("Border"), "ln"))
# Stick wells.
add(path(shape("LSBorder"), "ln ln-dk"))
add(path(shape("RSBorder"), "ln ln-dk"))
for d in group_paths("Microphone"):
    add(path(d, "ln ln-dk"))

# ---- parts ----
# Note: the source names R1's shape "Active_L2" (it sits over R1).
add(f'<g data-part="l2">{path(shape("Active_LT"), "dk")}{path(shape("LT"), "ol")}</g>')
add(f'<g data-part="r2">{path(shape("Active_RT"), "dk")}{path(shape("RT"), "ol")}</g>')
add(f'<g data-part="l1">{path(shape("Active_L1"), "dk")}{path(shape("Active_L1"), "ol")}</g>')
add(f'<g data-part="r1">{path(shape("Active_L2"), "dk")}{path(shape("Active_L2"), "ol")}</g>')


def button(part, active, outline_group, line="ln"):
    add(f'<g data-part="{part}">{path(shape(active), "cap")}' + "".join(path(d, line) for d in group_paths(outline_group)) + "</g>")


button("dpad-up", "ActiveDPad", "DPadUp")
button("dpad-down", "ActiveDPad1", "DPadDown")
button("dpad-right", "ActiveDPad2", "DPadRight")
button("dpad-left", "ActiveDPad3", "DPadLeft")
button("triangle", "Active_Triangle", "Triangle")
button("circle", "Active_Circle", "Circle")
button("cross", "Active_Cross", "Cross")
button("square", "Active_Square", "Square")
button("create", "Active_Create", "Create")
button("options", "Active_Option", "Option")
button("mute", "Active_Mute", "Mute", "ln ln-dk")
add('<g data-part="speaker">' + "".join(path(d, "ln ln-dk") for d in group_paths("Speaker")) + "</g>")

# PS button: a plain round button where the source has the PlayStation logo
# (the logo is left out on purpose).
x0, y0, x1, y1 = bbox(subpaths(by_id["PS"].get("d")))
cx, cy, r = tx((x0 + x1) / 2), ty((y0 + y1) / 2), 21 * K
add(f'<g data-part="ps"><circle class="cap" cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"/><circle class="ol" cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}"/></g>')

# Sticks: the cap with a ring for its concave top.
for part, active in (("stick-l", "Active_LS"), ("stick-r", "Active_RS")):
    x0, y0, x1, y1 = bbox(subpaths(by_id[active].get("d")))
    cx, cy, r = tx((x0 + x1) / 2), ty((y0 + y1) / 2), (x1 - x0) / 2 * K
    add(f'<g data-part="{part}">{path(shape(active), "stk")}{path(shape(active), "ol")}' f'<circle class="ol" cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r * 0.7)}"/></g>')

# The Edge's own: Fn buttons under the sticks, back paddles.
for part, active, ridges in (("fn-l", "Active_LFn", "LFnPattern"), ("fn-r", "Active_RFn", "RFnPattern")):
    add(f'<g data-part="{part}">{path(shape(active), "dk")}{path(shape(active), "ol")}{path(shape(ridges), "ln ln-dk")}</g>')
for part, active, outline in (("paddle-l", "Active_LBack", "LBack"), ("paddle-r", "Active_RBack", "RBack")):
    add(f'<g data-part="{part}">{path(shape(active), "dk")}' + "".join(path(d, "ln") for d in group_paths(outline)) + "</g>")

# Touchpad: a transparent area on top makes it clickable and anchors touch
# dots; data-box is the surface the touch coordinates map onto.
x0, y0, x1, y1 = bbox([FRAMEWORK[11]])
box = (tx(x0 + 6), ty(y0 + 4), (x1 - x0 - 12) * K, (y1 - y0 - 8) * K)
add(path(shape("Touchpad"), "hit", data_part="touchpad", data_box=" ".join(fmt(v) for v in box)))

# Player indicator: five lights under the touchpad, centered.
mid, ly = tx(656.0), ty(468.5)
add('<g class="pled" data-part="player-leds">' + "".join(f'<rect data-led="{i}" x="{fmt(mid - 8 + (i - 2) * 17)}" y="{fmt(ly - 1.4)}" width="16" height="2.8" rx="1.4"/>' for i in range(5)) + "</g>")

found = set(re.findall(r'data-part="([\w-]+)"', "".join(out)))
need = {"l1", "l2", "r1", "r2", "lightbar", "touchpad", "create", "options", "dpad-up", "dpad-down", "dpad-left", "dpad-right", "triangle", "circle", "cross", "square", "stick-l", "stick-r", "ps", "mute", "speaker", "fn-l", "fn-r", "paddle-l", "paddle-r"}
if need - found:
    sys.exit(f"parts not drawn: {', '.join(sorted(need - found))}")

header = (
    "<!-- DualSense Edge art: from dualsense-tester by Xuezhou Dai (daidr) (MIT, (c) 2023 Xuezhou Dai), "
    "modified: Sony marks removed (PlayStation logo, touchpad pattern), regions filled, recolored by theme classes and tagged with data-part. "
    "Made by tools/prepare_edge_art.py; see src/assets/DAIDR-LICENSE.txt. -->\n"
)
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(W * K)} {fmt(H * K)}" data-model="edge">' + "".join(out) + "</svg>"
OUT.write_text(header + svg + "\n")
print(f"wrote {OUT} ({len(svg)} bytes), parts: {len(found)}")
