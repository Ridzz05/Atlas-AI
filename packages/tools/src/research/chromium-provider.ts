import * as fs from 'node:fs';
import * as path from 'node:path';
import puppeteer, { Browser } from 'puppeteer-core';
import type { ResearchProvider, ResearchFreshness, ResearchSensitivity } from '../types.js';
import { isSafePublicWebUrl } from './url-safety.js';
import { rootLogger } from '@atlas/observability';

export interface ChromiumResearchProviderOptions {
  executablePath?: string;
  headless?: boolean;
  timeoutMs?: number;
}

export function findChromiumPath(): string {
  // 1. Explicit env var
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }

  // 2. Windows candidate paths
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const windowsCandidates = [
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe')
  ];

  for (const candidate of windowsCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. Linux / macOS fallbacks
  const unixCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];

  for (const candidate of unixCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Chromium executable not found. Please install Google Chrome or Microsoft Edge, or set CHROME_PATH environment variable.'
  );
}

export class ChromiumResearchProvider implements ResearchProvider {
  private executablePath: string;
  private timeoutMs: number;

  constructor(options: ChromiumResearchProviderOptions = {}) {
    this.executablePath = options.executablePath || findChromiumPath();
    this.timeoutMs = options.timeoutMs || 25_000;
  }

  private async launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      executablePath: this.executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions'
      ]
    });
  }

  public async search(
    query: string,
    limit: number = 5,
    signal?: AbortSignal
  ): Promise<
    Array<{
      title: string;
      url: string;
      snippet: string;
      confidence: number;
      extractedAt: string;
      freshness: ResearchFreshness;
      sensitivity: ResearchSensitivity;
      unresolvedQuestions: string[];
    }>
  > {
    const targetLimit = Math.min(Math.max(1, limit), 20);
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=id`;
    const extractedAt = new Date().toISOString();

    let browser: Browser | null = null;
    try {
      if (signal?.aborted) {
        throw new Error('Search operation aborted before launch.');
      }

      browser = await this.launchBrowser();
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(searchUrl, {
        waitUntil: 'networkidle2',
        timeout: this.timeoutMs
      });

      const rawResults = await page.evaluate((maxCount: number) => {
        const items: Array<{ title: string; rawUrl: string; snippet: string }> = [];
        const resultElements = document.querySelectorAll('#b_results > li.b_algo');

        for (let i = 0; i < resultElements.length && items.length < maxCount; i++) {
          const el = resultElements[i];
          if (!el) continue;

          const h2 = el.querySelector('h2');
          const a = h2?.querySelector('a') as HTMLAnchorElement | null;
          const caption = el.querySelector('.b_caption, .b_snippet, p') as HTMLElement | null;

          if (!a || !a.href) continue;

          const title = (a.innerText || h2?.innerText || '').trim();
          const rawUrl = a.href;
          const snippet = (caption?.innerText || '').trim();

          if (title && rawUrl) {
            items.push({ title, rawUrl, snippet });
          }
        }
        return items;
      }, targetLimit);

      await page.close();

      // Clean URLs from Bing redirection wrapper (https://www.bing.com/ck/a?!&&...&u=a1<base64>&ntb=1)
      const cleanedResults: Array<{
        title: string;
        url: string;
        snippet: string;
        confidence: number;
        extractedAt: string;
        freshness: ResearchFreshness;
        sensitivity: ResearchSensitivity;
        unresolvedQuestions: string[];
      }> = [];

      for (const item of rawResults) {
        let cleanUrl = item.rawUrl;
        try {
          const parsed = new URL(cleanUrl);
          const uParam = parsed.searchParams.get('u');
          if (uParam && uParam.startsWith('a1')) {
            const decoded = Buffer.from(uParam.slice(2), 'base64').toString('utf8');
            if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
              cleanUrl = decoded;
            }
          }
        } catch {}

        if (isSafePublicWebUrl(cleanUrl)) {
          cleanedResults.push({
            title: item.title,
            url: cleanUrl,
            snippet: item.snippet,
            confidence: 0.85,
            extractedAt,
            freshness: 'fresh' as ResearchFreshness,
            sensitivity: 'public' as ResearchSensitivity,
            unresolvedQuestions: []
          });
        }
      }

      rootLogger.info('Chromium web search completed', {
        query,
        requestedLimit: limit,
        foundCount: cleanedResults.length
      });

      return cleanedResults;
    } catch (err) {
      rootLogger.error('Chromium web search failed', { query, error: String(err) });
      throw err;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  public async fetchSafe(
    url: string,
    signal?: AbortSignal
  ): Promise<{
    content: string;
    sourceUrl: string;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
    confidence: number;
  }> {
    if (!isSafePublicWebUrl(url)) {
      throw new Error(`Target URL '${url}' is not a permitted public web URL.`);
    }

    const extractedAt = new Date().toISOString();
    let browser: Browser | null = null;

    try {
      if (signal?.aborted) {
        throw new Error('Fetch operation aborted before launch.');
      }

      browser = await this.launchBrowser();
      const page = await browser.newPage();

      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Block images, stylesheets, media for speed and safety
      await page.setRequestInterception(true);
      page.on('request', req => {
        const resourceType = req.resourceType();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs
      });

      const extractedText = await page.evaluate(() => {
        // Strip scripts, styles, iframes, navigation boilerplate
        const unneeded = document.querySelectorAll('script, style, noscript, nav, footer, header, svg, iframe');
        unneeded.forEach((n: Element) => n.remove());

        const body = document.body;
        if (!body) return '';

        return (body.innerText || body.textContent || '')
          .replace(/\t+/g, ' ')
          .replace(/\r?\n\s*\r?\n/g, '\n\n')
          .trim();
      });

      await page.close();

      // Limit response content size to 50,000 characters
      const boundedContent = extractedText.slice(0, 50_000);

      rootLogger.info('Chromium safe web fetch completed', {
        url,
        length: boundedContent.length
      });

      return {
        content: boundedContent,
        sourceUrl: url,
        extractedAt,
        freshness: 'fresh' as ResearchFreshness,
        sensitivity: 'public' as ResearchSensitivity,
        unresolvedQuestions: [],
        confidence: 0.9
      };
    } catch (err) {
      rootLogger.error('Chromium safe web fetch failed', { url, error: String(err) });
      throw err;
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  public async lookupCompany(
    companyName: string,
    location: string,
    signal?: AbortSignal
  ): Promise<{
    found: boolean;
    companyName: string;
    address: string;
    phone?: string;
    instagram?: string;
    estimatedMembers?: number;
    sourceUrl: string;
    confidence: number;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
  }> {
    const results = await this.search(`${companyName} ${location}`, 1, signal);
    const result = results[0];
    const extractedAt = new Date().toISOString();

    return {
      found: Boolean(result),
      companyName,
      address: '',
      sourceUrl: result?.url || `https://duckduckgo.com/?q=${encodeURIComponent(`${companyName} ${location}`)}`,
      confidence: result ? 0.75 : 0,
      extractedAt,
      freshness: 'fresh' as ResearchFreshness,
      sensitivity: 'public' as ResearchSensitivity,
      unresolvedQuestions: [
        result ? 'Address and contact details require independent verification.' : 'No authoritative company profile was found.'
      ]
    };
  }

  public async enrichLead(
    companyName: string,
    location: string,
    signal?: AbortSignal
  ): Promise<{
    found: boolean;
    companyName: string;
    location: string;
    category: string;
    phone?: string;
    instagram?: string;
    estimatedMembers?: number;
    sourceUrl: string;
    confidence: number;
    extractedAt: string;
    freshness: ResearchFreshness;
    sensitivity: ResearchSensitivity;
    unresolvedQuestions: string[];
  }> {
    const results = await this.search(`${companyName} ${location}`, 1, signal);
    const result = results[0];
    const extractedAt = new Date().toISOString();

    return {
      found: Boolean(result),
      companyName,
      location,
      category: 'commercial',
      sourceUrl: result?.url || `https://duckduckgo.com/?q=${encodeURIComponent(`${companyName} ${location}`)}`,
      confidence: result ? 0.75 : 0,
      extractedAt,
      freshness: 'fresh' as ResearchFreshness,
      sensitivity: 'public' as ResearchSensitivity,
      unresolvedQuestions: [
        result ? 'Contact and qualification details require independent verification.' : 'No authoritative lead profile was found.'
      ]
    };
  }
}
