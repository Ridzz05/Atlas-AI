'use client';

import React from 'react';
import { Shield, Search, TrendingUp, Edit3, CheckCircle2 } from 'lucide-react';

export type AgentNodeStatus = 'IDLE' | 'QUEUED' | 'WORKING' | 'ERROR';

export interface AgentNodeData {
  id: string;
  name: string;
  role: string;
  status: AgentNodeStatus;
  currentTask?: string;
}

interface AgentGraphProps {
  agents?: AgentNodeData[];
}

const DEFAULT_AGENTS: AgentNodeData[] = [
  { id: 'chief', name: 'Chief', role: 'Orchestrator', status: 'IDLE' },
  { id: 'ned', name: 'Ned', role: 'Researcher', status: 'IDLE' },
  { id: 'layla', name: 'Layla', role: 'Lead Scoring', status: 'IDLE' },
  { id: 'hermes', name: 'Hermes', role: 'Copywriter', status: 'IDLE' },
  { id: 'argus', name: 'Argus', role: 'QA & Risk Gate', status: 'IDLE' }
];

export function AgentGraph({ agents = DEFAULT_AGENTS }: AgentGraphProps) {
  const getStatusBadge = (status: AgentNodeStatus) => {
    switch (status) {
      case 'WORKING':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 animate-pulse">
            ● WORKING
          </span>
        );
      case 'QUEUED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/20 text-amber-400 border border-amber-500/40">
            ⏳ QUEUED
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-rose-500/20 text-rose-400 border border-rose-500/40">
            ✖ ERROR
          </span>
        );
      case 'IDLE':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-gray-800 text-gray-400 border border-gray-700">
            ○ IDLE
          </span>
        );
    }
  };

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
        return <Shield className="w-5 h-5 text-gray-400" />;
    }
  };

  const chief = agents.find(a => a.id === 'chief') || DEFAULT_AGENTS[0]!;
  const specialists = agents.filter(a => a.id !== 'chief' && a.id !== 'argus');
  const argus = agents.find(a => a.id === 'argus') || DEFAULT_AGENTS[4]!;

  return (
    <div className="p-6 bg-[#111827] rounded-xl border border-gray-800 shadow-xl relative overflow-hidden">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-800">
        <div>
          <h2 className="text-sm font-semibold text-white tracking-wide">MULTI-AGENT TOPOLOGY</h2>
          <p className="text-xs text-gray-400">Deterministic event-derived state graph (Depth 0 → Depth 2)</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span> Live
          </span>
          <span>• Max Concurrency: 3</span>
          <span>• Max Depth: 2</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-8 py-2">
        {/* Depth 0: Chief */}
        <div className="w-72 p-4 rounded-xl bg-[#1a2333] border border-indigo-500/40 shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">{getAgentIcon('chief')}</div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase">{chief.name}</h3>
              <p className="text-[10px] text-indigo-400 font-mono">Depth 0 • Root Orchestrator</p>
            </div>
          </div>
          {getStatusBadge(chief.status)}
        </div>

        {/* Delegation Connectors */}
        <div className="w-full flex justify-center items-center">
          <div className="h-4 w-px bg-gray-700"></div>
        </div>

        {/* Depth 1: Specialists (Ned, Layla, Hermes) */}
        <div className="grid grid-cols-3 gap-4 w-full max-w-4xl">
          {specialists.map(agent => (
            <div
              key={agent.id}
              className="p-4 rounded-xl bg-[#141d2b] border border-gray-800 hover:border-gray-700 transition-all flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded-lg bg-gray-800 border border-gray-700">{getAgentIcon(agent.id)}</div>
                  <div>
                    <h4 className="text-xs font-semibold text-white">{agent.name}</h4>
                    <p className="text-[10px] text-gray-400 font-mono">{agent.role}</p>
                  </div>
                </div>
                {getStatusBadge(agent.status)}
              </div>
              <div className="text-[10px] text-gray-500 font-mono border-t border-gray-800/80 pt-2 flex justify-between">
                <span>Depth: 1</span>
                <span>Max Turns: 10</span>
              </div>
            </div>
          ))}
        </div>

        {/* Connector to Argus */}
        <div className="w-full flex justify-center items-center">
          <div className="h-4 w-px bg-gray-700"></div>
        </div>

        {/* Depth 2: QA Gate (Argus) */}
        <div className="w-72 p-4 rounded-xl bg-[#1a2333] border border-rose-500/30 shadow-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">{getAgentIcon('argus')}</div>
            <div>
              <h3 className="text-xs font-bold text-white uppercase">{argus.name}</h3>
              <p className="text-[10px] text-rose-400 font-mono">Depth 2 • QA & Risk Gate</p>
            </div>
          </div>
          {getStatusBadge(argus.status)}
        </div>
      </div>
    </div>
  );
}
