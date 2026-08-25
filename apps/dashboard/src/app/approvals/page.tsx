'use client';

import React, { useState } from 'react';
import { ShieldCheck, Check, X, Edit2, AlertTriangle } from 'lucide-react';

interface MockApproval {
  id: string;
  action: string;
  target: string;
  agentId: string;
  riskLevel: 'high' | 'critical' | 'medium';
  reason: string;
  expiresAt: string;
  payload: Record<string, unknown>;
}

const SAMPLE_APPROVALS: MockApproval[] = [
  {
    id: 'req-palembang-outreach-01',
    action: 'communication.send_approved',
    target: '+6281278901234 (Mega Fitness Palembang)',
    agentId: 'hermes',
    riskLevel: 'high',
    reason: 'Outbound pitch consultation to qualified gym lead (Score 96/100).',
    expiresAt: '2026-08-26 06:00:00',
    payload: {
      channel: 'whatsapp',
      recipient: '+6281278901234',
      message: 'Halo Mega Fitness Palembang, kami ingin menawarkan solusi WhatsApp CRM untuk mempermudah retention member Anda...'
    }
  }
];

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<MockApproval[]>(SAMPLE_APPROVALS);

  const handleDecision = (id: string, decision: 'approved' | 'rejected' | 'revised') => {
    alert(`Decision registered: ${decision.toUpperCase()} for approval request ${id}`);
    setApprovals(approvals.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Human Approval Control Room</h1>
        <p className="text-xs text-gray-400">Inspect pending external actions, review payloads, and issue cryptographic approval tokens.</p>
      </div>

      {approvals.length === 0 ? (
        <div className="p-12 text-center bg-[#111827] border border-gray-800 rounded-xl">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-white">No Pending Approvals</h3>
          <p className="text-xs text-gray-400 mt-1">All proposed actions have been reviewed or executed.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((req) => (
            <div key={req.id} className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{req.action}</h3>
                    <p className="text-[10px] font-mono text-gray-400">Target: {req.target} • Agent: {req.agentId}</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  {req.riskLevel} RISK
                </span>
              </div>

              <div className="text-xs space-y-2">
                <p className="text-gray-300"><strong className="text-white">Reason:</strong> {req.reason}</p>
                <div className="bg-[#090d16] p-3 rounded-lg border border-gray-800 font-mono text-[11px] text-gray-300 overflow-x-auto">
                  <pre>{JSON.stringify(req.payload, null, 2)}</pre>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => handleDecision(req.id, 'revised')}
                  className="px-3.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium flex items-center gap-1.5 border border-gray-700 transition-all"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Request Revision</span>
                </button>
                <button
                  onClick={() => handleDecision(req.id, 'rejected')}
                  className="px-3.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 text-xs font-medium flex items-center gap-1.5 border border-rose-500/30 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Reject</span>
                </button>
                <button
                  onClick={() => handleDecision(req.id, 'approved')}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition-all"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Approve & Sign</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
