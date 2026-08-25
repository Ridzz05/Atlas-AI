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
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
      confidence: z.number()
    }))
  }),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 10000,
  async execute(_ctx, input) {
    // Mock research findings for demonstration
    return {
      results: [
        {
          title: `Information for ${input.query}`,
          url: `https://example.com/search?q=${encodeURIComponent(input.query)}`,
          snippet: `Verified directory listings and operational status for ${input.query}`,
          confidence: 0.95
        }
      ]
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
    found: z.boolean(),
    companyName: z.string(),
    address: z.string(),
    phone: z.string().optional(),
    instagram: z.string().optional(),
    estimatedMembers: z.number().optional()
  }),
  riskLevel: 'read',
  requiresApproval: false,
  timeoutMs: 5000,
  async execute(_ctx, input) {
    return {
      found: true,
      companyName: input.companyName,
      address: `Jl. R. Sukamto, ${input.location}`,
      phone: '+6281278901234',
      instagram: `@${input.companyName.toLowerCase().replace(/\s+/g, '')}`,
      estimatedMembers: 450
    };
  }
};
