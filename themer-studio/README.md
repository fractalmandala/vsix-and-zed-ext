# Fractal Theme Studio

A visual editor for VS Code color theme JSON files.

Theme JSON is repetitive by nature: a single theme typically describes ~250 workbench
colors, but those colors resolve to only a handful of base values — one accent repeated
thirty times, one border color on every widget, each of those repeated again at half a
dozen alpha values. Editing that by hand means hunting down every occurrence.

Theme Studio inverts it. You edit the **base colors**, and every derived use follows.

## What it does

- **Works with nothing else installed.** It ships its own sample theme and falls back to it,
  so the editor always has a file to open and edit.
- **Loads a theme JSON** and indexes every color literal in it, recording both the base
  color and its alpha, and where it appears.
- **Palette-first editing.** The ~16 base colors behind 250+ tokens are presented as
  swatches. Change one and every use updates, alpha preserved (`#F0873A40` keeps its
  `40`).
- **Writing goes through `WorkspaceEdit`.** Undo, redo, dirty state, and save are all
  VS Code's own — a single ripple is a single undo step.
- **Nothing is written to `settings.json` permanently.** Preview is staged by default;
  the live preview is opt-in and always restored.
- **Round-trips faithfully.** Key order, `type`, every `tokenColors` scope and
  `fontStyle`, and the semantic token colors all survive.
- **Exports two ways**: a theme JSON, or a real theme extension installed into your
  editor so it shows up in the Color Theme picker.

## Usage

1. Run **Fractal Theme Studio: Open Editor** (or use the title-bar button on a theme file).
2. It opens, in order of preference:
   - the theme file you already have open,
   - the path in `fractalThemeStudio.defaultThemePath`,
   - its own bundled sample theme — copied into your workspace folder, or into a temp
     directory if you have no folder open, so edits never land in the installed extension.
3. Edit base colors in the palette; drill into groups for individual tokens.
4. Preview in the panel, or toggle **Preview in IDE** to see it on the real window.
5. **Save** writes back to the file, or export a new theme.

The bundled sample is also contributed as a real theme, so **Fractal Studio Sample** appears
in the Color Theme picker on its own — handy for trying the editor before you have a theme
of your own to work on.

## Commands

| Command | Description |
| --- | --- |
| **Fractal Theme Studio: Open Editor** | Open the visual editor for a theme JSON. |
| **Fractal Theme Studio: Export Theme JSON...** | Write the edited theme to a new file. |
| **Fractal Theme Studio: Install as Theme Extension...** | Install the theme so it appears in the Color Theme picker. |

## Settings

| Setting | Description |
| --- | --- |
| `fractalThemeStudio.defaultThemePath` | Absolute path to the theme JSON to open when no theme file is active. Leave empty to use the bundled sample theme. |

## Notes

- Theme Studio edits a **theme file**. It does not leave entries in
  `workbench.colorCustomizations`; a live preview is temporary and reverted.
- Remote/WSL windows work, but the theme is read from the file you open rather than from
  the theme currently applied in the window.

## Development

```bash
npm install --include=dev   # your environment sets NODE_ENV=production, which skips devDependencies
npm test                    # unit tests for the theme index, ripple engine and role model
npm run package             # builds fractal-theme-studio-0.1.0.vsix
```

## License

MIT
