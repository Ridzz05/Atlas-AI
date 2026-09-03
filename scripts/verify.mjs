#!/usr/bin/env node
// Windows-friendly verify without turbo binary resolution issues.
// Uses pnpm -r exec directly.
import { spawnSync } from 'node:child_process';

function run(args, label) {
  process.stdout.write(`\n== ${label}: ${args.join(' ')} ==\n`);
  // Use node + pnpm.mjs absolute to avoid Windows shim / PATH issues (turbo binary path bug)
  const pnpmMjs = 'C:\\Users\\muhri\\AppData\\Roaming\\npm\\node_modules\\pnpm\\bin\\pnpm.mjs';
  const nodeBin = process.execPath;
  const res = spawnSync(nodeBin, [pnpmMjs, ...args], { stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    process.stderr.write(`\u274C ${label} failed with exit ${res.status}\n`);
    process.exit(res.status ?? 1);
  }
  process.stdout.write(`\u2705 ${label} passed\n`);
}

run(['-r', 'exec', 'tsc', '--noEmit'], 'typecheck (pnpm -r exec tsc --noEmit)');
run(['exec', 'prettier', '--check', '.'], 'format:check');
run(['exec', 'node', 'scripts/lint.mjs'], 'lint');
run(['-r', 'exec', 'vitest', 'run'], 'test (pnpm -r exec vitest run)');

process.stdout.write('\nAll verify steps passed. For full turbo on Linux CI, also run: pnpm turbo run build && pnpm turbo run test\n');
