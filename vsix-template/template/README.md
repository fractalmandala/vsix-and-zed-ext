# {{AppName}}

A VS Code / VSCodium webview side panel with a header of icon actions and a
full-width body. It maximizes to full width and contracts back.

## Run

```bash
npm install
npm run compile      # type-check + bundle
# press F5 in VS Code to launch an Extension Development Host
```

## Package

```bash
npm run package      # writes {{name}}-0.1.0.vsix
codium --install-extension {{name}}-0.1.0.vsix   # or: code --install-extension ...
```

## Use it

- Click the **{{AppName}}** icon in the activity bar, or open the bottom-panel tab.
- To dock it on the right: drag the activity-bar icon onto the right side bar
  (View → Appearance → Secondary Side Bar).
- Maximize with the header button, the title-bar expand icon, or the command
  **{{AppName}}: Toggle Maximized**. Wide views show a left rail; narrow views
  show a single column with a rail toggle.

## Extend

| Want | Edit |
| --- | --- |
| Header button | add `<button data-action="id">` in `src/html.ts`, handle `id` in `onAction` (`src/extension.ts`) |
| Body content | the `main` / `rail` slots in `src/html.ts` |
| Styling | `media/main.css` (uses `--vscode-*` theme variables) |
| Webview behaviour | `media/main.js` (host messages arrive in the `message` listener) |
| Wide breakpoint | `640px` in `media/main.css` and `WIDE` in `media/main.js` |
