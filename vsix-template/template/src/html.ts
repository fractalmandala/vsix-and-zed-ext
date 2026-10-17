import * as vscode from 'vscode';

/**
 * Webview shell: header (brand + icon actions) over a full-width body.
 * Every header button is `<button class="icon-btn" data-action="id">`; main.js
 * posts `{type:'action', id}` and extension.ts `onAction` handles it.
 * `maximize` and `rail` are built in.
 */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const asset = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
  const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${asset('main.css')}">
  <title>{{AppName}}</title>
</head>
<body>
  <div class="app" data-rail="closed" data-wide="false">
    <header class="header">
      <div class="brand">{{AppName}}</div>
      <div class="actions">
        <!-- Rail toggle: only visible when narrow -->
        <button class="icon-btn narrow-only" data-action="rail" title="Toggle list">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>
        </button>
        <!-- EXTENSION POINT: add your own header buttons here -->
        <button class="icon-btn" data-action="newItem" title="New item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <!-- Maximize: icon swaps with width -->
        <button class="icon-btn" data-action="maximize" title="Maximize / restore">
          <svg class="when-narrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          <svg class="when-wide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>
        </button>
      </div>
    </header>

    <div class="body">
      <!-- Wide: always visible left column. Narrow: replaces main when toggled. -->
      <nav class="rail" id="rail">
        <!-- EXTENSION POINT: list / navigation -->
      </nav>
      <main class="main">
        <!-- EXTENSION POINT: primary content -->
        <h1 class="title" id="title">Welcome</h1>
        <p class="muted">Drag the header edge of this panel wider, or press maximize.</p>
      </main>
    </div>
  </div>
  <script nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
}
