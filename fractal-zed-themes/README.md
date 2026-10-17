# Fractal Themes for Zed

Zed extension with themes.

```
extension.toml        # extension manifest (themes/ is auto-discovered, no [[themes]] entries needed)
themes/*.json         # one file per theme family
TOKENS.md             # every color token Zed understands (generated)
tokens.json           # same data, machine-readable
theme.schema.json     # JSON schema for autocomplete/validation while authoring (generated)
scripts/gen-tokens.py # regenerates TOKENS.md, tokens.json and theme.schema.json from Zed's theme source
scripts/new-theme.py  # generates a complete theme family from a small palette
scripts/import-themepacks.py # converts the Vecta and Fracta collections from themepacks
scripts/check-themes.py
```

## 1. Install it in Zed

1. Open the command palette (`cmd-shift-p`) and run **`zed: install dev extension`**.
2. Pick this folder.

## 2. Author a theme

Read **[TOKENS.md](TOKENS.md)** for every token name, its type, and what it does. Two things worth
knowing up front:

- **Zed silently ignores unknown keys.** A typo does nothing and reports nothing, so run the checker before installing.
- **You only need to set the tokens you care about.** Zed refines your theme over the built-in default theme for the same `appearance`; omitted tokens keep their default values. `Token | Type | Description` in TOKENS.md is the complete surface, not a required checklist.

Minimal theme file (`themes/my-theme.json`):

```json
{
  "$schema": "../theme.schema.json",
  "name": "My Theme",
  "author": "You",
  "themes": [
    {
      "name": "My Theme",
      "appearance": "dark",
      "style": {
        "background": "#111111",
        "surface.background": "#1a1a1a",
        "editor.background": "#111111",
        "editor.foreground": "#dddddd",
        "text": "#dddddd",
        "text.muted": "#888888",
        "border": "#2a2a2a",
        "element.background": "#202020",
        "terminal.background": "#111111",
        "terminal.foreground": "#dddddd",
        "accents": ["#a78bfa"],
        "syntax": {
          "keyword": { "color": "#c792ea" },
          "string": { "color": "#7ddba3" },
          "comment": { "color": "#5b5e73", "font_style": "italic" }
        }
      }
    }
  ]
}
```

A family may contain several themes (for example a dark one and a light one).
The `$schema` line is optional and only affects your editor. Point it at this repo's
`theme.schema.json` rather than the URL Zed publishes.

### Generate a complete theme

`new-theme.py` fills every token from a small palette, which is a convenient starting point to edit down:

```bash
python3 scripts/new-theme.py --list-palettes
python3 scripts/new-theme.py --name "My Theme" --out themes/my-theme.json
python3 scripts/new-theme.py --name "My Light" --appearance light --palette paper --out themes/my-light.json
```

To change colors, edit the palette dictionaries at the top of `new-theme.py` (or just edit the generated JSON).

### Existing collections

**Vecta** (38 families) and **Fracta** (19 families) — 57 files, 114 themes, each family holding its light and dark variant. Regenerate them with:

```bash
python3 scripts/import-themepacks.py              # both collections
python3 scripts/import-themepacks.py --collection vecta
python3 scripts/import-themepacks.py --dry-run    # list what would be written
```

Families are named `<Source> <stem>` (for example `Vecta Himalaya`, `Fracta Bone`) so the picker stays grouped, and the importer uses the same builder as `new-theme.py`, so every token is filled in.

The mapping is name-to-name, but each collection is missing something a Zed theme needs, so the importer derives it rather than leaving gaps:

- **Vecta** has complete UI semantics (nine background tiers, four text tiers, borders, success / warning / danger / info) but no syntax palette. Its syntax captures are mapped onto its own accents: `comment`←`text-muted`, `string`←`success`, `keyword`←`theme-color-alt`, `number`←`warning`, `function`←`info`, `tag`←`danger`.
- **Fracta** is syntax-first — its color names *are* capture names (`fn`, `key`, `num`, `op`, `prop`, `punct`, `str`, `type`) — but ships no red. Its six semantic anchors (`error`, `warning`, `success`, `info`, `hint`, `predictive`) are chosen from the theme's own chromatic colors by hue band. 

When a theme genuinely lacks a hue - Green Lantern is all green, Newsprint is grey + red, Monoline Ink is achromatic - the importer rotates the most saturated color to that hue keeping its lightness, or keeps the neutral fallback. So a green theme still gets a red error, and a monochrome theme stays monochrome.

Re-running is safe: it only rewrites `themes/vecta-*.json` and `themes/fracta-*.json`.

## 3. Check before installing

```bash
python3 scripts/check-themes.py            # validates themes/*.json
python3 scripts/check-themes.py path.json  # or specific files
```

It reports unknown token names (with a closest-match suggestion), invalid hex colors, bad `appearance` / `font_style` / `font_weight` values, unknown syntax captures, and missing required fields - everything Zed would otherwise ignore in silence.

## 4. Regenerating the token list (after a Zed upgrade)

```bash
python3 scripts/gen-tokens.py                    # fetches the pinned v1.22.0 source
python3 scripts/gen-tokens.py --ref v1.23.0      # or another tag
python3 scripts/gen-tokens.py --source /path/to/zed/crates/settings_content/src/theme.rs
```

Regenerating also refreshes `theme.schema.json`, so editor autocomplete keeps matching the Zed you run.

The list is generated from `crates/settings_content/src/theme.rs` in the Zed release that is actually installed (currently **v1.22.0**), not from the schema published on zed.dev - that one is stale.


## Commands

- Dev: TODO
- Desktop: TODO
- Build: TODO
