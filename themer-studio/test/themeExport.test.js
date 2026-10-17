'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInstallTarget,
  buildThemeExtensionManifest,
  extensionDirectoryName,
  parseThemeText,
  slugify,
  themeFileName,
  uiThemeFor,
  withName
} = require('../src/themeExport');

test('slugify produces extension-safe names', () => {
  assert.equal(slugify('Daylight Bone Signal'), 'daylight-bone-signal');
  assert.equal(slugify('  Weird // Name!  '), 'weird-name');
  assert.equal(slugify(''), '');
});

test('uiThemeFor maps theme type onto a VS Code base theme', () => {
  assert.equal(uiThemeFor('light'), 'vs');
  assert.equal(uiThemeFor('dark'), 'vs-dark');
  assert.equal(uiThemeFor('hc-light'), 'hc-light');
  assert.equal(uiThemeFor('hc-black'), 'hc-black');
  assert.equal(uiThemeFor(undefined), 'vs-dark');
});

test('themeFileName derives from the label', () => {
  assert.equal(themeFileName('Daylight Bone Signal'), 'daylight-bone-signal-color-theme.json');
});

test('withName rewrites an existing name in place and leaves the rest alone', () => {
  const original = '{\n  "name": "Old Name",\n  "type": "light",\n  "colors": {}\n}\n';
  const updated = withName(original, 'New Name');

  assert.equal(updated, '{\n  "name": "New Name",\n  "type": "light",\n  "colors": {}\n}\n');
  assert.equal(updated.split('\n').length, original.split('\n').length);
  assert.ok(updated.indexOf('"name"') < updated.indexOf('"type"'));
});

test('withName inserts a name when the theme has none', () => {
  const updated = withName('{\n  "type": "dark",\n  "colors": {}\n}', 'Fresh');
  const parsed = JSON.parse(updated);

  assert.equal(parsed.name, 'Fresh');
  assert.equal(parsed.type, 'dark');
  assert.ok(updated.startsWith('{\n  "name": "Fresh",\n  "type": "dark"'));
});

test('withName handles an empty theme object', () => {
  const parsed = JSON.parse(withName('{}', 'Empty'));
  assert.deepEqual(parsed, { name: 'Empty' });
});

test('withName throws on input with no object', () => {
  assert.throws(() => withName('[]', 'Nope'), /no object/);
});

test('buildThemeExtensionManifest produces an installable theme contribution', () => {
  const manifest = buildThemeExtensionManifest({
    label: 'Daylight Bone Signal',
    themeType: 'light',
    themeFileName: 'daylight-bone-signal-color-theme.json'
  });

  assert.equal(manifest.name, 'daylight-bone-signal');
  assert.equal(manifest.publisher, 'fractal-theme-studio');
  assert.equal(manifest.engines.vscode, '^1.60.0');
  assert.deepEqual(manifest.contributes.themes, [
    {
      label: 'Daylight Bone Signal',
      uiTheme: 'vs',
      path: './themes/daylight-bone-signal-color-theme.json'
    }
  ]);
  assert.deepEqual(manifest.categories, ['Themes']);
});

test('buildInstallTarget points inside the extensions directory', () => {
  const manifest = buildThemeExtensionManifest({
    label: 'Daylight Bone Signal',
    themeType: 'light',
    themeFileName: 'daylight-bone-signal-color-theme.json'
  });
  const target = buildInstallTarget({ manifest, homedir: '/home/tester' });

  assert.equal(extensionDirectoryName(manifest), 'fractal-theme-studio.daylight-bone-signal-1.0.0');
  assert.equal(target.directory, '/home/tester/.vscode/extensions/fractal-theme-studio.daylight-bone-signal-1.0.0');
  assert.equal(target.packageJsonPath, `${target.directory}/package.json`);
  assert.equal(target.themePath, `${target.directory}/themes/daylight-bone-signal-color-theme.json`);
});

test('parseThemeText rejects values that are not an object', () => {
  assert.deepEqual(parseThemeText('{"a":1}'), { a: 1 });
  assert.throws(() => parseThemeText('"nope"'), /must contain an object/);
});
