// Fails when the dev-only component preview (or its fixtures) leaked into a production build.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const MARKERS = ['Pratinjau komponen', '__preview', 'Salsa Maheswari', 'Maya Lestari'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|css|html|map)$/.test(name)) yield full;
  }
}

let leaked = 0;
let scanned = 0;
for (const app of ['miniapp', 'admin']) {
  const dist = join(root, 'apps', app, 'dist');
  if (!existsSync(dist)) {
    console.error(`apps/${app}/dist is missing - run the build first`);
    process.exit(2);
  }
  for (const file of files(dist)) {
    scanned += 1;
    const text = readFileSync(file, 'utf8');
    for (const marker of MARKERS) {
      if (text.includes(marker)) {
        console.error(`LEAK: "${marker}" found in ${file}`);
        leaked += 1;
      }
    }
  }
}

if (leaked > 0) process.exit(1);
console.log(`No preview code or fixtures in production builds (${scanned} files checked).`);
