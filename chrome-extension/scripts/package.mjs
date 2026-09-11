// Builds the exact zip that gets uploaded to the Chrome Web Store.
//
//   npm run package   → dist/extension/ (unpacked, load it via chrome://extensions)
//                     → dist/tailorcv-extension-<version>.zip
//
// The package is assembled from an explicit allowlist — never by zipping the
// source folder. A hand-zipped folder previously shipped node_modules/
// (including posthog-js/dist/array.js, PostHog's remote script loader) and got
// the extension rejected for remotely hosted code. After zipping, the result
// is checked by verify-package.mjs; a failed check deletes the zip.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { verifyZip, ALLOWLIST } from './verify-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'extension');

function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

// Minimal zip writer (deflate, no external dependency).
function writeZip(outFile, files) {
  const locals = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);      // deflate
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(dosTime, 12);
    cen.writeUInt16LE(dosDate, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const cenSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cenSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(outFile, Buffer.concat([...locals, ...central, end]));
}

function main() {
  run('npm run build');

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  fs.rmSync(STAGE, { recursive: true, force: true });

  const files = ALLOWLIST.map((rel) => {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) throw new Error(`Allowlisted file is missing: ${rel}`);
    const dest = path.join(STAGE, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    return { name: rel, data: fs.readFileSync(src) };
  });

  const zipPath = path.join(DIST, `tailorcv-extension-${manifest.version}.zip`);
  writeZip(zipPath, files);
  console.log(`\nWrote ${path.relative(ROOT, zipPath)} (${files.length} files)\n`);

  if (!verifyZip(zipPath)) {
    fs.rmSync(zipPath, { force: true });
    console.error('\nPackage verification FAILED — zip deleted. Fix the problems above.');
    process.exit(1);
  }
}

main();
