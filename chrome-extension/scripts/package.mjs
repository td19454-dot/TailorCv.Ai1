// Assemble the shippable extension into dist/extension.
//
// This exists because the set of files that ship was previously tribal
// knowledge: dist/ is gitignored and was copied together by hand, and adding a
// new bundle (autofill.bundle.js) is exactly the change that silently ships
// broken — the manifest would reference a file the zip does not contain, and the
// extension fails to load with no hint as to why.
//
// SHIPPED is therefore the single source of truth, and this script verifies that
// every script the manifest names is actually in it.
//
// Run: npm run package   (after npm run build)

import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync }
  from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = join(ROOT, 'dist', 'extension');

// Everything the browser needs, and nothing else. Deliberately excludes
// sidebar.css (bundled into styles.bundle.js), src/, test/, node_modules/,
// package.json and the store-listing assets.
const SHIPPED = [
  'manifest.json',
  'env.js',
  'background.js',
  'content.js',
  'analytics.bundle.js',
  'styles.bundle.js',
  'autofill.bundle.js',
  // "See what changed": the page content.js frames over the job page, and the
  // editor's modal it runs (copied from static/ by `npm run build`).
  'changes.html',
  'changes_page.js',
  'changes_modal.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/lock-check.svg',
  'icons/success-check.svg',
];

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// An extension shipped pointing at localhost is a complete outage with no error
// a user could act on — every request just fails to connect. Refused here rather
// than remembered, because "flip env.js back before packaging" is precisely the
// step that gets skipped.
const PROD_BASE_URL = 'https://thetailorcv.com';
const envSource = readFileSync(join(ROOT, 'env.js'), 'utf8');
const envMatch = envSource.match(/var BASE_URL = '([^']*)';\s*\/\/ tcv:base-url/);
if (!envMatch) {
  console.error('Could not read BASE_URL out of env.js — refusing to package blind.');
  process.exit(1);
}
if (envMatch[1] !== PROD_BASE_URL) {
  console.error(`env.js points at ${envMatch[1]}, not ${PROD_BASE_URL}.`);
  console.error('Run `npm run prod` first.');
  process.exit(1);
}

// Every script the manifest references must be in SHIPPED. This is the check
// that would have caught autofill.bundle.js being missing from the zip.
const referenced = new Set();
for (const entry of manifest.content_scripts || []) {
  for (const file of entry.js || []) referenced.add(file);
  for (const file of entry.css || []) referenced.add(file);
}
if (manifest.background && manifest.background.service_worker) {
  referenced.add(manifest.background.service_worker);
}
for (const size of Object.values((manifest.action && manifest.action.default_icon) || {})) {
  referenced.add(size);
}
for (const size of Object.values(manifest.icons || {})) referenced.add(size);
// Pages opened in a frame (changes.html) are only reachable through here.
for (const entry of manifest.web_accessible_resources || []) {
  for (const file of entry.resources || []) if (!file.includes('*')) referenced.add(file);
}

const missing = [...referenced].filter(f => !SHIPPED.includes(f));
if (missing.length) {
  console.error('The manifest references files this script does not ship:');
  for (const f of missing) console.error(`  ${f}`);
  console.error('Add them to SHIPPED in scripts/package.mjs.');
  process.exit(1);
}

// And the reverse: a file listed here that no longer exists on disk means the
// build did not run, or a bundle was renamed.
const absent = SHIPPED.filter(f => {
  try { return !statSync(join(ROOT, f)).isFile(); } catch (e) { return true; }
});
if (absent.length) {
  console.error('Missing on disk — did you run `npm run build`?');
  for (const f of absent) console.error(`  ${f}`);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
for (const file of SHIPPED) {
  const dest = join(OUT, file);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(ROOT, file), dest);
}

const total = SHIPPED.reduce((sum, f) => sum + statSync(join(OUT, f)).size, 0);
console.log(`Packaged v${manifest.version}: ${SHIPPED.length} files, `
  + `${(total / 1024).toFixed(0)} KB -> dist/extension`);
console.log(`Zip it for the store with:\n  cd dist/extension && zip -r `
  + `../tailorcv-extension-${manifest.version}.zip .`);
console.log('  (PowerShell: Compress-Archive -Path dist/extension/* '
  + `-DestinationPath dist/tailorcv-extension-${manifest.version}.zip)`);

// A last sanity check on what was actually produced.
const shipped = walk(OUT).map(p => p.slice(OUT.length + 1).replace(/\\/g, '/'));
const unexpected = shipped.filter(f => !SHIPPED.includes(f));
if (unexpected.length) {
  console.error('Unexpected files in the package:', unexpected);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
