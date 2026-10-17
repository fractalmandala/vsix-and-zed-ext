import { C_MAX, inGamut, maxChroma, oklchToEncoded, toSrgbMapped, type Gamut, type Oklch, type Rgb } from '../color';

export type Axis = 'l' | 'c' | 'h';
export const RANGE: Record<Axis, [number, number]> = { l: [0, 1], c: [0, C_MAX], h: [0, 360] };

export interface Layers {
  p3: boolean;
  rec2020: boolean;
}

const ORDER: Gamut[] = ['srgb', 'p3', 'rec2020'];

/** Wide-gamut displays get real P3 pixels; everything else is drawn in sRGB (P3 areas clip). */
export const DISPLAY_P3 = typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches;
const DISPLAY: Gamut = DISPLAY_P3 ? 'p3' : 'srgb';

/** Gamuts currently drawn, smallest first. Rec.2020 implies P3. */
export const activeGamuts = (layers: Layers): Gamut[] => ORDER.slice(0, layers.rec2020 ? 3 : layers.p3 ? 2 : 1);

/** Index into `active` of the smallest gamut containing the colour, or -1. */
function level(l: number, c: number, h: number, active: Gamut[]): number {
  for (let k = 0; k < active.length; k++) if (inGamut(l, c, h, active[k])) return k;
  return -1;
}

const lerp = (r: [number, number], t: number) => r[0] + (r[1] - r[0]) * t;
const to255 = (v: number) => Math.round(v * 255);

function context(canvas: HTMLCanvasElement) {
  return canvas.getContext('2d', { colorSpace: DISPLAY_P3 ? 'display-p3' : 'srgb' }) as CanvasRenderingContext2D;
}

/** CSS colour string for a colour, using display-p3 when the display and colour both allow it. */
export function cssColor(col: Oklch, withAlpha = true): string {
  const alpha = withAlpha && col.a < 1 ? ` / ${+col.a.toFixed(3)}` : '';
  if (DISPLAY_P3 && !inGamut(col.l, col.c, col.h, 'srgb')) {
    const [r, g, b] = oklchToEncoded(col.l, col.c, col.h, 'p3');
    return `color(display-p3 ${+r.toFixed(4)} ${+g.toFixed(4)} ${+b.toFixed(4)}${alpha})`;
  }
  // Same mapping the HEX / RGB / HSL fields use, so the swatch always matches what they say.
  const [r, g, b] = toSrgbMapped(col).rgb;
  return `rgb(${to255(r)} ${to255(g)} ${to255(b)}${alpha})`;
}

let scratch: HTMLCanvasElement | undefined;
const scratchCanvas = (w: number, h: number) => {
  scratch ??= document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  return scratch;
};

/**
 * Paint the gamut cross-section spanned by two OKLCH axes, with the third held at the current
 * colour's value. Pixels outside every active gamut stay transparent; a dark outline traces each
 * active gamut's edge, so sRGB shows up inside P3 inside Rec.2020.
 */
export function paintField(canvas: HTMLCanvasElement, x: Axis, y: Axis, col: Oklch, layers: Layers): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (!cssW || !cssH) return;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);

  const active = activeGamuts(layers);
  const W = cssW;
  const H = cssH;
  const off = scratchCanvas(W, H);
  const octx = context(off);
  const img = octx.createImageData(W, H);
  const data = img.data;

  const top = active.map(() => new Int32Array(W).fill(-1));
  const bot = active.map(() => new Int32Array(W).fill(-1));
  const v: Record<Axis, number> = { l: col.l, c: col.c, h: col.h };

  for (let i = 0; i < W; i++) {
    v[x] = lerp(RANGE[x], (i + 0.5) / W);
    for (let j = 0; j < H; j++) {
      v[y] = lerp(RANGE[y], 1 - (j + 0.5) / H);
      const lv = level(v.l, v.c, v.h, active);
      if (lv < 0) continue;
      const rgb = oklchToEncoded(v.l, v.c, v.h, DISPLAY);
      const p = (j * W + i) * 4;
      data[p] = to255(rgb[0]);
      data[p + 1] = to255(rgb[1]);
      data[p + 2] = to255(rgb[2]);
      data[p + 3] = 255;
      for (let k = lv; k < active.length; k++) {
        if (top[k][i] < 0) top[k][i] = j;
        bot[k][i] = j;
      }
    }
  }
  octx.putImageData(img, 0, 0);

  const ctx = context(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);

  const sx = canvas.width / W;
  const sy = canvas.height / H;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  const curve = (rows: Int32Array, edge: number, bottom: boolean) => {
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < W; i++) {
      const r = rows[i];
      if (r < 0 || r === edge) {
        pen = false;
        continue;
      }
      const px = (i + 0.5) * sx;
      const py = (bottom ? r + 1 : r) * sy;
      if (pen) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
      pen = true;
    }
    ctx.stroke();
  };
  for (let k = 0; k < active.length; k++) {
    // An edge pinned to the plot border is the border, not a gamut edge.
    curve(top[k], 0, false);
    curve(bot[k], H - 1, true);
  }
}

/** One-dimensional version: a gradient along `axis`, gaps where the colour leaves the active gamuts. */
export function paintSlider(canvas: HTMLCanvasElement, axis: Axis, col: Oklch, layers: Layers): void {
  const W = canvas.clientWidth;
  if (!W) return;
  canvas.width = W;
  canvas.height = 1;
  const active = activeGamuts(layers);
  const ctx = context(canvas);
  const img = ctx.createImageData(W, 1);
  const v: Record<Axis, number> = { l: col.l, c: col.c, h: col.h };
  for (let i = 0; i < W; i++) {
    v[axis] = lerp(RANGE[axis], (i + 0.5) / W);
    if (level(v.l, v.c, v.h, active) < 0) continue;
    const rgb = oklchToEncoded(v.l, v.c, v.h, DISPLAY);
    img.data[i * 4] = to255(rgb[0]);
    img.data[i * 4 + 1] = to255(rgb[1]);
    img.data[i * 4 + 2] = to255(rgb[2]);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ---- 3D gamut solid ---------------------------------------------------------

const L_STEPS = 72;
const H_STEPS = 160;
const SHELL_ALPHA = [1, 0.32, 0.22];

interface Shell {
  /** unit-space positions, xyz interleaved */
  pos: Float32Array;
  /** `rgb(...)` strings */
  fill: string[];
}

/** Orthographic point-cloud of each gamut's outer surface in OKLCH cylindrical coordinates. */
export class Cloud {
  yaw = -0.7;
  pitch = 0.38;
  private shells = new Map<Gamut, Shell>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag.x) * 0.01;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      this.onChange?.();
    });
    const end = () => (drag = null);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('dblclick', () => {
      this.yaw = -0.7;
      this.pitch = 0.38;
      this.onChange?.();
    });
  }

  onChange?: () => void;

  private shell(g: Gamut): Shell {
    let s = this.shells.get(g);
    if (s) return s;
    const pos = new Float32Array(L_STEPS * H_STEPS * 3);
    const fill: string[] = [];
    let n = 0;
    for (let i = 0; i < L_STEPS; i++) {
      const l = (i + 0.5) / L_STEPS;
      for (let j = 0; j < H_STEPS; j++) {
        const h = (j / H_STEPS) * 360;
        const c = maxChroma(l, h, g);
        const hr = (h * Math.PI) / 180;
        pos[n * 3] = (c * Math.cos(hr)) / C_MAX;
        pos[n * 3 + 1] = (l - 0.5) * 1.8;
        pos[n * 3 + 2] = (c * Math.sin(hr)) / C_MAX;
        const [r, gg, b]: Rgb = oklchToEncoded(l, c, h, DISPLAY);
        fill.push(`rgb(${to255(r)},${to255(gg)},${to255(b)})`);
        n++;
      }
    }
    s = { pos, fill };
    this.shells.set(g, s);
    return s;
  }

  draw(col: Oklch, layers: Layers): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (!cssW || !cssH) return;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    const ctx = context(this.canvas);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const scale = Math.min(this.canvas.width, this.canvas.height) * 0.46;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const project = (x: number, y: number, z: number) => {
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;
      const y1 = y * cosP - z1 * sinP;
      const z2 = y * sinP + z1 * cosP;
      return { sx: cx + x1 * scale, sy: cy - y1 * scale, depth: z2 };
    };

    // Collect every visible point, then paint back-to-front with a counting sort on depth.
    const gamuts = activeGamuts(layers);
    const BINS = 256;
    const bins: Array<Array<[number, number, number, number]>> = Array.from({ length: BINS }, () => []);
    const fills: string[][] = [];
    gamuts.forEach((g, k) => {
      const s = this.shell(g);
      fills.push(s.fill);
      for (let n = 0; n < s.fill.length; n++) {
        const p = project(s.pos[n * 3], s.pos[n * 3 + 1], s.pos[n * 3 + 2]);
        const bin = Math.max(0, Math.min(BINS - 1, Math.floor(((p.depth + 1.6) / 3.2) * BINS)));
        bins[bin].push([p.sx, p.sy, k, n]);
      }
    });

    // Slightly larger than the sample spacing so the surface reads as solid, not as a grid of dots.
    const size = 3.8 * dpr;
    // Draw the outer shells translucent so the sRGB core stays readable through them.
    for (const bin of bins) {
      for (const [sx, sy, k, n] of bin) {
        ctx.globalAlpha = SHELL_ALPHA[k];
        ctx.fillStyle = fills[k][n];
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      }
    }
    ctx.globalAlpha = 1;

    // Lightness axis.
    const a = project(0, -0.9, 0);
    const b = project(0, 0.9, 0);
    ctx.strokeStyle = 'rgba(128,128,128,.6)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();

    // The current colour.
    const hr = (col.h * Math.PI) / 180;
    const m = project((col.c * Math.cos(hr)) / C_MAX, (col.l - 0.5) * 1.8, (col.c * Math.sin(hr)) / C_MAX);
    const foot = project(0, (col.l - 0.5) * 1.8, 0);
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(foot.sx, foot.sy);
    ctx.lineTo(m.sx, m.sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(m.sx, m.sy, 7 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = cssColor({ ...col, a: 1 });
    ctx.fill();
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.lineWidth = dpr;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.arc(m.sx, m.sy, 8.6 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}
