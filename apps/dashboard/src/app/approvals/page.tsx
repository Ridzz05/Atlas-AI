'use client';

import React, { useEffect, useState } from 'react';
import { ShieldCheck, Check, X, Edit2, AlertTriangle, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface Approval {
  id: string;
  action: string;
  target: string;
  agentId: string;
  riskLevel: string;
  reason: string;
  payload: Record<string, unknown>;
}

interface ApprovalListResponse { data: Approval[]; count: number; }

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<ApprovalListResponse>('/approvals?status=pending');
      setApprovals(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load approvals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadApprovals(); }, []);

  const handleDecision = async (id: string, status: 'approved' | 'rejected' | 'revision_requested') => {
    try {
      await atlasFetch(`/approvals/${encodeURIComponent(id)}/decision`, { method: 'POST', body: JSON.stringify({ status }) });
      setApprovals(current => current.filter(approval => approval.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record approval decision.');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between"><div><h1 className="text-xl font-bold text-white tracking-tight">Human Approval Control Room</h1><p className="text-xs text-gray-400">Live pending decisions from the authenticated approval API.</p></div><button onClick={() => void loadApprovals()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh approvals"><RefreshCw className="w-4 h-4" /></button></div>
      {error && <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      {loading ? <div className="p-12 text-center text-xs text-gray-400">Loading pending approvals…</div> : approvals.length === 0 ? (
        <div className="p-12 text-center bg-[#111827] border border-gray-800 rounded-xl"><ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-3" /><h3 className="text-sm font-semibold text-white">No Pending Approvals</h3><p className="text-xs text-gray-400 mt-1">The API currently has no pending external actions.</p></div>
      ) : <div className="space-y-4">{approvals.map(req => <div key={req.id} className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-800"><div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20"><AlertTriangle className="w-4 h-4" /></div><div><h3 className="text-sm font-bold text-white">{req.action}</h3><p className="text-[10px] font-mono text-gray-400">Target: {req.target} · Agent: {req.agentId}</p></div></div><span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase bg-rose-500/10 text-rose-400 border border-rose-500/20">{req.riskLevel} RISK</span></div>
        <div className="text-xs space-y-2"><p className="text-gray-300"><strong className="text-white">Reason:</strong> {req.reason}</p><pre className="bg-[#090d16] p-3 rounded-lg border border-gray-800 font-mono text-[11px] text-gray-300 overflow-x-auto">{JSON.stringify(req.payload, null, 2)}</pre></div>
        <div className="flex justify-end gap-3 pt-2"><button onClick={() => void handleDecision(req.id, 'revision_requested')} className="px-3.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium flex items-center gap-1.5 border border-gray-700"><Edit2 className="w-3.5 h-3.5" />Request Revision</button><button onClick={() => void handleDecision(req.id, 'rejected')} className="px-3.5 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 text-xs font-medium flex items-center gap-1.5 border border-rose-500/30"><X className="w-3.5 h-3.5" />Reject</button><button onClick={() => void handleDecision(req.id, 'approved')} className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />Approve</button></div>
      </div>)}</div>}
    </div>
  );
}
