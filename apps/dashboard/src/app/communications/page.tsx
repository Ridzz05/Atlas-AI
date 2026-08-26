'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, MessageSquare, RefreshCw, Send, Wrench } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';
import { subscribeToAtlasEvents } from '../../lib/event-stream';
import {
  buildCommunicationFeed,
  CommunicationFeedItem,
  CommunicationMessageRecord,
  CommunicationToolCallRecord
} from '../../lib/communications';

interface ApiTask {
  id: string;
  title: string;
}

interface RecordListResponse<T> {
  data: T[];
  count: number;
  durable: boolean;
}

type FeedFilter = 'all' | 'message' | 'tool';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function FeedCard({ item }: { item: CommunicationFeedItem }) {
  const isTool = item.kind === 'tool';
  return (
    <article className="flex gap-3 items-start">
      <div className={`p-2 rounded-lg shrink-0 ${isTool ? 'bg-amber-500/10 text-amber-300' : 'bg-indigo-500/10 text-indigo-300'}`}>
        {isTool ? <Wrench className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
      </div>
      <div className="bg-[#141d2b] border border-gray-800 rounded-xl p-3.5 flex-1 min-w-0">
        <div className="flex flex-wrap justify-between items-center gap-x-4 gap-y-1 text-[10px] text-gray-400 font-mono mb-1">
          <span className="font-semibold text-white">{item.sender}</span>
          <time dateTime={item.timestamp}>{formatTimestamp(item.timestamp)}</time>
        </div>
        <p className="text-xs text-gray-200 break-words">{item.summary}</p>
        <div className="flex flex-wrap gap-2 mt-2 text-[10px] font-mono text-gray-500">
          {item.taskId && <span>task:{item.taskId}</span>}
          {item.runId && <span>run:{item.runId}</span>}
          {item.riskLevel && <span className="text-amber-300">risk:{item.riskLevel}</span>}
        </div>
      </div>
    </article>
  );
}

export default function CommunicationsPage() {
  const [feed, setFeed] = useState<CommunicationFeedItem[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [taskIdFilter, setTaskIdFilter] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadFeedRef = useRef<() => Promise<void>>(async () => undefined);

  const loadFeed = useCallback(async () => {
    const trimmedTaskId = taskIdFilter.trim();
    if (trimmedTaskId && !UUID_PATTERN.test(trimmedTaskId)) {
      setError('Task filter must be a valid UUID.');
      setFeed([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const suffix = trimmedTaskId ? `&taskId=${encodeURIComponent(trimmedTaskId)}` : '';
      const [messages, toolCalls] = await Promise.all([
        atlasFetch<RecordListResponse<CommunicationMessageRecord>>(`/messages?limit=100${suffix}`),
        atlasFetch<RecordListResponse<CommunicationToolCallRecord>>(`/tool-calls?limit=100${suffix}`)
      ]);
      setFeed(buildCommunicationFeed(messages.data, toolCalls.data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load communication history.');
    } finally {
      setLoading(false);
    }
  }, [taskIdFilter]);

  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    const stream = new EventSource('/api/atlas/events/stream');
    const unsubscribe = subscribeToAtlasEvents(stream, () => void loadFeedRef.current());
    const handleOpen = () => setRealtime(true);
    const handleError = () => setRealtime(false);
    stream.addEventListener('open', handleOpen);
    stream.addEventListener('error', handleError);

    return () => {
      unsubscribe();
      stream.removeEventListener('open', handleOpen);
      stream.removeEventListener('error', handleError);
      stream.close();
    };
  }, []);

  const visibleFeed = useMemo(() => (feedFilter === 'all' ? feed : feed.filter(item => item.kind === feedFilter)), [feed, feedFilter]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const goal = inputMsg.trim();
    if (!goal || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await atlasFetch<ApiTask>('/tasks', {
        method: 'POST',
        body: JSON.stringify({ title: goal.slice(0, 80), goal, assignedAgent: 'chief' })
      });
      setInputMsg('');
      await loadFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit the task.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Communications</h1>
          <p className="text-xs text-gray-400">Durable user, agent, and tool activity from the authenticated ATLAS API.</p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-gray-400">
          <span className={`w-2 h-2 rounded-full ${realtime ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          {realtime ? 'live' : 'reconnecting'}
          <button
            onClick={() => void loadFeed()}
            className="p-2 rounded-lg text-gray-400 hover:bg-gray-800"
            aria-label="Refresh communications"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {(['all', 'message', 'tool'] as FeedFilter[]).map(filter => (
          <button
            key={filter}
            onClick={() => setFeedFilter(filter)}
            className={`px-3 py-1.5 rounded-lg text-xs border ${feedFilter === filter ? 'bg-indigo-600/20 text-indigo-200 border-indigo-500/40' : 'text-gray-400 border-gray-800 hover:bg-gray-800'}`}
          >
            {filter === 'all' ? 'All activity' : filter === 'message' ? 'Messages' : 'Tool calls'}
          </button>
        ))}
        <label htmlFor="task-filter" className="sr-only">
          Filter by task UUID
        </label>
        <input
          id="task-filter"
          value={taskIdFilter}
          onChange={event => setTaskIdFilter(event.target.value)}
          placeholder="Filter by task UUID"
          className="min-w-[16rem] flex-1 bg-[#111827] border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex-1 bg-[#111827] border border-gray-800 rounded-xl p-5 overflow-y-auto space-y-4">
        {loading ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading communication history...</div>
        ) : visibleFeed.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-xs text-gray-400">
            <Activity className="w-8 h-8 text-gray-600 mb-3" />
            <p>No durable communication records found.</p>
            <p className="text-[11px] text-gray-500 mt-1">New task, agent, and tool activity will appear here automatically.</p>
          </div>
        ) : (
          visibleFeed.map(item => <FeedCard key={`${item.kind}-${item.id}`} item={item} />)
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
          placeholder="Describe a goal for Chief..."
          className="flex-1 bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !inputMsg.trim()}
          className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center gap-2 transition-all"
        >
          <Send className="w-3.5 h-3.5" />
          <span>{submitting ? 'Submitting...' : 'Submit'}</span>
        </button>
      </form>
    </div>
  );
}
