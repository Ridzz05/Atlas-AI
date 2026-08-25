'use client';

import React, { useState } from 'react';
import { Search, Brain, Database, Shield, CheckCircle2 } from 'lucide-react';

interface MockMemoryItem {
  id: string;
  type: string;
  scope: string;
  content: string;
  confidence: number;
  author: string;
  source: string;
  updatedAt: string;
}

const SAMPLE_MEMORIES: MockMemoryItem[] = [
  {
    id: 'mem-001',
    type: 'semantic',
    scope: 'business_knowledge',
    content: 'ATLAS AI OS uses TypeScript and Fastify architecture with multi-agent orchestration.',
    confidence: 1.0,
    author: 'chief',
    source: 'blueprint',
    updatedAt: '2026-08-26 05:00'
  },
  {
    id: 'mem-002',
    type: 'entity',
    scope: 'approved_research',
    content: 'Celebrity Fitness Palembang (Jl. POM IX) identified as high-volume lead with 600 active members.',
    confidence: 0.95,
    author: 'ned',
    source: 'web.search',
    updatedAt: '2026-08-26 05:01'
  },
  {
    id: 'mem-003',
    type: 'policy',
    scope: 'security',
    content: 'All external WhatsApp messaging requires HMAC SHA-256 cryptographic approval token from human owner.',
    confidence: 1.0,
    author: 'system',
    source: 'approval_matrix',
    updatedAt: '2026-08-26 04:30'
  }
];

export default function SharedBrainPage() {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = SAMPLE_MEMORIES.filter(m =>
    m.content.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.scope.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">Shared Brain & Knowledge Store</h1>
        <p className="text-xs text-gray-400">Multi-layer semantic, entity, episodic, and policy memory with verified source attribution.</p>
      </div>

      {/* Search Filter */}
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search knowledge by keyword, entity, or scope..."
          className="w-full bg-[#111827] border border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
      </div>

      {/* Memory Items List */}
      <div className="space-y-3">
        {filtered.map((item) => (
          <div key={item.id} className="p-5 bg-[#111827] border border-gray-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 font-mono">
                <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase font-semibold text-[10px]">
                  {item.type}
                </span>
                <span className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 text-[10px]">
                  scope: {item.scope}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono text-gray-400">
                <span>Confidence: <strong className="text-emerald-400">{(item.confidence * 100).toFixed(0)}%</strong></span>
                <span>Source: {item.source}</span>
                <span>Author: {item.author}</span>
              </div>
            </div>

            <p className="text-xs text-gray-200 leading-relaxed font-sans">{item.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
