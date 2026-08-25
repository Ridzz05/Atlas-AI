'use client';

import React from 'react';
import { Activity, ShieldAlert, Cpu, DollarSign } from 'lucide-react';

interface MockAuditEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  details: string;
  status: 'allowed' | 'blocked' | 'approved';
}

const SAMPLE_AUDIT_LOGS: MockAuditEvent[] = [
  {
    id: 'aud-1',
    timestamp: '2026-08-26 05:01:10',
    actor: 'hermes',
    action: 'tool.communication.create_draft',
    details: 'Created draft for +6281278901234',
    status: 'allowed'
  },
  {
    id: 'aud-2',
    timestamp: '2026-08-26 05:00:50',
    actor: 'argus',
    action: 'policy.verify',
    details: 'QA Policy check passed with verdict PASS',
    status: 'approved'
  },
  {
    id: 'aud-3',
    timestamp: '2026-08-26 04:55:00',
    actor: 'ned',
    action: 'shell.execute',
    details: 'Blocked attempt to call shell.execute without permission',
    status: 'blocked'
  }
];

export default function AuditPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Audit Trail & Cost Accounting</h1>
        <p className="text-xs text-gray-400">Append-only immutable audit records, policy evaluations, and token consumption breakdowns.</p>
      </div>

      {/* Cost Breakdown Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-5 bg-[#111827] border border-gray-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>TOTAL TOKENS USED</span>
            <Cpu className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-2xl font-bold text-white">42,850</p>
          <p className="text-[10px] text-gray-500 font-mono">Prompt: 31,200 • Completion: 11,650</p>
        </div>

        <div className="p-5 bg-[#111827] border border-gray-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>TOTAL ACCUMULATED COST</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-2xl font-bold text-emerald-400">$0.12 USD</p>
          <p className="text-[10px] text-gray-500 font-mono">Daily ceiling: $5.00 USD</p>
        </div>

        <div className="p-5 bg-[#111827] border border-gray-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>SECURITY VIOLATIONS PREVENTED</span>
            <ShieldAlert className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-2xl font-bold text-white">1</p>
          <p className="text-[10px] text-gray-500 font-mono">100% blocked deterministically</p>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
        <h3 className="text-sm font-semibold text-white">Security & Execution Audit Events</h3>
        <div className="divide-y divide-gray-800 text-xs">
          {SAMPLE_AUDIT_LOGS.map((log) => (
            <div key={log.id} className="py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <span className="font-mono text-[11px] text-gray-500">{log.timestamp}</span>
                <span className="font-mono px-2 py-0.5 rounded bg-gray-800 text-indigo-400 border border-gray-700 text-[10px]">
                  {log.actor}
                </span>
                <span className="font-mono text-white font-medium">{log.action}</span>
                <span className="text-gray-400">{log.details}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold ${
                log.status === 'blocked'
                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {log.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
