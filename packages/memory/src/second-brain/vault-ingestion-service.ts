import { SecondBrainDocument, SecondBrainChunk, SecondBrainStats } from '@atlas/shared';
import { MarkdownParser } from './markdown-parser.js';
import { VectorEmbeddingService } from './vector-embedding-service.js';
import { rootLogger } from '@atlas/observability';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface IngestDocumentInput {
  id?: string;
  title?: string;
  filePath: string;
  content: string;
  scope?: string;
}

export interface IngestVaultResult {
  totalFiles: number;
  ingested: number;
  skipped: number;
  errors: Array<{ filePath: string; error: string }>;
}

/** What an ingest actually did, so a caller never has to infer it. */
export type IngestOutcome = 'created' | 'updated' | 'unchanged' | 'rescoped';

export interface IngestDocumentResult {
  document: SecondBrainDocument;
  outcome: IngestOutcome;
}

export class VaultIngestionService {
  private documents = new Map<string, SecondBrainDocument>();
  private chunks = new Map<string, SecondBrainChunk>();
  private lastSyncAt: string | null = null;

  constructor(private embeddingService: VectorEmbeddingService) {}

  /**
   * Ingest a single Markdown or text document.
   *
   * Returns the outcome alongside the document, because the caller needs to know whether anything was
   * written: `ingestVaultDirectory` counts it, and a report that always says "skipped: 0" cannot be
   * told apart from a full re-index.
   */
  public async ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
    const parsed = MarkdownParser.parse(input.content, input.title || path.basename(input.filePath, path.extname(input.filePath)));
    const contentHash = crypto.createHash('sha256').update(input.content).digest('hex');
    const docId = input.id || this.generateDocumentId(input.filePath);
    const scope = input.scope || (parsed.frontmatter.scope as string) || 'second_brain';

    const existing = this.documents.get(docId);

    if (existing && existing.contentHash === contentHash) {
      // The content did not change, but the requested scope might have. Returning early here meant no
      // write path could move a note into a narrower scope, while every one of them reported success.
      // A scope change needs no re-embedding — the vectors are content-derived — so it is applied in
      // place to the document and to its chunks, which carry the scope too.
      if (existing.scope !== scope) {
        const rescoped: SecondBrainDocument = { ...existing, scope, updatedAt: new Date().toISOString() };
        this.documents.set(docId, rescoped);
        for (const [id, chunk] of this.chunks.entries()) {
          if (chunk.documentId === docId) {
            this.chunks.set(id, { ...chunk, scope });
          }
        }
        rootLogger.info('Re-scoped an unchanged Second Brain document', { docId, from: existing.scope, to: scope });
        return { document: rescoped, outcome: 'rescoped' };
      }

      rootLogger.debug('Document content unchanged, skipping re-indexing', { docId, filePath: input.filePath });
      return { document: existing, outcome: 'unchanged' };
    }

    // If existing, remove old chunks first
    if (existing) {
      this.deleteDocumentChunks(docId);
    }

    // Chunk the document
    const rawChunks = MarkdownParser.chunkDocument(parsed);

    // Create document record
    const document: SecondBrainDocument = {
      id: docId,
      title: parsed.title,
      filePath: input.filePath,
      content: input.content,
      frontmatter: parsed.frontmatter,
      tags: parsed.tags,
      links: parsed.links,
      scope,
      contentHash,
      chunksCount: rawChunks.length,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Embed and store chunks
    for (const rawChunk of rawChunks) {
      const chunkId = `${docId}#c${rawChunk.chunkIndex}`;
      const embedding = await this.embeddingService.embed(rawChunk.content);

      const chunk: SecondBrainChunk = {
        id: chunkId,
        documentId: docId,
        documentTitle: document.title,
        filePath: document.filePath,
        chunkIndex: rawChunk.chunkIndex,
        sectionHeading: rawChunk.sectionHeading,
        content: rawChunk.content,
        tokensCount: rawChunk.tokensCount,
        embedding,
        tags: document.tags,
        scope: document.scope,
        createdAt: new Date().toISOString()
      };

      this.chunks.set(chunkId, chunk);
    }

    this.documents.set(docId, document);
    this.lastSyncAt = new Date().toISOString();

    rootLogger.info('Indexed document into Second Brain', { docId, title: document.title, chunks: rawChunks.length });
    return { document, outcome: existing ? 'updated' : 'created' };
  }

  /**
   * Ingest a local vault directory recursively.
   */
  public async ingestVaultDirectory(
    dirPath: string,
    options: { extensions?: string[]; excludePatterns?: string[]; scope?: string } = {}
  ): Promise<IngestVaultResult> {
    const extensions = options.extensions || ['.md', '.markdown', '.txt'];
    const excludes = options.excludePatterns || ['.git', 'node_modules', '.obsidian', '.trash'];
    const result: IngestVaultResult = { totalFiles: 0, ingested: 0, skipped: 0, errors: [] };

    const files = await this.findFilesRecursively(dirPath, extensions, excludes);
    result.totalFiles = files.length;

    for (const file of files) {
      try {
        const content = await fs.readFile(file, 'utf-8');
        const relPath = path.relative(dirPath, file);
        const { outcome } = await this.ingestDocument({
          filePath: relPath || file,
          content,
          scope: options.scope || 'second_brain'
        });
        // `skipped` was never incremented, so every report claimed a full re-index and
        // `totalFiles` never equalled `ingested + skipped + errors`.
        if (outcome === 'unchanged') {
          result.skipped++;
        } else {
          result.ingested++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ filePath: file, error: message });
      }
    }

    return result;
  }

  public getDocument(id: string): SecondBrainDocument | null {
    return this.documents.get(id) || null;
  }

  public getDocumentByPath(filePath: string): SecondBrainDocument | null {
    for (const doc of this.documents.values()) {
      if (doc.filePath === filePath || doc.title === filePath) {
        return doc;
      }
    }
    return null;
  }

  public listDocuments(options: { scope?: string; tag?: string; limit?: number } = {}): SecondBrainDocument[] {
    let list = Array.from(this.documents.values());

    if (options.scope) {
      list = list.filter(d => d.scope === options.scope || d.scope === 'global');
    }
    if (options.tag) {
      const targetTag = options.tag.toLowerCase();
      list = list.filter(d => d.tags.some(t => t.toLowerCase() === targetTag));
    }

    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    if (options.limit) {
      list = list.slice(0, options.limit);
    }
    return list;
  }

  public getAllChunks(scope?: string): SecondBrainChunk[] {
    const all = Array.from(this.chunks.values());
    if (!scope) return all;
    return all.filter(c => c.scope === scope || c.scope === 'global');
  }

  public deleteDocument(id: string): boolean {
    const doc = this.documents.get(id);
    if (!doc) return false;
    this.deleteDocumentChunks(id);
    return this.documents.delete(id);
  }

  public getStats(): SecondBrainStats {
    const providerInfo = this.embeddingService.getProviderInfo();
    let totalEmbeddings = 0;
    for (const chunk of this.chunks.values()) {
      if (chunk.embedding && chunk.embedding.length > 0) {
        totalEmbeddings++;
      }
    }

    return {
      totalDocuments: this.documents.size,
      totalChunks: this.chunks.size,
      totalEmbeddings,
      embeddingProvider: providerInfo.provider,
      embeddingModel: providerInfo.model,
      vectorDimension: providerInfo.dimension,
      lastSyncAt: this.lastSyncAt
    };
  }

  private deleteDocumentChunks(docId: string): void {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.documentId === docId) {
        this.chunks.delete(id);
      }
    }
  }

  /**
   * A stable, collision-free id for a vault path.
   *
   * The slug alone was not unique: `notes/static.md` and `notes-static.md` both produced
   * `notes-static-md`, so the second ingest deleted the first document's chunks and overwrote it — a
   * note vanished from the index while its file still existed, and citations returned one note's
   * content under the other's title. A short digest of the exact path keeps the id readable and
   * stable across runs while making two distinct paths two distinct documents.
   */
  private generateDocumentId(filePath: string): string {
    const slug = filePath
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const digest = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 10);
    return slug ? `${slug}-${digest}` : digest;
  }

  private async findFilesRecursively(dir: string, extensions: string[], excludes: string[]): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (excludes.includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const nested = await this.findFilesRecursively(fullPath, extensions, excludes);
        results.push(...nested);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }

    return results;
  }
}
