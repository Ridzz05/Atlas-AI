'use client';

import React, { useEffect, useState } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface MemoryItem { id: string; type: string; status: string; content: string; scope: string; source: string; confidence: number; updatedAt: string; }
interface MemoryResponse { data: MemoryItem[]; count: number; durable: boolean; }

export default function SharedBrainPage() {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<MemoryResponse>('/memory?limit=100');
      setItems(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load memory items.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-xl font-bold text-white tracking-tight">Shared Brain & Knowledge Store</h1><p className="text-xs text-gray-400">Verified and proposed memory records from the durable store.</p></div><button onClick={() => void load()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh memory"><RefreshCw className="w-4 h-4" /></button></div>
      {error && <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      <div className="bg-[#111827] border border-gray-800 rounded-xl overflow-hidden">
        {loading ? <div className="p-10 text-center text-xs text-gray-400" role="status">Loading memory items…</div> : items.length === 0 ? <div className="p-10 text-center text-xs text-gray-400"><Brain className="w-8 h-8 text-gray-500 mx-auto mb-3" />No memory items have been recorded yet.</div> : <div className="divide-y divide-gray-800">{items.map(item => <div key={item.id} className="p-4"><div className="flex items-center justify-between gap-4"><p className="text-sm font-medium text-white">{item.type} · {item.scope}</p><span className="text-[10px] uppercase text-gray-400">{item.status}</span></div><p className="mt-2 text-xs text-gray-300">{item.content}</p><p className="mt-2 text-[10px] text-gray-500">Source: {item.source} · confidence {(item.confidence * 100).toFixed(0)}%</p></div>)}</div>}
      </div>
    </div>
  );
}
