'use client';

import React, { useState } from 'react';
import { Send, Bot, User, ArrowRight, Wrench } from 'lucide-react';

interface FeedEvent {
  id: string;
  type: 'user_message' | 'delegation' | 'tool_call' | 'qa_verdict' | 'synthesis';
  from: string;
  to?: string;
  content: string;
  timestamp: string;
}

const SAMPLE_EVENTS: FeedEvent[] = [
  {
    id: 'ev-1',
    type: 'user_message',
    from: 'Human Owner (Telegram)',
    content: 'Cari 30 prospek gym di Palembang untuk layanan WhatsApp CRM kita.',
    timestamp: '05:00:10'
  },
  {
    id: 'ev-2',
    type: 'delegation',
    from: 'Chief',
    to: 'Ned',
    content: 'Delegated Step 1: Collect 30 gym locations and contacts in Palembang.',
    timestamp: '05:00:15'
  },
  {
    id: 'ev-3',
    type: 'tool_call',
    from: 'Ned',
    content: 'Called tool "web.search" with query: "gyms and fitness centers Palembang"',
    timestamp: '05:00:22'
  },
  {
    id: 'ev-4',
    type: 'delegation',
    from: 'Chief',
    to: 'Layla',
    content: 'Delegated Step 2: Score candidate gyms against 10-dimension ICP rubric.',
    timestamp: '05:00:40'
  },
  {
    id: 'ev-5',
    type: 'qa_verdict',
    from: 'Argus',
    content: 'QA Gate Verdict: PASS (All citations and calculations verified).',
    timestamp: '05:01:05'
  },
  {
    id: 'ev-6',
    type: 'synthesis',
    from: 'Chief',
    content: 'Executive synthesis completed. 10 qualified leads identified with personalized outreach drafts.',
    timestamp: '05:01:15'
  }
];

export default function CommunicationsPage() {
  const [events, setEvents] = useState<FeedEvent[]>(SAMPLE_EVENTS);
  const [inputMsg, setInputMsg] = useState('');

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim()) return;

    const newEv: FeedEvent = {
      id: `ev-${Date.now()}`,
      type: 'user_message',
      from: 'Human Owner (Web UI)',
      content: inputMsg,
      timestamp: new Date().toLocaleTimeString()
    };

    setEvents([...events, newEv]);
    setInputMsg('');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Communications & Event Stream</h1>
        <p className="text-xs text-gray-400">Real-time user dialog, agent-to-agent delegations, and tool invocations.</p>
      </div>

      {/* Feed Container */}
      <div className="flex-1 bg-[#111827] border border-gray-800 rounded-xl p-5 overflow-y-auto space-y-4">
        {events.map((ev) => {
          if (ev.type === 'user_message') {
            return (
              <div key={ev.id} className="flex gap-3 items-start justify-end">
                <div className="bg-indigo-600/30 border border-indigo-500/40 rounded-xl p-3.5 max-w-lg">
                  <div className="flex justify-between items-center gap-4 text-[10px] text-indigo-300 font-mono mb-1">
                    <span>{ev.from}</span>
                    <span>{ev.timestamp}</span>
                  </div>
                  <p className="text-xs text-white">{ev.content}</p>
                </div>
                <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0">
                  <User className="w-4 h-4" />
                </div>
              </div>
            );
          }

          return (
            <div key={ev.id} className="flex gap-3 items-start">
              <div className="p-2 rounded-lg bg-gray-800 text-indigo-400 shrink-0 border border-gray-700">
                {ev.type === 'tool_call' ? <Wrench className="w-4 h-4 text-cyan-400" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className="bg-[#141d2b] border border-gray-800 rounded-xl p-3.5 max-w-xl flex-1">
                <div className="flex justify-between items-center gap-4 text-[10px] text-gray-400 font-mono mb-1">
                  <span className="font-semibold text-white">
                    {ev.from} {ev.to && <span className="text-indigo-400 font-normal">→ {ev.to}</span>}
                  </span>
                  <span>{ev.timestamp}</span>
                </div>
                <p className="text-xs text-gray-200">{ev.content}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          placeholder="Message Chief or instruct the specialist team..."
          className="flex-1 bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center gap-2 transition-all shadow-md shadow-indigo-600/30"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
}
