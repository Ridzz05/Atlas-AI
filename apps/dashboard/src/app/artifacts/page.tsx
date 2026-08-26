'use client';

import React from 'react';
import { FileText, ShieldAlert } from 'lucide-react';

export default function ArtifactsPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div><h1 className="text-xl font-bold text-white tracking-tight">Artifacts & Deliverables</h1><p className="text-xs text-gray-400">Generated files are stored by the worker, but an authenticated artifact listing/download API is not exposed yet.</p></div>
      <div className="p-10 bg-[#111827] border border-gray-800 rounded-xl text-center" role="status">
        <FileText className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h2 className="text-sm font-semibold text-white">Artifact browser unavailable</h2>
        <p className="text-xs text-gray-400 max-w-lg mx-auto mt-2">The dashboard intentionally does not show sample deliverables. Connect the artifact repository and a read-only API before exposing files here.</p>
        <div className="inline-flex items-center gap-2 mt-5 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"><ShieldAlert className="w-3.5 h-3.5" />No fabricated artifact data is displayed.</div>
      </div>
    </div>
  );
}
