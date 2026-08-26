import { z } from 'zod';
import { isIP } from 'node:net';
import { ToolDefinition } from '../types.js';

const ResearchEvidenceSchema = z.object({
  extractedAt: z.string().datetime({ offset: true }),
  freshness: z.enum(['fresh', 'aging', 'stale', 'unknown']),
  sensitivity: z.enum(['public', 'internal', 'sensitive']),
  unresolvedQuestions: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1)
});

function isSafePublicWebUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    return false;
  }

  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!hostname || isIP(hostname) !== 0) {
    return false;
  }

  return hostname !== 'localhost' && !hostname.endsWith('.localhost') && !hostname.endsWith('.local') && !hostname.endsWith('.internal');
}

const SafeWebUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine(isSafePublicWebUrl, 'Only credential-free HTTP(S) URLs with a public hostname are allowed.');

const WebFetchUnavailableSchema = z.object({
  configured: z.literal(false),
  url: SafeWebUrlSchema,
  content: z.null(),
  warning: z.string()
});

const WebFetchConfiguredSchema = z.object({
  configured: z.literal(true),
  url: SafeWebUrlSchema,
  sourceUrl: SafeWebUrlSchema,
  content: z.string().max(100_000),
  contentIsUntrusted: z.literal(true),
  ...ResearchEvidenceSchema.shape,
  warning: z.string().optional()
});

const CompanyLookupUnavailableSchema = z.object({
  configured: z.literal(false),
  found: z.literal(false),
  companyName: z.string(),
  address: z.string(),
  warning: z.string()
});

const CompanyLookupConfiguredSchema = z.object({
  configured: z.literal(true),
  found: z.boolean(),
  companyName: z.string(),
  address: z.string(),
  phone: z.string().optional(),
  instagram: z.string().optional(),
  estimatedMembers: z.number().optional(),
  sourceUrl: SafeWebUrlSchema,
  ...ResearchEvidenceSchema.shape,
  warning: z.string().optional()
});

const LeadEnrichmentUnavailableSchema = z.object({
  configured: z.literal(false),
  found: z.literal(false),
  companyName: z.string(),
  location: z.string(),
  warning: z.string()
});

const LeadEnrichmentConfiguredSchema = z.object({
  configured: z.literal(true),
  found: z.boolean(),
  companyName: z.string(),
  location: z.string(),
  category: z.string(),
  phone: z.string().optional(),
  instagram: z.string().optional(),
  estimatedMembers: z.number().nonnegative().optional(),
  sourceUrl: SafeWebUrlSchema,
  ...ResearchEvidenceSchema.shape,
  warning: z.string().optional()
});

export const WebSearchTool: ToolDefinition = {
  name: 'web.search',
  description: 'Search external web sources for verified company or business information.',
  inputSchema: z.object({
    query: z.string().min(1),
    limit: z.number().int().min(1).max(50).default(10)
  }),
  outputSchema: z.object({
    configured: z.boolean(),
    results: z.array(
      z.object({
        title: z.string(),
        url: SafeWebUrlSchema,
        snippet: z.string(),
        ...ResearchEvidenceSchema.shape
      })
    ),
    warning: z.string().optional()
  }),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 10000,
  async execute(ctx, input) {
    if (!ctx.researchProvider) {
      return {
        configured: false,
        results: [],
        warning: 'No verified research provider is configured; no external facts were returned.'
      };
    }

    return {
      configured: true,
      results: await ctx.researchProvider.search(input.query, input.limit, ctx.signal)
    };
  }
};

export const WebFetchTool: ToolDefinition = {
  name: 'web.fetch_safe',
  description: 'Fetch a bounded web document through an approved safe provider; content remains untrusted data.',
  inputSchema: z.object({
    url: SafeWebUrlSchema
  }),
  outputSchema: z.union([WebFetchUnavailableSchema, WebFetchConfiguredSchema]),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 10000,
  async execute(ctx, input) {
    if (!ctx.researchProvider?.fetchSafe) {
      return {
        configured: false,
        url: input.url,
        content: null,
        warning: 'No verified safe web provider is configured; no external content was returned.'
      };
    }

    return {
      configured: true,
      url: input.url,
      contentIsUntrusted: true,
      ...(await ctx.researchProvider.fetchSafe(input.url, ctx.signal))
    };
  }
};

export const CompanyLookupTool: ToolDefinition = {
  name: 'company.lookup',
  description: 'Look up structured company profile, contacts, and verification details.',
  inputSchema: z.object({
    companyName: z.string().min(1),
    location: z.string().default('Palembang')
  }),
  outputSchema: z.union([CompanyLookupUnavailableSchema, CompanyLookupConfiguredSchema]),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 5000,
  async execute(ctx, input) {
    if (!ctx.researchProvider) {
      return {
        configured: false,
        found: false,
        companyName: input.companyName,
        address: '',
        warning: 'No verified company lookup provider is configured; no company facts were returned.'
      };
    }

    return {
      configured: true,
      ...(await ctx.researchProvider.lookupCompany(input.companyName, input.location, ctx.signal))
    };
  }
};

export const LeadEnrichmentTool: ToolDefinition = {
  name: 'lead.enrich',
  description: 'Enrich a prospective lead with provider-backed, source-aware business details.',
  inputSchema: z.object({
    companyName: z.string().min(1),
    location: z.string().min(1).default('Palembang')
  }),
  outputSchema: z.union([LeadEnrichmentUnavailableSchema, LeadEnrichmentConfiguredSchema]),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 10000,
  async execute(ctx, input) {
    if (!ctx.researchProvider?.enrichLead) {
      return {
        configured: false,
        found: false,
        companyName: input.companyName,
        location: input.location,
        warning: 'No verified lead enrichment provider is configured; no lead facts were returned.'
      };
    }

    return {
      configured: true,
      ...(await ctx.researchProvider.enrichLead(input.companyName, input.location, ctx.signal))
    };
  }
};
