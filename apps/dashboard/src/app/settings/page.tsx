'use client';

import React from 'react';
import { Settings, ShieldAlert } from 'lucide-react';

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div><h1 className="text-xl font-bold text-white tracking-tight">System Settings & Governance</h1><p className="text-xs text-gray-400">Runtime configuration is loaded from the deployment environment and is not mutable from this dashboard.</p></div>
      <div className="p-10 bg-[#111827] border border-gray-800 rounded-xl text-center" role="status">
        <Settings className="w-10 h-10 text-gray-500 mx-auto mb-3" />
        <h2 className="text-sm font-semibold text-white">Configuration management unavailable</h2>
        <p className="text-xs text-gray-400 max-w-lg mx-auto mt-2">No settings are saved by this page. Change environment variables through the deployment workflow, then restart the services and verify readiness.</p>
        <div className="inline-flex items-center gap-2 mt-5 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"><ShieldAlert className="w-3.5 h-3.5" />No fake “saved successfully” state.</div>
      </div>
    </div>
  );
}
