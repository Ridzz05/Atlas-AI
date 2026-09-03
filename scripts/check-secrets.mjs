#!/usr/bin/env node
// Lightweight secret scan — runs in lint/CI to prevent accidental commits.

const patterns = [
  new RegExp('gsk_' + '[A-Za-z0-9]{20,}'),
  new RegExp('sk-' + '(proj-)?[A-Za-z0-9]{20,}'),
  new RegExp('8669353401' + ':AA')
];

let found = false;
for (const p of patterns) {
  try {
    const cmd = `git grep -I -E "${p.source}" -- ':!.env' ':!pnpm-lock.yaml'`;
    const { execSync } = await import('node:child_process');
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    if (out.trim()) {
      console.error(`Potential secret matched ${p}:`, out.trim().slice(0, 500));
      found = true;
    }
  } catch {
    // git grep exits 1 when no match — ok
  }
}
if (found) process.exit(1);
// Use logger-friendly output via stdout
process.stdout.write('check-secrets: no hardcoded secrets in tracked files\n');
