'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { buildGroups, indexTheme, workbenchParts } = require('../src/themeIndex');
const { buildStudioState } = require('../src/state');

const THEME_PATH = '/Users/amrit/fractalmandala/fractaldev/daylight-bone-signal-color-theme.json';

const FIXTURE = JSON.stringify(
  {
    name: 'Grouping Fixture',
    type: 'dark',
    colors: {
      foreground: '#DDDDDD',
      'editor.background': '#111111',
      'editorCursor.foreground': '#FFAA00',
      'sideBar.background': '#181818'
    },
    semanticTokenColors: {
      type: '#00AAFF',
      comment: { foreground: '#888888', fontStyle: 'italic' }
    },
    tokenColors: [
      { name: 'Comment', scope: ['comment'], settings: { foreground: '#888888', fontStyle: 'italic' } },
      { name: 'Keyword', scope: ['keyword'], settings: { foreground: '#FFAA00' } }
    ]
  },
  null,
  2
);

test('workbenchParts splits group from leaf for namespaced keys', () => {
  assert.deepEqual(workbenchParts('colors.editor.background'), { group: 'editor', label: 'background' });
  assert.deepEqual(workbenchParts('colors.sideBarSectionHeader.background'), {
    group: 'sideBarSectionHeader',
    label: 'background'
  });
  assert.deepEqual(workbenchParts('colors.foreground'), { group: 'General', label: 'foreground' });
});

test('buildGroups buckets workbench colours by namespace', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const groups = buildGroups(occurrences, JSON.parse(FIXTURE));

  // editorCursor is its own top-level namespace in the theme schema, so it does
  // not fold into editor.
  assert.deepEqual(
    groups.workbench.map((group) => group.name),
    ['Editor', 'Editor Cursor', 'General', 'Side Bar']
  );

  const labelsFor = (name) => groups.workbench.find((group) => group.name === name).entries.map((entry) => entry.label);

  assert.deepEqual(labelsFor('Editor'), ['background']);
  assert.deepEqual(labelsFor('Editor Cursor'), ['foreground']);
  assert.deepEqual(labelsFor('General'), ['foreground']);
  assert.deepEqual(labelsFor('Side Bar'), ['background']);

  const editor = groups.workbench.find((group) => group.name === 'Editor');
  assert.ok(editor.entries.every((entry) => typeof entry.start === 'number'));
});

test('buildGroups names syntax groups from their tokenColors rule', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const groups = buildGroups(occurrences, JSON.parse(FIXTURE));

  assert.deepEqual(groups.syntax.map((group) => group.name), ['Comment', 'Keyword']);
  assert.equal(groups.syntax[0].entries[0].label, 'foreground');
  assert.equal(groups.syntax[1].entries[0].color, '#FFAA00');
});

test('buildGroups falls back for unnamed syntax rules', () => {
  const text = '{"tokenColors":[{"scope":["x"],"settings":{"foreground":"#ABCDEF"}}]}';
  const { occurrences } = indexTheme(text);
  const groups = buildGroups(occurrences, JSON.parse(text));

  assert.equal(groups.syntax[0].name, 'Rule 1');
});

test('buildGroups keeps semantic tokens in one list', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const groups = buildGroups(occurrences, JSON.parse(FIXTURE));

  assert.equal(groups.semantic.length, 1);
  assert.deepEqual(groups.semantic[0].entries.map((entry) => entry.label).sort(), ['comment.foreground', 'type']);
});

test('group entry offsets point back at the literal they describe', () => {
  const { occurrences } = indexTheme(FIXTURE);
  const groups = buildGroups(occurrences, JSON.parse(FIXTURE));

  for (const group of groups.workbench.concat(groups.syntax, groups.semantic)) {
    for (const entry of group.entries) {
      assert.equal(FIXTURE.slice(entry.start, entry.start + entry.color.length), entry.color);
    }
  }
});

test('buildStudioState produces the shape the webview renders', () => {
  const state = buildStudioState({ text: FIXTURE, fileName: 'fixture.json', dirty: true, previewing: false });

  assert.equal(state.type, 'state');
  assert.equal(state.themeName, 'Grouping Fixture');
  assert.equal(state.themeType, 'dark');
  assert.equal(state.fileName, 'fixture.json');
  assert.equal(state.dirty, true);
  assert.equal(state.occurrenceCount, 8);
  assert.ok(Array.isArray(state.palette));
  assert.ok(state.palette.every((entry) => typeof entry.name === 'string' && typeof entry.role === 'string'));
  assert.ok(state.groups.workbench.length > 0);
  assert.equal(state.contrast.surface, '#111111');
});

test('buildStudioState tolerates a theme with no name or type', () => {
  const state = buildStudioState({ text: '{"colors":{"editor.background":"#101010"}}' });

  assert.equal(state.themeName, 'Untitled theme');
  assert.equal(state.themeType, 'dark');
  assert.equal(state.occurrenceCount, 1);
});

test('buildStudioState against the real daylight theme', (t) => {
  if (!fs.existsSync(THEME_PATH)) {
    t.skip('daylight theme not present');
    return;
  }

  const text = fs.readFileSync(THEME_PATH, 'utf8');
  const state = buildStudioState({ text, fileName: 'daylight-bone-signal-color-theme.json' });

  assert.equal(state.themeName, 'Daylight Bone Signal');
  assert.equal(state.themeType, 'light');
  assert.equal(state.occurrenceCount, 299);
  assert.equal(state.palette.length, 16);

  const accented = state.palette.find((entry) => entry.role === 'accent');
  assert.equal(accented.base, '#F0873A');
  assert.equal(accented.uses, 43);
  assert.equal(accented.alphaCount, 13);

  // 251 workbench keys + 28 syntax colours + 20 semantic colours = 299.
  // tokenColors has 30 rules, but "Markdown emphasis" and "Markdown strong" only
  // set fontStyle, so they contribute no colour and therefore no group.
  // semanticTokenColors has 21 entries, but "*.deprecated" is strikethrough only.
  assert.equal(state.groups.syntax.length, 28);
  assert.equal(state.groups.semantic[0].entries.length, 20);
  assert.ok(state.groups.workbench.length >= 20);

  const totalGrouped =
    state.groups.workbench.reduce((total, group) => total + group.entries.length, 0) +
    state.groups.syntax.reduce((total, group) => total + group.entries.length, 0) +
    state.groups.semantic.reduce((total, group) => total + group.entries.length, 0);

  assert.equal(totalGrouped, 299);
});
