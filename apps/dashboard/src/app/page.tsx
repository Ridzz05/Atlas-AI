'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, DollarSign, ArrowUpRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { AgentGraph, AgentNodeData } from '../components/agent-graph';
import { atlasFetch } from '../lib/atlas-api';
import { subscribeToAtlasEvents } from '../lib/event-stream';

interface ApiTask {
  id: string;
  title: string;
  assignedAgent: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface TaskListResponse { data: ApiTask[]; count: number; }
interface ApprovalListResponse { data: unknown[]; count: number; }

const toAgentStatus = (tasks: ApiTask[], agentId: string): AgentNodeData['status'] => {
  const assigned = tasks.filter(task => task.assignedAgent === agentId);
  if (assigned.some(task => ['failed', 'cancelled'].includes(task.status))) return 'ERROR';
  if (assigned.some(task => ['running', 'planning', 'review_pending', 'approval_pending'].includes(task.status))) return 'WORKING';
  if (assigned.some(task => task.status === 'queued')) return 'QUEUED';
  return 'IDLE';
};

export default function CommandCenterPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [taskResponse, approvalResponse] = await Promise.all([
        atlasFetch<TaskListResponse>('/tasks?limit=100'),
        atlasFetch<ApprovalListResponse>('/approvals?status=pending&limit=100')
      ]);
      setTasks(taskResponse.data);
      setPendingApprovals(approvalResponse.count);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the live command center.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadOverview(); }, []);

  useEffect(() => {
    const stream = new EventSource('/api/atlas/events/stream');
    const refresh = () => { void loadOverview(); };
    const unsubscribe = subscribeToAtlasEvents(stream, refresh);
    return () => {
      unsubscribe();
      stream.close();
    };
  }, []);

  const activeCount = tasks.filter(task => ['running', 'planning', 'review_pending', 'approval_pending'].includes(task.status)).length;
  const completedCount = tasks.filter(task => task.status === 'completed').length;
  const costToday = tasks.reduce((total, task) => total + (typeof task.result?.totalCostUsd === 'number' ? task.result.totalCostUsd : 0), 0);
  const agentIds = ['chief', 'ned', 'layla', 'hermes', 'argus'];
  const graphAgents: AgentNodeData[] = agentIds.map(id => ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    role: id === 'chief' ? 'Orchestrator' : id === 'argus' ? 'QA & Risk Gate' : id,
    status: toAgentStatus(tasks, id)
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Command Center</h1>
          <p className="text-xs text-gray-400">Live overview derived from the authenticated ATLAS API.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadOverview()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh command center"><RefreshCw className="w-4 h-4" /></button>
          <Link href="/tasks" className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all flex items-center gap-1.5"><span>New Goal</span><ArrowUpRight className="w-3.5 h-3.5" /></Link>
        </div>
      </div>

      {error && <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      {loading ? <div className="p-12 text-center text-xs text-gray-400" role="status" aria-busy="true">Loading live control-plane metrics…</div> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <Metric label="ACTIVE TASKS" value={String(activeCount)} icon={<Clock className="w-5 h-5" />} tone="indigo" />
          <Metric label="TASKS COMPLETED" value={String(completedCount)} icon={<CheckCircle2 className="w-5 h-5" />} tone="emerald" />
          <Metric label="PENDING APPROVALS" value={String(pendingApprovals)} icon={<AlertCircle className="w-5 h-5" />} tone="amber" />
          <Metric label="RECORDED COST" value={`$${costToday.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} tone="cyan" />
        </div>

        <AgentGraph agents={graphAgents} />

        <div className="p-6 bg-[#111827] rounded-xl border border-gray-800">
          <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-white">Recent Execution Pipeline</h2><Link href="/tasks" className="text-xs text-indigo-400 hover:text-indigo-300">View All Tasks →</Link></div>
          {tasks.length === 0 ? <div className="py-8 text-center text-xs text-gray-400">No tasks have been submitted yet.</div> : <div className="divide-y divide-gray-800 text-xs">{tasks.slice(0, 5).map(task => <div key={task.id} className="py-3 flex items-center justify-between gap-4"><div className="min-w-0"><p className="font-medium text-white truncate">{task.title}</p><p className="text-[10px] text-gray-400 font-mono">Assigned to: {task.assignedAgent}</p></div><span className="px-2 py-0.5 rounded text-[10px] font-mono bg-gray-500/10 text-gray-300 border border-gray-500/20 shrink-0">{task.status.toUpperCase()}</span></div>)}</div>}
        </div>
      </>}
    </div>
  );
}

function Metric({ label, value, icon, tone }: { label: string; value: string; icon: React.ReactNode; tone: 'indigo' | 'emerald' | 'amber' | 'cyan' }) {
  const colors = { indigo: 'text-indigo-400 bg-indigo-500/10', emerald: 'text-emerald-400 bg-emerald-500/10', amber: 'text-amber-400 bg-amber-500/10', cyan: 'text-cyan-400 bg-cyan-500/10' };
  return <div className="p-4 rounded-xl bg-[#111827] border border-gray-800 flex items-center justify-between"><div><p className="text-[11px] font-mono text-gray-400">{label}</p><p className="text-2xl font-bold text-white mt-1">{value}</p></div><div className={`p-2.5 rounded-lg ${colors[tone]}`}>{icon}</div></div>;
}
