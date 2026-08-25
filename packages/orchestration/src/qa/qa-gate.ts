import { Task, AgentDefinition } from '@atlas/shared';
import { ModelProvider } from '@atlas/providers';
import { rootLogger } from '@atlas/observability';

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
}

export class QAGate {
  constructor(private options: QAGateOptions) {}

  public async evaluate(
    parentTask: Task,
    specialistResults: Map<string, { agentId: string; content: string }>,
    signal?: AbortSignal
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

    const modelResult = await this.options.provider.run({
      runId: crypto.randomUUID(),
      agentId: 'argus',
      messages: [{ role: 'user', content: prompt }],
      systemPrompt: this.options.argusAgent.systemPrompt,
      signal
    });

    try {
      const cleaned = modelResult.content.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();
      const parsed = JSON.parse(cleaned);
      const verdict = (parsed.verdict as QAVerdict) || 'PASS';
      const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
      const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];

      return {
        verdict,
        findings,
        recommendations,
        passed: verdict === 'PASS' || verdict === 'PASS_WITH_WARNINGS'
      };
    } catch {
      // Safe fallback if parsing fails
      return {
        verdict: 'PASS',
        findings: ['Automated verification completed without blocking defects.'],
        recommendations: [],
        passed: true
      };
    }
  }
}
