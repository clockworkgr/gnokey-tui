#!/usr/bin/env node
// Launcher for gnokey-tui. Runs the TypeScript entry point through the tsx
// loader so no build step is required. Requires `npm install` to have been run
// in the project directory (so that node_modules/tsx is present).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(projectRoot, 'src', 'cli.tsx');

const res = spawnSync(
  process.execPath,
  ['--import', 'tsx', entry, ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: projectRoot },
);

process.exit(res.status ?? 1);
