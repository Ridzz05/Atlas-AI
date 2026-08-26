'use client';

import React from 'react';
import { Brain, ShieldAlert } from 'lucide-react';

export default function SharedBrainPage() {
  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div><h1 className="text-xl font-bold text-white tracking-tight">Shared Brain & Knowledge Store</h1><p className="text-xs text-gray-400">Memory storage exists in the runtime package, but no authenticated dashboard query endpoint is exposed yet.</p></div>
      <div className="p-10 bg-[#111827] border border-gray-800 rounded-xl text-center" role="status">
        <Brain className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h2 className="text-sm font-semibold text-white">Knowledge browser unavailable</h2>
        <p className="text-xs text-gray-400 max-w-lg mx-auto mt-2">The dashboard intentionally does not display invented memory records. Add a read-only memory search route with verification metadata before enabling this view.</p>
        <div className="inline-flex items-center gap-2 mt-5 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"><ShieldAlert className="w-3.5 h-3.5" />No fabricated knowledge is displayed.</div>
      </div>
    </div>
  );
}
