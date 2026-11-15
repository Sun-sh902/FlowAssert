#!/usr/bin/env python3
"""Checks the layout the app actually draws, from the frames LayoutMeasureTests prints (lines starting FA-LAYOUT).

For each screen it reports:
  - off the pixel grid: an element that draws an edge (an image, a switch, a segmented control, a text field, a list
    cell) with an edge between two device pixels, or text and buttons whose leading edge is. The vertical position of
    text comes from its font's metrics and a button's frame is its tap area, so neither is held to the grid vertically;
  - inside the margin: text or a control closer than 16 points to the left or right edge of the window;
  - near misses: leading edges of text and controls that differ by more than half a point and less than 3 points,
    which reads as a mistake rather than as a deliberate indent. Only leaves are compared, what is actually drawn: a
    row's label groups its icon, which the system centres in an icon column, with its title. The floating tab bar
    and Check button are left out: they are not aligned with the page's content.
Findings listed in ACCEPTED were looked at on the screenshots and are the system's own layout; they are printed as
accepted and not counted. Usage: measure_layout.py LOG [LOG...]. Exits 1 when anything else is reported.
"""
import json
import sys

STATIC_TEXT, BUTTON, IMAGE, SWITCH, SEGMENTED, TEXT_FIELD, SECURE_FIELD, CELL = 48, 9, 43, 40, 37, 49, 50, 75
TEXTLIKE = {STATIC_TEXT, BUTTON, TEXT_FIELD, SECURE_FIELD, SEGMENTED, SWITCH}
DRAWN = TEXTLIKE | {IMAGE, CELL}
NAMES = {STATIC_TEXT: "text", BUTTON: "button", IMAGE: "image", SWITCH: "switch", SEGMENTED: "segmented",
         TEXT_FIELD: "field", SECURE_FIELD: "secure field", CELL: "cell"}
MARGIN = 16.0

# A row's label is one accessibility element holding its icon and its title. The system centres each symbol in a
# fixed icon column, so a narrow icon (square.and.arrow.up) starts later than a wide one (folder, doc.badge.plus);
# the titles start at the same x (measured on the screenshots: 76 points on the iPhone).
ICON_COLUMN = "the system centres row icons in an icon column; the titles line up"
ACCEPTED = {
    frozenset({"Save to Files", "Share the JSON report"}): ICON_COLUMN,
    frozenset({"Save to Files", "Share the HTML report"}): ICON_COLUMN,
    frozenset({"Choose a file", "A file"}): ICON_COLUMN,
    frozenset({"Choose a file", "source-kind"}): ICON_COLUMN,
    frozenset({"Choose a file", "destination-kind"}): ICON_COLUMN,
}


def describe(e):
    name = e["id"] or e["label"] or "?"
    return f'{NAMES.get(e["type"], e["type"])} "{name}" at x {e["x"]:g}, y {e["y"]:g}, {e["w"]:g}×{e["h"]:g}'


def on_screen(e, screen):
    return e["y"] >= 60 and e["y"] + e["h"] <= screen["height"] - 20 and e["x"] >= 0 and e["x"] + e["w"] <= screen["width"]


def off_grid(e, scale):
    edges = (e["x"],) if e["type"] in (STATIC_TEXT, BUTTON) else (e["x"], e["y"], e["x"] + e["w"], e["y"] + e["h"])
    return any(abs(v * scale - round(v * scale)) > 0.02 for v in edges)


def floating(e, screen):
    return e["y"] + e["h"] > screen["height"] - 100


def check(screen):
    scale, width = screen["scale"], screen["width"]
    elements = [e for e in screen["elements"] if e["type"] in DRAWN and on_screen(e, screen) and e["w"] > 0 and e["h"] > 0]
    problems, accepted = [], []
    seen = set()
    for e in elements:
        key = (e["type"], e["id"], e["label"], e["x"], e["y"], e["w"], e["h"])
        if key in seen:
            continue
        seen.add(key)
        if off_grid(e, scale):
            problems.append(("off the pixel grid", describe(e)))
        # Full-width containers (cells, the window's own children) have no margin of their own.
        if e["type"] in TEXTLIKE and e["w"] < width - 2 * MARGIN + 1:
            if e["x"] < MARGIN - 0.01 or e["x"] + e["w"] > width - MARGIN + 0.01:
                problems.append(("inside the margin", describe(e)))
    edges = {}
    for e in elements:
        if e["type"] in TEXTLIKE and e.get("leaf", True) and not floating(e, screen):
            edges.setdefault(round(e["x"] * scale) / scale, []).append(e)
    xs = sorted(edges)
    for a, b in zip(xs, xs[1:]):
        if 0.5 < b - a < 3:
            names = frozenset({edges[a][0]["id"] or edges[a][0]["label"], edges[b][0]["id"] or edges[b][0]["label"]})
            text = f"leading edges {a:g} and {b:g}: {describe(edges[a][0])} / {describe(edges[b][0])}"
            if names in ACCEPTED:
                accepted.append(("accepted near miss", f"{text} ({ACCEPTED[names]})"))
            else:
                problems.append(("near miss", text))
    return problems, accepted


def main(paths):
    screens = []
    for path in paths:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                at = line.find("FA-LAYOUT ")
                if at >= 0:
                    screens.append(json.loads(line[at + len("FA-LAYOUT "):]))
    if not screens:
        print("no FA-LAYOUT lines found")
        return 2
    total = 0
    for screen in screens:
        problems, accepted = check(screen)
        total += len(problems)
        device = f'{screen["width"]:g}×{screen["height"]:g} @{screen["scale"]:g}x'
        print(f'{screen["screen"]} ({device}): {len(problems) or "nothing to report"}')
        for kind, text in problems + accepted:
            print(f"  {kind}: {text}")
    print(f"{len(screens)} screens, {total} findings")
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
