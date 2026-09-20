import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { rootLogger } from '@atlas/observability';
import { MessageRepository } from '@atlas/database';
import type { AgentRunner } from '../engine/agent-runner.js';

export type QAVerdict = 'PASS' | 'PASS_WITH_WARNINGS' | 'REVISION_REQUIRED' | 'BLOCKED';

export interface QAResult {
  verdict: QAVerdict;
  findings: string[];
  recommendations: string[];
  passed: boolean;
}

export interface QAGateOptions {
  provider: ModelProvider;
  argusAgent: AgentDefinition;
  messageRepo?: MessageRepository;
  runner?: AgentRunner;
}

export class QAGate {
  constructor(private options: QAGateOptions) {}

  public async evaluate(
    parentTask: Task,
    specialistResults: Map<string, { agentId: string; content: string }>,
    signal?: AbortSignal,
    onCost?: (costUsd: number) => void
  ): Promise<QAResult> {
    rootLogger.info(`Running Argus QA verification for task ${parentTask.id}`);

    const contextSnippets: string[] = [];
    for (const [stepId, res] of specialistResults.entries()) {
      contextSnippets.push(`[Step: ${stepId} | Agent: ${res.agentId}]\n${res.content}\n`);
    }

    const prompt = `You are Argus, the QA & Verification Specialist for ATLAS AI OS.
Inspect the following outputs produced by the specialist agent team for the user's task.

ORIGINAL GOAL:
"${parentTask.goal}"

SPECIALIST OUTPUTS:
${contextSnippets.join('\n---\n')}

EVALUATION CHECKLIST:
1. Factuality & Citations: Are claims supported by concrete evidence or sources?
2. Calculations: Are lead scores and arithmetic consistent?
3. Tone & Brand Voice: Is content professional and non-hallucinatory?
4. Safety & Policy: Are there any unauthorized actions, financial operations, or direct sends?

Output your evaluation strictly in valid JSON matching:
{
  "verdict": "PASS" | "PASS_WITH_WARNINGS" | "REVISION_REQUIRED" | "BLOCKED",
  "findings": ["..."],
  "recommendations": ["..."]
}

RULES:
- If evidence is sound and no risks exist, choose PASS.
- If minor data is missing but safe to proceed, choose PASS_WITH_WARNINGS.
- If numbers or claims are dubious, choose REVISION_REQUIRED.
- If policy or forbidden actions are attempted, choose BLOCKED.`;

    let modelContent: string;
    let costUsd = 0;
    if (this.options.runner) {
      const result = await this.runThroughDurableRunner(parentTask, prompt, signal);
      modelContent = result.content;
      costUsd = result.costUsd;
    } else {
      const result = await this.options.provider.run({
        runId: crypto.randomUUID(),
        agentId: 'argus',
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: this.options.argusAgent.systemPrompt,
        signal
      });
      modelContent = result.content;
      costUsd = result.costUsd;
    }
    onCost?.(costUsd);

    try {
      const cleaned = modelContent
        .replace(/```json\s*/g, '')
        .replace(/```\s*$/g, '')
        .trim();
      const parsed = JSON.parse(cleaned) as {
        verdict?: unknown;
        findings?: unknown;
        recommendations?: unknown;
      };
      const allowedVerdicts: QAVerdict[] = ['PASS', 'PASS_WITH_WARNINGS', 'REVISION_REQUIRED', 'BLOCKED'];
      if (!allowedVerdicts.includes(parsed.verdict as QAVerdict)) {
        return {
          verdict: 'BLOCKED',
          findings: [`Argus returned invalid verdict: ${String(parsed.verdict)}`],
          recommendations: ['Rerun QA evaluation.'],
          passed: false
        };
      }

      const findings = Array.isArray(parsed.findings) ? (parsed.findings as string[]) : [];
      const recommendations = Array.isArray(parsed.recommendations) ? (parsed.recommendations as string[]) : [];
      const verdict = parsed.verdict as QAVerdict;
      const passed = verdict === 'PASS' || verdict === 'PASS_WITH_WARNINGS';

      if (this.options.messageRepo) {
        const findingsList = findings.length > 0 ? findings.map(f => `• ${f}`).join('\n') : 'Semua komponen memenuhi standar kualifikasi.';
        const recommendationsList =
          recommendations.length > 0 ? recommendations.map(r => `• ${r}`).join('\n') : 'Tidak ada catatan koreksi.';
        const qaDialogue = `[Argus ➔ Chief]: Audit Kualitas & Gerbang Risiko Selesai.\n\nVerdict: ${verdict}\nStatus: ${passed ? 'PASSED ✅' : 'REJECTED/BLOCKED ❌'}\n\nTemuan:\n${findingsList}\n\nRekomendasi:\n${recommendationsList}`;

        await this.options.messageRepo.create({
          taskId: parentTask.id,
          senderType: 'agent',
          senderId: 'argus',
          recipientId: 'chief',
          content: qaDialogue,
          metadata: { stage: 'qa', verdict }
        });
      }

      return {
        verdict,
        findings,
        recommendations,
        passed
      };
    } catch {
      return {
        verdict: 'BLOCKED',
        findings: ['Argus response was not valid JSON.'],
        recommendations: ['Review the QA provider response before finalizing this task.'],
        passed: false
      };
    }
  }

  private async runThroughDurableRunner(task: Task, prompt: string, signal?: AbortSignal): Promise<{ content: string; costUsd: number }> {
    const summary = await this.options.runner!.run({
      task,
      agent: this.options.argusAgent,
      initialPrompt: prompt,
      signal
    });
    if (summary.status !== 'completed') {
      throw new Error(`QA run failed: ${summary.error || summary.status}`);
    }
    return { content: summary.finalContent, costUsd: summary.totalCostUsd };
  }
}
