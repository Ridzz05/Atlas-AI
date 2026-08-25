'use client';

import React, { useEffect, useState } from 'react';
import { Plus, ArrowRight, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface ApiTask {
  id: string;
  title: string;
  assignedAgent: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface TaskListResponse { data: ApiTask[]; count: number; }

export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newGoal, setNewGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<TaskListResponse>('/tasks');
      setTasks(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tasks.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTasks(); }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newGoal.trim()) return;
    try {
      await atlasFetch<ApiTask>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: newGoal.trim().slice(0, 80), goal: newGoal.trim(), assignedAgent: 'chief' })
      });
      setNewGoal('');
      setShowModal(false);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create task.');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Task Orchestration</h1>
          <p className="text-xs text-gray-400">Live tasks from the authenticated ATLAS API.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void loadTasks()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh tasks"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowModal(true)} className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" />Create Task</button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      {loading ? <div className="p-12 text-center text-xs text-gray-400">Loading live tasks…</div> : tasks.length === 0 ? (
        <div className="p-12 text-center bg-[#111827] rounded-xl border border-gray-800 text-xs text-gray-400">No tasks found.</div>
      ) : (
        <div className="space-y-4">
          {tasks.map(task => {
            const cost = typeof task.result?.totalCostUsd === 'number' ? task.result.totalCostUsd : 0;
            return <div key={task.id} className="p-5 bg-[#111827] rounded-xl border border-gray-800 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0"><span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">{task.id}</span><h3 className="text-sm font-semibold text-white truncate">{task.title}</h3></div>
                <div className="flex items-center gap-3 shrink-0"><span className="text-xs font-mono text-gray-400">Cost: ${cost.toFixed(2)}</span><span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase border bg-gray-500/10 text-gray-300 border-gray-500/20">{task.status}</span></div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400"><ArrowRight className="w-3 h-3 text-gray-600" /><span className="font-mono text-indigo-400 font-medium">{task.assignedAgent.toUpperCase()}</span>{task.error && <span className="text-rose-300">{task.error}</span>}</div>
            </div>;
          })}
        </div>
      )}

      {showModal && <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50"><div className="bg-[#111827] border border-gray-800 rounded-xl max-w-lg w-full p-6 space-y-4"><h2 className="text-base font-semibold text-white">Create New Task for Chief</h2><form onSubmit={handleCreate} className="space-y-4"><textarea value={newGoal} onChange={event => setNewGoal(event.target.value)} placeholder="Describe the goal…" className="w-full h-28 bg-[#090d16] border border-gray-700 rounded-lg p-3 text-xs text-white placeholder-gray-500" required /><div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => setShowModal(false)} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-800">Cancel</button><button type="submit" className="px-4 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium">Submit Goal</button></div></form></div></div>}
    </div>
  );
}
