# OKLCH Lab

Convert any colour between **HEX**, **RGB(A)**, **HSL(A)** and **OKLCH**, and explore the OKLCH space with live gamut graphs - in the VS Code / VSCodium sidebar, bottom panel, or an editor tab.

## Convert

Four fields - `OKLCH`, `HEX`, `RGB`, `HSL` - are all editable. Type or paste **any** supported format into **any** field and the other three follow. Invalid input is flagged but never clobbers the colour you already have.

| Format | Accepted input |
| --- | --- |
| HEX | `#79af75` `79af75` `#7af` `#79af75cc` `#7afc` |
| RGB | `rgb(121, 175, 117)` `rgba(121,175,117,.5)` `rgb(121 175 117 / 50%)` `rgb(47% 69% 46%)` `121 175 117` |
| HSL | `hsl(116, 26%, 57%)` `hsla(116 26% 57% / .5)` hue in `deg` `rad` `grad` `turn` |
| OKLCH | `oklch(0.7 0.1 143)` `oklch(70% 25% 143deg / 0.5)` |
| Names | `rebeccapurple`, `tomato`, … (anything the browser knows) |

- **Lossless round trip.** Every 8-bit sRGB colour goes `hex → oklch → hex` unchanged (tested on 140 000 colours) — OKLCH is printed with 5 decimals on L and C, the smallest precision that guarantees it.
- **Out-of-gamut colours** (a vivid `oklch()` that sRGB cannot show) are mapped into sRGB for HEX / RGB / HSL with the CSS Color 4 gamut-mapping algorithm, and the converter tells you when that happened and which wide gamut the colour lives in (Display P3 / Rec.2020).
- Hover a field to **copy** it or **insert** it at the cursor of the last active editor.

## Explore

Lightness, Chroma, Hue and Alpha each get a numeric field, a slider, and (for L, C and H) a
**gamut cross-section** of the other two channels:
- **Lightness** — Chroma vs Lightness at the current hue
- **Chroma** — Chroma vs Hue at the current lightness
- **Hue** — Lightness vs Hue at the current chroma

Drag inside a graph to move two channels at once; drag a slider, type a number, or use
`←` `→` (`Shift` ×10, `PgUp`/`PgDn`, `Home`/`End`) on a focused slider. Gaps in a slider or graph are colours outside the gamut. Toggles:

| Toggle | Does |
| --- | --- |
| Show 3D | Rotatable point-cloud of the gamut solid, with your colour marked (drag; double-click resets) |
| Show graphs | Hide the cross-sections and keep just sliders |
| Show P3 | Add the Display P3 gamut (outlines nest: sRGB inside P3) |
| Show Rec2020 | Add the Rec.2020 gamut |

On a wide-gamut display the P3 areas are drawn in real P3 colour.

## In the editor

| Command | Does |
| --- | --- |
| **OKLCH Lab: Convert Color…** (right-click menu) | Convert each selected colour — or the colour under the cursor, no selection needed — to HEX / RGB / HSL / OKLCH. Works with multiple cursors. |
| **OKLCH Lab: Open Selected Color in OKLCH Lab** (right-click menu) | Load the selected colour into the explorer |
| **OKLCH Lab: Insert Current Color…** | Insert the explorer's colour in a chosen format. Accepts a string argument for keybindings. |
| **OKLCH Lab: Open in Editor Tab** | The same UI as a full editor tab |
| **OKLCH Lab: Toggle Maximized** | Maximize the side bar / panel |

Layout is container-query based: narrow → one scrolling column; wide → converter on the left, cards on the right; wider still → two columns of cards. The 🔀 button picks a random colour.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `oklchLab.syntax` | `legacy` | `legacy`: `rgba(1, 2, 3, 0.5)` / `hsla(…)`. `modern`: `rgb(1 2 3 / 0.5)` / `hsl(…)` |
| `oklchLab.hexUppercase` | `false` | `#79AF75` instead of `#79af75` |

HSL is printed with one decimal (`hsl(115.9, 26.6%, 57.3%)`) so it survives a round trip too.

## Develop

```bash
npm install
npm test             # colour maths: parsing, formatting, gamut, round trips
npm run compile      # type-check + bundle (extension host + webview)
npm run watch        # then F5 in VS Code to launch an Extension Development Host
npm run package      # tests + production build + oklch-lab-<version>.vsix
codium --install-extension oklch-lab-0.1.0.vsix   # or: code --install-extension …
```

```
src/color.ts          pure colour maths — parse / format / gamut (shared by host and webview)
src/color.test.ts     node:test suite for the above
src/extension.ts      views, commands, editor integration, clipboard
src/html.ts           webview markup (CSP with nonce, no inline styles)
src/webview/main.ts   state, converter fields, sliders, graph interaction
src/webview/paint.ts  canvas rendering: gamut cross-sections, sliders, 3D cloud
media/main.css        layout + styling (VS Code theme variables)
media/icon.svg        activity-bar icon
```

Scaffolded from `../vsix-template`; layout and styling follow `hungnotes` and `fractalstyler-vscode`.

## Assets

- `media/icon.svg` is the activity-bar glyph (VS Code masks it, so it takes the theme colour).
- `media/thumbnail.png` (512×512) is the marketplace icon (`"icon"` in `package.json`).

## License

MIT
