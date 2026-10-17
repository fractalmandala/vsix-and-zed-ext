'use strict';

const vscode = require('vscode');
const crypto = require('node:crypto');
const os = require('node:os');
const nodePath = require('node:path');

const { buildOverrideEdits, buildRippleEdits, indexTheme } = require('./themeIndex');
const { buildStudioState } = require('./state');
const {
  buildInstallTarget,
  buildThemeExtensionManifest,
  parseThemeText,
  themeFileName,
  withName
} = require('./themeExport');

const PREVIEW_SETTING_KEYS = [
  'workbench.colorTheme',
  'workbench.colorCustomizations',
  'editor.tokenColorCustomizations',
  'editor.semanticTokenColorCustomizations'
];

const PREVIEW_ACTIVE_STATE = 'fractalThemeStudio.previewActive';
const PREVIEW_STASH_STATE = 'fractalThemeStudio.previewStash';
const THEME_FILE_PATTERN = /-color-theme\.json$/i;
const SAMPLE_THEME_DIR = 'themes';
const SAMPLE_THEME_FILE = 'fractal-studio-sample-color-theme.json';

let activePanel;
let LIVE_CONTEXT;

function activate(context) {
  LIVE_CONTEXT = context;

  context.subscriptions.push(
    vscode.commands.registerCommand('fractalThemeStudio.open', () => ThemeStudioPanel.createOrShow(context)),
    vscode.commands.registerCommand('fractalThemeStudio.exportTheme', () =>
      ThemeStudioPanel.current
        ? ThemeStudioPanel.current.exportTheme()
        : vscode.window.showInformationMessage('Fractal Theme Studio: open the editor first.')
    ),
    vscode.commands.registerCommand('fractalThemeStudio.installTheme', () =>
      ThemeStudioPanel.current
        ? ThemeStudioPanel.current.installTheme()
        : vscode.window.showInformationMessage('Fractal Theme Studio: open the editor first.')
    )
  );

  recoverAbandonedPreview(context);
}

async function deactivate() {
  await endLivePreview();
}

async function endLivePreview() {
  if (activePanel) {
    await activePanel.restorePreviewNow();
    return;
  }

  const stash = LIVE_CONTEXT.workspaceState.get(PREVIEW_STASH_STATE);
  if (!LIVE_CONTEXT.workspaceState.get(PREVIEW_ACTIVE_STATE) || !stash) {
    return;
  }

  await restorePreviewSettings(stash);
  await LIVE_CONTEXT.workspaceState.update(PREVIEW_ACTIVE_STATE, false);
  await LIVE_CONTEXT.workspaceState.update(PREVIEW_STASH_STATE, undefined);
}

/**
 * If a previous session left the live preview applied — a crash, a force quit —
 * put the user's settings back the moment we start up again.
 */
async function recoverAbandonedPreview(context) {
  const wasActive = context.workspaceState.get(PREVIEW_ACTIVE_STATE);
  const stash = context.workspaceState.get(PREVIEW_STASH_STATE);

  if (!wasActive || !stash) {
    return;
  }

  await restorePreviewSettings(stash);
  await context.workspaceState.update(PREVIEW_ACTIVE_STATE, false);
  await context.workspaceState.update(PREVIEW_STASH_STATE, undefined);
}

function isThemeDocument(document) {
  if (!document || document.uri.scheme !== 'file') {
    return false;
  }

  if (THEME_FILE_PATTERN.test(document.uri.path)) {
    return true;
  }

  return document.getText().includes('vscode://schemas/color-theme');
}

async function ensureThemeDocument(uri) {
  const existing = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === uri.toString()
  );
  const document = existing || (await vscode.workspace.openTextDocument(uri));

  if (!isThemeDocument(document)) {
    await vscode.window.showWarningMessage(
      'Fractal Theme Studio: that file does not look like a color theme JSON.'
    );
    return null;
  }

  await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: true });
  return document;
}

function previewTarget() {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function readSettingValue(config, key, target) {
  const inspected = config.inspect(key);
  const value = target === vscode.ConfigurationTarget.Workspace
    ? inspected && inspected.workspaceValue
    : inspected && inspected.globalValue;

  return value;
}

function capturePreviewStash() {
  const config = vscode.workspace.getConfiguration();
  const target = previewTarget();
  const stash = {};

  for (const key of PREVIEW_SETTING_KEYS) {
    const value = readSettingValue(config, key, target);
    stash[key] = { present: value !== undefined, value };
  }

  return stash;
}

async function applyPreviewSettings(text) {
  const theme = parseThemeText(text);
  const config = vscode.workspace.getConfiguration();
  const target = previewTarget();

  await config.update('workbench.colorCustomizations', theme.colors || {}, target);
  await config.update('editor.tokenColorCustomizations', { textMateRules: theme.tokenColors || [] }, target);
  await config.update(
    'editor.semanticTokenColorCustomizations',
    { enabled: true, rules: theme.semanticTokenColors || {} },
    target
  );
}

/**
 * Put every setting the preview touched back exactly as it was. Keys missing
 * from the stash are left alone — an older stash must not blank newer settings.
 */
async function restorePreviewSettings(stash) {
  const config = vscode.workspace.getConfiguration();
  const target = previewTarget();

  for (const key of PREVIEW_SETTING_KEYS) {
    const entry = stash ? stash[key] : undefined;

    if (!entry) {
      continue;
    }

    await config.update(key, entry.present ? entry.value : undefined, target);
  }
}

function activeThemeName() {
  return vscode.workspace.getConfiguration('workbench').get('colorTheme');
}

/**
 * Live preview can only recolor the theme that is actually active, so previewing
 * switches to the edited theme — VS Code ignores a label that is not installed,
 * which would leave the preview looking like it does nothing.
 */
async function syncPreviewTheme(themeName, announce) {
  if (!themeName || activeThemeName() === themeName) {
    return;
  }

  if (!(await themeLabels()).includes(themeName)) {
    if (announce) {
      vscode.window.showInformationMessage(
        `Fractal Theme Studio: "${themeName}" is not an installed theme yet, so the live preview has nothing to recolor. Use Install, reload, then preview again.`
      );
    }
    return;
  }

  await vscode.workspace.getConfiguration().update('workbench.colorTheme', themeName, previewTarget());
}

async function themeLabels() {
  return vscode.extensions.all
    .flatMap((extension) => extension.packageJSON?.contributes?.themes || [])
    .map((theme) => theme.label);
}

function getNonce() {
  return crypto.randomBytes(16).toString('hex');
}

class ThemeStudioPanel {
  static current;

  static async createOrShow(context, preferredUri) {
    if (ThemeStudioPanel.current) {
      ThemeStudioPanel.current.panel.reveal(ThemeStudioPanel.current.panel.viewColumn);
      await ThemeStudioPanel.current.postState();
      return;
    }

    const document = preferredUri
      ? await ensureThemeDocument(preferredUri)
      : await resolveThemeDocument(context);

    if (!document) {
      vscode.window.showWarningMessage('Fractal Theme Studio: no color theme JSON available.');
      return;
    }

    const panel = vscode.window.createWebviewPanel('fractalThemeStudio', 'Theme Studio', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    });

    ThemeStudioPanel.current = new ThemeStudioPanel(panel, context, document.uri);
  }

  constructor(panel, context, documentUri) {
    this.panel = panel;
    this.context = context;
    this.queue = Promise.resolve();
    this.applyingEdit = false;
    this.editedFromStudio = false;
    this.disposed = false;
    this.repostTimer = null;
    this.previewing = false;

    activePanel = this;

    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(
      (message) => {
        this.queue = this.queue
          .then(() => this.handleMessage(message))
          .catch((error) => vscode.window.showErrorMessage(`Fractal Theme Studio: ${error.message}`));
      },
      null,
      context.subscriptions
    );

    panel.onDidDispose(() => this.dispose(), null, context.subscriptions);

    this.bindThemeDocument(documentUri);
  }

  bindThemeDocument(documentUri) {
    this.documentUri = documentUri;

    if (this.changeSubscription) {
      this.changeSubscription.dispose();
    }

    this.changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => this.onDocumentChanged(event));
  }

  document() {
    return vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === this.documentUri.toString()
    );
  }

  onDocumentChanged(event) {
    if (this.disposed) {
      return;
    }

    if (event.document.uri.toString() !== this.documentUri.toString() || this.applyingEdit) {
      return;
    }

    if (this.repostTimer) {
      clearTimeout(this.repostTimer);
    }

    this.repostTimer = setTimeout(() => {
      this.repostTimer = null;
      this.postState().catch(() => {});
    }, 120);
  }

  async handleMessage(message) {
    if (!message || typeof message.type !== 'string') {
      return;
    }

    switch (message.type) {
      case 'ready':
        await this.ready();
        return;
      case 'setBase':
        await this.setBase(message.from, message.to);
        return;
      case 'setToken':
        await this.setToken(message.pathString, message.color);
        return;
      case 'reveal':
        await this.reveal(message.start);
        return;
      case 'undo':
        await this.undo();
        return;
      case 'loadTheme':
        await this.loadTheme();
        return;
      case 'togglePreview':
        await this.togglePreview();
        return;
      case 'save':
        await this.save();
        return;
      case 'export':
        await this.exportTheme();
        return;
      case 'install':
        await this.installTheme();
        return;
      default:
    }
  }

  async ready() {
    if (this.context.workspaceState.get(PREVIEW_ACTIVE_STATE)) {
      this.previewing = true;
    }
    await this.postState();
  }

  /**
   * Switch the studio to another theme JSON. A fresh panel keeps the webview and
   * the live preview honest — nothing carries over from the old document.
   */
  async loadTheme() {
    const folders = vscode.workspace.workspaceFolders;
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: 'Edit Theme',
      defaultUri: folders && folders.length > 0 ? folders[0].uri : vscode.Uri.file(os.homedir()),
      filters: { 'Color Theme JSON': ['json'] }
    });

    if (!picked || picked.length === 0) {
      return;
    }

    const document = await ensureThemeDocument(picked[0]);
    if (!document) {
      return;
    }

    const context = this.context;
    const target = document.uri;

    this.dispose();
    await ThemeStudioPanel.createOrShow(context, target);
  }

  /**
   * Build the whole view model in the extension host so the webview stays a
   * renderer. Cheap enough to rebuild on every change: the theme is a few
   * hundred literals.
   */
  buildState() {
    const document = this.document();

    if (!document) {
      return { type: 'state', missing: true };
    }

    return buildStudioState({
      text: document.getText(),
      fileName: document.uri.path.split('/').pop(),
      dirty: document.isDirty,
      previewing: this.previewing
    });
  }

  async postState() {
    if (this.disposed) {
      return;
    }

    await this.panel.webview.postMessage(this.buildState());
  }

  async applyEdits(edits) {
    if (edits.length === 0) {
      return false;
    }

    const document = this.document();
    if (!document) {
      return false;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();

    for (const edit of edits) {
      workspaceEdit.replace(
        document.uri,
        new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end)),
        edit.text
      );
    }

    this.applyingEdit = true;
    try {
      const applied = await vscode.workspace.applyEdit(workspaceEdit);

      if (applied) {
        this.editedFromStudio = true;
        await this.revealDocument();
      }

      return applied;
    } finally {
      this.applyingEdit = false;
    }
  }

  /**
   * Colors the studio edits go through the normal workspace edit pipeline, so
   * the editor's own undo history holds every change — Cmd/Ctrl+Z reverts one
   * color at a time. The commands need the document editor focused first.
   */
  async undo() {
    const document = this.document();
    if (!document || !this.editedFromStudio) {
      return;
    }

    await this.revealDocument();
    await vscode.commands.executeCommand('undo');

    if (this.previewing) {
      await this.refreshPreview();
    }

    await this.postState();
  }

  async revealDocument() {
    const document = this.document();
    if (!document) {
      return;
    }

    const editors = vscode.window.visibleTextEditors.filter(
      (editor) => editor.document.uri.toString() === document.uri.toString()
    );

    if (editors.length > 0) {
      await vscode.window.showTextDocument(document, editors[0].viewColumn);
    } else {
      await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, preview: true });
    }
  }

  async setBase(from, to) {
    const document = this.document();
    if (!document || !from || !to) {
      return;
    }

    const { occurrences } = indexTheme(document.getText());
    const applied = await this.applyEdits(buildRippleEdits(occurrences, from, to));

    if (applied) {
      // Live preview reads the saved file, so an unsaved edit would never show.
      await document.save();
      await this.refreshPreview();
      await this.postState();
    }
  }

  async setToken(pathString, color) {
    const document = this.document();
    if (!document || !pathString || !color) {
      return;
    }

    const { occurrences } = indexTheme(document.getText());
    const applied = await this.applyEdits(buildOverrideEdits(occurrences, { [pathString]: color }));

    if (applied) {
      await document.save();
      await this.refreshPreview();
      await this.postState();
    }
  }

  async reveal(start) {
    if (typeof start !== 'number') {
      return;
    }

    const document = this.document();
    if (!document) {
      return;
    }

    await this.revealDocument();

    const editor = vscode.window.visibleTextEditors.find(
      (candidate) => candidate.document.uri.toString() === document.uri.toString()
    );
    if (!editor) {
      return;
    }

    const position = document.positionAt(start);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  async togglePreview() {
    if (this.previewing) {
      await this.restorePreviewNow();
    } else {
      await this.startPreview();
    }

    await this.postState();
  }

  async startPreview() {
    const document = this.document();
    if (!document) {
      return;
    }

    const theme = parseThemeText(document.getText());

    // Stash first: it has to capture the settings as they were, before we write.
    const stash = capturePreviewStash();
    await this.context.workspaceState.update(PREVIEW_STASH_STATE, stash);

    await syncPreviewTheme(theme.name, true);
    await applyPreviewSettings(document.getText());
    await this.context.workspaceState.update(PREVIEW_ACTIVE_STATE, true);
    this.previewing = true;
  }

  /**
   * Reassert the edited theme as the active one and push the current colors,
   * so every edit shows up live instead of only when preview is toggled.
   */
  async refreshPreview() {
    if (!this.previewing) {
      return;
    }

    const document = this.document();
    if (!document) {
      return;
    }

    await syncPreviewTheme(parseThemeText(document.getText()).name, false);
    await applyPreviewSettings(document.getText());
  }

  restorePreview() {
    const stash = this.context.workspaceState.get(PREVIEW_STASH_STATE);
    this.previewing = false;
    return this.context.workspaceState.update(PREVIEW_ACTIVE_STATE, false).then(() =>
      this.context.workspaceState.update(PREVIEW_STASH_STATE, undefined).then(() => restorePreviewSettings(stash))
    );
  }

  async restorePreviewNow() {
    if (!this.previewing && !this.context.workspaceState.get(PREVIEW_ACTIVE_STATE)) {
      return;
    }

    await this.restorePreview();
  }

  async save() {
    const document = this.document();
    if (!document) {
      return;
    }

    await document.save();
    await this.postState();
  }

  async exportTheme() {
    const document = this.document();
    if (!document) {
      return;
    }

    const theme = parseThemeText(document.getText());
    const name = await vscode.window.showInputBox({
      prompt: 'Theme name',
      value: theme.name || 'My Theme'
    });

    if (!name) {
      return;
    }

    const defaultUri = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file(os.homedir()),
      themeFileName(name)
    );

    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { 'Color Theme JSON': ['json'] }
    });

    if (!target) {
      return;
    }

    const text = withName(document.getText(), name);
    await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
    vscode.window.showInformationMessage(`Exported theme to ${target.fsPath}.`);
  }

  async installTheme() {
    const document = this.document();
    if (!document) {
      return;
    }

    const theme = parseThemeText(document.getText());
    const label = theme.name || 'My Theme';
    const manifest = buildThemeExtensionManifest({
      label,
      themeType: theme.type,
      themeFileName: themeFileName(label)
    });
    const target = buildInstallTarget({ manifest });

    const choice = await vscode.window.showWarningMessage(
      `Install "${label}" into your editor's extensions directory?\\n\\n${target.directory}\\n\\nReload the window afterwards to see it in the Color Theme picker.`,
      { modal: true },
      'Install'
    );

    if (choice !== 'Install') {
      return;
    }

    const themeText = withName(document.getText(), label);
    const encoder = new TextEncoder();

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(target.directory));
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(nodePath.dirname(target.themePath)));
    await vscode.workspace.fs.writeFile(
      vscode.Uri.file(target.packageJsonPath),
      encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`)
    );
    await vscode.workspace.fs.writeFile(vscode.Uri.file(target.themePath), encoder.encode(themeText));

    const reload = await vscode.window.showInformationMessage(
      `Installed "${label}". Reload the window to pick it up.`,
      'Reload Window'
    );

    if (reload === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  }

  dispose() {
    this.disposed = true;

    if (this.repostTimer) {
      clearTimeout(this.repostTimer);
      this.repostTimer = null;
    }

    if (this.changeSubscription) {
      this.changeSubscription.dispose();
      this.changeSubscription = undefined;
    }

    // Live preview deliberately outlives the panel — hiding the tab or moving it
    // must not drop the user back to their old theme. deactivate() ends it.
    if (ThemeStudioPanel.current === this) {
      ThemeStudioPanel.current = undefined;
    }
    if (activePanel === this) {
      activePanel = undefined;
    }
  }
}

async function resolveThemeDocument(context) {
  const active = vscode.window.activeTextEditor;
  if (active && isThemeDocument(active.document)) {
    return active.document;
  }

  for (const editor of vscode.window.visibleTextEditors) {
    if (isThemeDocument(editor.document)) {
      return editor.document;
    }
  }

  const configured = vscode.workspace.getConfiguration('fractalThemeStudio').get('defaultThemePath');
  if (configured) {
    try {
      return await vscode.workspace.openTextDocument(vscode.Uri.file(configured));
    } catch {
      vscode.window.showWarningMessage(
        `Fractal Theme Studio: could not open ${configured}. Falling back to the bundled sample.`
      );
    }
  }

  return openBundledSample(context);
}

function sampleTargetUris() {
  const folders = vscode.workspace.workspaceFolders;

  if (folders && folders.length > 0) {
    return {
      directory: folders[0].uri,
      file: vscode.Uri.joinPath(folders[0].uri, SAMPLE_THEME_FILE)
    };
  }

  const directory = vscode.Uri.joinPath(vscode.Uri.file(os.tmpdir()), 'fractal-theme-studio');

  return {
    directory,
    file: vscode.Uri.joinPath(directory, SAMPLE_THEME_FILE)
  };
}

/**
 * The extension always has something to open: it ships a sample theme and copies
 * it somewhere writable first, so edits never land in the installed extension
 * directory — which an update would replace.
 */
async function openBundledSample(context) {
  const source = vscode.Uri.joinPath(context.extensionUri, SAMPLE_THEME_DIR, SAMPLE_THEME_FILE);
  const target = sampleTargetUris();

  try {
    const bytes = await vscode.workspace.fs.readFile(source);
    await vscode.workspace.fs.createDirectory(target.directory);
    await vscode.workspace.fs.writeFile(target.file, bytes);

    const document = await vscode.workspace.openTextDocument(target.file);

    vscode.window.showInformationMessage(
      `Fractal Theme Studio: opened the bundled sample theme at ${target.file.fsPath}. Use Export to keep your own copy.`
    );

    return document;
  } catch (error) {
    vscode.window.showWarningMessage(`Fractal Theme Studio: could not open the bundled sample. ${error.message}`);
    return null;
  }
}

function getWebviewHtml(webview, extensionUri) {
  const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.css'));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.js'));
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${stylesUri}" rel="stylesheet">
<title>Theme Studio</title>
</head>
<body>
<header class="bar">
  <div class="identity">
    <strong id="themeName">&mdash;</strong>
    <span id="fileName" class="muted"></span>
  </div>
  <div id="contrast" class="contrast"></div>
  <div class="actions">
    <button id="load" type="button" class="ghost">Load</button>
    <button id="preview" type="button">Preview in IDE</button>
    <button id="save" type="button" class="ghost">Save</button>
    <button id="export" type="button" class="ghost">Export</button>
    <button id="install" type="button" class="ghost">Install</button>
  </div>
</header>

<main class="content">
  <section class="palette-section">
    <h2>Palette <span id="paletteSummary" class="muted"></span></h2>
    <p class="hint">Edit any color to update every place it is used; alpha variants keep their own transparency. With preview on, colors apply live as you hit Apply and the popover stays open; Cmd/Ctrl+Z undoes the last change.</p>
    <div id="palette" class="palette"></div>
  </section>

  <section class="tokens-section">
    <nav id="tabs" class="tabs">
      <button class="tab active" type="button" data-tab="workbench">Workbench</button>
      <button class="tab" type="button" data-tab="syntax">Syntax</button>
      <button class="tab" type="button" data-tab="semantic">Semantic</button>
    </nav>
    <div id="groups" class="groups"></div>
  </section>
</main>

<div id="popover" class="popover hidden" role="dialog" aria-label="Edit color">
  <div class="popover-head">
    <span id="popoverTitle" class="popover-title"></span>
    <button id="popoverClose" type="button" class="close" aria-label="Close">&times;</button>
  </div>
  <p id="popoverMeta" class="muted"></p>
  <div class="row">
    <input id="picker" type="color" aria-label="Color picker">
    <input id="hex" type="text" spellcheck="false" aria-label="Hex value">
  </div>
  <label class="row alpha-row">
    <span>Alpha</span>
    <input id="alpha" type="range" min="0" max="255" step="1">
    <output id="alphaValue"></output>
  </label>
  <div id="popoverContrast" class="popover-contrast"></div>
  <div class="popover-actions">
    <button id="popoverReset" type="button" class="ghost" disabled>Reset</button>
    <button id="popoverApply" type="button">Apply</button>
    <button id="popoverCancel" type="button" class="ghost">Cancel</button>
  </div>
</div>

<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

module.exports = { activate, deactivate };
