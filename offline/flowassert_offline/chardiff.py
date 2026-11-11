"""Where two values differ, character by character: the highlighting of the HTML report.

A display aid: the rule's result is the conclusion, and nothing here changes or adds to it. The browser draws the same
highlighting with ui/src/offline/chardiff.ts, which this module mirrors line for line, so that both write the same HTML
bytes. The alignment is by code point: the common prefix and suffix, and between them a longest common subsequence
with fixed tie-breaking (a deletion before an insertion). Characters that cannot be seen are drawn as tokens chosen
from fixed lists, never from Unicode properties, so every Python version draws a value the same way.
"""

# The most cells of alignment table the middles may need; beyond it they are shown as replaced.
MAX_CELLS = 65536

# The visible token of a character that cannot be seen.
TOKENS = {
    0x20: "·",
    0x09: "→",
    0x0A: "↵",
    0x0D: "␍",
    0xA0: "NBSP",
    0x200B: "ZWSP",
    0x200C: "ZWNJ",
    0x200D: "ZWJ",
    0xFEFF: "BOM",
    0x2060: "WJ",
    0xAD: "SHY",
}

# Characters with no glyph of their own, beyond those with a token: shown by their code point. The C0 and C1
# controls, the spaces other than U+0020, and the format characters of bidirectional text, invisible operators and tags.
INVISIBLE = (
    (0x00, 0x1F), (0x7F, 0x9F), (0x61C, 0x61C), (0x1680, 0x1680), (0x180E, 0x180E), (0x2000, 0x200A),
    (0x200E, 0x200F), (0x2028, 0x202F), (0x205F, 0x205F), (0x2061, 0x2064), (0x2066, 0x206F), (0x3000, 0x3000),
    (0xFFF9, 0xFFFB), (0xE0001, 0xE0001), (0xE0020, 0xE007F),
)

# The blocks of combining diacritical marks: drawn on a dotted circle when listed alone.
COMBINING = ((0x300, 0x36F), (0x1AB0, 0x1AFF), (0x1DC0, 0x1DFF), (0x20D0, 0x20FF), (0xFE20, 0xFE2F))


def _within(ranges, cp):
    return any(lo <= cp <= hi for lo, hi in ranges)


def _runs(parts):
    runs = []
    for kind, ch in parts:
        if runs and runs[-1][0] == kind:
            runs[-1][1] += ch
        else:
            runs.append([kind, ch])
    return [(kind, text) for kind, text in runs]


def align(a, b):
    """(source runs, destination runs, too_long): runs of ("same" | "deleted" | "inserted", text)."""
    x = list(a)
    y = list(b)
    prefix = 0
    while prefix < len(x) and prefix < len(y) and x[prefix] == y[prefix]:
        prefix += 1
    suffix = 0
    while suffix < len(x) - prefix and suffix < len(y) - prefix and x[len(x) - 1 - suffix] == y[len(y) - 1 - suffix]:
        suffix += 1
    m = x[prefix:len(x) - suffix]
    n = y[prefix:len(y) - suffix]
    source = [("same", c) for c in x[:prefix]]
    destination = [("same", c) for c in y[:prefix]]
    too_long = (len(m) + 1) * (len(n) + 1) > MAX_CELLS
    if too_long:
        source += [("deleted", c) for c in m]
        destination += [("inserted", c) for c in n]
    else:
        # lcs[i][j]: the length of a longest common subsequence of m[i:] and n[j:].
        w = len(n) + 1
        lcs = [0] * ((len(m) + 1) * w)
        for i in range(len(m) - 1, -1, -1):
            for j in range(len(n) - 1, -1, -1):
                if m[i] == n[j]:
                    lcs[i * w + j] = lcs[(i + 1) * w + j + 1] + 1
                else:
                    lcs[i * w + j] = max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
        i = j = 0
        while i < len(m) or j < len(n):
            if i < len(m) and j < len(n) and m[i] == n[j]:
                source.append(("same", m[i]))
                destination.append(("same", n[j]))
                i += 1
                j += 1
            elif j == len(n) or (i < len(m) and lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]):
                source.append(("deleted", m[i]))
                i += 1
            else:
                destination.append(("inserted", n[j]))
                j += 1
    source += [("same", c) for c in x[len(x) - suffix:]]
    destination += [("same", c) for c in y[len(y) - suffix:]]
    return _runs(source), _runs(destination), too_long


def code_point(ch):
    return "U+%04X" % ord(ch)


def token(ch):
    """A character as the diff draws it: its token when it cannot be seen, or None for one that can."""
    known = TOKENS.get(ord(ch))
    if known is not None:
        return known
    return code_point(ch) if _within(INVISIBLE, ord(ch)) else None


def pieces(text, highlighted, start=False, end=False):
    """A value as drawn: (text, None) for characters as they are, (token, ch) for one invisible character.

    A character with a token is drawn as its token in a highlighted run and at the start and the end of the value;
    elsewhere a space stays a space, and every other invisible character is still drawn as its token.
    """
    chars = list(text)
    lead = 0
    while start and lead < len(chars) and token(chars[lead]) is not None:
        lead += 1
    trail = len(chars)
    while end and trail > lead and token(chars[trail - 1]) is not None:
        trail -= 1
    out = []
    for i, ch in enumerate(chars):
        t = token(ch)
        if t is not None and (highlighted or i < lead or i >= trail or t != "·"):
            out.append((t, ch))
        elif out and out[-1][1] is None:
            out[-1] = (out[-1][0] + ch, None)
        else:
            out.append((ch, None))
    return out


def code_points(runs):
    """Characters that differ and are not ASCII, with their code points."""
    seen = []
    for kind, text in runs:
        if kind == "same":
            continue
        for ch in text:
            cp = ord(ch)
            if cp < 0x80 or cp in TOKENS:
                continue
            shown = "◌" + ch if _within(COMBINING, cp) else "" if _within(INVISIBLE, cp) else ch
            line = (shown + " " if shown else "") + code_point(ch)
            if line not in seen:
                seen.append(line)
    return seen
