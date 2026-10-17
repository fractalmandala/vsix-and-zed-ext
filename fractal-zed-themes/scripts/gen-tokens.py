#!/usr/bin/env python3
"""Generate tokens.json and TOKENS.md from Zed's own theme source.

The token names in a Zed theme are defined by the structs in
`crates/settings_content/src/theme.rs`. Doc comments on those fields are the
authoritative description of what each token does, so we read them straight out
of Zed at a pinned tag instead of maintaining a hand-written list that drifts.

Usage:
    python3 scripts/gen-tokens.py                # download the pinned tag
    python3 scripts/gen-tokens.py --source path/to/theme.rs
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ZED_REPO = "https://raw.githubusercontent.com/zed-industries/zed"
ZED_REF = "v1.22.0"  # keep in sync with the Zed version you run
SOURCE_FILE = "crates/settings_content/src/theme.rs"

ROOT = Path(__file__).resolve().parent.parent

#: Tokens are documented in groups so the reference reads like a design system
#: rather than an alphabetical dump. First matching rule wins.
GROUPS: list[tuple[str, str, str]] = [
    ("surfaces", "Surfaces & chrome", "Window, panel, tab and title bar backgrounds."),
    ("borders", "Borders", "Border colors for every interaction state."),
    ("text", "Text", "Foreground colors for UI copy (not syntax)."),
    ("icons", "Icons", "Icon colors, mirroring the text tokens."),
    ("elements", "Elements", "Buttons, inputs, checkboxes and other controls."),
    ("editor", "Editor", "The text buffer: background, gutter, guides, highlights."),
    ("search", "Search", "Match highlighting inside the editor."),
    ("scrollbars", "Scrollbars", "Scrollbar thumb and track."),
    ("terminal", "Terminal", "The integrated terminal, including all ANSI slots."),
    ("status", "Status & diagnostics", "Semantic colors: errors, warnings, diff hunk states."),
    ("version_control", "Version control", "Git status and inline diff decorations."),
    ("minimap", "Minimap", "The minimap strip beside the editor."),
    ("vim", "Vim modes", "The Vim mode indicator, shown when Vim mode is enabled."),
    ("links", "Links", "Hover color for links in the UI."),
    ("deprecated", "Deprecated aliases", "Still parsed, but superseded. Prefer the replacement."),
    ("misc", "Other", "Tokens that do not fit another group."),
]

#: Rule order matters: earlier rules win.
RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^(scrollbar_thumb|version_control_conflict)"), "deprecated"),
    (re.compile(r"^(border)"), "borders"),
    (re.compile(r"^(text)"), "text"),
    (re.compile(r"^(icon)"), "icons"),
    (re.compile(r"^(element|ghost_element|drop_target)\."), "elements"),
    (re.compile(r"^(editor|debugger)\."), "editor"),
    (re.compile(r"^(search)\."), "search"),
    (re.compile(r"^(minimap)\."), "minimap"),
    (re.compile(r"^(vim)\."), "vim"),
    (re.compile(r"^(scrollbar)\."), "scrollbars"),
    (re.compile(r"^(terminal)\."), "terminal"),
    (re.compile(r"^(version_control)\."), "version_control"),
    (re.compile(r"^(link_text)"), "links"),
    (
        re.compile(
            r"^(background|surface\.background|elevated_surface\.background|panel|pane|pane_group|title_bar|tab|tab_bar|toolbar|status_bar)"
        ),
        "surfaces",
    ),
]

#: Tokens whose name and companion tokens make the description obvious.
#: They are not rendered as a group; they get their own sections in TOKENS.md.
COMPOSITE = {"accents", "players", "syntax"}

#: Descriptions for fields that carry no doc comment upstream.
DESCRIPTION_OVERRIDES = {
    "accents": "Ordered palette used for indent guides, collaboration and other index-based coloring.",
    "players": "Per-collaborator cursor/selection colors. Zed assigns these in order as people join.",
    "syntax": "Capture name -> highlight style. See the Syntax captures section below.",
    "background.appearance": "How the window background is composited: opaque, transparent, blurred, mica, mica_alt.",
    # Surfaces
    "panel.background": "Background for side and bottom panels (project panel, terminal panel, ...).",
    "panel.focused_border": "Border drawn around the focused panel.",
    "panel.overlay_background": "Background for overlay panels drawn on top of the editor.",
    "panel.overlay_hover": "Hover color for overlay panels.",
    "panel.indent_guide": "Indent guide color inside panels.",
    "panel.indent_guide_active": "Indent guide color for the active level inside panels.",
    "panel.indent_guide_hover": "Indent guide color while hovered inside panels.",
    "pane.focused_border": "Border drawn around the focused editor pane.",
    "pane_group.border": "Border between split groups of panes.",
    "status_bar.background": "Background for the status bar at the bottom of the window.",
    "tab.active_background": "Background for the active tab.",
    "tab.inactive_background": "Background for inactive tabs.",
    "tab_bar.background": "Background for the tab bar.",
    "title_bar.background": "Background for the title bar of the active window.",
    "title_bar.inactive_background": "Background for the title bar of inactive windows.",
    "toolbar.background": "Background for toolbars, such as the breadcrumb bar above the editor.",
    # Editor
    "editor.background": "Background for the editor.",
    "editor.foreground": "Default text color in the editor, used when no syntax capture matches.",
    "editor.gutter.background": "Background for the gutter (line numbers and diff markers).",
    "editor.subheader.background": "Background for editor subheaders, such as buffer search or inline blame rows.",
    "editor.active_line.background": "Background for the line containing the cursor.",
    "editor.highlighted_line.background": "Background for other lines highlighted at the cursor, such as matching occurrences.",
    "editor.wrap_guide": "Vertical guide at the wrap column.",
    "editor.active_wrap_guide": "Vertical guide at the active wrap column (buffer width when soft wrap is set to a custom width).",
    "editor.indent_guide": "Vertical guides at each indent level.",
    "editor.indent_guide_active": "Guide for the indent level the cursor is inside.",
    # Search
    "search.match_background": "Background for search matches.",
    "search.active_match_background": "Background for the search match the cursor is on.",
    # Links
    "link_text.hover": "Color for links while hovered.",
    # Minimap
    "minimap.thumb.background": "Background for the minimap viewport thumb.",
    "minimap.thumb.hover_background": "Background for the minimap thumb while hovered.",
    "minimap.thumb.active_background": "Background for the minimap thumb while dragged.",
    "minimap.thumb.border": "Border around the minimap thumb.",
    # Deprecated
    "scrollbar_thumb.background": "Deprecated alias for `scrollbar.thumb.background`.",
    "version_control_conflict_ours_background": "Deprecated alias for `version_control.conflict_marker.ours`.",
    "version_control_conflict_theirs_background": "Deprecated alias for `version_control.conflict_marker.theirs`.",
    # Other
    "debugger.accent": "Accent used for the debugger's active line and breakpoint indicators.",
    "vim.helix_jump_label.foreground": "Text color for Helix-style jump labels in Vim mode.",
}

VIM_MODES = {
    "normal": "normal",
    "insert": "insert",
    "visual": "visual",
    "visual_line": "visual line",
    "visual_block": "visual block",
    "replace": "replace",
    "helix_normal": "Helix normal",
    "helix_select": "Helix select",
}


def derive_description(name: str) -> str:
    """Fill the gaps for fields upstream leaves undocumented."""
    status_parent = name.rsplit(".", 1)
    if len(status_parent) == 2 and status_parent[1] in {"background", "border"}:
        return f"{status_parent[1].capitalize()} color paired with `{status_parent[0]}`."
    vim = re.fullmatch(r"vim\.(\w+)\.(foreground|background)", name)
    if vim and vim.group(1) in VIM_MODES:
        mode = VIM_MODES[vim.group(1)]
        if vim.group(2) == "foreground":
            return f"Text color for the Vim {mode} mode indicator."
        return f"Background for the Vim {mode} mode indicator."
    return ""

SYNTAX_CAPTURES: list[tuple[str, str, str]] = [
    ("attribute", "Captures attributes", "docs"),
    ("boolean", "Captures boolean values", "docs"),
    ("comment", "Captures comments", "docs"),
    ("comment.doc", "Captures documentation comments", "docs"),
    ("constant", "Captures constants", "docs"),
    ("constant.builtin", "Captures built-in constants", "docs"),
    ("constructor", "Captures constructors", "docs"),
    ("embedded", "Captures embedded content", "docs"),
    ("emphasis", "Captures emphasized text", "docs"),
    ("emphasis.strong", "Captures strongly emphasized text", "docs"),
    ("enum", "Captures enumerations", "docs"),
    ("function", "Captures functions", "docs"),
    ("hint", "Captures hints", "docs"),
    ("keyword", "Captures keywords", "docs"),
    ("label", "Captures labels", "docs"),
    ("link_text", "Captures link text", "docs"),
    ("link_uri", "Captures link URIs", "docs"),
    ("number", "Captures numeric values", "docs"),
    ("operator", "Captures operators", "docs"),
    ("predictive", "Captures predictive text", "docs"),
    ("preproc", "Captures preprocessor directives", "docs"),
    ("primary", "Captures primary elements", "docs"),
    ("property", "Captures properties", "docs"),
    ("punctuation", "Captures punctuation", "docs"),
    ("punctuation.bracket", "Captures brackets", "docs"),
    ("punctuation.delimiter", "Captures delimiters", "docs"),
    ("punctuation.list_marker", "Captures list markers", "docs"),
    ("punctuation.special", "Captures special punctuation", "docs"),
    ("string", "Captures string literals", "docs"),
    ("string.escape", "Captures escaped characters in strings", "docs"),
    ("string.regex", "Captures regular expressions", "docs"),
    ("string.special", "Captures special strings", "docs"),
    ("string.special.symbol", "Captures special symbols", "docs"),
    ("tag", "Captures tags", "docs"),
    ("tag.doctype", "Captures doctypes (e.g. in HTML)", "docs"),
    ("text.literal", "Captures literal text", "docs"),
    ("title", "Captures titles", "docs"),
    ("type", "Captures types", "docs"),
    ("type.builtin", "Captures built-in types", "docs"),
    ("variable", "Captures variables", "docs"),
    ("variable.special", "Captures special variables", "docs"),
    ("variable.parameter", "Captures function/method parameters", "docs"),
    ("variant", "Captures variants", "docs"),
    # Not in the docs table, but used by Zed's bundled themes.
    ("diff.plus", "Added lines in a diff", "bundled"),
    ("diff.minus", "Removed lines in a diff", "bundled"),
    ("namespace", "Namespace / module names", "bundled"),
    ("punctuation.markup", "Markup punctuation", "bundled"),
    ("selector", "CSS-style selectors", "bundled"),
    ("selector.pseudo", "Pseudo selectors (:hover, ...)", "bundled"),
    ("function.builtin", "Built-in functions", "bundled"),
]


def fetch(ref: str) -> str:
    url = f"{ZED_REPO}/{ref}/{SOURCE_FILE}"
    print(f"fetching {url}", file=sys.stderr)
    with urllib.request.urlopen(url, timeout=30) as response:
        return response.read().decode()


def strip_doc(lines: list[str]) -> str:
    text = []
    for line in lines:
        text.append(re.sub(r"^\s*///\s?", "", line).rstrip())
    # Collapse the multi-paragraph doc comments into one line and drop code refs.
    joined = " ".join(part for part in text if part)
    joined = re.sub(r"`([^`]*)`", r"\1", joined)
    return re.sub(r"\s+", " ", joined).strip()


def parse_structs(source: str, wanted: set[str]) -> dict[str, list[dict[str, str]]]:
    lines = source.splitlines()
    structs: dict[str, list[dict[str, str]]] = {}
    i = 0
    while i < len(lines):
        header = re.match(r"pub struct (\w+)\s*\{", lines[i])
        if header is None or header.group(1) not in wanted:
            i += 1
            continue

        name = header.group(1)
        fields: list[dict[str, str]] = []
        docs: list[str] = []
        attrs: list[str] = []
        depth = lines[i].count("{") - lines[i].count("}")
        i += 1
        while i < len(lines) and depth > 0:
            line = lines[i]
            depth += line.count("{") - line.count("}")

            if line.strip().startswith("///"):
                docs.append(line)
                i += 1
                continue
            if line.strip().startswith("#["):
                attrs.append(line)
                # Attributes may wrap over several lines.
                while not re.search(r"\]\s*$", attrs[-1]) and i + 1 < len(lines):
                    i += 1
                    attrs.append(lines[i])
                i += 1
                continue

            field = re.match(r"\s*pub (\w+)\s*:\s*(.+?),?\s*$", line)
            if field:
                attr_text = " ".join(a.strip() for a in attrs)
                rename = re.search(r'rename\s*=\s*"([^"]+)"', attr_text)
                fields.append(
                    {
                        "name": rename.group(1) if rename else field.group(1),
                        "type": field.group(2).strip(),
                        "description": strip_doc(docs),
                        "flattened": "flatten" in attr_text,
                        "deprecated": "#[deprecated" in attr_text,
                    }
                )
                docs, attrs = [], []
                i += 1
                continue

            if line.strip() and not line.strip().startswith("//"):
                docs, attrs = [], []
            i += 1

        structs[name] = fields
        continue
    return structs


def group_for(token: str, struct_fields: dict[str, dict[str, str]]) -> str:
    for pattern, group in RULES:
        if pattern.match(token):
            return group
    if struct_fields[token].get("status"):
        return "status"
    return "misc"


def build(source: str, ref: str) -> dict:
    structs = parse_structs(
        source, {"ThemeStyleContent", "ThemeColorsContent", "StatusColorsContent"}
    )
    for required in ("ThemeStyleContent", "ThemeColorsContent", "StatusColorsContent"):
        if required not in structs:
            raise SystemExit(f"could not find struct {required} in the source (did Zed rename it?)")

    # Status fields first: they are flattened into the same object as colors, and
    # the grouping pass needs to know which ones they are.
    status_names = {field["name"] for field in structs["StatusColorsContent"]}

    tokens: dict[str, dict[str, object]] = {}

    def add(field: dict[str, str], *, status: bool, top_level: bool) -> None:
        tokens[field["name"]] = {
            "name": field["name"],
            "type": field["type"],
            "description": (
                field["description"]
                or DESCRIPTION_OVERRIDES.get(field["name"])
                or derive_description(field["name"])
            ),
            "status": status,
            "top_level": top_level,
            "deprecated": bool(field.get("deprecated")),
        }

    for field in structs["ThemeColorsContent"]:
        # `#[serde(flatten)]`-ed fields are plain style keys; the rest are
        # nested one level deep.
        if not field["flattened"] and field["name"] in {"accent", "background"}:
            pass
        add(field, status=False, top_level=True)

    for field in structs["StatusColorsContent"]:
        add(field, status=True, top_level=True)

    top_level = {}
    for field in structs["ThemeStyleContent"]:
        if field["name"] in {"colors", "status"}:
            continue
        top_level[field["name"]] = {
            "name": field["name"],
            "type": field["type"],
            "description": field["description"] or DESCRIPTION_OVERRIDES.get(field["name"], ""),
            "status": False,
            "top_level": True,
        }
        tokens.setdefault(field["name"], top_level[field["name"]])

    for name, field in top_level.items():
        tokens[name] = field

    ordered = sorted(
        tokens.values(),
        key=lambda token: (
            [group for group, _, _ in GROUPS].index(group_for(token["name"], tokens)),
            token["name"],
        ),
    )

    groups = []
    for group_id, title, blurb in GROUPS:
        members = [
            token
            for token in ordered
            if token["name"] not in COMPOSITE
            and group_for(token["name"], tokens) == group_id
        ]
        if group_id == "deprecated":
            for token in members:
                token["deprecated"] = True
        if members:
            groups.append({"id": group_id, "title": title, "description": blurb, "tokens": members})

    return {
        "zed_ref": ref,
        "source": SOURCE_FILE,
        "color_format": {
            "pattern": "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
            "examples": ["#fff", "#ffff", "#1e1e2e", "#1e1e2ecc"],
            "note": "3/4/6/8 hex digits. 4 and 8 digits carry an alpha channel. "
            "Unknown token names are silently ignored by Zed, so validate before installing.",
        },
        "groups": groups,
        "top_level": [tokens[name] for name in top_level]
        + [tokens[name] for name in ("accents", "players", "syntax") if name in tokens and name not in top_level],
        "syntax_captures": [
            {"name": name, "description": description, "source": source}
            for name, description, source in SYNTAX_CAPTURES
        ],
        "enums": {
            "appearance": ["light", "dark"],
            "background.appearance": ["opaque", "transparent", "blurred", "mica", "mica_alt"],
            "font_style": ["normal", "italic", "oblique"],
            "font_weight": [100, 200, 300, 400, 500, 600, 700, 800, 900],
        },
    }


def fenced(name: str) -> str:
    return f"`{name}`"


#: Rust type -> what the theme author actually needs to know.
TYPE_NAMES = {
    "Option<ThemeColor>": "color",
    "Option<WindowBackgroundContent>": "enum",
    "Vec<AccentContent>": "color[]",
    "Vec<PlayerColorContent>": "object[]",
    "IndexMap<String, HighlightStyleContent>": "object",
}


def friendly_type(rust_type: str) -> str:
    return TYPE_NAMES.get(rust_type, rust_type)


def slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def write_markdown(data: dict, path: Path) -> None:
    lines: list[str] = []
    add = lines.append

    add("# Zed theme tokens")
    add("")
    add(
        f"Every token Zed understands, extracted from `{data['source']}` at `{data['zed_ref']}` "
        "-- the same file Zed uses to deserialize themes."
    )
    add("")
    add("## Colors")
    add("")
    add(
        "Colors are hex strings: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`. "
        "The 8-digit form is how you get alpha."
    )
    add("")
    add(
        "**Zed silently ignores unknown keys.** A typo in a token name does not error, "
        "it just does nothing -- so run `python3 scripts/check-themes.py` before installing."
    )
    add("")
    add(
        "Note: the schema published at `https://zed.dev/schema/themes/v0.2.0.json` is stale "
        f"({len(data['groups']) and sum(len(g['tokens']) for g in data['groups'])} tokens here vs 142 there), "
        "so pointing `$schema` at it makes editors flag valid tokens. `scripts/gen-tokens.py` also "
        "writes `theme.schema.json` from this same source; reference it with "
        "`\"$schema\": \"../theme.schema.json\"` for autocomplete and typo checking while authoring."
    )
    add("")
    add(
        "**You do not have to set every token.** Zed refines your theme over the built-in "
        "default theme for the same `appearance`, so any token you leave out keeps its default "
        "value (`crates/theme_settings/src/theme_settings.rs`, `refine_theme`). A useful theme can "
        "be a few dozen keys; the generated themes here just fill in all of them as a template."
    )
    add("")
    add("## Contents")
    add("")
    for group in data["groups"]:
        add(f"- [{group['title']}](#{slug(group['title'])}) ({len(group['tokens'])})")
    add("- [Syntax captures](#syntax-captures) (%d)" % len(data["syntax_captures"]))
    add("- [Collaboration and index colors](#collaboration-and-index-colors)")
    add("- [Window background](#window-background)")
    add("")
    add("## Family and theme level keys")
    add("")
    add("A theme file is a *family* containing one or more themes:")
    add("")
    add("```json")
    add("{")
    add('  "name": "My Family",')
    add('  "author": "You",')
    add('  "themes": [')
    add("    {")
    add('      "name": "My Theme",')
    add('      "appearance": "dark",')
    add('      "style": { ... }')
    add("    }")
    add("  ]")
    add("}")
    add("```")
    add("")
    add("| Key | Type | Notes |")
    add("| --- | ---- | ----- |")
    add("| `name` | string | Family name (top level) or individual theme name |")
    add("| `author` | string | Top level only |")
    add("| `themes` | array | Top level only, one entry per variant |")
    add(f"| `appearance` | `light` or `dark` | Drives which built-in defaults apply |")
    add("| `style` | object | All tokens below live here |")
    add("")
    add("## Style tokens")
    add("")
    for group in data["groups"]:
        add(f"### {group['title']}")
        add("")
        add(group["description"])
        add("")
        add("| Token | Type | Description |")
        add("| ----- | ---- | ----------- |")
        for token in group["tokens"]:
            name = fenced(token["name"])
            if token.get("deprecated"):
                name += " *(deprecated)*"
            add(f"| {name} | `{friendly_type(token['type'])}` | {token['description']} |")
        add("")

    add("## Syntax captures")
    add("")
    add(
        "`style.syntax` maps a capture name to a highlight style object. Zed resolves captures "
        "right-to-left: if a grammar queries `@keyword.control` it uses that key when the theme "
        "defines it, otherwise it falls back to `@keyword`."
    )
    add("")
    add("```json")
    add('"syntax": {')
    add('  "keyword": { "color": "#cba6f7", "font_style": "italic", "font_weight": 600 },')
    add('  "comment": { "color": "#6c7086", "font_style": "italic" }')
    add("}")
    add("```")
    add("")
    add("Each capture accepts `color`, `background_color`, `font_style` and `font_weight`; all are optional.")
    add("")
    add("| Capture | Description |")
    add("| ------- | ----------- |")
    for capture in data["syntax_captures"]:
        add(f"| {fenced('@' + capture['name'])} | {capture['description']} |")
    add("")
    add(
        "Any other capture name is legal too -- a theme can define `@function.method` or "
        "`@variable.builtin` and grammars that query them pick it up. These are the names Zed's own "
        "docs and bundled themes use."
    )
    add("")

    add("## Collaboration and index colors")
    add("")
    add("| Token | Type | Description |")
    add("| ----- | ---- | ----------- |")
    for name in ("accents", "players"):
        token = next((t for t in data["top_level"] if t["name"] == name), None)
        if token:
            add(f"| {fenced(name)} | `{token['type']}` | {token['description']} |")
    add("")
    add("```json")
    add('"accents": ["#89b4fa", "#fab387", "#f5c2e7", "#a6e3a1", "#cba6f7"],')
    add('"players": [')
    add('  { "cursor": "#f5e0dc", "background": "#f5e0dc", "selection": "#585b70" }')
    add("]")
    add("```")
    add("")
    add("## Window background")
    add("")
    add(
        f"`background.appearance` is one of {fenced(' | '.join(data['enums']['background.appearance']))}. "
        "`transparent` and `blurred` only apply to the window itself, not the editor."
    )
    add("")

    path.write_text("\n".join(lines) + "\n")


def json_schema(data: dict) -> dict:
    """A draft-07 schema for theme families, from the parsed token list.

    The schema published at zed.dev is generated from an older release and is missing every
    token added since, so editors that validate against it flag valid themes. This one is built
    from the same source as TOKENS.md.
    """
    color = {
        "type": "string",
        "pattern": "^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
    }
    highlight = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "color": color,
            "background_color": color,
            "font_style": {"enum": ["normal", "italic", "oblique"]},
            "font_weight": {"type": "number", "minimum": 100, "maximum": 900},
        },
    }

    style: dict[str, object] = {}
    tokens = [token for group in data["groups"] for token in group["tokens"]]
    tokens += [token for token in data["top_level"] if token["name"] not in {t["name"] for t in tokens}]
    for token in tokens:
        name, kind = token["name"], friendly_type(token["type"])
        if name == "background.appearance":
            style[name] = {"enum": data["enums"]["background.appearance"]}
        elif kind == "color":
            style[name] = dict(color)
        elif kind == "color[]":
            style[name] = {"type": "array", "items": color}
        elif kind == "object[]":
            style[name] = {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {field: color for field in ("cursor", "background", "selection")},
                },
            }
        elif kind == "object":
            style[name] = {
                "type": "object",
                "properties": {capture["name"]: highlight for capture in data["syntax_captures"]},
                "additionalProperties": False,
            }
        else:
            raise ValueError(f"unhandled token type {token['type']!r} for {name}")

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "ThemeFamilyContent",
        "type": "object",
        "required": ["author", "name", "themes"],
        "properties": {
            "$schema": {"type": "string"},
            "name": {"type": "string"},
            "author": {"type": "string"},
            "themes": {"type": "array", "minItems": 1, "items": {"$ref": "#/definitions/ThemeContent"}},
        },
        "definitions": {
            "ThemeContent": {
                "type": "object",
                "required": ["name", "appearance", "style"],
                "additionalProperties": False,
                "properties": {
                    "name": {"type": "string"},
                    "appearance": {"enum": ["light", "dark"]},
                    "style": {"$ref": "#/definitions/ThemeStyleContent"},
                },
            },
            "ThemeStyleContent": {
                "type": "object",
                "additionalProperties": False,
                "properties": style,
            },
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="local copy of theme.rs to read instead of fetching")
    parser.add_argument("--ref", default=ZED_REF, help=f"Zed git tag to read (default {ZED_REF})")
    args = parser.parse_args()

    if args.source:
        source = args.source.read_text()
    else:
        source = fetch(args.ref)

    data = build(source, args.ref)
    (ROOT / "tokens.json").write_text(json.dumps(data, indent=2) + "\n")
    write_markdown(data, ROOT / "TOKENS.md")
    (ROOT / "theme.schema.json").write_text(json.dumps(json_schema(data), indent=2) + "\n")

    total = sum(len(group["tokens"]) for group in data["groups"])
    print(f"{total} style tokens, {len(data['syntax_captures'])} syntax captures")
    print("wrote tokens.json, TOKENS.md and theme.schema.json")
    if total < 100:
        raise SystemExit("token count looks wrong; did the upstream file move?")


if __name__ == "__main__":
    main()
