'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');

const THEME_PATH = '/Users/amrit/fractalmandala/fractaldev/daylight-bone-signal-color-theme.json';
const FALLBACK_THEME = '{"name":"Fallback","type":"dark","colors":{"focusBorder":"#F0873A","button.background":"#F0873A","button.hoverBackground":"#F0873ADD"}}';

const THEME_TEXT = fs.existsSync(THEME_PATH)
  ? fs.readFileSync(THEME_PATH, 'utf8')
  : FALLBACK_THEME;

const harness = {
  panels: [],
  posted: [],
  appliedEdits: [],
  settingsUpdates: [],
  readPaths: [],
  writtenPaths: [],
  openedForEditing: [],
  registered: new Map(),
  messageHandlers: [],
  changeHandlers: []
};

function makeDisposable() {
  return { dispose() {} };
}

function createDocument() {
  const uri = {
    scheme: 'file',
    path: '/themes/daylight-bone-signal-color-theme.json',
    fsPath: '/themes/daylight-bone-signal-color-theme.json',
    toString: () => 'file:///themes/daylight-bone-signal-color-theme.json'
  };

  return {
    uri,
    languageId: 'json',
    isDirty: false,
    getText: () => THEME_TEXT,
    save: async () => true,
    positionAt: (offset) => ({ offset })
  };
}

function createPanel() {
  const panel = {
    viewColumn: 1,
    webview: {
      html: '',
      cspSource: 'vscode-webview://test',
      asWebviewUri: (uri) => uri,
      postMessage: async (message) => {
        harness.posted.push(message);
        return true;
      },
      onDidReceiveMessage: (handler) => {
        harness.messageHandlers.push(handler);
        return makeDisposable();
      }
    },
    reveal() {},
    onDidDispose: () => makeDisposable(),
    dispose() {}
  };

  harness.panels.push(panel);
  return panel;
}

const vscodeMock = {
  commands: {
    registerCommand: (id, handler) => {
      harness.registered.set(id, handler);
      return makeDisposable();
    },
    executeCommand: async () => undefined
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createWebviewPanel: () => createPanel(),
    showWarningMessage: async () => undefined,
    showInformationMessage: async () => undefined,
    showErrorMessage: () => undefined,
    showInputBox: async () => undefined,
    showSaveDialog: async () => undefined,
    showOpenDialog: async () => undefined,
    showTextDocument: async () => ({ selection: null, revealRange() {} })
  },
  workspace: {
    workspaceFolders: undefined,
    textDocuments: [],
    getConfiguration: () => ({
      get: () => undefined,
      inspect: () => ({}),
      update: async (key, value, target) => {
        harness.settingsUpdates.push({ key, value, target });
      }
    }),
    applyEdit: async (edit) => {
      harness.appliedEdits.push(edit);
      return true;
    },
    openTextDocument: async (uri) => {
      harness.openedForEditing.push(uri && uri.path ? uri.path : String(uri));
      return createDocument();
    },
    onDidChangeTextDocument: (handler) => {
      harness.changeHandlers.push(handler);
      return makeDisposable();
    },
    fs: {
      readFile: async (uri) => {
        harness.readPaths.push(uri.path);
        return new TextEncoder().encode(THEME_TEXT);
      },
      writeFile: async (uri) => {
        harness.writtenPaths.push(uri.path);
      },
      createDirectory: async () => undefined
    }
  },
  Uri: {
    file: (value) => ({ scheme: 'file', fsPath: value, path: value, toString: () => `file://${value}` }),
    joinPath: (base, ...parts) => {
      const joined = [base && base.path ? base.path : '', ...parts].join('/');
      return { scheme: 'file', fsPath: joined, path: joined, toString: () => `file://${joined}` };
    }
  },
  extensions: {
    all: [
      {
        packageJSON: {
          contributes: { themes: [{ label: 'Daylight Bone Signal' }] }
        }
      }
    ]
  },
  ViewColumn: { One: 1, Beside: -2 },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  TextEditorRevealType: { InCenter: 1 },
  Range: class {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Selection: class {
    constructor(anchor, active) {
      this.anchor = anchor;
      this.active = active;
    }
  },
  Position: class {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  WorkspaceEdit: class {
    constructor() {
      this.operations = [];
    }
    replace(uri, range, text) {
      this.operations.push({ uri, range, text });
    }
  }
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeMock;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { activate, deactivate } = require('../src/extension');

function createContext() {
  const state = new Map();

  return {
    subscriptions: [],
    extensionUri: { path: '/extension', fsPath: '/extension', scheme: 'file' },
    workspaceState: {
      get: (key) => state.get(key),
      update: async (key, value) => {
        if (value === undefined) {
          state.delete(key);
        } else {
          state.set(key, value);
        }
      }
    }
  };
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Make sure a panel exists and hand back its message handler. Each test that
 * drives the host goes through here so none of them depend on ordering.
 */
async function ensurePanel() {
  if (harness.messageHandlers.length === 0) {
    const context = createContext();
    vscodeMock.workspace.textDocuments = [createDocument()];
    vscodeMock.window.activeTextEditor = { document: createDocument() };

    await activate(context);
    await harness.registered.get('fractalThemeStudio.open')();
    await flush();
  }

  return harness.messageHandlers[harness.messageHandlers.length - 1];
}

test('activate registers the three commands and deactivate settles', async () => {
  const context = createContext();
  await activate(context);

  assert.deepEqual([...harness.registered.keys()].sort(), [
    'fractalThemeStudio.exportTheme',
    'fractalThemeStudio.installTheme',
    'fractalThemeStudio.open'
  ]);

  await deactivate();
});

test('with no theme open and none configured, it opens the bundled sample', async () => {
  harness.readPaths.length = 0;
  harness.writtenPaths.length = 0;

  const context = createContext();
  vscodeMock.workspace.textDocuments = [createDocument()];
  vscodeMock.workspace.workspaceFolders = undefined;
  vscodeMock.window.activeTextEditor = undefined;
  vscodeMock.window.visibleTextEditors = [];

  await activate(context);
  await harness.registered.get('fractalThemeStudio.open')();
  await flush();

  // It reads the sample shipped with the extension...
  assert.ok(
    harness.readPaths.some((path) => path.endsWith('themes/fractal-studio-sample-color-theme.json')),
    `expected to read the bundled sample, read: ${harness.readPaths.join(', ')}`
  );

  // ...copies it somewhere writable rather than editing the install directory...
  assert.ok(
    harness.writtenPaths.some((path) => path.endsWith('fractal-studio-sample-color-theme.json')),
    `expected to write a copy, wrote: ${harness.writtenPaths.join(', ')}`
  );
  assert.ok(harness.writtenPaths.every((path) => !path.includes('/extension/')));

  // ...and opens that copy.
  assert.ok(harness.openedForEditing.some((path) => path.endsWith('fractal-studio-sample-color-theme.json')));
});

test('opening the editor builds a panel and posts a usable state', async (t) => {
  if (!fs.existsSync(THEME_PATH)) {
    t.skip('daylight theme not present');
    return;
  }

  harness.posted.length = 0;
  const context = createContext();
  vscodeMock.workspace.textDocuments = [createDocument()];
  vscodeMock.window.activeTextEditor = { document: createDocument() };

  await activate(context);
  await harness.registered.get('fractalThemeStudio.open')();
  await flush();

  const panel = harness.panels[harness.panels.length - 1];
  assert.ok(panel.webview.html.includes('Theme Studio'));
  assert.ok(panel.webview.html.includes('Content-Security-Policy'));
  assert.ok(!panel.webview.html.includes('Date.now'));

  harness.messageHandlers[harness.messageHandlers.length - 1]({ type: 'ready' });
  await flush();

  const state = harness.posted[harness.posted.length - 1];
  assert.equal(state.type, 'state');
  assert.equal(state.themeName, 'Daylight Bone Signal');
  assert.equal(state.themeType, 'light');
  assert.equal(state.palette.length, 16);
  assert.equal(state.occurrenceCount, 299);
  assert.ok(state.groups.workbench.length > 0);
  assert.equal(state.contrast.surface, '#FCFCFC');
});

test('a base color edit applies one workspace edit covering every use', async (t) => {
  if (!fs.existsSync(THEME_PATH)) {
    t.skip('daylight theme not present');
    return;
  }

  harness.appliedEdits.length = 0;
  const send = await ensurePanel();
  send({ type: 'setBase', from: '#F0873A', to: '#00A3FF' });
  await flush();

  const edit = harness.appliedEdits[harness.appliedEdits.length - 1];
  assert.equal(edit.operations.length, 43);
  assert.ok(edit.operations.every((operation) => operation.text.startsWith('#00A3FF')));
  assert.ok(edit.operations.some((operation) => operation.text === '#00A3FF40'));
});

test('a single token edit rewrites only that key', async () => {
  harness.appliedEdits.length = 0;
  const send = await ensurePanel();
  send({ type: 'setToken', pathString: 'colors.editor.background', color: '#101010' });
  await flush();

  const edit = harness.appliedEdits[harness.appliedEdits.length - 1];
  assert.equal(edit.operations.length, 1);
  assert.equal(edit.operations[0].text, '#101010');
});

test('an unknown message type is ignored rather than throwing', async () => {
  harness.appliedEdits.length = 0;
  const send = await ensurePanel();
  send({ type: 'nonsense' });
  send(null);
  await flush();

  assert.equal(harness.appliedEdits.length, 0);
});

test('live preview stashes prior settings and restores them exactly', async () => {
  harness.settingsUpdates.length = 0;
  const send = await ensurePanel();
  send({ type: 'togglePreview' });
  await flush();

  const writes = harness.settingsUpdates.map((entry) => entry.key);
  assert.ok(writes.includes('workbench.colorCustomizations'));
  assert.ok(writes.includes('editor.tokenColorCustomizations'));
  assert.ok(writes.includes('editor.semanticTokenColorCustomizations'));

  const applied = harness.settingsUpdates.find((entry) => entry.key === 'workbench.colorCustomizations');
  assert.equal(typeof applied.value, 'object');
  assert.equal(applied.value.focusBorder, '#F0873A');

  // The preview is only visible if the edited theme is the active one.
  const activated = harness.settingsUpdates.find((entry) => entry.key === 'workbench.colorTheme');
  assert.equal(activated.value, 'Daylight Bone Signal');

  harness.settingsUpdates.length = 0;
  send({ type: 'togglePreview' });
  await flush();

  // Restoring with no prior value clears the setting rather than leaving preview residue.
  const restored = harness.settingsUpdates.find((entry) => entry.key === 'workbench.colorCustomizations');
  assert.equal(restored.value, undefined);

  // Including the theme that was active before the preview.
  const themeRestored = harness.settingsUpdates.find((entry) => entry.key === 'workbench.colorTheme');
  assert.equal(themeRestored.value, undefined);
});
