'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCw, Save, Settings, ShieldAlert, Trash2 } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface RuntimeSettings {
  nodeEnv: string;
  modelProvider: string;
  modelName: string | null;
  modelConfigured: boolean;
  modelKeyFingerprint: string | null;
  modelConfigSource: 'environment' | 'database';
  globalDailyBudgetUsd: number;
  maxConcurrentAgentRuns: number;
  maxDelegationDepth: number;
  externalWritesEnabled: boolean;
  apiAuthRequired: boolean;
  corsAllowedOrigins: string[];
  source: 'environment' | 'database';
  mutable: boolean;
}

interface SettingsResponse {
  data: RuntimeSettings;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

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

  const saveOpenRouterKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!apiKey.trim()) {
      setKeyMessage('Masukkan API key OpenRouter terlebih dahulu.');
      return;
    }

    setSavingKey(true);
    setKeyMessage(null);
    try {
      await atlasFetch('/settings/model-provider', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: apiKey.trim() })
      });
      setApiKey('');
      setKeyMessage('API key tersimpan terenkripsi dan siap dipakai worker.');
      await loadSettings();
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : 'API key gagal disimpan.');
    } finally {
      setSavingKey(false);
    }
  };

  const clearOpenRouterKey = async () => {
    if (!window.confirm('Hapus API key OpenRouter dari konfigurasi ATLAS?')) return;

    setSavingKey(true);
    setKeyMessage(null);
    try {
      await atlasFetch('/settings/model-provider', { method: 'DELETE' });
      setKeyMessage('API key OpenRouter sudah dihapus.');
      await loadSettings();
    } catch (err) {
      setKeyMessage(err instanceof Error ? err.message : 'API key gagal dihapus.');
    } finally {
      setSavingKey(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">System Settings &amp; Governance</h1>
          <p className="text-xs text-gray-400">Runtime configuration and secure OpenRouter connection.</p>
        </div>
        <button
          onClick={() => void loadSettings()}
          className="p-2 rounded-lg text-gray-400 hover:bg-gray-800"
          aria-label="Refresh settings"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-300">
          {error}
        </div>
      )}
      {loading ? (
        <div className="p-12 text-center text-xs text-gray-400" role="status" aria-busy="true">
          Loading runtime settings...
        </div>
      ) : (
        settings && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Setting label="ENVIRONMENT" value={settings.nodeEnv} />
              <Setting label="MODEL PROVIDER" value={settings.modelProvider} />
              <Setting label="MODEL" value={settings.modelName || 'not configured'} />
              <Setting
                label="MODEL API KEY"
                value={
                  settings.modelConfigured
                    ? `configured${settings.modelKeyFingerprint ? ` · ${settings.modelKeyFingerprint}` : ''}`
                    : 'not configured'
                }
                tone={settings.modelConfigured ? 'safe' : 'danger'}
              />
              <Setting label="DAILY BUDGET" value={`$${settings.globalDailyBudgetUsd.toFixed(2)}`} />
              <Setting label="MAX CONCURRENT RUNS" value={String(settings.maxConcurrentAgentRuns)} />
              <Setting label="MAX DELEGATION DEPTH" value={String(settings.maxDelegationDepth)} />
              <Setting label="API AUTHENTICATION" value={settings.apiAuthRequired ? 'REQUIRED' : 'NOT CONFIGURED'} />
              <Setting
                label="EXTERNAL WRITES"
                value={settings.externalWritesEnabled ? 'ENABLED' : 'DISABLED'}
                tone={settings.externalWritesEnabled ? 'danger' : 'safe'}
              />
              <Setting label="CONFIGURATION SOURCE" value={settings.source.toUpperCase()} />
            </div>

            <div className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <KeyRound className="w-4 h-4 text-indigo-400" />
                OpenRouter connection
              </div>
              <p className="text-xs text-gray-400">
                ATLAS memakai <span className="font-mono text-gray-300">z-ai/glm-5.2:free</span>. Key dikirim ke API terautentikasi,
                dienkripsi di server, lalu dibaca worker lintas-proses. Key tidak disimpan di browser dan tidak dikembalikan ke UI.
              </p>
              {settings.mutable ? (
                <>
                  <form onSubmit={saveOpenRouterKey} className="space-y-3">
                    <label className="block text-[11px] font-mono text-gray-400" htmlFor="openrouter-api-key">
                      OPENROUTER API KEY
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="openrouter-api-key"
                        type="password"
                        value={apiKey}
                        onChange={event => setApiKey(event.target.value)}
                        placeholder="sk-or-v1-..."
                        autoComplete="new-password"
                        spellCheck={false}
                        className="flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
                      />
                      <button
                        type="submit"
                        disabled={savingKey || !apiKey.trim()}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        {savingKey ? 'Saving...' : 'Save key'}
                      </button>
                    </div>
                  </form>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void clearOpenRouterKey()}
                      disabled={savingKey || !settings.modelConfigured}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear key
                    </button>
                    {keyMessage && (
                      <p className="text-xs text-gray-300" role="status">
                        {keyMessage}
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-amber-300">
                  Secure settings storage belum tersedia. Pastikan API berjalan dengan database dan migrasi aktif.
                </p>
              )}
            </div>

            <div className="p-6 bg-[#111827] border border-gray-800 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Settings className="w-4 h-4 text-indigo-400" />
                Governance boundary
              </div>
              <p className="text-xs text-gray-400">
                Governance values remain deployment-controlled. Only the OpenRouter credential is mutable here so the worker can use a key
                entered by the owner without exposing it to the browser runtime.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px]">
                <ShieldAlert className="w-3.5 h-3.5" />
                No raw secret is exposed by this view; only configuration status and a non-reversible fingerprint are shown.
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Setting({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'safe' | 'danger' }) {
  const valueClass = tone === 'safe' ? 'text-emerald-400' : tone === 'danger' ? 'text-rose-400' : 'text-white';
  return (
    <div className="p-4 rounded-xl bg-[#111827] border border-gray-800">
      <p className="text-[11px] font-mono text-gray-400">{label}</p>
      <p className={`text-sm font-semibold mt-1 ${valueClass}`}>{value}</p>
    </div>
  );
}
