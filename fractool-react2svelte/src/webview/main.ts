import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap, placeholder } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { svelte } from '@replit/codemirror-lang-svelte';
import { tags as t } from '@lezer/highlight';

// --- types shared with the extension host ------------------------------------------------

interface ConvertedFile {
  name: string;
  code: string;
  warnings: string[];
}
type Outcome = { ok: true; files: ConvertedFile[]; warnings: string[] } | { ok: false; error: string; line: number | null };
interface StateMsg {
  type: 'state';
  replaceInput: boolean;
  source?: string;
  sourceName: string | null;
  selected: string;
  outcome: Outcome | null;
}

declare function acquireVsCodeApi(): {
  postMessage: (msg: unknown) => void;
  getState: () => any;
  setState: (state: any) => void;
};
const vscode = acquireVsCodeApi();

// --- theme: follow the VS Code theme through its CSS variables ---------------------------

const v = (name: string, fallback: string) => `var(--vscode-${name}, ${fallback})`;

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: v('symbolIcon-keywordForeground', '#c586c0') },
  { tag: [t.string, t.special(t.string), t.regexp], color: v('debugTokenExpression-string', '#ce9178') },
  { tag: [t.number, t.bool, t.null, t.atom], color: v('debugTokenExpression-number', '#b5cea8') },
  { tag: [t.comment, t.lineComment, t.blockComment], color: v('descriptionForeground', '#6a9955'), fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: v('symbolIcon-functionForeground', '#dcdcaa') },
  { tag: [t.typeName, t.className, t.namespace], color: v('symbolIcon-classForeground', '#4ec9b0') },
  { tag: [t.tagName, t.angleBracket], color: v('symbolIcon-variableForeground', '#569cd6') },
  { tag: [t.attributeName, t.propertyName], color: v('symbolIcon-propertyForeground', '#9cdcfe') },
  { tag: [t.variableName, t.definition(t.variableName)], color: v('debugTokenExpression-name', '#9cdcfe') },
  { tag: [t.special(t.brace), t.brace], color: v('symbolIcon-keywordForeground', '#c586c0') },
  { tag: [t.operator, t.punctuation, t.separator], color: v('editor-foreground', '#d4d4d4') }
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--mono-size)',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-fg)'
  },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
  '.cm-content': { padding: '8px 0 40px', caretColor: 'var(--editor-fg)' },
  '.cm-cursor': { borderLeftColor: v('editorCursor-foreground', 'currentColor') },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: v('editorLineNumber-foreground', '#858585'),
    border: 'none'
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('editorLineNumber-activeForeground', '#c6c6c6') },
  '.cm-activeLine': { backgroundColor: v('editor-lineHighlightBackground', 'rgba(128,128,128,.07)') },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: `${v('editor-selectionBackground', 'rgba(38,79,120,.6)')} !important`
  },
  '.cm-placeholder': { color: 'var(--muted)' },
  '.cm-foldGutter span': { color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: v('editorWidget-background', '#252526'), border: `1px solid ${v('editorWidget-border', '#454545')}` }
});

// --- DOM ---------------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inputPane = $<HTMLElement>('input-pane');
const splitter = $<HTMLDivElement>('splitter');
const sourceBadge = $<HTMLSpanElement>('source-badge');
const tabsEl = $<HTMLDivElement>('tabs');
const metaEl = $<HTMLSpanElement>('meta');
const errorEl = $<HTMLDivElement>('error');
const warningsEl = $<HTMLUListElement>('warnings');
const btnCopy = $<HTMLButtonElement>('btn-copy');
const btnOpen = $<HTMLButtonElement>('btn-open');
const btnSave = $<HTMLButtonElement>('btn-save');

// --- editors -----------------------------------------------------------------------------

let applyingRemote = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

const input = new EditorView({
  parent: $('input-editor'),
  state: EditorState.create({
    doc: '',
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      EditorState.tabSize.of(2),
      javascript({ jsx: true, typescript: true }),
      syntaxHighlighting(highlight),
      theme,
      placeholder('Paste a React component (TSX/JSX) here, or right-click a .tsx file → Convert to Svelte'),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged || applyingRemote) return;
        clearTimeout(debounce);
        debounce = setTimeout(() => vscode.postMessage({ type: 'input', source: input.state.doc.toString() }), 180);
      })
    ]
  })
});

const outputLang = new Compartment();
const output = new EditorView({
  parent: $('output-editor'),
  state: EditorState.create({
    doc: '',
    extensions: [
      basicSetup,
      EditorState.readOnly.of(true),
      EditorState.tabSize.of(2),
      outputLang.of(svelte()),
      syntaxHighlighting(highlight),
      theme,
      placeholder('Svelte output appears here')
    ]
  })
});

function setDoc(view: EditorView, text: string, keepScroll: boolean) {
  if (view.state.doc.toString() === text) return;
  const top = view.scrollDOM.scrollTop;
  applyingRemote = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
  applyingRemote = false;
  view.scrollDOM.scrollTop = keepScroll ? top : 0;
}

function jumpToInputLine(line: number) {
  const n = Math.max(1, Math.min(line, input.state.doc.lines));
  const l = input.state.doc.line(n);
  input.dispatch({ selection: { anchor: l.from, head: l.to }, scrollIntoView: true });
  input.focus();
}

// --- render ------------------------------------------------------------------------------

let outcome: Outcome | null = null;
let files: ConvertedFile[] = [];
let selected = '';

function current(): ConvertedFile | undefined {
  return files.find((f) => f.name === selected) ?? files[0];
}

function render(keepScroll: boolean) {
  const ok = outcome?.ok === true;
  // On an error keep the last good output on screen (less flicker while typing).
  if (ok) files = (outcome as { files: ConvertedFile[] }).files;
  else if (!outcome) files = [];

  const file = current();
  selected = file?.name ?? '';

  // tabs
  tabsEl.replaceChildren(
    ...files.map((f) => {
      const b = document.createElement('button');
      b.className = 'tab' + (f.name === selected ? ' active' : '');
      b.textContent = f.name;
      b.title = f.warnings.length ? `${f.name}: ${f.warnings.length} warning(s)` : f.name;
      if (f.warnings.length) {
        const c = document.createElement('span');
        c.className = 'count';
        c.textContent = String(f.warnings.length);
        b.appendChild(c);
      }
      b.addEventListener('click', () => {
        if (f.name === selected) return;
        selected = f.name;
        vscode.postMessage({ type: 'select', name: f.name });
        render(false);
      });
      return b;
    })
  );

  setDoc(output, file?.code ?? '', keepScroll);
  output.dom.style.opacity = ok || !outcome ? '' : '0.5';

  const lines = file ? file.code.replace(/\n$/, '').split('\n').length : 0;
  metaEl.textContent = file ? `${files.length > 1 ? `${files.length} files · ` : ''}${lines} lines` : '';

  // error
  if (outcome && !outcome.ok) {
    errorEl.hidden = false;
    errorEl.replaceChildren();
    if (outcome.line != null) {
      const a = document.createElement('a');
      a.textContent = `line ${outcome.line}`;
      const line = outcome.line;
      a.addEventListener('click', () => jumpToInputLine(line));
      errorEl.append(a, ': ');
    }
    errorEl.append(outcome.error);
  } else errorEl.hidden = true;

  // warnings for the shown file
  const warns = ok && file ? file.warnings : [];
  warningsEl.hidden = warns.length === 0;
  warningsEl.replaceChildren(
    ...warns.map((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      return li;
    })
  );

  for (const b of [btnCopy, btnOpen, btnSave]) b.disabled = !ok;
}

window.addEventListener('message', (e) => {
  const msg = e.data as StateMsg;
  if (msg?.type !== 'state') return;
  if (msg.replaceInput) {
    clearTimeout(debounce);
    setDoc(input, msg.source ?? '', false);
  }
  sourceBadge.hidden = !msg.sourceName;
  sourceBadge.textContent = msg.sourceName ?? '';
  outcome = msg.outcome;
  if (msg.replaceInput || msg.selected) selected = msg.selected;
  render(!msg.replaceInput);
});

// --- actions -----------------------------------------------------------------------------

btnCopy.addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
btnOpen.addEventListener('click', () => vscode.postMessage({ type: 'open' }));
btnSave.addEventListener('click', () => vscode.postMessage({ type: 'save' }));
sourceBadge.addEventListener('click', () => vscode.postMessage({ type: 'openSource' }));

// --- splitter (input height persisted per webview) -------------------------------------------

const saved = vscode.getState()?.inputPx as number | undefined;
if (saved) inputPane.style.flexBasis = `${saved}px`;

splitter.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  splitter.setPointerCapture(e.pointerId);
  splitter.classList.add('dragging');
  const startY = e.clientY;
  const startH = inputPane.getBoundingClientRect().height;
  const move = (ev: PointerEvent) => {
    const h = Math.max(60, Math.min(window.innerHeight - 120, startH + ev.clientY - startY));
    inputPane.style.flexBasis = `${h}px`;
  };
  const up = () => {
    splitter.classList.remove('dragging');
    splitter.removeEventListener('pointermove', move);
    vscode.setState({ ...(vscode.getState() ?? {}), inputPx: inputPane.getBoundingClientRect().height });
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up, { once: true });
});

render(false);
vscode.postMessage({ type: 'ready' });
