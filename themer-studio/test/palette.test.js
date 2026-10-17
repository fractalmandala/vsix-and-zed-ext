'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  assignRoles,
  buildContrastReport,
  contrastRatio,
  describeColor,
  roleForPaths,
  toHsl
} = require('../src/palette');
const { buildPalette, indexTheme } = require('../src/themeIndex');

const THEME_PATH = '/Users/amrit/fractalmandala/fractaldev/daylight-bone-signal-color-theme.json';

test('toHsl reads known colors correctly', () => {
  assert.deepEqual(toHsl('#FFFFFF'), { h: 0, s: 0, l: 100 });
  assert.deepEqual(toHsl('#000000'), { h: 0, s: 0, l: 0 });
  assert.deepEqual(toHsl('#FF0000'), { h: 0, s: 100, l: 50 });
});

test('contrastRatio spans the full 1 to 21 range', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF'), 21);
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
});

test('describeColor names neutrals and hues differently', () => {
  assert.equal(describeColor('#FCFCFC'), 'near white');
  assert.equal(describeColor('#000000'), 'near black');
  assert.equal(describeColor('#F0873A'), 'orange (58% light)');
  assert.match(describeColor('#3A7CA5'), /blue/);
});

test('roleForPaths prefers earlier rules when several could match', () => {
  assert.deepEqual(roleForPaths(['colors.focusBorder']), { role: 'accent', label: 'Accent' });
  assert.deepEqual(roleForPaths(['colors.editor.background']), { role: 'surface', label: 'Primary surface' });
  assert.deepEqual(roleForPaths(['colors.errorForeground']), { role: 'danger', label: 'Error / danger' });
  assert.equal(roleForPaths(['colors.something.unknown']), null);
});

test('roleForPaths ignores non-workbench paths when matching roles', () => {
  assert.equal(roleForPaths(['tokenColors.0.settings.foreground']), null);
});

test('assignRoles falls back to a described color for unassigned entries', () => {
  const palette = [
    { base: '#123456', uses: 1, alphaCount: 1, alphas: [''], sources: ['other'], paths: ['tokenColors.0.settings.foreground'] }
  ];
  const [entry] = assignRoles(palette);

  assert.equal(entry.role, 'unassigned');
  assert.equal(entry.roleLabel, 'Unassigned');
  assert.equal(entry.primaryPath, 'tokenColors.0.settings.foreground');
  assert.ok(entry.name.length > 0);
});

test('buildContrastReport flags surface against text and accent', () => {
  const report = buildContrastReport([
    { role: 'surface', base: '#FCFCFC' },
    { role: 'text', base: '#54595E' },
    { role: 'textMuted', base: '#A5AAB0' },
    { role: 'accent', base: '#F0873A' }
  ]);

  assert.equal(report.surface, '#FCFCFC');
  assert.ok(report.text.ratio > 6, 'body text should clear WCAG AA on the surface');
  assert.ok(report.accent.ratio < report.text.ratio, 'accent should be lower contrast than body text');
});

test('buildContrastReport returns null without a surface', () => {
  assert.equal(buildContrastReport([{ role: 'text', base: '#000000' }]), null);
});

test('roles resolve sensibly against the real daylight theme', (t) => {
  if (!fs.existsSync(THEME_PATH)) {
    t.skip('daylight theme not present');
    return;
  }

  const text = fs.readFileSync(THEME_PATH, 'utf8');
  const { occurrences } = indexTheme(text);
  const roles = assignRoles(buildPalette(occurrences));

  // A role can be filled by several base colors; the first wins because the
  // palette is ordered by usage, and the busiest color is the real role holder.
  const byRole = {};
  for (const entry of roles) {
    if (!(entry.role in byRole)) {
      byRole[entry.role] = entry;
    }
  }

  assert.equal(byRole.accent.base, '#F0873A');
  assert.equal(byRole.surface.base, '#FCFCFC');
  assert.equal(byRole.text.base, '#54595E');
  assert.equal(byRole.textMuted.base, '#A5AAB0');
  assert.equal(byRole.border.base, '#E2E4E6');
  assert.equal(byRole.surfaceAlt.base, '#F0F1F2');
  assert.equal(byRole.danger.base, '#E65050');
  assert.equal(byRole.warning.base, '#E6A700');
  assert.equal(byRole.success.base, '#4CA750');
  assert.equal(byRole.info.base, '#399EE6');

  const report = buildContrastReport(roles);
  assert.equal(report.surface, '#FCFCFC');
  assert.ok(report.text.ratio > 6);
  assert.ok(report.muted.ratio > 2);
});
