'use client';

import React from 'react';
import { AgentGraph } from '../components/agent-graph';
import { CheckCircle2, Clock, AlertCircle, DollarSign, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

export default function CommandCenterPage() {
  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Command Center</h1>
          <p className="text-xs text-gray-400">High-level executive overview of the ATLAS multi-agent orchestration team.</p>
        </div>
        <Link
          href="/tasks"
          className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
        >
          <span>New Goal</span>
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#111827] border border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono text-gray-400">ACTIVE RUNS</p>
            <p className="text-2xl font-bold text-white mt-1">3</p>
          </div>
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400">
            <Clock className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111827] border border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono text-gray-400">TASKS COMPLETED</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">28</p>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111827] border border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono text-gray-400">PENDING APPROVALS</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">1</p>
          </div>
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400">
            <AlertCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#111827] border border-gray-800 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-mono text-gray-400">DAILY BUDGET USAGE</p>
            <p className="text-2xl font-bold text-white mt-1">2.4%</p>
          </div>
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400">
            <DollarSign className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Real-time Agent Topology */}
      <AgentGraph />

      {/* Recent Activity Table */}
      <div className="p-6 bg-[#111827] rounded-xl border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Recent Execution Pipeline</h2>
          <Link href="/tasks" className="text-xs text-indigo-400 hover:text-indigo-300">View All Tasks →</Link>
        </div>

        <div className="divide-y divide-gray-800 text-xs">
          <div className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <div>
                <p className="font-medium text-white">Palembang Gym Lead Intelligence</p>
                <p className="text-[10px] text-gray-400 font-mono">Assigned to: Chief • 4 subtasks completed</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">COMPLETED</span>
              <span className="text-[11px] text-gray-400 font-mono">$0.75</span>
            </div>
          </div>

          <div className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <div>
                <p className="font-medium text-white">WhatsApp Outreach Campaign Drafts</p>
                <p className="text-[10px] text-gray-400 font-mono">Assigned to: Hermes • QA Verdict: PASS</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">APPROVAL PENDING</span>
              <span className="text-[11px] text-gray-400 font-mono">$0.25</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
