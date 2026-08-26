'use client';

import React, { useState } from 'react';
import { Send, User, CheckCircle2 } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface ApiTask {
  id: string;
  title: string;
  status: string;
}
interface IntakeEvent {
  id: string;
  content: string;
  timestamp: string;
  status: 'submitted' | 'failed';
}

export default function CommunicationsPage() {
  const [events, setEvents] = useState<IntakeEvent[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const goal = inputMsg.trim();
    if (!goal || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const task = await atlasFetch<ApiTask>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: goal.slice(0, 80), goal, assignedAgent: 'chief' })
      });
      setEvents(current => [
        ...current,
        {
          id: task.id,
          content: `Task submitted to Chief: ${task.title} (${task.id})`,
          timestamp: new Date().toLocaleTimeString(),
          status: 'submitted'
        }
      ]);
      setInputMsg('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to submit the task.';
      setError(message);
      setEvents(current => [
        ...current,
        { id: `failed-${Date.now()}`, content: message, timestamp: new Date().toLocaleTimeString(), status: 'failed' }
      ]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Command Intake</h1>
        <p className="text-xs text-gray-400">
          Submit goals to Chief through the authenticated task API. A durable event stream is not exposed here yet.
        </p>
      </div>
      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {error}
        </div>
      )}
      <div className="flex-1 bg-[#111827] border border-gray-800 rounded-xl p-5 overflow-y-auto space-y-4">
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-xs text-gray-400">
            <User className="w-8 h-8 text-gray-600 mb-3" />
            <p>No commands submitted from this browser session.</p>
            <p className="text-[11px] text-gray-500 mt-1">Use the task page for durable task history.</p>
          </div>
        ) : (
          events.map(item => (
            <div key={item.id} className="flex gap-3 items-start">
              <div
                className={`p-2 rounded-lg shrink-0 ${item.status === 'submitted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}
              >
                {item.status === 'submitted' ? <CheckCircle2 className="w-4 h-4" /> : <User className="w-4 h-4" />}
              </div>
              <div className="bg-[#141d2b] border border-gray-800 rounded-xl p-3.5 flex-1">
                <div className="flex justify-between items-center gap-4 text-[10px] text-gray-400 font-mono mb-1">
                  <span className="font-semibold text-white">{item.status === 'submitted' ? 'ATLAS API' : 'Browser'}</span>
                  <span>{item.timestamp}</span>
                </div>
                <p className="text-xs text-gray-200 break-words">{item.content}</p>
              </div>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSend} className="flex gap-2" aria-label="Submit a goal">
        <label htmlFor="command-input" className="sr-only">
          Goal for Chief
        </label>
        <input
          id="command-input"
          type="text"
          value={inputMsg}
          onChange={event => setInputMsg(event.target.value)}
          placeholder="Describe a goal for Chief…"
          className="flex-1 bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !inputMsg.trim()}
          className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-2 transition-all"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{submitting ? 'Submitting…' : 'Submit'}</span>
        </button>
      </form>
    </div>
  );
}
