import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The configured Second Brain vault root, or null when none exists.
 *
 * This is the single owner of "where may the Second Brain read from". It used to live only in the
 * agent-service route, so the API was contained while the `second_brain.sync_vault` tool passed a
 * model-supplied path straight to a recursive directory walk — the same rule with one owner and
 * one hole. Both callers use this now.
 */
export function resolveVaultRoot(): string | null {
  const candidates = [
    path.resolve(process.cwd(), 'vault'),
    path.resolve(process.cwd(), '../../vault'),
    path.resolve(process.cwd(), '../vault')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * True when `requested` is the vault root itself or a path inside it.
 *
 * Comparison happens on resolved absolute paths, so `..` segments and a relative path cannot
 * escape. The trailing-separator check is what stops a sibling directory whose name merely starts
 * with the root's name (`/srv/vault-backup` vs `/srv/vault`) from passing.
 */
export function isInsideVaultRoot(requested: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedRequested = path.resolve(requested);

  if (resolvedRequested === resolvedRoot) return true;

  return resolvedRequested.startsWith(resolvedRoot + path.sep);
}

/**
 * Fail-closed guard for any caller that accepts a vault path from outside the process (a model
 * tool argument, an HTTP body). Throws rather than returning a boolean: a caller that forgets to
 * check the result would otherwise keep reading an arbitrary directory.
 */
export function assertVaultPathAllowed(requested: string): string {
  const root = resolveVaultRoot();

  if (!root) {
    throw new Error('Second Brain vault root is not configured; refusing to read a caller-supplied path.');
  }

  if (!isInsideVaultRoot(requested, root)) {
    throw new Error(`Path '${requested}' is outside the configured Second Brain vault root and cannot be read.`);
  }

  return path.resolve(requested);
}
