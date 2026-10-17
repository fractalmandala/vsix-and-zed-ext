import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/**
 * One completable class name, reduced from a registry row.
 *
 * The registry stores selectors, not class-attribute tokens: `.card`,
 * `.gap-xs`, `.row.xcenter`, `.card[data-variant="primary"]`, `a.btn`,
 * `button`. Only the first two forms are things you type inside `class="…"`, so
 * everything else is either reduced to its modifier segment or dropped.
 */
export interface ClassEntry {
  /** Bare token as typed in markup — `card`, `gap-xs`, `xcenter`. */
  name: string;
  /** The original selector, shown as the detail line. */
  selector: string;
  kind: string;
  layer: string;
  file: string;
  property: string;
  description: string;
  example: string;
}

/**
 * Reduce a registry selector to a class-attribute token, or null when the
 * selector is not something you would ever type in a class attribute.
 *
 *   .card                              -> card
 *   .gap-xs                            -> gap-xs
 *   .row.xcenter                       -> xcenter        (modifier of .row)
 *   a.btn                              -> btn            (element + class)
 *   button                             -> null           (bare element)
 *   .card[data-variant="primary"]      -> null           (attribute variant)
 *   .app-shell.open .sidebar-left      -> null           (compound/descendant)
 */
export function tokenFor(selector: string): string | null {
  // Descendant or compound chains ("A B") are never a single class token.
  if (/\s/.test(selector)) {
    return null;
  }
  // Attribute variants are set by the presets, not typed.
  if (selector.includes('[')) {
    return null;
  }
  // Pseudo-classes/states carry no completion value.
  if (selector.includes(':')) {
    return null;
  }

  const parts = selector.split('.');
  // Drop the first segment: it is '' for a pure class, or an element name for
  // `a.btn` / `button.icon` / `button`.
  const classes = parts.slice(1);

  if (classes.length === 0) {
    // Bare element like `button`.
    return null;
  }
  // `.row.xcenter`, `button.icon`, `a.primary.modern` — the trailing segment is
  // what you type last and what a user means to reach for.
  return classes[classes.length - 1];
}

/** Layer label -> human reading, for the completion detail. */
function layerName(layer: string): string {
  const map: Record<string, string> = {
    L0: 'L0 tokens & base',
    L1: 'L1 dimensions',
    L2: 'L2 containers',
    L3: 'L3 layouts',
    L4: 'L4 shells',
    L5: 'L5 visuals & interactions',
    Custom: 'custom'
  };
  return map[layer] ?? layer;
}

/**
 * Walk up from the styles folder looking for registry.json. Covers the three
 * layouts we care about:
 *   src/lib/styles              -> up 3 = package root
 *   node_modules/@fractaldesign/fractalstyler/dist/styles -> up 2 = pkg root
 *   an ejected copy              -> project root, if the user regenerated it
 */
export function findRegistryUpward(dir: string): string | null {
  let current = dir;
  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = path.join(current, 'registry.json');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}

export class ClassRegistry {
  private entries = new Map<string, ClassEntry>();
  private loadedFrom = '';
  private classCount = 0;

  /** Where the registry was read from — shown in the hover/status. */
  public get source(): string {
    return this.loadedFrom;
  }

  public get size(): number {
    return this.classCount;
  }

  public all(): ClassEntry[] {
    return [...this.entries.values()];
  }

  public get(name: string): ClassEntry | undefined {
    return this.entries.get(name);
  }

  public has(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * Load the registry, preferring a project-local copy over the bundled one.
   *
   * The bundled copy is refreshed by `npm run sync:registry` at release time,
   * so it is correct for the package version the user installed. A registry.json
   * found next to the project's styles folder is newer still (an ejected copy
   * being edited in place) and wins.
   */
  public load(extensionUri: vscode.Uri, stylesDir: string): boolean {
    const local = stylesDir ? findRegistryUpward(stylesDir) : null;
    const bundled = path.join(extensionUri.fsPath, 'media', 'registry.json');

    const chosen = local ?? (fs.existsSync(bundled) ? bundled : null);
    if (!chosen) {
      return false;
    }
    try {
      const rows = JSON.parse(fs.readFileSync(chosen, 'utf8'));
      this.ingest(Array.isArray(rows) ? rows : []);
      this.loadedFrom = local ? `${chosen} (project)` : `${chosen} (bundled)`;
      return true;
    } catch {
      return false;
    }
  }

  private ingest(rows: any[]): void {
    this.entries.clear();
    this.classCount = 0;
    for (const row of rows) {
      const selector: string = row?.class ?? '';
      const token = tokenFor(selector);
      if (!token) {
        continue;
      }
      const description: string = row?.description ?? '';
      // The registry falls back to echoing the first declaration when a class
      // has no `// description` comment — that is not worth showing on hover.
      const useful =
        description && description !== row?.property && !/^\s*[a-z-]+:/.test(description)
          ? description
          : '';
      const entry: ClassEntry = {
        name: token,
        selector,
        kind: row?.kind ?? 'class',
        layer: row?.layer ?? '',
        file: row?.file ?? '',
        property: row?.property ?? '',
        description: useful,
        example: row?.example ?? ''
      };
      const existing = this.entries.get(token);
      // Keep the richest row: one with a real description wins.
      if (!existing || (!existing.description && entry.description)) {
        this.entries.set(token, entry);
      }
    }
    this.classCount = this.entries.size;
  }
}