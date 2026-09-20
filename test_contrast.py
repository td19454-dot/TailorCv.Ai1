"""Port of the JS contrast helpers in editor_v2.js, checked against WCAG.

Guards the rule the templates kept breaking: text placed on a coloured
surface must never be the accent itself, and must clear 4.5:1.
Run: python test_contrast.py
"""


def parse(c):
    c = c.strip()
    if c.startswith("#"):
        h = c[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        return [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]
    raise ValueError(c)


def lum(rgb):
    f = []
    for v in rgb:
        x = min(255, max(0, v)) / 255
        f.append(x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4)
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


WHITE = [255, 255, 255]
DARK = [31, 41, 55]


def to_hex(rgb):
    return "#" + "".join(f"{round(min(255, max(0, v))):02x}" for v in rgb)


def ink_on(bg):
    rgb = parse(bg)
    use_white = ratio(rgb, WHITE) >= ratio(rgb, DARK)
    ink = list(WHITE) if use_white else list(DARK)
    guard = 0
    while ratio(rgb, ink) < 4.5 and guard < 32:
        ink = ([min(255, v + 8) for v in ink] if use_white
               else [max(0, v - 8) for v in ink])
        guard += 1
        if use_white and all(v >= 255 for v in ink):
            break
        if not use_white and all(v <= 0 for v in ink):
            break
    return to_hex(ink)


def accent_on_paper(accent):
    rgb = parse(accent)
    guard = 0
    while ratio(rgb, WHITE) < 4.5 and guard < 24:
        rgb = [max(0, v * 0.88) for v in rgb]
        guard += 1
    return "#" + "".join(f"{round(v):02x}" for v in rgb)


ACCENTS = {
    "black": "#000000", "blue": "#2563eb", "purple": "#7c3aed",
    "coral": "#fb7185", "orange": "#f97316", "teal": "#14b8a6",
    "red": "#dc2626",
    # deliberately nasty: very light accents that used to ship unreadable
    "pale yellow": "#fde047", "mint": "#a7f3d0", "white-ish": "#f8fafc",
    # template 7 / 8 defaults
    "t7 sidebar": "#3d66a8", "t8 accent": "#2f9b95",
}

tests = []


def test_ink_on_surface_is_readable():
    """Text on a coloured surface must clear 4.5:1 against that surface."""
    bad = []
    for name, col in ACCENTS.items():
        ink = ink_on(col)
        r = ratio(parse(col), parse(ink))
        if r < 4.5:
            bad.append(f"{name} {col}: ink {ink} ratio {r:.2f}")
    assert not bad, "unreadable ink on surface:\n  " + "\n  ".join(bad)


def test_accent_text_on_paper_is_readable():
    """Accent used as heading text on white paper must clear 4.5:1."""
    bad = []
    for name, col in ACCENTS.items():
        safe = accent_on_paper(col)
        r = ratio(parse(safe), WHITE)
        if r < 4.5:
            bad.append(f"{name} {col} -> {safe} ratio {r:.2f}")
    assert not bad, "unreadable accent text on paper:\n  " + "\n  ".join(bad)


def test_blue_on_blue_regression():
    """The reported bug: blue accent on template 7's blue name card."""
    card = "#3d66a8"
    ink = ink_on(card)
    # Must be a LIGHT ink (not the blue accent) and genuinely readable.
    assert lum(parse(ink)) > 0.5, f"expected light ink on blue card, got {ink}"
    assert ratio(parse(card), parse(ink)) >= 4.5


def test_chip_ink_flips_for_light_accents():
    """A pale accent fill must get dark text, not white."""
    assert lum(parse(ink_on("#fde047"))) < 0.3, "pale yellow chip needs dark text"
    assert lum(parse(ink_on("#2563eb"))) > 0.5, "blue chip needs light text"


def test_dark_accent_not_over_darkened():
    """An already-dark accent should survive roughly unchanged."""
    out = accent_on_paper("#2563eb")
    assert ratio(parse(out), WHITE) >= 4.5
    assert parse(out) != [0, 0, 0], "accent collapsed to black"


tests = [
    test_ink_on_surface_is_readable,
    test_accent_text_on_paper_is_readable,
    test_blue_on_blue_regression,
    test_chip_ink_flips_for_light_accents,
    test_dark_accent_not_over_darkened,
]

if __name__ == "__main__":
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
