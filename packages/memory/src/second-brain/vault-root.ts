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
 * Who is asking, and what they may read.
 *
 * The two principals are genuinely different, so the difference is stated rather than inferred:
 * an agent has `dataScopes` (possibly empty), and the operator's HTTP surface holds the vault.
 *
 * This exists because "no grant supplied" used to mean "no filter": the retriever and the service both
 * returned every scope when `allowedScopes` was empty, and `dataScopes` defaults to `[]`, so an agent
 * with no grant read the whole vault. `getDocument`/`getDocumentByPath` took no scope at all, so
 * `second_brain.read_note` — which six agents list — could read any note.
 */
export type ScopeGrant = { kind: 'operator' } | { kind: 'agent'; scopes: string[] };

/**
 * What a caller that supplies no grant may read.
 *
 * Global-only, so a caller that forgets to state its grant reads too little rather than too much. The
 * operator surface passes `{ kind: 'operator' }` explicitly.
 */
export const GLOBAL_ONLY_GRANT: ScopeGrant = { kind: 'agent', scopes: [] };

/** The grant for an agent's `dataScopes`. An empty list is global-only, never everything. */
export function agentScopeGrant(scopes: readonly string[] | undefined): ScopeGrant {
  return { kind: 'agent', scopes: [...(scopes ?? [])] };
}

/**
 * The one owner of "may this principal read a note in this scope".
 *
 * `global` is readable by everyone because it is the shared scope by definition.
 */
export function isScopeReadable(scope: string, grant: ScopeGrant): boolean {
  if (grant.kind === 'operator') return true;
  if (scope === 'global') return true;
  return grant.scopes.includes(scope);
}

/** Keep only the items whose scope the grant may read. */
export function filterByScopeGrant<T extends { scope: string }>(items: T[], grant: ScopeGrant): T[] {
  return items.filter(item => isScopeReadable(item.scope, grant));
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
