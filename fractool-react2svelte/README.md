# Fractool React → Svelte

A VS Code extension for hacky React → Svelte converter. It converts React components (TSX/JSX, function components and hooks) to Svelte 5 with runes, and lists a warning for anything that doesn't port 1:1.

## Use

- **Paste**: open the **React → Svelte** view (it opens in the secondary sidebar by default and you can drag it anywhere). Paste into the top editor. The Svelte output updates as you type.
- **Right-click**: on a `.tsx` / `.jsx` file in the Explorer, in the editor, or on the editor tab, choose **Convert to Svelte**. If the file is open, unsaved edits are included.
- **Output**: when the input has several components there is one tab per output file. A tab's badge counts that file's warnings, and the warnings are listed in yellow under the output. A parse error shows in red; click its line number to jump there in the input.
- **Actions** (in the view header and the title bar):
  - **Copy**: copies the file shown.
  - **Open**: opens the file shown in a new, unsaved editor tab.
  - **Save**: for a right-clicked file, writes every output `.svelte` file next to the source, and asks before overwriting. For pasted input, opens a save dialog for the file shown.
  - **Clear**: empties the input.

## Build

```sh
npm install
npm run compile     # dev build (out/)
npm run typecheck   # tsc, includes the fractalgpui converter
npm run package     # production .vsix
```


## Commands

- Dev: TODO
- Desktop: TODO
- Build: TODO
