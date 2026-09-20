import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SecondBrainService, VaultIngestionService, VectorEmbeddingService } from '../src/index.js';

/**
 * Three facts the ingestion path reported but never measured.
 *
 * 1. `IngestVaultResult.skipped` was initialised to 0 and never incremented — the only path that skips
 *    anything (the `contentHash` early return) could not tell its caller. Every report therefore said
 *    "Files Skipped: 0", and `totalFiles` never equalled `ingested + skipped + errors`.
 * 2. `generateDocumentId` lowercased the path and collapsed every run of non-alphanumerics to a dash,
 *    so `notes/static.md` and `notes-static.md` both produced `notes-static-md`. The second ingest
 *    deleted the first document's chunks and overwrote it: a note vanished from the index while its
 *    file still existed, and citations returned one note's content under the other's title.
 * 3. Re-ingesting unchanged content returned the stored document before recomputing the scope, so no
 *    write path could move a note into a different scope while every one of them reported success.
 */
function makeVault() {
  return new VaultIngestionService(new VectorEmbeddingService({ provider: 'mock', dimension: 64 }));
}

async function makeVaultDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-vault-'));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf-8');
  }
  return dir;
}

describe('vault ingestion reporting', () => {
  it('reports created, then unchanged, then updated', async () => {
    const vault = makeVault();

    const created = await vault.ingestDocument({ filePath: 'notes/a.md', content: '# A\nFirst version.' });
    expect(created.outcome).toBe('created');

    const unchanged = await vault.ingestDocument({ filePath: 'notes/a.md', content: '# A\nFirst version.' });
    expect(unchanged.outcome).toBe('unchanged');
    expect(unchanged.document.id).toBe(created.document.id);

    const updated = await vault.ingestDocument({ filePath: 'notes/a.md', content: '# A\nSecond version.' });
    expect(updated.outcome).toBe('updated');
    expect(updated.document.id).toBe(created.document.id);
  });

  it('counts skipped files so the report adds up', async () => {
    const dir = await makeVaultDir({
      'one.md': '# One\nContent one.',
      'two.md': '# Two\nContent two.',
      'nested/three.md': '# Three\nContent three.'
    });
    const vault = makeVault();

    const first = await vault.ingestVaultDirectory(dir);
    expect(first.totalFiles).toBe(3);
    expect(first.ingested).toBe(3);
    expect(first.skipped).toBe(0);
    expect(first.errors).toHaveLength(0);

    const second = await vault.ingestVaultDirectory(dir);
    expect(second.totalFiles).toBe(3);
    expect(second.ingested).toBe(0);
    expect(second.skipped).toBe(3);
    // The report must account for every file it walked.
    expect(second.ingested + second.skipped + second.errors.length).toBe(second.totalFiles);
  });

  it('counts a changed file as ingested on a re-sync', async () => {
    const dir = await makeVaultDir({ 'one.md': '# One\nContent one.', 'two.md': '# Two\nContent two.' });
    const vault = makeVault();
    await vault.ingestVaultDirectory(dir);

    await fs.writeFile(path.join(dir, 'two.md'), '# Two\nChanged content.', 'utf-8');
    const resync = await vault.ingestVaultDirectory(dir);

    expect(resync.ingested).toBe(1);
    expect(resync.skipped).toBe(1);
  });
});

describe('vault document identity', () => {
  // `notes/static.md` and `notes-static.md` both slugged to `notes-static-md`.
  it('keeps two paths that slug identically as separate documents', async () => {
    const vault = makeVault();

    const slashed = await vault.ingestDocument({ filePath: 'notes/static.md', content: '# Slashed\nFirst note.' });
    const dashed = await vault.ingestDocument({ filePath: 'notes-static.md', content: '# Dashed\nSecond note.' });

    expect(dashed.document.id).not.toBe(slashed.document.id);
    expect(vault.getStats().totalDocuments).toBe(2);
    expect(vault.getDocument(slashed.document.id)?.title).toBe('Slashed');
    expect(vault.getDocument(dashed.document.id)?.title).toBe('Dashed');
  });

  it('keeps the id stable across ingests of the same path', async () => {
    const vault = makeVault();

    const first = await vault.ingestDocument({ filePath: 'notes/stable.md', content: '# Stable\nOne.' });
    const second = await vault.ingestDocument({ filePath: 'notes/stable.md', content: '# Stable\nTwo.' });

    expect(second.document.id).toBe(first.document.id);
  });
});

describe('vault re-scoping', () => {
  it('applies a new scope to unchanged content instead of ignoring it', async () => {
    const vault = makeVault();

    const first = await vault.ingestDocument({
      filePath: 'notes/a.md',
      content: '# A\nContent.',
      scope: 'second_brain'
    });
    expect(first.document.scope).toBe('second_brain');

    const rescoped = await vault.ingestDocument({
      filePath: 'notes/a.md',
      content: '# A\nContent.',
      scope: 'financials'
    });

    expect(rescoped.outcome).toBe('rescoped');
    expect(rescoped.document.scope).toBe('financials');
    // The chunks carry the scope too, or containment would still hand out the old one.
    expect(vault.getAllChunks().every(chunk => chunk.scope === 'financials')).toBe(true);
  });

  it('does not re-embed when only the scope changes', async () => {
    const embeddingService = new VectorEmbeddingService({ provider: 'mock', dimension: 64 });
    const vault = new VaultIngestionService(embeddingService);
    await vault.ingestDocument({ filePath: 'notes/b.md', content: '# B\nContent.', scope: 'second_brain' });
    const chunksBefore = vault.getAllChunks().map(c => c.embedding);

    await vault.ingestDocument({ filePath: 'notes/b.md', content: '# B\nContent.', scope: 'financials' });

    expect(vault.getAllChunks().map(c => c.embedding)).toEqual(chunksBefore);
  });

  it('surfaces the scope through the service too', async () => {
    const service = new SecondBrainService({ provider: 'mock', dimension: 64 });

    await service.ingestDocument({ filePath: 'notes/c.md', content: '# C\nContent.', scope: 'second_brain' });
    const rescoped = await service.ingestDocument({ filePath: 'notes/c.md', content: '# C\nContent.', scope: 'financials' });

    expect(rescoped.outcome).toBe('rescoped');
    expect(rescoped.document.scope).toBe('financials');
  });
});
