'use client';

import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface ArtifactRecord {
  id: string;
  taskId: string;
  runId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface ArtifactResponse { data: ArtifactRecord[]; count: number; durable: boolean; }

export default function ArtifactsPage() {
  const [records, setRecords] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<ArtifactResponse>('/artifacts?limit=100');
      setRecords(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load artifact metadata.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4"><div><h1 className="text-xl font-bold text-white tracking-tight">Artifacts & Deliverables</h1><p className="text-xs text-gray-400">Durable metadata from the worker artifact store. File paths stay server-side.</p></div><button onClick={() => void load()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh artifacts"><RefreshCw className="w-4 h-4" /></button></div>
      {error && <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      <div className="bg-[#111827] border border-gray-800 rounded-xl overflow-hidden">
        {loading ? <div className="p-10 text-center text-xs text-gray-400" role="status">Loading artifact metadata…</div> : records.length === 0 ? <div className="p-10 text-center text-xs text-gray-400"><FileText className="w-8 h-8 text-gray-500 mx-auto mb-3" />No artifacts have been recorded yet.</div> : <div className="divide-y divide-gray-800">{records.map(record => <div key={record.id} className="p-4 flex items-center justify-between gap-4"><div className="min-w-0"><p className="text-sm font-medium text-white truncate">{record.name}</p><p className="text-[10px] text-gray-400 font-mono">{record.mimeType} · task {record.taskId}</p></div><div className="text-right shrink-0"><p className="text-xs text-gray-300">{record.sizeBytes.toLocaleString()} bytes</p><p className="text-[10px] text-gray-500">{new Date(record.createdAt).toLocaleString()}</p></div></div>)}</div>}
      </div>
    </div>
  );
}
