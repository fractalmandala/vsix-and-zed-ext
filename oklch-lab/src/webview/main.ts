import {
  ACHROMATIC,
  C_MAX,
  DEFAULT_FORMAT,
  FORMATS,
  format,
  maxChroma,
  num,
  parseColor,
  smallestGamut,
  toSrgbMapped,
  type FormatId,
  type FormatOptions,
  type Oklch,
} from '../color';
import { Cloud, RANGE, cssColor, paintField, paintSlider, type Axis, type Layers } from './paint';

interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState(): Persisted | undefined;
  setState(state: Persisted): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface Persisted extends Oklch {
  threeD: boolean;
  graphs: boolean;
  p3: boolean;
  rec2020: boolean;
}

const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

// ---- state ----------------------------------------------------------------

const state: Persisted = {
  l: 0.7,
  c: 0.1,
  h: 143,
  a: 1,
  threeD: false,
  graphs: true,
  p3: true,
  rec2020: false,
  ...vscode.getState(),
};
let fmt: FormatOptions = DEFAULT_FORMAT;

const color = (): Oklch => ({ l: state.l, c: state.c, h: state.h, a: state.a });
const layers = (): Layers => ({ p3: state.p3, rec2020: state.rec2020 });
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Apply a colour. Achromatic input has no hue, so keep the one already chosen. */
function setColor(c: Oklch, opts: { keepHueIfGrey?: boolean } = { keepHueIfGrey: true }) {
  state.l = c.l;
  state.c = c.c;
  state.a = c.a;
  if (!(opts.keepHueIfGrey && c.c < ACHROMATIC)) state.h = c.h;
}

// ---- named colours (the DOM already knows them) -----------------------------

const probe = document.createElement('canvas').getContext('2d')!;
function parseAny(text: string): Oklch | null {
  const p = parseColor(text);
  if (p) return p;
  const name = text.trim().toLowerCase();
  if (!/^[a-z]+$/.test(name)) return null;
  probe.fillStyle = '#010203';
  probe.fillStyle = name;
  const got = probe.fillStyle;
  if (got === '#010203') return null;
  return parseColor(got);
}

// ---- elements ---------------------------------------------------------------

const app = $<HTMLElement>('.app');
const swatch = $<HTMLElement>('#swatch');
const gamutEl = $<HTMLElement>('#gamut');
const hint = $<HTMLElement>('#hint');
const HINT_DEFAULT = hint.textContent ?? '';
const fields = Object.fromEntries(
  FORMATS.map((f) => [f, $<HTMLInputElement>(`#field-${f}`)])
) as Record<FormatId, HTMLInputElement>;

interface Channel {
  axis: Axis | 'a';
  card: HTMLElement;
  num: HTMLInputElement;
  slider: HTMLElement;
  handle: HTMLElement;
  graph?: HTMLElement;
  /** What the graph's x / y axes are. */
  plot?: { x: Axis; y: Axis };
}
const channel = (axis: Axis | 'a', plot?: { x: Axis; y: Axis }): Channel => ({
  axis,
  card: $(`#card-${axis}`),
  num: $(`#num-${axis}`),
  slider: $(`#slider-${axis}`),
  handle: $('.handle', $(`#slider-${axis}`)),
  graph: plot ? $(`#graph-${axis}`) : undefined,
  plot,
});
const channels: Channel[] = [
  channel('l', { x: 'l', y: 'c' }),
  channel('c', { x: 'h', y: 'c' }),
  channel('h', { x: 'h', y: 'l' }),
  channel('a'),
];

// Alpha track is a CSS gradient over a checkerboard instead of a canvas.
const alphaTrack = $<HTMLElement>('.track', channels[3].slider);
alphaTrack.classList.add('checker');
$('canvas', alphaTrack).remove();
const alphaFill = document.createElement('div');
alphaFill.className = 'alpha-fill';
alphaTrack.append(alphaFill);

const toggles = {
  threeD: $<HTMLInputElement>('#t-3d'),
  graphs: $<HTMLInputElement>('#t-graphs'),
  p3: $<HTMLInputElement>('#t-p3'),
  rec2020: $<HTMLInputElement>('#t-rec2020'),
};
const card3d = $<HTMLElement>('#card-3d');
const cloud = new Cloud($<HTMLCanvasElement>('#cv-3d'));

// ---- rendering --------------------------------------------------------------

const painted = new WeakMap<HTMLElement, string>();
/** Repaint a canvas only when what it depends on changed. */
function memo(canvas: HTMLCanvasElement, key: string, paint: () => void) {
  const full = `${key}|${canvas.clientWidth}x${canvas.clientHeight}|${window.devicePixelRatio}`;
  if (painted.get(canvas) === full) return;
  paint();
  painted.set(canvas, full);
}

const fmtNum = (axis: Axis | 'a', v: number) =>
  axis === 'l' ? num(v, 3) : axis === 'c' ? num(v, 4) : axis === 'h' ? num(v, 1) : num(v * 100, 1);

let scheduled = false;
/** Fields to leave alone on the next frame, because the user is typing in them. */
let skip: { field?: FormatId; num?: HTMLInputElement } = {};

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
    skip = {};
  });
}

function render() {
  const col = color();
  const ly = layers();
  const lKey = `${+state.p3}${+state.rec2020}`;

  swatch.style.background = cssColor(col);
  const g = smallestGamut(col);
  const mapped = toSrgbMapped(col).mapped;
  gamutEl.classList.toggle('warn', mapped);
  gamutEl.textContent = !g
    ? 'Outside Rec.2020 — HEX / RGB / HSL are gamut-mapped'
    : g === 'srgb'
      ? 'In sRGB gamut'
      : `${g === 'p3' ? 'Display P3' : 'Rec.2020'} only — HEX / RGB / HSL are gamut-mapped`;

  for (const f of FORMATS) {
    if (skip.field !== f && document.activeElement !== fields[f]) {
      fields[f].value = format(col, f, fmt);
      fields[f].closest('.field')!.classList.remove('invalid');
    }
  }

  const values: Record<Axis | 'a', number> = { l: col.l, c: col.c, h: col.h, a: col.a };
  for (const ch of channels) {
    const v = values[ch.axis];
    if (skip.num !== ch.num && document.activeElement !== ch.num) ch.num.value = fmtNum(ch.axis, v);
    const t = ch.axis === 'a' ? v : (v - RANGE[ch.axis][0]) / (RANGE[ch.axis][1] - RANGE[ch.axis][0]);
    ch.handle.style.left = `${clamp(t, 0, 1) * 100}%`;
    ch.handle.style.background = cssColor({ ...col, a: 1 });
    ch.slider.setAttribute('aria-valuenow', fmtNum(ch.axis, v));

    if (ch.axis === 'a') {
      alphaFill.style.background = `linear-gradient(to right, transparent, ${cssColor({ ...col, a: 1 })})`;
      continue;
    }

    const others = (['l', 'c', 'h'] as const).filter((a) => a !== ch.axis);
    const dep = others.map((a) => num(values[a], 4)).join(',');
    const slider = $<HTMLCanvasElement>('canvas', ch.slider);
    memo(slider, `${ch.axis}|${dep}|${lKey}`, () => paintSlider(slider, ch.axis as Axis, col, ly));

    if (ch.graph && ch.plot && state.graphs) {
      const canvas = $<HTMLCanvasElement>('canvas', ch.graph);
      const fixed = (['l', 'c', 'h'] as const).find((a) => a !== ch.plot!.x && a !== ch.plot!.y)!;
      memo(canvas, `${fixed}=${num(values[fixed], 4)}|${lKey}`, () =>
        paintField(canvas, ch.plot!.x, ch.plot!.y, col, ly)
      );
      const ux = (values[ch.plot.x] - RANGE[ch.plot.x][0]) / (RANGE[ch.plot.x][1] - RANGE[ch.plot.x][0]);
      const uy = (values[ch.plot.y] - RANGE[ch.plot.y][0]) / (RANGE[ch.plot.y][1] - RANGE[ch.plot.y][0]);
      $<HTMLElement>('.hair-v', ch.graph).style.left = `${clamp(ux, 0, 1) * 100}%`;
      $<HTMLElement>('.hair-h', ch.graph).style.top = `${(1 - clamp(uy, 0, 1)) * 100}%`;
    }
  }

  if (state.threeD) cloud.draw(col, ly);
}
cloud.onChange = () => schedule();

function persist() {
  vscode.setState({ ...state });
}

function commit(opts: { skip?: typeof skip } = {}) {
  skip = opts.skip ?? {};
  persist();
  schedule();
}

// ---- converter fields ---------------------------------------------------------

for (const f of FORMATS) {
  const input = fields[f];
  const row = input.closest('.field')!;
  input.addEventListener('input', () => {
    const parsed = parseAny(input.value);
    if (!parsed) {
      row.classList.add('invalid');
      hint.textContent = input.value.trim() ? `Can't read “${input.value.trim()}” as a colour.` : HINT_DEFAULT;
      hint.classList.toggle('error', !!input.value.trim());
      return;
    }
    row.classList.remove('invalid');
    hint.textContent = HINT_DEFAULT;
    hint.classList.remove('error');
    setColor(parsed);
    commit({ skip: { field: f } });
  });
  input.addEventListener('blur', () => {
    hint.textContent = HINT_DEFAULT;
    hint.classList.remove('error');
    schedule(); // normalise this field's text now that it is no longer focused
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  // Select-all on focus so a paste replaces the whole value.
  input.addEventListener('focus', () => input.select());
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  btn.addEventListener('click', () => {
    const id = btn.dataset.copy as FormatId;
    vscode.postMessage({ type: 'copy', text: format(color(), id, fmt) });
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), 900);
  });
}
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-insert]')) {
  btn.addEventListener('click', () => {
    vscode.postMessage({ type: 'insert', text: format(color(), btn.dataset.insert as FormatId, fmt) });
  });
}

// ---- channel cards: number field, slider, graph -------------------------------

function setAxis(axis: Axis | 'a', v: number) {
  switch (axis) {
    case 'l':
      state.l = clamp(v, 0, 1);
      break;
    case 'c':
      state.c = clamp(v, 0, C_MAX);
      break;
    case 'h':
      state.h = clamp(v, 0, 360);
      break;
    case 'a':
      state.a = clamp(v, 0, 1);
      break;
  }
}

const span = (axis: Axis | 'a') => (axis === 'a' ? [0, 1] : RANGE[axis]);

for (const ch of channels) {
  ch.num.addEventListener('input', () => {
    const v = parseFloat(ch.num.value);
    if (!Number.isFinite(v)) return;
    setAxis(ch.axis, ch.axis === 'a' ? v / 100 : v);
    commit({ skip: { num: ch.num } });
  });
  ch.num.addEventListener('blur', schedule);
  ch.num.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ch.num.blur();
  });

  // Slider: pointer drag + keyboard.
  const fromPointer = (e: PointerEvent) => {
    const r = ch.slider.getBoundingClientRect();
    const t = clamp((e.clientX - r.left) / r.width, 0, 1);
    const [lo, hi] = span(ch.axis);
    setAxis(ch.axis, lo + (hi - lo) * t);
    commit();
  };
  ch.slider.addEventListener('pointerdown', (e) => {
    ch.slider.setPointerCapture(e.pointerId);
    ch.slider.focus();
    fromPointer(e);
  });
  ch.slider.addEventListener('pointermove', (e) => {
    if (ch.slider.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  ch.slider.addEventListener('keydown', (e) => {
    const [lo, hi] = span(ch.axis);
    const step = (hi - lo) / 100 / (e.shiftKey ? 0.1 : 1);
    const cur = { l: state.l, c: state.c, h: state.h, a: state.a }[ch.axis];
    let next: number | undefined;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = cur + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = cur - step;
    else if (e.key === 'PageUp') next = cur + step * 10;
    else if (e.key === 'PageDown') next = cur - step * 10;
    else if (e.key === 'Home') next = lo;
    else if (e.key === 'End') next = hi;
    if (next === undefined) return;
    e.preventDefault();
    setAxis(ch.axis, next);
    commit();
  });

  // Graph: drag to set both plotted axes at once.
  if (ch.graph && ch.plot) {
    const { x, y } = ch.plot;
    const graph = ch.graph;
    const fromGraph = (e: PointerEvent) => {
      const r = graph.getBoundingClientRect();
      const u = clamp((e.clientX - r.left) / r.width, 0, 1);
      const v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
      setAxis(x, RANGE[x][0] + (RANGE[x][1] - RANGE[x][0]) * u);
      setAxis(y, RANGE[y][0] + (RANGE[y][1] - RANGE[y][0]) * v);
      commit();
    };
    graph.addEventListener('pointerdown', (e) => {
      graph.setPointerCapture(e.pointerId);
      fromGraph(e);
    });
    graph.addEventListener('pointermove', (e) => {
      if (graph.hasPointerCapture(e.pointerId)) fromGraph(e);
    });
  }
}

// ---- toggles ----------------------------------------------------------------

function applyToggles() {
  app.dataset.graphs = state.graphs ? 'on' : 'off';
  card3d.hidden = !state.threeD;
  for (const [k, el] of Object.entries(toggles)) el.checked = state[k as keyof typeof toggles];
}
for (const [k, el] of Object.entries(toggles)) {
  el.addEventListener('change', () => {
    state[k as keyof typeof toggles] = el.checked;
    applyToggles();
    commit();
  });
}
applyToggles();

// ---- header + host messages ---------------------------------------------------

function random() {
  const h = Math.random() * 360;
  const l = 0.35 + Math.random() * 0.55;
  const c = maxChroma(l, h, 'srgb') * (0.25 + Math.random() * 0.75);
  setColor({ l, c, h, a: state.a }, { keepHueIfGrey: false });
  commit();
}

document.querySelector('.header')!.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn) return;
  const id = btn.dataset.action!;
  if (id === 'random') random();
  else vscode.postMessage({ type: 'action', id });
});

window.addEventListener('message', (event) => {
  const msg = event.data as { type: string; text?: string; id?: FormatId; format?: FormatOptions };
  if (msg.type === 'config' && msg.format) {
    fmt = msg.format;
    schedule();
  } else if (msg.type === 'setColor' && msg.text) {
    const p = parseAny(msg.text);
    if (p) {
      setColor(p);
      commit();
    }
  } else if (msg.type === 'requestInsert' && msg.id) {
    vscode.postMessage({ type: 'insert', text: format(color(), msg.id, fmt) });
  }
});

// Canvases depend on their on-screen size.
const resize = new ResizeObserver(() => schedule());
for (const el of document.querySelectorAll('.graph, .slider, #cv-3d')) resize.observe(el);

render();
vscode.postMessage({ type: 'ready' });
