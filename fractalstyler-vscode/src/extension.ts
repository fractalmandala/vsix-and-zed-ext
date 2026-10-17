import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ClassRegistry } from './registry';
import { registerClassProviders } from './completion';

/** Write one line to the Fractalstyler output channel. */
const output = vscode.window.createOutputChannel('Fractalstyler');
function outputLine(message: string): void {
  output.appendLine(message);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(output);
  const provider = new FractalstylerViewProvider(context.extensionUri, context);

  // Class completions and hovers, driven by registry.json. Prefer a copy found
  // next to the project's styles folder (an ejected copy edited in place),
  // otherwise fall back to the one bundled at release time.
  const registry = new ClassRegistry();
  registry.load(context.extensionUri, provider.getStylesDirectory());
  registerClassProviders(context, registry);
  outputLine(
    registry.size
      ? `Fractalstyler: ${registry.size} classes loaded from ${registry.source}`
      : 'Fractalstyler: registry not found — class completions are unavailable'
  );

  // Re-read the registry when the styles folder changes, so an ejected copy
  // that is regenerated in place picks up new classes without a reload.
  context.subscriptions.push(
    provider.onStylesDirectoryChanged(() => {
      if (registry.load(context.extensionUri, provider.getStylesDirectory())) {
        outputLine(
          `Fractalstyler: registry reloaded — ${registry.size} classes from ${registry.source}`
        );
      }
    })
  );

  // Register for sidebar Activity Bar container and bottom panel container
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('fractalstyler.view', provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('fractalstyler.panelView', provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.openCurrentInEditor', (filename?: string, line?: number) => {
      provider.openCurrentInEditor(filename, line);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.newFile', () => {
      provider.promptNewFile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.openStylesFolder', () => {
      provider.openStylesFolder();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.pickStylesFolder', () => {
      provider.pickStylesFolder();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.toggleDrawer', () => {
      provider.toggleDrawer();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.focusSearch', () => {
      provider.focusSearch();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalstyler.pinCurrentFile', () => {
      provider.togglePinCurrent();
    })
  );
}

export function deactivate() {}

export interface StyleFileItem {
  filename: string;
  title: string;
  size: number;
  mtime: number;
  pinned?: boolean;
}

export interface StyleSearchMatch {
  filename: string;
  line: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

export class FractalstylerViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private currentFilename: string = '_04_layouts.sass';
  private pinnedFiles: string[] = ['_00_tokens.sass', '_04_layouts.sass'];
  private fsWatcher?: vscode.FileSystemWatcher;

  // Track self-saves to prevent file-watcher feedback loops that reset cursor
  private lastSavedContent: Map<string, string> = new Map();
  private lastSavedTime: Map<string, number> = new Map();
  private lastNoDirectoryNotice?: Thenable<unknown>;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {
    const savedPins = this._context.workspaceState.get<string[]>('pinnedFiles');
    if (savedPins && Array.isArray(savedPins) && savedPins.length > 0) {
      this.pinnedFiles = savedPins;
    }
    this.setupWatcher();
  }

  /**
   * Candidate styles folders, most specific first. The first hit per workspace
   * folder wins, so a project that owns its styles (fractalstyler itself, or an
   * ejected copy) is used from the working tree, and only a project without one
   * falls through to the installed package.
   */
  private static readonly SOURCE_CANDIDATES = [
    'src/lib/styles',
    'node_modules/@fractaldesign/fractalstyler/dist/styles',
    'node_modules/@fractaldesign/fractalstyler/styles',
    'src/styles',
    'styles'
  ];

  /**
   * Resolve a possibly-relative configured path against the workspace root.
   */
  private resolveConfigured(dir: string): string {
    if (path.isAbsolute(dir)) {
      return dir;
    }
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return root ? path.join(root, dir) : dir;
  }

  /**
   * The styles directory to edit, or '' when none could be found.
   *
   * Order: an explicit `fractalstyler.stylesDirectory` always wins, then the
   * first conventional folder present in the workspace. There is deliberately
   * no machine-specific fallback — this used to hardcode an absolute path from
   * the author's laptop, which either pointed nowhere useful or, worse, got
   * mkdir'd into existence on activation.
   */
  public getStylesDirectory(): string {
    const config = vscode.workspace.getConfiguration('fractalstyler');
    const configured = config.get<string>('stylesDirectory')?.trim();
    if (configured) {
      const resolved = this.resolveConfigured(configured);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const rel of FractalstylerViewProvider.SOURCE_CANDIDATES) {
        const candidate = path.join(folder.uri.fsPath, rel);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return '';
  }

  private updateViewTitle() {
    if (this._view) {
      this._view.description = this.currentFilename;
    }
  }

  private setupWatcher() {
    const dir = this.getStylesDirectory();
    if (fs.existsSync(dir)) {
      this.fsWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dir, '**/*.{sass,scss,css}')
      );

      this.fsWatcher.onDidChange(async (uri) => {
        const changedFile = path.basename(uri.fsPath);
        const lastSaved = this.lastSavedContent.get(changedFile);
        const lastTime = this.lastSavedTime.get(changedFile) || 0;
        const isRecentSelfSave = Date.now() - lastTime < 3000;

        if (isRecentSelfSave && lastSaved !== undefined) {
          try {
            const diskContent = await fs.promises.readFile(uri.fsPath, 'utf8');
            if (diskContent === lastSaved) {
              // Self save verified; suppress reload so cursor never shoots up
              await this.sendFileList();
              return;
            }
          } catch {}
        }

        if (changedFile === this.currentFilename) {
          await this.loadFile(changedFile, false);
        }
        await this.sendFileList();
      });

      this.fsWatcher.onDidCreate(async () => {
        await this.sendFileList();
      });

      this.fsWatcher.onDidDelete(async (uri) => {
        const deletedFile = path.basename(uri.fsPath);
        if (this.pinnedFiles.includes(deletedFile)) {
          this.pinnedFiles = this.pinnedFiles.filter((f) => f !== deletedFile);
          await this._context.workspaceState.update('pinnedFiles', this.pinnedFiles);
          this.sendPinnedFiles();
        }
        if (deletedFile === this.currentFilename) {
          const files = await this.readStylesDir();
          if (files.length > 0) {
            await this.loadFile(files[0].filename, true);
          }
        }
        await this.sendFileList();
      });
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    this.updateViewTitle();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'ready': {
          await this.initSession();
          break;
        }
        case 'save': {
          await this.saveFile(data.filename, data.content);
          break;
        }
        case 'loadFile': {
          await this.loadFile(data.filename, true, data.targetLine, data.matchStart, data.matchEnd);
          break;
        }
        case 'getFileList': {
          await this.sendFileList();
          break;
        }
        case 'createFile': {
          await this.createFile(data.filename);
          break;
        }
        case 'openInEditor': {
          await this.openCurrentInEditor(data.filename, data.line);
          break;
        }
        case 'openFolder': {
          await this.openStylesFolder();
          break;
        }
        case 'togglePin': {
          await this.togglePin(data.filename);
          break;
        }
        case 'search': {
          await this.searchStyles(data.query);
          break;
        }
        case 'copyText': {
          if (data.text) {
            await vscode.env.clipboard.writeText(data.text);
            vscode.window.showInformationMessage(`Copied: ${data.text}`);
          }
          break;
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.updateViewTitle();
        this.sendFileList();
        this.sendPinnedFiles();
      }
    });
  }

  private async initSession() {
    const dir = this.getStylesDirectory();
    if (!dir) {
      // Nothing to open. Do NOT create a styles folder as a side effect of
      // activation — point the user at the picker instead.
      await this.sendMessage({ type: 'searchResults', query: '', results: [] });
      this.lastNoDirectoryNotice ??= this.notifyNoDirectory();
      return;
    }
    this.lastNoDirectoryNotice = undefined;

    const files = await this.readStylesDir();
    const config = vscode.workspace.getConfiguration('fractalstyler');
    const defaultFile = config.get<string>('defaultFile') || '_04_layouts.sass';

    let fileToOpen = defaultFile;
    if (!files.some((f: StyleFileItem) => f.filename === fileToOpen) && files.length > 0) {
      fileToOpen = files[0].filename;
    }

    if (fileToOpen && fs.existsSync(path.join(dir, fileToOpen))) {
      await this.loadFile(fileToOpen, true);
    }

    this.updateViewTitle();
    await this.sendFileList();
    this.sendPinnedFiles();
  }

  private async readStylesDir(): Promise<StyleFileItem[]> {
    const dir = this.getStylesDirectory();
    if (!fs.existsSync(dir)) {
      return [];
    }

    try {
      const entries = await fs.promises.readdir(dir);
      const styleEntries = entries.filter((f: string) => !f.startsWith('.') && (f.endsWith('.sass') || f.endsWith('.scss') || f.endsWith('.css')));

      const items: StyleFileItem[] = [];
      for (const file of styleEntries) {
        try {
          const stat = await fs.promises.stat(path.join(dir, file));
          items.push({
            filename: file,
            title: file,
            size: stat.size,
            mtime: stat.mtimeMs,
            pinned: this.pinnedFiles.includes(file)
          });
        } catch {}
      }

      // Natural alphanumeric sort so _00, _01, _02 are correctly ordered
      items.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' }));
      return items;
    } catch (e) {
      console.error('Failed to read styles dir', e);
      return [];
    }
  }

  public async sendFileList() {
    const files = await this.readStylesDir();
    this.sendMessage({
      type: 'fileList',
      files: files,
      currentFilename: this.currentFilename,
      pinnedFiles: this.pinnedFiles
    });
  }

  public sendPinnedFiles() {
    this.sendMessage({
      type: 'pinnedFiles',
      files: this.pinnedFiles,
      currentFilename: this.currentFilename
    });
  }

  public async togglePin(filename: string) {
    if (!filename) return;
    if (this.pinnedFiles.includes(filename)) {
      this.pinnedFiles = this.pinnedFiles.filter((f) => f !== filename);
    } else {
      this.pinnedFiles.push(filename);
    }
    await this._context.workspaceState.update('pinnedFiles', this.pinnedFiles);
    this.sendPinnedFiles();
    await this.sendFileList();
  }

  public async togglePinCurrent() {
    if (this.currentFilename) {
      await this.togglePin(this.currentFilename);
    }
  }

  public async loadFile(
    filename: string,
    force: boolean = false,
    targetLine?: number,
    matchStart?: number,
    matchEnd?: number
  ) {
    const dir = this.getStylesDirectory();
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`Fractalstyler: File ${filename} does not exist.`);
      return;
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf8');
      this.currentFilename = filename;
      this.updateViewTitle();

      this.sendMessage({
        type: 'fileLoaded',
        filename: filename,
        content: content,
        force: force,
        targetLine: targetLine,
        matchStart: matchStart,
        matchEnd: matchEnd
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to read file ${filename}: ${e}`);
    }
  }

  public async saveFile(filename: string, content: string) {
    if (!filename) return;
    const dir = this.getStylesDirectory();
    const filePath = path.join(dir, filename);

    try {
      this.lastSavedContent.set(filename, content);
      this.lastSavedTime.set(filename, Date.now());
      await fs.promises.writeFile(filePath, content, 'utf8');
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to save ${filename}: ${e}`);
    }
  }

  public async searchStyles(query: string) {
    const q = (query || '').trim();
    if (!q) {
      this.sendMessage({
        type: 'searchResults',
        query: '',
        results: []
      });
      return;
    }

    const dir = this.getStylesDirectory();
    if (!fs.existsSync(dir)) {
      this.sendMessage({ type: 'searchResults', query: q, results: [] });
      return;
    }

    const files = await this.readStylesDir();
    const results: StyleSearchMatch[] = [];
    const lowerQ = q.toLowerCase();

    for (const item of files) {
      try {
        const filePath = path.join(dir, item.filename);
        const content = await fs.promises.readFile(filePath, 'utf8');
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          const matchIdx = lineText.toLowerCase().indexOf(lowerQ);
          if (matchIdx !== -1) {
            results.push({
              filename: item.filename,
              line: i + 1,
              lineText: lineText.trim(),
              matchStart: matchIdx,
              matchEnd: matchIdx + q.length
            });
            if (results.length >= 100) break;
          }
        }
        if (results.length >= 100) break;
      } catch (err) {
        console.error(`Error searching file ${item.filename}`, err);
      }
    }

    this.sendMessage({
      type: 'searchResults',
      query: q,
      results: results
    });
  }

  public async createFile(filename: string) {
    if (!filename) return;
    let cleanName = filename.trim();
    if (!cleanName.includes('.')) {
      cleanName += '.sass';
    }

    const dir = this.getStylesDirectory();
    const filePath = path.join(dir, cleanName);

    if (fs.existsSync(filePath)) {
      vscode.window.showWarningMessage(`Fractalstyler: ${cleanName} already exists.`);
      await this.loadFile(cleanName, true);
      return;
    }

    try {
      const initialContent = `@use '00_config' as *\n@use '00_tokens' as *\n\n`;
      await fs.promises.writeFile(filePath, initialContent, 'utf8');
      await this.loadFile(cleanName, true);
      await this.sendFileList();
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to create file: ${e}`);
    }
  }

  public async promptNewFile() {
    const filename = await vscode.window.showInputBox({
      prompt: 'Enter new style filename in fractalstyler',
      placeHolder: '_09_custom.sass',
      validateInput: (val) => {
        if (!val || !val.trim()) return 'Filename cannot be empty';
        if (/[\\/:*?"<>|]/.test(val)) return 'Invalid characters in filename';
        return null;
      }
    });

    if (filename) {
      await this.createFile(filename);
    }
  }

  public async openCurrentInEditor(filename?: string, line?: number) {
    const file = filename || this.currentFilename;
    if (!file) return;
    const dir = this.getStylesDirectory();
    const filePath = path.join(dir, file);

    if (fs.existsSync(filePath)) {
      const doc = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(doc, { preview: false });
      if (line && line > 0) {
        const pos = new vscode.Position(line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }
  }

  public async openStylesFolder() {
    const dir = this.getStylesDirectory();
    if (!dir) {
      await this.pickStylesFolder();
      return;
    }
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
  }

  /**
   * Ask the user which folder to edit and persist it to
   * `fractalstyler.stylesDirectory`. This is the manual override for the
   * auto-detection, and the only way to configure the extension on a project
   * whose styles live somewhere unconventional.
   */
  public async pickStylesFolder() {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use this styles folder',
      title: 'Select the fractalstyler styles folder'
    });
    const chosen = picked?.[0];
    if (!chosen) {
      return;
    }
    await vscode.workspace
      .getConfiguration('fractalstyler')
      .update('stylesDirectory', chosen.fsPath, vscode.ConfigurationTarget.Workspace);
    this.disposeWatcher();
    this.setupWatcher();
    await this.initSession();
    this.notifyDirectoryChanged();
    vscode.window.setStatusBarMessage(
      `Fractalstyler: styles folder set to ${chosen.fsPath}`,
      4000
    );
  }

  private disposeWatcher() {
    this.fsWatcher?.dispose();
    this.fsWatcher = undefined;
  }

  private directoryListeners: Array<() => void> = [];

  /**
   * Notified whenever the resolved styles directory changes — currently only
   * when the user picks a different one. Used to reload the class registry so
   * completions match the folder now being edited.
   */
  public onStylesDirectoryChanged(listener: () => void): vscode.Disposable {
    this.directoryListeners.push(listener);
    return new vscode.Disposable(() => {
      this.directoryListeners = this.directoryListeners.filter((l) => l !== listener);
    });
  }

  private notifyDirectoryChanged() {
    for (const listener of this.directoryListeners) {
      listener();
    }
  }

  /**
   * One-shot notice when no styles folder could be found, so activation is
   * silent-but-obvious rather than an empty pane with no explanation.
   */
  private notifyNoDirectory() {
    return vscode.window
      .showWarningMessage(
        'Fractalstyler: no styles folder found in this workspace.',
        'Choose folder…'
      )
      .then((choice) => {
        if (choice === 'Choose folder…') {
          return this.pickStylesFolder();
        }
        return undefined;
      });
  }

  public toggleDrawer() {
    this.sendMessage({
      type: 'toggleDrawer'
    });
  }

  public focusSearch() {
    this.sendMessage({
      type: 'focusSearch'
    });
  }

  private sendMessage(msg: any) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fractalstyler</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff));
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #1e1e1e));
      --editor-bg: var(--vscode-editor-background, #ffffff);
      --editor-fg: var(--vscode-editor-foreground, #1e1e1e);
      --gutter-fg: var(--vscode-editorLineNumber-foreground, #999999);
      --gutter-active: var(--vscode-editorLineNumber-activeForeground, #333333);
      --line-color: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.18)));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
      --active-bg: var(--vscode-list-activeSelectionBackground, rgba(128, 128, 128, 0.14));
      --active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
      --icon-color: var(--vscode-icon-foreground, var(--vscode-foreground, #444444));
      --input-bg: var(--vscode-input-background, rgba(128, 128, 128, 0.06));
      --input-fg: var(--vscode-input-foreground, var(--fg));
      --input-border: var(--vscode-input-border, rgba(128, 128, 128, 0.22));
      --badge-bg: var(--vscode-badge-background, rgba(0, 122, 204, 0.15));
      --badge-fg: var(--vscode-badge-foreground, var(--fg));
      --highlight-bg: var(--vscode-editor-findMatchHighlightBackground, rgba(234, 179, 8, 0.35));
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --editor-font: var(--vscode-editor-font-family, Menlo, Monaco, 'Courier New', monospace);
      --editor-font-size: var(--vscode-editor-font-size, 13px);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font-family);
      font-size: 12px;
      user-select: none;
    }

    .container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      position: relative;
      --bg: var(--fs-bg, var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff)));
      --fg: var(--fs-fg, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #1e1e1e)));
      --editor-bg: var(--fs-editor-bg, var(--vscode-editor-background, #ffffff));
      --gutter-fg: var(--fs-muted, var(--vscode-editorLineNumber-foreground, #999999));
      --line-color: var(--fs-line, var(--vscode-editorWidget-border, rgba(128, 128, 128, 0.18)));
      --hover-bg: var(--fs-hover, var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08)));
      --active-bg: var(--fs-active, var(--vscode-list-activeSelectionBackground, rgba(128, 128, 128, 0.14)));
      --active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
      --icon-color: var(--fs-icon, var(--vscode-icon-foreground, var(--vscode-foreground, #444444)));
      --input-border: var(--vscode-input-border, rgba(128, 128, 128, 0.22));
      --mono: var(--vscode-editor-font-family, Menlo, Monaco, 'Courier New', monospace);
      box-sizing: border-box;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 12px;
    }

    /* Top Extension Header */
    .extension-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 36px;
      padding: 0 10px;
      background: var(--bg);
      border-bottom: 1px solid var(--line-color);
      flex-shrink: 0;
      gap: 8px;
    }

    .header-left {
      display: flex;
      align-items: center;
      min-width: 0;
      overflow: hidden;
      flex: 1;
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
    }

    .brand-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
      opacity: 0.85;
    }

    .brand-title {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: capitalize;
      color: var(--fg);
      opacity: 0.85;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .brand-sep {
      color: var(--gutter-fg);
      opacity: 0.6;
      font-size: 11px;
      flex-shrink: 0;
    }

    /* Current File Badge (Right-clickable, clickable to open in main editor) */
    .current-file-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--hover-bg);
      border: 1px solid var(--line-color);
      font-family: var(--mono);
      font-size: 10px;
      color: var(--fg);
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: background-color 0.15s ease, border-color 0.15s ease;
    }

    .current-file-badge:hover {
      background: var(--active-bg);
      border-color: var(--input-border);
    }

    .current-file-badge .open-glyph {
      font-size: 10px;
      opacity: 0.65;
      margin-left: 2px;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .header-btn {
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      color: var(--icon-color);
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      font-size: 11px;
      transition: background-color 0.15s ease, opacity 0.15s ease;
      flex-shrink: 0;
      padding: 0;
    }

    .header-btn:hover {
      background: var(--hover-bg);
      opacity: 0.9;
    }

    .header-btn:active {
      transform: scale(1.03);
    }

    .header-btn.active {
      background: var(--active-bg);
      color: var(--active-fg);
    }

    /* Pinned Files Bar */
    .pinned-bar {
      display: flex;
      align-items: center;
      height: 28px;
      padding: 0 8px;
      background: var(--bg);
      border-bottom: 1px solid var(--line-color);
      flex-shrink: 0;
      overflow-x: auto;
      gap: 4px;
    }

    .pinned-bar::-webkit-scrollbar {
      height: 2px;
    }

    .pinned-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
    }

    .pinned-tab {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 3px;
      background: transparent;
      border: 1px solid transparent;
      font-family: var(--editor-font);
      font-size: 11px;
      color: var(--gutter-fg);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.12s ease;
    }

    .pinned-tab:hover {
      background: var(--hover-bg);
      color: var(--fg);
      border-color: var(--line-color);
    }

    .pinned-tab.active {
      background: var(--active-bg);
      color: var(--fg);
      font-weight: 600;
      border-color: var(--line-color);
    }

    .pinned-tab-unpin {
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      color: inherit;
      font-size: 11px;
      opacity: 0.5;
      padding: 0 1px;
      border-radius: 2px;
      line-height: 1;
    }

    .pinned-tab-unpin:hover {
      opacity: 1;
      background: var(--hover-bg);
    }

    /* Search Bar in Extension Header */
    .search-bar-container {
      display: flex;
      align-items: center;
      padding: 4px 8px;
      background: var(--bg);
      border-bottom: 1px solid var(--line-color);
      flex-shrink: 0;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 0 6px;
      height: 26px;
      transition: border-color 0.15s ease;
    }

    .search-input-wrapper:focus-within {
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .search-icon {
      width: 12px;
      height: 12px;
      color: var(--gutter-fg);
      flex-shrink: 0;
      margin-right: 6px;
      opacity: 0.75;
    }

    .search-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--input-fg);
      font-family: var(--editor-font);
      font-size: 11px;
      min-width: 0;
    }

    .search-count {
      font-size: 10px;
      color: var(--gutter-fg);
      font-family: var(--editor-font);
      margin-right: 4px;
      white-space: nowrap;
    }

    .search-clear-btn {
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      color: var(--gutter-fg);
      font-size: 11px;
      display: none;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 2px;
    }

    .search-clear-btn:hover {
      color: var(--fg);
      background: var(--hover-bg);
    }

    /* Search Results Panel */
    .search-results-panel {
      display: none;
      flex-direction: column;
      position: absolute;
      top: 96px;
      left: 8px;
      right: 8px;
      max-height: 320px;
      background: var(--bg);
      border: 1px solid var(--line-color);
      border-radius: 6px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.16);
      z-index: 1000;
      overflow-y: auto;
      user-select: none;
    }

    .search-results-panel.active {
      display: flex;
    }

    .search-file-group {
      border-bottom: 1px solid var(--line-color);
    }

    .search-file-group:last-child {
      border-bottom: none;
    }

    .search-file-title {
      font-family: var(--editor-font);
      font-size: 11px;
      font-weight: 700;
      color: var(--fg);
      padding: 6px 10px;
      background: var(--hover-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .search-file-count {
      font-size: 10px;
      font-weight: normal;
      color: var(--gutter-fg);
    }

    .search-result-row {
      display: flex;
      align-items: center;
      padding: 4px 10px 4px 16px;
      cursor: pointer;
      font-family: var(--editor-font);
      font-size: 11px;
      gap: 8px;
      transition: background-color 0.1s ease;
    }

    .search-result-row:hover, .search-result-row.selected {
      background: var(--active-bg);
    }

    .search-line-num {
      color: var(--gutter-fg);
      font-size: 10px;
      width: 24px;
      text-align: right;
      flex-shrink: 0;
    }

    .search-line-snippet {
      color: var(--fg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .search-highlight {
      background-color: var(--highlight-bg);
      border-radius: 2px;
      font-weight: 600;
    }

    /* Main View Content Area */
    .view-content {
      position: relative;
      flex: 1;
      width: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    /* Editor View */
    .editor-wrapper {
      position: relative;
      flex: 1;
      width: 100%;
      height: 100%;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--editor-bg);
      user-select: text;
    }

    .editor-wrapper.hidden {
      display: none;
    }

    #cm-editor-root {
      flex: 1;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    /* Drawer View (Files List) */
    .drawer-view {
      display: none;
      flex-direction: column;
      flex: 1;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      padding: 8px 12px;
      min-height: 0;
    }

    .drawer-view.active {
      display: flex;
    }

    .doc-list {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    .doc-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 8px;
      border-bottom: 1px solid var(--line-color);
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease;
      gap: 8px;
    }

    .doc-item:hover {
      background-color: var(--hover-bg);
    }

    .doc-item:first-child {
      border-top: 1px solid var(--line-color);
    }

    .doc-item.selected {
      background-color: var(--active-bg);
    }

    .doc-item-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }

    .doc-item-title {
      font-family: var(--editor-font);
      font-size: 12px;
      color: var(--fg);
      letter-spacing: -0.01em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .doc-item-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .doc-pin-btn {
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      font-size: 12px;
      opacity: 0.4;
      padding: 2px 4px;
      border-radius: 3px;
      transition: opacity 0.15s ease, background-color 0.15s ease;
    }

    .doc-pin-btn:hover {
      opacity: 1;
      background: var(--hover-bg);
    }

    .doc-pin-btn.pinned {
      opacity: 1;
    }

    /* Custom Right-Click Context Menu */
    .custom-context-menu {
      display: none;
      position: fixed;
      background: var(--bg);
      border: 1px solid var(--line-color);
      border-radius: 5px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
      z-index: 2000;
      padding: 4px 0;
      min-width: 170px;
    }

    .custom-context-menu.active {
      display: block;
    }

    .context-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      font-size: 12px;
      color: var(--fg);
      cursor: pointer;
      transition: background-color 0.12s ease;
    }

    .context-menu-item:hover {
      background-color: var(--hover-bg);
    }

    .context-menu-sep {
      height: 1px;
      background-color: var(--line-color);
      margin: 4px 0;
    }

    /* Inline new file bar */
    .new-file-bar {
      display: none;
      padding: 6px 10px;
      background: var(--hover-bg);
      border-bottom: 1px solid var(--line-color);
    }

    .new-file-bar.active {
      display: flex;
      gap: 8px;
    }

    .new-file-input {
      flex: 1;
      background: var(--editor-bg);
      color: var(--editor-fg);
      border: 1px solid var(--line-color);
      padding: 4px 8px;
      border-radius: 4px;
      font-family: var(--editor-font);
      font-size: 12px;
      outline: none;
    }

    .new-file-input:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }

    /* Custom thin scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(128, 128, 128, 0.25);
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: rgba(128, 128, 128, 0.45);
    }
  </style>
</head>
<body>
  <div class="container">

    <!-- Top Extension Header -->
    <!--sync:region header-->
    <div class="extension-header">
      <div class="header-left">
        <div class="brand-group">
          <svg class="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M14.15 13.91C15.84 12.22 14.77 8.42 11.78 5.43C8.78 2.43 4.98 1.36 3.29 3.05C1.6 4.74 2.67 8.54 5.67 11.54C8.67 14.53 12.46 15.6 14.15 13.91Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M14.15 9.63C15.84 11.31 14.77 15.11 11.78 18.11C8.78 21.11 4.98 22.17 3.29 20.49C1.6 18.8 2.67 15 5.67 12C8.67 9 12.46 7.94 14.15 9.63Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M9.84 13.91C8.15 12.22 9.22 8.42 12.22 5.43C15.21 2.43 19.01 1.36 20.7 3.05C22.39 4.74 21.32 8.54 18.32 11.54C15.33 14.53 11.53 15.6 9.84 13.91Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M9.84 9.63C8.15 11.31 9.22 15.11 12.22 18.11C15.21 21.11 19.01 22.17 20.7 20.49C22.39 18.8 21.32 15 18.32 12C15.33 9 11.53 7.94 9.84 9.63Z" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span class="brand-title">FRACTALSTYLER</span>
          <!--sync:keep if-1-->
          <span class="brand-sep">/</span>
          <div class="current-file-badge" id="current-file-badge" title="Right-click for options, click to open in main editor">
            <span id="current-filename-label">_04_layouts.sass</span>
            <span class="open-glyph">↗</span>
          </div>
          <!--/sync:keep if-1-->
        </div>
      </div>
      <div class="header-right">
        <!--sync:keep actions-->
        <button class="header-btn" id="btn-pin-toggle" title="Pin / Unpin current file">📌</button>
        <button class="header-btn" id="btn-new-file" title="New Style File">+</button>
        <!--/sync:keep actions-->
        <button class="header-btn" type="button" aria-label="Toggle files list" aria-controls="drawer-view" id="btn-drawer-toggle" title="Toggle Files List">
          ☰
        </button>
      </div>
    </div>
    <!--/sync:region header-->

    <!-- Pinned Files Bar (Horizontal tabs right at the top) -->
    <div class="pinned-bar" id="pinned-bar">
      <div class="pinned-tabs" id="pinned-tabs"></div>
    </div>

    <!-- Search Input Bar in Header -->
    <div class="search-bar-container" id="search-bar-container">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
        <input id="search-input" class="search-input" type="text" placeholder="Search Sass files... (⌘F)" spellcheck="false" autocomplete="off" />
        <span id="search-count" class="search-count"></span>
        <button id="search-clear-btn" class="search-clear-btn" title="Clear search">✕</button>
      </div>
    </div>

    <!-- Search Results Dropdown Panel -->
    <div class="search-results-panel" id="search-results-panel">
      <div id="search-results-list" class="search-results-list"></div>
    </div>

    <!-- Optional New File Bar -->
    <div id="new-file-bar" class="new-file-bar">
      <input id="new-file-input" class="new-file-input" type="text" placeholder="filename.sass" />
    </div>

    <!--sync:region view-content-->
    <div class="view-content">
      <div class="editor-wrapper" id="editor-wrapper">
        <!--sync:keep children-->
        <div id="cm-editor-root"></div>
        <!--/sync:keep children-->
      </div>
      <div id="drawer-view" class="drawer-view">
        <div class="doc-list" id="doc-list">
          <!--sync:keep each-1--><!--/sync:keep each-1-->
        </div>
      </div>
    </div>
    <!--/sync:region view-content-->

    <!-- Custom Right-Click Context Menu -->
    <div class="custom-context-menu" id="custom-context-menu">
      <div class="context-menu-item" id="ctx-open-editor">↗ Open in Main Editor</div>
      <div class="context-menu-item" id="ctx-toggle-pin">📌 Pin / Unpin File</div>
      <div class="context-menu-sep"></div>
      <div class="context-menu-item" id="ctx-copy-name">📋 Copy Filename</div>
      <div class="context-menu-item" id="ctx-reveal-os">📁 Reveal in Finder</div>
    </div>

  </div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
