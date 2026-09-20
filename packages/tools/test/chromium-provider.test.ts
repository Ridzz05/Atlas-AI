import { describe, it, expect } from 'vitest';
import { findChromiumPath, ChromiumResearchProvider } from '../src/research/chromium-provider.js';
import { createResearchProvider } from '../src/research/factory.js';

describe('ChromiumResearchProvider', () => {
  it('detects a valid Chromium/Chrome executable path on Windows host', () => {
    const execPath = findChromiumPath();
    expect(execPath).toBeTruthy();
    expect(typeof execPath).toBe('string');
  });

  // fetchSafe used to gate only on `isSafePublicWebUrl(url)` — a pure string check on the literal
  // hostname — and then hand the URL to a headless browser that followed redirects. Any
  // public-looking name that resolves to a private address was fetched, so a research agent could
  // reach the cloud metadata endpoint or an internal service. The resolved address is now checked
  // before navigation, and every request the page makes is re-checked.
  it('refuses to fetch a host that resolves to a private address', async () => {
    const provider = new ChromiumResearchProvider({
      resolveAddresses: async () => ['127.0.0.1']
    });

    await expect(provider.fetchSafe('https://localtest.example/')).rejects.toThrow(/private or reserved/);
  });

  it('refuses when any resolved address is private, not only the first', async () => {
    const provider = new ChromiumResearchProvider({
      resolveAddresses: async () => ['93.184.216.34', '169.254.169.254']
    });

    await expect(provider.fetchSafe('https://roundrobin.example/')).rejects.toThrow(/private or reserved/);
  });

  it('fails closed when the hostname does not resolve at all', async () => {
    const provider = new ChromiumResearchProvider({
      resolveAddresses: async () => {
        throw new Error('ENOTFOUND');
      }
    });

    await expect(provider.fetchSafe('https://nowhere.invalid/')).rejects.toThrow(/could not be resolved/);
  });

  it('creates ChromiumResearchProvider via factory', () => {
    const provider = createResearchProvider({ providerType: 'chromium' });
    expect(provider).toBeInstanceOf(ChromiumResearchProvider);
  });

  it('rejects unsafe local URLs on fetchSafe', async () => {
    const provider = new ChromiumResearchProvider();
    await expect(provider.fetchSafe('http://127.0.0.1:8080/secret')).rejects.toThrow(/is not a permitted public web URL/);
    await expect(provider.fetchSafe('http://localhost:3000')).rejects.toThrow(/is not a permitted public web URL/);
  });
});
