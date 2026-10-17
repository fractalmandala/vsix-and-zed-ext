(function () {
  const vscode = acquireVsCodeApi();
  const app = document.querySelector('.app');
  const WIDE = 640; // keep in sync with the @container query in main.css

  // Restore per-view UI state.
  const saved = vscode.getState() || {};
  if (saved.rail) app.dataset.rail = saved.rail;

  const save = () => vscode.setState({ rail: app.dataset.rail });

  // Header buttons: built-ins handled here, everything else goes to the host.
  document.querySelector('.header').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = btn.dataset.action;
    if (id === 'rail') {
      app.dataset.rail = app.dataset.rail === 'open' ? 'closed' : 'open';
      save();
    } else {
      vscode.postMessage({ type: 'action', id });
    }
  });

  // Track width so scripts can read data-wide (CSS handles layout on its own).
  new ResizeObserver(([entry]) => {
    app.dataset.wide = String(entry.contentRect.width >= WIDE);
  }).observe(app);

  // Host -> webview messages land here.
  window.addEventListener('message', (event) => {
    const msg = event.data;
    // EXTENSION POINT: switch (msg.type) { ... }
  });

  vscode.postMessage({ type: 'ready' });
})();
