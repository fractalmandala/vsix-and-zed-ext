import * as vscode from 'vscode';
import { getHtml } from './html';

const ID = '{{name}}';

/** Where a given webview instance lives. Decides which maximize command applies. */
type Kind = 'sidebar' | 'panel';

export function activate(context: vscode.ExtensionContext) {
  const sidebar = new ViewProvider(context.extensionUri, 'sidebar');
  const panel = new ViewProvider(context.extensionUri, 'panel');
  const opts = { webviewOptions: { retainContextWhenHidden: true } };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(`${ID}.view`, sidebar, opts),
    vscode.window.registerWebviewViewProvider(`${ID}.panelView`, panel, opts),
    vscode.commands.registerCommand(`${ID}.toggleMaximize`, () => toggleMaximize('sidebar')),
    vscode.commands.registerCommand(`${ID}.newItem`, () => onAction('newItem'))
  );
}

export function deactivate() {}

/**
 * Maximize / restore using VS Code's own layout commands. The webview reflows
 * by its own width (see media/main.css), so no state is tracked here.
 *   - view in the secondary (right) side bar or primary side bar -> auxiliary bar
 *   - view in the bottom panel                                    -> panel
 * To use the sidebar view on the right: drag its activity-bar icon to the right.
 */
async function toggleMaximize(kind: Kind) {
  const command =
    kind === 'panel'
      ? 'workbench.action.toggleMaximizedPanel'
      : 'workbench.action.toggleMaximizedAuxiliaryBar';
  const available = await vscode.commands.getCommands(true);
  if (!available.includes(command)) {
    vscode.window.showInformationMessage(`${command} is not available in this editor version.`);
    return;
  }
  await vscode.commands.executeCommand(command);
}

/** EXTENSION POINT: handle header-button actions (data-action="..." in html.ts). */
async function onAction(id: string) {
  switch (id) {
    case 'newItem':
      vscode.window.showInformationMessage('{{AppName}}: new item');
      break;
  }
}

class ViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly kind: Kind
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')]
    };
    view.webview.html = getHtml(view.webview, this.extensionUri);

    view.webview.onDidReceiveMessage(async (msg: { type: string; id?: string }) => {
      if (msg.type === 'action' && msg.id === 'maximize') {
        await toggleMaximize(this.kind);
      } else if (msg.type === 'action' && msg.id) {
        await onAction(msg.id);
      }
    });
  }
}
