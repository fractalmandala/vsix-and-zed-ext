# Fractalstyler VS Code Extension

Direct sidebar and panel editor for the canonical styling files in your fractalstyler styles folder. Zero configuration. On activation the extension uses the first of these that
exists in the workspace, so all three ways of working are wired up:

1. `src/lib/styles` — fractalstyler itself, or a project that has **ejected** a copy
2. `node_modules/@fractaldesign/fractalstyler/dist/styles` — an app consuming the npm package
3. `src/styles`, `styles` — other conventions

Local styles are checked before the installed package, so an ejected copy is
never shadowed by the version in `node_modules`.

To override, run **Fractalstyler: Pick Styles Folder** (command palette or the
title-bar folder icon), or set `fractalstyler.stylesDirectory` yourself —
relative paths resolve against the workspace root. If nothing is found, the
extension says so once and offers the picker, rather than silently creating a
folder.

## Features

- **Embedded High-Performance Editor**: Code editor with full indented Sass syntax highlighting, line numbers, and subtle `→` tab whitespace guides matching the fractaldesign taste system.
- **Cursor & Edit Stability (v0.3.0)**: Self-save deduplication and intelligent selection preservation prevents the cursor from jumping to the top of the file on save or auto-save.
- **Header File Badge & Native Title (v0.3.0)**: Current file name is shown in the VS Code native header next to `FRACTALSTYLER` and inside the extension header. Click or right-click to open directly in the main VS Code editor.
- **Pinned Files Strip (v0.3.0)**: Pin your most frequently accessed Sass files as quick-switch tabs right at the top of the header. Includes pin toggle buttons in the header, drawer, and tab context menus.
- **Directory-Wide Sass Search (v0.3.0)**: Real-time search across all Sass/CSS files in the styles folder with keyboard navigation (`↑`/`↓`/`Enter`/`Esc`), match highlighting, and one-click jump directly to the target line in the editor.
- **Direct File Drawer**: Click the drawer icon to view and switch between canonical files (`_00_config.sass`, `_00_tokens.sass`, `_04_layouts.sass`, etc.).
- **Sidebar & Panel Docking**: Place it in the Activity Bar (primary sidebar), secondary sidebar, or bottom panel.
- **Open in Full Editor**: One-click action and context menu item to open the current file into VS Code's native editor tab.
- **Native VS Code Tokens**: Uses default VS Code colors for seamless integration across light and dark themes.

---

## Run Dev Server

Follow these exact steps to run and develop the extension locally in VS Code or VSCodium:

### 1. Install Dependencies
Make sure you are in the extension directory and dependencies are installed:
```bash
cd fractalstyler-vscode
npm install
```

### 2. Start the Build Watcher
Start the watch compiler in a terminal. Leave this terminal running while you develop:
```bash
npm run watch
```
- This runs `esbuild --watch`.
- Whenever you edit and save any file in `src/`, it automatically recompiles both the extension backend (`out/extension.js`) and the webview client (`out/webview.js`).

### 3. Open the Project Folder in VS Code / VSCodium
The editor must have this specific project folder open as its workspace root so it detects `.vscode/launch.json`:
- In VS Code / VSCodium: **File → Open Folder...**
- Select: the `fractalstyler-vscode` folder of this repository

### 4. Launch the Extension Development Host (F5)
- Open the **Run and Debug** view (`Cmd + Shift + D` or click the bug icon on the left).
- Ensure the dropdown at the top says **`Run Extension`**.
- Click the green **Play (▶)** button or press **`F5`**.

### 5. What Happens When Launched
- A new window titled **`[Extension Development Host]`** will open.
- This is a sandboxed instance of VS Code running your extension live from source.
- Look at the Activity Bar (left or right side depending on your layout): click the **Fractalstyler** notebook icon to open the panel.

---

## Development Workflow

### Live Reloading Changes
1. Edit any code in `src/` (e.g. `src/extension.ts` or `src/webview/main.ts`) and save (`Cmd + S`).
2. `npm run watch` will recompile in milliseconds.
3. In the **`[Extension Development Host]`** test window, press **`Cmd + R`** (or `Cmd + Shift + P` → **Developer: Reload Window**). Your changes will reflect immediately.

### Inspecting Webview Styles & Console (DevTools)
If you need to inspect the sidebar DOM, CSS tokens, or check `console.log` output inside the webview:
1. In the **`[Extension Development Host]`** window, press **`Cmd + Shift + P`**.
2. Type **`Developer: Open Webview Developer Tools`** and press **Enter**.
3. A standard Chrome DevTools window will open inspectable just like any web page.

### Stopping the Dev Server
1. Close the **`[Extension Development Host]`** test window (or press `Shift + F5` in your main window).
2. Press `Ctrl + C` in the terminal to stop `npm run watch`.

---

## Building & Packaging for Production

When ready to package into a `.vsix` file for distribution:
```bash
npm run buildx
npx @vscode/vsce package --no-dependencies
```
This produces `fractalstyler-<version>.vsix` ready to install or publish to the marketplace.
