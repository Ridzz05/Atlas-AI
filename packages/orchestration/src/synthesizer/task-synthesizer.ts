import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { QAResult } from '../qa/qa-gate.js';
import { rootLogger } from '@atlas/observability';
import { MessageRepository } from '@atlas/database';

export interface TaskSynthesizerOptions {
  provider: ModelProvider;
  chiefAgent: AgentDefinition;
  messageRepo?: MessageRepository;
}

export class TaskSynthesizer {
  constructor(private options: TaskSynthesizerOptions) {}

  public async synthesize(
    parentTask: Task,
    specialistResults: Map<string, { agentId: string; content: string }>,
    qaResult?: QAResult,
    signal?: AbortSignal
  ): Promise<string> {
    rootLogger.info(`Synthesizing results for task ${parentTask.id}`);

    const formattedResults: string[] = [];
    for (const [stepId, res] of specialistResults.entries()) {
      formattedResults.push(`### Subtask ${stepId} (by ${res.agentId})\n${res.content}\n`);
    }

    const qaSummary = qaResult
      ? `QA Gate Verdict: ${qaResult.verdict}\nFindings: ${qaResult.findings.join('; ')}`
      : 'QA Gate: Not applicable';

    const prompt = `You are Chief, the root orchestrator of ATLAS AI OS.
Synthesize the final executive response for the human user based on the completed specialist agent subtasks.

USER GOAL:
"${parentTask.goal}"

SPECIALIST OUTPUTS:
${formattedResults.join('\n---\n')}

QA VERDICT:
${qaSummary}

INSTRUCTIONS:
1. Provide a clear, executive summary directly answering the user's goal.
2. Highlight key deliverables, metrics, and actionable recommendations.
3. If human approval is required for next actions (such as sending messages), state this explicitly.
4. Keep the presentation concise, structured, and easy to read.`;

    const result = await this.options.provider.run({
      runId: crypto.randomUUID(),
      agentId: 'chief',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: this.options.chiefAgent.systemPrompt,
      signal
    });

    if (this.options.messageRepo) {
      await this.options.messageRepo.create({
        taskId: parentTask.id,
        senderType: 'user',
        senderId: 'system.synthesis',
        content: prompt,
        metadata: { stage: 'synthesis' }
      });
      await this.options.messageRepo.create({
        taskId: parentTask.id,
        senderType: 'agent',
        senderId: 'chief',
        content: result.content,
        metadata: { stage: 'synthesis' }
      });
    }

    return result.content;
  }
}
