import * as vscode from 'vscode';
import { getHtml } from './html';
import {
  COLOR_LITERAL,
  DEFAULT_FORMAT,
  FORMATS,
  format,
  parseColor,
  type FormatId,
  type FormatOptions,
} from './color';

const ID = 'oklch-lab';

/** Where a webview instance lives. Decides which maximize command applies. */
type Kind = 'sidebar' | 'panel' | 'editor';

/** Every live webview, so config changes and "open this colour" reach all of them. */
const live = new Set<vscode.Webview>();
let pendingColor: string | undefined;
let lastEditor: vscode.TextEditor | undefined;

const MAXIMIZE: Record<Kind, string> = {
  sidebar: 'workbench.action.toggleMaximizedAuxiliaryBar',
  panel: 'workbench.action.toggleMaximizedPanel',
  editor: 'workbench.action.toggleMaximizeEditorGroup',
};

function formatOptions(): FormatOptions {
  const cfg = vscode.workspace.getConfiguration('oklchLab');
  return {
    syntax: cfg.get<string>('syntax') === 'modern' ? 'modern' : DEFAULT_FORMAT.syntax,
    hexUpper: cfg.get<boolean>('hexUppercase', DEFAULT_FORMAT.hexUpper),
  };
}

export function activate(context: vscode.ExtensionContext) {
  const sidebar = new ViewProvider(context.extensionUri, 'sidebar');
  const panel = new ViewProvider(context.extensionUri, 'panel');
  const opts = { webviewOptions: { retainContextWhenHidden: true } };

  lastEditor = vscode.window.activeTextEditor;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(`${ID}.view`, sidebar, opts),
    vscode.window.registerWebviewViewProvider(`${ID}.panelView`, panel, opts),

    // Remember the last real text editor: while a webview has focus, activeTextEditor can be undefined.
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e) lastEditor = e;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('oklchLab')) broadcast({ type: 'config', format: formatOptions() });
    }),

    vscode.commands.registerCommand(`${ID}.toggleMaximize`, () => toggleMaximize('sidebar')),
    vscode.commands.registerCommand(`${ID}.openInEditor`, () => openInEditor(context.extensionUri)),
    vscode.commands.registerCommand(`${ID}.convertSelection`, convertSelection),
    vscode.commands.registerCommand(`${ID}.loadSelection`, loadSelection),
    // Optional text argument lets keybindings / other extensions insert a literal directly.
    vscode.commands.registerCommand(`${ID}.insertColor`, (text?: unknown) =>
      insertColor(typeof text === 'string' ? text : undefined)
    )
  );
}

export function deactivate() {}

function broadcast(msg: unknown) {
  for (const w of live) w.postMessage(msg);
}

/**
 * Maximize / restore using VS Code's own layout commands. The webview reflows by its own
 * width (see media/main.css), so no state is tracked here.
 */
async function toggleMaximize(kind: Kind) {
  const command = MAXIMIZE[kind];
  const available = await vscode.commands.getCommands(true);
  if (!available.includes(command)) {
    vscode.window.showInformationMessage(`${command} is not available in this editor version.`);
    return;
  }
  await vscode.commands.executeCommand(command);
}

// ---- editor integration ---------------------------------------------------

interface Hit {
  range: vscode.Range;
  text: string;
}

/** The colour literals the user means: each non-empty selection, or the literal under an empty cursor. */
function colorsAt(editor: vscode.TextEditor): Hit[] {
  const hits: Hit[] = [];
  for (const sel of editor.selections) {
    if (!sel.isEmpty) {
      hits.push({ range: sel, text: editor.document.getText(sel) });
      continue;
    }
    const line = editor.document.lineAt(sel.active.line);
    for (const m of line.text.matchAll(COLOR_LITERAL)) {
      const start = m.index ?? 0;
      if (sel.active.character >= start && sel.active.character <= start + m[0].length) {
        hits.push({
          range: new vscode.Range(sel.active.line, start, sel.active.line, start + m[0].length),
          text: m[0],
        });
        break;
      }
    }
  }
  return hits;
}

async function convertSelection() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const hits = colorsAt(editor).filter((h) => parseColor(h.text));
  if (!hits.length) {
    vscode.window.showInformationMessage(
      'OKLCH Lab: no colour found. Select a HEX, rgb(), hsl() or oklch() value, or put the cursor inside one.'
    );
    return;
  }

  const opts = formatOptions();
  const first = parseColor(hits[0].text)!;
  const pick = await vscode.window.showQuickPick(
    FORMATS.filter((f) => f !== first.source || hits.length > 1).map((f) => ({
      label: f.toUpperCase(),
      description: format(first, f, opts),
      id: f,
    })),
    { placeHolder: `Convert ${hits.length === 1 ? hits[0].text.trim() : `${hits.length} colours`} to…` }
  );
  if (!pick) return;

  await editor.edit((edit) => {
    for (const h of hits) {
      const p = parseColor(h.text);
      if (p) edit.replace(h.range, format(p, pick.id as FormatId, opts));
    }
  });
}

async function loadSelection() {
  const editor = vscode.window.activeTextEditor;
  const hit = editor && colorsAt(editor).find((h) => parseColor(h.text));
  if (!hit) {
    vscode.window.showInformationMessage('OKLCH Lab: no colour found at the selection.');
    return;
  }
  pendingColor = hit.text.trim();
  if (live.size) {
    broadcast({ type: 'setColor', text: pendingColor });
    pendingColor = undefined;
  }
  await vscode.commands.executeCommand(`${ID}.view.focus`);
}

async function insertColor(text?: string) {
  const editor = vscode.window.activeTextEditor ?? lastEditor;
  if (!editor || editor.document.isClosed) {
    vscode.window.showInformationMessage('OKLCH Lab: open a file to insert into.');
    return;
  }
  if (!text) {
    // Command-palette path: ask the webview for the current colour in a chosen format.
    const pick = await vscode.window.showQuickPick(
      FORMATS.map((f) => ({ label: f.toUpperCase(), id: f })),
      { placeHolder: 'Insert current colour as…' }
    );
    if (!pick) return;
    broadcast({ type: 'requestInsert', id: pick.id });
    return;
  }
  await vscode.window.showTextDocument(editor.document, editor.viewColumn, false);
  await editor.edit((edit) => {
    for (const sel of editor.selections) edit.replace(sel, text);
  });
}

// ---- webviews -------------------------------------------------------------

interface WebviewMessage {
  type: string;
  id?: string;
  text?: string;
}

function setup(webview: vscode.Webview, extensionUri: vscode.Uri, kind: Kind) {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, 'media'),
      vscode.Uri.joinPath(extensionUri, 'out'),
    ],
  };
  webview.html = getHtml(webview, extensionUri);
  live.add(webview);

  webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
    switch (msg.type) {
      case 'ready':
        webview.postMessage({ type: 'config', format: formatOptions() });
        if (pendingColor) {
          webview.postMessage({ type: 'setColor', text: pendingColor });
          pendingColor = undefined;
        }
        break;
      case 'action':
        if (msg.id === 'maximize') await toggleMaximize(kind);
        else if (msg.id === 'openInEditor') await openInEditor(extensionUri);
        break;
      case 'copy':
        if (msg.text) {
          await vscode.env.clipboard.writeText(msg.text);
          vscode.window.setStatusBarMessage(`OKLCH Lab: copied ${msg.text}`, 2500);
        }
        break;
      case 'insert':
        await insertColor(msg.text);
        break;
    }
  });
}

class ViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly kind: Kind
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    setup(view.webview, this.extensionUri, this.kind);
    view.onDidDispose(() => live.delete(view.webview));
  }
}

let editorPanel: vscode.WebviewPanel | undefined;

/** The same UI as a full editor tab (a roomy workspace for the 3D view). */
function openInEditor(extensionUri: vscode.Uri) {
  if (editorPanel) {
    editorPanel.reveal();
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    `${ID}.editor`,
    'OKLCH Lab',
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
  setup(panel.webview, extensionUri, 'editor');
  editorPanel = panel;
  panel.onDidDispose(() => {
    live.delete(panel.webview);
    editorPanel = undefined;
  });
}
