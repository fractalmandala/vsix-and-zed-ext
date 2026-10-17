#!/usr/bin/env node
/**
 * Copy the canonical registry.json into the extension so class completions
 * work with no project set up.
 *
 * Run this after ANY class change in fractalstyler, then `npm run package`.
 * Without it the extension completes against whatever class list shipped with
 * the last release, which is how completions quietly go stale.
 *
 *   node scripts/sync-registry.mts            # copy ../registry.json
 *   node scripts/sync-registry.mts --check    # exit 1 if the copy is stale
 *
 * `--check` is what CI (and `vscode:prepublish`) should use, so a stale
 * registry fails loudly instead of shipping.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.resolve(root, '..', 'registry.json');
const target = path.join(root, 'media', 'registry.json');
const check = process.argv.includes('--check');

if (!fs.existsSync(source)) {
  console.error(`✕ ${source} not found — run \`pnpm registry\` in fractalstyler first.`);
  process.exit(1);
}

const sourceText = fs.readFileSync(source, 'utf8');

if (check) {
  if (!fs.existsSync(target)) {
    console.error('✕ media/registry.json is missing. Run: npm run sync:registry');
    process.exit(1);
  }
  if (fs.readFileSync(target, 'utf8') !== sourceText) {
    const rows = JSON.parse(sourceText).length;
    console.error(`✕ media/registry.json is out of date (source has ${rows} classes).`);
    console.error('  Run: npm run sync:registry');
    process.exit(1);
  }
  console.log('✓ media/registry.json is current.');
  process.exit(0);
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, sourceText, 'utf8');

let count = 0;
try {
  count = JSON.parse(sourceText).length;
} catch {
  console.error('✕ registry.json is not valid JSON — refusing to copy it.');
  process.exit(1);
}
console.log(`✓ media/registry.json synced — ${count} classes.`);