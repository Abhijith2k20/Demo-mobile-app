// Builds src/lib/i18n/en.json from the English defaults written next to each key in the code:
//   t('home.jumpTo', 'Jump to…')
// Run: node scripts/extract-i18n.mjs   (also reports keys missing from kn.json / hi.json)
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
walk(path.join(root, 'src'));
walk(path.join(root, 'app'));

const found = new Map();
const re = /\bt\(\s*'([a-zA-Z0-9_.]+)'\s*,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(re)) {
    const value = (m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (found.has(m[1]) && found.get(m[1]) !== value) console.warn(`! different defaults for ${m[1]}:\n   ${found.get(m[1])}\n   ${value}`);
    found.set(m[1], value);
  }
}

// Keys built at runtime (error codes, presets, job titles) live in en.base.json.
const base = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/i18n/en.base.json'), 'utf8'));
const out = structuredClone(base);
const set = (obj, key, value) => {
  const parts = key.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) o = o[p] ??= {};
  o[parts.at(-1)] ??= value;
};
for (const [k, v] of [...found].sort(([a], [b]) => a.localeCompare(b))) set(out, k, v);
fs.writeFileSync(path.join(root, 'src/lib/i18n/en.json'), JSON.stringify(out, null, 2) + '\n');

const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const enKeys = flat(out);
console.log(`en.json: ${enKeys.length} keys from ${files.length} files`);
for (const lang of ['kn', 'hi']) {
  const have = new Set(flat(JSON.parse(fs.readFileSync(path.join(root, `src/lib/i18n/${lang}.json`), 'utf8'))));
  console.log(`${lang}.json: ${have.size} keys translated, ${enKeys.filter((k) => !have.has(k)).length} fall back to English`);
  for (const k of have) if (!enKeys.includes(k)) console.warn(`! ${lang}.json has unknown key ${k}`);
}
