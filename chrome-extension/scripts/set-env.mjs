// Point the extension at a backend.
//
//   node scripts/set-env.mjs dev              -> http://localhost:8005
//   node scripts/set-env.mjs prod             -> https://thetailorcv.com
//   node scripts/set-env.mjs http://host:1234 -> anything explicit
//   node scripts/set-env.mjs                  -> print the current value
//
// Rewrites exactly one line of env.js, tagged with a `tcv:base-url` marker so
// this cannot accidentally match anything else in the file.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ENV_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'env.js');
const PROD = 'https://thetailorcv.com';
const DEV = 'http://localhost:8005';
const LINE_RE = /^(\s*var BASE_URL = ')([^']*)(';\s*\/\/ tcv:base-url\s*)$/m;

const source = readFileSync(ENV_FILE, 'utf8');
const match = source.match(LINE_RE);
if (!match) {
  console.error('Could not find the tcv:base-url line in env.js — was it edited?');
  process.exit(1);
}

const arg = (process.argv[2] || '').trim();
if (!arg) {
  console.log(match[2]);
  process.exit(0);
}

let target;
if (arg === 'dev' || arg === 'local') target = DEV;
else if (arg === 'prod' || arg === 'production') target = PROD;
else target = arg;

if (!/^https?:\/\/[^/\s]+$/.test(target)) {
  console.error(`Not a usable base URL: ${target}`);
  console.error('Expected something like http://localhost:8005 (no trailing slash, no path).');
  process.exit(1);
}

writeFileSync(ENV_FILE, source.replace(LINE_RE, `$1${target}$3`), 'utf8');
console.log(`Extension backend: ${match[2]} -> ${target}`);
if (target !== PROD) {
  console.log('Reminder: reload the unpacked extension in chrome://extensions '
    + 'for this to take effect.');
  console.log('`npm run package` will refuse to build a store zip while this is set.');
}
