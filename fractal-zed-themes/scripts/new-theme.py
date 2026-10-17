#!/usr/bin/env python3
"""Generate a complete Zed theme family from a small palette.

Every token in tokens.json is filled in, so the output is both a usable theme
and a checklist: change a color here, or edit the JSON, or delete the tokens
you do not care about (Zed refines your theme over its built-in defaults, so
anything you omit keeps the default value).

Usage:
    python3 scripts/new-theme.py --name "My Theme" --out themes/my-theme.json
    python3 scripts/new-theme.py --name "My Light" --appearance light --palette paper --out themes/x.json
    python3 scripts/new-theme.py --list-palettes
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Palettes. Keep these small: everything else is derived.
# ---------------------------------------------------------------------------


def _dark(
    bg: str,
    surface: str,
    elevated: str,
    element: str,
    border: str,
    text: str,
    muted: str,
    accent: str,
    *,
    success: str,
    error: str,
    warning: str,
    info: str,
    hint: str,
    predictive: str,
    conflict: str = "",
    syntax: dict[str, str],
) -> dict[str, str]:
    conflict = conflict or warning
    return {
        "bg": bg,
        "surface": surface,
        "elevated": elevated,
        "element": element,
        "element_hover": element,
        "element_active": element,
        "element_selected": element,
        "element_disabled": bg,
        "border": border,
        "border_variant": surface,
        "border_focused": accent,
        "border_selected": accent,
        "border_disabled": surface,
        "border_transparent": "#00000000",
        "text": text,
        "text_muted": muted,
        "text_placeholder": muted,
        "text_disabled": muted,
        "text_accent": accent,
        "accent": accent,
        "guide": border,
        "active_line": elevated,
        "match": warning + "40",
        "active_match": warning + "66",
        "scrollbar": border,
        "scrollbar_hover": muted,
        "line_number": muted,
        "line_number_active": text,
        "success": success,
        "error": error,
        "warning": warning,
        "info": info,
        "hint": hint,
        "predictive": predictive,
        "conflict": conflict,
        "created": success,
        "deleted": error,
        "modified": info,
        "renamed": warning,
        "ignored": muted,
        "hidden": muted,
        "unreachable": muted,
        "ansi": {
            "black": surface,
            "red": error,
            "green": success,
            "yellow": warning,
            "blue": info,
            "magenta": predictive,
            "cyan": hint,
            "white": text,
        },
        "syntax": syntax,
    }


def _light(
    bg: str,
    surface: str,
    elevated: str,
    element: str,
    border: str,
    text: str,
    muted: str,
    accent: str,
    *,
    success: str,
    error: str,
    warning: str,
    info: str,
    hint: str,
    predictive: str,
    conflict: str = "",
    syntax: dict[str, str],
) -> dict[str, str]:
    palette = _dark(
        bg,
        surface,
        elevated,
        element,
        border,
        text,
        muted,
        accent,
        success=success,
        error=error,
        warning=warning,
        info=info,
        hint=hint,
        predictive=predictive,
        conflict=conflict,
        syntax=syntax,
    )
    palette["border_transparent"] = "#ffffff00"
    palette["match"] = warning + "80"
    palette["active_match"] = warning + "b3"
    return palette


PALETTES: dict[str, dict[str, dict[str, str]]] = {
    "fractal-dark": {
        "dark": _dark(
            "#0f1015",
            "#15161d",
            "#1c1d26",
            "#21222d",
            "#2b2d3a",
            "#d8d9e3",
            "#8f91a3",
            "#a78bfa",
            success="#7ddba3",
            error="#ff7b8a",
            warning="#ffcb6b",
            info="#82aaff",
            hint="#6fd3e0",
            predictive="#c792ea",
            syntax={
                "attribute": "#ffcb6b",
                "boolean": "#f2a65a",
                "comment": "#5b5e73",
                "comment.doc": "#6a6c85",
                "constant": "#f2a65a",
                "constructor": "#82aaff",
                "embedded": "#d8d9e3",
                "emphasis": "#d8d9e3",
                "emphasis.strong": "#ffffff",
                "enum": "#6fd3e0",
                "function": "#82aaff",
                "function.builtin": "#82aaff",
                "hint": "#6fd3e0",
                "keyword": "#c792ea",
                "label": "#7fdbca",
                "link_text": "#82aaff",
                "link_uri": "#6fd3e0",
                "namespace": "#6fd3e0",
                "number": "#f2a65a",
                "operator": "#89ddff",
                "predictive": "#6a6c85",
                "preproc": "#c792ea",
                "primary": "#d8d9e3",
                "property": "#7fdbca",
                "punctuation": "#8f91a3",
                "punctuation.bracket": "#8f91a3",
                "punctuation.delimiter": "#8f91a3",
                "punctuation.list_marker": "#c792ea",
                "punctuation.markup": "#5b5e73",
                "punctuation.special": "#89ddff",
                "selector": "#7ddba3",
                "selector.pseudo": "#c792ea",
                "string": "#7ddba3",
                "string.escape": "#89ddff",
                "string.regex": "#f2a65a",
                "string.special": "#f2a65a",
                "string.special.symbol": "#7fdbca",
                "tag": "#ff7b8a",
                "text.literal": "#d8d9e3",
                "title": "#82aaff",
                "type": "#6fd3e0",
                "type.builtin": "#6fd3e0",
                "variable": "#d8d9e3",
                "variable.parameter": "#e0a370",
                "variable.special": "#c792ea",
                "variant": "#6fd3e0",
                "diff.plus": "#7ddba3",
                "diff.minus": "#ff7b8a",
            },
        )
    },
    "paper": {
        "light": _light(
            "#faf9f7",
            "#f2f1ee",
            "#ffffff",
            "#eae8e3",
            "#d8d6d0",
            "#2c2b28",
            "#6f6c65",
            "#6d4bd6",
            success="#217a4b",
            error="#c0334a",
            warning="#9a6a10",
            info="#2b5fbf",
            hint="#1f7a86",
            predictive="#8a3fa8",
            syntax={
                "attribute": "#8a5a12",
                "boolean": "#a8471f",
                "comment": "#8a8778",
                "comment.doc": "#77746a",
                "constant": "#a8471f",
                "constructor": "#2b5fbf",
                "embedded": "#2c2b28",
                "emphasis": "#2c2b28",
                "emphasis.strong": "#000000",
                "enum": "#1f7a86",
                "function": "#2b5fbf",
                "function.builtin": "#2b5fbf",
                "hint": "#1f7a86",
                "keyword": "#6d4bd6",
                "label": "#20695f",
                "link_text": "#2b5fbf",
                "link_uri": "#1f7a86",
                "namespace": "#1f7a86",
                "number": "#a8471f",
                "operator": "#1f6f8b",
                "predictive": "#8a8778",
                "preproc": "#6d4bd6",
                "primary": "#2c2b28",
                "property": "#20695f",
                "punctuation": "#6f6c65",
                "punctuation.bracket": "#6f6c65",
                "punctuation.delimiter": "#6f6c65",
                "punctuation.list_marker": "#6d4bd6",
                "punctuation.markup": "#8a8778",
                "punctuation.special": "#1f6f8b",
                "selector": "#217a4b",
                "selector.pseudo": "#6d4bd6",
                "string": "#217a4b",
                "string.escape": "#1f6f8b",
                "string.regex": "#a8471f",
                "string.special": "#a8471f",
                "string.special.symbol": "#20695f",
                "tag": "#c0334a",
                "text.literal": "#2c2b28",
                "title": "#2b5fbf",
                "type": "#1f7a86",
                "type.builtin": "#1f7a86",
                "variable": "#2c2b28",
                "variable.parameter": "#9a6a10",
                "variable.special": "#6d4bd6",
                "variant": "#1f7a86",
                "diff.plus": "#217a4b",
                "diff.minus": "#c0334a",
            },
        )
    },
}

ACCENTS = ["#82aaff", "#f2a65a", "#ff7b8a", "#7ddba3", "#c792ea", "#6fd3e0", "#ffcb6b", "#a78bfa"]
PLAYERS = [
    ("#ff7b8a", "#ff7b8a", "#ff7b8a40"),
    ("#82aaff", "#82aaff", "#82aaff40"),
    ("#7ddba3", "#7ddba3", "#7ddba340"),
    ("#ffcb6b", "#ffcb6b", "#ffcb6b40"),
]

VIM_MODES = {
    "normal": ("accent", "text"),
    "insert": ("success", "text"),
    "visual": ("predictive", "text"),
    "visual_line": ("predictive", "text"),
    "visual_block": ("warning", "text"),
    "replace": ("error", "text"),
    "helix_normal": ("info", "text"),
    "helix_select": ("hint", "text"),
    "yank": ("warning", "text"),
    "helix_jump_label": ("warning", ""),
}

#: token name -> role, for the tokens whose role is not obvious from the name.
EXPLICIT_ROLES = {
    "background": "bg",
    "surface.background": "surface",
    "elevated_surface.background": "elevated",
    "panel.background": "surface",
    "panel.overlay_background": "elevated",
    "panel.overlay_hover": "element_hover",
    "status_bar.background": "bg",
    "title_bar.background": "surface",
    "title_bar.inactive_background": "bg",
    "toolbar.background": "surface",
    "tab_bar.background": "bg",
    "tab.active_background": "surface",
    "tab.inactive_background": "bg",
    "tab.active_background": "surface",
    "pane.focused_border": "border_focused",
    "pane_group.border": "border_variant",
    "panel.focused_border": "border_focused",
    "panel.indent_guide": "guide",
    "panel.indent_guide_active": "border_focused",
    "panel.indent_guide_hover": "scrollbar_hover",
    "drop_target.background": "element_selected",
    "drop_target.border": "border_focused",
    "element.background": "element",
    "element.hover": "element_hover",
    "element.active": "element_active",
    "element.selected": "element_selected",
    "element.disabled": "element_disabled",
    "element.selection_background": "active_match",
    "ghost_element.background": "element_disabled",
    "ghost_element.hover": "element_hover",
    "ghost_element.active": "element_active",
    "ghost_element.selected": "element_selected",
    "ghost_element.disabled": "element_disabled",
    "editor.background": "bg",
    "editor.foreground": "text",
    "editor.gutter.background": "bg",
    "editor.subheader.background": "surface",
    "editor.active_line.background": "active_line",
    "editor.highlighted_line.background": "active_line",
    "editor.line_number": "line_number",
    "editor.active_line_number": "line_number_active",
    "editor.hover_line_number": "line_number_active",
    "editor.invisible": "guide",
    "editor.wrap_guide": "guide",
    "editor.active_wrap_guide": "guide",
    "editor.indent_guide": "guide",
    "editor.indent_guide_active": "guide",
    "editor.document_highlight.read_background": "active_match",
    "editor.document_highlight.write_background": "active_match",
    "editor.document_highlight.bracket_background": "element_selected",
    "editor.debugger_active_line.background": "deleted_bg",
    "editor.code_lens.foreground": "line_number",
    "editor.diff_hunk.added.hollow_border": "success",
    "editor.diff_hunk.deleted.hollow_border": "error",
    "editor.diff_hunk.added.background": "created_bg",
    "editor.diff_hunk.added.hollow_background": "created_bg",
    "editor.diff_hunk.deleted.background": "deleted_bg",
    "editor.diff_hunk.deleted.hollow_background": "deleted_bg",
    "search.match_background": "match",
    "search.active_match_background": "active_match",
    "scrollbar.thumb.background": "scrollbar",
    "scrollbar.thumb.hover_background": "scrollbar_hover",
    "scrollbar.thumb.active_background": "scrollbar_hover",
    "scrollbar.thumb.border": "border_variant",
    "scrollbar.track.background": "bg",
    "scrollbar.track.border": "border_variant",
    "scrollbar_thumb.background": "scrollbar",
    "minimap.thumb.background": "scrollbar",
    "minimap.thumb.hover_background": "scrollbar_hover",
    "minimap.thumb.active_background": "scrollbar_hover",
    "minimap.thumb.border": "border_variant",
    "terminal.background": "bg",
    "terminal.foreground": "text",
    "terminal.bright_foreground": "text",
    "terminal.dim_foreground": "text_muted",
    "terminal.ansi.background": "bg",
    "terminal.ansi.black": "ansi_black",
    "terminal.ansi.red": "ansi_red",
    "terminal.ansi.green": "ansi_green",
    "terminal.ansi.yellow": "ansi_yellow",
    "terminal.ansi.blue": "ansi_blue",
    "terminal.ansi.magenta": "ansi_magenta",
    "terminal.ansi.cyan": "ansi_cyan",
    "terminal.ansi.white": "ansi_white",
    "terminal.ansi.bright_black": "text_muted",
    "terminal.ansi.bright_red": "ansi_red",
    "terminal.ansi.bright_green": "ansi_green",
    "terminal.ansi.bright_yellow": "ansi_yellow",
    "terminal.ansi.bright_blue": "ansi_blue",
    "terminal.ansi.bright_magenta": "ansi_magenta",
    "terminal.ansi.bright_cyan": "ansi_cyan",
    "terminal.ansi.bright_white": "text",
    "terminal.ansi.dim_black": "ansi_black",
    "terminal.ansi.dim_red": "ansi_red",
    "terminal.ansi.dim_green": "ansi_green",
    "terminal.ansi.dim_yellow": "ansi_yellow",
    "terminal.ansi.dim_blue": "ansi_blue",
    "terminal.ansi.dim_magenta": "ansi_magenta",
    "terminal.ansi.dim_cyan": "ansi_cyan",
    "terminal.ansi.dim_white": "ansi_white",
    "link_text.hover": "accent",
    "debugger.accent": "error",
    "version_control.added": "created",
    "version_control.deleted": "deleted",
    "version_control.modified": "modified",
    "version_control.renamed": "renamed",
    "version_control.ignored": "ignored",
    "version_control.conflict": "conflict",
    "version_control.word_added": "created",
    "version_control.word_deleted": "deleted",
    "version_control.conflict_marker.ours": "info",
    "version_control.conflict_marker.theirs": "warning",
    "version_control_conflict_ours_background": "info",
    "version_control_conflict_theirs_background": "warning",
}

SEMANTIC_ROLES = {
    "conflict": "conflict",
    "created": "created",
    "deleted": "deleted",
    "error": "error",
    "hidden": "hidden",
    "hint": "hint",
    "ignored": "ignored",
    "info": "info",
    "modified": "modified",
    "predictive": "predictive",
    "renamed": "renamed",
    "success": "success",
    "unreachable": "unreachable",
    "warning": "warning",
}


def role_for(token: str) -> str:
    if token in EXPLICIT_ROLES:
        return EXPLICIT_ROLES[token]
    if token in SEMANTIC_ROLES:
        return SEMANTIC_ROLES[token]
    semantic = re.fullmatch(r"(conflict|created|deleted|error|hidden|hint|ignored|info|modified|predictive|renamed|success|unreachable|warning)\.(background|border)", token)
    if semantic:
        base = SEMANTIC_ROLES[semantic.group(1)]
        return f"{base}_bg" if semantic.group(2) == "background" else base
    if token.startswith("border"):
        return "border_focused" if token.endswith("focused") else "border"
    if token.startswith(("text", "icon")):
        if token.endswith(".muted"):
            return "text_muted"
        if token.endswith(".placeholder"):
            return "text_placeholder"
        if token.endswith(".disabled"):
            return "text_disabled"
        if token.endswith(".accent"):
            return "accent"
        return "text"
    if token.startswith("vim."):
        mode = token.removeprefix("vim.").rsplit(".", 1)[0]
        is_foreground = token.endswith("foreground")
        if mode in VIM_MODES:
            return f"vim_{mode}_{'fg' if is_foreground else 'bg'}"
    raise KeyError(f"no role for token {token!r} -- add it to EXPLICIT_ROLES")


def blend(color: str, other: str, amount: float) -> str:
    """Mix `color` toward `other` by `amount` (0..1)."""
    def rgb(value: str) -> tuple[int, int, int]:
        value = value.lstrip("#")[:6]
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]

    a, b = rgb(color), rgb(other)
    mixed = [round(x + (y - x) * amount) for x, y in zip(a, b)]
    return "#" + "".join(f"{channel:02x}" for channel in mixed)


def resolve_roles(palette: dict[str, str], appearance: str) -> dict[str, str]:
    roles = {key: value for key, value in palette.items() if isinstance(value, str)}
    ansi = palette["ansi"]
    for slot, color in ansi.items():
        roles[f"ansi_{slot}"] = color
        roles[f"ansi_{slot}_dim"] = blend(color, roles["bg"], 0.35)
    roles["editor_fg"] = roles["text"]
    roles["gutter_fg"] = roles["line_number"]
    for base in SEMANTIC_ROLES.values():
        roles[f"{base}_bg"] = roles[base] + "40"
    # Ghost elements are translucent overlays, not solid colors.
    overlay = "#000000" if appearance == "dark" else "#ffffff"
    roles["element_disabled"] = overlay + "08"
    roles["element_hover"] = overlay + "14"
    roles["element_active"] = overlay + "1f"
    roles["element_selected"] = roles["accent"] + "33"
    roles["element"] = overlay + "0f"
    for mode, (foreground, background) in VIM_MODES.items():
        roles[f"vim_{mode}_fg"] = roles[foreground]
        if background:
            roles[f"vim_{mode}_bg"] = roles[background]
    return roles


def build_family(
    name: str,
    author: str,
    appearance: str,
    palette: dict[str, str],
    tokens: dict,
) -> dict:
    roles = resolve_roles(palette, appearance)
    style: dict[str, object] = {"background.appearance": "opaque"}

    for group in tokens["groups"]:
        for token in group["tokens"]:
            if token["name"] == "background.appearance" or token.get("deprecated"):
                continue
            style[token["name"]] = roles[role_for(token["name"])]

    style["accents"] = [blend(accent, roles["bg"], 0.1) for accent in ACCENTS]
    style["players"] = [
        {"cursor": cursor, "background": background, "selection": selection}
        for cursor, background, selection in PLAYERS
    ]

    syntax = {}
    for capture in tokens["syntax_captures"]:
        key = capture["name"]
        # Mirror Zed's own capture fallback: `type.builtin` uses `type`'s color.
        color = palette["syntax"].get(key) or palette["syntax"].get(key.rsplit(".", 1)[0])
        if color is None:
            raise SystemExit(f"palette is missing a color for capture {key!r}")
        entry: dict[str, object] = {"color": color}
        if key in {"comment", "comment.doc", "punctuation.markup"}:
            entry["font_style"] = "italic"
        syntax[key] = entry
    style["syntax"] = dict(sorted(syntax.items()))

    return {
        "$schema": "../theme.schema.json",
        "name": name,
        "author": author,
        "themes": [{"name": name, "appearance": appearance, "style": style}],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--name", help="theme (and family) name")
    parser.add_argument("--author", default="Amrit")
    parser.add_argument("--appearance", choices=["dark", "light"])
    parser.add_argument("--palette", choices=sorted(PALETTES), default="fractal-dark")
    parser.add_argument("--out", type=Path, help="output path, defaults to themes/<slug>.json")
    parser.add_argument("--force", action="store_true", help="overwrite an existing file")
    parser.add_argument("--list-palettes", action="store_true")
    args = parser.parse_args()

    if args.list_palettes:
        for palette, appearances in PALETTES.items():
            print(f"{palette}: {', '.join(sorted(appearances))}")
        return 0

    if not args.name:
        parser.error("--name is required")

    palettes = PALETTES[args.palette]
    appearance = args.appearance or next(iter(palettes))
    palette = palettes[appearance]

    tokens = json.loads((ROOT / "tokens.json").read_text())
    family = build_family(args.name, args.author, appearance, palette, tokens)

    slug = re.sub(r"[^a-z0-9]+", "-", args.name.lower()).strip("-")
    out = args.out or ROOT / "themes" / f"{slug}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to overwrite")
        return 1
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(family, indent=2) + "\n")

    style_keys = len(family["themes"][0]["style"])
    print(f"wrote {out} ({style_keys} style keys, {len(family['themes'][0]['style']['syntax'])} captures)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
