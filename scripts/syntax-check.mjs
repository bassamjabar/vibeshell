// Cross-platform syntax check: `node --check` every .js/.mjs source file
// (skipping deps and build output). Used by CI on all three OSes.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'release', 'build', '.gradle', '.git', 'renderer']);
// renderer/*.js are browser scripts (share a page scope) — node --check flags
// their cross-file globals; they're covered by eslint instead.

let checked = 0;
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      try {
        execSync(`node --check "${full}"`, { stdio: 'pipe' });
        checked += 1;
      } catch (e) {
        failures.push(`${full}\n${e.stderr || e.message}`);
      }
    }
  }
}

walk(root);

if (failures.length) {
  console.error(`✗ ${failures.length} file(s) failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log(`✓ ${checked} files parsed cleanly`);
