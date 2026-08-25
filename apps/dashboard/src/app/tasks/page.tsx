'use client';

import React, { useState } from 'react';
import { Plus, Search, Filter, ArrowRight } from 'lucide-react';

interface MockTaskItem {
  id: string;
  title: string;
  assignedAgent: string;
  status: string;
  costUsd: number;
  subtasks: Array<{ id: string; agent: string; status: string; title: string }>;
}

const INITIAL_TASKS: MockTaskItem[] = [
  {
    id: 'task-1',
    title: 'Palembang Gym Lead Intelligence',
    assignedAgent: 'chief',
    status: 'completed',
    costUsd: 0.75,
    subtasks: [
      { id: 'step_1', agent: 'ned', status: 'completed', title: 'Collect 30 gym locations in Palembang' },
      { id: 'step_2', agent: 'layla', status: 'completed', title: 'Score leads with 10-dimension rubric' },
      { id: 'step_3', agent: 'hermes', status: 'completed', title: 'Draft outreach copies for top 10' },
      { id: 'step_4', agent: 'argus', status: 'completed', title: 'QA check & policy compliance' }
    ]
  },
  {
    id: 'task-2',
    title: 'Competitor CRM Feature Comparison',
    assignedAgent: 'chief',
    status: 'running',
    costUsd: 0.32,
    subtasks: [
      { id: 'step_1', agent: 'ned', status: 'completed', title: 'Research top 5 WhatsApp CRM providers' },
      { id: 'step_2', agent: 'layla', status: 'running', title: 'Compare pricing and feature tiers' }
    ]
  }
];

export default function TasksPage() {
  const [tasks, setTasks] = useState<MockTaskItem[]>(INITIAL_TASKS);
  const [showModal, setShowModal] = useState(false);
  const [newGoal, setNewGoal] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoal.trim()) return;

    const newTask: MockTaskItem = {
      id: `task-${Date.now().toString().slice(-4)}`,
      title: newGoal,
      assignedAgent: 'chief',
      status: 'queued',
      costUsd: 0.0,
      subtasks: []
    };

    setTasks([newTask, ...tasks]);
    setNewGoal('');
    setShowModal(false);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Task Orchestration</h1>
          <p className="text-xs text-gray-400">Parent tasks, child subtasks, dependency execution, and status inspection.</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-md shadow-indigo-600/30 flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Create Task</span>
        </button>
      </div>

      {/* Task List */}
      <div className="space-y-4">
        {tasks.map((t) => (
          <div key={t.id} className="p-5 bg-[#111827] rounded-xl border border-gray-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700">
                  {t.id}
                </span>
                <h3 className="text-sm font-semibold text-white">{t.title}</h3>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-gray-400">Cost: ${t.costUsd.toFixed(2)}</span>
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono uppercase font-medium border ${
                  t.status === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : t.status === 'running'
                    ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20 animate-pulse'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}>
                  {t.status}
                </span>
              </div>
            </div>

            {t.subtasks.length > 0 && (
              <div className="pl-4 border-l-2 border-gray-800 space-y-2">
                <p className="text-[11px] font-mono text-gray-500 uppercase">Subtasks Dependency Tree:</p>
                {t.subtasks.map((st) => (
                  <div key={st.id} className="flex items-center justify-between text-xs py-1 text-gray-300">
                    <div className="flex items-center gap-2">
                      <ArrowRight className="w-3 h-3 text-gray-600" />
                      <span className="font-mono text-indigo-400 font-medium">{st.agent.toUpperCase()}:</span>
                      <span>{st.title}</span>
                    </div>
                    <span className="text-[10px] font-mono text-gray-400 uppercase">{st.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111827] border border-gray-800 rounded-xl max-w-lg w-full p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Create New Task for Chief</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-gray-400 mb-1">GOAL DESCRIPTION</label>
                <textarea
                  value={newGoal}
                  onChange={(e) => setNewGoal(e.target.value)}
                  placeholder="e.g. Find 20 gym leads in Palembang and prepare outreach drafts..."
                  className="w-full h-28 bg-[#090d16] border border-gray-700 rounded-lg p-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:bg-gray-800 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-all"
                >
                  Submit Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
