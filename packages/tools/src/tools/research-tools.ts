import { z } from 'zod';
import { ToolDefinition } from '../types.js';

const ResearchEvidenceSchema = z.object({
  extractedAt: z.string().datetime({ offset: true }),
  freshness: z.enum(['fresh', 'aging', 'stale', 'unknown']),
  sensitivity: z.enum(['public', 'internal', 'sensitive']),
  unresolvedQuestions: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1)
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
  sourceUrl: z.string().url(),
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
    results: z.array(z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
      ...ResearchEvidenceSchema.shape
    })),
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
      results: await ctx.researchProvider.search(input.query, input.limit)
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
      ...(await ctx.researchProvider.lookupCompany(input.companyName, input.location))
    };
  }
};
