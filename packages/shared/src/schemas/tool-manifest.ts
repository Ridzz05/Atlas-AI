import { z } from 'zod';
import { ToolRiskLevelSchema } from './tool.js';

export const ToolCapabilitySchema = z.enum([
  'research',
  'memory',
  'artifacts',
  'policy',
  'communication',
  'lead_scoring',
  'planning',
  'qa',
  'integration'
]);
export type ToolCapability = z.infer<typeof ToolCapabilitySchema>;

export const IdempotencyRequirementSchema = z.enum(['none', 'supported', 'required']);
export type IdempotencyRequirement = z.infer<typeof IdempotencyRequirementSchema>;

export const SideEffectSchema = z.enum([
  'none',
  /**
   * The tool's side effects were never declared.
   *
   * `registerLegacy` synthesises a manifest for tools that predate the manifest, and it cannot know
   * what they do. `'none'` would be the least conservative claim available — it asserted "no side
   * effects" about tools that make network requests. Any consumer gating on side effects must treat
   * `'unknown'` as fail-closed.
   */
  'unknown',
  'read_external',
  'write_external',
  'network',
  'process_spawn',
  'filesystem_write',
  'database_write',
  'send_message',
  'publish',
  'deploy',
  'payment'
]);
export type SideEffect = z.infer<typeof SideEffectSchema>;

export const ToolManifestSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().nonnegative().default(1),
  capability: ToolCapabilitySchema,
  description: z.string().min(1),
  sideEffects: z.array(SideEffectSchema).default(['none']),
  riskLevel: ToolRiskLevelSchema,
  idempotency: IdempotencyRequirementSchema.default('none'),
  requiredConnectionScopes: z.array(z.string()).default([]),
  scopes: z.array(z.string()).default([]),
  isIdempotentByDefault: z.boolean().default(false),
  approval: z.enum(['auto', 'human', 'policy']).default('policy'),
  timeoutMs: z.number().int().nonnegative().default(10_000)
});
export type ToolManifest = z.infer<typeof ToolManifestSchema>;
