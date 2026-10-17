'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  applyEditsToText,
  buildPalette,
  buildRippleEdits,
  formatColor,
  indexTheme,
  isColorLiteral,
  parseColor
} = require('../src/themeIndex');

const FIXTURE = JSON.stringify(
  {
    $schema: 'vscode://schemas/color-theme',
    name: 'Fixture',
    type: 'light',
    colors: {
      foreground: '#54595E',
      'editor.background': '#FCFCFC',
      'editor.selectionBackground': '#E6E7E9',
      'button.background': '#F0873A',
      'button.hoverBackground': '#F0873ADD',
      'list.highlightForeground': '#F0873A',
      'tab.activeBorderTop': '#F0873A'
    },
    semanticTokenColors: {
      type: '#6E747A',
      comment: { foreground: '#ABB0B6', fontStyle: 'italic' }
    },
    tokenColors: [
      { name: 'Comment', scope: ['comment'], settings: { foreground: '#ABB0B6', fontStyle: 'italic' } },
      { name: 'Keyword', scope: ['keyword'], settings: { foreground: '#F0873A' } }
    ]
  },
  null,
  2
);

test('isColorLiteral accepts 3, 4, 6 and 8 digit hex only', () => {
  assert.equal(isColorLiteral('#fff'), true);
  assert.equal(isColorLiteral('#ffff'), true);
  assert.equal(isColorLiteral('#FCFCFC'), true);
  assert.equal(isColorLiteral('#F0873ADD'), true);
  assert.equal(isColorLiteral('#fffff'), false);
  assert.equal(isColorLiteral('red'), false);
  assert.equal(isColorLiteral('#FCFCFC '), false);
});

test('parseColor folds shorthand and separates alpha', () => {
  assert.deepEqual(parseColor('#abc'), { base: '#AABBCC', alpha: '', style: 'lower' });
  assert.deepEqual(parseColor('#abcd'), { base: '#AABBCC', alpha: 'DD', style: 'lower' });
  assert.deepEqual(parseColor('#F0873A'), { base: '#F0873A', alpha: '', style: 'upper' });
  assert.deepEqual(parseColor('#F0873ADD'), { base: '#F0873A', alpha: 'DD', style: 'upper' });
  assert.equal(parseColor('nope'), null);
});

test('formatColor writes the requested case style', () => {
  assert.equal(formatColor('#F0873A', '40', 'upper'), '#F0873A40');
  assert.equal(formatColor('#F0873A', '40', 'lower'), '#f0873a40');
  assert.equal(formatColor('#f0873a', '', 'upper'), '#F0873A');
});

test('indexTheme records offsets, paths and alpha for every literal', () => {
  const { occurrences } = indexTheme(FIXTURE);

  assert.equal(occurrences.length, 11);

  const background = occurrences.find((occurrence) => occurrence.pathString === 'colors.editor.background');
  assert.equal(background.raw, '#FCFCFC');
  assert.equal(background.base, '#FCFCFC');
  assert.equal(background.alpha, '');
  assert.equal(background.source, 'workbench');
  assert.equal(FIXTURE.slice(background.start, background.end), '#FCFCFC');

  const hover = occurrences.find((occurrence) => occurrence.pathString === 'colors.button.hoverBackground');
  assert.equal(hover.base, '#F0873A');
  assert.equal(hover.alpha, 'DD');
});

test('indexTheme reaches into nested tokenColors settings', () => {
  const { occurrences } = indexTheme(FIXTURE);

  const nested = occurrences.find((occurrence) => occurrence.pathString === 'tokenColors.0.settings.foreground');
  assert.equal(nested.raw, '#ABB0B6');
  assert.equal(nested.source, 'syntax');

  const semantic = occurrences.find((occurrence) => occurrence.pathString === 'semanticTokenColors.comment.foreground');
  assert.equal(semantic.source, 'semantic');
});

test('indexTheme ignores array scope strings that are not colors', () => {
  const { occurrences } = indexTheme(FIXTURE);
  assert.equal(occurrences.some((occurrence) => occurrence.pathString === 'tokenColors.0.scope.0'), false);
});

test('buildPalette ranks the accent above single-use colors', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const palette = buildPalette(occurrences);

  assert.equal(palette[0].base, '#F0873A');
  assert.equal(palette[0].uses, 5);
  assert.deepEqual(palette[0].alphas, ['', 'DD']);

  const neutral = palette.find((entry) => entry.base === '#ABB0B6');
  assert.equal(neutral.uses, 2);
});

test('ripple rewrites every use of a base color and preserves alpha', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const edits = buildRippleEdits(occurrences, '#F0873A', '#00A3FF');
  const updated = JSON.parse(applyEditsToText(FIXTURE, edits));

  assert.equal(updated.colors['button.background'], '#00A3FF');
  assert.equal(updated.colors['button.hoverBackground'], '#00A3FFDD');
  assert.equal(updated.colors['list.highlightForeground'], '#00A3FF');
  assert.equal(updated.colors['tab.activeBorderTop'], '#00A3FF');
  assert.equal(updated.tokenColors[1].settings.foreground, '#00A3FF');
  assert.equal(updated.colors.foreground, '#54595E');
});

test('ripple preserves lowercase style of the literal it replaces', () => {
  const text = '{"colors":{"a.background":"#f0873a","b.background":"#f0873a40"}}';
  const { occurrences } = indexTheme(text);
  const edits = buildRippleEdits(occurrences, '#f0873a', '#00a3ff');

  assert.equal(applyEditsToText(text, edits), '{"colors":{"a.background":"#00a3ff","b.background":"#00a3ff40"}}');
});

test('ripple of an unknown base color is a no-op', () => {
  const { occurrences } = indexTheme(FIXTURE);
  assert.deepEqual(buildRippleEdits(occurrences, '#123456', '#00A3FF'), []);
});

test('ripple leaves formatting, key order and unrelated keys untouched', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const edits = buildRippleEdits(occurrences, '#F0873A', '#00A3FF');
  const updated = applyEditsToText(FIXTURE, edits);

  assert.equal(updated.split('\n').length, FIXTURE.split('\n').length);
  assert.ok(updated.startsWith('{\n  "$schema"'));
  assert.ok(updated.includes('"type": "light"'));
  assert.ok(updated.includes('"fontStyle": "italic"'));
});

test('every index offset round-trips to the original literal', () => {
  const { occurrences } = indexTheme(FIXTURE);

  for (const occurrence of occurrences) {
    assert.equal(FIXTURE.slice(occurrence.start, occurrence.end), occurrence.raw);
  }
});

test('survives escaped quotes and unicode escapes outside color literals', () => {
  const text = '{"colors":{"weird\\"key":"#ABCDEF"},"note":"\\u00e9 #FFFFFF"}';
  const { occurrences } = indexTheme(text);

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].base, '#ABCDEF');
  assert.equal(occurrences[0].path[1], 'weird"key');
  assert.equal(text.slice(occurrences[0].start, occurrences[0].end), '#ABCDEF');
});

test('replacing a literal keeps the document valid JSON', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const updated = applyEditsToText(FIXTURE, buildRippleEdits(occurrences, '#F0873A', '#00A3FF'));

  assert.doesNotThrow(() => JSON.parse(updated));
  assert.ok(updated.includes('"button.background": "#00A3FF"'));
  assert.ok(updated.includes('"button.hoverBackground": "#00A3FFDD"'));
});

test('parses the real daylight theme when it is available', (t) => {
  const themePath = '/Users/amrit/fractalmandala/fractaldev/daylight-bone-signal-color-theme.json';

  if (!fs.existsSync(themePath)) {
    t.skip('daylight theme not present');
    return;
  }

  const text = fs.readFileSync(themePath, 'utf8');
  const { occurrences } = indexTheme(text);
  const parsed = JSON.parse(text);

  assert.equal(occurrences.length > 0, true);
  assert.equal(parsed.type, 'light');

  for (const occurrence of occurrences) {
    assert.equal(text.slice(occurrence.start, occurrence.end), occurrence.raw);
  }

  const palette = buildPalette(occurrences);
  const accent = palette.find((entry) => entry.base === '#F0873A');

  assert.ok(accent, 'expected the accent color to be indexed');
  assert.equal(accent.uses > 20, true);

  const updated = JSON.parse(applyEditsToText(text, buildRippleEdits(occurrences, '#F0873A', '#00A3FF')));
  assert.equal(updated.colors.focusBorder, '#00A3FF');
  assert.equal(updated.colors['selection.background'], '#00A3FF40');
  assert.equal(updated.type, 'light');
  assert.deepEqual(updated.semanticTokenColors.comment, { foreground: '#ABB0B6', fontStyle: 'italic' });
  assert.equal(path.basename(themePath), 'daylight-bone-signal-color-theme.json');
});
