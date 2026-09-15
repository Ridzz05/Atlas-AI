import { describe, it, expect } from 'vitest';
import { findChromiumPath, ChromiumResearchProvider } from '../src/research/chromium-provider.js';
import { createResearchProvider } from '../src/research/factory.js';

describe('ChromiumResearchProvider', () => {
  it('detects a valid Chromium/Chrome executable path on Windows host', () => {
    const execPath = findChromiumPath();
    expect(execPath).toBeTruthy();
    expect(typeof execPath).toBe('string');
  });

  it('creates ChromiumResearchProvider via factory', () => {
    const provider = createResearchProvider({ providerType: 'chromium' });
    expect(provider).toBeInstanceOf(ChromiumResearchProvider);
  });

  it('rejects unsafe local URLs on fetchSafe', async () => {
    const provider = new ChromiumResearchProvider();
    await expect(provider.fetchSafe('http://127.0.0.1:8080/secret')).rejects.toThrow(
      /is not a permitted public web URL/
    );
    await expect(provider.fetchSafe('http://localhost:3000')).rejects.toThrow(
      /is not a permitted public web URL/
    );
  });
});
