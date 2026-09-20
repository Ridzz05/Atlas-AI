'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { CiChat1, CiRedo, CiPaperplane, CiMicrochip, CiUser, CiPlay1, CiSettings } from 'react-icons/ci';
import { atlasFetch } from '../../lib/atlas-api';
import { subscribeToAtlasEvents } from '../../lib/event-stream';
import {
  buildCommunicationFeed,
  CommunicationFeedItem,
  CommunicationMessageRecord,
  CommunicationToolCallRecord
} from '../../lib/communications';
import { ChiefVoiceAssistant } from '../../components/chief-voice-assistant';

interface RecordListResponse<T> {
  data: T[];
  count: number;
  durable: boolean;
}

import { FormattedMessage } from '../../components/formatted-message';

type FeedFilter = 'all' | 'message' | 'tool';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

const AGENT_CONFIGS: Record<string, { name: string; role: string; color: string; bg: string; border: string }> = {
  chief: { name: 'Chief', role: 'Orchestrator', color: '#c2410c', bg: '#fff7ed', border: '#ffedd5' },
  ned: { name: 'Ned', role: 'Research Specialist', color: '#2563eb', bg: '#eff6ff', border: '#dbeafe' },
  luna: { name: 'Luna', role: 'Data & Market Analyst', color: '#0891b2', bg: '#ecfeff', border: '#cffafe' },
  layla: { name: 'Layla', role: 'Lead Scoring', color: '#16a34a', bg: '#f0fdf4', border: '#dcfce7' },
  hermes: { name: 'Hermes', role: 'Content Specialist', color: '#7c3aed', bg: '#f5f3ff', border: '#ede9fe' },
  argus: { name: 'Argus', role: 'QA & Risk Gate', color: '#d97706', bg: '#fffbeb', border: '#fef3c7' },
  user: { name: 'Operator', role: 'Human Input', color: '#201515', bg: '#f5efe6', border: 'rgba(32, 21, 21, 0.12)' },
  'api-owner': { name: 'Operator', role: 'API Command', color: '#201515', bg: '#f5efe6', border: 'rgba(32, 21, 21, 0.12)' }
};

function FeedCard({ item }: { item: CommunicationFeedItem }) {
  const isTool = item.kind === 'tool';
  const senderKey = item.sender.toLowerCase();
  const agentInfo = AGENT_CONFIGS[senderKey] || {
    name: item.sender,
    role: isTool ? 'Tool Exec' : 'Agent',
    color: '#666155',
    bg: '#fbf8f2',
    border: 'rgba(32, 21, 21, 0.1)'
  };

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
      {/* Sender Avatar */}
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: '12px',
          bgcolor: isTool ? '#fff3eb' : agentInfo.bg,
          color: isTool ? '#c2410c' : agentInfo.color,
          border: `1px solid ${isTool ? 'rgba(194, 65, 12, 0.2)' : agentInfo.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          boxShadow: '0 2px 6px rgba(32, 21, 21, 0.04)'
        }}
      >
        {isTool ? (
          <CiSettings size={20} />
        ) : senderKey === 'user' || senderKey === 'api-owner' ? (
          <CiUser size={20} />
        ) : (
          <CiMicrochip size={20} />
        )}
      </Box>

      {/* Card Content */}
      <Card
        sx={{
          p: 2.75,
          bgcolor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid rgba(32, 21, 21, 0.08)',
          boxShadow: '0 2px 10px rgba(32, 21, 21, 0.03)',
          flex: 1,
          minWidth: 0,
          transition: 'border-color 0.15s ease-in-out',
          '&:hover': {
            borderColor: 'rgba(194, 65, 12, 0.25)'
          }
        }}
      >
        {/* Header with Name, Role Tag, Task ID, and Timestamp */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.75, flexWrap: 'wrap', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#201515', fontSize: '0.92rem' }}>
              {agentInfo.name}
            </Typography>
            <Chip
              label={agentInfo.role}
              size="small"
              sx={{
                fontSize: '0.68rem',
                fontWeight: 700,
                bgcolor: agentInfo.bg,
                color: agentInfo.color,
                border: `1px solid ${agentInfo.border}`,
                height: 22
              }}
            />
            {item.taskId && (
              <Chip
                label={`task:${item.taskId.slice(0, 8)}`}
                size="small"
                sx={{
                  fontSize: '0.68rem',
                  fontFamily: 'monospace',
                  fontWeight: 600,
                  bgcolor: '#fbf8f2',
                  color: '#666155',
                  border: '1px solid rgba(32, 21, 21, 0.08)',
                  height: 22
                }}
              />
            )}
            {item.riskLevel && (
              <Chip
                label={`risk:${item.riskLevel}`}
                size="small"
                sx={{
                  fontSize: '0.68rem',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  bgcolor: '#fff3eb',
                  color: '#c2410c',
                  border: '1px solid rgba(194, 65, 12, 0.2)',
                  height: 22
                }}
              />
            )}
          </Box>
          <Typography variant="caption" sx={{ color: '#71685f', fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 500 }}>
            {formatTimestamp(item.timestamp)}
          </Typography>
        </Box>

        {/* Formatted Content Body */}
        {isTool ? (
          <Box
            sx={{
              p: 1.5,
              bgcolor: '#fbf8f2',
              borderRadius: '8px',
              border: '1px solid rgba(32, 21, 21, 0.06)',
              fontFamily: 'monospace',
              fontSize: '0.82rem',
              color: '#201515'
            }}
          >
            {item.summary}
          </Box>
        ) : (
          <FormattedMessage content={item.summary} />
        )}
      </Card>
    </Box>
  );
}

export default function CommunicationsPage() {
  const [feed, setFeed] = useState<CommunicationFeedItem[]>([]);
  const [taskIdFilter, setTaskIdFilter] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [loading, setLoading] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadFeedRef = useRef<() => Promise<void>>(async () => undefined);

  const loadFeed = useCallback(async () => {
    const trimmedTaskId = taskIdFilter.trim();
    if (trimmedTaskId && !UUID_PATTERN.test(trimmedTaskId)) {
      setError('Task filter must be a valid UUID.');
      setFeed([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const suffix = trimmedTaskId ? `&taskId=${encodeURIComponent(trimmedTaskId)}` : '';
      const [messages, toolCalls] = await Promise.all([
        atlasFetch<RecordListResponse<CommunicationMessageRecord>>(`/messages?limit=100${suffix}`),
        atlasFetch<RecordListResponse<CommunicationToolCallRecord>>(`/tool-calls?limit=100${suffix}`)
      ]);
      setFeed(buildCommunicationFeed(messages.data, toolCalls.data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load communication history.');
    } finally {
      setLoading(false);
    }
  }, [taskIdFilter]);

  useEffect(() => {
    loadFeedRef.current = loadFeed;
  }, [loadFeed]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    const stream = new EventSource('/api/atlas/events/stream');
    const refresh = () => {
      void loadFeedRef.current();
    };
    const unsubscribe = subscribeToAtlasEvents(stream, refresh);
    const handleOpen = () => setRealtime(true);
    const handleError = () => setRealtime(false);
    stream.addEventListener('open', handleOpen);
    stream.addEventListener('error', handleError);

    return () => {
      unsubscribe();
      stream.removeEventListener('open', handleOpen);
      stream.removeEventListener('error', handleError);
      stream.close();
    };
  }, []);

  const filteredFeed = useMemo(() => {
    if (feedFilter === 'all') return feed;
    return feed.filter(item => item.kind === feedFilter);
  }, [feed, feedFilter]);

  return (
    <Box sx={{ maxWidth: 1024, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiChat1 size={26} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Communications & Inter-Agent Bus
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.25 }}>
            <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500 }}>
              Live durable stream of peer messages, delegations, and tool invocations.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: realtime ? '#ff4f00' : '#a8a29e',
                  boxShadow: realtime ? '0 0 8px rgba(255, 79, 0, 0.6)' : 'none'
                }}
              />
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#666155', fontWeight: 600 }}>
                {realtime ? 'live bus' : 'reconnecting'}
              </Typography>
            </Box>
          </Box>
        </Box>
        <IconButton
          onClick={() => void loadFeed()}
          sx={{
            color: '#666155',
            bgcolor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid rgba(32, 21, 21, 0.1)',
            boxShadow: '0 2px 6px rgba(32, 21, 21, 0.04)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
          aria-label="Refresh communications feed"
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

      {/* Live Voice Communicator with Chief */}
      <ChiefVoiceAssistant
        onTaskCreated={() => {
          void loadFeed();
        }}
      />

      {/* Filter Tabs */}
      <Stack direction="row" spacing={1}>
        {(['all', 'message', 'tool'] as FeedFilter[]).map(f => (
          <Chip
            key={f}
            label={f.toUpperCase()}
            size="small"
            onClick={() => setFeedFilter(f)}
            sx={{
              bgcolor: feedFilter === f ? '#ff4f00' : '#ffffff',
              color: feedFilter === f ? '#ffffff' : '#201515',
              fontWeight: 700,
              cursor: 'pointer',
              border: '1px solid rgba(32, 21, 21, 0.08)'
            }}
          />
        ))}
      </Stack>

      {/* Feed Stream */}
      {loading ? (
        <Box sx={{ p: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading communication stream…
          </Typography>
        </Box>
      ) : filteredFeed.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '16px' }}>
          <Typography variant="body2" sx={{ color: '#666155', fontWeight: 500 }}>
            No communication events found matching the filter.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={2}>
          {filteredFeed.map(item => (
            <FeedCard key={item.id} item={item} />
          ))}
        </Stack>
      )}

      {/* Operator Broadcast Box */}
      {/*
        This control used to POST /messages, which no route implements — so filling it in produced a
        404. Wiring it to the message repository alone would be worse than the 404: nothing delivers
        a message to an agent, so the row would show up in this feed as a message Chief never
        received. Kept visible and disabled so the gap is stated instead of hidden behind a button
        that always fails.
      */}
      <Card
        sx={{
          p: 2.5,
          bgcolor: '#ffffff',
          borderRadius: '16px',
          border: '1px dashed rgba(32, 21, 21, 0.2)',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center'
        }}
      >
        <TextField fullWidth size="small" placeholder="Direct messaging to an agent is not available yet" disabled />
        <Button variant="contained" color="primary" disabled startIcon={<CiPaperplane size={18} />}>
          Send
        </Button>
      </Card>
      <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: -2.5 }}>
        No route delivers an operator message to an agent yet, so this box is disabled rather than accepting a message it cannot deliver.
      </Typography>
    </Box>
  );
}
