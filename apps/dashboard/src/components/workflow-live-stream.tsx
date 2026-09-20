'use client';

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';
import {
  CiChat1,
  CiRedo,
  CiSettings,
  CiUser,
  CiMicrochip,
  CiPlay1,
  CiCircleCheck,
  CiCircleAlert,
  CiBoxes,
  CiSearch,
  CiViewList
} from 'react-icons/ci';
import { atlasFetch } from '../lib/atlas-api';
import { subscribeToAtlasEvents } from '../lib/event-stream';
import { FormattedMessage } from './formatted-message';

export interface WorkflowMessage {
  id: string;
  taskId: string | null;
  runId: string | null;
  senderType: string;
  senderId: string;
  recipientId?: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface WorkflowToolCall {
  id: string;
  taskId: string;
  runId: string;
  agentId: string;
  toolName: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  status: string;
  createdAt: string;
}

export interface WorkflowTimelineItem {
  id: string;
  kind: 'dialogue' | 'tool';
  sender: string;
  recipient?: string | null;
  stage?: string;
  title: string;
  body: string;
  timestamp: string;
  taskId: string | null;
  toolDetails?: {
    toolName: string;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    status: string;
  };
}

export const AGENT_THEMES: Record<string, { name: string; role: string; color: string; bg: string; border: string; iconLabel: string }> = {
  chief: { name: 'Chief', role: 'System Orchestrator', color: '#c2410c', bg: '#fff7ed', border: 'rgba(255, 79, 0, 0.22)', iconLabel: '👑' },
  ned: { name: 'Ned', role: 'Research Specialist', color: '#2563eb', bg: '#eff6ff', border: 'rgba(37, 99, 235, 0.22)', iconLabel: '🔍' },
  luna: {
    name: 'Luna',
    role: 'Data & Market Analyst',
    color: '#0891b2',
    bg: '#ecfeff',
    border: 'rgba(8, 145, 178, 0.22)',
    iconLabel: '📊'
  },
  layla: {
    name: 'Layla',
    role: 'Lead Scoring Specialist',
    color: '#16a34a',
    bg: '#f0fdf4',
    border: 'rgba(22, 163, 74, 0.22)',
    iconLabel: '🎯'
  },
  hermes: {
    name: 'Hermes',
    role: 'Content Specialist',
    color: '#7c3aed',
    bg: '#f5f3ff',
    border: 'rgba(124, 58, 237, 0.22)',
    iconLabel: '✍️'
  },
  argus: { name: 'Argus', role: 'QA & Risk Gate', color: '#d97706', bg: '#fffbeb', border: 'rgba(217, 119, 6, 0.22)', iconLabel: '🛡️' },
  user: {
    name: 'Owner',
    role: 'Operator & Task Creator',
    color: '#201515',
    bg: '#f5efe6',
    border: 'rgba(32, 21, 21, 0.14)',
    iconLabel: '👤'
  },
  'api-owner': {
    name: 'Owner',
    role: 'API Command Client',
    color: '#201515',
    bg: '#f5efe6',
    border: 'rgba(32, 21, 21, 0.14)',
    iconLabel: '👤'
  }
};

interface WorkflowLiveStreamProps {
  selectedTaskId?: string | null;
  activeTaskTitle?: string;
  isTaskRunning?: boolean;
  onSelectTask?: (taskId: string) => void;
  availableTasks?: Array<{ id: string; title: string; status: string }>;
}

export function WorkflowLiveStream({
  selectedTaskId,
  activeTaskTitle,
  isTaskRunning,
  onSelectTask,
  availableTasks = []
}: WorkflowLiveStreamProps) {
  const [messages, setMessages] = useState<WorkflowMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<WorkflowToolCall[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'dialogue' | 'tools'>('all');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

  const loadWorkflowData = async () => {
    if (!selectedTaskId) {
      setMessages([]);
      setToolCalls([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const [msgRes, toolRes] = await Promise.all([
        atlasFetch<{ data: WorkflowMessage[] }>(`/messages?taskId=${encodeURIComponent(selectedTaskId)}&limit=100`),
        atlasFetch<{ data: WorkflowToolCall[] }>(`/tool-calls?taskId=${encodeURIComponent(selectedTaskId)}&limit=100`)
      ]);
      setMessages(msgRes.data || []);
      setToolCalls(toolRes.data || []);
    } catch (error) {
      // An empty catch here made a failed fetch indistinguishable from a task with no activity: the
      // operator was told there was nothing to see when the control plane was actually unreachable.
      setMessages([]);
      setToolCalls([]);
      setLoadError(error instanceof Error ? error.message : 'Failed to load workflow activity.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkflowData();
  }, [selectedTaskId]);

  // Real-time EventSource listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stream = new EventSource('/api/atlas/events/stream');
    const unsubscribe = subscribeToAtlasEvents(stream, () => {
      void loadWorkflowData();
    });

    return () => {
      unsubscribe();
      stream.close();
    };
  }, [selectedTaskId]);

  // Build Unified Chronological Feed
  const feedItems: WorkflowTimelineItem[] = useMemo(() => {
    const dialogueItems: WorkflowTimelineItem[] = messages.map(m => {
      const stage = (m.metadata?.stage as string) || undefined;
      return {
        id: `msg-${m.id}`,
        kind: 'dialogue',
        sender: m.senderId,
        recipient: m.recipientId || (m.metadata?.targetAgent as string) || null,
        stage,
        title: `${m.senderId.toUpperCase()}${m.recipientId ? ` ➔ ${m.recipientId.toUpperCase()}` : ''}`,
        body: m.content,
        timestamp: m.createdAt,
        taskId: m.taskId
      };
    });

    const toolItems: WorkflowTimelineItem[] = toolCalls.map(t => ({
      id: `tool-${t.id}`,
      kind: 'tool',
      sender: t.agentId,
      stage: 'tool_execution',
      title: `${t.agentId.toUpperCase()} executed tool "${t.toolName}"`,
      body: t.error ? `Error: ${t.error}` : `Status: ${t.status.toUpperCase()}`,
      timestamp: t.createdAt,
      taskId: t.taskId,
      toolDetails: {
        toolName: t.toolName,
        input: t.input,
        output: t.output,
        status: t.status
      }
    }));

    const combined = [...dialogueItems, ...toolItems];
    combined.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return combined;
  }, [messages, toolCalls]);

  const filteredFeed = useMemo(() => {
    if (filter === 'dialogue') return feedItems.filter(item => item.kind === 'dialogue');
    if (filter === 'tools') return feedItems.filter(item => item.kind === 'tool');
    return feedItems;
  }, [feedItems, filter]);

  const toggleToolExpand = (id: string) => {
    setExpandedTools(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <Card
      sx={{
        p: 3,
        bgcolor: '#ffffff',
        borderRadius: '18px',
        border: '1px solid rgba(32, 21, 21, 0.08)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2.5
      }}
    >
      {/* Header Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
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
            <CiChat1 size={22} color="#c2410c" />
          </Box>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#201515' }}>
                Live Autonomous Workflow & Inter-Agent Deliberation
              </Typography>
              {isTaskRunning && (
                <Chip
                  label="LIVE EXECUTION"
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    fontSize: '0.66rem',
                    bgcolor: '#ffedd5',
                    color: '#c2410c',
                    border: '1px solid rgba(255, 79, 0, 0.3)',
                    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 1 },
                      '50%': { opacity: 0.6 }
                    }
                  }}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: '#666155', display: 'block' }}>
              Transparansi penuh dialog, instruksi tugas, eksekusi tool, dan inspeksi risiko secara real-time.
            </Typography>
          </Box>
        </Box>

        {/* Action Controls & Filters */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          {/* Filter Pills */}
          <Stack direction="row" spacing={0.75} sx={{ bgcolor: '#f5efe6', p: 0.5, borderRadius: '10px' }}>
            <Chip
              label="All Activity"
              size="small"
              clickable
              onClick={() => setFilter('all')}
              sx={{
                fontWeight: 600,
                fontSize: '0.72rem',
                bgcolor: filter === 'all' ? '#201515' : 'transparent',
                color: filter === 'all' ? '#ffffff' : '#666155'
              }}
            />
            <Chip
              label="Agent Dialogue"
              size="small"
              clickable
              onClick={() => setFilter('dialogue')}
              sx={{
                fontWeight: 600,
                fontSize: '0.72rem',
                bgcolor: filter === 'dialogue' ? '#201515' : 'transparent',
                color: filter === 'dialogue' ? '#ffffff' : '#666155'
              }}
            />
            <Chip
              label="Tool Calls"
              size="small"
              clickable
              onClick={() => setFilter('tools')}
              sx={{
                fontWeight: 600,
                fontSize: '0.72rem',
                bgcolor: filter === 'tools' ? '#201515' : 'transparent',
                color: filter === 'tools' ? '#ffffff' : '#666155'
              }}
            />
          </Stack>

          <IconButton
            size="small"
            onClick={() => void loadWorkflowData()}
            sx={{
              p: 1,
              borderRadius: '10px',
              border: '1px solid rgba(32, 21, 21, 0.1)',
              bgcolor: '#ffffff',
              '&:hover': { bgcolor: '#f5efe6' }
            }}
            aria-label="Refresh live feed"
          >
            <CiRedo size={16} />
          </IconButton>
        </Box>
      </Box>

      {/* Task Selector Bar if multiple available */}
      {availableTasks.length > 0 && onSelectTask && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflowX: 'auto', pb: 0.5 }}>
          <Typography variant="caption" sx={{ color: '#8c827a', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Workflows:
          </Typography>
          {availableTasks.slice(0, 6).map(t => {
            const isSelected = t.id === selectedTaskId;
            return (
              <Chip
                key={t.id}
                label={`${t.id.slice(0, 6)} · ${t.title.slice(0, 24)}...`}
                size="small"
                clickable
                onClick={() => onSelectTask(t.id)}
                sx={{
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  fontWeight: isSelected ? 700 : 500,
                  bgcolor: isSelected ? '#201515' : '#f5efe6',
                  color: isSelected ? '#ffffff' : '#666155',
                  border: isSelected ? '1px solid #201515' : '1px solid rgba(32, 21, 21, 0.08)'
                }}
              />
            );
          })}
        </Box>
      )}

      {/* Active Task Goal Callout */}
      {activeTaskTitle && (
        <Box
          sx={{
            p: 1.75,
            borderRadius: '12px',
            bgcolor: '#faf6f0',
            border: '1px solid rgba(32, 21, 21, 0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5
          }}
        >
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: isTaskRunning ? '#c2410c' : '#16a34a',
              flexShrink: 0
            }}
          />
          <Typography variant="caption" sx={{ color: '#201515', fontWeight: 700 }}>
            Task Objective:
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', flex: 1, wordBreak: 'break-word' }}>
            {activeTaskTitle}
          </Typography>
        </Box>
      )}

      {/* Live Stream Stream Body */}
      <Box
        sx={{
          maxHeight: 460,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          pr: 1,
          '&::-webkit-scrollbar': { width: 6 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(32, 21, 21, 0.12)', borderRadius: 3 }
        }}
      >
        {loading && filteredFeed.length === 0 ? (
          <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={24} color="primary" />
            <Typography variant="caption" sx={{ color: '#8c827a' }}>
              Memuat aliran percakapan workflow...
            </Typography>
          </Box>
        ) : loadError ? (
          <Box
            sx={{
              p: 6,
              textAlign: 'center',
              bgcolor: '#fdf3f0',
              borderRadius: '14px',
              border: '1px solid rgba(214, 69, 41, 0.28)'
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#a33218', mb: 0.5 }}>
              Aktivitas Workflow Tidak Dapat Dimuat
            </Typography>
            <Typography variant="caption" sx={{ color: '#8c827a', maxWidth: 420, display: 'block', mx: 'auto', mb: 1.5 }}>
              {loadError}
            </Typography>
            <Button size="small" variant="outlined" onClick={() => void loadWorkflowData()} sx={{ textTransform: 'none' }}>
              Coba lagi
            </Button>
          </Box>
        ) : filteredFeed.length === 0 ? (
          <Box
            sx={{
              p: 6,
              textAlign: 'center',
              bgcolor: '#fbf8f2',
              borderRadius: '14px',
              border: '1px dashed rgba(32, 21, 21, 0.12)'
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mb: 0.5 }}>
              Belum Ada Aktivitas Workflow Terpilih
            </Typography>
            <Typography variant="caption" sx={{ color: '#8c827a', maxWidth: 400, display: 'block', mx: 'auto' }}>
              Picu tugas baru dari dashboard atau pilih workflow dari daftar untuk melihat percakapan langsung antar-agen.
            </Typography>
          </Box>
        ) : (
          filteredFeed.map((item, idx) => {
            const isTool = item.kind === 'tool';
            const senderKey = item.sender.toLowerCase();
            const senderTheme = AGENT_THEMES[senderKey] || {
              name: item.sender,
              role: 'Specialist Agent',
              color: '#666155',
              bg: '#fbf8f2',
              border: 'rgba(32, 21, 21, 0.1)',
              iconLabel: '🤖'
            };

            const recipientTheme = item.recipient ? AGENT_THEMES[item.recipient.toLowerCase()] : null;

            return (
              <Box
                key={item.id}
                sx={{
                  display: 'flex',
                  gap: 1.75,
                  alignItems: 'flex-start'
                }}
              >
                {/* Agent Avatar Badge */}
                <Tooltip title={`${senderTheme.name} (${senderTheme.role})`} placement="top">
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: '10px',
                      bgcolor: isTool ? '#fff3eb' : senderTheme.bg,
                      color: isTool ? '#c2410c' : senderTheme.color,
                      border: `1px solid ${isTool ? 'rgba(255, 79, 0, 0.25)' : senderTheme.border}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      fontSize: '1rem',
                      fontWeight: 700,
                      boxShadow: '0 2px 5px rgba(0,0,0,0.03)'
                    }}
                  >
                    {senderTheme.iconLabel}
                  </Box>
                </Tooltip>

                {/* Message Bubble Card */}
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    p: 2,
                    borderRadius: '14px',
                    bgcolor: isTool ? '#fbf8f2' : senderKey === 'user' || senderKey === 'api-owner' ? '#faf6f0' : '#ffffff',
                    border: `1px solid ${isTool ? 'rgba(255, 79, 0, 0.15)' : senderTheme.border}`,
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)'
                  }}
                >
                  {/* Bubble Header */}
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: senderTheme.color, fontSize: '0.78rem' }}>
                        {senderTheme.name}
                      </Typography>

                      {recipientTheme && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.72rem' }}>
                            ➔
                          </Typography>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: recipientTheme.color, fontSize: '0.78rem' }}>
                            {recipientTheme.name}
                          </Typography>
                        </Box>
                      )}

                      {item.stage && (
                        <Chip
                          label={item.stage.toUpperCase().replace('_', ' ')}
                          size="small"
                          sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            height: 18,
                            bgcolor: '#f5efe6',
                            color: '#666155'
                          }}
                        />
                      )}
                    </Box>

                    <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.68rem', fontFamily: 'monospace' }}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Typography>
                  </Box>

                  {/* Body Content */}
                  {isTool ? (
                    <Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515', fontFamily: 'monospace' }}>
                          🛠️ {item.toolDetails?.toolName}
                        </Typography>
                        <Chip
                          label={item.toolDetails?.status.toUpperCase()}
                          size="small"
                          sx={{
                            fontSize: '0.62rem',
                            fontWeight: 700,
                            height: 18,
                            bgcolor: item.toolDetails?.status === 'success' ? '#dcfce7' : '#fee2e2',
                            color: item.toolDetails?.status === 'success' ? '#16a34a' : '#dc2626'
                          }}
                        />
                      </Box>

                      {/* Tool Expansion Toggle */}
                      <Box sx={{ mt: 1 }}>
                        <Typography
                          variant="caption"
                          onClick={() => toggleToolExpand(item.id)}
                          sx={{
                            color: '#c2410c',
                            cursor: 'pointer',
                            fontWeight: 600,
                            textDecoration: 'underline',
                            fontSize: '0.7rem'
                          }}
                        >
                          {expandedTools[item.id] ? 'Sembunyikan parameter & output ▲' : 'Lihat parameter & output ▼'}
                        </Typography>

                        <Collapse in={Boolean(expandedTools[item.id])}>
                          <Box
                            sx={{
                              mt: 1,
                              p: 1.5,
                              borderRadius: '8px',
                              bgcolor: '#191817',
                              color: '#e6e1da',
                              fontFamily: 'monospace',
                              fontSize: '0.7rem',
                              overflowX: 'auto'
                            }}
                          >
                            <Typography variant="caption" sx={{ color: '#a8a29e', display: 'block', mb: 0.5 }}>
                              Input Parameters:
                            </Typography>
                            <pre style={{ margin: 0 }}>{JSON.stringify(item.toolDetails?.input, null, 2)}</pre>
                            {item.toolDetails?.output && (
                              <>
                                <Typography variant="caption" sx={{ color: '#a8a29e', display: 'block', mt: 1, mb: 0.5 }}>
                                  Output Payload:
                                </Typography>
                                <pre style={{ margin: 0 }}>{JSON.stringify(item.toolDetails?.output, null, 2)}</pre>
                              </>
                            )}
                          </Box>
                        </Collapse>
                      </Box>
                    </Box>
                  ) : (
                    <Box sx={{ fontSize: '0.82rem', color: '#201515', lineHeight: 1.6 }}>
                      <FormattedMessage content={item.body} />
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })
        )}
        <div ref={feedEndRef} />
      </Box>
    </Card>
  );
}
