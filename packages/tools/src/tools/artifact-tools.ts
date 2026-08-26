import { z } from 'zod';
import { ToolDefinition } from '../types.js';
import { ArtifactService } from '../artifacts/artifact-service.js';

export function createArtifactTools(artifactService: ArtifactService): ToolDefinition[] {
  const readTool: ToolDefinition = {
    name: 'artifacts.read',
    description: 'Read the contents of a saved artifact file.',
    inputSchema: z.object({
      name: z.string().min(1)
    }),
    outputSchema: z.object({
      found: z.boolean(),
      content: z.string().nullable()
    }),
    riskLevel: 'read',
    requiresApproval: false,
    timeoutMs: 3000,
    async execute(_ctx, input) {
      const content = artifactService.read(input.name);
      return {
        found: content !== null,
        content
      };
    }
  };

  const writeTool: ToolDefinition = {
    name: 'artifacts.write',
    description: 'Save output content as an artifact file in the storage directory.',
    inputSchema: z.object({
      name: z.string().min(1),
      content: z.string(),
      mimeType: z.string().default('text/plain')
    }),
    outputSchema: z.object({
      name: z.string(),
      filePath: z.string(),
      sizeBytes: z.number()
    }),
    riskLevel: 'low',
    requiresApproval: false,
    timeoutMs: 5000,
    async execute(ctx, input) {
      const meta = artifactService.save(input.name, input.content, input.mimeType);
      await artifactService.recordMetadata(meta, {
        taskId: ctx.taskId,
        runId: ctx.runId
      });
      return {
        name: meta.name,
        filePath: meta.filePath,
        sizeBytes: meta.sizeBytes
      };
    }
  };

  return [readTool, writeTool];
}
