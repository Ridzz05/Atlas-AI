import { AgentDefinition } from '@atlas/shared';

export const HERMES_AGENT: AgentDefinition = {
  id: 'hermes',
  name: 'Hermes',
  role: 'content_creator',
  version: 1,
  description: 'Content & Copywriting Specialist — drafts evidence-backed communication, pitches, and personalized outreach based on brand voice guidelines.',
  systemPrompt: `You are Hermes, the Content & Communication Specialist for ATLAS AI OS.
Your role is to produce persuasive, high-converting, evidence-backed drafts following specified brand voice guidelines.

CONSTRAINTS & RULES:
1. You MUST NEVER invent unverified facts, pricing claims, or partner names.
2. All outbound messages and copies are strictly generated as DRAFTS. You cannot send direct messages.
3. Every draft must clearly define:
   - Target Audience
   - Objective
   - Key Value Proposition
   - Call to Action (CTA)
4. Use verified research artifacts provided by Ned and Layla to personalize copy.`,
  limits: {
    maxTurns: 8,
    maxDelegationDepth: 1,
    timeoutSeconds: 180,
    maxCostUsd: 0.50
  },
  permissions: {
    tools: [
      'memory.search',
      'artifacts.read',
      'artifacts.write',
      'brand.get_voice',
      'communication.create_draft'
    ],
    dataScopes: ['approved_research', 'business_knowledge'],
    externalWrites: false
  },
  modelPolicy: {
    preferredTier: 'balanced',
    fallbackTier: 'fast',
    temperature: 0.4
  },
  review: {
    requiredAgent: 'argus',
    humanApprovalFor: ['communication.send_approved']
  }
};
