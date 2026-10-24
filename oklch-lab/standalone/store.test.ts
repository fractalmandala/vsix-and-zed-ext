import { expect, test } from 'bun:test';
import { parseColor } from '../src/color';
import { FORMAT, entryFor, parseEntries, serialize, upsert } from './store';

const white = parseColor('#ffffff')!;

test('entries match the canonical file format', () => {
  expect(entryFor(white, 'pure-white', 'surfaces', FORMAT)).toEqual({
    name: 'pure-white',
    class: 'surfaces',
    hex: '#FFFFFF',
    rgba: 'rgba(255, 255, 255, 1)',
    oklch: 'oklch(1 0 0)',
  });
  const half = parseColor('rgba(0, 0, 0, 0.5)')!;
  expect(entryFor(half, 'shade', '', FORMAT)).toEqual({
    name: 'shade',
    hex: '#00000080',
    rgba: 'rgba(0, 0, 0, 0.5)',
    oklch: 'oklch(0 0 0 / 0.5)',
  });
});

test('a new entry is appended with the file key order', () => {
  const list = upsert([], entryFor(white, 'pure-white', '', FORMAT));
  expect(serialize(list)).toBe(
    '[\n  {\n    "hex": "#FFFFFF",\n    "rgba": "rgba(255, 255, 255, 1)",\n    "oklch": "oklch(1 0 0)",\n    "name": "pure-white"\n  }\n]\n'
  );
});

test('saving an existing name updates it in place and leaves others alone', () => {
  const original = parseEntries(`[
  { "hex": "#FFFFFF", "rgba": "rgb(255, 255, 255, 100) ", "oklch": "oklch(1 0 0)", "name": "pure-white", "class": "surfaces", "note": "kept" },
  { "hex": "#000000", "name": "ink" }
]`);
  const grey = parseColor('#808080')!;
  const next = upsert(original, entryFor(grey, 'pure-white', '', FORMAT));
  expect(Object.keys(next[0])).toEqual(['hex', 'rgba', 'oklch', 'name', 'class', 'note']);
  expect(next[0].hex).toBe('#808080');
  // A blank class keeps the old one; a new class replaces it.
  expect(next[0].class).toBe('surfaces');
  expect(upsert(next, entryFor(grey, 'pure-white', 'greys', FORMAT))[0].class).toBe('greys');
  expect(next[1]).toEqual({ hex: '#000000', name: 'ink' });
  // The input list is not mutated.
  expect(original[0].hex).toBe('#FFFFFF');
});

test('text that is not an array is rejected', () => {
  expect(parseEntries('  ')).toEqual([]);
  expect(() => parseEntries('{ "a": 1 }')).toThrow();
  expect(() => parseEntries('{ "half": ')).toThrow();
});
