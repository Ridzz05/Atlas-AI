import { describe, expect, it } from 'vitest';
import { CreateDraftTool, ToolRegistry } from '@atlas/tools';
import { ToolGatewayExecutor } from '../src/index.js';

describe('ToolGatewayExecutor', () => {
  it('routes model tool calls through the policy-enforcing registry', async () => {
    const registry = new ToolRegistry();
    registry.registerLegacy(CreateDraftTool);
    const executor = new ToolGatewayExecutor({ registry });

    const result = await executor.execute(
      {
        id: 'tool-call-1',
        name: 'communication.create_draft',
        arguments: {
          recipient: '+62812345678',
          channel: 'whatsapp',
          content: 'Draft only'
        }
      },
      {
        taskId: 'task-1',
        runId: 'run-1',
        agentId: 'hermes',
        allowedTools: ['communication.create_draft']
      }
    );

    expect(result.success).toBe(true);
    expect((result.output as { status: string }).status).toBe('draft_created');
  });
});
