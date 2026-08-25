import { z } from 'zod';
import { ToolDefinition } from '../types.js';

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
      url: z.string(),
      snippet: z.string(),
      confidence: z.number()
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
  outputSchema: z.object({
    configured: z.boolean(),
    found: z.boolean(),
    companyName: z.string(),
    address: z.string(),
    phone: z.string().optional(),
    instagram: z.string().optional(),
    estimatedMembers: z.number().optional(),
    warning: z.string().optional()
  }),
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
