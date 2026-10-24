/**
 * Colour math + parsing + formatting. Pure functions, no DOM and no `vscode`,
 * so the same module is bundled into the extension host and the webview.
 *
 * Canonical representation is OKLCH (`Oklch`): L 0..1, C 0..~0.4, H 0..360, A 0..1.
 * Everything else (hex / rgb / hsl) is derived from it, and any of them can be parsed back.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

export type Gamut = 'srgb' | 'p3' | 'rec2020';
export type Rgb = [number, number, number];

export type Syntax = 'legacy' | 'modern';
export interface FormatOptions {
  /** `legacy` -> `rgba(1, 2, 3, 0.5)`; `modern` -> `rgb(1 2 3 / 0.5)` */
  syntax: Syntax;
  hexUpper: boolean;
}
export const DEFAULT_FORMAT: FormatOptions = { syntax: 'legacy', hexUpper: false };

/** Chroma below this has no meaningful hue. */
export const ACHROMATIC = 4e-4;
/** Upper bound of the chroma axis used by graphs and by CSS percentage chroma. */
export const C_MAX = 0.4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const wrapHue = (h: number) => ((h % 360) + 360) % 360;
const RAD = Math.PI / 180;

// ---- transfer function ----------------------------------------------------

export const encode = (v: number) => {
  const s = v < 0 ? -1 : 1;
  const x = Math.abs(v);
  return s * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
};
export const decode = (v: number) => {
  const s = v < 0 ? -1 : 1;
  const x = Math.abs(v);
  return s * (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
};

// ---- OKLab <-> linear sRGB (Ottosson) -------------------------------------

/** Cube-rooted LMS cone responses for an OKLCH colour. */
function lmsPrime(l: number, c: number, h: number): Rgb {
  const hr = h * RAD;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  return [
    l + 0.3963377774 * a + 0.2158037573 * b,
    l - 0.1055613458 * a - 0.0638541728 * b,
    l - 0.0894841775 * a - 1.291485548 * b,
  ];
}

function lmsToLinearSrgb(l_: number, m_: number, s_: number): Rgb {
  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

export function oklchToLinearSrgb(l: number, c: number, h: number): Rgb {
  const [l_, m_, s_] = lmsPrime(l, c, h);
  return lmsToLinearSrgb(l_, m_, s_);
}

export function linearSrgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  return { l: L, c, h: c < ACHROMATIC ? 0 : wrapHue(Math.atan2(B, A) / RAD) };
}

// ---- wide gamuts (via XYZ D65) --------------------------------------------

const toXyz = (r: number, g: number, b: number): Rgb => [
  0.4123907993 * r + 0.3575843394 * g + 0.1804807884 * b,
  0.2126390059 * r + 0.7151686788 * g + 0.0721923154 * b,
  0.0193308187 * r + 0.1191947798 * g + 0.9505321522 * b,
];
const xyzToP3 = (x: number, y: number, z: number): Rgb => [
  2.4934969119 * x - 0.9313836179 * y - 0.4027107845 * z,
  -0.8294889696 * x + 1.7626640603 * y + 0.0236246858 * z,
  0.0358458302 * x - 0.0761723893 * y + 0.956884524 * z,
];
const xyzToRec2020 = (x: number, y: number, z: number): Rgb => [
  1.716651188 * x - 0.3556707838 * y - 0.2533662814 * z,
  -0.6666843518 * x + 1.6164812366 * y + 0.0157685458 * z,
  0.0176398574 * x - 0.0427706133 * y + 0.9421031212 * z,
];

/** OKLCH -> *linear* RGB in the given gamut. Components may fall outside 0..1. */
export function oklchToLinear(l: number, c: number, h: number, gamut: Gamut): Rgb {
  const lin = oklchToLinearSrgb(l, c, h);
  if (gamut === 'srgb') return lin;
  const [x, y, z] = toXyz(lin[0], lin[1], lin[2]);
  return gamut === 'p3' ? xyzToP3(x, y, z) : xyzToRec2020(x, y, z);
}

/**
 * Tolerance in *encoded* (gamma) space, deliberately tiny: it only absorbs float noise and the
 * rounding in printed oklch() values. Anything larger lets near-black colours with huge chroma
 * pass (channel values there are ~1e-5, so even half an 8-bit step swamps them) and paints a
 * wedge of nonsense in the graphs. Colours that are merely *visually* inside the gamut are
 * handled separately, by `VISIBLE_EPS` and by `toSrgbMapped`'s clip-distance check.
 */
const EPS = 1e-4;
/** Half an 8-bit step: out of gamut by less than this is indistinguishable from in gamut. */
const VISIBLE_EPS = 0.5 / 255;
const inUnit = (v: Rgb, eps: number) => {
  for (let i = 0; i < 3; i++) {
    const e = encode(v[i]);
    if (e < -eps || e > 1 + eps) return false;
  }
  return true;
};

export function inGamut(l: number, c: number, h: number, gamut: Gamut, eps = EPS): boolean {
  // Negative cone responses are not real light. Cubing them can still land inside the RGB cube,
  // which would add phantom "in gamut" islands near black with large chroma.
  const [l_, m_, s_] = lmsPrime(l, c, h);
  if (l_ < 0 || m_ < 0 || s_ < 0) return false;
  return inUnit(oklchToLinear(l, c, h, gamut), eps);
}

/** Largest in-gamut chroma at (l, h). Bisection; the gamut is star-shaped around the L axis. */
export function maxChroma(l: number, h: number, gamut: Gamut): number {
  if (l <= 0 || l >= 1) return 0;
  if (inGamut(l, C_MAX, h, gamut)) return C_MAX;
  let lo = 0;
  let hi = C_MAX;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(l, mid, h, gamut)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Encoded (gamma) channels in the gamut, clamped to 0..1. */
export function oklchToEncoded(l: number, c: number, h: number, gamut: Gamut): Rgb {
  const v = oklchToLinear(l, c, h, gamut);
  return [clamp(encode(v[0]), 0, 1), clamp(encode(v[1]), 0, 1), clamp(encode(v[2]), 0, 1)];
}

/** Which is the smallest gamut containing this colour (to within a visible step), or `null` when it is outside Rec.2020. */
export function smallestGamut(col: Oklch): Gamut | null {
  for (const g of ['srgb', 'p3', 'rec2020'] as const) if (inGamut(col.l, col.c, col.h, g, VISIBLE_EPS)) return g;
  return null;
}

/** OKLab distance between two OKLCH colours. */
function deltaEOK(a: Oklch, b: Oklch): number {
  const ar = a.h * RAD;
  const br = b.h * RAD;
  return Math.hypot(a.l - b.l, a.c * Math.cos(ar) - b.c * Math.cos(br), a.c * Math.sin(ar) - b.c * Math.sin(br));
}

/** Clip to sRGB per channel and express the result as OKLCH, for measuring the error. */
function clipSrgb(l: number, c: number, h: number): { rgb: Rgb; ok: Oklch } {
  const rgb = oklchToEncoded(l, c, h, 'srgb');
  return { rgb, ok: { ...linearSrgbToOklch(decode(rgb[0]), decode(rgb[1]), decode(rgb[2])), a: 1 } };
}

const JND = 0.02;

/**
 * Map to sRGB for the legacy formats (hex / rgb / hsl) following the CSS Color 4 gamut-mapping
 * algorithm: clip when the clipped colour is within a just-noticeable difference, otherwise
 * reduce chroma at constant L and H until it is. `mapped` is true only when the result visibly
 * differs from the input.
 */
export function toSrgbMapped(col: Oklch): { rgb: Rgb; mapped: boolean } {
  const l = clamp(col.l, 0, 1);
  if (l >= 1) return { rgb: [1, 1, 1], mapped: col.l > 1 + 1e-6 || col.c > ACHROMATIC };
  if (l <= 0) return { rgb: [0, 0, 0], mapped: col.l < -1e-6 || col.c > ACHROMATIC };
  if (inGamut(l, col.c, col.h, 'srgb')) return { rgb: oklchToEncoded(l, col.c, col.h, 'srgb'), mapped: false };

  const origin: Oklch = { l, c: col.c, h: col.h, a: 1 };
  let clipped = clipSrgb(l, col.c, col.h);
  const clipErr = deltaEOK(clipped.ok, origin);
  if (clipErr < JND) return { rgb: clipped.rgb, mapped: clipErr > 0.002 };

  let lo = 0;
  let hi = col.c;
  let loInGamut = true;
  while (hi - lo > 1e-4) {
    const c = (lo + hi) / 2;
    if (loInGamut && inGamut(l, c, col.h, 'srgb')) {
      lo = c;
      continue;
    }
    clipped = clipSrgb(l, c, col.h);
    const e = deltaEOK(clipped.ok, { l, c, h: col.h, a: 1 });
    if (e < JND) {
      if (JND - e < 1e-4) return { rgb: clipped.rgb, mapped: true };
      loInGamut = false;
      lo = c;
    } else {
      hi = c;
    }
  }
  return { rgb: clipped.rgb, mapped: true };
}

export function srgbToOklch(r: number, g: number, b: number, a = 1): Oklch {
  const { l, c, h } = linearSrgbToOklch(decode(r), decode(g), decode(b));
  return { l, c, h, a };
}

// ---- HSL ------------------------------------------------------------------

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: wrapHue(h * 60), s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + wrapHue(h) / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

// ---- number formatting ----------------------------------------------------

/** Round to `d` decimals and trim trailing zeros; never returns "-0". */
export function num(n: number, d: number): string {
  const v = Number(n.toFixed(d));
  return String(Object.is(v, -0) ? 0 : v);
}

const byte = (v: number) => Math.round(clamp(v, 0, 1) * 255);

// ---- formatting -----------------------------------------------------------

export function formatHex(col: Oklch, opts: FormatOptions = DEFAULT_FORMAT): string {
  const { rgb } = toSrgbMapped(col);
  const parts = rgb.map((v) => byte(v).toString(16).padStart(2, '0'));
  const a = byte(col.a);
  if (a < 255) parts.push(a.toString(16).padStart(2, '0'));
  const hex = '#' + parts.join('');
  return opts.hexUpper ? hex.toUpperCase() : hex;
}

export function formatRgb(col: Oklch, opts: FormatOptions = DEFAULT_FORMAT): string {
  const [r, g, b] = toSrgbMapped(col).rgb.map(byte);
  const hasAlpha = col.a < 1;
  const alpha = num(col.a, 3);
  if (opts.syntax === 'modern') return `rgb(${r} ${g} ${b}${hasAlpha ? ` / ${alpha}` : ''})`;
  return hasAlpha ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
}

export function formatHsl(col: Oklch, opts: FormatOptions = DEFAULT_FORMAT): string {
  const [r, g, b] = toSrgbMapped(col).rgb;
  const { h, s, l } = rgbToHsl(r, g, b);
  const H = num(h, 1);
  const S = num(s * 100, 1);
  const L = num(l * 100, 1);
  const hasAlpha = col.a < 1;
  const alpha = num(col.a, 3);
  if (opts.syntax === 'modern') return `hsl(${H} ${S}% ${L}%${hasAlpha ? ` / ${alpha}` : ''})`;
  return hasAlpha ? `hsla(${H}, ${S}%, ${L}%, ${alpha})` : `hsl(${H}, ${S}%, ${L}%)`;
}

/**
 * The fractional form some tooling emits: hue as a 0-1 turn, saturation / lightness / alpha as
 * 0-1, with no `%` or `deg` anywhere. The standalone page shows it beside `hsl()` so the alpha is
 * always visible; the VS Code webview has no field for it.
 */
export function formatHsla(col: Oklch): string {
  const [r, g, b] = toSrgbMapped(col).rgb;
  const { h, s, l } = rgbToHsl(r, g, b);
  return `hsla(${frac(h / 360)}, ${frac(s)}, ${frac(l)}, ${frac(col.a)})`;
}

/** 0-1 component: three decimals at most, one at least — `0.045`, `0.28`, `1.0`. */
function frac(v: number): string {
  const s = v.toFixed(3).replace(/0+$/, '');
  return s.endsWith('.') ? `${s}0` : s;
}

export function formatOklch(col: Oklch): string {
  const alpha = col.a < 1 ? ` / ${num(col.a, 3)}` : '';
  // 5 decimals on L and C is the smallest precision that round-trips every 8-bit sRGB colour.
  return `oklch(${num(col.l, 5)} ${num(col.c, 5)} ${num(col.h, 2)}${alpha})`;
}

/**
 * Rust / gpui syntax: `rgb(0xaaccdd)` when opaque, `rgba(0xaaccddff)` otherwise. Not one of
 * `FORMATS`, since the VS Code webview has no field for it; the standalone page shows it.
 */
export function formatRust(col: Oklch, opts: FormatOptions = DEFAULT_FORMAT): string {
  const hex = formatHex(col, opts).slice(1);
  return hex.length === 8 ? `rgba(0x${hex})` : `rgb(0x${hex})`;
}

export type FormatId = 'hex' | 'rgb' | 'hsl' | 'oklch';
export const FORMATS: readonly FormatId[] = ['hex', 'rgb', 'hsl', 'oklch'];

export function format(col: Oklch, id: FormatId, opts: FormatOptions = DEFAULT_FORMAT): string {
  switch (id) {
    case 'hex':
      return formatHex(col, opts);
    case 'rgb':
      return formatRgb(col, opts);
    case 'hsl':
      return formatHsl(col, opts);
    case 'oklch':
      return formatOklch(col);
  }
}

// ---- parsing --------------------------------------------------------------

export interface Parsed extends Oklch {
  source: FormatId;
}

/** Value + whether it carried a `%`. `null` for `none`. */
interface Tok {
  n: number;
  pct: boolean;
  unit: string;
}

function tok(raw: string): Tok | null {
  if (raw === 'none') return { n: 0, pct: false, unit: '' };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|grad|rad|turn)?$/.exec(raw);
  if (!m) return null;
  const unit = m[2] ?? '';
  return { n: parseFloat(m[1]), pct: unit === '%', unit };
}

/** Hue to degrees. Plain numbers are degrees. */
function hueDeg(t: Tok): number | null {
  switch (t.unit) {
    case '':
    case 'deg':
      return t.n;
    case 'grad':
      return t.n * 0.9;
    case 'rad':
      return t.n / RAD;
    case 'turn':
      return t.n * 360;
    default:
      return null;
  }
}

function alphaOf(t: Tok | undefined): number | null {
  if (!t) return 1;
  if (t.unit && t.unit !== '%') return null;
  return clamp(t.pct ? t.n / 100 : t.n, 0, 1);
}

function parseHex(s: string): Parsed | null {
  const m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (!m) return null;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('');
  const v = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  const a = h.length === 8 ? v(6) : 1;
  return { ...srgbToOklch(v(0), v(2), v(4), a), source: 'hex' };
}

function parseFunctional(fn: string, body: string): Parsed | null {
  const toks = body
    .replace(/[,/]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(tok);
  if (toks.length < 3 || toks.length > 4 || toks.some((t) => t === null)) return null;
  const t = toks as Tok[];
  const a = alphaOf(t[3]);
  if (a === null) return null;

  if (fn === 'rgb' || fn === 'rgba') {
    if (t.some((x, i) => i < 3 && x.unit && x.unit !== '%')) return null;
    const ch = (x: Tok) => clamp(x.pct ? x.n / 100 : x.n / 255, 0, 1);
    return { ...srgbToOklch(ch(t[0]), ch(t[1]), ch(t[2]), a), source: 'rgb' };
  }
  if (fn === 'hsl' || fn === 'hsla') {
    if (t[1].unit === 'deg' || t[2].unit === 'deg') return null;
    // `hsla(0.045, 0.88, 0.48, 1)` is the fractional form: no `%`, every component 0-1, hue a
    // turn rather than degrees. Anything with a `%` (or a hue above 1) is plain CSS.
    const fractional =
      !t[1].pct && !t[2].pct && !t[1].unit && !t[2].unit && t[0].n <= 1 && t[1].n <= 1 && t[2].n <= 1;
    const h = fractional ? t[0].n * 360 : hueDeg(t[0]);
    if (h === null) return null;
    const s = fractional ? t[1].n : t[1].n / 100;
    const l = fractional ? t[2].n : t[2].n / 100;
    const [r, g, b] = hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1));
    return { ...srgbToOklch(r, g, b, a), source: 'hsl' };
  }
  if (fn === 'oklch') {
    const h = hueDeg(t[2]);
    if (h === null) return null;
    const l = clamp(t[0].pct ? t[0].n / 100 : t[0].n, 0, 1);
    const c = Math.max(0, t[1].pct ? (t[1].n / 100) * C_MAX : t[1].n);
    return { l, c, h: wrapHue(h), a, source: 'oklch' };
  }
  return null;
}

/**
 * Rust / gpui `rgb(0xRRGGBB)` and `rgba(0xRRGGBBAA)`. The argument is a `u32`, read the way gpui
 * reads it: `rgb(0xabc)` is `#000abc`, not shorthand. Underscore separators are allowed, as in Rust.
 */
function parseRust(fn: string, digits: string): Parsed | null {
  const hex = digits.replace(/_/g, '');
  if (!hex || hex.length > (fn === 'rgba' ? 8 : 6)) return null;
  const v = parseInt(hex, 16);
  const byte = (shift: number) => Math.floor(v / 2 ** shift) % 256 / 255;
  return fn === 'rgba'
    ? { ...srgbToOklch(byte(24), byte(16), byte(8), byte(0)), source: 'hex' }
    : { ...srgbToOklch(byte(16), byte(8), byte(0)), source: 'hex' };
}

/**
 * Parse any supported colour string. Accepts hex (3/4/6/8 digits, `#` optional), `rgb[a]()`,
 * `hsl[a]()`, `oklch()` in legacy comma or modern space/slash syntax, Rust / gpui
 * `rgb(0xRRGGBB)` / `rgba(0xRRGGBBAA)`, and bare `r g b` / `r, g, b` triplets (treated as 0-255
 * RGB). Returns `null` if it is none of those.
 */
export function parseColor(input: string): Parsed | null {
  const s = input.trim().toLowerCase().replace(/;$/, '');
  if (!s) return null;
  const rust = /^(rgba?)\(\s*0x([0-9a-f_]+)\s*\)$/.exec(s);
  if (rust) return parseRust(rust[1], rust[2]);
  const fn = /^(rgba?|hsla?|oklch)\(\s*([^)]*?)\s*\)$/.exec(s);
  if (fn) return parseFunctional(fn[1], fn[2]);
  const hex = parseHex(s);
  if (hex) return hex;
  if (/^[\d.\s,%+-]+$/.test(s)) return parseFunctional('rgb', s);
  return null;
}

/** Matches colour literals inside source text, for "convert the colour under the cursor". */
export const COLOR_LITERAL = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|\b(?:rgba?|hsla?|oklch)\([^)]*\)/gi;
