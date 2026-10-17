import * as vscode from 'vscode';
import * as path from 'path';
import { react_to_svelte, ReactConvertError, type ConvertedFile } from './converter';

const VIEW_ID = 'fractoolR2s.view';

/** What the webview shows. Conversion runs here (Node), the webview only renders. */
type Outcome =
  | { ok: true; files: ConvertedFile[]; warnings: string[] }
  | { ok: false; error: string; line: number | null };

function convert(source: string): Outcome | null {
  if (!source.trim()) return null;
  try {
    const r = react_to_svelte(source);
    return { ok: true, files: r.files, warnings: r.warnings };
  } catch (err) {
    if (err instanceof ReactConvertError) return { ok: false, error: err.message, line: err.line };
    return { ok: false, error: String((err as Error)?.message ?? err), line: null };
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new React2SvelteViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('fractoolR2s.convertFile', (uri?: vscode.Uri) => provider.convertFile(uri)),
    vscode.commands.registerCommand('fractoolR2s.copyOutput', () => provider.copyOutput()),
    vscode.commands.registerCommand('fractoolR2s.openOutput', () => provider.openOutput()),
    vscode.commands.registerCommand('fractoolR2s.saveOutput', () => provider.saveOutput()),
    vscode.commands.registerCommand('fractoolR2s.clear', () => provider.clear())
  );
}

export function deactivate() {}

class React2SvelteViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private ready = false;

  private source = '';
  /** Set when the input came from a file (right-click); `Save` then writes next to it. */
  private sourcePath: string | null = null;
  private selected = '';
  private outcome: Outcome | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    // The pasted input survives reloads; a file-sourced input is re-read on demand instead.
    this.source = context.workspaceState.get<string>('r2s.source', '');
    this.outcome = convert(this.source);
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    this.ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'out'), vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    webviewView.webview.html = this.html(webviewView.webview);
    this.updateDescription();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg?.type) {
        case 'ready':
          this.ready = true;
          this.post(true);
          break;
        case 'input':
          this.setSource(String(msg.source ?? ''), this.sourcePath, false);
          break;
        case 'select':
          this.selected = String(msg.name ?? '');
          break;
        case 'copy':
          await this.copyOutput();
          break;
        case 'open':
          await this.openOutput();
          break;
        case 'save':
          await this.saveOutput();
          break;
        case 'openSource':
          if (this.sourcePath) await vscode.window.showTextDocument(vscode.Uri.file(this.sourcePath), { preview: false });
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
  }

  // --- commands --------------------------------------------------------------------------

  async convertFile(uri?: vscode.Uri) {
    const target = uri instanceof vscode.Uri ? uri : vscode.window.activeTextEditor?.document.uri;
    if (!target) {
      vscode.window.showWarningMessage('React → Svelte: no .tsx or .jsx file selected.');
      return;
    }
    let text: string;
    try {
      // An open document wins over disk so unsaved edits are converted too.
      const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target.toString());
      text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(target));
    } catch (e) {
      vscode.window.showErrorMessage(`React → Svelte: could not read ${path.basename(target.fsPath)}: ${e}`);
      return;
    }
    this.setSource(text, target.scheme === 'file' ? target.fsPath : null, true);
    await this.reveal();

    if (this.outcome && !this.outcome.ok) {
      vscode.window.showWarningMessage(`React → Svelte: ${path.basename(target.fsPath)}: ${this.outcome.error}`);
    }
  }

  async copyOutput() {
    const file = this.currentFile();
    if (!file) return this.nothing();
    await vscode.env.clipboard.writeText(file.code);
    vscode.window.setStatusBarMessage(`$(check) Copied ${file.name} (${lineCount(file.code)} lines)`, 2500);
  }

  async openOutput() {
    const file = this.currentFile();
    if (!file) return this.nothing();
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument({ language: 'svelte', content: file.code });
    } catch {
      // No Svelte language support installed: open as plain text.
      doc = await vscode.workspace.openTextDocument({ content: file.code });
    }
    await vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Active });
  }

  async saveOutput() {
    const o = this.outcome;
    if (!o || !o.ok) return this.nothing();

    // From a file: write every output component next to it.
    if (this.sourcePath) {
      const dir = path.dirname(this.sourcePath);
      const targets = o.files.map((f) => ({ file: f, uri: vscode.Uri.file(path.join(dir, f.name)) }));
      const existing: string[] = [];
      for (const t of targets) {
        try {
          await vscode.workspace.fs.stat(t.uri);
          existing.push(t.file.name);
        } catch {}
      }
      if (existing.length) {
        const pick = await vscode.window.showWarningMessage(
          `Overwrite ${existing.join(', ')} in ${path.basename(dir)}/?`,
          { modal: true },
          'Overwrite'
        );
        if (pick !== 'Overwrite') return;
      }
      for (const t of targets) await vscode.workspace.fs.writeFile(t.uri, new TextEncoder().encode(t.file.code));
      const names = targets.map((t) => t.file.name).join(', ');
      const action = await vscode.window.showInformationMessage(`Saved ${names} next to ${path.basename(this.sourcePath)}`, 'Open');
      if (action === 'Open') await vscode.window.showTextDocument(targets[0].uri, { preview: false });
      return;
    }

    // Pasted input: ask where to put the shown file.
    const file = this.currentFile()!;
    const base = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: base ? vscode.Uri.joinPath(base, file.name) : undefined,
      filters: { Svelte: ['svelte'] },
      saveLabel: 'Save Svelte component'
    });
    if (!uri) return;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(file.code));
    await vscode.window.showTextDocument(uri, { preview: false });
  }

  clear() {
    this.setSource('', null, true);
  }

  // --- state -----------------------------------------------------------------------------

  private setSource(source: string, sourcePath: string | null, replaceInput: boolean) {
    const changedOrigin = sourcePath !== this.sourcePath;
    this.source = source;
    this.sourcePath = sourcePath;
    this.outcome = convert(source);
    if (replaceInput || changedOrigin) this.selected = '';
    void this.context.workspaceState.update('r2s.source', source);
    this.updateDescription();
    this.post(replaceInput);
  }

  private currentFile(): ConvertedFile | null {
    const o = this.outcome;
    if (!o || !o.ok) return null;
    return o.files.find((f) => f.name === this.selected) ?? o.files[0] ?? null;
  }

  private nothing() {
    const o = this.outcome;
    vscode.window.showWarningMessage(
      o && !o.ok ? `React → Svelte: nothing to use, the input has an error: ${o.error}` : 'React → Svelte: nothing converted yet.'
    );
  }

  private async reveal() {
    if (this.view?.visible) return;
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  private updateDescription() {
    if (this.view) this.view.description = this.sourcePath ? path.basename(this.sourcePath) : undefined;
  }

  /** Sends the full state. `replaceInput` also overwrites the webview's input editor. */
  private post(replaceInput: boolean) {
    if (!this.view || !this.ready) return;
    this.view.webview.postMessage({
      type: 'state',
      replaceInput,
      source: replaceInput ? this.source : undefined,
      sourceName: this.sourcePath ? path.basename(this.sourcePath) : null,
      selected: this.currentFile()?.name ?? '',
      outcome: this.outcome
    });
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js'));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>React → Svelte</title>
<style>${CSS}</style>
</head>
<body>
<div class="app">
  <section class="pane" id="input-pane">
    <header class="pane-head">
      <span class="pane-label">React <span class="dim" id="input-kind">TSX / JSX</span></span>
      <span class="source-badge" id="source-badge" hidden title="Open source file"></span>
    </header>
    <div class="editor" id="input-editor"></div>
  </section>

  <div class="splitter" id="splitter" title="Drag to resize"></div>

  <section class="pane" id="output-pane">
    <header class="pane-head">
      <div class="tabs" id="tabs"></div>
      <span class="meta" id="meta"></span>
      <div class="actions">
        <button class="btn" id="btn-open" title="Open in a new editor tab">Open</button>
        <button class="btn" id="btn-save" title="Save as .svelte">Save</button>
        <button class="btn primary" id="btn-copy" title="Copy the shown file">Copy</button>
      </div>
    </header>
    <div class="editor" id="output-editor"></div>
    <div class="error" id="error" hidden></div>
    <ul class="warnings" id="warnings" hidden></ul>
  </section>
</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function lineCount(code: string) {
  return code.replace(/\n$/, '').split('\n').length;
}

const CSS = /* css */ `
:root {
  --bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
  --muted: var(--vscode-descriptionForeground, rgba(128,128,128,.9));
  --line: var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, rgba(128,128,128,.22)));
  --editor-bg: var(--vscode-editor-background);
  --editor-fg: var(--vscode-editor-foreground);
  --hover: var(--vscode-list-hoverBackground, rgba(128,128,128,.1));
  --active: var(--vscode-list-inactiveSelectionBackground, rgba(128,128,128,.16));
  --warn: var(--vscode-editorWarning-foreground, #cca700);
  --err: var(--vscode-errorForeground, #f14c4c);
  --mono: var(--vscode-editor-font-family, Menlo, Monaco, monospace);
  --mono-size: var(--vscode-editor-font-size, 12px);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--fg); font-family: var(--vscode-font-family); font-size: 12px; }
.app { display: flex; flex-direction: column; height: 100%; }
.pane { display: flex; flex-direction: column; min-height: 60px; overflow: hidden; }
#input-pane { flex: 0 0 40%; }
#output-pane { flex: 1 1 auto; }
.pane-head { display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.pane-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; opacity: .85; white-space: nowrap; }
.dim { color: var(--muted); text-transform: none; letter-spacing: 0; margin-left: 4px; }
.source-badge { margin-left: auto; font-family: var(--mono); font-size: 10px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 3px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
.source-badge:hover { background: var(--hover); }
.editor { flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--editor-bg); }
.splitter { flex: 0 0 5px; cursor: row-resize; border-top: 1px solid var(--line); background: transparent; }
.splitter:hover, .splitter.dragging { background: var(--vscode-sash-hoverBorder, rgba(0,122,204,.5)); }
.tabs { display: flex; gap: 2px; overflow-x: auto; min-width: 0; flex: 1 1 auto; scrollbar-width: none; }
.tab { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border-radius: 3px; border: 1px solid transparent; color: var(--muted); background: none; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
.tab:hover { background: var(--hover); color: var(--fg); }
.tab.active { background: var(--active); color: var(--fg); border-color: var(--line); }
.tab .count { font-size: 9px; min-width: 14px; padding: 0 4px; border-radius: 7px; background: var(--warn); color: var(--vscode-editor-background, #000); text-align: center; line-height: 14px; }
.meta { color: var(--muted); font-size: 10px; white-space: nowrap; }
.actions { display: flex; gap: 4px; flex-shrink: 0; }
.btn { font: inherit; font-size: 11px; padding: 2px 8px; border-radius: 3px; cursor: pointer; border: 1px solid var(--vscode-button-border, var(--line)); color: var(--vscode-button-secondaryForeground, var(--fg)); background: var(--vscode-button-secondaryBackground, transparent); }
.btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--hover)); }
.btn.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border-color: transparent; }
.btn.primary:hover { background: var(--vscode-button-hoverBackground); }
.btn:disabled { opacity: .45; cursor: default; }
.error { padding: 8px 10px; color: var(--err); font-family: var(--mono); font-size: 11px; border-top: 1px solid var(--line); white-space: pre-wrap; flex-shrink: 0; }
.error a { color: inherit; text-decoration: underline; cursor: pointer; }
.warnings { list-style: none; max-height: 34%; overflow-y: auto; border-top: 1px solid var(--line); padding: 6px 10px; flex-shrink: 0; }
.warnings li { color: var(--warn); font-size: 11px; line-height: 1.45; padding: 2px 0 2px 16px; text-indent: -16px; user-select: text; }
.warnings li::before { content: '⚠'; display: inline-block; width: 16px; text-indent: 0; }
.cm-editor { height: 100%; }
.cm-editor.cm-focused { outline: none; }
[hidden] { display: none !important; }
`;
