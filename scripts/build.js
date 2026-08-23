#!/usr/bin/env node
/**
 * Build every workspace, in dependency order, reporting ALL failures.
 *
 * This replaces a hand-maintained `--workspace=` chain joined by `&&`. That
 * arrangement failed in two ways that were invisible from the outside:
 *
 *   1. `&&` short-circuits, so the first failing workspace hid every later one.
 *      A run reporting 46 errors was actually hiding 6 more in `core`, which had
 *      never been reached.
 *   2. The list drifted. `utils-notification-inbox-connector` was absent from it
 *      entirely, so it was never compiled and its breakage stayed silent.
 *
 * Order is derived from each package's own @xbg.solutions/* dependencies rather
 * than written down, so it cannot drift. A package whose dependency failed is
 * skipped rather than built, because tsc would only emit misleading
 * "cannot find module" noise on top of the real error.
 */
const { readdirSync, existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = join(__dirname, '..');
const packagesDir = join(root, 'packages');
const SCOPE = '@xbg.solutions/';

const pkgs = new Map();
for (const dir of readdirSync(packagesDir).sort()) {
  const manifest = join(packagesDir, dir, 'package.json');
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!pkg.scripts || !pkg.scripts.build) continue;
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };
  pkgs.set(pkg.name, {
    dir,
    deps: Object.keys(deps).filter((d) => d.startsWith(SCOPE)),
  });
}

// Depth-first topological sort. Throws on a cycle rather than silently
// producing an order that cannot work.
const order = [];
const done = new Set();
const visiting = new Set();
const visit = (name, stack = []) => {
  if (done.has(name)) return;
  if (visiting.has(name)) {
    throw new Error(`Dependency cycle: ${[...stack, name].join(' -> ')}`);
  }
  visiting.add(name);
  for (const dep of pkgs.get(name).deps) {
    if (pkgs.has(dep)) visit(dep, [...stack, name]);
  }
  visiting.delete(name);
  done.add(name);
  order.push(name);
};
for (const name of pkgs.keys()) visit(name);

const failed = new Set();
const skipped = new Map();

for (const name of order) {
  const { dir, deps } = pkgs.get(name);
  const blocked = deps.filter((d) => failed.has(d) || skipped.has(d));
  if (blocked.length) {
    skipped.set(name, blocked);
    console.log(`\n--- SKIP ${dir} (depends on failed: ${blocked.join(', ')})`);
    continue;
  }
  console.log(`\n--- build ${dir}`);
  const res = spawnSync('npm', ['run', 'build', '-w', `packages/${dir}`], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) failed.add(name);
}

const short = (n) => n.replace(SCOPE, '');
console.log(`\n${'='.repeat(60)}`);
console.log(`built   ${order.length - failed.size - skipped.size}/${order.length}`);
if (failed.size) console.log(`failed  ${[...failed].map(short).join(', ')}`);
if (skipped.size) console.log(`skipped ${[...skipped.keys()].map(short).join(', ')}`);
console.log('='.repeat(60));

process.exit(failed.size ? 1 : 0);
