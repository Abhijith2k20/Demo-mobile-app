/// <reference types="node" />
// Features may depend on each other only one way. This fails when an import creates a loop
// (e.g. chat → tasks → chat), and when `shared` imports a feature.
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..');
const features = fs.readdirSync(ROOT).filter((f: string) => !f.startsWith('__') && fs.statSync(path.join(ROOT, f)).isDirectory());

function files(dir: string): string[] {
  return fs.readdirSync(dir).flatMap((f: string) => {
    const full = path.join(dir, f);
    if (f === '__tests__') return [];
    return fs.statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(f) ? [full] : [];
  });
}

/** Feature → the other features it imports. */
function graph(): Map<string, Set<string>> {
  const g = new Map<string, Set<string>>();
  for (const feature of features) {
    const deps = new Set<string>();
    for (const file of files(path.join(ROOT, feature))) {
      for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
        const target = spec.startsWith('@/features/')
          ? spec.split('/')[2]
          : spec.startsWith('.')
            ? path.relative(ROOT, path.resolve(path.dirname(file), spec)).split(path.sep)[0]
            : null;
        if (target && target !== feature && features.includes(target)) deps.add(target);
      }
    }
    g.set(feature, deps);
  }
  return g;
}

it('has no import loops between features', () => {
  const g = graph();
  const loops: string[] = [];
  const visit = (node: string, trail: string[]) => {
    if (trail.includes(node)) {
      loops.push([...trail.slice(trail.indexOf(node)), node].join(' → '));
      return;
    }
    for (const next of g.get(node) ?? []) visit(next, [...trail, node]);
  };
  for (const f of features) visit(f, []);
  expect([...new Set(loops)]).toEqual([]);
});

it('keeps shared free of feature imports', () => {
  expect([...(graph().get('shared') ?? [])]).toEqual([]);
});
