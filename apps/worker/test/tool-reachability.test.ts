import { describe, expect, it } from 'vitest';
import { defaultAgentRegistry } from '@atlas/agents';
import {
  CompanyLookupTool,
  CreateDraftTool,
  LeadEnrichmentTool,
  LeadScoringTool,
  PolicyVerifyTool,
  SendApprovedCommunicationTool,
  WebFetchTool,
  WebSearchTool,
  createArtifactTools,
  createMemoryTools,
  createSecondBrainTools
} from '@atlas/tools';

/**
 * A tool's declaration and its implementation must agree, in both directions.
 *
 * The registry fails closed on `ToolContext.allowedTools`, so a tool is reachable only if some agent
 * lists it, and an allowlist entry for a tool that does not exist can never be honoured. Either
 * mismatch is silent: the tool is written, reviewed, registered and logged at boot while no agent can
 * call it, or an agent is declared able to do something it cannot.
 *
 * Both lists below are findings, recorded rather than resolved, because each entry is a permissions
 * or capability decision rather than a defect with one correct answer. The test's value is that a
 * third case cannot appear unnoticed, and resolving any of these is a deliberate edit in one place.
 */

/** Registered tools no agent may call. */
const UNREACHABLE_BY_DESIGN: Record<string, string> = {
  'communication.send_approved':
    'The only outbound-send tool. `chief` and `hermes` declare it in humanApprovalFor and neither lists it in tools, so the approval flow that declaration describes can never be entered. Plausibly deliberate (the fleet drafts, a human sends) — but then the humanApprovalFor entry is inert.',
  'memory.propose_write':
    'The only agent-facing write path into memory, and listed in ApprovalMatrix.NO_APPROVAL_ACTIONS, the policy layer’s own statement of what agents may do unattended. No agent lists it, so with the verified-only read rule the whole memory subsystem was inert: nothing could write, nothing was ever verified, every read returned nothing.'
};

/** Names in an agent allowlist with no registered implementation. */
const UNIMPLEMENTED_ALLOWLIST_ENTRIES: Record<string, string> = {
  'tasks.create_child': 'Delegation is driven by the plan and the delegator, not by a tool.',
  'tasks.update_status': 'Task status is written by the runner and the delegator.',
  'tasks.get': 'No tool; also named in ApprovalMatrix.NO_APPROVAL_ACTIONS, which auto-approves an action that does not exist.',
  'tasks.list': 'No tool; also named in ApprovalMatrix.NO_APPROVAL_ACTIONS.',
  'approvals.request': 'An approval is requested inside the tool registry when an action requires one, so no tool is needed.',
  'brand.get_voice': 'No implementation anywhere in the repository.'
};

function registeredToolNames(): string[] {
  const names = new Set<string>();

  // Standalone tool objects the worker registers directly.
  const standalone = [
    WebSearchTool,
    WebFetchTool,
    CompanyLookupTool,
    LeadEnrichmentTool,
    LeadScoringTool,
    PolicyVerifyTool,
    CreateDraftTool,
    SendApprovedCommunicationTool
  ];
  for (const tool of standalone) {
    if (tool?.name) names.add(tool.name);
  }

  // Factories the worker calls. The services are only closed over — the definitions, and therefore
  // the names, are built without touching them.
  for (const tool of createMemoryTools({} as never)) names.add(tool.name);
  for (const tool of createArtifactTools({} as never)) names.add(tool.name);
  for (const tool of createSecondBrainTools({} as never)) names.add(tool.name);

  return [...names].sort();
}

function grantedToolNames(): Set<string> {
  const granted = new Set<string>();
  for (const agent of defaultAgentRegistry.list()) {
    for (const tool of agent.permissions.tools) granted.add(tool);
  }
  return granted;
}

function toolsNoAgentMayCall(): string[] {
  const granted = grantedToolNames();
  return registeredToolNames().filter(name => !granted.has(name));
}

function allowlistEntriesWithNoTool(): string[] {
  const registered = new Set(registeredToolNames());
  const unknown = new Set<string>();
  for (const agent of defaultAgentRegistry.list()) {
    for (const tool of agent.permissions.tools) {
      if (!registered.has(tool)) unknown.add(tool);
    }
  }
  return [...unknown].sort();
}

describe('tool declaration consistency', () => {
  it('finds the registered tools and the agent allowlists', () => {
    expect(registeredToolNames().length).toBeGreaterThan(8);
    expect(defaultAgentRegistry.list().length).toBeGreaterThan(5);
  });

  it('has exactly the reviewed set of registered tools no agent may call', () => {
    expect(toolsNoAgentMayCall()).toEqual(Object.keys(UNREACHABLE_BY_DESIGN).sort());
  });

  it('has exactly the reviewed set of allowlist entries with no implementation', () => {
    expect(allowlistEntriesWithNoTool()).toEqual(Object.keys(UNIMPLEMENTED_ALLOWLIST_ENTRIES).sort());
  });

  // The reachable tools are the fleet's real capability surface, so it is worth pinning: a change
  // here means an agent gained or lost an ability.
  it('records the fleet’s reachable tool surface', () => {
    const granted = grantedToolNames();
    const reachable = registeredToolNames().filter(name => granted.has(name));

    expect(reachable).toEqual([
      'artifacts.read',
      'artifacts.write',
      'communication.create_draft',
      'company.lookup',
      'lead.enrich',
      'lead.score',
      'memory.get',
      'memory.search',
      'policy.verify',
      'second_brain.list_notes',
      'second_brain.query',
      'second_brain.read_note',
      'second_brain.search',
      'second_brain.sync_vault',
      'web.fetch_safe',
      'web.search'
    ]);
  });
});
