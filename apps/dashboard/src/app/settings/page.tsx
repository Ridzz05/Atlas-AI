'use client';

import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import { CiSettings, CiRedo, CiLock, CiFloppyDisk, CiTrash } from 'react-icons/ci';
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
    <Box sx={{ maxWidth: 860, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiSettings size={26} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              System Governance & Keys
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Runtime configuration and secure OpenRouter credential connection.
          </Typography>
        </Box>
        <IconButton
          onClick={() => void loadSettings()}
          sx={{
            color: '#666155',
            bgcolor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid rgba(32, 21, 21, 0.1)',
            boxShadow: '0 2px 6px rgba(32, 21, 21, 0.04)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
          aria-label="Refresh settings"
        >
          <CiRedo size={18} />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ p: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading governance configuration…
          </Typography>
        </Box>
      ) : (
        <Stack spacing={3}>
          {/* OpenRouter API Key Setup Card */}
          <Card sx={{ p: 3.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)', boxShadow: '0 4px 16px rgba(32, 21, 21, 0.04)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              <CiLock size={22} color="#c2410c" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515' }}>
                OpenRouter API Key Provisioning
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ color: '#666155', mb: 2.5, fontSize: '0.84rem' }}>
              Used by workers for LLM generation, task decomposition, and dense vector embeddings.
            </Typography>

            {keyMessage && (
              <Alert severity="info" sx={{ mb: 2, bgcolor: '#fbf8f2', border: '1px solid rgba(255, 79, 0, 0.25)', color: '#201515', borderRadius: '10px' }}>
                {keyMessage}
              </Alert>
            )}

            <Box component="form" onSubmit={saveOpenRouterKey} sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                disabled={savingKey}
                sx={{ flex: 1, minWidth: 260 }}
              />
              <Button type="submit" variant="contained" color="primary" disabled={savingKey || !apiKey.trim()} startIcon={<CiFloppyDisk size={18} />}>
                Save Key
              </Button>
              {settings?.modelConfigured && (
                <Button variant="outlined" color="error" disabled={savingKey} onClick={() => void clearOpenRouterKey()} startIcon={<CiTrash size={18} />}>
                  Remove
                </Button>
              )}
            </Box>
          </Card>

          {/* Engine Parameters Card */}
          {settings && (
            <Card sx={{ p: 3.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)', boxShadow: '0 4px 16px rgba(32, 21, 21, 0.04)' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515', mb: 2.5 }}>
                Engine Operational Guardrails
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>GLOBAL DAILY BUDGET</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>${settings.globalDailyBudgetUsd.toFixed(2)}</Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>MAX CONCURRENT RUNS</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>{settings.maxConcurrentAgentRuns}</Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>MAX DELEGATION DEPTH</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>{settings.maxDelegationDepth}</Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>EXTERNAL WRITES</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: settings.externalWritesEnabled ? '#16a34a' : '#ff4f00', mt: 0.5 }}>
                    {settings.externalWritesEnabled ? 'ENABLED' : 'GATED'}
                  </Typography>
                </Box>
              </Box>
            </Card>
          )}
        </Stack>
      )}
    </Box>
  );
}
