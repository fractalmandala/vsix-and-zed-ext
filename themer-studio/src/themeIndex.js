'use strict';

const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function isColorLiteral(value) {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

function expandShorthand(hex) {
  return hex
    .split('')
    .map((character) => character + character)
    .join('');
}

/**
 * Split a hex literal into its upper-case base color and its alpha suffix.
 * Supports #RGB, #RGBA, #RRGGBB and #RRGGBBAA.
 */
function parseColor(raw) {
  if (!isColorLiteral(raw)) {
    return null;
  }

  const digits = raw.slice(1);
  const expanded = digits.length === 3 || digits.length === 4 ? expandShorthand(digits) : digits;
  const base = `#${expanded.slice(0, 6).toUpperCase()}`;
  const alpha = expanded.length === 8 ? expanded.slice(6).toUpperCase() : '';
  const usesLowerCase = /[a-f]/.test(digits);

  return { base, alpha, style: usesLowerCase ? 'lower' : 'upper' };
}

function formatColor(base, alpha = '', style = 'upper') {
  const body = `${base.replace('#', '')}${alpha}`.toUpperCase();
  return style === 'lower' ? `#${body.toLowerCase()}` : `#${body}`;
}

function classifyPath(path) {
  const head = path[0];

  if (head === 'colors') {
    return 'workbench';
  }
  if (head === 'tokenColors') {
    return 'syntax';
  }
  if (head === 'semanticTokenColors') {
    return 'semantic';
  }
  return 'other';
}

function readString(text, start) {
  let index = start + 1;
  let value = '';

  while (index < text.length) {
    const character = text[index];

    if (character === '\\') {
      const escape = text[index + 1];
      switch (escape) {
        case 'n': value += '\n'; break;
        case 'r': value += '\r'; break;
        case 't': value += '\t'; break;
        case 'b': value += '\b'; break;
        case 'f': value += '\f'; break;
        case 'u': value += String.fromCharCode(parseInt(text.slice(index + 2, index + 6), 16)); index += 4; break;
        default: value += escape;
      }
      index += 2;
      continue;
    }

    if (character === '"') {
      return { value, start, end: index + 1, contentStart: start + 1, contentEnd: index };
    }

    value += character;
    index += 1;
  }

  throw new Error('Unterminated string literal in theme JSON.');
}

function skipWhitespace(text, start) {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index;
}

function advanceArrayIndex(stack) {
  const top = stack[stack.length - 1];
  if (top && top.type === 'array') {
    top.index += 1;
  }
}

function pathOf(stack) {
  return stack.map((frame) => (frame.type === 'object' ? (frame.key === null ? '' : frame.key) : String(frame.index)));
}

/**
 * Scan theme JSON text and record every color literal with its exact range and
 * its position in the document. Ranges cover the literal's contents only, never
 * the surrounding quotes, so replacing one keeps the document valid. Formatting
 * is never rewritten because we only report ranges; substitution happens later
 * on those ranges alone.
 */
function indexTheme(text) {
  const occurrences = [];
  const stack = [];
  let index = 0;

  while (index < text.length) {
    const character = text[index];

    if (character === '{' || character === '[') {
      stack.push({ type: character === '{' ? 'object' : 'array', key: null, index: 0 });
      index += 1;
      continue;
    }

    if (character === '}' || character === ']') {
      stack.pop();
      advanceArrayIndex(stack);
      index += 1;
      continue;
    }

    if (character === '"') {
      const { value, end, contentStart, contentEnd } = readString(text, index);
      const isKey = text[skipWhitespace(text, end)] === ':';
      const frame = stack[stack.length - 1];

      if (isKey) {
        if (frame && frame.type === 'object') {
          frame.key = value;
        }
      } else if (isColorLiteral(value)) {
        const path = pathOf(stack);
        const parsed = parseColor(value);

        occurrences.push({
          start: contentStart,
          end: contentEnd,
          path,
          pathString: path.join('.'),
          source: classifyPath(path),
          raw: value,
          base: parsed.base,
          alpha: parsed.alpha,
          style: parsed.style
        });

        advanceArrayIndex(stack);
      } else {
        advanceArrayIndex(stack);
      }

      index = end;
      continue;
    }

    index += 1;
  }

  return { occurrences, byBase: groupByBase(occurrences) };
}

function groupByBase(occurrences) {
  const groups = new Map();

  for (const occurrence of occurrences) {
    if (!groups.has(occurrence.base)) {
      groups.set(occurrence.base, {
        base: occurrence.base,
        style: occurrence.style,
        uses: 0,
        alphas: new Set(),
        sources: new Set(),
        paths: []
      });
    }

    const group = groups.get(occurrence.base);
    group.uses += 1;
    group.alphas.add(occurrence.alpha);
    group.sources.add(occurrence.source);
    group.paths.push(occurrence.pathString);
  }

  return groups;
}

/**
 * The palette: base colors ordered by how much of the theme they drive.
 */
function buildPalette(occurrences) {
  return [...groupByBase(occurrences).values()]
    .map((group) => ({
      base: group.base,
      style: group.style,
      uses: group.uses,
      alphaCount: group.alphas.size,
      alphas: [...group.alphas].sort(),
      sources: [...group.sources].sort(),
      paths: group.paths
    }))
    .sort((left, right) => right.uses - left.uses || left.base.localeCompare(right.base));
}

function buildRippleEdits(occurrences, fromBase, toColor) {
  const target = parseColor(toColor);
  if (!target) {
    return [];
  }

  const from = fromBase.toUpperCase();
  const edits = [];

  for (const occurrence of occurrences) {
    if (occurrence.base !== from) {
      continue;
    }

    edits.push({
      start: occurrence.start,
      end: occurrence.end,
      text: formatColor(target.base, occurrence.alpha, occurrence.style),
      pathString: occurrence.pathString
    });
  }

  return edits;
}

/**
 * Edits for a single key, used when a token is pinned and should no longer
 * follow its base color.
 */
function buildOverrideEdits(occurrences, editsByPath) {
  const edits = [];

  for (const occurrence of occurrences) {
    const requested = editsByPath[occurrence.pathString];
    if (!requested) {
      continue;
    }

    const target = parseColor(requested);
    if (!target) {
      continue;
    }

    edits.push({
      start: occurrence.start,
      end: occurrence.end,
      text: formatColor(target.base, target.alpha === '' ? occurrence.alpha : target.alpha, occurrence.style),
      pathString: occurrence.pathString
    });
  }

  return edits;
}

function toLabel(value) {
  return String(value)
    .replace(/^colors\./, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function workbenchParts(pathString) {
  const rest = pathString.startsWith('colors.') ? pathString.slice('colors.'.length) : pathString;
  const parts = rest.split('.');

  return {
    group: parts.length > 1 ? parts[0] : 'General',
    label: parts.length > 1 ? parts.slice(1).join('.') : rest
  };
}

/**
 * Group occurrences for the drill-down views: workbench colors by their top
 * level namespace, syntax colors by their rule name, semantic colors as one
 * list. Entries carry their offsets so the UI can jump back to the source.
 */
function buildGroups(occurrences, theme = {}) {
  const workbench = new Map();
  const syntax = new Map();
  const semantic = [];

  for (const occurrence of occurrences) {
    const entry = {
      pathString: occurrence.pathString,
      color: occurrence.raw,
      base: occurrence.base,
      alpha: occurrence.alpha,
      start: occurrence.start
    };

    if (occurrence.source === 'workbench') {
      const { group, label } = workbenchParts(occurrence.pathString);

      if (!workbench.has(group)) {
        workbench.set(group, []);
      }
      workbench.get(group).push({ ...entry, label });
      continue;
    }

    if (occurrence.source === 'syntax') {
      const index = Number(occurrence.path[1]);
      const rule = Array.isArray(theme.tokenColors) ? theme.tokenColors[index] : null;
      const name = (rule && rule.name) || `Rule ${index + 1}`;
      const label = occurrence.path[occurrence.path.length - 1] || 'foreground';

      if (!syntax.has(name)) {
        syntax.set(name, []);
      }
      syntax.get(name).push({ ...entry, label });
      continue;
    }

    if (occurrence.source === 'semantic') {
      semantic.push({ ...entry, label: occurrence.pathString.replace(/^semanticTokenColors\./, '') });
    }
  }

  const toGroup = ([name, entries]) => ({ name: toLabel(name), entries });

  return {
    workbench: [...workbench.entries()].map(toGroup).sort((left, right) => left.name.localeCompare(right.name)),
    syntax: [...syntax.entries()].map(toGroup),
    semantic: [{ name: 'Semantic token colors', entries: semantic }]
  };
}

function applyEditsToText(text, edits) {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let output = text;

  for (const edit of ordered) {
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  }

  return output;
}

module.exports = {
  COLOR_PATTERN,
  applyEditsToText,
  buildGroups,
  buildOverrideEdits,
  buildPalette,
  buildRippleEdits,
  classifyPath,
  formatColor,
  groupByBase,
  indexTheme,
  isColorLiteral,
  parseColor,
  workbenchParts
};
