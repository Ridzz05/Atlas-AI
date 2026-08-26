import { lookup as defaultDnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { ResearchFreshness, ResearchSensitivity } from '../types.js';
import { isPublicIpAddress, SafeWebUrlSchema } from './url-safety.js';

export interface DnsLookupRecord {
  address: string;
  family: number;
}

export type DnsLookup = (hostname: string, options: { all: true; verbatim: true }) => Promise<DnsLookupRecord[]>;

export type PinnedRequest = (url: string, address: DnsLookupRecord, init: RequestInit) => Promise<Response>;

export interface SafeWebFetcherOptions {
  /** Test seam; production uses the pinned Node transport when this is omitted. */
  fetchImpl?: typeof fetch;
  requestImpl?: PinnedRequest;
  dnsLookup?: DnsLookup;
  maxResponseBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
  now?: () => Date;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TEXT_CONTENT_TYPES = new Set(['application/json', 'application/xhtml+xml', 'application/xml', 'text/html', 'text/plain', 'text/xml']);

export class SafeWebFetcher {
  private readonly requestImpl: PinnedRequest;
  private readonly dnsLookup: DnsLookup;
  private readonly maxResponseBytes: number;
  private readonly maxRedirects: number;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: SafeWebFetcherOptions = {}) {
    this.requestImpl = options.requestImpl || (options.fetchImpl ? (url, _address, init) => options.fetchImpl!(url, init) : requestPinned);
    this.dnsLookup = options.dnsLookup || ((hostname, lookupOptions) => defaultDnsLookup(hostname, lookupOptions));
    this.maxResponseBytes = options.maxResponseBytes ?? 100_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.now = options.now || (() => new Date());

    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error('Safe web fetch maxResponseBytes must be a positive integer.');
    }
    if (!Number.isInteger(this.maxRedirects) || this.maxRedirects < 0) {
      throw new Error('Safe web fetch maxRedirects must be a non-negative integer.');
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('Safe web fetch timeoutMs must be a positive integer.');
    }
  }

  public async fetch(
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
    let currentUrl = this.parseSafeUrl(url);

    for (let redirectCount = 0; redirectCount <= this.maxRedirects; redirectCount++) {
      const resolvedAddress = await this.assertPublicDns(currentUrl.hostname);
      const request = await this.fetchWithTimeout(currentUrl.toString(), resolvedAddress, signal);
      try {
        const response = request.response;

        if (REDIRECT_STATUSES.has(response.status)) {
          await response.body?.cancel();
          if (redirectCount === this.maxRedirects) {
            throw new Error(`Safe web fetch exceeded ${this.maxRedirects} redirects.`);
          }
          const location = response.headers.get('location');
          if (!location) throw new Error('Safe web fetch received a redirect without a location.');
          currentUrl = this.parseSafeUrl(new URL(location, currentUrl).toString());
          continue;
        }

        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`Safe web fetch HTTP ${response.status}.`);
        }

        const content = await this.readBoundedText(response);
        return {
          content,
          sourceUrl: currentUrl.toString(),
          extractedAt: this.now().toISOString(),
          freshness: 'fresh',
          sensitivity: 'public',
          unresolvedQuestions: ['Fetched content is untrusted and requires source verification.'],
          confidence: 0.5
        };
      } catch (error) {
        if (request.didTimeout()) throw new Error(`Safe web fetch timed out after ${this.timeoutMs}ms.`);
        throw error;
      } finally {
        request.cleanup();
      }
    }

    throw new Error('Safe web fetch redirect processing failed.');
  }

  private parseSafeUrl(value: string): URL {
    const parsed = SafeWebUrlSchema.safeParse(value);
    if (!parsed.success) throw new Error('Safe web fetch requires a credential-free HTTP(S) URL with a public hostname.');
    return new URL(parsed.data);
  }

  private async assertPublicDns(hostname: string): Promise<DnsLookupRecord> {
    let records: DnsLookupRecord[];
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;
    try {
      records = await Promise.race([
        this.dnsLookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            reject(new Error('DNS lookup timed out.'));
          }, this.timeoutMs);
        })
      ]);
    } catch {
      if (timedOut) throw new Error(`Safe web fetch timed out after ${this.timeoutMs}ms.`);
      throw new Error(`Safe web fetch could not resolve public hostname '${hostname}'.`);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (!records.length || records.some(record => !isPublicIpAddress(record.address))) {
      throw new Error(`Safe web fetch rejected private or non-public DNS result for '${hostname}'.`);
    }
    const firstRecord = records[0];
    if (!firstRecord) throw new Error(`Safe web fetch could not resolve public hostname '${hostname}'.`);
    return firstRecord;
  }

  private async fetchWithTimeout(
    url: string,
    address: DnsLookupRecord,
    signal?: AbortSignal
  ): Promise<{ response: Response; didTimeout: () => boolean; cleanup: () => void }> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) {
      controller.abort(signal.reason);
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Safe web fetch timed out after ${this.timeoutMs}ms.`));
    }, this.timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };

    try {
      const response = await this.requestImpl(url, address, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          Accept: 'text/html, application/xhtml+xml, application/json, application/xml, text/plain, text/xml'
        },
        signal: controller.signal
      });
      return { response, didTimeout: () => timedOut, cleanup };
    } catch (error) {
      cleanup();
      if (timedOut) throw new Error(`Safe web fetch timed out after ${this.timeoutMs}ms.`);
      throw error;
    }
  }

  private async readBoundedText(response: Response): Promise<string> {
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType && !TEXT_CONTENT_TYPES.has(contentType)) {
      await response.body?.cancel();
      throw new Error(`Safe web fetch rejected unsupported content type '${contentType}'.`);
    }

    const contentLength = response.headers.get('content-length');
    const parsedLength = contentLength ? Number(contentLength) : NaN;
    if (Number.isSafeInteger(parsedLength) && parsedLength > this.maxResponseBytes) {
      await response.body?.cancel();
      throw new Error(`Safe web fetch response exceeds ${this.maxResponseBytes} bytes.`);
    }

    if (!response.body) {
      const text = await response.text();
      this.assertTextSize(text);
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > this.maxResponseBytes) {
          await reader.cancel();
          throw new Error(`Safe web fetch response exceeds ${this.maxResponseBytes} bytes.`);
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } finally {
      reader.releaseLock();
    }
  }

  private assertTextSize(text: string): void {
    if (new TextEncoder().encode(text).byteLength > this.maxResponseBytes) {
      throw new Error(`Safe web fetch response exceeds ${this.maxResponseBytes} bytes.`);
    }
  }
}

function requestPinned(url: string, address: DnsLookupRecord, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const requestFunction = parsed.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = new Headers(init.headers);
  headers.set('host', parsed.host);

  return new Promise((resolve, reject) => {
    const request = requestFunction(
      {
        protocol: parsed.protocol,
        hostname: address.address,
        family: address.family,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method || 'GET',
        headers: Object.fromEntries(headers.entries()),
        signal: init.signal || undefined,
        ...(parsed.protocol === 'https:' ? { servername: parsed.hostname.replace(/^\[|\]$/g, '') } : {})
      },
      response => {
        const status = response.statusCode || 0;
        if (status < 200 || status > 599) {
          response.resume();
          reject(new Error(`Safe web fetch received invalid HTTP status ${status}.`));
          return;
        }

        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) responseHeaders.append(name, item);
          } else if (value !== undefined) {
            responseHeaders.set(name, value);
          }
        }

        const hasNoBody = status === 204 || status === 205 || status === 304;
        if (hasNoBody) response.resume();
        const body = hasNoBody ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
        resolve(
          new Response(body, {
            status,
            statusText: response.statusMessage,
            headers: responseHeaders
          })
        );
      }
    );
    request.once('error', reject);
    request.end();
  });
}
