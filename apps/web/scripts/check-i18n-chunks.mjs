#!/usr/bin/env node
// Build check of the locale chunks (i18n 5.4, 20.3), run after `pnpm build` as `pnpm --filter @weblion/web
// check:chunks`. Plain Node without dependencies and without a Vite manifest:
//   1. no dictionary in the entry set (the entry script and its modulepreload links),
//   2. each of the five markers wl-i18n-chunk:<locale> in exactly one file, no file with two,
//   3. each locale chunk at most 90 KB gzipped,
//   4. no server-only text (email.*, pdf.* keys) in any web chunk.
// Prints a table of the locale chunks and exits 1 with one line per problem.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCALES = ['de', 'en', 'fr', 'it', 'nl'];
const MAX_GZIP = 90 * 1024;
const MARKER = 'wl-i18n-chunk:';
// Minified dictionaries keep their keys as quoted property names.
const SERVER_KEY = /["'](?:email|pdf)\.[A-Za-z0-9]+\.[A-Za-z0-9.]+["']/;

const dist = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const problems = [];

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`check:chunks: ${join(dist, 'index.html')} not found, run pnpm build first`);
  process.exit(1);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entrySet = new Set();
for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="\/?([^"]+)"/g))
  entrySet.add(basename(m[1]));
for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\/?([^"]+)"/g))
  entrySet.add(basename(m[1]));
if (entrySet.size === 0) problems.push('index.html has no module entry script');

const assets = join(dist, 'assets');
const files = readdirSync(assets).filter((f) => f.endsWith('.js'));
const markerFiles = Object.fromEntries(LOCALES.map((l) => [l, []]));
const rows = [];

for (const file of files) {
  const buf = readFileSync(join(assets, file));
  const text = buf.toString('utf8');
  const markers = LOCALES.filter((l) => text.includes(`${MARKER}${l}`));
  if (entrySet.has(file) && text.includes(MARKER)) {
    problems.push(`${file}: the entry set contains a dictionary (${MARKER} found)`);
  }
  if (markers.length > 1) problems.push(`${file}: contains the markers of ${markers.join(', ')}`);
  for (const l of markers) markerFiles[l].push(file);
  const serverKey = SERVER_KEY.exec(text);
  if (serverKey) problems.push(`${file}: contains the server-only text key ${serverKey[0]}`);
  if (markers.length > 0) {
    const gzip = gzipSync(buf, { level: 9 }).length;
    rows.push({ file, marker: markers.join(','), raw: buf.length, gzip });
    if (gzip > MAX_GZIP) {
      problems.push(`${file}: ${(gzip / 1024).toFixed(1)} KB gzipped, more than ${MAX_GZIP / 1024} KB`);
    }
  }
}

for (const l of LOCALES) {
  if (markerFiles[l].length !== 1) {
    problems.push(
      `${MARKER}${l} is in ${markerFiles[l].length} files (${markerFiles[l].join(', ') || 'none'}), not 1`,
    );
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
console.log('Locale chunks:');
console.log(`  ${'file'.padEnd(36)} ${'marker'.padEnd(8)} ${'raw'.padStart(10)} ${'gzip'.padStart(10)}`);
for (const r of rows.sort((a, b) => a.marker.localeCompare(b.marker))) {
  console.log(
    `  ${r.file.padEnd(36)} ${r.marker.padEnd(8)} ${kb(r.raw).padStart(10)} ${kb(r.gzip).padStart(10)}`,
  );
}
console.log(`Entry set: ${[...entrySet].join(', ')}`);

if (problems.length > 0) {
  for (const p of problems) console.error(`check:chunks: ${p}`);
  process.exit(1);
}
console.log(`check:chunks: ${files.length} chunks checked, 5 locale chunks, no dictionary in the entry set`);
