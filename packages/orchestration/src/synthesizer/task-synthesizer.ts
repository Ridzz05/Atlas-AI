import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { QAResult } from '../qa/qa-gate.js';
import { rootLogger } from '@atlas/observability';
import { MessageRepository } from '@atlas/database';
import type { AgentRunner } from '../engine/agent-runner.js';

export interface TaskSynthesizerOptions {
  provider: ModelProvider;
  chiefAgent: AgentDefinition;
  messageRepo?: MessageRepository;
  runner?: AgentRunner;
}

export class TaskSynthesizer {
  constructor(private options: TaskSynthesizerOptions) {}

  public async synthesize(
    parentTask: Task,
    specialistResults: Map<string, { agentId: string; content: string }>,
    qaResult?: QAResult,
    signal?: AbortSignal,
    onCost?: (costUsd: number) => void
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

    let resultContent: string;
    let costUsd = 0;
    if (this.options.runner) {
      const result = await this.runThroughDurableRunner(parentTask, prompt, signal);
      resultContent = result.content;
      costUsd = result.costUsd;
    } else {
      const result = await this.options.provider.run({
        runId: crypto.randomUUID(),
        agentId: 'chief',
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: this.options.chiefAgent.systemPrompt,
        signal
      });
      resultContent = result.content;
      costUsd = result.costUsd;
    }
    onCost?.(costUsd);

    if (this.options.messageRepo) {
      const executiveDialogue = `[Chief ➔ Operator]: Seluruh workflow spesialis dan audit Argus telah tuntas dievaluasi. Berikut laporan hasil eksekutif:\n\n${resultContent}`;
      await this.options.messageRepo.create({
        taskId: parentTask.id,
        senderType: 'agent',
        senderId: 'chief',
        recipientId: 'user',
        content: executiveDialogue,
        metadata: { stage: 'synthesis' }
      });
    }

    return resultContent;
  }

  private async runThroughDurableRunner(task: Task, prompt: string, signal?: AbortSignal): Promise<{ content: string; costUsd: number }> {
    const summary = await this.options.runner!.run({
      task,
      agent: this.options.chiefAgent,
      initialPrompt: prompt,
      signal
    });
    if (summary.status !== 'completed') {
      throw new Error(`Synthesis run failed: ${summary.error || summary.status}`);
    }
    return { content: summary.finalContent, costUsd: summary.totalCostUsd };
  }
}
