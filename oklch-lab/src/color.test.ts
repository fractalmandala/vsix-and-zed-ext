import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLOR_LITERAL,
  FORMATS,
  format,
  formatHex,
  formatHsl,
  formatHsla,
  formatOklch,
  formatRgb,
  formatRust,
  inGamut,
  maxChroma,
  parseColor,
  smallestGamut,
  toSrgbMapped,
} from './color';

const close = (a: number, b: number, eps: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${a} ≈ ${b} (±${eps})`);

const must = (s: string) => {
  const p = parseColor(s);
  assert.ok(p, `failed to parse ${JSON.stringify(s)}`);
  return p;
};

test('hex #79af75 is the reference oklch(0.7 0.1 143) colour', () => {
  const p = must('#79af75');
  close(p.l, 0.7, 0.005);
  close(p.c, 0.1, 0.005);
  close(p.h, 143, 1);
  assert.equal(p.a, 1);
  assert.equal(p.source, 'hex');
});

test('known conversions', () => {
  const white = must('#fff');
  close(white.l, 1, 1e-3);
  close(white.c, 0, 1e-3);
  const red = must('#ff0000');
  close(red.l, 0.628, 1e-3);
  close(red.c, 0.2577, 1e-3);
  close(red.h, 29.23, 0.05);
  const black = must('#000000');
  close(black.l, 0, 1e-6);
});

test('every input syntax parses to the same colour', () => {
  const ref = must('#79af75');
  const same = [
    '79af75',
    '#79AF75',
    '#79af75ff',
    'rgb(121, 175, 117)',
    'rgba(121,175,117,1)',
    'rgb(121 175 117)',
    'rgb(121 175 117 / 100%)',
    'rgb(47.45% 68.63% 45.88%)',
    '121, 175, 117',
    '121 175 117',
    'RGB( 121 , 175 , 117 );',
  ];
  for (const s of same) {
    const p = must(s);
    close(p.l, ref.l, 2e-3, s);
    close(p.c, ref.c, 2e-3, s);
    close(p.h, ref.h, 1, s);
    close(p.a, 1, 1e-9, s);
  }
  for (const s of ['hsl(113, 24%, 59%)', 'hsla(113deg 24% 59% / 1)', 'hsl(0.3139turn 24% 59%)']) {
    const p = must(s);
    close(p.l, ref.l, 0.01, s);
    close(p.h, ref.h, 3, s);
  }
  for (const s of ['oklch(0.7 0.1 143)', 'oklch(70% 0.1 143)', 'oklch(0.7 25% 143deg)', 'oklch(0.7, 0.1, 143)']) {
    const p = must(s);
    close(p.l, 0.7, 1e-9, s);
    close(p.c, 0.1, 1e-9, s);
    close(p.h, 143, 1e-9, s);
    assert.equal(p.source, 'oklch');
  }
});

test('alpha in every format', () => {
  close(must('#ff000080').a, 128 / 255, 1e-9);
  close(must('#f008').a, 136 / 255, 1e-9);
  close(must('rgba(255, 0, 0, 0.5)').a, 0.5, 1e-9);
  close(must('rgb(255 0 0 / 50%)').a, 0.5, 1e-9);
  close(must('hsla(0, 100%, 50%, 0.25)').a, 0.25, 1e-9);
  close(must('oklch(0.7 0.1 143 / 0.4)').a, 0.4, 1e-9);
});

test('rejects non-colours', () => {
  for (const s of ['', '   ', 'hello', '#12', '#12345', 'rgb(1,2)', 'rgb(a b c)', 'oklch(0.5 0.1)', 'hsl(10deg 10deg 10%)', '1,2']) {
    assert.equal(parseColor(s), null, JSON.stringify(s));
  }
});

test('formats the reference colour', () => {
  const p = must('#79af75');
  assert.equal(formatHex(p), '#79af75');
  assert.equal(formatHex(p, { syntax: 'legacy', hexUpper: true }), '#79AF75');
  assert.equal(formatRgb(p), 'rgb(121, 175, 117)');
  assert.equal(formatRgb(p, { syntax: 'modern', hexUpper: false }), 'rgb(121 175 117)');
  assert.equal(formatHsl(p), 'hsl(115.9, 26.6%, 57.3%)');
  assert.equal(formatOklch(p), 'oklch(0.70111 0.1006 142.8)');
});

test('alpha formatting uses rgba/hsla (legacy) or slash (modern)', () => {
  const p = must('oklch(0.7 0.1 143 / 0.5)');
  assert.match(formatRgb(p), /^rgba\(\d+, \d+, \d+, 0\.5\)$/);
  assert.match(formatHsl(p), /^hsla\([\d.]+, [\d.]+%, [\d.]+%, 0\.5\)$/);
  assert.match(formatRgb(p, { syntax: 'modern', hexUpper: false }), /^rgb\(\d+ \d+ \d+ \/ 0\.5\)$/);
  assert.match(formatHex(p), /^#[0-9a-f]{6}80$/);
  assert.match(formatOklch(p), /\/ 0\.5\)$/);
});

test('formatHsla writes the fractional 0-1 form and round-trips', () => {
  // hue as a turn, saturation / lightness / alpha as 0-1: `hsla(0.045, 0.88, 0.48, 1.0)`.
  assert.equal(formatHsla(must('#79af75')), 'hsla(0.322, 0.266, 0.573, 1.0)');
  assert.equal(formatHsla(must('hsl(43.2, 28%, 94%)')), 'hsla(0.12, 0.28, 0.94, 1.0)');
  assert.equal(formatHsla(must('hsl(16.2, 88%, 48%)')), 'hsla(0.045, 0.88, 0.48, 1.0)');
  assert.equal(formatHsla(must('oklch(0.7 0.1 143 / 0.5)')), 'hsla(0.323, 0.263, 0.572, 0.5)');
  // It parses back to the colour it came from — the field must read its own output.
  for (const s of ['#000000', '#ffffff', '#123456', '#a3ccdd80', '#79af75']) {
    const p = must(s);
    const back = must(formatHsla(p));
    close(back.l, p.l, 0.005);
    close(back.a, p.a, 0.005);
    assert.equal(formatHex(back), s);
  }
  assert.match(formatHsla(must('oklch(0.7 0.1 143 / 0.5)')), /^hsla\(0\.\d+, 0\.\d+, 0\.\d+, 0\.5\)$/);
});

test('fractional hsla() parses as 0-1 components, not degrees and percent', () => {
  const css = must('hsl(43.2, 28%, 94%)');
  const frac = must('hsla(0.12, 0.28, 0.94, 1.0)');
  close(frac.l, css.l, 0.005);
  close(frac.h, css.h, 0.5);
  assert.equal(formatHex(frac), formatHex(css));
  // A `%` anywhere still means plain CSS degrees and percent.
  const pct = must('hsla(200, 50%, 50%, 0.5)');
  assert.equal(formatHsl(pct, { syntax: 'legacy', hexUpper: false }), 'hsla(200, 50%, 50%, 0.5)');
  close(pct.a, 0.5, 1e-9);
  // Hue above 1 cannot be a turn, so it stays degrees and the saturation stays a percent.
  close(must('hsl(120, 0.5, 0.5)').c, 0, 0.01);
});

test('hex -> oklch -> hex is lossless for all 8-bit sRGB samples', () => {
  let n = 0;
  for (let r = 0; r < 256; r += 5) {
    for (let g = 0; g < 256; g += 5) {
      for (let b = 0; b < 256; b += 5) {
        const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        const viaOklch = must(formatOklch(must(hex)));
        assert.equal(formatHex(viaOklch), hex, `${hex} via ${formatOklch(must(hex))}`);
        assert.equal(formatRgb(viaOklch), `rgb(${r}, ${g}, ${b})`);
        n++;
      }
    }
  }
  assert.ok(n > 100000);
});

test('hex -> hsl -> hex round trips (1-decimal hsl)', () => {
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        assert.equal(formatHex(must(formatHsl(must(hex)))), hex);
      }
    }
  }
});

test('every format parses back from every format', () => {
  const start = must('oklch(0.62 0.15 250 / 0.8)');
  for (const from of FORMATS) {
    const s = format(start, from);
    const p = must(s);
    assert.equal(p.source, from);
    for (const to of FORMATS) {
      close(parseColor(format(p, to))!.a, 0.8, 0.01, `${from}->${to}`);
    }
  }
});

test('gamut: sRGB primary, P3-only and out-of-gamut colours', () => {
  assert.ok(inGamut(...(({ l, c, h }) => [l, c, h] as const)(must('#ff0000')), 'srgb'));
  // very chromatic green, inside P3 but outside sRGB
  assert.equal(smallestGamut({ l: 0.8, c: 0.28, h: 145, a: 1 }), 'p3');
  assert.equal(smallestGamut({ l: 0.5, c: 0.39, h: 145, a: 1 }), null);
  assert.equal(smallestGamut({ l: 0.5, c: 0.05, h: 145, a: 1 }), 'srgb');
});

test('maxChroma is the boundary, per gamut and nested', () => {
  for (const h of [0, 60, 143, 250, 320]) {
    for (const l of [0.2, 0.5, 0.8]) {
      const s = maxChroma(l, h, 'srgb');
      const p3 = maxChroma(l, h, 'p3');
      const r = maxChroma(l, h, 'rec2020');
      assert.ok(s <= p3 + 1e-6 && p3 <= r + 1e-6, `nested ${l},${h}`);
      assert.ok(inGamut(l, s, h, 'srgb'));
      if (s < 0.4) assert.ok(!inGamut(l, s + 0.01, h, 'srgb'));
    }
  }
  // near black the tolerance must not let huge chroma through (this used to paint a black wedge)
  assert.ok(maxChroma(0.05, 143, 'srgb') < 0.05);
  assert.ok(maxChroma(0.02, 250, 'srgb') < 0.03);
  assert.equal(maxChroma(0, 100, 'srgb'), 0);
  assert.equal(maxChroma(1, 100, 'srgb'), 0);
});

test('gamut is a wedge that narrows toward black (no phantom islands)', () => {
  for (const g of ['srgb', 'p3', 'rec2020'] as const) {
    // (not 264: along the pure-blue primary r and g sit at ~1e-5, the size of the tolerance)
    for (const h of [30, 90, 143, 200, 330]) {
      let prev = Infinity;
      // the boundary must not grow again as L falls toward black
      // (down to L=0.03: below that channel values are ~1e-6, the size of float tolerance)
      for (let l = 0.2; l >= 0.03; l -= 0.002) {
        const c = maxChroma(l, h, g);
        assert.ok(c <= prev + 0.004, `${g} h=${h} L=${l.toFixed(3)} C=${c} > ${prev}`);
        prev = Math.min(prev, c + 0.004);
      }
    }
  }
});

test('out-of-gamut colours map into sRGB by chroma reduction and keep their hue', () => {
  const wild = { l: 0.7, c: 0.37, h: 145, a: 1 };
  const m = toSrgbMapped(wild);
  assert.ok(m.mapped);
  assert.ok(m.rgb.every((v) => v >= 0 && v <= 1));
  const back = must(formatHex(wild));
  close(back.h, 145, 3);
  close(back.l, 0.7, 0.02);
});

test('COLOR_LITERAL finds colours in source text', () => {
  const src = 'a { color: #79af75; b: rgba(1, 2, 3, .5); c: hsl(10 20% 30%); d: oklch(0.7 0.1 143 / 0.5); e: #fff }';
  const found = src.match(COLOR_LITERAL);
  assert.deepEqual(found, ['#79af75', 'rgba(1, 2, 3, .5)', 'hsl(10 20% 30%)', 'oklch(0.7 0.1 143 / 0.5)', '#fff']);
});

test('Rust / gpui rgb(0x…) and rgba(0x…) parse as u32 colours', () => {
  assert.equal(formatHex(must('rgb(0x79af75)')), '#79af75');
  assert.equal(formatHex(must('RGB(0x79AF75)')), '#79af75');
  assert.equal(formatHex(must('rgb(0x79_af_75)')), '#79af75');
  assert.equal(formatHex(must('rgba(0xa3ccddff)')), '#a3ccdd');
  assert.equal(formatHex(must('rgba(0xa3ccdd80)')), '#a3ccdd80');
  close(must('rgba(0xa3ccdd80)').a, 128 / 255, 1e-9);
  // A u32, as gpui reads it: short literals are leading zeros, not CSS shorthand.
  assert.equal(formatHex(must('rgb(0xabc)')), '#000abc');
  assert.equal(formatHex(must('rgba(0xff)')), '#000000');
  assert.equal(formatHex(must('rgba(0x80)')), '#00000080');
  for (const bad of ['rgb(0x1234567)', 'rgba(0x123456789)', 'rgb(0x)', 'rgb(0xgg0000)', 'rgb(0x12, 0x34)']) {
    assert.equal(parseColor(bad), null, bad);
  }
});

test('formatRust writes rgb() when opaque and rgba() otherwise, and round-trips', () => {
  assert.equal(formatRust(must('#79af75')), 'rgb(0x79af75)');
  assert.equal(formatRust(must('#79af75cc')), 'rgba(0x79af75cc)');
  assert.equal(formatRust(must('#79af75'), { syntax: 'legacy', hexUpper: true }), 'rgb(0x79AF75)');
  for (const s of ['#000000', '#ffffff', '#123456', '#a3ccdd80']) {
    assert.equal(formatHex(must(formatRust(must(s)))), s);
  }
  assert.ok('fill: rgb(0xaaccdd)'.match(COLOR_LITERAL)?.includes('rgb(0xaaccdd)'));
});
