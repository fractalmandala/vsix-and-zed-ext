# Zed theme tokens

Every token Zed understands, extracted from `crates/settings_content/src/theme.rs` at `v1.22.0` -- the same file Zed uses to deserialize themes.

## Colors

Colors are hex strings: `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`. The 8-digit form is how you get alpha.

**Zed silently ignores unknown keys.** A typo in a token name does not error, it just does nothing -- so run `python3 scripts/check-themes.py` before installing.

Note: the schema published at `https://zed.dev/schema/themes/v0.2.0.json` is stale (190 tokens here vs 142 there), so pointing `$schema` at it makes editors flag valid tokens. `scripts/gen-tokens.py` also writes `theme.schema.json` from this same source; reference it with `"$schema": "../theme.schema.json"` for autocomplete and typo checking while authoring.

**You do not have to set every token.** Zed refines your theme over the built-in default theme for the same `appearance`, so any token you leave out keeps its default value (`crates/theme_settings/src/theme_settings.rs`, `refine_theme`). A useful theme can be a few dozen keys; the generated themes here just fill in all of them as a template.

## Contents

- [Surfaces & chrome](#surfaces-chrome) (20)
- [Borders](#borders) (6)
- [Text](#text) (5)
- [Icons](#icons) (5)
- [Elements](#elements) (13)
- [Editor](#editor) (26)
- [Search](#search) (2)
- [Scrollbars](#scrollbars) (6)
- [Terminal](#terminal) (29)
- [Status & diagnostics](#status-diagnostics) (42)
- [Version control](#version-control) (10)
- [Minimap](#minimap) (4)
- [Vim modes](#vim-modes) (18)
- [Links](#links) (1)
- [Deprecated aliases](#deprecated-aliases) (3)
- [Syntax captures](#syntax-captures) (50)
- [Collaboration and index colors](#collaboration-and-index-colors)
- [Window background](#window-background)

## Family and theme level keys

A theme file is a *family* containing one or more themes:

```json
{
  "name": "My Family",
  "author": "You",
  "themes": [
    {
      "name": "My Theme",
      "appearance": "dark",
      "style": { ... }
    }
  ]
}
```

| Key | Type | Notes |
| --- | ---- | ----- |
| `name` | string | Family name (top level) or individual theme name |
| `author` | string | Top level only |
| `themes` | array | Top level only, one entry per variant |
| `appearance` | `light` or `dark` | Drives which built-in defaults apply |
| `style` | object | All tokens below live here |

## Style tokens

### Surfaces & chrome

Window, panel, tab and title bar backgrounds.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `background` | `color` | Background Color. Used for the app background and blank panels or windows. |
| `background.appearance` | `enum` | How the window background is composited: opaque, transparent, blurred, mica, mica_alt. |
| `elevated_surface.background` | `color` | Background color. Used for elevated surfaces, like a context menu, popup, or dialog. |
| `pane.focused_border` | `color` | Border drawn around the focused editor pane. |
| `pane_group.border` | `color` | Border between split groups of panes. |
| `panel.background` | `color` | Background for side and bottom panels (project panel, terminal panel, ...). |
| `panel.focused_border` | `color` | Border drawn around the focused panel. |
| `panel.indent_guide` | `color` | Indent guide color inside panels. |
| `panel.indent_guide_active` | `color` | Indent guide color for the active level inside panels. |
| `panel.indent_guide_hover` | `color` | Indent guide color while hovered inside panels. |
| `panel.overlay_background` | `color` | Background for overlay panels drawn on top of the editor. |
| `panel.overlay_hover` | `color` | Hover color for overlay panels. |
| `status_bar.background` | `color` | Background for the status bar at the bottom of the window. |
| `surface.background` | `color` | Background Color. Used for grounded surfaces like a panel or tab. |
| `tab.active_background` | `color` | Background for the active tab. |
| `tab.inactive_background` | `color` | Background for inactive tabs. |
| `tab_bar.background` | `color` | Background for the tab bar. |
| `title_bar.background` | `color` | Background for the title bar of the active window. |
| `title_bar.inactive_background` | `color` | Background for the title bar of inactive windows. |
| `toolbar.background` | `color` | Background for toolbars, such as the breadcrumb bar above the editor. |

### Borders

Border colors for every interaction state.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `border` | `color` | Border color. Used for most borders, is usually a high contrast color. |
| `border.disabled` | `color` | Border color. Used for disabled elements, like a disabled input or button. |
| `border.focused` | `color` | Border color. Used for focused elements, like keyboard focused list item. |
| `border.selected` | `color` | Border color. Used for selected elements, like an active search filter or selected checkbox. |
| `border.transparent` | `color` | Border color. Used for transparent borders. Used for placeholder borders when an element gains a border on state change. |
| `border.variant` | `color` | Border color. Used for deemphasized borders, like a visual divider between two sections |

### Text

Foreground colors for UI copy (not syntax).

| Token | Type | Description |
| ----- | ---- | ----------- |
| `text` | `color` | Text Color. Default text color used for most text. |
| `text.accent` | `color` | Text Color. Color used for emphasis or highlighting certain text, like an active filter or a matched character in a search. |
| `text.disabled` | `color` | Text Color. Color used for text denoting disabled elements. Typically, the color is faded or grayed out to emphasize the disabled state. |
| `text.muted` | `color` | Text Color. Color of muted or deemphasized text. It is a subdued version of the standard text color. |
| `text.placeholder` | `color` | Text Color. Color of the placeholder text typically shown in input fields to guide the user to enter valid data. |

### Icons

Icon colors, mirroring the text tokens.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `icon` | `color` | Fill Color. Used for the default fill color of an icon. |
| `icon.accent` | `color` | Fill Color. Used for the accent fill color of an icon. This might be used to show when a toggleable icon button is selected. |
| `icon.disabled` | `color` | Fill Color. Used for the disabled fill color of an icon. Disabled states are shown when a user cannot interact with an element, like a icon button. |
| `icon.muted` | `color` | Fill Color. Used for the muted or deemphasized fill color of an icon. This might be used to show an icon in an inactive pane, or to deemphasize a series of icons to give them less visual weight. |
| `icon.placeholder` | `color` | Fill Color. Used for the placeholder fill color of an icon. This might be used to show an icon in an input that disappears when the user enters text. |

### Elements

Buttons, inputs, checkboxes and other controls.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `drop_target.background` | `color` | Background Color. Used for the area that shows where a dragged element will be dropped. |
| `drop_target.border` | `color` | Border Color. Used for the border that shows where a dragged element will be dropped. |
| `element.active` | `color` | Background Color. Used for the active state of an element that should have a different background than the surface it's on. Active states are triggered by the mouse button being pressed down on an element, or the Return button or other activator being pressed. |
| `element.background` | `color` | Background Color. Used for the background of an element that should have a different background than the surface it's on. Elements might include: Buttons, Inputs, Checkboxes, Radio Buttons... For an element that should have the same background as the surface it's on, use ghost_element_background. |
| `element.disabled` | `color` | Background Color. Used for the disabled state of an element that should have a different background than the surface it's on. Disabled states are shown when a user cannot interact with an element, like a disabled button or input. |
| `element.hover` | `color` | Background Color. Used for the hover state of an element that should have a different background than the surface it's on. Hover states are triggered by the mouse entering an element, or a finger touching an element on a touch screen. |
| `element.selected` | `color` | Background Color. Used for the selected state of an element that should have a different background than the surface it's on. Selected states are triggered by the element being selected (or "activated") by the user. This could include a selected checkbox, a toggleable button that is toggled on, etc. |
| `element.selection_background` | `color` | Background Color. Used for the background of selections in a UI element. |
| `ghost_element.active` | `color` | Background Color. Used for the active state of a ghost element that should have the same background as the surface it's on. Active states are triggered by the mouse button being pressed down on an element, or the Return button or other activator being pressed. |
| `ghost_element.background` | `color` | Used for the background of a ghost element that should have the same background as the surface it's on. Elements might include: Buttons, Inputs, Checkboxes, Radio Buttons... For an element that should have a different background than the surface it's on, use element_background. |
| `ghost_element.disabled` | `color` | Background Color. Used for the disabled state of a ghost element that should have the same background as the surface it's on. Disabled states are shown when a user cannot interact with an element, like a disabled button or input. |
| `ghost_element.hover` | `color` | Background Color. Used for the hover state of a ghost element that should have the same background as the surface it's on. Hover states are triggered by the mouse entering an element, or a finger touching an element on a touch screen. |
| `ghost_element.selected` | `color` | Background Color. Used for the selected state of a ghost element that should have the same background as the surface it's on. Selected states are triggered by the element being selected (or "activated") by the user. This could include a selected checkbox, a toggleable button that is toggled on, etc. |

### Editor

The text buffer: background, gutter, guides, highlights.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `debugger.accent` | `color` | Color used to accent some of the debuggers elements Only accent breakpoint & breakpoint related symbols right now |
| `editor.active_line.background` | `color` | Background for the line containing the cursor. |
| `editor.active_line_number` | `color` | Text Color. Used for the text of the line number in the editor gutter when the line is highlighted. |
| `editor.active_wrap_guide` | `color` | Vertical guide at the active wrap column (buffer width when soft wrap is set to a custom width). |
| `editor.background` | `color` | Background for the editor. |
| `editor.code_lens.foreground` | `color` | Text color used for CodeLens items in the editor. |
| `editor.debugger_active_line.background` | `color` | Background of active line of debugger |
| `editor.diff_hunk.added.background` | `color` | Filled background color for added diff hunk row highlights in the editor. |
| `editor.diff_hunk.added.hollow_background` | `color` | Hollow background color for added diff hunk row highlights in the editor. |
| `editor.diff_hunk.added.hollow_border` | `color` | Hollow border color for added diff hunk row highlights in the editor. |
| `editor.diff_hunk.deleted.background` | `color` | Filled background color for deleted diff hunk row highlights in the editor. |
| `editor.diff_hunk.deleted.hollow_background` | `color` | Hollow background color for deleted diff hunk row highlights in the editor. |
| `editor.diff_hunk.deleted.hollow_border` | `color` | Hollow border color for deleted diff hunk row highlights in the editor. |
| `editor.document_highlight.bracket_background` | `color` | Highlighted brackets background color. Matching brackets in the cursor scope are highlighted with this background color. |
| `editor.document_highlight.read_background` | `color` | Read-access of a symbol, like reading a variable. A document highlight is a range inside a text document which deserves special attention. Usually a document highlight is visualized by changing the background color of its range. |
| `editor.document_highlight.write_background` | `color` | Read-access of a symbol, like reading a variable. A document highlight is a range inside a text document which deserves special attention. Usually a document highlight is visualized by changing the background color of its range. |
| `editor.foreground` | `color` | Default text color in the editor, used when no syntax capture matches. |
| `editor.gutter.background` | `color` | Background for the gutter (line numbers and diff markers). |
| `editor.highlighted_line.background` | `color` | Background for other lines highlighted at the cursor, such as matching occurrences. |
| `editor.hover_line_number` | `color` | Text Color. Used for the text of the line number in the editor gutter when the line is hovered over. |
| `editor.indent_guide` | `color` | Vertical guides at each indent level. |
| `editor.indent_guide_active` | `color` | Guide for the indent level the cursor is inside. |
| `editor.invisible` | `color` | Text Color. Used to mark invisible characters in the editor. Example: spaces, tabs, carriage returns, etc. |
| `editor.line_number` | `color` | Text Color. Used for the text of the line number in the editor gutter. |
| `editor.subheader.background` | `color` | Background for editor subheaders, such as buffer search or inline blame rows. |
| `editor.wrap_guide` | `color` | Vertical guide at the wrap column. |

### Search

Match highlighting inside the editor.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `search.active_match_background` | `color` | Background for the search match the cursor is on. |
| `search.match_background` | `color` | Background for search matches. |

### Scrollbars

Scrollbar thumb and track.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `scrollbar.thumb.active_background` | `color` | The color of the scrollbar thumb whilst being actively dragged. |
| `scrollbar.thumb.background` | `color` | The color of the scrollbar thumb. |
| `scrollbar.thumb.border` | `color` | The border color of the scrollbar thumb. |
| `scrollbar.thumb.hover_background` | `color` | The color of the scrollbar thumb when hovered over. |
| `scrollbar.track.background` | `color` | The background color of the scrollbar track. |
| `scrollbar.track.border` | `color` | The border color of the scrollbar track. |

### Terminal

The integrated terminal, including all ANSI slots.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `terminal.ansi.background` | `color` | Terminal ANSI background color. |
| `terminal.ansi.black` | `color` | Black ANSI terminal color. |
| `terminal.ansi.blue` | `color` | Blue ANSI terminal color. |
| `terminal.ansi.bright_black` | `color` | Bright black ANSI terminal color. |
| `terminal.ansi.bright_blue` | `color` | Bright blue ANSI terminal color. |
| `terminal.ansi.bright_cyan` | `color` | Bright cyan ANSI terminal color. |
| `terminal.ansi.bright_green` | `color` | Bright green ANSI terminal color. |
| `terminal.ansi.bright_magenta` | `color` | Bright magenta ANSI terminal color. |
| `terminal.ansi.bright_red` | `color` | Bright red ANSI terminal color. |
| `terminal.ansi.bright_white` | `color` | Bright white ANSI terminal color. |
| `terminal.ansi.bright_yellow` | `color` | Bright yellow ANSI terminal color. |
| `terminal.ansi.cyan` | `color` | Cyan ANSI terminal color. |
| `terminal.ansi.dim_black` | `color` | Dim black ANSI terminal color. |
| `terminal.ansi.dim_blue` | `color` | Dim blue ANSI terminal color. |
| `terminal.ansi.dim_cyan` | `color` | Dim cyan ANSI terminal color. |
| `terminal.ansi.dim_green` | `color` | Dim green ANSI terminal color. |
| `terminal.ansi.dim_magenta` | `color` | Dim magenta ANSI terminal color. |
| `terminal.ansi.dim_red` | `color` | Dim red ANSI terminal color. |
| `terminal.ansi.dim_white` | `color` | Dim white ANSI terminal color. |
| `terminal.ansi.dim_yellow` | `color` | Dim yellow ANSI terminal color. |
| `terminal.ansi.green` | `color` | Green ANSI terminal color. |
| `terminal.ansi.magenta` | `color` | Magenta ANSI terminal color. |
| `terminal.ansi.red` | `color` | Red ANSI terminal color. |
| `terminal.ansi.white` | `color` | White ANSI terminal color. |
| `terminal.ansi.yellow` | `color` | Yellow ANSI terminal color. |
| `terminal.background` | `color` | Terminal background color. |
| `terminal.bright_foreground` | `color` | Bright terminal foreground color. |
| `terminal.dim_foreground` | `color` | Dim terminal foreground color. |
| `terminal.foreground` | `color` | Terminal foreground color. |

### Status & diagnostics

Semantic colors: errors, warnings, diff hunk states.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `conflict` | `color` | Indicates some kind of conflict, like a file changed on disk while it was open, or merge conflicts in a Git repository. |
| `conflict.background` | `color` | Background color paired with `conflict`. |
| `conflict.border` | `color` | Border color paired with `conflict`. |
| `created` | `color` | Indicates something new, like a new file added to a Git repository. |
| `created.background` | `color` | Background color paired with `created`. |
| `created.border` | `color` | Border color paired with `created`. |
| `deleted` | `color` | Indicates that something no longer exists, like a deleted file. |
| `deleted.background` | `color` | Background color paired with `deleted`. |
| `deleted.border` | `color` | Border color paired with `deleted`. |
| `error` | `color` | Indicates a system error, a failed operation or a diagnostic error. |
| `error.background` | `color` | Background color paired with `error`. |
| `error.border` | `color` | Border color paired with `error`. |
| `hidden` | `color` | Represents a hidden status, such as a file being hidden in a file tree. |
| `hidden.background` | `color` | Background color paired with `hidden`. |
| `hidden.border` | `color` | Border color paired with `hidden`. |
| `hint` | `color` | Indicates a hint or some kind of additional information. |
| `hint.background` | `color` | Background color paired with `hint`. |
| `hint.border` | `color` | Border color paired with `hint`. |
| `ignored` | `color` | Indicates that something is deliberately ignored, such as a file or operation ignored by Git. |
| `ignored.background` | `color` | Background color paired with `ignored`. |
| `ignored.border` | `color` | Border color paired with `ignored`. |
| `info` | `color` | Represents informational status updates or messages. |
| `info.background` | `color` | Background color paired with `info`. |
| `info.border` | `color` | Border color paired with `info`. |
| `modified` | `color` | Indicates a changed or altered status, like a file that has been edited. |
| `modified.background` | `color` | Background color paired with `modified`. |
| `modified.border` | `color` | Border color paired with `modified`. |
| `predictive` | `color` | Indicates something that is predicted, like automatic code completion, or generated code. |
| `predictive.background` | `color` | Background color paired with `predictive`. |
| `predictive.border` | `color` | Border color paired with `predictive`. |
| `renamed` | `color` | Represents a renamed status, such as a file that has been renamed. |
| `renamed.background` | `color` | Background color paired with `renamed`. |
| `renamed.border` | `color` | Border color paired with `renamed`. |
| `success` | `color` | Indicates a successful operation or task completion. |
| `success.background` | `color` | Background color paired with `success`. |
| `success.border` | `color` | Border color paired with `success`. |
| `unreachable` | `color` | Indicates some kind of unreachable status, like a block of code that can never be reached. |
| `unreachable.background` | `color` | Background color paired with `unreachable`. |
| `unreachable.border` | `color` | Border color paired with `unreachable`. |
| `warning` | `color` | Represents a warning status, like an operation that is about to fail. |
| `warning.background` | `color` | Background color paired with `warning`. |
| `warning.border` | `color` | Border color paired with `warning`. |

### Version control

Git status and inline diff decorations.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `version_control.added` | `color` | Added version control color. |
| `version_control.conflict` | `color` | Conflict version control color. |
| `version_control.conflict_marker.ours` | `color` | Background color for row highlights of "ours" regions in merge conflicts. |
| `version_control.conflict_marker.theirs` | `color` | Background color for row highlights of "theirs" regions in merge conflicts. |
| `version_control.deleted` | `color` | Deleted version control color. |
| `version_control.ignored` | `color` | Ignored version control color. |
| `version_control.modified` | `color` | Modified version control color. |
| `version_control.renamed` | `color` | Renamed version control color. |
| `version_control.word_added` | `color` | Color for added words in word diffs. |
| `version_control.word_deleted` | `color` | Color for deleted words in word diffs. |

### Minimap

The minimap strip beside the editor.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `minimap.thumb.active_background` | `color` | The color of the minimap thumb whilst being actively dragged. |
| `minimap.thumb.background` | `color` | The color of the minimap thumb. |
| `minimap.thumb.border` | `color` | The border color of the minimap thumb. |
| `minimap.thumb.hover_background` | `color` | The color of the minimap thumb when hovered over. |

### Vim modes

The Vim mode indicator, shown when Vim mode is enabled.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `vim.helix_jump_label.foreground` | `color` | Foreground color for Helix jump labels. |
| `vim.helix_normal.background` | `color` | Background color for Vim Helix Normal mode indicator. |
| `vim.helix_normal.foreground` | `color` | Foreground color for Vim Helix Normal mode indicator. |
| `vim.helix_select.background` | `color` | Background color for Vim Helix Select mode indicator. |
| `vim.helix_select.foreground` | `color` | Foreground color for Vim Helix Select mode indicator. |
| `vim.insert.background` | `color` | Background color for Vim Insert mode indicator. |
| `vim.insert.foreground` | `color` | Foreground color for Vim Insert mode indicator. |
| `vim.normal.background` | `color` | Background color for Vim Normal mode indicator. |
| `vim.normal.foreground` | `color` | Background color for Vim Normal mode indicator. |
| `vim.replace.background` | `color` | Background color for Vim Replace mode indicator. |
| `vim.replace.foreground` | `color` | Foreground color for Vim Replace mode indicator. |
| `vim.visual.background` | `color` | Background color for Vim Visual mode indicator. |
| `vim.visual.foreground` | `color` | Foreground color for Vim Visual mode indicator. |
| `vim.visual_block.background` | `color` | Background color for Vim Visual Block mode indicator. |
| `vim.visual_block.foreground` | `color` | Foreground color for Vim Visual Block mode indicator. |
| `vim.visual_line.background` | `color` | Background color for Vim Visual Line mode indicator. |
| `vim.visual_line.foreground` | `color` | Foreground color for Vim Visual Line mode indicator. |
| `vim.yank.background` | `color` | Background color for Vim yank highlight. |

### Links

Hover color for links in the UI.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `link_text.hover` | `color` | Color for links while hovered. |

### Deprecated aliases

Still parsed, but superseded. Prefer the replacement.

| Token | Type | Description |
| ----- | ---- | ----------- |
| `scrollbar_thumb.background` *(deprecated)* | `color` | The deprecated version of scrollbar.thumb.background. Don't use this field. |
| `version_control_conflict_ours_background` *(deprecated)* | `color` | Deprecated in favor of version_control_conflict_marker_ours. |
| `version_control_conflict_theirs_background` *(deprecated)* | `color` | Deprecated in favor of version_control_conflict_marker_theirs. |

## Syntax captures

`style.syntax` maps a capture name to a highlight style object. Zed resolves captures right-to-left: if a grammar queries `@keyword.control` it uses that key when the theme defines it, otherwise it falls back to `@keyword`.

```json
"syntax": {
  "keyword": { "color": "#cba6f7", "font_style": "italic", "font_weight": 600 },
  "comment": { "color": "#6c7086", "font_style": "italic" }
}
```

Each capture accepts `color`, `background_color`, `font_style` and `font_weight`; all are optional.

| Capture | Description |
| ------- | ----------- |
| `@attribute` | Captures attributes |
| `@boolean` | Captures boolean values |
| `@comment` | Captures comments |
| `@comment.doc` | Captures documentation comments |
| `@constant` | Captures constants |
| `@constant.builtin` | Captures built-in constants |
| `@constructor` | Captures constructors |
| `@embedded` | Captures embedded content |
| `@emphasis` | Captures emphasized text |
| `@emphasis.strong` | Captures strongly emphasized text |
| `@enum` | Captures enumerations |
| `@function` | Captures functions |
| `@hint` | Captures hints |
| `@keyword` | Captures keywords |
| `@label` | Captures labels |
| `@link_text` | Captures link text |
| `@link_uri` | Captures link URIs |
| `@number` | Captures numeric values |
| `@operator` | Captures operators |
| `@predictive` | Captures predictive text |
| `@preproc` | Captures preprocessor directives |
| `@primary` | Captures primary elements |
| `@property` | Captures properties |
| `@punctuation` | Captures punctuation |
| `@punctuation.bracket` | Captures brackets |
| `@punctuation.delimiter` | Captures delimiters |
| `@punctuation.list_marker` | Captures list markers |
| `@punctuation.special` | Captures special punctuation |
| `@string` | Captures string literals |
| `@string.escape` | Captures escaped characters in strings |
| `@string.regex` | Captures regular expressions |
| `@string.special` | Captures special strings |
| `@string.special.symbol` | Captures special symbols |
| `@tag` | Captures tags |
| `@tag.doctype` | Captures doctypes (e.g. in HTML) |
| `@text.literal` | Captures literal text |
| `@title` | Captures titles |
| `@type` | Captures types |
| `@type.builtin` | Captures built-in types |
| `@variable` | Captures variables |
| `@variable.special` | Captures special variables |
| `@variable.parameter` | Captures function/method parameters |
| `@variant` | Captures variants |
| `@diff.plus` | Added lines in a diff |
| `@diff.minus` | Removed lines in a diff |
| `@namespace` | Namespace / module names |
| `@punctuation.markup` | Markup punctuation |
| `@selector` | CSS-style selectors |
| `@selector.pseudo` | Pseudo selectors (:hover, ...) |
| `@function.builtin` | Built-in functions |

Any other capture name is legal too -- a theme can define `@function.method` or `@variable.builtin` and grammars that query them pick it up. These are the names Zed's own docs and bundled themes use.

## Collaboration and index colors

| Token | Type | Description |
| ----- | ---- | ----------- |
| `accents` | `Vec<AccentContent>` | Ordered palette used for indent guides, collaboration and other index-based coloring. |
| `players` | `Vec<PlayerColorContent>` | Per-collaborator cursor/selection colors. Zed assigns these in order as people join. |

```json
"accents": ["#89b4fa", "#fab387", "#f5c2e7", "#a6e3a1", "#cba6f7"],
"players": [
  { "cursor": "#f5e0dc", "background": "#f5e0dc", "selection": "#585b70" }
]
```

## Window background

`background.appearance` is one of `opaque | transparent | blurred | mica | mica_alt`. `transparent` and `blurred` only apply to the window itself, not the editor.

