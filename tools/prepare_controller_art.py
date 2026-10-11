#!/usr/bin/env python3
"""Turn AL2009man's DualSense art (Gamepad-Asset-Pack, MIT) into
src/assets/dualsense.svg for the live controller view.

  python3 tools/prepare_controller_art.py [path/to/DualSense VSCView SVG.svg]

- keeps the drawing, drops Inkscape/Sodipodi metadata and hidden layers
- tags every part the app needs with data-part="..." (fails if one is missing)
- replaces the fixed colors with classes, so the app's theme colors it:
    .ln outline/text/symbols   .cap button caps   .bd body
    .dk dark plastic (triggers, bumpers, center)  .stk stick caps   .led lightbar
The output is committed; rerun only when the source art changes.
"""
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "projects/Gamepad-Asset-Pack/Controller Asset Pack/DualSense Controller Image/Default/Theme SVG/DualSense VSCView SVG.svg")
OUT = Path(__file__).resolve().parent.parent / "src/assets/dualsense.svg"

SVG = "http://www.w3.org/2000/svg"
INK = "http://www.inkscape.org/namespaces/inkscape"
LABEL = f"{{{INK}}}label"
ET.register_namespace("", SVG)
ET.register_namespace("xlink", "http://www.w3.org/1999/xlink")

# Inkscape layer label (with its parent label when ambiguous) -> data-part
PARTS = {
    ("R2 Trigger",): "r2", ("L2 Triggers",): "l2", ("R1",): "r1", ("L1",): "l1",
    ("LED", "Controlelr Body V2"): "lightbar",
    ("Right Stick",): "stick-r", ("Left Stick",): "stick-l",
    ("Mute",): "mute", ("Create Button",): "create", ("Option Button",): "options",
    ("Triangle ",): "triangle", ("Square",): "square", ("Crosss",): "cross", ("Circle",): "circle",
    ("D-PAD Up",): "dpad-up", ("D-PAD Down",): "dpad-down", ("D-PAD Left",): "dpad-left", ("D-PAD Right",): "dpad-right",
    ("Speakers",): "speaker", ("PS Button",): "ps",
}
FILL_CLASS = {"#707373": "ln", "#e1e3e6": "cap", "#ebeef0": "bd", "#171b20": "dk", "#17191e": "dk", "#333333": "stk", "#b8babc": "cap"}

tree = ET.parse(SRC)
root = tree.getroot()
parent = {c: p for p in root.iter() for c in p}


def label_path(e):
    out = []
    while e is not None:
        if e.get(LABEL):
            out.append(e.get(LABEL))
        e = parent.get(e)
    return out  # self first


# Label paths are taken before anything is changed (labels are removed below).
paths = {e: label_path(e) for e in root.iter()}

found = {}
for e in list(root.iter()):
    style = e.get("style", "")
    # Drop hidden layers (unused variants, color blends).
    if "display:none" in style and e in parent:
        parent[e].remove(e)
        continue
    labels = paths[e]
    for key, part in PARTS.items():
        if e.get(LABEL) == key[0] and (len(key) == 1 or (len(labels) > 1 and labels[1] == key[1])):
            e.set("data-part", part)
            found[part] = True
    m = re.search(r"fill:(#[0-9a-fA-F]{6})", style)
    if m and m.group(1).lower() in FILL_CLASS:
        e.set("class", (e.get("class", "") + " " + FILL_CLASS[m.group(1).lower()]).strip())
        style = re.sub(r"fill:#[0-9a-fA-F]{6};?", "", style)
    if "url(#linearGradient" in style and labels and labels[0] == "With LED":
        e.set("class", "led")
        style = re.sub(r"fill:url\([^)]*\);?", "", style)
    style = re.sub(r"-inkscape-[\w-]+:[^;]*;?", "", style).strip(";")
    if style:
        e.set("style", style)
    elif "style" in e.attrib:
        del e.attrib["style"]
    for attr in list(e.attrib):
        if attr.startswith(f"{{{INK}}}") or "sodipodi" in attr:
            del e.attrib[attr]

for e in list(root):
    tag = e.tag.split("}")[1]
    if tag in ("metadata", "namedview") or "sodipodi" in e.tag:
        root.remove(e)

missing = sorted(set(PARTS.values()) - set(found))
if missing:
    sys.exit(f"missing parts in the source art: {', '.join(missing)}")

# Touchpad: no layer of its own; its surface measured from the art (viewBox
# units). A transparent area on top makes it clickable and anchors touch dots.
# Its outline was traced from the rendered art (slanted sides, rounded
# bottom corners); data-box is the surface the touch coordinates map onto.
TOUCHPAD = (166.2, 59.2, 212.3, 113.8)  # x, y, width, height
TOUCHPAD_OUTLINE = "M222.5,60.0 L185.2,62.0 L173.5,64.0 L169.0,66.0 L166.0,68.0 L164.0,70.0 L162.5,72.0 L161.2,74.0 L160.5,76.0 L159.7,78.0 L159.2,80.0 L159.2,82.0 L159.0,84.0 L159.2,86.0 L159.2,88.0 L159.7,90.0 L160.0,92.0 L160.5,94.0 L161.2,96.0 L161.7,98.0 L162.2,100.0 L162.7,102.0 L163.2,104.0 L163.7,106.0 L164.2,108.0 L164.7,110.0 L165.2,112.0 L165.7,114.0 L166.2,116.0 L166.7,118.0 L167.2,120.0 L168.0,122.0 L168.5,124.0 L169.0,126.0 L169.5,128.0 L170.0,130.0 L170.5,132.0 L171.0,134.0 L171.5,136.0 L172.0,138.0 L172.5,140.0 L173.0,142.0 L173.5,144.0 L174.2,146.0 L174.7,148.0 L175.2,150.0 L175.7,152.0 L176.2,154.0 L177.0,156.0 L177.7,158.0 L178.7,160.0 L180.0,162.0 L181.7,164.0 L183.7,166.0 L186.2,168.0 L189.5,170.0 L195.0,172.0 L341.2,173.0 L350.7,171.0 L355.5,169.0 L358.7,167.0 L361.2,165.0 L363.2,163.0 L364.7,161.0 L366.0,159.0 L367.2,157.0 L368.0,155.0 L368.5,153.0 L369.2,151.0 L369.7,149.0 L370.2,147.0 L370.7,145.0 L371.2,143.0 L371.7,141.0 L372.2,139.0 L372.7,137.0 L373.5,135.0 L374.0,133.0 L374.5,131.0 L375.0,129.0 L375.5,127.0 L376.0,125.0 L376.5,123.0 L377.0,121.0 L377.5,119.0 L378.2,117.0 L378.7,115.0 L379.2,113.0 L379.7,111.0 L380.2,109.0 L380.7,107.0 L381.2,105.0 L381.7,103.0 L382.2,101.0 L383.0,99.0 L383.5,97.0 L384.0,95.0 L384.5,93.0 L385.0,91.0 L385.5,89.0 L385.7,87.0 L385.7,85.0 L385.7,83.0 L385.7,81.0 L385.2,79.0 L384.7,77.0 L384.0,75.0 L383.0,73.0 L381.7,71.0 L380.0,69.0 L377.5,67.0 L374.0,65.0 L367.5,63.0 L346.2,61.0 Z"
ET.SubElement(root, f"{{{SVG}}}path", {"data-part": "touchpad", "class": "hit", "d": TOUCHPAD_OUTLINE, "data-box": " ".join(map(str, TOUCHPAD))})

# Analog trigger fill: a bottom-to-top gradient per trigger; the app moves the
# hard stop with the pull (0..1) and colors it with the theme.
defs = root.find(f"{{{SVG}}}defs")
if defs is None:
    defs = ET.SubElement(root, f"{{{SVG}}}defs")
for side in ("l2", "r2"):
    g = ET.SubElement(defs, f"{{{SVG}}}linearGradient", {"id": f"ctl-{side}-fill", "x1": "0", "y1": "1", "x2": "0", "y2": "0"})
    ET.SubElement(g, f"{{{SVG}}}stop", {"offset": "0", "class": "fill-on"})
    ET.SubElement(g, f"{{{SVG}}}stop", {"offset": "0", "class": "fill-on", "data-edge": "1"})
    ET.SubElement(g, f"{{{SVG}}}stop", {"offset": "0", "class": "fill-off", "data-edge": "1"})
    ET.SubElement(g, f"{{{SVG}}}stop", {"offset": "1", "class": "fill-off"})

# Lightbar like the real controller: the color fills both sides and the
# bottom corners; the bottom edge under the touchpad is a thin silver-white
# light strip, where the player indicator glows white.
import copy
clip = ET.SubElement(defs, f"{{{SVG}}}clipPath", {"id": "ctl-led-clip", "clipPathUnits": "userSpaceOnUse"})
ET.SubElement(clip, f"{{{SVG}}}path", {"d": "M150,70 H395 V184 H350 V163 H195 V184 H150 Z"})
edge_clip = ET.SubElement(defs, f"{{{SVG}}}clipPath", {"id": "ctl-led-edge-clip", "clipPathUnits": "userSpaceOnUse"})
ET.SubElement(edge_clip, f"{{{SVG}}}path", {"d": "M195,163 H350 V184 H195 Z"})
for e in list(root.iter()):
    if e.get("class") == "led":
        e.set("clip-path", "url(#ctl-led-clip)")
        edge = copy.deepcopy(e)
        edge.set("class", "led-edge")
        edge.set("clip-path", "url(#ctl-led-edge-clip)")
        edge.attrib.pop("id", None)
        parent[e].append(edge)

# Player indicator: five lights in the bottom strip, centered (player 1 = the
# middle one). Unlit ones are invisible, like on the controller.
pled = ET.SubElement(root, f"{{{SVG}}}g", {"class": "pled", "data-part": "player-leds"})
for i in range(5):
    ET.SubElement(pled, f"{{{SVG}}}rect", {"data-led": str(i), "x": f"{272.35 - 8 + (i - 2) * 17:.2f}", "y": "175.2", "width": "16", "height": "2.8", "rx": "1.4"})

for attr in ("width", "height"):
    root.attrib.pop(attr, None)  # sized by CSS; the viewBox stays
text = ET.tostring(root, encoding="unicode")
header = "<!-- DualSense art: AL2009man, Gamepad-Asset-Pack (MIT, (c) 2024 Al. Lopez), modified: recolored by theme classes and tagged with data-part. See src/assets/AL2009MAN-LICENSE.txt. -->\n"
OUT.write_text(header + text + "\n")
print(f"wrote {OUT} ({len(text)} bytes), parts: {len(found)}")
