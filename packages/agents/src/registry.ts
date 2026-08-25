import { AgentDefinition, AgentDefinitionSchema } from '@atlas/shared';
import { CHIEF_AGENT } from './definitions/chief.js';
import { NED_AGENT } from './definitions/ned.js';
import { LAYLA_AGENT } from './definitions/layla.js';
import { HERMES_AGENT } from './definitions/hermes.js';
import { ARGUS_AGENT } from './definitions/argus.js';

export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>();

  constructor() {
    this.register(CHIEF_AGENT);
    this.register(NED_AGENT);
    this.register(LAYLA_AGENT);
    this.register(HERMES_AGENT);
    this.register(ARGUS_AGENT);
  }

  public register(agent: AgentDefinition): void {
    const validated = AgentDefinitionSchema.parse(agent);
    this.agents.set(validated.id, validated);
  }

  public get(id: string): AgentDefinition | undefined {
    return this.agents.get(id);
  }

  public getOrThrow(id: string): AgentDefinition {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent not found in registry: ${id}`);
    }
    return agent;
  }

  public list(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  public has(id: string): boolean {
    return this.agents.has(id);
  }
}

export const defaultAgentRegistry = new AgentRegistry();
