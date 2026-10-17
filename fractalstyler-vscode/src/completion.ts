import * as vscode from 'vscode';
import { ClassEntry, ClassRegistry } from './registry';

/**
 * Languages whose markup we complete inside. Svelte reports as `svelte` when
 * the Svelte extension is installed and as `html` otherwise, so both are
 * listed; the others are the same shapes.
 */
export const SUPPORTED_LANGUAGES = [
  'html',
  'svelte',
  'vue',
  'astro',
  'javascriptreact',
  'typescriptreact',
  'angular'
];

const TRIGGER_CHARS = ['"', "'", ' ', '\t'];

/**
 * True when the cursor sits inside the quotes of a class attribute, with
 * nothing else on the line after it.
 *
 *   class="ca|        -> yes
 *   class='row |      -> yes
 *   className={`row | -> yes
 *   <div className={styles.foo}>  -> no
 *   data-variant="primary"        -> no
 */
export function insideClassAttribute(lineBeforeCursor: string): boolean {
  // The attribute may be written class=, className=, :class=, or inside {}.
  const openers: RegExp[] = [
    /(?<![\w-])(?:class|className|:class|class:)\s*=\s*(?:\{)?\s*$/,
    // Allow a brace between = and the quote so `className={`row ` matches too.
    /(?:class|className|:class|class:)\s*=\s*\{?\s*["'`]([^"'`]*)$/,
    /["'`]\s*(?:class|className|:class|class:)\s*=\s*(?:\{)?\s*$/,
    /\sclass\s*=\s*\{[^}]*$/,
    /\sclass:\s*["'][^"']*$/
  ];
  return openers.some((re) => re.test(lineBeforeCursor));
}

/** The word fragment already typed, used to seed the filter text. */
export function currentWord(lineBeforeCursor: string): string {
  const match = /([\w-]+)$/.exec(lineBeforeCursor);
  return match ? match[1] : '';
}

/**
 * True when the character at `index` in `line` is inside a class attribute's
 * value — i.e. an attribute opener appears before it and no closing quote has
 * been typed since. Used for hover, where the word sits *inside* an already
 * closed-looking string.
 */
export function inClassAttributeAt(line: string, index: number): boolean {
  const before = line.slice(0, index);
  const opener = /(?<![\w-])(?:class|className|:class|class:)\s*=\s*(?:\{)?\s*["'`]?/g;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(before)) !== null) {
    last = m;
  }
  if (!last) {
    return false;
  }
  // A quote typed after the opener means the attribute already closed.
  return !/["'`]/.test(before.slice(last.index + last[0].length));
}

/** Classes already present in the same attribute, so we can flag duplicates. */
export function classesInAttribute(lineBeforeCursor: string): Set<string> {
  const match = /(?:class|className|:class|class:)\s*=\s*(?:\{)?\s*["'`]([^"'`]*)$/.exec(
    lineBeforeCursor
  );
  const body = match ? match[1] : '';
  return new Set(
    body
      .split(/\s+/)
      .map((c) => c.trim())
      .filter(Boolean)
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'family':
      return 'family';
    case 'modifier':
      return 'modifier';
    case 'variant':
      return 'variant';
    case 'child':
      return 'child';
    case 'compound':
      return 'compound';
    case 'element':
      return 'element';
    default:
      return 'class';
  }
}

function buildItem(entry: ClassEntry, alreadyUsed: Set<string>): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Class);
  item.detail = entry.selector !== `.${entry.name}` ? entry.selector : undefined;
  item.insertText = entry.name;
  // family | modifier | variant -> match so `gap` surfaces `gap-xs`.
  item.filterText = entry.name;
  item.sortText = `${alreadyUsed.has(entry.name) ? '1' : '0'}${entry.name}`;
  item.documentation = new vscode.MarkdownString(hoverBody(entry));
  if (alreadyUsed.has(entry.name)) {
    item.detail = `${item.detail ? `${item.detail} · ` : ''}already in this class attribute`;
  }
  return item;
}

export function hoverBody(entry: ClassEntry): string {
  const lines: string[] = [];
  if (entry.description) {
    lines.push(entry.description);
  } else if (entry.property) {
    // Fall back to the declaration when the class carries no description.
    lines.push('```sass', entry.property, '```');
  } else {
    lines.push('Fractalstyler class with no recorded description.');
  }

  if (entry.property && entry.description) {
    lines.push('', '```sass', entry.property, '```');
  }

  lines.push('', `*${entry.selector}* — ${kindLabel(entry.kind)}`);
  if (entry.layer) {
    lines.push(`Layer ${entry.layer} · \`${entry.file}\``);
  }
  if (entry.example) {
    lines.push('', entry.example.replace(/…/g, '…'));
  }
  return lines.join('\n\n');
}

export class ClassCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly registry: ClassRegistry) {}

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    const lineBefore = document.lineAt(position.line).text.slice(0, position.character);
    if (!insideClassAttribute(lineBefore)) {
      return [];
    }
    if (this.registry.size === 0) {
      return [];
    }

    const used = classesInAttribute(lineBefore);
    const typed = currentWord(lineBefore);
    const items: vscode.CompletionItem[] = [];
    for (const entry of this.registry.all()) {
      // Prefix filter — keeps the list small enough to be usable at 500+.
      if (typed && !entry.name.startsWith(typed)) {
        continue;
      }
      items.push(buildItem(entry, used));
    }
    return items;
  }
}

export class ClassHoverProvider implements vscode.HoverProvider {
  constructor(private readonly registry: ClassRegistry) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | null {
    const range = document.getWordRangeAtPosition(position, /[\w-]+/);
    if (!range) {
      return null;
    }
    const word = document.getText(range);
    if (!word) {
      return null;
    }
    // Only hover things that are actually inside a class attribute.
    const line = document.lineAt(position.line).text;
    if (!inClassAttributeAt(line, range.start.character)) {
      return null;
    }
    const entry = this.registry.get(word);
    if (!entry) {
      return null;
    }
    return new vscode.Hover(new vscode.MarkdownString(hoverBody(entry)), range);
  }
}

/**
 * Register the providers for every supported language. Passing a language
 * VS Code does not know about is harmless — it simply never matches.
 */
export function registerClassProviders(
  context: vscode.ExtensionContext,
  registry: ClassRegistry
): void {
  const selector: vscode.DocumentSelector = SUPPORTED_LANGUAGES.map((language) => ({ language }));
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, new ClassCompletionProvider(registry), ...TRIGGER_CHARS),
    vscode.languages.registerHoverProvider(selector, new ClassHoverProvider(registry))
  );
}