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
import { MessageSquare, RefreshCw, Send, Wrench, Zap } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';
import { subscribeToAtlasEvents } from '../../lib/event-stream';
import {
  buildCommunicationFeed,
  CommunicationFeedItem,
  CommunicationMessageRecord,
  CommunicationToolCallRecord
} from '../../lib/communications';

interface RecordListResponse<T> {
  data: T[];
  count: number;
  durable: boolean;
}

type FeedFilter = 'all' | 'message' | 'tool';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function FeedCard({ item }: { item: CommunicationFeedItem }) {
  const isTool = item.kind === 'tool';
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box
        sx={{
          p: 1.25,
          borderRadius: '10px',
          bgcolor: isTool ? '#fff3eb' : '#f5efe6',
          color: isTool ? '#ff4f00' : '#201515',
          border: isTool ? '1px solid rgba(255, 79, 0, 0.25)' : '1px solid rgba(32, 21, 21, 0.08)',
          flexShrink: 0
        }}
      >
        {isTool ? <Wrench size={16} /> : <MessageSquare size={16} />}
      </Box>
      <Card
        sx={{
          p: 2.25,
          bgcolor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid rgba(32, 21, 21, 0.08)',
          boxShadow: '0 2px 8px rgba(32, 21, 21, 0.04)',
          flex: 1,
          minWidth: 0
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, color: '#201515' }}>
            {item.sender}
          </Typography>
          <Typography variant="caption" sx={{ color: '#8c827a', fontFamily: 'monospace' }}>
            {formatTimestamp(item.timestamp)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ color: '#666155', lineHeight: 1.5, wordBreak: 'break-word', fontSize: '0.82rem' }}>
          {item.summary}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
          {item.taskId && (
            <Chip label={`task:${item.taskId.slice(0, 8)}`} size="small" sx={{ fontSize: '0.65rem', fontFamily: 'monospace', bgcolor: '#fbf8f2' }} />
          )}
          {item.riskLevel && (
            <Chip label={`risk:${item.riskLevel}`} size="small" sx={{ fontSize: '0.65rem', fontFamily: 'monospace', bgcolor: '#fff3eb', color: '#ff4f00' }} />
          )}
        </Stack>
      </Card>
    </Box>
  );
}

export default function CommunicationsPage() {
  const [feed, setFeed] = useState<CommunicationFeedItem[]>([]);
  const [inputMsg, setInputMsg] = useState('');
  const [taskIdFilter, setTaskIdFilter] = useState('');
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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
    return feed.filter((item) => item.kind === feedFilter);
  }, [feed, feedFilter]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMsg.trim() || submitting) return;

    setSubmitting(true);
    try {
      await atlasFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          sender: 'human_operator',
          recipient: 'chief',
          content: inputMsg.trim()
        })
      });
      setInputMsg('');
      await loadFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1024, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Zap size={24} color="#ff4f00" />
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
          <RefreshCw size={16} />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      {/* Filter Tabs */}
      <Stack direction="row" spacing={1}>
        {(['all', 'message', 'tool'] as FeedFilter[]).map((f) => (
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
          {filteredFeed.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </Stack>
      )}

      {/* Operator Broadcast Box */}
      <Card component="form" onSubmit={handleSend} sx={{ p: 2.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)', display: 'flex', gap: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          value={inputMsg}
          onChange={(e) => setInputMsg(e.target.value)}
          placeholder="Send operator broadcast or direct message to Chief…"
          disabled={submitting}
        />
        <Button type="submit" variant="contained" color="primary" disabled={submitting || !inputMsg.trim()} startIcon={<Send size={16} />}>
          Send
        </Button>
      </Card>
    </Box>
  );
}
