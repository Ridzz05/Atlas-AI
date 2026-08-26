'use client';

import React, { useEffect, useState } from 'react';
import { Shield, Search, TrendingUp, Edit3, CheckCircle2, Cpu, Wrench, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface ApiAgent {
  id: string;
  name: string;
  role: string;
  version: number;
  description: string;
  permissions: { tools: string[] };
  limits: { maxTurns: number; maxDelegationDepth: number; maxCostUsd: number };
}

interface AgentListResponse {
  data: ApiAgent[];
}

const getAgentIcon = (id: string) => {
  switch (id) {
    case 'chief':
      return <Shield className="w-5 h-5 text-indigo-400" />;
    case 'ned':
      return <Search className="w-5 h-5 text-cyan-400" />;
    case 'layla':
      return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    case 'hermes':
      return <Edit3 className="w-5 h-5 text-amber-400" />;
    case 'argus':
      return <CheckCircle2 className="w-5 h-5 text-rose-400" />;
    default:
      return <Cpu className="w-5 h-5 text-gray-400" />;
  }
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<AgentListResponse>('/agents');
      setAgents(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the agent registry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Agent Team Registry</h1>
          <p className="text-xs text-gray-400">Live definitions served by the authenticated ATLAS control plane.</p>
        </div>
        <button
          onClick={() => void loadAgents()}
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-800"
          aria-label="Refresh agent registry"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="p-12 text-center text-xs text-gray-400" role="status" aria-busy="true">
          Loading live agent registry…
        </div>
      ) : agents.length === 0 ? (
        <div className="p-12 text-center bg-[#111827] border border-gray-800 rounded-xl text-xs text-gray-400">
          No agents are registered in the control plane.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {agents.map(agent => (
            <div key={agent.id} className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gray-800 border border-gray-700">{getAgentIcon(agent.id)}</div>
                  <div>
                    <h2 className="text-sm font-bold text-white">{agent.name}</h2>
                    <p className="text-[10px] text-gray-400 font-mono">
                      {agent.role.toUpperCase()} · v{agent.version}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  REGISTERED
                </span>
              </div>
              <p className="text-xs text-gray-300">{agent.description}</p>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-1.5 text-gray-400 font-mono text-[11px]">
                  <Wrench className="w-3.5 h-3.5" />
                  <span>ALLOWED TOOLS ({agent.permissions.tools.length})</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {agent.permissions.tools.length === 0 ? (
                    <span className="text-[10px] text-gray-500">No tool permissions</span>
                  ) : (
                    agent.permissions.tools.map(tool => (
                      <span
                        key={tool}
                        className="px-2 py-0.5 rounded bg-gray-800/80 text-gray-300 font-mono text-[10px] border border-gray-700/60"
                      >
                        {tool}
                      </span>
                    ))
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-800/80 text-[11px] font-mono text-gray-400">
                <div>
                  Max Turns: <strong className="text-white">{agent.limits.maxTurns}</strong>
                </div>
                <div>
                  Max Depth: <strong className="text-white">{agent.limits.maxDelegationDepth}</strong>
                </div>
                <div>
                  Budget: <strong className="text-emerald-400">${agent.limits.maxCostUsd}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
