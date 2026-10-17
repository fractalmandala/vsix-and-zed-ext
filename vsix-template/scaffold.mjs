#!/usr/bin/env node
// Zero-dependency scaffolder: node scaffold.mjs <name> [--out <dir>] [--publisher <id>] [--install]
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i < 0 ? undefined : args[i + 1]; };
const name = args.find((a, i) => !a.startsWith('--') && !(i > 0 && ['--out', '--publisher'].includes(args[i - 1])));

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('usage: node scaffold.mjs <name> [--out <dir>] [--publisher <id>] [--install]\n  <name> must be lowercase letters, digits, hyphens, starting with a letter');
  process.exit(1);
}

const target = resolve(flag('--out') ?? name);
if (existsSync(target)) { console.error(`error: ${target} already exists`); process.exit(1); }

const tokens = {
  name,
  AppName: name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
  publisher: flag('--publisher') ?? 'local',
};

const TEXT = /\.(json|ts|js|css|md|svg|html)$|^\.(vscodeignore|gitignore)$/;
const render = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => tokens[k] ?? m);

cpSync(join(here, 'template'), target, { recursive: true });
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.test(f)) writeFileSync(p, render(readFileSync(p, 'utf8')));
  }
})(target);

console.log(`created ${target}`);
if (args.includes('--install')) spawnSync('npm', ['install'], { cwd: target, stdio: 'inherit' });
else console.log(`next: cd ${target} && npm install && npm run compile`);
