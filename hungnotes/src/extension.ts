import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function activate(context: vscode.ExtensionContext) {
  const provider = new HungnotesViewProvider(context.extensionUri, context);

  // Register provider for both the sidebar activitybar container and panel container
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hungnotes.view', provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('hungnotes.panelView', provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hungnotes.newNote', () => {
      provider.createNewNote();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hungnotes.openCurrentInEditor', () => {
      provider.openCurrentInEditor();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hungnotes.openNotesFolder', () => {
      provider.openNotesFolder();
    })
  );
}

export function deactivate() {}

export interface NoteItem {
  filename: string;
  title: string;
  mtime: number;
}

export class HungnotesViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private currentNoteFilename: string = '';
  private currentNoteTitle: string = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _context: vscode.ExtensionContext
  ) {}

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

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'ready': {
          await this.initSessionNote();
          break;
        }
        case 'save': {
          await this.saveNote(data.filename, data.content);
          break;
        }
        case 'rename': {
          await this.renameNote(data.oldFilename, data.newTitle);
          break;
        }
        case 'getNotes': {
          await this.sendNotesList();
          break;
        }
        case 'openNote': {
          await this.loadNote(data.filename);
          break;
        }
        case 'newNote': {
          await this.createNewNote();
          break;
        }
        case 'deleteNote': {
          await this.deleteNote(data.filename);
          break;
        }
        case 'openInEditor': {
          await this.openCurrentInEditor();
          break;
        }
        case 'openFolder': {
          await this.openNotesFolder();
          break;
        }
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        // Refresh notes list when opened/visible
        this.sendNotesList();
      }
    });
  }

  public getNotesDirectory(): string {
    const config = vscode.workspace.getConfiguration('hungnotes');
    let dir = config.get<string>('notesDirectory')?.trim();

    if (!dir) {
      dir = path.join(os.homedir(), '.hungnotes');
    } else if (dir.startsWith('~')) {
      dir = path.join(os.homedir(), dir.slice(1));
    }

    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (e) {
        console.error('Failed to create notes directory', e);
      }
    }
    return dir;
  }

  private getDateFormat(): string {
    const config = vscode.workspace.getConfiguration('hungnotes');
    return config.get<string>('dateFormat') || 'YYYY-MM-DD';
  }

  private getDefaultTemplate(): string {
    const config = vscode.workspace.getConfiguration('hungnotes');
    const template = config.get<string>('defaultTemplate');
    if (template !== undefined) {
      return template.replace(/\\n/g, '\n');
    }
    return '## raw notes\n\n';
  }

  private formatDate(date: Date, format: string): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');

    if (format === 'YYYY-DD-MM') {
      return `${yyyy}-${dd}-${mm}`;
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Initializes a new note each time the tool is opened/launched
   */
  private async initSessionNote() {
    const dir = this.getNotesDirectory();
    const format = this.getDateFormat();
    const baseDate = this.formatDate(new Date(), format);
    const template = this.getDefaultTemplate();

    let targetFilename = `${baseDate}.md`;
    let targetPath = path.join(dir, targetFilename);

    if (fs.existsSync(targetPath)) {
      try {
        const existingContent = await fs.promises.readFile(targetPath, 'utf8');
        // If the existing file has already been edited (not just empty or default template),
        // create a subsequent sequence file so the user gets a fresh doc every time tool is opened
        if (existingContent.trim().length > 0 && existingContent.trim() !== template.trim()) {
          let counter = 1;
          while (fs.existsSync(path.join(dir, `${baseDate}-${counter}.md`))) {
            const nextPath = path.join(dir, `${baseDate}-${counter}.md`);
            const nextContent = await fs.promises.readFile(nextPath, 'utf8');
            if (nextContent.trim().length === 0 || nextContent.trim() === template.trim()) {
              targetFilename = `${baseDate}-${counter}.md`;
              targetPath = nextPath;
              break;
            }
            counter++;
          }
          if (targetFilename === `${baseDate}.md`) {
            targetFilename = `${baseDate}-${counter}.md`;
            targetPath = path.join(dir, targetFilename);
          }
        }
      } catch (err) {
        console.error('Error checking existing file', err);
      }
    }

    if (!fs.existsSync(targetPath)) {
      try {
        await fs.promises.writeFile(targetPath, template, 'utf8');
      } catch (e) {
        console.error('Failed to create new note file', e);
      }
    }

    let content = template;
    try {
      content = await fs.promises.readFile(targetPath, 'utf8');
    } catch {}

    const title = targetFilename.replace(/\.md$/i, '');
    this.currentNoteFilename = targetFilename;
    this.currentNoteTitle = title;

    this.sendMessage({
      type: 'noteLoaded',
      filename: targetFilename,
      title: title,
      content: content
    });

    await this.sendNotesList();
  }

  public async createNewNote() {
    const dir = this.getNotesDirectory();
    const format = this.getDateFormat();
    const baseDate = this.formatDate(new Date(), format);
    const template = this.getDefaultTemplate();

    let targetFilename = `${baseDate}.md`;
    let counter = 1;

    if (fs.existsSync(path.join(dir, targetFilename))) {
      while (fs.existsSync(path.join(dir, `${baseDate}-${counter}.md`))) {
        counter++;
      }
      targetFilename = `${baseDate}-${counter}.md`;
    }

    const targetPath = path.join(dir, targetFilename);
    await fs.promises.writeFile(targetPath, template, 'utf8');

    const title = targetFilename.replace(/\.md$/i, '');
    this.currentNoteFilename = targetFilename;
    this.currentNoteTitle = title;

    this.sendMessage({
      type: 'noteLoaded',
      filename: targetFilename,
      title: title,
      content: template
    });

    await this.sendNotesList();
  }

  private async loadNote(filename: string) {
    const dir = this.getNotesDirectory();
    const filePath = path.join(dir, filename);

    if (!fs.existsSync(filePath)) {
      vscode.window.showErrorMessage(`Hungnotes: File ${filename} not found.`);
      return;
    }

    const content = await fs.promises.readFile(filePath, 'utf8');
    const title = filename.replace(/\.md$/i, '');
    this.currentNoteFilename = filename;
    this.currentNoteTitle = title;

    this.sendMessage({
      type: 'noteLoaded',
      filename: filename,
      title: title,
      content: content
    });
  }

  private async saveNote(filename: string, content: string) {
    if (!filename) return;
    const dir = this.getNotesDirectory();
    const filePath = path.join(dir, filename);

    try {
      await fs.promises.writeFile(filePath, content, 'utf8');
    } catch (e) {
      console.error('Failed to auto-save note', e);
    }
  }

  private async renameNote(oldFilename: string, newTitle: string) {
    if (!oldFilename || !newTitle) return;
    const sanitizedTitle = newTitle.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!sanitizedTitle) return;

    const newFilename = sanitizedTitle.endsWith('.md') ? sanitizedTitle : `${sanitizedTitle}.md`;
    if (newFilename === oldFilename) return;

    const dir = this.getNotesDirectory();
    const oldPath = path.join(dir, oldFilename);
    const newPath = path.join(dir, newFilename);

    try {
      if (fs.existsSync(newPath)) {
        vscode.window.showWarningMessage(`Hungnotes: Note "${newFilename}" already exists.`);
        return;
      }
      if (fs.existsSync(oldPath)) {
        await fs.promises.rename(oldPath, newPath);
        this.currentNoteFilename = newFilename;
        this.currentNoteTitle = sanitizedTitle.replace(/\.md$/i, '');
        this.sendMessage({
          type: 'noteRenamed',
          oldFilename: oldFilename,
          newFilename: newFilename,
          newTitle: this.currentNoteTitle
        });
        await this.sendNotesList();
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to rename note: ${e}`);
    }
  }

  private async deleteNote(filename: string) {
    if (!filename) return;
    const dir = this.getNotesDirectory();
    const filePath = path.join(dir, filename);

    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        if (this.currentNoteFilename === filename) {
          await this.createNewNote();
        } else {
          await this.sendNotesList();
        }
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to delete note: ${e}`);
    }
  }

  private async sendNotesList() {
    const dir = this.getNotesDirectory();
    try {
      const files = await fs.promises.readdir(dir);
      const mdFiles = files.filter(f => f.toLowerCase().endsWith('.md'));

      const notes: NoteItem[] = [];
      for (const file of mdFiles) {
        try {
          const stat = await fs.promises.stat(path.join(dir, file));
          notes.push({
            filename: file,
            title: file.replace(/\.md$/i, ''),
            mtime: stat.mtimeMs
          });
        } catch {}
      }

      notes.sort((a, b) => b.mtime - a.mtime);

      this.sendMessage({
        type: 'notesList',
        notes: notes
      });
    } catch (e) {
      console.error('Failed to list notes', e);
    }
  }

  public async openCurrentInEditor() {
    if (!this.currentNoteFilename) return;
    const dir = this.getNotesDirectory();
    const filePath = path.join(dir, this.currentNoteFilename);

    if (fs.existsSync(filePath)) {
      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc);
    }
  }

  public async openNotesFolder() {
    const dir = this.getNotesDirectory();
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
  }

  private sendMessage(msg: any) {
    if (this._view) {
      this._view.webview.postMessage(msg);
    }
  }

  private getHtmlForWebview(_webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hungnotes</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --fg: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc));
      --editor-bg: var(--vscode-editor-background, #1e1e1e);
      --editor-fg: var(--vscode-editor-foreground, #d4d4d4);
      --card-border: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.22)));
      --line-color: var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.18)));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08));
      --icon-color: var(--vscode-icon-foreground, var(--vscode-foreground, #cccccc));
      --font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --editor-font: var(--vscode-editor-font-family, var(--vscode-font-family, monospace));
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
      font-size: 13px;
    }

    .container {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      padding: 10px 14px 14px 14px;
      --bg: var(--hn-bg, var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e)));
      --fg: var(--hn-fg, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc)));
      --editor-bg: var(--hn-editor-bg, var(--vscode-editor-background, #1e1e1e));
      --card-border: var(--hn-border, var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.22))));
      --line-color: var(--hn-line, var(--vscode-editorWidget-border, var(--vscode-widget-border, rgba(128, 128, 128, 0.18))));
      --hover-bg: var(--hn-hover, var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.08)));
      --icon-color: var(--hn-icon, var(--vscode-icon-foreground, var(--vscode-foreground, #cccccc)));
      box-sizing: border-box;
      background: var(--bg);
      color: var(--fg);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      font-size: 13px;
    }

    /* Top Navigation Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 32px;
      margin-bottom: 12px;
      user-select: none;
    }

    .brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--fg);
      opacity: 0.9;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .icon-btn {
      background: transparent;
      border: none;
      outline: none;
      cursor: pointer;
      color: var(--icon-color);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2px;
      border-radius: 4px;
      transition: opacity 0.15s ease, background-color 0.15s ease;
    }

    .icon-btn:hover {
      opacity: 0.8;
      background: var(--hover-bg);
    }

    .icon-btn:active {
      transform: scale(0.96);
    }

    .icon-btn svg {
      width: 19px;
      height: 19px;
      display: block;
    }

    /* Main View Area */
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
      display: flex;
      flex-direction: column;
      flex: 1;
      width: 100%;
      height: 100%;
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 22px 20px 20px 20px;
      background: var(--editor-bg);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
      min-height: 0;
    }

    .doc-title-input {
      font-size: 22px;
      font-weight: 700;
      color: var(--editor-fg);
      border: none;
      background: transparent;
      outline: none;
      font-family: inherit;
      margin-bottom: 20px;
      letter-spacing: -0.01em;
      width: 100%;
    }

    .editor-textarea {
      flex: 1;
      width: 100%;
      height: 100%;
      border: none;
      outline: none;
      background: transparent;
      color: var(--editor-fg);
      font-family: inherit;
      font-size: 14px;
      line-height: 1.65;
      resize: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-y: auto;
    }

    .editor-textarea::placeholder {
      opacity: 0.4;
    }

    /* Drawer / List View */
    .drawer-view {
      display: none;
      flex-direction: column;
      flex: 1;
      width: 100%;
      height: 100%;
      overflow-y: auto;
      padding-top: 4px;
      min-height: 0;
    }

    .drawer-view.active {
      display: flex;
    }

    .editor-wrapper.hidden {
      display: none;
    }

    .doc-list {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    .doc-item {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 18px 6px;
      border-bottom: 1px solid var(--line-color);
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s ease;
    }

    .doc-item:hover {
      background-color: var(--hover-bg);
    }

    .doc-item:first-child {
      border-top: 1px solid var(--line-color);
    }

    .doc-item-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--fg);
      letter-spacing: -0.01em;
      text-align: right;
    }

    .empty-state {
      padding: 40px 10px;
      text-align: center;
      opacity: 0.5;
      font-size: 14px;
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
    <!--sync:region header-->
    <div class="header">
      <div class="brand">HUNGNOTES</div>
      <div class="actions">
        <!--sync:keep actions-->
        <!-- 1. Open in Full Editor / Focus -->
        <button id="btn-focus" class="icon-btn" title="Open in VS Code Editor">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>

        <!-- 2. New Note (SVG 3) -->
        <button id="btn-new" class="icon-btn" title="New Note">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M5 19V5zv-.025zm0 2q-.825 0-1.412-.587T3 19V5q0-.825.588-1.412T5 3h14q.825 0 1.413.588T21 5v8.35q-.475-.175-.975-.262T19 13V5H5v14h8q0 .525.088 1.025t.262.975zm14 2l-1.4-1.4l1.575-1.6H15v-2h4.175L17.6 16.4L19 15l4 4zm-8-6h2v-4h4v-2h-4V7h-2v4H7v2h4z"/>
          </svg>
        </button>
        <!--/sync:keep actions-->
        <button id="btn-drawer" class="icon-btn" type="button" aria-controls="drawer-view" title="View Previous Docs">
          <!--sync:keep if-1-->
          <!-- Open Drawer Icon (SVG 2) -->
          <svg id="icon-drawer-open" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M11.5 16V8l-4 4zm4.5 3h3V5h-3zM5 19h9V5H5zm11 0h3zM3 21V3h18v18z"/>
          </svg>
          <!-- Close Drawer Icon (SVG 1) -->
          <svg id="icon-drawer-close" style="display: none;" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M9.15 16.25L12 13.4l2.85 2.85l1.4-1.4L13.4 12l2.85-2.85l-1.4-1.4L12 10.6L9.15 7.75l-1.4 1.4L10.6 12l-2.85 2.85zM5 19V5zm-2 2V3h18v10.35q-.475-.175-.975-.262T19 13V5H5v14h8q0 .525.088 1.025t.262.975zm16 2l-1.4-1.4l1.575-1.6H15v-2h4.175L17.6 16.4L19 15l4 4z"/>
          </svg>
          <!--/sync:keep if-1-->
        </button>
      </div>
    </div>
    <!--/sync:region header-->

    <!--sync:region view-content-->
    <div class="view-content">
      <div class="editor-wrapper" id="editor-wrapper">
        <!--sync:keep children-->
        <input id="doc-title" class="doc-title-input" type="text" placeholder="Title" />
        <textarea id="markdown-editor" class="editor-textarea" placeholder="## raw notes..."></textarea>
        <!--/sync:keep children-->
      </div>
      <div id="drawer-view" class="drawer-view">
        <div class="doc-list" id="doc-list">
          <!--sync:keep each-1--><!--/sync:keep each-1-->
        </div>
      </div>
    </div>
    <!--/sync:region view-content-->
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    // DOM Elements
    const editorWrapper = document.getElementById('editor-wrapper');
    const drawerView = document.getElementById('drawer-view');
    const docList = document.getElementById('doc-list');
    const docTitle = document.getElementById('doc-title');
    const markdownEditor = document.getElementById('markdown-editor');

    const btnFocus = document.getElementById('btn-focus');
    const btnNew = document.getElementById('btn-new');
    const btnDrawer = document.getElementById('btn-drawer');
    const iconDrawerOpen = document.getElementById('icon-drawer-open');
    const iconDrawerClose = document.getElementById('icon-drawer-close');

    let currentFilename = '';
    let currentTitle = '';
    let isDrawerOpen = false;
    let saveTimeout = null;

    // Notify backend ready
    vscode.postMessage({ type: 'ready' });

    // Handle messages from backend
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'noteLoaded': {
          currentFilename = message.filename;
          currentTitle = message.title;
          docTitle.value = message.title;
          markdownEditor.value = message.content;
          setDrawerView(false);
          break;
        }
        case 'noteRenamed': {
          if (currentFilename === message.oldFilename) {
            currentFilename = message.newFilename;
            currentTitle = message.newTitle;
            docTitle.value = message.newTitle;
          }
          break;
        }
        case 'notesList': {
          renderNotesList(message.notes);
          break;
        }
      }
    });

    // Auto-save debounced
    function scheduleSave() {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (currentFilename) {
          vscode.postMessage({
            type: 'save',
            filename: currentFilename,
            content: markdownEditor.value
          });
        }
      }, 250);
    }

    markdownEditor.addEventListener('input', scheduleSave);

    // Support Tab key indentation inside editor
    markdownEditor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = markdownEditor.selectionStart;
        const end = markdownEditor.selectionEnd;
        const val = markdownEditor.value;
        markdownEditor.value = val.substring(0, start) + '  ' + val.substring(end);
        markdownEditor.selectionStart = markdownEditor.selectionEnd = start + 2;
        scheduleSave();
      }
    });

    // Title rename on blur or Enter
    docTitle.addEventListener('blur', () => {
      const newTitle = docTitle.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        vscode.postMessage({
          type: 'rename',
          oldFilename: currentFilename,
          newTitle: newTitle
        });
      }
    });

    docTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        docTitle.blur();
        markdownEditor.focus();
      }
    });

    // Toggle Drawer
    function setDrawerView(open) {
      isDrawerOpen = open;
      if (isDrawerOpen) {
        editorWrapper.classList.add('hidden');
        drawerView.classList.add('active');
        iconDrawerOpen.style.display = 'none';
        iconDrawerClose.style.display = 'block';
        btnDrawer.title = 'Close Drawer';
        vscode.postMessage({ type: 'getNotes' });
      } else {
        editorWrapper.classList.remove('hidden');
        drawerView.classList.remove('active');
        iconDrawerOpen.style.display = 'block';
        iconDrawerClose.style.display = 'none';
        btnDrawer.title = 'View Previous Docs';
      }
    }

    btnDrawer.addEventListener('click', () => {
      setDrawerView(!isDrawerOpen);
    });

    btnNew.addEventListener('click', () => {
      vscode.postMessage({ type: 'newNote' });
      setDrawerView(false);
    });

    btnFocus.addEventListener('click', () => {
      vscode.postMessage({ type: 'openInEditor' });
    });

    // Render Previous Docs List
    function renderNotesList(notes) {
      docList.innerHTML = '';
      if (!notes || notes.length === 0) {
        docList.innerHTML = '<div class="empty-state">No previous notes found</div>';
        return;
      }

      notes.forEach((note) => {
        const item = document.createElement('div');
        item.className = 'doc-item';
        
        const titleSpan = document.createElement('span');
        titleSpan.className = 'doc-item-title';
        titleSpan.textContent = note.title;

        item.appendChild(titleSpan);

        item.addEventListener('click', () => {
          vscode.postMessage({
            type: 'openNote',
            filename: note.filename
          });
          setDrawerView(false);
        });

        docList.appendChild(item);
      });
    }
  </script>
</body>
</html>`;
  }
}
