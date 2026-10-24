/**
 * The saved-colours file: a JSON array of `{ hex, rgba, oklch, name, class? }` objects.
 * Saving upserts by name; every other entry, and extra keys on the replaced one, stay as they were.
 */
import { DEFAULT_FORMAT, formatHex, formatOklch, num, toSrgbMapped, type FormatOptions, type Oklch } from '../src/color';

/** Uppercase hex, to match the canonical saved-colours file. */
export const FORMAT: FormatOptions = { ...DEFAULT_FORMAT, hexUpper: true };

export type Entry = Record<string, unknown> & {
  name?: string;
  class?: string;
  hex?: string;
  rgba?: string;
  oklch?: string;
};

export interface NewEntry {
  name: string;
  class?: string;
  hex: string;
  rgba: string;
  oklch: string;
}

/** Always `rgba(r, g, b, a)`, alpha included even when opaque. */
export function formatRgba(col: Oklch): string {
  const [r, g, b] = toSrgbMapped(col).rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `rgba(${r}, ${g}, ${b}, ${num(Math.min(1, Math.max(0, col.a)), 3)})`;
}

export function entryFor(col: Oklch, name: string, cls: string, format: FormatOptions): NewEntry {
  const entry: NewEntry = { name, hex: formatHex(col, format), rgba: formatRgba(col), oklch: formatOklch(col) };
  if (cls) entry.class = cls;
  return entry;
}

/** Parses file text. Empty is an empty list; anything but an array throws, so it is never overwritten. */
export function parseEntries(text: string): Entry[] {
  if (!text.trim()) return [];
  const value = JSON.parse(text);
  if (!Array.isArray(value)) throw new Error('the file is not a JSON array');
  return value;
}

export function serialize(list: Entry[]): string {
  return JSON.stringify(list, null, 2) + '\n';
}

/**
 * Adds `entry`, or updates the one with the same name in place (keeping its key order and extra
 * keys). A blank class leaves an existing entry's class as it was.
 */
export function upsert(list: Entry[], entry: NewEntry): Entry[] {
  const next = list.map((e) => (e && typeof e === 'object' ? { ...e } : e));
  const existing = next.find((e) => e && typeof e === 'object' && e.name === entry.name);
  if (existing) {
    existing.hex = entry.hex;
    existing.rgba = entry.rgba;
    existing.oklch = entry.oklch;
    if (entry.class) existing.class = entry.class;
    return next;
  }
  const fresh: Entry = { hex: entry.hex, rgba: entry.rgba, oklch: entry.oklch, name: entry.name };
  if (entry.class) fresh.class = entry.class;
  next.push(fresh);
  return next;
}
