'use client';

import React from 'react';
import { defaultAgentRegistry } from '@atlas/agents';
import { Shield, Search, TrendingUp, Edit3, CheckCircle2, Cpu, Wrench } from 'lucide-react';

export default function AgentsPage() {
  const agents = defaultAgentRegistry.list();

  const getAgentIcon = (id: string) => {
    switch (id) {
      case 'chief': return <Shield className="w-5 h-5 text-indigo-400" />;
      case 'ned': return <Search className="w-5 h-5 text-cyan-400" />;
      case 'layla': return <TrendingUp className="w-5 h-5 text-emerald-400" />;
      case 'hermes': return <Edit3 className="w-5 h-5 text-amber-400" />;
      case 'argus': return <CheckCircle2 className="w-5 h-5 text-rose-400" />;
      default: return <Cpu className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Agent Team Registry</h1>
        <p className="text-xs text-gray-400">Deterministic specifications, system prompts, limits, and tool permissions for the core specialist team.</p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {agents.map((agent) => (
          <div key={agent.id} className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gray-800 border border-gray-700">
                  {getAgentIcon(agent.id)}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{agent.name}</h3>
                  <p className="text-[10px] text-gray-400 font-mono">{agent.role.toUpperCase()} • v{agent.version}</p>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                ACTIVE
              </span>
            </div>

            <p className="text-xs text-gray-300">{agent.description}</p>

            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-gray-400 font-mono text-[11px]">
                <Wrench className="w-3.5 h-3.5" />
                <span>ALLOWED TOOLS ({agent.permissions.tools.length}):</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agent.permissions.tools.map((t) => (
                  <span key={t} className="px-2 py-0.5 rounded bg-gray-800/80 text-gray-300 font-mono text-[10px] border border-gray-700/60">
                    {t}
                  </span>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-800/80 text-[11px] font-mono text-gray-400">
              <div>Max Turns: <strong className="text-white">{agent.limits.maxTurns}</strong></div>
              <div>Max Depth: <strong className="text-white">{agent.limits.maxDelegationDepth}</strong></div>
              <div>Budget: <strong className="text-emerald-400">${agent.limits.maxCostUsd}</strong></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
