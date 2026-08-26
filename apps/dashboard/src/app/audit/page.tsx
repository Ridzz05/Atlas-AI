'use client';

import React from 'react';
import { Activity, ShieldAlert } from 'lucide-react';

export default function AuditPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div><h1 className="text-xl font-bold text-white tracking-tight">Audit Trail & Cost Accounting</h1><p className="text-xs text-gray-400">Audit formatting exists in the runtime, but durable audit-event and aggregate-cost APIs are not exposed yet.</p></div>
      <div className="p-10 bg-[#111827] border border-gray-800 rounded-xl text-center" role="status">
        <Activity className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h2 className="text-sm font-semibold text-white">Telemetry browser unavailable</h2>
        <p className="text-xs text-gray-400 max-w-lg mx-auto mt-2">No sample token counts, costs, or security events are shown. Persist audit records and expose a read-only query endpoint before enabling this page.</p>
        <div className="inline-flex items-center gap-2 mt-5 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"><ShieldAlert className="w-3.5 h-3.5" />Telemetry is not yet connected.</div>
      </div>
    </div>
  );
}
