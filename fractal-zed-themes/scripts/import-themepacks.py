#!/usr/bin/env python3
"""Convert the Vecta and Fracta collections from rtastyling/themepacks into Zed themes.

Source: `packages/rtastyling/packages/themepacks/src/lib/canonical/`
  - themesVecta.json   76 full-UI themes (9 background tiers, 4 text tiers,
                       3 borders, hover/selected states, success/warning/danger/info)
  - themesFracta.json  38 syntax-first themes (comment/fn/key/num/op/prop/punct/str/type)

Both are converted with the exact same builder `scripts/new-theme.py` uses, so the
output is a complete Zed theme (every token in tokens.json) and validates with
`scripts/check-themes.py`.

The two collections are editor themes, unlike the ramps/swatches in Base16,
Tailwind, Uno, Artista and Colourways, so the mapping is mostly name -> name:

  Vecta  anchors come straight from its semantic names; its missing syntax
         palette is derived from its accents (comment<-text-muted,
         string<-success, keyword<-theme-color-alt, number<-warning, ...).
  Fracta names *are* syntax captures (fn/key/num/op/prop/punct/str/type), so the
         syntax map is direct. It has no red, so the semantic anchors
         (error/warning/success/info/hint/predictive) are picked by choosing the
         nearest hue in the theme, falling back to the theme's own syntax color
         when nothing is close enough (so duotone/monochrome themes stay true).

Themes that exist as a light/dark pair are emitted as one Zed theme family, so
Zed's light/dark toggle works. Families are named `<Source> <stem>` to keep the
picker grouped.

Usage:
    python3 scripts/import-themepacks.py                    # both collections
    python3 scripts/import-themepacks.py --collection vecta
    python3 scripts/import-themepacks.py --dry-run
    python3 scripts/import-themepacks.py --source /path/to/canonical
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path("/Users/amrit/fractaldesign/packages/rtastyling/packages/themepacks/src/lib/canonical")


# ---------------------------------------------------------------------------
# Reuse the generator in new-theme.py (hyphenated filename -> importlib).
# ---------------------------------------------------------------------------


def _load_builder():
    spec = importlib.util.spec_from_file_location("zed_new_theme", ROOT / "scripts" / "new-theme.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


builder = _load_builder()


# ---------------------------------------------------------------------------
# Color helpers
# ---------------------------------------------------------------------------


def _rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")[:6]
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def hue_saturation(color: str) -> tuple[float, float]:
    r, g, b = (c / 255 for c in _rgb(color))
    mx, mn = max(r, g, b), min(r, g, b)
    delta = mx - mn
    if delta == 0:
        return 0.0, 0.0
    if mx == r:
        h = 60 * (((g - b) / delta) % 6)
    elif mx == g:
        h = 60 * ((b - r) / delta + 2)
    else:
        h = 60 * ((r - g) / delta + 4)
    return h, delta / mx


#: For each semantic role, the band of hues a theme color must fall in to be used
#: directly, and the hue to synthesize when the theme has nothing in the band.
HUE_BANDS = {
    "error": (335.0, 30.0),
    "warning": (30.0, 65.0),
    "success": (70.0, 165.0),
    "hint": (160.0, 210.0),
    "info": (200.0, 255.0),
    "predictive": (250.0, 320.0),
}
TARGET_HUE = {"error": 5.0, "warning": 38.0, "success": 135.0, "hint": 188.0, "info": 220.0, "predictive": 275.0}


def in_band(hue: float, low: float, high: float) -> bool:
    return low <= hue <= high if low <= high else (hue >= low or hue <= high)


def pick_semantic(candidates, role: str, fallback: str) -> str:
    """Pick a theme color for a semantic role, synthesizing a hue if needed.

    Themes such as Newsprint (grey + red), Augur (green + blue) and Green Lantern
    (green only) do not contain every semantic hue, but Zed needs error / warning /
    success / info / hint / predictive to be distinguishable for diagnostics, diffs
    and git status. When nothing in the theme falls inside the role's hue band we
    rotate the theme's most saturated color to that hue, keeping its lightness, so
    the result stays on-palette. Achromatic themes (Monoline Ink) keep their neutral
    fallback rather than gaining a hue they never had.
    """
    low, high = HUE_BANDS[role]
    span = high - low if high >= low else high + 360 - low
    centre = (low + span / 2) % 360

    best, best_distance = None, None
    vivid, vivid_saturation = None, -1.0
    for color in sorted(candidates):
        hue, saturation = hue_saturation(color)
        if saturation > vivid_saturation:
            vivid, vivid_saturation = color, saturation
        if saturation < 0.18 or not in_band(hue, low, high):
            continue
        distance = abs(hue - centre)
        distance = min(distance, 360 - distance)
        if best_distance is None or distance < best_distance:
            best, best_distance = color, distance
    if best is not None:
        return best
    if vivid is not None and vivid_saturation >= 0.25:
        return shift_hue(vivid, TARGET_HUE[role], max_saturation=0.75)
    return fallback


def shift_hue(color: str, target_hue: float, *, max_saturation: float = 1.0) -> str:
    """Return `color` re-hued to `target_hue`, keeping its lightness."""
    r, g, b = (c / 255 for c in _rgb(color))
    mx, mn = max(r, g, b), min(r, g, b)
    delta = mx - mn
    if delta == 0:
        return color
    saturation = min(delta / mx, max_saturation)
    value = mx

    chroma = value * saturation
    second = chroma * (1 - abs((target_hue / 60) % 2 - 1))
    offset = value - chroma
    sector = int(target_hue // 60) % 6
    rgb = [
        (chroma, second, 0.0),
        (second, chroma, 0.0),
        (0.0, chroma, second),
        (0.0, second, chroma),
        (second, 0.0, chroma),
        (chroma, 0.0, second),
    ][sector]
    return "#" + "".join(f"{round((channel + offset) * 255):02x}" for channel in rgb)


# ---------------------------------------------------------------------------
# Fracta
# ---------------------------------------------------------------------------

#: capture -> Fracta color name. The names are the same idea as Zed's captures.
FRACTA_SYNTAX = {
    "attribute": "fn",
    "boolean": "key",
    "comment": "comment",
    "comment.doc": "comment",
    "constant": "num",
    "constant.builtin": "num",
    "constructor": "type",
    "embedded": "fg",
    "emphasis": "fg",
    "emphasis.strong": "fg",
    "enum": "type",
    "function": "fn",
    "function.builtin": "fn",
    "hint": "punct",
    "keyword": "key",
    "label": "type",
    "link_text": "type",
    "link_uri": "type",
    "namespace": "type",
    "number": "num",
    "operator": "op",
    "predictive": "comment",
    "preproc": "key",
    "primary": "fg",
    "property": "prop",
    "punctuation": "punct",
    "punctuation.bracket": "punct",
    "punctuation.delimiter": "punct",
    "punctuation.list_marker": "punct",
    "punctuation.markup": "comment",
    "punctuation.special": "op",
    "selector": "key",
    "selector.pseudo": "key",
    "string": "str",
    "string.escape": "op",
    "string.regex": "num",
    "string.special": "num",
    "string.special.symbol": "prop",
    "tag": "op",
    "tag.doctype": "punct",
    "text.literal": "fg",
    "title": "type",
    "type": "type",
    "type.builtin": "type",
    "variable": "fg",
    "variable.parameter": "prop",
    "variable.special": "num",
    "variant": "type",
    "diff.plus": "str",
    "diff.minus": "op",
}


#: Colors a semantic anchor may be picked from. Surfaces and neutrals are
#: excluded so a faintly-tinted background can never win a hue match.
FRACTA_SEMANTIC_CANDIDATES = ("accent", "fn", "key", "num", "op", "str", "type")


def fracta_palette(colors: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    """Return (anchors, syntax_colors); feed the anchors to _dark/_light."""
    candidates = {colors[name] for name in FRACTA_SEMANTIC_CANDIDATES}
    anchors = {
        "bg": colors["bg"],
        "surface": colors["alt"],
        "elevated": colors["sel"],
        "element": colors["border"],
        "border": colors["border"],
        "text": colors["fg"],
        "muted": colors["comment"],
        "accent": colors["accent"],
        # Fracta ships no red; choose the nearest hue the theme actually has.
        "success": pick_semantic(candidates, "success", colors["str"]),
        "error": pick_semantic(candidates, "error", colors["op"]),
        "warning": pick_semantic(candidates, "warning", colors["key"]),
        "info": pick_semantic(candidates, "info", colors["type"]),
        "hint": pick_semantic(candidates, "hint", colors["type"]),
        "predictive": pick_semantic(candidates, "predictive", colors["num"]),
    }
    syntax_colors = {capture: colors[name] for capture, name in FRACTA_SYNTAX.items()}
    return anchors, syntax_colors


# ---------------------------------------------------------------------------
# Vecta
# ---------------------------------------------------------------------------

#: capture -> Vecta color name (Vecta has no syntax palette, so derive one).
VECTA_SYNTAX = {
    "attribute": "warning",
    "boolean": "danger",
    "comment": "text-muted",
    "comment.doc": "text-muted",
    "constant": "warning",
    "constant.builtin": "warning",
    "constructor": "theme-color",
    "embedded": "text-primary",
    "emphasis": "text-primary",
    "emphasis.strong": "text-primary",
    "enum": "theme-color-sub",
    "function": "info",
    "function.builtin": "info",
    "hint": "theme-color-sub",
    "keyword": "theme-color-alt",
    "label": "success",
    "link_text": "info",
    "link_uri": "theme-color-sub",
    "namespace": "theme-color-sub",
    "number": "warning",
    "operator": "theme-color-sub",
    "predictive": "text-muted",
    "preproc": "theme-color-alt",
    "primary": "text-primary",
    "property": "success",
    "punctuation": "text-muted",
    "punctuation.bracket": "text-muted",
    "punctuation.delimiter": "text-muted",
    "punctuation.list_marker": "theme-color-alt",
    "punctuation.markup": "text-muted",
    "punctuation.special": "theme-color-sub",
    "selector": "success",
    "selector.pseudo": "theme-color-alt",
    "string": "success",
    "string.escape": "theme-color-sub",
    "string.regex": "warning",
    "string.special": "warning",
    "string.special.symbol": "success",
    "tag": "danger",
    "tag.doctype": "text-muted",
    "text.literal": "text-primary",
    "title": "info",
    "type": "theme-color-sub",
    "type.builtin": "theme-color-sub",
    "variable": "text-primary",
    "variable.parameter": "warning",
    "variable.special": "theme-color-alt",
    "variant": "theme-color-sub",
    "diff.plus": "success",
    "diff.minus": "danger",
}


def vecta_palette(colors: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    anchors = {
        "bg": colors["bg"],
        "surface": colors["bg-surface"],
        "elevated": colors["bg-raised"],
        "element": colors["bg-panel"],
        "border": colors["border"],
        "text": colors["text-primary"],
        "muted": colors["text-muted"],
        "accent": colors["theme-color"],
        "success": colors["success"],
        "error": colors["danger"],
        "warning": colors["warning"],
        "info": colors["info"],
        "hint": colors["theme-color-sub"],
        "predictive": colors["theme-color-alt"],
    }
    syntax_colors = {capture: colors[name] for capture, name in VECTA_SYNTAX.items()}
    return anchors, syntax_colors


# ---------------------------------------------------------------------------
# Collection plumbing
# ---------------------------------------------------------------------------

#: Vecta names its light/dark variants inconsistently for these four; they are
#: still the same look, so pair them explicitly.
VECTA_STEM_OVERRIDES = {
    "Catppuccin Mocha": "Catppuccin",
    "Catppuccin Latte": "Catppuccin",
    "One Dark Pro": "One Pro",
    "OneLight Pro": "One Pro",
}


def stem_of(name: str, overrides: dict[str, str]) -> str:
    if name in overrides:
        return overrides[name]
    return re.sub(r"\s+(Light|Dark)$", "", name)


def palette_for(source: str, theme: dict) -> tuple[dict, dict]:
    colors = {c["name"]: c["hex"] for c in theme["colors"]}
    if source == "vecta":
        return vecta_palette(colors)
    return fracta_palette(colors)


def make_family(family_name: str, author: str, variants: list[tuple[str, str, dict, dict]], tokens: dict) -> dict:
    """variants: list of (theme_name, appearance, anchors, syntax)."""
    family: dict | None = None
    for theme_name, appearance, anchors, syntax in variants:
        palette = (builder._dark if appearance == "dark" else builder._light)(**anchors, syntax=syntax)
        built = builder.build_family(theme_name, author, appearance, palette, tokens)
        if family is None:
            family = built
        else:
            family["themes"].extend(built["themes"])
    assert family is not None
    family["name"] = family_name
    return family


def convert(source_file: Path, source: str, tokens: dict, author: str) -> list[tuple[str, dict]]:
    data = json.loads(source_file.read_text())
    overrides = VECTA_STEM_OVERRIDES if source == "vecta" else {}
    display = source.capitalize()

    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for theme in data["themes"]:
        stem = stem_of(theme["name"], overrides)
        if stem not in groups:
            groups[stem] = []
            order.append(stem)
        groups[stem].append(theme)

    out: list[tuple[str, dict]] = []
    for stem in order:
        members = sorted(groups[stem], key=lambda t: t["mode"] != "light")  # light first
        variants = []
        for theme in members:
            anchors, syntax = palette_for(source, theme)
            variants.append((theme["name"], theme["mode"], anchors, syntax))
        family = make_family(f"{display} {stem}", author, variants, tokens)
        out.append((stem, family))
    return out


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="canonical/ directory")
    parser.add_argument("--collection", choices=["vecta", "fracta", "all"], default="all")
    parser.add_argument("--author", default="Amrit")
    parser.add_argument("--out-dir", type=Path, default=ROOT / "themes")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    tokens = json.loads((ROOT / "tokens.json").read_text())
    captures = {c["name"] for c in tokens["syntax_captures"]}
    for name, table in (("fracta", FRACTA_SYNTAX), ("vecta", VECTA_SYNTAX)):
        missing = captures - set(table)
        if missing:
            print(f"error: {name} syntax map is missing {sorted(missing)}", file=sys.stderr)
            return 1

    sources = []
    if args.collection in ("vecta", "all"):
        sources.append(("vecta", args.source / "themesVecta.json"))
    if args.collection in ("fracta", "all"):
        sources.append(("fracta", args.source / "themesFracta.json"))

    total_families = total_themes = 0
    for source, path in sources:
        if not path.exists():
            print(f"error: {path} not found (pass --source)", file=sys.stderr)
            return 1
        families = convert(path, source, tokens, args.author)
        themes = sum(len(f["themes"]) for _, f in families)
        total_families += len(families)
        total_themes += themes
        print(f"{source}: {len(families)} families / {themes} themes")
        for stem, family in families:
            out = args.out_dir / f"{source}-{slugify(stem)}.json"
            apps = ", ".join(t["appearance"] for t in family["themes"])
            if args.dry_run:
                print(f"  {out.name:<36} {family['name']:<26} [{apps}]")
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(family, indent=2) + "\n")

    if not args.dry_run:
        print(f"wrote {total_families} files ({total_themes} themes) to {args.out_dir}")
        print("next: python3 scripts/check-themes.py")
    else:
        print(f"dry run: {total_families} files ({total_themes} themes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
