import * as vscode from 'vscode';

const svg = (inner: string, cls = '') =>
  `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICON = {
  shuffle: svg('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  openInEditor: svg('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  maximizeIn: svg('<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>', 'when-narrow'),
  maximizeOut: svg('<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>', 'when-wide'),
  copy: svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  insert: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>'),
};

/** One OKLCH channel card: title, numeric field, optional graph, slider. */
function channelCard(o: {
  ch: 'l' | 'c' | 'h' | 'a';
  title: string;
  key: string;
  step: string;
  min: string;
  max: string;
  graph?: { y: string; x: string };
}) {
  const graph = o.graph
    ? `<div class="graph" id="graph-${o.ch}">
        <canvas></canvas>
        <i class="hair hair-v"></i><i class="hair hair-h"></i>
        <span class="axis axis-y">${o.graph.y}</span><span class="axis axis-x">${o.graph.x}</span>
      </div>`
    : '';
  return `<section class="card card-${o.ch}" id="card-${o.ch}">
      <header class="card-head">
        <h2>${o.title}</h2>
        <label class="num-wrap"><kbd>${o.key}</kbd>
          <input class="num" id="num-${o.ch}" type="number" inputmode="decimal" step="${o.step}" min="${o.min}" max="${o.max}" aria-label="${o.title}">
        </label>
      </header>
      ${graph}
      <div class="slider" id="slider-${o.ch}" role="slider" tabindex="0" aria-label="${o.title}">
        <div class="track"><canvas></canvas></div>
        <div class="handle"></div>
      </div>
    </section>`;
}

function fieldRow(id: string, tag: string) {
  return `<div class="field" data-format="${id}">
        <span class="tag">${tag}</span>
        <input class="field-input" id="field-${id}" spellcheck="false" autocomplete="off" aria-label="${tag}">
        <span class="field-actions">
          <button class="icon-btn sm" data-copy="${id}" title="Copy ${tag}" aria-label="Copy ${tag}">${ICON.copy}</button>
          <button class="icon-btn sm" data-insert="${id}" title="Insert ${tag} at cursor" aria-label="Insert ${tag} at cursor">${ICON.insert}</button>
        </span>
      </div>`;
}

function toggle(id: string, label: string) {
  return `<label class="toggle"><span>${label}</span><input type="checkbox" id="${id}" role="switch"><i aria-hidden="true"></i></label>`;
}

/**
 * Webview shell: header (brand + icon actions) over a rail (colour + converter) and a main area
 * (OKLCH channel cards). Header buttons are `<button class="icon-btn" data-action="id">`; the
 * webview posts `{type:'action', id}` and extension.ts handles it.
 */
export function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const media = (file: string) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview.js'));
  const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${media('main.css')}">
  <title>OKLCH Lab</title>
</head>
<body>
  <div class="app" data-wide="false" data-graphs="on">
    <header class="header">
      <div class="brand">OKLCH Lab</div>
      <div class="actions">
        <button class="icon-btn" data-action="random" title="Random colour" aria-label="Random colour">${ICON.shuffle}</button>
        <button class="icon-btn" data-action="openInEditor" title="Open in editor tab" aria-label="Open in editor tab">${ICON.openInEditor}</button>
        <button class="icon-btn" data-action="maximize" title="Maximize / restore" aria-label="Maximize / restore">${ICON.maximizeIn}${ICON.maximizeOut}</button>
      </div>
    </header>

    <div class="body">
      <aside class="rail">
        <section class="card hero">
          <div class="swatch"><div class="swatch-fill" id="swatch"></div></div>
          <p class="gamut" id="gamut"></p>
          <div class="fields">
            ${fieldRow('oklch', 'OKLCH')}
            ${fieldRow('hex', 'HEX')}
            ${fieldRow('rgb', 'RGB')}
            ${fieldRow('hsl', 'HSL')}
          </div>
          <p class="hint" id="hint">Type or paste any HEX, RGB(A), HSL(A) or OKLCH into any field — the rest follow.</p>
        </section>
        <section class="toggles">
          ${toggle('t-3d', 'Show 3D')}
          ${toggle('t-graphs', 'Show graphs')}
          ${toggle('t-p3', 'Show P3')}
          ${toggle('t-rec2020', 'Show Rec2020')}
        </section>
      </aside>

      <main class="main">
        ${channelCard({ ch: 'l', title: 'Lightness', key: 'L', step: '0.01', min: '0', max: '1', graph: { y: 'C', x: 'L' } })}
        ${channelCard({ ch: 'c', title: 'Chroma', key: 'C', step: '0.01', min: '0', max: '0.4', graph: { y: 'C', x: 'H' } })}
        ${channelCard({ ch: 'h', title: 'Hue', key: 'H', step: '1', min: '0', max: '360', graph: { y: 'L', x: 'H' } })}
        ${channelCard({ ch: 'a', title: 'Alpha', key: 'A', step: '1', min: '0', max: '100' })}
        <section class="card card-3d" id="card-3d" hidden>
          <header class="card-head"><h2>Gamut 3D</h2><span class="hint-inline">drag to rotate · double-click to reset</span></header>
          <canvas id="cv-3d" aria-label="3D view of the colour gamut"></canvas>
        </section>
      </main>
    </div>
  </div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
