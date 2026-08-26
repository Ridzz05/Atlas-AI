import { z } from 'zod';
import type { ResearchProvider, ResearchFreshness, ResearchSensitivity } from '../types.js';
import { SafeWebFetcher, type DnsLookup } from './safe-web-fetcher.js';
import { SafeWebUrlSchema } from './url-safety.js';

const BraveSearchResponseSchema = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().optional().default(''),
            url: z.string(),
            description: z.string().optional().default('')
          })
        )
        .default([])
    })
    .optional()
});

export interface BraveResearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  country?: string;
  searchLang?: string;
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookup;
  maxResponseBytes?: number;
  maxRedirects?: number;
  fetchTimeoutMs?: number;
  now?: () => Date;
}

const SEARCH_CONFIDENCE = 0.5;
const SEARCH_UNRESOLVED_QUESTION = 'Search result content is not independently verified.';

export class BraveResearchProvider implements ResearchProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly country: string;
  private readonly searchLang: string;
  private readonly fetchImpl: typeof fetch;
  private readonly safeFetcher: SafeWebFetcher;
  private readonly now: () => Date;

  constructor(options: BraveResearchProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error('Brave Search API key is required.');
    }

    const baseUrl = (options.baseUrl || 'https://api.search.brave.com/res/v1').replace(/\/+$/, '');
    const parsedBaseUrl = new URL(baseUrl);
    if (
      parsedBaseUrl.protocol !== 'https:' ||
      parsedBaseUrl.hostname.toLowerCase() !== 'api.search.brave.com' ||
      (parsedBaseUrl.port !== '' && parsedBaseUrl.port !== '443') ||
      parsedBaseUrl.username ||
      parsedBaseUrl.password
    ) {
      throw new Error('Brave Search API base URL must use HTTPS and the official Brave Search API host.');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = baseUrl;
    this.country = (options.country || 'ID').toUpperCase();
    this.searchLang = (options.searchLang || 'id').toLowerCase();
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => new Date());
    this.safeFetcher = new SafeWebFetcher({
      fetchImpl: options.fetchImpl,
      dnsLookup: options.dnsLookup,
      maxResponseBytes: options.maxResponseBytes,
      maxRedirects: options.maxRedirects,
      timeoutMs: options.fetchTimeoutMs,
      now: this.now
    });
  }

  public async search(query: string, limit: number, signal?: AbortSignal) {
    const data = await this.searchApi(query, limit, signal);
    const extractedAt = this.now().toISOString();

    return (
      data.web?.results
        .filter(result => SafeWebUrlSchema.safeParse(result.url).success)
        .map(result => ({
          title: result.title,
          url: result.url,
          snippet: result.description,
          confidence: SEARCH_CONFIDENCE,
          extractedAt,
          freshness: 'fresh' as ResearchFreshness,
          sensitivity: 'public' as ResearchSensitivity,
          unresolvedQuestions: [SEARCH_UNRESOLVED_QUESTION]
        })) || []
    );
  }

  public async lookupCompany(companyName: string, location: string, signal?: AbortSignal) {
    const results = await this.search(`${companyName} ${location}`, 1, signal);
    const result = results[0];
    const extractedAt = this.now().toISOString();

    return {
      found: Boolean(result),
      companyName,
      address: '',
      sourceUrl: result?.url || this.searchSourceUrl(companyName, location),
      confidence: result ? SEARCH_CONFIDENCE : 0,
      extractedAt,
      freshness: 'fresh' as ResearchFreshness,
      sensitivity: 'public' as ResearchSensitivity,
      unresolvedQuestions: [
        result ? 'Address and contact details require independent verification.' : 'No authoritative company profile was found.'
      ]
    };
  }

  public fetchSafe(url: string, signal?: AbortSignal) {
    return this.safeFetcher.fetch(url, signal);
  }

  public async enrichLead(companyName: string, location: string, signal?: AbortSignal) {
    const results = await this.search(`${companyName} ${location}`, 1, signal);
    const result = results[0];
    const extractedAt = this.now().toISOString();

    return {
      found: Boolean(result),
      companyName,
      location,
      category: result ? this.inferCategory(companyName, result.snippet) : 'unknown',
      sourceUrl: result?.url || this.searchSourceUrl(companyName, location),
      confidence: result ? SEARCH_CONFIDENCE : 0,
      extractedAt,
      freshness: 'fresh' as ResearchFreshness,
      sensitivity: 'public' as ResearchSensitivity,
      unresolvedQuestions: [
        result ? 'Contact and qualification details require independent verification.' : 'No authoritative lead profile was found.'
      ]
    };
  }

  private async searchApi(query: string, limit: number, signal?: AbortSignal) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || normalizedQuery.length > 400 || normalizedQuery.split(/\s+/).length > 50) {
      throw new Error('Brave Search query must be between 1 and 400 characters and at most 50 words.');
    }

    const url = new URL(`${this.baseUrl}/web/search`);
    url.searchParams.set('q', normalizedQuery);
    url.searchParams.set('count', String(Math.min(Math.max(Math.trunc(limit), 1), 20)));
    url.searchParams.set('country', this.country);
    url.searchParams.set('search_lang', this.searchLang);

    const response = await this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-subscription-token': this.apiKey
      },
      signal
    });

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 512);
      throw new Error(`Brave Search API HTTP ${response.status}: ${errorText}`);
    }

    const parsed = BraveSearchResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('Brave Search API returned an invalid response.');
    }
    return parsed.data;
  }

  private searchSourceUrl(companyName: string, location: string): string {
    const url = new URL('https://search.brave.com/search');
    url.searchParams.set('q', `${companyName} ${location}`);
    return url.toString();
  }

  private inferCategory(companyName: string, snippet: string): string {
    const text = `${companyName} ${snippet}`.toLowerCase();
    return /\b(gym|fitness|fit|yoga|pilates|studio)\b/.test(text) ? 'fitness' : 'unknown';
  }
}
