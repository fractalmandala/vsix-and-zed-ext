# Changelog

## 0.2.2

- Workbench, Syntax and Semantic entries are the same card as the palette: swatch
  beside a stack of label, hex and meta rows. Nothing is squeezed onto one line,
  so no label is clipped.
- The whole card opens the color editor, not just the swatch; Source stays in the
  meta row and reveals the exact line.

## 0.2.1

- Live preview actually changes the window now: previewing switches the editor to
  the theme you are editing, because customizations only recolor the active theme.
- Edits show up in the preview as soon as you hit Apply, not only when the preview
  is toggled on. The document is saved before each refresh.
- Preview survives hiding or moving the panel; stopping it — or exiting the
  editor — restores your previous theme and settings exactly.
- Reset button in the color popover, next to Apply, puts a color back the way it
  was before you started editing it.

## 0.2.0

- Fixed the color popover: clicking a swatch or token now opens the editor
  instead of immediately closing it.
- Cmd/Ctrl+Z undoes the last color change through the editor's own undo history.
- Three-column grid for the palette and every token view; groups render open
  instead of collapsed, and single-group tabs skip the group heading.
- Load button to switch the studio to another theme JSON; the bundled sample
  still opens automatically when no theme file is active.

## 0.1.0

Initial release.

- Open any VS Code color theme JSON in a visual editor panel.
- Bundled sample theme, so the editor always has a file to open with no setup.
- The sample is also contributed as a real theme, so it shows in the Color Theme picker.
- Palette-first editing: work in base colors, not hundreds of tokens.
- Ripple edits: changing a base color rewrites every derived use, alpha preserved.
- Grouped views for workbench colors, syntax tokens, and semantic tokens.
- Staged preview in a mock IDE, with an opt-in live preview of the real window.
- Export the edited theme as a faithful theme JSON.
- Install the current colors as a real theme extension so it appears in the
  Color Theme picker.
