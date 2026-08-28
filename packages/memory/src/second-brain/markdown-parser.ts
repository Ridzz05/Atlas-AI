export interface ParsedMarkdownDocument {
  title: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
  rawContent: string;
  cleanedContent: string;
  sections: MarkdownSection[];
}

export interface MarkdownSection {
  heading: string | null;
  level: number;
  content: string;
}

export interface DocumentChunk {
  chunkIndex: number;
  sectionHeading: string | null;
  content: string;
  tokensCount: number;
}

export interface ChunkOptions {
  maxTokensPerChunk?: number;
  tokenOverlap?: number;
}

/**
 * Parses Markdown documents including YAML frontmatter, headers, tags, and wiki-links.
 */
export class MarkdownParser {
  /**
   * Parse a raw Markdown file string into structured metadata and sections.
   */
  public static parse(content: string, defaultTitle = 'Untitled Note'): ParsedMarkdownDocument {
    const frontmatter: Record<string, unknown> = {};
    let rawContent = content;

    // 1. Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (frontmatterMatch && frontmatterMatch[1]) {
      const yamlContent = frontmatterMatch[1];
      rawContent = content.slice(frontmatterMatch[0].length);

      for (const line of yamlContent.split(/\r?\n/)) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          let val = line.slice(colonIdx + 1).trim();

          // Handle simple lists: [a, b, c]
          if (val.startsWith('[') && val.endsWith(']')) {
            const items = val
              .slice(1, -1)
              .split(',')
              .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
              .filter(Boolean);
            frontmatter[key] = items;
          } else {
            // Strip quotes
            val = val.replace(/^['"]|['"]$/g, '');
            frontmatter[key] = val;
          }
        }
      }
    }

    // 2. Extract Document Title: frontmatter.title -> first # Header -> defaultTitle
    let title = (frontmatter.title as string) || '';
    if (!title) {
      const h1Match = rawContent.match(/^#\s+(.+)$/m);
      if (h1Match && h1Match[1]) {
        title = h1Match[1].trim();
      } else {
        title = defaultTitle;
      }
    }

    // 3. Extract Tags (both frontmatter tags and inline #tags)
    const tagSet = new Set<string>();
    if (Array.isArray(frontmatter.tags)) {
      for (const t of frontmatter.tags) {
        if (typeof t === 'string') tagSet.add(t.replace(/^#/, ''));
      }
    } else if (typeof frontmatter.tags === 'string') {
      frontmatter.tags
        .split(/[,;\s]+/)
        .map(t => t.trim().replace(/^#/, ''))
        .filter(Boolean)
        .forEach(t => tagSet.add(t));
    }

    // Inline #tags (e.g., #productivity #ai/agents) - ignore inside codeblocks or links
    const inlineTagRegex = /(?:^|\s)#([a-zA-Z0-9_\-/]+)(?=\s|$|[.,;:!])/g;
    let match: RegExpExecArray | null;
    while ((match = inlineTagRegex.exec(rawContent)) !== null) {
      if (match[1]) {
        tagSet.add(match[1]);
      }
    }

    // 4. Extract Obsidian Wiki-Links: [[Target Note]] or [[Target Note#Heading]] or [[Target Note|Alias]]
    const linkSet = new Set<string>();
    const wikiLinkRegex = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
    while ((match = wikiLinkRegex.exec(rawContent)) !== null) {
      if (match[1]) {
        linkSet.add(match[1].trim());
      }
    }

    // 5. Parse Sections by Markdown Headings
    const sections = this.extractSections(rawContent);

    return {
      title,
      frontmatter,
      tags: Array.from(tagSet),
      links: Array.from(linkSet),
      rawContent,
      cleanedContent: rawContent.trim(),
      sections
    };
  }

  /**
   * Split markdown content into heading-based sections.
   */
  private static extractSections(markdown: string): MarkdownSection[] {
    const lines = markdown.split(/\r?\n/);
    const sections: MarkdownSection[] = [];
    let currentHeading: string | null = null;
    let currentLevel = 0;
    let currentLines: string[] = [];

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            level: currentLevel,
            content: currentLines.join('\n').trim()
          });
          currentLines = [];
        }
        currentLevel = headingMatch[1].length;
        currentHeading = headingMatch[2].trim();
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content: currentLines.join('\n').trim()
      });
    }

    return sections.filter(s => s.content.length > 0);
  }

  /**
   * Chunk parsed document into semantic pieces suitable for vector embedding and RAG.
   */
  public static chunkDocument(doc: ParsedMarkdownDocument, options: ChunkOptions = {}): DocumentChunk[] {
    const maxTokens = options.maxTokensPerChunk || 350;
    const overlapTokens = options.tokenOverlap || 40;
    const chunks: DocumentChunk[] = [];

    let chunkIndex = 0;

    for (const section of doc.sections) {
      const sectionText = section.content;
      if (!sectionText) continue;

      const words = sectionText.split(/\s+/).filter(Boolean);
      // Rough token estimate: ~0.75 words per token (or ~1.3 tokens per word)
      const wordsPerChunk = Math.max(50, Math.floor(maxTokens * 0.75));
      const wordsOverlap = Math.max(10, Math.floor(overlapTokens * 0.75));

      if (words.length <= wordsPerChunk) {
        const text = section.heading ? `### ${section.heading}\n\n${sectionText}` : sectionText;
        chunks.push({
          chunkIndex: chunkIndex++,
          sectionHeading: section.heading,
          content: text,
          tokensCount: Math.ceil(text.length / 4)
        });
      } else {
        // Sliding window chunking with overlap
        let start = 0;
        while (start < words.length) {
          const end = Math.min(words.length, start + wordsPerChunk);
          const chunkSlice = words.slice(start, end).join(' ');
          const text = section.heading ? `### ${section.heading} (part)\n\n${chunkSlice}` : chunkSlice;

          chunks.push({
            chunkIndex: chunkIndex++,
            sectionHeading: section.heading,
            content: text,
            tokensCount: Math.ceil(text.length / 4)
          });

          if (end >= words.length) break;
          start += wordsPerChunk - wordsOverlap;
        }
      }
    }

    // Fallback if no sections were extracted but document has content
    if (chunks.length === 0 && doc.cleanedContent) {
      chunks.push({
        chunkIndex: 0,
        sectionHeading: null,
        content: doc.cleanedContent,
        tokensCount: Math.ceil(doc.cleanedContent.length / 4)
      });
    }

    return chunks;
  }
}
