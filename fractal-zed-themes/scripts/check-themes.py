#!/usr/bin/env python3
"""Validate the theme files in themes/ against Zed's real token list.

Zed ignores unknown keys instead of erroring, so a typo'd token name produces a
theme that silently fails to style one thing. This catches that, plus invalid
colors, bad appearance values and duplicate theme names.

Usage:
    python3 scripts/check-themes.py            # checks themes/
    python3 scripts/check-themes.py path.json  # checks one file
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLOR = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
APPEARANCE = {"light", "dark"}
FONT_STYLE = {"normal", "italic", "oblique"}
HIGHLIGHT_KEYS = {"color", "background_color", "font_style", "font_weight"}
#: Not in the generated token list because they are validated separately.
NON_COLOR_TOKENS = {"background.appearance", "accents", "players", "syntax"}


def load_tokens() -> tuple[set[str], set[str]]:
    data = json.loads((ROOT / "tokens.json").read_text())
    names = {token["name"] for group in data["groups"] for token in group["tokens"]}
    names |= {token["name"] for token in data["top_level"]}
    captures = {capture["name"] for capture in data["syntax_captures"]}
    return names, captures


def check_color(value: object, where: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not COLOR.match(value):
        errors.append(f"{where}: {value!r} is not a hex color (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)")


def check_highlight(style: object, capture: str, where: str, captures: set[str], errors: list[str]) -> None:
    if capture not in captures:
        suggestion = suggest(capture, captures)
        hint = f" (did you mean `{suggestion}`?)" if suggestion else ""
        errors.append(f"{where}: unknown syntax capture{hint}")
    if not isinstance(style, dict):
        errors.append(f"{where}: expected an object, got {type(style).__name__}")
        return
    for key in style:
        if key not in HIGHLIGHT_KEYS:
            errors.append(f"{where}: unknown highlight key {key!r} (expected {sorted(HIGHLIGHT_KEYS)})")
    for key in ("color", "background_color"):
        if key in style and style[key] is not None:
            check_color(style[key], f"{where}.{key}", errors)
    if "font_style" in style and style["font_style"] not in FONT_STYLE:
        errors.append(f"{where}.font_style: {style['font_style']!r} not in {sorted(FONT_STYLE)}")
    if "font_weight" in style:
        weight = style["font_weight"]
        if not isinstance(weight, (int, float)) or not 100 <= weight <= 900:
            errors.append(f"{where}.font_weight: {weight!r} should be 100..900")


def check_family(path: Path, known: set[str], captures: set[str]) -> list[str]:
    errors: list[str] = []
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        return [f"{path.name}: invalid JSON: {error}"]

    if not isinstance(data, dict):
        return [f"{path.name}: top level must be an object"]

    for key in ("name", "author"):
        if not isinstance(data.get(key), str) or not data.get(key):
            errors.append(f"{path.name}: missing required string {key!r}")

    themes = data.get("themes")
    if not isinstance(themes, list) or not themes:
        return errors + [f"{path.name}: 'themes' must be a non-empty array"]

    seen: set[str] = set()
    for index, theme in enumerate(themes):
        where = f"{path.name}[{index}]"
        if not isinstance(theme, dict):
            errors.append(f"{where}: expected an object")
            continue
        name = theme.get("name")
        if not isinstance(name, str) or not name:
            errors.append(f"{where}: missing theme name")
        else:
            where = f"{path.name}:{name}"
            if name in seen:
                errors.append(f"{where}: duplicate theme name in this family")
            seen.add(name)
        if theme.get("appearance") not in APPEARANCE:
            errors.append(f"{where}.appearance: {theme.get('appearance')!r} not in {sorted(APPEARANCE)}")

        style = theme.get("style")
        if not isinstance(style, dict):
            errors.append(f"{where}.style: missing or not an object")
            continue

        for key, value in style.items():
            if key in NON_COLOR_TOKENS:
                if key == "background.appearance":
                    options = {"opaque", "transparent", "blurred", "mica", "mica_alt"}
                    if value not in options:
                        errors.append(f"{where}.style.{key}: {value!r} not in {sorted(options)}")
                elif key == "accents":
                    for position, color in enumerate(value or []):
                        check_color(color, f"{where}.style.accents[{position}]", errors)
                elif key == "players":
                    for position, player in enumerate(value or []):
                        for field in ("cursor", "background", "selection"):
                            if field in player:
                                check_color(player[field], f"{where}.style.players[{position}].{field}", errors)
                elif key == "syntax":
                    for capture, highlight in (value or {}).items():
                        where = f"{where}.style.syntax.{capture}"
                        check_highlight(highlight, capture, where, captures, errors)
                continue
            if key not in known:
                suggestion = suggest(key, known)
                hint = f" (did you mean `{suggestion}`?)" if suggestion else ""
                errors.append(f"{where}.style.{key}: unknown token{hint}")
                continue
            check_color(value, f"{where}.style.{key}", errors)

    return errors


def suggest(name: str, known: set[str]) -> str | None:
    """Closest known token name, if it is close enough to be a likely typo."""
    import difflib

    matches = difflib.get_close_matches(name, known, n=1, cutoff=0.75)
    return matches[0] if matches else None


def main() -> int:
    known, captures = load_tokens()
    paths = [Path(arg) for arg in sys.argv[1:]] or sorted((ROOT / "themes").glob("*.json"))
    if not paths:
        print("no theme files found in themes/")
        return 0

    failures = 0
    theme_count = 0
    for path in paths:
        errors = check_family(path, known, captures)
        if errors:
            failures += 1
            print(f"\n{path}")
            for error in errors:
                print(f"  - {error}")
        else:
            theme_count += len(json.loads(path.read_text())["themes"])
            print(f"ok  {path.name}")

    print(f"\n{len(paths) - failures}/{len(paths)} files valid, {theme_count} theme(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
