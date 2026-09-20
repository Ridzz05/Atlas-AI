import {
  SDLCInitiative,
  SDLCPhase,
  StrategicBriefSchema,
  TechnicalSpecSchema,
  BudgetEnvelopeSchema,
  SprintPlanSchema,
  QAReportSchema
} from '@atlas/shared';

/**
 * Prompt construction and result parsing for the SDLC phases.
 *
 * Kept separate from the engine so both halves are testable without a provider: the engine
 * only decides *which* phase runs next, and this module owns *what is asked* and *how the
 * answer is read*.
 *
 * Parsing is strict and fail-closed. The previous implementation substituted a hardcoded
 * object when the model's response could not be parsed — including `financialApproval:
 * 'approved'` and `verdict: 'PASS'` — so a truncated response auto-approved a budget and
 * passed a compliance audit. Here a parse failure is reported as a failure and the caller
 * pauses the initiative for human review.
 */

export type PhaseParseResult = { ok: true; artifact: Record<string, unknown> } | { ok: false; reason: string };

/** Extracts a JSON object from a model response. Returns null when there is none. */
export function extractJsonObject(text: string): unknown | null {
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(text.trim());

  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // try the next candidate
    }
  }

  return null;
}

/**
 * Structural type for the validators, so this package does not need a direct zod
 * dependency just to name the return shape.
 */
type PhaseSchema = {
  safeParse: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: { errors: Array<{ message: string }> };
  };
};

const PHASE_SCHEMAS: Partial<Record<SDLCPhase, PhaseSchema>> = {
  inception: StrategicBriefSchema,
  architecture: TechnicalSpecSchema,
  budget_gate: BudgetEnvelopeSchema,
  sprint_planning: SprintPlanSchema,
  qa_compliance: QAReportSchema
};

export function parsePhaseOutput(phase: SDLCPhase, text: string): PhaseParseResult {
  const schema = PHASE_SCHEMAS[phase];

  // `implementation` and `release_signoff` produce work, not a structured verdict: the
  // delegated specialists already wrote their results into the task, so there is nothing
  // to parse and nothing to auto-approve.
  if (!schema) return { ok: true, artifact: {} };

  const raw = extractJsonObject(text);
  if (!raw) {
    return { ok: false, reason: `Phase '${phase}' produced no parsable JSON object.` };
  }

  const validated = schema.safeParse(raw);
  if (!validated.success) {
    const detail = (validated.error?.errors ?? []).map(issue => issue.message).join('; ');
    return { ok: false, reason: `Phase '${phase}' output failed schema validation: ${detail}` };
  }

  return { ok: true, artifact: (validated.data ?? {}) as Record<string, unknown> };
}

export function buildPhasePrompt(phase: SDLCPhase, initiative: SDLCInitiative): string {
  const context = [
    `INITIATIVE: ${initiative.title}`,
    `INTENT: ${initiative.intent}`,
    initiative.strategicBrief ? `STRATEGIC BRIEF:\n${JSON.stringify(initiative.strategicBrief, null, 2)}` : null,
    initiative.technicalSpec ? `TECHNICAL SPEC:\n${JSON.stringify(initiative.technicalSpec, null, 2)}` : null,
    initiative.budgetEnvelope ? `BUDGET ENVELOPE:\n${JSON.stringify(initiative.budgetEnvelope, null, 2)}` : null,
    initiative.sprintPlan ? `SPRINT PLAN:\n${JSON.stringify(initiative.sprintPlan, null, 2)}` : null,
    initiative.artifacts.length > 0 ? `ARTIFACTS PRODUCED SO FAR:\n${JSON.stringify(initiative.artifacts, null, 2)}` : null
  ]
    .filter(Boolean)
    .join('\n\n');

  switch (phase) {
    case 'inception':
      return `You are the CEO of the enterprise.
Turn the following initiative into a Strategic Brief: the business problem, the target
audience, the objectives, and the acceptance criteria that will decide whether the work
succeeded.

${context}

Respond with ONLY a JSON object matching this shape:
{
  "title": "Short initiative title",
  "executiveSummary": "Why this matters, in two or three sentences.",
  "problemStatement": "The concrete problem being solved.",
  "targetAudience": "Who this is for.",
  "keyObjectives": ["Objective 1", "Objective 2"],
  "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
  "strategicPriority": "critical" | "high" | "medium" | "low"
}`;

    case 'architecture':
      return `You are the CTO of the enterprise.
Review the Strategic Brief and establish the technical specification: the component
architecture, the capabilities required, the tools the work will need, the tools it must
never use, and the security boundaries.

${context}

Respond with ONLY a JSON object matching this shape:
{
  "architectureSummary": "Technical approach and components.",
  "requiredCapabilities": ["research", "data_analysis"],
  "allowedTools": ["web.search", "artifacts.write"],
  "disallowedTools": ["communication.send_approved"],
  "securityConsiderations": ["Rule 1", "Rule 2"],
  "technicalFeasibility": "approved" | "rejected" | "needs_revision"
}
Set technicalFeasibility to "approved" only if the work is genuinely feasible as specified.`;

    case 'budget_gate':
      return `You are the CFO of the enterprise.
Assess the unit economics of this initiative and issue a Budget Envelope.

${context}

Respond with ONLY a JSON object matching this shape:
{
  "estimatedCostUsd": 0.45,
  "maxAuthorizedCostUsd": 1.00,
  "estimatedTokenCount": 45000,
  "roiRationale": "Why the expected outcome justifies the spend.",
  "financialApproval": "approved" | "rejected" | "escalated_to_human"
}
Set financialApproval to "approved" only if the spend is justified. Use "escalated_to_human"
when the decision needs the owner.`;

    case 'sprint_planning':
      return `You are the COO of the enterprise.
Decompose the approved initiative into discrete specialist subtasks with explicit
dependencies, so the work can be executed in dependency order.

${context}

The available specialists are: ned (research), luna (data_analysis), layla (lead_scoring),
hermes (content_creation), argus (qa_verifier).

Respond with ONLY a JSON object matching this shape:
{
  "decompositionStrategy": "How the work was split and why.",
  "subtasks": [
    { "stepId": "step-1", "title": "Short title", "assignedAgent": "ned", "goal": "What this step must produce.", "dependencies": [] }
  ],
  "maxConcurrency": 3
}`;

    case 'implementation':
      return `You are the COO of the enterprise, coordinating the sprint you planned.
Execute the approved sprint plan by delegating each subtask to the named specialist and
synthesizing their results into the deliverable the acceptance criteria describe.

${context}

Every subtask must be delegated rather than done yourself. Report what was produced,
where the evidence is, and anything that could not be completed.`;

    case 'qa_compliance':
      return `You are Argus, the QA and compliance gate.
Audit the work produced for this initiative against the acceptance criteria, the tool
policy the CTO set, and the security considerations.

${context}

Respond with ONLY a JSON object matching this shape:
{
  "verificationScore": 92,
  "complianceChecks": [
    { "name": "Scope Fidelity", "passed": true, "notes": "Why." },
    { "name": "Factuality & Evidence", "passed": true, "notes": "Why." },
    { "name": "Security & Policy", "passed": true, "notes": "Why." }
  ],
  "riskAssessment": "low" | "medium" | "high" | "critical",
  "verdict": "PASS" | "PASS_WITH_WARNINGS" | "REVISE" | "REJECT",
  "critique": "Audit notes."
}
Render PASS or PASS_WITH_WARNINGS only when the deliverables genuinely satisfy the criteria.`;

    case 'release_signoff':
      return `You are the COO preparing the release package for the owner's sign-off.
Summarize what the initiative delivered, what the QA audit found, what it cost, and what
remains open. Do not claim anything the evidence does not support.

${context}`;

    default:
      return `Continue the initiative "${initiative.title}" (${initiative.intent}).`;
  }
}
