import type { ResearchProvider } from '../types.js';
import { BraveResearchProvider } from './brave-provider.js';
import { ChromiumResearchProvider } from './chromium-provider.js';

export interface ResearchProviderConfig {
  providerType?: string;
  apiKey?: string;
  country?: string;
  searchLang?: string;
}

export function createResearchProvider(config: ResearchProviderConfig = {}): ResearchProvider | undefined {
  const type = (config.providerType || process.env.RESEARCH_PROVIDER || 'none').toLowerCase();

  switch (type) {
    case 'none':
      return undefined;
    case 'brave':
      return new BraveResearchProvider({
        apiKey: config.apiKey || process.env.RESEARCH_API_KEY || '',
        country: config.country || process.env.RESEARCH_COUNTRY,
        searchLang: config.searchLang || process.env.RESEARCH_SEARCH_LANG
      });
    case 'chromium':
      return new ChromiumResearchProvider();
    default:
      throw new Error(`Unsupported research provider: ${type}`);
  }
}
