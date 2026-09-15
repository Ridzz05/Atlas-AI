'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Alert from '@mui/material/Alert';
import {
  CiMicrophoneOn,
  CiVolumeHigh,
  CiVolumeMute,
  CiPlay1,
  CiRedo,
  CiCircleCheck,
  CiCircleAlert
} from 'react-icons/ci';
import { atlasFetch } from '../lib/atlas-api';

interface ChiefVoiceAssistantProps {
  onTaskCreated?: (task: { id: string; title: string; status: string }) => void;
}

type AssistantState = 'idle' | 'standby' | 'listening_command' | 'speaking' | 'processing';

const WAKE_WORDS = ['hei chief', 'hey chief', 'halo chief', 'hi chief', 'hai chief', 'chief'];

const CHIEF_GREETINGS = [
  'Hai Tuan, apa yang bisa saya bantu hari ini?',
  'Chief siap menerima instruksi, silakan sampaikan misi Anda.',
  'Sistem ATLAS aktif, siap mengeksekusi arahan Anda, Tuan.'
];

export function ChiefVoiceAssistant({ onTaskCreated }: ChiefVoiceAssistantProps) {
  const [supported, setSupported] = useState(true);
  const [state, setState] = useState<AssistantState>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [lastSpeech, setLastSpeech] = useState<string | null>(null);
  const [audioMuted, setAudioMuted] = useState(false);
  const [lang, setLang] = useState<'id-ID' | 'en-US'>('id-ID');
  const [statusMessage, setStatusMessage] = useState('Klik ikon mikrofon atau katakan "Hei Chief" untuk berinteraksi');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef<boolean>(false);
  const stateRef = useRef<AssistantState>('idle');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep stateRef in sync for event callbacks
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Audio Chime using Web Audio API
  const playChime = useCallback((type: 'wake' | 'success') => {
    if (typeof window === 'undefined' || audioMuted) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'wake') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.18); // A5
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.12); // E5
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.26);
      }
    } catch {
      // Audio context blocked or not supported
    }
  }, [audioMuted]);

  // Chief Speech Synthesis (TTS)
  const speak = useCallback((text: string, onDone?: () => void) => {
    setLastSpeech(text);
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || audioMuted) {
      if (onDone) setTimeout(onDone, 600);
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1.04;
      utterance.pitch = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const targetVoice = voices.find(v => v.lang.toLowerCase().includes(lang.toLowerCase().slice(0, 2)));
      if (targetVoice) {
        utterance.voice = targetVoice;
      }

      utterance.onend = () => {
        if (onDone) onDone();
      };
      utterance.onerror = () => {
        if (onDone) onDone();
      };

      setState('speaking');
      window.speechSynthesis.speak(utterance);
    } catch {
      if (onDone) onDone();
    }
  }, [audioMuted, lang]);

  // Task Dispatch Function
  const dispatchVoiceTask = useCallback(async (commandText: string) => {
    const cleanGoal = commandText.trim();
    if (!cleanGoal) {
      setState('standby');
      setStatusMessage('Instruksi kosong. Katakan "Hei Chief" untuk mencoba lagi');
      return;
    }

    setState('processing');
    setStatusMessage('Chief sedang menyusun rencana multi-agen...');
    setErrorMessage(null);

    try {
      const title = cleanGoal.length > 50 ? `${cleanGoal.slice(0, 48)}...` : cleanGoal;
      const res = await atlasFetch<{ data: { id: string; title: string; status: string } }>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          goal: cleanGoal,
          assignedAgent: 'chief'
        })
      });

      playChime('success');
      const confirmation = 'Misi diterima, Tuan. Saya dan armada spesialis segera melaksanakannya.';
      speak(confirmation, () => {
        setState('standby');
        setStatusMessage('Tugas berhasil dibuat. Katakan "Hei Chief" untuk instruksi berikutnya');
        setTranscript('');
        setInterimText('');
      });

      if (onTaskCreated && res.data) {
        onTaskCreated(res.data);
      }
    } catch (err: any) {
      const errStr = err?.message || 'Gagal membuat tugas';
      setErrorMessage(errStr);
      speak('Maaf Tuan, terjadi kendala saat membuat tugas.', () => {
        setState('standby');
        setStatusMessage('Terjadi kesalahan. Katakan "Hei Chief" untuk mencoba lagi');
      });
    }
  }, [playChime, speak, onTaskCreated]);

  // Initialize Speech Recognition
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
      setSupported(false);
      return;
    }

    const recognition = new SpeechRecognitionClass();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      isListeningRef.current = true;
      setErrorMessage(null);
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalChunk += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      setInterimText(interim);
      const combinedText = (transcript + ' ' + finalChunk + ' ' + interim).toLowerCase().trim();

      // State: STANDBY - Looking for Wake Word
      if (stateRef.current === 'standby') {
        const detectedWakeWord = WAKE_WORDS.some(w => combinedText.includes(w));
        if (detectedWakeWord) {
          playChime('wake');
          const greeting = CHIEF_GREETINGS[Math.floor(Math.random() * CHIEF_GREETINGS.length)]!;
          setTranscript('');
          setInterimText('');
          setStatusMessage('Chief mendengarkan instruksi Anda...');

          speak(greeting, () => {
            setState('listening_command');
            setStatusMessage('Silakan sebutkan tugas atau misi yang ingin dikerjakan...');
          });
          return;
        }
      }

      // State: LISTENING_COMMAND - Recording user's actual instruction
      if (stateRef.current === 'listening_command') {
        if (finalChunk) {
          // Remove any accidental wake words from the beginning of prompt
          let cleaned = (transcript + ' ' + finalChunk).trim();
          for (const w of WAKE_WORDS) {
            if (cleaned.toLowerCase().startsWith(w)) {
              cleaned = cleaned.slice(w.length).trim();
            }
          }
          setTranscript(cleaned);

          // Reset silence timer: auto-dispatch after 3 seconds of silence
          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = setTimeout(() => {
            if (stateRef.current === 'listening_command' && cleaned.length > 3) {
              void dispatchVoiceTask(cleaned);
            }
          }, 3200);
        }
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech') {
        // Normal silence timeout, continue listening
        return;
      }
      if (event.error === 'not-allowed') {
        setErrorMessage('Akses mikrofon ditolak oleh browser. Harap izinkan mikrofon di address bar.');
        setState('idle');
      }
    };

    recognition.onend = () => {
      // Auto-restart if we should still be listening
      if (isListeningRef.current && stateRef.current !== 'idle') {
        try {
          recognition.start();
        } catch {
          // Already active
        }
      }
    };

    recognitionRef.current = recognition;

    return () => {
      isListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try {
        recognition.stop();
      } catch {}
    };
  }, [lang, playChime, speak, transcript, dispatchVoiceTask]);

  const toggleListening = () => {
    if (!supported) return;
    if (state === 'idle') {
      try {
        isListeningRef.current = true;
        recognitionRef.current?.start();
        setState('standby');
        setStatusMessage('Mikrofon aktif. Katakan "Hei Chief" atau langsung mulai bicara');
      } catch {
        // Fallback
        setState('standby');
      }
    } else {
      isListeningRef.current = false;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try {
        recognitionRef.current?.stop();
        window.speechSynthesis?.cancel();
      } catch {}
      setState('idle');
      setStatusMessage('Mikrofon nonaktif. Klik untuk mulai');
      setTranscript('');
      setInterimText('');
    }
  };

  const handleManualSend = () => {
    const fullText = (transcript + ' ' + interimText).trim();
    if (fullText) {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      void dispatchVoiceTask(fullText);
    }
  };

  const handleManualWake = () => {
    if (state === 'idle') {
      toggleListening();
    }
    playChime('wake');
    const greeting = CHIEF_GREETINGS[Math.floor(Math.random() * CHIEF_GREETINGS.length)]!;
    setTranscript('');
    setInterimText('');
    speak(greeting, () => {
      setState('listening_command');
      setStatusMessage('Silakan sebutkan tugas atau misi Anda...');
    });
  };

  const isLive = state !== 'idle';
  const isChiefActive = state === 'listening_command' || state === 'speaking' || state === 'processing';

  return (
    <Card
      sx={{
        p: 2.5,
        bgcolor: isChiefActive ? '#fffbf7' : '#ffffff',
        borderRadius: '18px',
        border: `1px solid ${isChiefActive ? 'rgba(194, 65, 12, 0.35)' : 'rgba(32, 21, 21, 0.08)'}`,
        boxShadow: isChiefActive ? '0 8px 30px rgba(194, 65, 12, 0.08)' : '0 4px 18px rgba(0, 0, 0, 0.02)',
        transition: 'all 0.3s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: 2
      }}
    >
      {/* Top Header Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
        {/* Left: Avatar & Title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
          {/* Animated Glowing Voice Orb */}
          <Box
            onClick={toggleListening}
            sx={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              bgcolor: isChiefActive ? '#c2410c' : isLive ? '#ffedd5' : '#f5efe6',
              color: isChiefActive ? '#ffffff' : '#c2410c',
              border: `2px solid ${isChiefActive ? '#ea580c' : 'rgba(194, 65, 12, 0.25)'}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
              boxShadow: isChiefActive
                ? '0 0 16px rgba(194, 65, 12, 0.45)'
                : isLive
                  ? '0 0 8px rgba(194, 65, 12, 0.2)'
                  : 'none',
              animation: isChiefActive ? 'orbPulse 1.8s infinite' : 'none',
              '@keyframes orbPulse': {
                '0%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(194, 65, 12, 0.5)' },
                '70%': { transform: 'scale(1.06)', boxShadow: '0 0 0 12px rgba(194, 65, 12, 0)' },
                '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 rgba(194, 65, 12, 0)' }
              }
            }}
          >
            <CiMicrophoneOn size={24} />
          </Box>

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#201515', fontSize: '0.95rem' }}>
                Chief Live Voice Communicator
              </Typography>

              {/* Status Badge */}
              <Chip
                label={
                  state === 'idle'
                    ? 'MIC OFF'
                    : state === 'standby'
                      ? 'STANDBY: KATAKAN "HEI CHIEF"'
                      : state === 'listening_command'
                        ? 'MENDENGARKAN MISI'
                        : state === 'speaking'
                          ? 'CHIEF MERESPONS'
                          : 'MEMPROSES'
                }
                size="small"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  bgcolor:
                    state === 'idle'
                      ? '#f5efe6'
                      : state === 'standby'
                        ? '#ffedd5'
                        : state === 'listening_command'
                          ? '#dcfce7'
                          : state === 'speaking'
                            ? '#f3e8ff'
                            : '#dbeafe',
                  color:
                    state === 'idle'
                      ? '#666155'
                      : state === 'standby'
                        ? '#c2410c'
                        : state === 'listening_command'
                          ? '#16a34a'
                          : state === 'speaking'
                            ? '#7c3aed'
                            : '#2563eb',
                  border: '1px solid rgba(0,0,0,0.06)'
                }}
              />
            </Box>
            <Typography variant="caption" sx={{ color: '#666155', display: 'block' }}>
              {statusMessage}
            </Typography>
          </Box>
        </Box>

        {/* Right Controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {/* Quick Wake Button */}
          <Button
            size="small"
            variant={isChiefActive ? 'contained' : 'outlined'}
            color="primary"
            onClick={handleManualWake}
            startIcon={<CiPlay1 size={14} />}
            sx={{
              fontWeight: 700,
              fontSize: '0.72rem',
              bgcolor: isChiefActive ? '#c2410c' : 'transparent',
              borderColor: 'rgba(194, 65, 12, 0.4)',
              color: isChiefActive ? '#ffffff' : '#c2410c',
              '&:hover': { bgcolor: isChiefActive ? '#9a3412' : '#fff3eb' }
            }}
          >
            Panggil "Hei Chief"
          </Button>

          {/* Audio Output Mute Toggle */}
          <Tooltip title={audioMuted ? 'Suara Balasan Nonaktif (Muted)' : 'Suara Balasan Aktif'}>
            <IconButton
              size="small"
              onClick={() => setAudioMuted(!audioMuted)}
              sx={{
                p: 0.9,
                borderRadius: '10px',
                border: '1px solid rgba(32, 21, 21, 0.1)',
                bgcolor: '#ffffff',
                color: audioMuted ? '#dc2626' : '#201515'
              }}
            >
              {audioMuted ? <CiVolumeMute size={18} /> : <CiVolumeHigh size={18} />}
            </IconButton>
          </Tooltip>

          {/* Language Switcher */}
          <Chip
            label={lang === 'id-ID' ? '🇮🇩 ID' : '🇺🇸 EN'}
            size="small"
            clickable
            onClick={() => setLang(lang === 'id-ID' ? 'en-US' : 'id-ID')}
            sx={{
              fontWeight: 700,
              fontSize: '0.68rem',
              bgcolor: '#f5efe6',
              color: '#201515',
              border: '1px solid rgba(32, 21, 21, 0.08)'
            }}
          />
        </Box>
      </Box>

      {/* Error Banner */}
      {errorMessage && (
        <Alert severity="warning" sx={{ py: 0.5, fontSize: '0.78rem' }} onClose={() => setErrorMessage(null)}>
          {errorMessage}
        </Alert>
      )}

      {!supported && (
        <Alert severity="info" sx={{ py: 0.5, fontSize: '0.78rem' }}>
          Browser Anda belum mendukung Web Speech API secara native. Gunakan Google Chrome atau Microsoft Edge untuk pengalaman suara live optimal.
        </Alert>
      )}

      {/* Live Transcript & Interaction Box */}
      {(isLive || transcript) && (
        <Box
          sx={{
            p: 2,
            borderRadius: '14px',
            bgcolor: isChiefActive ? '#ffffff' : '#faf6f0',
            border: `1px solid ${isChiefActive ? 'rgba(194, 65, 12, 0.25)' : 'rgba(32, 21, 21, 0.08)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25
          }}
        >
          {/* Audio Waveform Visualization Simulation */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, height: 16 }}>
            {[14, 22, 10, 26, 18, 24, 12, 20, 16, 28, 14, 20].map((h, i) => (
              <Box
                key={i}
                sx={{
                  width: 3,
                  height: state === 'listening_command' || state === 'speaking' ? `${h}px` : '4px',
                  borderRadius: 1.5,
                  bgcolor: state === 'speaking' ? '#7c3aed' : state === 'listening_command' ? '#16a34a' : '#c2410c',
                  transition: 'height 0.15s ease',
                  animation:
                    state === 'listening_command' || state === 'speaking'
                      ? `wave 0.8s ease-in-out infinite alternate ${i * 0.07}s`
                      : 'none',
                  '@keyframes wave': {
                    '0%': { height: '4px' },
                    '100%': { height: `${h}px` }
                  }
                }}
              />
            ))}
            <Typography variant="caption" sx={{ color: '#8c827a', ml: 1, fontSize: '0.72rem', fontWeight: 600 }}>
              {state === 'listening_command' ? 'Merekam ucapan...' : state === 'speaking' ? 'Chief berbicara...' : 'Standby'}
            </Typography>
          </Box>

          {/* Transcript View */}
          <Box sx={{ minHeight: 32 }}>
            <Typography variant="body2" sx={{ color: '#201515', fontWeight: 600, lineHeight: 1.5 }}>
              {transcript || interimText ? (
                <>
                  <span>{transcript}</span>
                  <span style={{ color: '#8c827a', fontStyle: 'italic' }}> {interimText}</span>
                </>
              ) : (
                <span style={{ color: '#a8a29e' }}>
                  {state === 'standby'
                    ? 'Katakan "Hei Chief" untuk mulai berbicara...'
                    : 'Silakan sampaikan instruksi Anda...'}
                </span>
              )}
            </Typography>
          </Box>

          {/* Bottom Action Row */}
          {(transcript || interimText) && state === 'listening_command' && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1, pt: 0.5 }}>
              <Button
                size="small"
                onClick={() => {
                  setTranscript('');
                  setInterimText('');
                }}
                sx={{ fontSize: '0.72rem', color: '#8c827a' }}
              >
                Hapus
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                onClick={handleManualSend}
                startIcon={<CiCircleCheck size={16} />}
                sx={{
                  bgcolor: '#c2410c',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  '&:hover': { bgcolor: '#9a3412' }
                }}
              >
                Kirim Misi ke Chief
              </Button>
            </Box>
          )}

          {/* Last Response Banner */}
          {lastSpeech && state === 'speaking' && (
            <Box sx={{ mt: 0.5, p: 1.25, borderRadius: '8px', bgcolor: '#f5f3ff', border: '1px solid rgba(124, 58, 237, 0.15)' }}>
              <Typography variant="caption" sx={{ color: '#7c3aed', fontWeight: 700, display: 'block', mb: 0.25 }}>
                👑 Respons Lisan Chief:
              </Typography>
              <Typography variant="caption" sx={{ color: '#201515', fontWeight: 500 }}>
                "{lastSpeech}"
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Card>
  );
}
