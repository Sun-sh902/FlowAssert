"""Python oracle corpus for the browser canonicalizer (P2-AUD-002).

    .phase3a-runtime/FlowAssert-Phase3A-Service/.venv/bin/python -I -B scripts/phase3a/canonical_corpus.py

Generates src/test/fixtures/phase3a/canonical-corpus.json with a fixed seed. Each case holds:
  text       the value as the Service would send it (Starlette JSONResponse: ensure_ascii=False,
             separators=(",", ":")), or — for lone-surrogate cases, which UTF-8 cannot carry — ensure_ascii=True;
  canonical  the accepted Service canonical bytes (app/identity.py: sort_keys, compact, ensure_ascii, allow_nan=False);
  sha256     SHA-256 of those bytes.
Categories cover BMP / astral / mixed U+E000–U+FFFF+astral keys, every control character, DEL, quotes,
backslashes, astral strings, lone surrogates, small and huge integers, -0, random finite doubles drawn
from raw bit patterns (subnormals included), exponent boundaries, integral floats, nesting, empty
containers, null and booleans. The corpus is generated from Python, never from the UI under test.
"""
import hashlib, json, math, os, random, struct

UI = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(UI, "src/test/fixtures/phase3a/canonical-corpus.json")
rng = random.Random(20261018)


def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def wire(v, ascii_only=False):
    return json.dumps(v, ensure_ascii=ascii_only, allow_nan=False, indent=None, separators=(",", ":"))


BMP = [chr(c) for c in list(range(0x20, 0x7f)) + [0xe9, 0x4e2d, 0x3042, 0x20ac, 0xd7ff, 0xfeff]]
HIGH_BMP = [chr(c) for c in (0xe000, 0xe123, 0xf8ff, 0xfb01, 0xfe0f, 0xfffd, 0xffff)]
ASTRAL = [chr(c) for c in (0x10000, 0x1f600, 0x1f4a9, 0x1d11e, 0x20000, 0x10ffff)]
CONTROL = [chr(c) for c in list(range(0x00, 0x20)) + [0x7f, 0x80, 0x9f]]


def rstr(pool, n=None):
    n = rng.randint(0, 6) if n is None else n
    return "".join(rng.choice(pool) for _ in range(n))


def rfloat():
    while True:
        x = struct.unpack("<d", struct.pack("<Q", rng.getrandbits(64)))[0]
        if math.isfinite(x):
            return x


SPECIAL_FLOATS = [0.0, -0.0, 1.0, -1.0, 0.5, 0.1, 1.5, 2.0, 100.0, 1e-4, 1e-5, 0.00012345, 1.2345e-5, 1e15, 1e16, 9999999999999998.0,
                  12345678901234567.0, 1.7976931348623157e308, 5e-324, 2.2250738585072014e-308, 123.456, 1e22, 1e23, 3.141592653589793,
                  2.718281828459045, 0.30000000000000004, 1e-7, 4.35, 0.07, 1e100, -2.5e-310]
INTS = [0, 1, -1, 42, 2**31, 2**53 - 1, 2**53, 2**53 + 1, 2**63, -(2**63), 10**30, -(10**25) - 7]


def rvalue(depth=0, keys=BMP + ASTRAL + HIGH_BMP):
    kind = rng.choice(["str", "int", "float", "null", "bool", "arr", "obj"] if depth < 4 else ["str", "int", "float", "null", "bool"])
    if kind == "str":
        return rstr(BMP + ASTRAL + HIGH_BMP + CONTROL + ['"', "\\", "/"])
    if kind == "int":
        return rng.choice(INTS + [rng.randint(-10**6, 10**6), rng.randint(-2**80, 2**80)])
    if kind == "float":
        return rng.choice(SPECIAL_FLOATS + [rfloat(), rfloat(), rng.uniform(-1e6, 1e6)])
    if kind == "null":
        return None
    if kind == "bool":
        return rng.random() < 0.5
    if kind == "arr":
        return [rvalue(depth + 1, keys) for _ in range(rng.randint(0, 4))]
    return {rstr(keys, rng.randint(0, 4)): rvalue(depth + 1, keys) for _ in range(rng.randint(0, 5))}


cases = []


def add(category, v, ascii_only=False):
    c = canonical(v)
    cases.append({"category": category, "text": wire(v, ascii_only), "canonical": c, "sha256": hashlib.sha256(c.encode("ascii")).hexdigest()})


for x in SPECIAL_FLOATS:
    add("float-special", {"x": x})
for _ in range(600):
    add("float-random-bits", [rfloat()])
for _ in range(200):
    add("float-uniform", {"v": rng.uniform(-1e6, 1e6), "w": rng.uniform(-1, 1)})
for n in INTS:
    add("int", {"n": n})
for _ in range(300):
    add("mixed-astral-high-bmp-keys", {rstr(ASTRAL + HIGH_BMP, rng.randint(1, 3)): i for i in range(rng.randint(2, 6))})
add("utf16-vs-codepoint", {"￿": 2, "\U0001f600": 1})
add("utf16-vs-codepoint", {"": "a", "\U00010000": "b", "z": "c"})
for _ in range(300):
    add("bmp-keys", {rstr(BMP, rng.randint(0, 5)): rvalue(2) for _ in range(rng.randint(1, 5))})
for c in CONTROL:
    add("control-char", {"s": "a" + c + "b"})
add("quotes-backslash", {"q": '"', "b": "\\", "s": "/", "mix": 'a"b\\c/d'})
add("astral-string", {"s": "\U0001f600\U0001d11e\U0010ffff"})
add("lone-surrogate", {"s": "\ud800", "t": "x\udfffy", "\udbff": 1}, ascii_only=True)
add("empty", {})
add("empty", [])
add("empty", {"a": {}, "b": [], "c": [{}], "d": ""})
add("scalars", [None, True, False, 0, -0, "", 0.0])
for _ in range(400):
    add("nested-random", rvalue())

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump({"generator": "scripts/phase3a/canonical_corpus.py", "seed": 20261018, "python": __import__("sys").version, "rule": "json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)", "cases": cases}, f, ensure_ascii=True)
print(len(cases), "cases ->", OUT)
