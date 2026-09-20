#!/usr/bin/env node
// Secret scan, shared by `pnpm lint` (per-line, with file:line reporting) and CI (tracked files).
//
// Every pattern is assembled from concatenated fragments on purpose. This file is tracked, so a
// pattern written as a single literal makes the scanner match its own source. The inline
// `git grep` that used to live in ci.yml searched for a bare `8669353401`, which appears both in
// this file and in the workflow itself — so that step matched itself, failed on every run, and
// never actually scanned anything. Keep the fragments split.

import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

export const secretPatterns = [
  { pattern: new RegExp('gsk_' + '[A-Za-z0-9]{20,}'), label: 'Groq API key' },
  { pattern: new RegExp('sk-' + '(proj-)?[A-Za-z0-9]{20,}'), label: '[OI] API key' },
  { pattern: new RegExp('8669353' + '401:AA'), label: 'Telegram bot token (hardcoded example)' },
  // A bot token assigned in prose or source: the bot-token env var name set to <id>:AA plus the
  // secret half. Written without the literal so this comment does not match itself.
  { pattern: new RegExp('TELEGRAM_BOT_TOKEN=' + '[0-9]+:AA'), label: 'Telegram bot token in docs' }
];

// Only run the scan when invoked directly; `scripts/lint.mjs` imports the patterns above.
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const exclusions = [':!.env', ':!.env.example', ':!pnpm-lock.yaml'];
  let found = false;

  for (const { pattern, label } of secretPatterns) {
    try {
      // `git grep` walks tracked files only, so the scan cannot be slowed down or tripped by
      // node_modules or build output. It exits 1 when nothing matches, which is the usual case.
      const out = execFileSync('git', ['grep', '-I', '-n', '-E', pattern.source, '--', ...exclusions], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      if (out.trim()) {
        console.error(`Possible hardcoded secret (${label}):`);
        console.error(out.trim().slice(0, 1000));
        found = true;
      }
    } catch {
      // No match.
    }
  }

  if (found) process.exit(1);
  process.stdout.write('check-secrets: no hardcoded secrets in tracked files\n');
}
