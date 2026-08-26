'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, DollarSign, ArrowUpRight, RefreshCw, Pause, Play, OctagonAlert } from 'lucide-react';
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
interface CostMetrics {
  periodCostUsd: number;
  totalCostUsd: number;
  runCount: number;
  activeRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
}
interface BudgetMetrics {
  limitUsd: number;
  usedUsd: number;
  reservedUsd: number;
  availableUsd: number;
  resetAt: string | null;
}
interface CostSummaryResponse {
  data: { costs: CostMetrics | null; budget: BudgetMetrics | null };
  durable: boolean;
}
interface LeaseMetrics {
  checkedAt: string;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  unleasedExecutableRunCount: number;
  cancellationRequestedCount: number;
}
interface RecoverySummaryResponse { data: LeaseMetrics | null; durable: boolean; }
interface ControlState {
  paused: boolean;
  emergencyStop: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}
interface ControlResponse { data: ControlState; durable: boolean; }
type ControlAction = 'pause' | 'resume' | 'emergency-stop';

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
  const [costMetrics, setCostMetrics] = useState<CostSummaryResponse['data'] | null>(null);
  const [recoveryMetrics, setRecoveryMetrics] = useState<LeaseMetrics | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [taskResponse, approvalResponse, costResponse, recoveryResponse] = await Promise.all([
        atlasFetch<TaskListResponse>('/tasks?limit=100'),
        atlasFetch<ApprovalListResponse>('/approvals?status=pending&limit=100'),
        atlasFetch<CostSummaryResponse>('/costs'),
        atlasFetch<RecoverySummaryResponse>('/recovery')
      ]);
      setTasks(taskResponse.data);
      setPendingApprovals(approvalResponse.count);
      setCostMetrics(costResponse.data);
      setRecoveryMetrics(recoveryResponse.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the live command center.');
    } finally {
      setLoading(false);
    }
  };

  const loadControl = async () => {
    try {
      const response = await atlasFetch<ControlResponse>('/control');
      setControlState(response.data);
      setControlError(null);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Durable control state is unavailable.');
    }
  };

  const invokeControl = async (action: ControlAction) => {
    const messages: Record<ControlAction, string> = {
      pause: 'Pause task intake and worker dispatch?',
      resume: 'Resume task intake and worker dispatch?',
      'emergency-stop': 'Activate emergency stop? Active runs will receive cancellation signals.'
    };
    if (typeof window !== 'undefined' && !window.confirm(messages[action])) return;

    setControlBusy(true);
    try {
      const response = await atlasFetch<ControlResponse>(`/control/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Dashboard ${action}` })
      });
      setControlState(response.data);
      setControlError(null);
      await loadOverview();
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Control action could not be completed.');
    } finally {
      setControlBusy(false);
    }
  };

  useEffect(() => { void loadOverview(); }, []);
  useEffect(() => { void loadControl(); }, []);

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
  const costToday = costMetrics?.costs?.periodCostUsd;
  const budget = costMetrics?.budget;
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
      <section className="p-5 bg-[#111827] rounded-xl border border-gray-800" aria-label="System control">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-mono text-gray-400">SYSTEM CONTROL</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${controlState?.emergencyStop ? 'bg-rose-400' : controlState?.paused ? 'bg-amber-400' : controlState ? 'bg-emerald-400' : 'bg-gray-500'}`} aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">{controlState?.emergencyStop ? 'Emergency stop active' : controlState?.paused ? 'Intake paused' : controlState ? 'System active' : 'State unavailable'}</h2>
            </div>
            <p className="text-xs text-gray-400 mt-1">{controlState ? 'Durable state shared with Telegram and worker dispatch.' : controlError || 'Loading durable control state…'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {controlState && !controlState.emergencyStop && (controlState.paused ? <button disabled={controlBusy} onClick={() => void invokeControl('resume')} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"><Play className="w-3.5 h-3.5" />Resume intake</button> : <button disabled={controlBusy} onClick={() => void invokeControl('pause')} className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"><Pause className="w-3.5 h-3.5" />Pause intake</button>)}
            {controlState && !controlState.emergencyStop && <button disabled={controlBusy} onClick={() => void invokeControl('emergency-stop')} className="px-3 py-2 rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"><OctagonAlert className="w-3.5 h-3.5" />Emergency stop</button>}
            {controlState?.emergencyStop && <button disabled={controlBusy} onClick={() => void invokeControl('resume')} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-medium flex items-center gap-1.5"><Play className="w-3.5 h-3.5" />Resume system</button>}
          </div>
        </div>
        {controlError && <p role="alert" className="mt-3 text-xs text-rose-300">{controlError}</p>}
      </section>
      {loading ? <div className="p-12 text-center text-xs text-gray-400" role="status" aria-busy="true">Loading live control-plane metrics…</div> : <>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          <Metric label="ACTIVE TASKS" value={String(activeCount)} icon={<Clock className="w-5 h-5" />} tone="indigo" />
          <Metric label="TASKS COMPLETED" value={String(completedCount)} icon={<CheckCircle2 className="w-5 h-5" />} tone="emerald" />
          <Metric label="PENDING APPROVALS" value={String(pendingApprovals)} icon={<AlertCircle className="w-5 h-5" />} tone="amber" />
          <Metric label="COST TODAY" value={costToday == null ? 'N/A' : `$${costToday.toFixed(2)}`} icon={<DollarSign className="w-5 h-5" />} tone="cyan" />
          <Metric label="DAILY BUDGET USED" value={budget ? `$${budget.usedUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)}` : 'N/A'} icon={<DollarSign className="w-5 h-5" />} tone="cyan" />
        </div>

        <AgentGraph agents={graphAgents} />

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-label="Worker lease recovery telemetry">
          <Metric label="ACTIVE LEASES" value={recoveryMetrics == null ? 'N/A' : String(recoveryMetrics.activeLeaseCount)} icon={<Clock className="w-5 h-5" />} tone="indigo" />
          <Metric label="EXPIRED LEASES" value={recoveryMetrics == null ? 'N/A' : String(recoveryMetrics.expiredLeaseCount)} icon={<AlertCircle className="w-5 h-5" />} tone="amber" />
          <Metric label="UNLEASED RUNS" value={recoveryMetrics == null ? 'N/A' : String(recoveryMetrics.unleasedExecutableRunCount)} icon={<Clock className="w-5 h-5" />} tone="cyan" />
          <Metric label="CANCEL REQUESTS" value={recoveryMetrics == null ? 'N/A' : String(recoveryMetrics.cancellationRequestedCount)} icon={<RefreshCw className="w-5 h-5" />} tone="emerald" />
        </div>

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
