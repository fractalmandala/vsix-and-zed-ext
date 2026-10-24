/**
 * Builds `standalone/oklch-lab.html`: one self-contained page with the explorer, the converter
 * and the colour saver, in the plugin-panel skin (`plugin.css`). The markup keeps every id and
 * class `src/webview/main.ts` drives; `plugin.ts` adds the dial, meters, knobs and switches.
 * CSS and the bundled script are inlined, so the file opens straight from disk.
 *
 *   bun standalone/build.ts
 */
import { join } from 'node:path';
import { TARGET_PATH } from './paths';

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const COPY = svg('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');

type Ch = 'l' | 'c' | 'h' | 'a';
const TITLE: Record<Ch, string> = { l: 'Lightness', c: 'Chroma', h: 'Hue', a: 'Alpha' };

/** One spectrum band: the gamut graph (or the alpha preview) over its slider. */
function band(ch: Ch, axes?: { y: string; x: string }) {
  const view = axes
    ? `<div class="graph" id="graph-${ch}">
        <canvas></canvas>
        <i class="hair hair-v"></i><i class="hair hair-h"><span class="chip" id="chip-${ch}"></span></i>
        <span class="axis axis-y">${axes.y}</span><span class="axis axis-x">${axes.x}</span>
      </div>`
    : `<div class="alpha-view"><div class="fill" id="alpha-fill-view"></div><span class="chip" id="chip-${ch}"></span></div>`;
  return `<div class="band band-${ch}" id="card-${ch}">
      ${view}
      <div class="slider" id="slider-${ch}" role="slider" tabindex="0" aria-label="${TITLE[ch]}">
        <div class="track"><canvas></canvas></div>
        <div class="handle"></div>
      </div>
      <div class="band-label">${TITLE[ch]}</div>
    </div>`;
}

const pill = (name: string, accent: string, a: [string, string], b: [string, string], label: string) =>
  `<div class="pill" data-pill="${name}" style="--accent: var(--${accent})" role="group" aria-label="${label}">
      <button data-value="${a[0]}">${a[1]}</button><button data-value="${b[0]}">${b[1]}</button>
    </div>`;

function knob(ch: Ch, unit: string, step: string, min: string, max: string) {
  return `<div class="knob-cell">
      <div class="knob knob-${ch}" data-axis="${ch}">
        <div class="knob-dots"></div>
        <div class="knob-arc"></div>
        <div class="knob-face">
          <input class="num" id="num-${ch}" type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" aria-label="${TITLE[ch]}">
          <span class="unit">${unit}</span>
        </div>
        <div class="knob-pointer"></div>
      </div>
      <div class="knob-label">${TITLE[ch]}</div>
    </div>`;
}

// main.ts keeps an `rgb` field: rgb() when opaque, rgba() otherwise.
function lcd(id: string, tag: string) {
  return `<div class="field" data-format="${id}">
        <span class="tag">${tag}</span>
        <input class="field-input" id="field-${id}" spellcheck="false" autocomplete="off" aria-label="${tag}">
        <span class="field-actions">
          <button class="icon-btn" data-copy="${id}" title="Copy ${tag}" aria-label="Copy ${tag}">${COPY}</button>
        </span>
      </div>`;
}

const input = (id: string, tag: string, placeholder: string) =>
  `<div class="field">
      <span class="tag">${tag}</span>
      <input class="field-input" id="${id}" placeholder="${placeholder}" spellcheck="false" autocomplete="off" aria-label="${tag}">
    </div>`;

const vswitch = (name: string, side: 'left' | 'right', options: [string, string][], label: string) =>
  `<div class="vswitch ${side}" data-switch="${name}" role="radiogroup" aria-label="${label}">
      ${options.map(([value, text]) => `<button role="radio" data-value="${value}">${text}</button>`).join('\n      ')}
    </div>`;

const meter = (ch: 'l' | 'c', label: string) =>
  `<div class="meter meter-${ch}" data-axis="${ch}">
      <div class="meter-bars" aria-label="${TITLE[ch]} meter">
        <i class="meter-rail"></i>
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-chip"></span>
      </div>
      <div class="meter-scale"></div>
      <div class="meter-label">${label}</div>
    </div>`;

const body = `<div class="chassis">
  <header class="tab header">
    <button class="tab-arrow" id="prev-saved" title="Previous saved colour" aria-label="Previous saved colour">‹</button>
    <div class="tab-title" id="tab-title">OKLCH Lab</div>
    <button class="tab-arrow" id="next-saved" title="Next saved colour" aria-label="Next saved colour">›</button>
    <button hidden data-action="random" id="random-proxy" tabindex="-1"></button>
  </header>

  <div class="frame">
    <div class="app" data-graphs="on">
      <section class="screen">
        ${band('l', { y: 'C', x: 'L' })}
        ${band('c', { y: 'C', x: 'H' })}
        ${band('h', { y: 'L', x: 'H' })}
        ${band('a')}
      </section>

      <section class="pills">
        ${pill('hexcase', 'orange', ['lower', 'abc'], ['upper', 'ABC'], 'Hex case')}
        ${pill('syntax', 'pink', ['legacy', 'legacy'], ['modern', 'modern'], 'RGB and HSL syntax')}
        ${pill('graphs', 'purple', ['on', 'graphs'], ['off', 'sliders'], 'Show graphs')}
        ${pill('depth', 'blue', ['flat', 'flat'], ['3d', '3D'], 'Show 3D gamut')}
      </section>

      <div hidden>
        <input type="checkbox" id="t-3d"><input type="checkbox" id="t-graphs">
        <input type="checkbox" id="t-p3"><input type="checkbox" id="t-rec2020">
      </div>

      <section class="card-3d" id="card-3d" hidden>
        <span class="hint-inline">gamut 3D · drag to rotate · double-click to reset</span>
        <canvas id="cv-3d" aria-label="3D view of the colour gamut"></canvas>
      </section>

      <section class="console">
        ${meter('l', 'light')}
        ${vswitch('copyas', 'right', [['oklch', 'oklch'], ['hex', 'hex'], ['rgb', 'rgba'], ['hsl', 'hsl'], ['rust', 'rust']], 'Copy format')}
        <div class="dial-wrap">
          <div class="dial" id="dial" title="Drag around the ring to set hue">
            <canvas id="dial-ring"></canvas>
            <div class="dial-marker" id="dial-marker"></div>
            <div class="dial-face">
              <button class="swatch-btn" id="swatch-btn" data-copy="oklch" title="Copy colour" aria-label="Copy colour"><div class="swatch-fill" id="swatch"></div></button>
            </div>
          </div>
          <p class="gamut" id="gamut"></p>
        </div>
        <div class="rounds">
          <button class="round" id="random-btn">RANDOM</button>
          <button class="round" id="copy-btn" data-copy="oklch">COPY</button>
        </div>
        ${meter('c', 'chroma')}
      </section>

      <section class="lcds">
        ${lcd('oklch', 'OKLCH')}
        ${lcd('hex', 'HEX')}
        ${lcd('rgb', 'RGBA')}
        ${lcd('hsl', 'HSL')}
        <div class="field field-wide" data-format="hsla">
          <span class="tag">HSLA</span>
          <input class="field-input" id="field-hsla" spellcheck="false" autocomplete="off" aria-label="HSLA">
          <span class="field-actions">
            <button class="icon-btn" id="copy-hsla" title="Copy HSLA" aria-label="Copy HSLA">${COPY}</button>
          </span>
        </div>
        <div class="field field-wide" data-format="rust">
          <span class="tag">RUST</span>
          <input class="field-input" id="field-rust" spellcheck="false" autocomplete="off" aria-label="Rust (gpui)">
          <span class="field-actions">
            <button class="icon-btn" id="copy-rust" title="Copy Rust" aria-label="Copy Rust">${COPY}</button>
          </span>
        </div>
        <p class="hint" id="hint">Type or paste any HEX, RGB(A), HSL(A), OKLCH or Rust <code>rgb(0x…)</code> / <code>rgba(0x…)</code> into any field — the rest follow.</p>
      </section>

      <section class="knobs">
        ${knob('l', 'L', '0.01', '0', '1')}
        ${knob('c', 'C', '0.01', '0', '0.4')}
        ${knob('h', 'DEG', '1', '0', '360')}
        ${knob('a', '%', '1', '0', '100')}
        ${vswitch('gamut', 'left', [['srgb', 'srgb'], ['p3', 'p3'], ['rec2020', 'rec2020']], 'Gamut outlines')}
      </section>

      <section class="library">
        <div class="save">
          <div class="section-head"><h2>Save</h2><span class="hint-inline" id="file-label"></span></div>
          ${input('save-name', 'NAME', 'e.g. pure-white')}
          ${input('save-class', 'CLASS', 'optional, e.g. surfaces')}
          <div class="save-row">
            <button class="btn primary" id="save-btn">SAVE</button>
            <button class="btn" id="connect-btn"></button>
            <button class="btn" id="download-btn">DOWNLOAD JSON</button>
          </div>
          <p class="hint" id="save-status">Saving an existing name updates it.</p>
          <p class="path" title="Pick this file when connecting">${TARGET_PATH}</p>
        </div>
        <div>
          <div class="section-head"><h2>Saved</h2><span class="hint-inline" id="saved-count"></span></div>
          <ul class="saved-list" id="saved-list"></ul>
        </div>
      </section>
    </div>
  </div>

  <footer class="foot"><i class="grille"></i><span>OKLCH · LAB</span><i class="grille"></i></footer>
</div>`;

const result = await Bun.build({
  entrypoints: [join(import.meta.dir, 'entry.ts')],
  target: 'browser',
  format: 'iife',
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const script = (await result.outputs[0].text()).replaceAll('</script', '<\\/script');
const css = (await Bun.file(join(import.meta.dir, 'plugin.css')).text()).replaceAll('</style', '<\\/style');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OKLCH Lab</title>
  <style>
${css}
  </style>
</head>
<body>
  ${body}
  <script>
${script}
  </script>
</body>
</html>
`;

const out = join(import.meta.dir, 'oklch-lab.html');
await Bun.write(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
