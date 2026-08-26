'use client';

import React, { useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface AuditRecord {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  taskId?: string;
  runId?: string;
  details: Record<string, unknown>;
}
interface AuditResponse {
  data: AuditRecord[];
  count: number;
  durable: boolean;
}

export default function AuditPage() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<AuditResponse>('/audit?limit=100');
      setRecords(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load audit events.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Audit Trail & Cost Accounting</h1>
          <p className="text-xs text-gray-400">Durable tool execution audit records. Cost aggregation remains tied to run records.</p>
        </div>
        <button onClick={() => void load()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh audit trail">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {error}
        </div>
      )}
      <div className="bg-[#111827] border border-gray-800 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-xs text-gray-400" role="status">
            Loading audit trail…
          </div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center text-xs text-gray-400">
            <Activity className="w-8 h-8 text-gray-500 mx-auto mb-3" />
            No audit events have been recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-800">
            {records.map(record => (
              <div key={record.id} className="p-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{record.action}</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {record.actor}
                    {record.taskId ? ` · task ${record.taskId}` : ''}
                  </p>
                </div>
                <p className="text-[10px] text-gray-500 shrink-0">{new Date(record.timestamp).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
