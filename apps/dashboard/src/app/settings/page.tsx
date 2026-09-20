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
import MenuItem from '@mui/material/MenuItem';
import Divider from '@mui/material/Divider';
import {
  CiSettings,
  CiRedo,
  CiLock,
  CiFloppyDisk,
  CiTrash,
  CiChat1,
  CiServer,
  CiCircleCheck,
  CiCircleAlert,
  CiBoxes,
  CiMobile3,
  CiCircleInfo
} from 'react-icons/ci';
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
  telegramConfigured?: boolean;
  telegramAllowedUserIds?: string;
  telegramTokenMasked?: string | null;
}

interface SettingsResponse {
  data: RuntimeSettings;
}

const SUPPORTED_PROVIDERS = [
  {
    id: 'zrouter',
    label: 'zRouter (DeepSeek v4.1 Flash / Ultra Fast & Cheap)',
    placeholder: 'zr-...',
    defaultModel: 'deepseek-v4.1-flash',
    popularModels: ['deepseek-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.3-flash', 'minimax-m3']
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (Multi-Platform: Claude, GPT, Gemini, DeepSeek)',
    placeholder: 'sk-or-v1-...',
    defaultModel: 'anthropic/claude-3.7-sonnet',
    popularModels: [
      'anthropic/claude-3.7-sonnet',
      'openai/gpt-4o',
      'google/gemini-2.0-flash-001',
      'deepseek/deepseek-chat',
      'minimax/minimax-m3:free'
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI (Direct: ChatGPT / GPT-4o / o3-mini)',
    placeholder: 'sk-proj-...',
    defaultModel: 'gpt-4o',
    popularModels: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1']
  },
  {
    id: 'groq',
    label: 'Groq (Ultra-Fast LPU Hardware)',
    placeholder: 'gsk_...',
    defaultModel: 'llama-3.3-70b-versatile',
    popularModels: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768', 'deepseek-r1-distill-llama-70b']
  },
  {
    id: 'deepseek',
    label: 'DeepSeek (Direct API)',
    placeholder: 'sk-...',
    defaultModel: 'deepseek-chat',
    popularModels: ['deepseek-chat', 'deepseek-reasoner']
  },
  {
    id: 'ollama',
    label: 'Ollama (Local Offline - 100% Free & Private)',
    placeholder: 'Not required for local Ollama',
    defaultModel: 'llama3.2',
    popularModels: ['llama3.2', 'qwen2.5', 'deepseek-r1:8b', 'mistral']
  },
  {
    id: 'openai-compatible',
    label: 'OpenAI Compatible (Google Gemini / vLLM / LocalAI)',
    placeholder: 'AIzaSy... or custom token',
    defaultModel: 'gemini-2.0-flash',
    popularModels: ['gemini-2.0-flash', 'gemini-1.5-pro', 'custom-model']
  }
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Model Provider Form
  const [selectedProvider, setSelectedProvider] = useState('openrouter');
  const [modelName, setModelName] = useState('anthropic/claude-3.7-sonnet');
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keyMessage, setKeyMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Telegram Form
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramUserIds, setTelegramUserIds] = useState('');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<SettingsResponse>('/settings');
      setSettings(response.data);
      if (response.data.modelProvider) {
        setSelectedProvider(response.data.modelProvider);
      }
      if (response.data.modelName) {
        setModelName(response.data.modelName);
      }
      if (response.data.telegramAllowedUserIds) {
        setTelegramUserIds(response.data.telegramAllowedUserIds);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load runtime settings.');
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (providerId: string) => {
    setSelectedProvider(providerId);
    const matched = SUPPORTED_PROVIDERS.find(p => p.id === providerId);
    if (matched) {
      setModelName(matched.defaultModel);
    }
  };

  const saveModelProvider = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedProvider !== 'ollama' && !apiKey.trim() && !settings?.modelConfigured) {
      setKeyMessage({ text: 'Masukkan API key untuk provider yang dipilih.', type: 'error' });
      return;
    }

    setSavingKey(true);
    setKeyMessage(null);
    try {
      await atlasFetch('/settings/model-provider', {
        method: 'PUT',
        body: JSON.stringify({
          provider: selectedProvider,
          modelName: modelName.trim() || undefined,
          apiKey: apiKey.trim() || undefined
        })
      });
      setApiKey('');
      setKeyMessage({
        text: `Kredensial ${selectedProvider.toUpperCase()} (${modelName}) berhasil disimpan terenkripsi di database!`,
        type: 'success'
      });
      await loadSettings();
    } catch (err) {
      setKeyMessage({ text: err instanceof Error ? err.message : 'Gagal menyimpan kredensial model.', type: 'error' });
    } finally {
      setSavingKey(false);
    }
  };

  const clearModelProviderKey = async () => {
    if (!window.confirm('Hapus kredensial model provider dari konfigurasi ATLAS?')) return;

    setSavingKey(true);
    setKeyMessage(null);
    try {
      await atlasFetch('/settings/model-provider', { method: 'DELETE' });
      setKeyMessage({ text: 'Kredensial model provider sudah dibersihkan.', type: 'success' });
      await loadSettings();
    } catch (err) {
      setKeyMessage({ text: err instanceof Error ? err.message : 'Gagal menghapus API key.', type: 'error' });
    } finally {
      setSavingKey(false);
    }
  };

  const saveTelegramSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingTelegram(true);
    setTelegramMessage(null);

    try {
      await atlasFetch('/settings/telegram', {
        method: 'PUT',
        body: JSON.stringify({
          botToken: telegramToken.trim() || undefined,
          allowedUserIds: telegramUserIds.trim() || undefined
        })
      });
      setTelegramToken('');
      setTelegramMessage({
        text: 'Pengaturan Telegram Bot berhasil disimpan ke runtime dan konfigurasi server!',
        type: 'success'
      });
      await loadSettings();
    } catch (err) {
      setTelegramMessage({
        text: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan Telegram.',
        type: 'error'
      });
    } finally {
      setSavingTelegram(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const activeProviderMeta = SUPPORTED_PROVIDERS.find(p => p.id === selectedProvider) || SUPPORTED_PROVIDERS[0]!;

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiSettings size={28} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#201515', letterSpacing: '-0.02em' }}>
              System Governance & Platform Keys
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Konfigurasi Multi-Platform AI (ChatGPT, Claude, Gemini), Telegram Remote Control, dan batas runtime.
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
        <Alert
          severity="error"
          sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}
        >
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
        <Stack spacing={3.5}>
          {/* SECTION 1: TELEGRAM BOT REMOTE CONTROL */}
          <Card
            sx={{
              p: 3.5,
              bgcolor: '#ffffff',
              borderRadius: '18px',
              border: '1px solid rgba(32, 21, 21, 0.08)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    bgcolor: '#eff6ff',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <CiMobile3 size={22} color="#2563eb" />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#201515' }}>
                    Telegram Remote Control Bot
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#666155' }}>
                    Kendalikan seluruh armada agent, trigger task baru, dan berikan approval via chat Telegram
                  </Typography>
                </Box>
              </Box>

              {settings?.telegramConfigured ? (
                <Chip
                  icon={<CiCircleCheck size={14} style={{ color: '#16a34a' }} />}
                  label="BOT ACTIVE"
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontSize: '0.68rem',
                    bgcolor: '#dcfce7',
                    color: '#16a34a',
                    border: '1px solid rgba(22, 163, 74, 0.25)'
                  }}
                />
              ) : (
                <Chip
                  icon={<CiCircleAlert size={14} style={{ color: '#d97706' }} />}
                  label="NOT CONFIGURED"
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontSize: '0.68rem',
                    bgcolor: '#fef3c7',
                    color: '#d97706',
                    border: '1px solid rgba(217, 119, 6, 0.25)'
                  }}
                />
              )}
            </Box>

            {telegramMessage && (
              <Alert severity={telegramMessage.type} sx={{ mb: 2.5, borderRadius: '10px' }}>
                {telegramMessage.text}
              </Alert>
            )}

            <Box component="form" onSubmit={saveTelegramSettings} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 0.5, display: 'block' }}>
                    Telegram Bot Token (dari @BotFather)
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    type="password"
                    value={telegramToken}
                    onChange={e => setTelegramToken(e.target.value)}
                    placeholder={settings?.telegramTokenMasked || '123456789:ABCdefGhIJKlmNoPQRstuVWXyz...'}
                    disabled={savingTelegram}
                  />
                  <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.7rem', mt: 0.5, display: 'block' }}>
                    Token bot yang didapat saat membuat bot melalui chat ke <code>@BotFather</code>.
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 0.5, display: 'block' }}>
                    Allowed Telegram User IDs (ID Pemilik)
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={telegramUserIds}
                    onChange={e => setTelegramUserIds(e.target.value)}
                    placeholder="7860981010 (dapatkan via @userinfobot)"
                    disabled={savingTelegram}
                  />
                  <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.7rem', mt: 0.5, display: 'block' }}>
                    Hanya akun dengan ID ini yang diizinkan mengontrol sistem (pisahkan dengan koma jika lebih dari satu).
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={savingTelegram || (!telegramToken.trim() && !telegramUserIds.trim())}
                  startIcon={<CiFloppyDisk size={18} />}
                  sx={{ px: 3 }}
                >
                  {savingTelegram ? 'Menyimpan…' : 'Simpan Pengaturan Telegram'}
                </Button>
              </Box>
            </Box>

            <Divider sx={{ my: 2.5, borderColor: 'rgba(32, 21, 21, 0.06)' }} />

            {/* Supported Commands Reference */}
            <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 1, display: 'block' }}>
              Perintah Telegram Bot yang Didukung:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {[
                { cmd: '/start', desc: 'Sambut & cek izin' },
                { cmd: '/new <goal>', desc: 'Buat task otonom baru' },
                { cmd: '/status', desc: 'Cek task aktif' },
                { cmd: '/pause', desc: 'Jeda eksekusi sistem' },
                { cmd: '/resume', desc: 'Lanjutkan sistem' },
                { cmd: '/budget', desc: 'Pantau biaya & token' },
                { cmd: '/approve <id>', desc: 'Setujui aksi berisiko' }
              ].map(c => (
                <Chip
                  key={c.cmd}
                  label={`${c.cmd} · ${c.desc}`}
                  size="small"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.7rem',
                    bgcolor: '#f5efe6',
                    color: '#201515',
                    border: '1px solid rgba(32, 21, 21, 0.08)'
                  }}
                />
              ))}
            </Box>
          </Card>

          {/* SECTION 2: MULTI-MODEL PLATFORM & API KEYS */}
          <Card
            sx={{
              p: 3.5,
              bgcolor: '#ffffff',
              borderRadius: '18px',
              border: '1px solid rgba(32, 21, 21, 0.08)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)'
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    bgcolor: '#fff3eb',
                    border: '1px solid rgba(255, 79, 0, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <CiServer size={22} color="#c2410c" />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#201515' }}>
                    Multi-Model Platform & LLM Provisioning
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#666155' }}>
                    Pilih provider kecerdasan buatan untuk menggerakkan seluruh armada (ChatGPT, Claude, Gemini, DeepSeek)
                  </Typography>
                </Box>
              </Box>

              {settings?.modelConfigured ? (
                <Chip
                  icon={<CiCircleCheck size={14} style={{ color: '#16a34a' }} />}
                  label="KEY CONFIGURED"
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontSize: '0.68rem',
                    bgcolor: '#dcfce7',
                    color: '#16a34a',
                    border: '1px solid rgba(22, 163, 74, 0.25)'
                  }}
                />
              ) : (
                <Chip
                  icon={<CiCircleAlert size={14} style={{ color: '#dc2626' }} />}
                  label="NO KEY ACTIVE"
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontSize: '0.68rem',
                    bgcolor: '#fee2e2',
                    color: '#dc2626',
                    border: '1px solid rgba(220, 38, 38, 0.25)'
                  }}
                />
              )}
            </Box>

            {/* Architecture Explanation: OAuth vs API Key */}
            <Box
              sx={{
                p: 2.25,
                borderRadius: '12px',
                bgcolor: '#faf6f0',
                border: '1px solid rgba(255, 79, 0, 0.18)',
                mb: 3
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
                <CiCircleInfo size={18} color="#c2410c" />
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#c2410c', fontSize: '0.8rem' }}>
                  Mengapa Menggunakan Platform API Key Bukan Login OAuth Web?
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#666155', display: 'block', lineHeight: 1.6 }}>
                Sistem agent seperti <strong>ATLAS AI OS</strong> bekerja secara otonom di latar belakang (background worker) 24/7 untuk
                menjalankan <em>tool execution</em> (Chromium search, file I/O, database). Login web OAuth konsumen (seperti login ChatGPT
                Plus atau Claude Pro di browser) hanya berlaku untuk sesi tab browser manual dan tidak menyediakan izin API untuk agen
                otonom.
              </Typography>
              <Typography variant="caption" sx={{ color: '#201515', display: 'block', fontWeight: 600, mt: 0.75 }}>
                💡 <strong>Solusi Terbaik:</strong> Cukup gunakan satu <strong>OpenRouter API Key</strong>, Anda langsung bisa menggunakan
                <strong> Claude 3.7 Sonnet</strong>, <strong>ChatGPT / GPT-4o</strong>, <strong>Google Gemini 2.0 Flash</strong>, dan
                <strong> DeepSeek V3</strong> secara bergantian tanpa perlu mendaftar satu per satu!
              </Typography>
            </Box>

            {keyMessage && (
              <Alert severity={keyMessage.type} sx={{ mb: 2.5, borderRadius: '10px' }}>
                {keyMessage.text}
              </Alert>
            )}

            <Box component="form" onSubmit={saveModelProvider} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.2fr 1fr' }, gap: 2 }}>
                {/* Provider Selector */}
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 0.5, display: 'block' }}>
                    Model Provider
                  </Typography>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    value={selectedProvider}
                    onChange={e => handleProviderChange(e.target.value)}
                    disabled={savingKey}
                  >
                    {SUPPORTED_PROVIDERS.map(p => (
                      <MenuItem key={p.id} value={p.id} sx={{ fontSize: '0.82rem' }}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>

                {/* Model Identifier */}
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 0.5, display: 'block' }}>
                    Model Identifier (Nama Model)
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={modelName}
                    onChange={e => setModelName(e.target.value)}
                    placeholder="e.g. anthropic/claude-3.7-sonnet"
                    disabled={savingKey}
                  />
                </Box>
              </Box>

              {/* Quick Model Chips */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.7rem' }}>
                  Model Populer:
                </Typography>
                {activeProviderMeta.popularModels.map(m => (
                  <Chip
                    key={m}
                    label={m}
                    size="small"
                    clickable
                    onClick={() => setModelName(m)}
                    sx={{
                      fontSize: '0.68rem',
                      fontFamily: 'monospace',
                      bgcolor: modelName === m ? '#fff3eb' : '#f5efe6',
                      color: modelName === m ? '#c2410c' : '#666155',
                      border: modelName === m ? '1px solid rgba(255, 79, 0, 0.4)' : '1px solid rgba(32, 21, 21, 0.08)'
                    }}
                  />
                ))}
              </Box>

              {/* API Key Input */}
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', mb: 0.5, display: 'block' }}>
                  API Key Kredensial
                </Typography>
                <TextField
                  fullWidth
                  size="small"
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={
                    selectedProvider === 'ollama'
                      ? 'Tidak diperlukan untuk Ollama lokal'
                      : settings?.modelKeyFingerprint
                        ? `•••••••••••• (${settings.modelKeyFingerprint})`
                        : activeProviderMeta.placeholder
                  }
                  disabled={savingKey || selectedProvider === 'ollama'}
                />
                <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.7rem', mt: 0.5, display: 'block' }}>
                  Kunci disimpan terenkripsi menggunakan AES-256 dan tidak pernah dibocorkan ke client.
                </Typography>
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
                {settings?.modelConfigured ? (
                  <Button
                    variant="outlined"
                    color="error"
                    disabled={savingKey}
                    onClick={() => void clearModelProviderKey()}
                    startIcon={<CiTrash size={18} />}
                    sx={{ borderRadius: '10px' }}
                  >
                    Hapus Kunci
                  </Button>
                ) : (
                  <Box />
                )}

                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  disabled={savingKey || (selectedProvider !== 'ollama' && !apiKey.trim() && !settings?.modelConfigured)}
                  startIcon={<CiFloppyDisk size={18} />}
                  sx={{ px: 3, borderRadius: '10px' }}
                >
                  {savingKey ? 'Menyimpan…' : 'Simpan Kredensial Provider'}
                </Button>
              </Box>
            </Box>
          </Card>

          {/* SECTION 3: OPERATIONAL GUARDRAILS */}
          {settings && (
            <Card
              sx={{
                p: 3.5,
                bgcolor: '#ffffff',
                borderRadius: '18px',
                border: '1px solid rgba(32, 21, 21, 0.08)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
                <Box
                  sx={{
                    width: 38,
                    height: 38,
                    borderRadius: '10px',
                    bgcolor: '#f5efe6',
                    border: '1px solid rgba(32, 21, 21, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <CiLock size={22} color="#201515" />
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#201515' }}>
                    Engine Operational Guardrails
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#666155' }}>
                    Batas keamanan biaya token harian, konkurensi agent, dan proteksi mutasi eksternal
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2 }}>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>
                    GLOBAL DAILY BUDGET
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>
                    ${settings.globalDailyBudgetUsd.toFixed(2)}
                  </Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>
                    MAX CONCURRENT RUNS
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>
                    {settings.maxConcurrentAgentRuns}
                  </Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>
                    MAX DELEGATION DEPTH
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>
                    {settings.maxDelegationDepth}
                  </Typography>
                </Box>
                <Box sx={{ p: 2, borderRadius: '12px', bgcolor: '#fbf8f2', border: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600 }}>
                    EXTERNAL WRITES
                  </Typography>
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
