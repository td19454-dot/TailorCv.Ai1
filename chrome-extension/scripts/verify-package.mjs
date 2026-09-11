// Inspects the BUILT store zip (not the source tree) for anything that would
// violate Manifest V3's remotely-hosted-code rule or shouldn't ship at all.
//
//   npm run verify                     → checks the zip for the manifest's version
//   node scripts/verify-package.mjs X  → checks zip X (e.g. an older upload)
//
// Hard failures exit non-zero. Every posthog.com string is printed with
// context for a human to eyeball — those are expected (the capture API host
// and URLs inside SDK log messages) and are data, not code sources.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Everything the manifest references at runtime, and nothing else.
export const ALLOWLIST = [
  'manifest.json',
  'background.js',
  'content.js',
  'analytics.bundle.js',
  'styles.bundle.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png',
  'icons/lock-check.svg',
  'icons/success-check.svg',
];

// Code patterns that load or build executable code at runtime.
const FORBIDDEN_CODE = [
  [/\bimportScripts\s*\(/, 'importScripts()'],
  [/(^|[^.\w$])eval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bimport\s*\(\s*["'`]https?:/, 'dynamic import() of a remote URL'],
  [/<script[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//i, '<script src> pointing off-package'],
  [/createElement\(\s*["']script["']\s*\)/, 'document.createElement("script")'],
  // posthog-js's loader defines this hook to fetch its extension scripts from
  // the CDN; the no-external build only *reads* it (and finds nothing).
  [/loadExternalDependency\s*[:=]\s*(async\s*)?(function\b|\()/, 'loadExternalDependency definition (PostHog remote loader)'],
  [/["'`][^"'`\s]*\/static\/[\w.-]+\.js["'`]/, 'reference to a remotely served /static/*.js asset'],
];

// Allowed, but a reviewer should know why it is there.
const NOTED_CODE = [
  [/new\s+Worker\(\s*["']data:text\/javascript/, 'rrweb canvas worker from a bundled string — only used when canvas recording is on; src/analytics.js pins captureCanvas.recordCanvas=false'],
];

const BANNED_NAMES = [/node_modules\//, /(^|\/)src\//, /\.map$/, /(^|\/)package(-lock)?\.json$/, /\.(py|md|ts)$/, /(^|\/)\.[^/]+$/,
  /(^|\/)array(\.full)?(\.es5)?\.js$/, /(^|\/)(lazy-)?recorder(-v2)?\.js$/, /toolbar\.js$/, /surveys\.js$/];

function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // directory entry
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    entries.push({ name, data });
  }
  return entries;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function context(text, index, len) {
  return text.slice(Math.max(0, index - 60), index + len + 60).replace(/\s+/g, ' ');
}

export function verifyZip(zipPath) {
  const problems = [];
  const notes = [];
  const entries = readZip(zipPath);

  console.log(`Verifying ${path.relative(process.cwd(), zipPath)} — ${entries.length} files:`);
  for (const e of entries) console.log(`  ${e.name}  (${e.data ? e.data.length : '?'} bytes)`);

  // 1. File set: exactly the allowlist, nothing banned.
  const names = new Set(entries.map((e) => e.name));
  for (const e of entries) {
    if (!ALLOWLIST.includes(e.name)) problems.push(`unexpected file in package: ${e.name}`);
    for (const re of BANNED_NAMES) if (re.test(e.name)) problems.push(`banned file in package: ${e.name}`);
    if (!e.data) problems.push(`unsupported compression for ${e.name}`);
  }
  for (const f of ALLOWLIST) if (!names.has(f)) problems.push(`missing from package: ${f}`);

  // 2. Manifest: MV3, local scripts only, no CSP loosening.
  const manifestEntry = entries.find((e) => e.name === 'manifest.json');
  if (manifestEntry) {
    const m = JSON.parse(manifestEntry.data.toString('utf8').replace(/^﻿/, ''));
    if (m.manifest_version !== 3) problems.push('manifest_version is not 3');
    const scripts = [m.background && m.background.service_worker,
      ...(m.content_scripts || []).flatMap((c) => c.js || [])].filter(Boolean);
    for (const s of scripts) {
      if (/^[a-z]+:/i.test(s) || s.startsWith('//')) problems.push(`manifest references a non-package script: ${s}`);
      else if (!names.has(s)) problems.push(`manifest script not in package: ${s}`);
    }
    const csp = m.content_security_policy;
    const cspText = typeof csp === 'string' ? csp : JSON.stringify(csp || {});
    if (/https?:|unsafe-eval|unsafe-inline|\*/.test(cspText.replace(/connect-src[^;]*/g, ''))) {
      problems.push(`content_security_policy loosens script rules: ${cspText}`);
    }
    if (m.sandbox) problems.push('manifest declares sandbox pages (can run remote/eval code) — review');
  }

  // 3. Code: nothing that fetches or builds executable code.
  const hosts = [];
  for (const e of entries) {
    if (!/\.(js|html|json)$/.test(e.name) || !e.data) continue;
    const text = e.data.toString('utf8');
    for (const [re, label] of FORBIDDEN_CODE) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of text.matchAll(g)) {
        problems.push(`${label} in ${e.name}:${lineOf(text, m.index)} — ${context(text, m.index, m[0].length)}`);
      }
    }
    for (const [re, label] of NOTED_CODE) {
      const m = text.match(re);
      if (m) notes.push(`${e.name}:${lineOf(text, m.index)} — ${label}`);
    }
    for (const m of text.matchAll(/https?:\/\/[a-z0-9.-]*posthog\.com[^\s"'`)]*/gi)) {
      hosts.push(`${e.name}:${lineOf(text, m.index)}  ${m[0]}\n      …${context(text, m.index, m[0].length)}…`);
    }
  }

  console.log(`\nPostHog URL strings found (${hosts.length}) — expected: API host + SDK log/docs text, never a script source:`);
  for (const h of hosts) console.log(`  ${h}`);
  if (notes.length) {
    console.log('\nNotes for review (allowed):');
    for (const n of notes) console.log(`  ${n}`);
  }

  if (problems.length) {
    console.error(`\n✗ ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    return false;
  }
  console.log('\n✓ Package verified: allowlisted files only, no remote or runtime-built code loaders.');
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let target = process.argv[2];
  if (!target) {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    target = path.join(ROOT, 'dist', `tailorcv-extension-${version}.zip`);
  }
  process.exit(verifyZip(path.resolve(target)) ? 0 : 1);
}
