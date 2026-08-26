'use client';

import React, { useEffect, useState } from 'react';
import { RefreshCw, Settings, ShieldAlert } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface RuntimeSettings {
  nodeEnv: string;
  modelProvider: string;
  globalDailyBudgetUsd: number;
  maxConcurrentAgentRuns: number;
  maxDelegationDepth: number;
  externalWritesEnabled: boolean;
  apiAuthRequired: boolean;
  corsAllowedOrigins: string[];
  source: 'environment';
  mutable: false;
}

interface SettingsResponse {
  data: RuntimeSettings;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<SettingsResponse>('/settings');
      setSettings(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load runtime settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSettings(); }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">System Settings &amp; Governance</h1>
          <p className="text-xs text-gray-400">Read-only runtime configuration from the authenticated ATLAS API.</p>
        </div>
        <button onClick={() => void loadSettings()} className="p-2 rounded-lg text-gray-400 hover:bg-gray-800" aria-label="Refresh settings">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">{error}</div>}
      {loading ? <div className="p-12 text-center text-xs text-gray-400" role="status" aria-busy="true">Loading runtime settings…</div> : settings && <>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Setting label="ENVIRONMENT" value={settings.nodeEnv} />
          <Setting label="MODEL PROVIDER" value={settings.modelProvider} />
          <Setting label="DAILY BUDGET" value={`$${settings.globalDailyBudgetUsd.toFixed(2)}`} />
          <Setting label="MAX CONCURRENT RUNS" value={String(settings.maxConcurrentAgentRuns)} />
          <Setting label="MAX DELEGATION DEPTH" value={String(settings.maxDelegationDepth)} />
          <Setting label="API AUTHENTICATION" value={settings.apiAuthRequired ? 'REQUIRED' : 'NOT CONFIGURED'} />
          <Setting label="EXTERNAL WRITES" value={settings.externalWritesEnabled ? 'ENABLED' : 'DISABLED'} tone={settings.externalWritesEnabled ? 'danger' : 'safe'} />
          <Setting label="CONFIGURATION SOURCE" value={settings.source.toUpperCase()} />
        </div>

        <div className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Settings className="w-4 h-4 text-indigo-400" />Governance boundary</div>
          <p className="text-xs text-gray-400">Settings are intentionally immutable from the dashboard. Change deployment environment variables, restart services, and verify readiness.</p>
          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]"><ShieldAlert className="w-3.5 h-3.5" />No secrets or fake saved state are exposed by this view.</div>
        </div>
      </>}
    </div>
  );
}

function Setting({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'safe' | 'danger' }) {
  const valueClass = tone === 'safe' ? 'text-emerald-400' : tone === 'danger' ? 'text-rose-400' : 'text-white';
  return <div className="p-4 rounded-xl bg-[#111827] border border-gray-800"><p className="text-[11px] font-mono text-gray-400">{label}</p><p className={`text-sm font-semibold mt-1 ${valueClass}`}>{value}</p></div>;
}
