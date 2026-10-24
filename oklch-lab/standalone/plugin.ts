/**
 * The plugin-panel controls around the explorer: band chips, the hue dial, the lightness and
 * chroma meters, the L/C/H/A knobs, the segmented pills, the copy-format and gamut switches,
 * and the preset tab that steps through saved colours.
 *
 * Nothing here owns colour state. Controls write through main.ts's own inputs (the `#num-*`
 * fields and the `#t-*` checkboxes) and follow it through the `oklch:state` event from the shim.
 */
import { ACHROMATIC, C_MAX, formatHsla, formatRust, inGamut, num, oklchToEncoded, parseColor, type Gamut, type Oklch } from '../src/color';
import { copyText, currentState } from './shim';
import { FORMAT } from './store';

type Axis = 'l' | 'c' | 'h' | 'a';
type State = Oklch & { threeD: boolean; graphs: boolean; p3: boolean; rec2020: boolean };

const PREFS_KEY = 'oklch-lab.panel';
const RANGE: Record<Axis, [number, number]> = { l: [0, 1], c: [0, C_MAX], h: [0, 360], a: [0, 1] };
// Same defaults as main.ts, for a first visit with nothing stored yet.
let state: State = { l: 0.7, c: 0.1, h: 143, a: 1, threeD: false, graphs: true, p3: true, rec2020: false };
state = { ...state, ...(currentState() as Partial<State> | undefined) };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const all = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  [...root.querySelectorAll<T>(sel)];
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fraction = (axis: Axis, v: number) => (v - RANGE[axis][0]) / (RANGE[axis][1] - RANGE[axis][0]);
const css = (l: number, c: number, h: number, a = 1) =>
  `oklch(${num(l, 4)} ${num(c, 4)} ${num(h, 2)}${a < 1 ? ` / ${num(a, 3)}` : ''})`;

// ---- writing through main.ts --------------------------------------------------

/** Sets one channel the way typing into its number field would. */
function setChannel(axis: Axis, value: number) {
  const input = $<HTMLInputElement>(`num-${axis}`);
  const v = clamp(value, RANGE[axis][0], RANGE[axis][1]);
  input.value = String(axis === 'a' ? +(v * 100).toFixed(1) : +v.toFixed(axis === 'h' ? 2 : 4));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setToggle(id: string, on: boolean) {
  const box = $<HTMLInputElement>(id);
  if (box.checked === on) return;
  box.checked = on;
  box.dispatchEvent(new Event('change'));
}

// ---- prefs that live outside main.ts's state ------------------------------------

interface Prefs {
  copyAs: string;
  hexUpper: boolean;
  syntax: 'legacy' | 'modern';
}
let prefs: Prefs = { copyAs: 'oklch', hexUpper: true, syntax: 'legacy' };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
} catch {
  // Unreadable prefs fall back to the defaults.
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable; prefs then last for this visit.
  }
}
/** Applies the format prefs to saving (FORMAT) and to main.ts's fields (config message). */
function applyFormat() {
  FORMAT.hexUpper = prefs.hexUpper;
  FORMAT.syntax = prefs.syntax;
  window.postMessage({ type: 'config', format: { ...FORMAT } }, '*');
}

// ---- drag helper ------------------------------------------------------------------

function drag(el: HTMLElement, onMove: (e: PointerEvent, start: { x: number; y: number }) => void, ignore?: string) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (ignore && (e.target as HTMLElement).closest(ignore))) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    onMove(e, start);
    const move = (ev: PointerEvent) => onMove(ev, start);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

// ---- hue dial ----------------------------------------------------------------------

const dial = $('dial');
const ring = $<HTMLCanvasElement>('dial-ring');
const marker = $('dial-marker');
let ringKey = '';

function activeGamuts(): Gamut[] {
  return state.rec2020 ? ['srgb', 'p3', 'rec2020'] : state.p3 ? ['srgb', 'p3'] : ['srgb'];
}

/** The hue ring at the current L and C; gaps are hues outside every shown gamut. */
function paintRing() {
  const size = dial.clientWidth;
  const dpr = window.devicePixelRatio || 1;
  const key = `${num(state.l, 3)}|${num(state.c, 3)}|${activeGamuts().length}|${size}|${dpr}`;
  if (key === ringKey || !size) return;
  ringKey = key;
  ring.width = ring.height = Math.round(size * dpr);
  const ctx = ring.getContext('2d')!;
  const r = ring.width / 2;
  const outer = r * 0.94;
  const inner = r * 0.84;
  const gamuts = activeGamuts();
  ctx.clearRect(0, 0, ring.width, ring.height);
  for (let deg = 0; deg < 360; deg += 1) {
    const ok = gamuts.some((g) => inGamut(state.l, state.c, deg, g));
    const [cr, cg, cb] = oklchToEncoded(state.l, state.c, deg, 'srgb').map((v) => Math.round(v * 255));
    ctx.fillStyle = ok ? `rgb(${cr},${cg},${cb})` : 'rgba(255,255,255,0.05)';
    // Hue 0 at the top, increasing clockwise.
    const a0 = ((deg - 90 - 0.6) * Math.PI) / 180;
    const a1 = ((deg - 90 + 0.6) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(r, r, outer, a0, a1);
    ctx.arc(r, r, inner, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
  // Fine tick ring outside the colour band.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, dpr);
  for (let deg = 0; deg < 360; deg += 30) {
    const a = ((deg - 90) * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(r + Math.cos(a) * r * 0.965, r + Math.sin(a) * r * 0.965);
    ctx.lineTo(r + Math.cos(a) * r * 0.99, r + Math.sin(a) * r * 0.99);
    ctx.stroke();
  }
}

drag(
  dial,
  (e) => {
    const rect = dial.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    setChannel('h', (deg + 360) % 360);
  },
  '.swatch-btn'
);

// ---- meters ------------------------------------------------------------------------

const METER_TICKS: Record<'l' | 'c', number[]> = {
  l: [1, 0.8, 0.6, 0.4, 0.2, 0],
  c: [0.4, 0.32, 0.24, 0.16, 0.08, 0],
};
for (const m of all('.meter')) {
  const axis = m.dataset.axis as 'l' | 'c';
  const scale = m.querySelector<HTMLElement>('.meter-scale')!;
  for (const t of METER_TICKS[axis]) {
    const s = document.createElement('span');
    // Ticks point at the bars: the scale sits right of the L meter and left of the C meter.
    s.textContent = axis === 'l' ? `- ${num(t * 100, 0)}` : `${num(t, 2)} -`;
    scale.append(s);
  }
  const bars = m.querySelector<HTMLElement>('.meter-bars')!;
  drag(bars, (e) => {
    const rect = bars.getBoundingClientRect();
    const t = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
    setChannel(axis, RANGE[axis][0] + t * (RANGE[axis][1] - RANGE[axis][0]));
  });
}

function renderMeters() {
  for (const m of all('.meter')) {
    const axis = m.dataset.axis as 'l' | 'c';
    const t = clamp(fraction(axis, state[axis]), 0, 1);
    const gradient =
      axis === 'l'
        ? `linear-gradient(to top, ${css(0.2, state.c, state.h)}, ${css(0.95, Math.min(state.c, 0.12), state.h)})`
        : `linear-gradient(to top, ${css(state.l, 0, state.h)}, ${css(state.l, C_MAX, state.h)})`;
    for (const fill of all('.meter-fill', m)) {
      fill.style.height = `${t * 100}%`;
      fill.style.background = gradient;
      fill.style.backgroundSize = `100% ${100 / Math.max(t, 0.001)}%`;
      fill.style.backgroundPosition = 'bottom';
    }
    const chip = m.querySelector<HTMLElement>('.meter-chip')!;
    chip.style.bottom = `${t * 100}%`;
    chip.textContent = axis === 'l' ? num(state.l, 3) : num(state.c, 4);
  }
}

// ---- knobs -------------------------------------------------------------------------

for (const k of all('.knob')) {
  const axis = k.dataset.axis as Axis;
  const dots = k.querySelector<HTMLElement>('.knob-dots')!;
  // 11 dots along the 270° travel, outside the arc.
  for (let i = 0; i <= 10; i++) {
    const dot = document.createElement('i');
    dot.style.transform = `rotate(${-135 + i * 27}deg) translateY(calc(var(--size) * -0.485))`;
    dots.append(dot);
  }
  let from = 0;
  drag(
    k,
    (e, start) => {
      if (e.clientX === start.x && e.clientY === start.y) from = state[axis];
      const span = RANGE[axis][1] - RANGE[axis][0];
      const travel = e.shiftKey ? 1200 : 220;
      setChannel(axis, from + ((start.y - e.clientY) / travel) * span);
    },
    '.num'
  );
  k.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const span = RANGE[axis][1] - RANGE[axis][0];
      setChannel(axis, state[axis] - Math.sign(e.deltaY) * span * (e.shiftKey ? 0.002 : 0.01));
    },
    { passive: false }
  );
}

function renderKnobs() {
  for (const k of all('.knob')) {
    const axis = k.dataset.axis as Axis;
    k.style.setProperty('--v', String(clamp(fraction(axis, state[axis]), 0, 1)));
  }
}

// ---- band chips + alpha view -----------------------------------------------------------

function renderBands() {
  $('chip-l').textContent = num(state.l, 3);
  $('chip-c').textContent = num(state.c, 4);
  $('chip-h').textContent = `${num(state.h, 1)}°`;
  $('chip-a').textContent = `${num(state.a * 100, 1)}%`;
  $('alpha-fill-view').style.background = css(state.l, state.c, state.h, state.a);
  marker.style.transform = `rotate(${state.h}deg)`;
  marker.style.setProperty('--marker', css(state.l, state.c, state.h));
}

// ---- pills and switches ------------------------------------------------------------------

function pillValue(name: string): string {
  switch (name) {
    case 'hexcase':
      return prefs.hexUpper ? 'upper' : 'lower';
    case 'syntax':
      return prefs.syntax;
    case 'graphs':
      return state.graphs ? 'on' : 'off';
    default:
      return state.threeD ? '3d' : 'flat';
  }
}

function switchValue(name: string): string {
  if (name === 'copyas') return prefs.copyAs;
  return state.rec2020 ? 'rec2020' : state.p3 ? 'p3' : 'srgb';
}

function renderSwitches() {
  for (const p of all('[data-pill]')) {
    const value = pillValue(p.dataset.pill!);
    for (const b of all<HTMLButtonElement>('button', p)) {
      b.classList.toggle('on', b.dataset.value === value);
      b.setAttribute('aria-pressed', String(b.dataset.value === value));
    }
  }
  for (const s of all('[data-switch]')) {
    const value = switchValue(s.dataset.switch!);
    for (const b of all<HTMLButtonElement>('button', s)) {
      b.classList.toggle('on', b.dataset.value === value);
      b.setAttribute('aria-checked', String(b.dataset.value === value));
    }
  }
  for (const id of ['swatch-btn', 'copy-btn']) $(id).dataset.copy = prefs.copyAs;
}

for (const p of all('[data-pill]')) {
  p.addEventListener('click', (e) => {
    const value = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value;
    if (!value) return;
    switch (p.dataset.pill) {
      case 'hexcase':
        prefs.hexUpper = value === 'upper';
        savePrefs();
        applyFormat();
        schedule(); // the Rust readout follows hex case too
        break;
      case 'syntax':
        prefs.syntax = value === 'modern' ? 'modern' : 'legacy';
        savePrefs();
        applyFormat();
        break;
      case 'graphs':
        setToggle('t-graphs', value === 'on');
        break;
      case 'depth':
        setToggle('t-3d', value === '3d');
        break;
    }
    renderSwitches();
  });
}

for (const s of all('[data-switch]')) {
  s.addEventListener('click', (e) => {
    const value = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.value;
    if (!value) return;
    if (s.dataset.switch === 'copyas') {
      prefs.copyAs = value;
      savePrefs();
    } else {
      // Rec.2020 contains P3, so it implies it.
      setToggle('t-rec2020', value === 'rec2020');
      setToggle('t-p3', value !== 'srgb');
    }
    renderSwitches();
  });
}

$('random-btn').addEventListener('click', () => $('random-proxy').click());

// ---- standalone-only readouts ---------------------------------------------------------------
// main.ts only knows the four CSS formats, so these fields and their copy buttons live here.

/** Wires one readout field main.ts does not own: mirror `state`, parse what you type, copy it. */
function readout(fieldId: string, copyId: string, format: (c: Oklch) => string) {
  const field = $<HTMLInputElement>(fieldId);
  const row = field.closest<HTMLElement>('.field')!;
  const render = () => {
    if (document.activeElement === field) return;
    field.value = format(state);
    row.classList.remove('invalid');
  };
  field.addEventListener('input', () => {
    const parsed = parseColor(field.value);
    row.classList.toggle('invalid', !parsed && !!field.value.trim());
    if (parsed) window.postMessage({ type: 'setColor', text: field.value }, '*');
  });
  field.addEventListener('focus', () => field.select());
  field.addEventListener('blur', render);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') field.blur();
  });
  const copy = (btn: HTMLElement) => {
    void copyText(format(state));
    btn.classList.add('done');
    setTimeout(() => btn.classList.remove('done'), 900);
  };
  $(copyId).addEventListener('click', (e) => copy(e.currentTarget as HTMLElement));
  return { render, copy };
}

const rust = readout('field-rust', 'copy-rust', (c) => formatRust(c, FORMAT));
const hsla = readout('field-hsla', 'copy-hsla', formatHsla);

// The swatch and COPY carry `data-copy`, which main.ts formats; it has no 'rust', so copy here.
for (const id of ['swatch-btn', 'copy-btn']) {
  $(id).addEventListener('click', (e) => {
    if (prefs.copyAs === 'rust') rust.copy(e.currentTarget as HTMLElement);
  });
}

// ---- preset tab: step through saved colours -----------------------------------------------

const title = $('tab-title');
let loaded: { name: string; color: Oklch } | null = null;

const savedItems = () => all<HTMLButtonElement>('.saved-item');

function same(a: Oklch, b: Oklch) {
  const hueMatters = a.c > ACHROMATIC && b.c > ACHROMATIC;
  return (
    Math.abs(a.l - b.l) < 5e-4 &&
    Math.abs(a.c - b.c) < 5e-4 &&
    Math.abs(a.a - b.a) < 2e-3 &&
    (!hueMatters || Math.abs(((a.h - b.h + 540) % 360) - 180) < 0.05)
  );
}

function renderTitle() {
  const items = savedItems();
  $<HTMLButtonElement>('prev-saved').disabled = $<HTMLButtonElement>('next-saved').disabled = !items.length;
  const match = loaded && same(loaded.color, state);
  title.textContent = loaded ? (match ? loaded.name : `${loaded.name} · edited`) : 'OKLCH Lab';
  title.classList.toggle('dirty', !!loaded && !match);
  for (const item of items) {
    const color = parseColor(item.dataset.text ?? '');
    item.classList.toggle('current', !!color && same(color, state));
  }
}

$('saved-list').addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.saved-item');
  const color = item && parseColor(item.dataset.text ?? '');
  if (!item || !color) return;
  loaded = { name: item.querySelector('.saved-name')?.textContent ?? '', color };
});

function step(by: number) {
  const items = savedItems();
  if (!items.length) return;
  // From the live state, not the `.current` class, which only updates on the next frame.
  const current = items.findIndex((i) => {
    const color = parseColor(i.dataset.text ?? '');
    return !!color && same(color, state);
  });
  const next = current < 0 ? (by > 0 ? 0 : items.length - 1) : (current + by + items.length) % items.length;
  items[next].click();
  items[next].scrollIntoView({ block: 'nearest' });
}
$('prev-saved').addEventListener('click', () => step(-1));
$('next-saved').addEventListener('click', () => step(1));

// The saved list re-renders on load and save; keep the tab and highlight in step.
new MutationObserver(() => renderTitle()).observe($('saved-list'), { childList: true });

// ---- render loop -------------------------------------------------------------------------

let scheduled = false;
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    renderBands();
    renderMeters();
    renderKnobs();
    renderSwitches();
    renderTitle();
    rust.render();
    hsla.render();
    paintRing();
  });
}

window.addEventListener('oklch:state', (e) => {
  state = { ...state, ...(e as CustomEvent<Partial<State>>).detail };
  schedule();
});
new ResizeObserver(() => {
  ringKey = '';
  schedule();
}).observe(dial);

applyFormat();
schedule();
