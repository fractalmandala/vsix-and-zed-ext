/**
 * The Save card and the saved-colours list.
 *
 * In Chrome / Edge / Arc the page can be connected to the real `saved-colors.json` through the
 * File System Access API and writes to it directly; the connection is remembered across visits.
 * Elsewhere, colours are kept in this browser and "Download JSON" exports them.
 */
import { parseColor } from '../src/color';
import { currentState } from './shim';
import { FORMAT, entryFor, parseEntries, serialize, upsert, type Entry } from './store';

const LOCAL_KEY = 'oklch-lab.saved';

// File System Access API: not in every TS lib, and not in every browser.
interface WritableFile {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableFile>;
  queryPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
type Picker = (o: object) => Promise<FileHandle[]>;
const showOpenFilePicker = (window as unknown as { showOpenFilePicker?: Picker }).showOpenFilePicker;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nameInput = $<HTMLInputElement>('save-name');
const classInput = $<HTMLInputElement>('save-class');
const saveBtn = $<HTMLButtonElement>('save-btn');
const connectBtn = $<HTMLButtonElement>('connect-btn');
const downloadBtn = $<HTMLButtonElement>('download-btn');
const fileLabel = $<HTMLElement>('file-label');
const status = $<HTMLElement>('save-status');
const listEl = $<HTMLUListElement>('saved-list');
const countEl = $<HTMLElement>('saved-count');

let handle: FileHandle | null = null;
/** True once `handle` has read-write permission this session. */
let connected = false;
let entries: Entry[] = [];

function say(text: string, kind: 'ok' | 'error' | '' = '') {
  status.textContent = text;
  status.classList.toggle('error', kind === 'error');
  status.classList.toggle('ok', kind === 'ok');
}

// ---- remembering the file handle (IndexedDB can store it; localStorage cannot) ----

function idb<T>(run: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('oklch-lab', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = run(open.result.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}
const rememberHandle = (h: FileHandle) => idb((s) => s.put(h, 'file'), 'readwrite').catch(() => {});
const recallHandle = () => idb<FileHandle | undefined>((s) => s.get('file'), 'readonly').catch(() => undefined);

// ---- reading and writing ----

function loadLocal(): Entry[] {
  try {
    return parseEntries(localStorage.getItem(LOCAL_KEY) ?? '');
  } catch {
    return [];
  }
}

function storeLocal(list: Entry[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable; the list still shows for this visit.
  }
}

async function readFile(h: FileHandle): Promise<Entry[]> {
  return parseEntries(await (await h.getFile()).text());
}

async function writeFile(h: FileHandle, list: Entry[]) {
  const w = await h.createWritable();
  await w.write(serialize(list));
  await w.close();
}

async function connectTo(h: FileHandle, ask: boolean) {
  const granted =
    (await h.queryPermission({ mode: 'readwrite' })) === 'granted' ||
    (ask && (await h.requestPermission({ mode: 'readwrite' })) === 'granted');
  handle = h;
  if (!granted) {
    connected = false;
    renderFile();
    return;
  }
  entries = await readFile(h);
  connected = true;
  await rememberHandle(h);
  renderFile();
  renderList();
}

// ---- rendering ----

function renderFile() {
  if (!showOpenFilePicker) {
    fileLabel.textContent = 'kept in this browser';
    connectBtn.hidden = true;
    return;
  }
  if (connected && handle) {
    fileLabel.textContent = `→ ${handle.name}`;
    connectBtn.textContent = 'Change file…';
  } else if (handle) {
    fileLabel.textContent = `${handle.name} (needs permission)`;
    connectBtn.textContent = `Reconnect ${handle.name}`;
  } else {
    fileLabel.textContent = 'not connected — kept in this browser';
    connectBtn.textContent = 'Connect saved-colors.json…';
  }
}

function renderList() {
  countEl.textContent = entries.length ? String(entries.length) : '';
  listEl.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'saved-empty';
    empty.textContent = 'No saved colours yet.';
    listEl.append(empty);
    return;
  }
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const text = String(e.oklch || e.hex || e.rgba || '');
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'saved-item';
    btn.title = `Load ${text}`;
    btn.dataset.text = text;
    const chip = document.createElement('span');
    chip.className = 'saved-chip';
    const fill = document.createElement('span');
    fill.style.background = String(e.hex || e.rgba || 'transparent');
    chip.append(fill);
    const name = document.createElement('span');
    name.className = 'saved-name';
    name.textContent = String(e.name ?? '(unnamed)');
    const cls = document.createElement('span');
    cls.className = 'saved-class';
    cls.textContent = e.class ? String(e.class) : '';
    const hex = document.createElement('span');
    hex.className = 'saved-hex';
    hex.textContent = String(e.hex ?? '');
    btn.append(chip, name, cls, hex);
    btn.addEventListener('click', () => {
      if (!parseColor(text)) return say(`Can't read “${text}” as a colour.`, 'error');
      window.postMessage({ type: 'setColor', text }, '*');
      nameInput.value = String(e.name ?? '');
      classInput.value = e.class ? String(e.class) : '';
    });
    li.append(btn);
    listEl.append(li);
  }
}

// ---- actions ----

function currentColor() {
  return currentState() ?? parseColor($<HTMLInputElement>('field-oklch').value) ?? undefined;
}

async function save() {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.closest('.field')!.classList.add('invalid');
    nameInput.focus();
    return say('A name is required.', 'error');
  }
  nameInput.closest('.field')!.classList.remove('invalid');
  const col = currentColor();
  if (!col) return say('Pick a valid colour first.', 'error');
  const entry = entryFor(col, name, classInput.value.trim(), FORMAT);

  try {
    if (handle && !connected) await connectTo(handle, true);
    if (handle && connected) {
      // Re-read first so edits made to the file elsewhere are kept.
      entries = upsert(await readFile(handle), entry);
      await writeFile(handle, entries);
      say(`Saved “${name}” to ${handle.name}.`, 'ok');
    } else {
      entries = upsert(entries, entry);
      storeLocal(entries);
      say(`Saved “${name}” in this browser. Use Download JSON${showOpenFilePicker ? ' or connect the file' : ''} to keep it.`, 'ok');
    }
    renderList();
    nameInput.value = '';
  } catch (err) {
    say(`Could not save: ${(err as Error).message}`, 'error');
  }
}

async function connect() {
  if (!showOpenFilePicker) return;
  try {
    if (handle && !connected) {
      await connectTo(handle, true);
    } else {
      const [picked] = await showOpenFilePicker({
        id: 'saved-colors',
        types: [{ description: 'Saved colours (JSON)', accept: { 'application/json': ['.json'] } }],
      });
      await connectTo(picked, true);
    }
    if (connected) say(`Connected. Saves go straight to ${handle!.name}.`, 'ok');
    else say('Permission was not granted, so saves stay in this browser.', 'error');
  } catch (err) {
    if ((err as Error).name !== 'AbortError') say(`Could not open the file: ${(err as Error).message}`, 'error');
  }
}

function download() {
  const url = URL.createObjectURL(new Blob([serialize(entries)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'saved-colors.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

saveBtn.addEventListener('click', save);
connectBtn.addEventListener('click', connect);
downloadBtn.addEventListener('click', download);
for (const input of [nameInput, classInput]) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void save();
  });
}
nameInput.addEventListener('input', () => nameInput.closest('.field')!.classList.remove('invalid'));

// ---- start ----

entries = loadLocal();
renderFile();
renderList();
if (showOpenFilePicker) {
  void recallHandle().then(async (h) => {
    if (!h) return;
    try {
      await connectTo(h, false);
    } catch {
      handle = null;
      renderFile();
    }
  });
}
