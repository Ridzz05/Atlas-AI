'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import { CiCirclePlus, CiLocationArrow1, CiRedo, CiPlay1 } from 'react-icons/ci';
import { atlasFetch } from '../../lib/atlas-api';
import { subscribeToAtlasEvents } from '../../lib/event-stream';

interface ApiTask {
  id: string;
  title: string;
  assignedAgent: string;
  status: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

interface TaskListResponse {
  data: ApiTask[];
  count: number;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [newGoal, setNewGoal] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<TaskListResponse>('/tasks');
      setTasks(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load tasks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
    const stream = new EventSource('/api/atlas/events/stream');
    const unsubscribe = subscribeToAtlasEvents(stream, () => void loadTasks());
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
  }, [loadTasks]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newGoal.trim() || submitting) return;
    setSubmitting(true);
    try {
      await atlasFetch<ApiTask>('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: newGoal.trim().slice(0, 80),
          goal: newGoal.trim(),
          assignedAgent: 'chief'
        })
      });
      setNewGoal('');
      setShowModal(false);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create task.');
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return { color: '#ffffff', bg: '#ff4f00', border: 'transparent' };
      case 'running':
      case 'planning':
        return { color: '#d64200', bg: '#fff3eb', border: 'rgba(255, 79, 0, 0.3)' };
      case 'failed':
      case 'cancelled':
        return { color: '#dc2626', bg: '#fee2e2', border: 'rgba(220, 38, 38, 0.3)' };
      default:
        return { color: '#201515', bg: '#f5efe6', border: 'rgba(32, 21, 21, 0.08)' };
    }
  };

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiPlay1 size={24} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Automated Workflows
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 0.25 }}>
            <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500 }}>
              Live task execution queue derived from ATLAS AI Engine.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: realtime ? '#ff4f00' : '#a8a29e'
                }}
              />
              <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#666155', fontWeight: 600 }}>
                {realtime ? 'live stream' : 'reconnecting'}
              </Typography>
            </Box>
          </Box>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <IconButton
            onClick={() => void loadTasks()}
            sx={{
              color: '#666155',
              bgcolor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid rgba(32, 21, 21, 0.1)',
              '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
            }}
            aria-label="Refresh tasks"
          >
            <CiRedo size={18} />
          </IconButton>
          <Button
            variant="contained"
            color="primary"
            startIcon={<CiCirclePlus size={18} />}
            onClick={() => setShowModal(true)}
            sx={{ px: 2.5 }}
          >
            New Workflow
          </Button>
        </Stack>
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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 8, gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading automated workflows…
          </Typography>
        </Box>
      ) : tasks.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '16px' }}>
          <Typography variant="body2" sx={{ color: '#666155', fontWeight: 500 }}>
            No workflows found. Click "New Workflow" to trigger a new multi-agent loop.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={2}>
          {tasks.map(task => {
            const cost = typeof task.result?.totalCostUsd === 'number' ? task.result.totalCostUsd : 0;
            const statusStyle = getStatusColor(task.status);
            return (
              <Card
                key={task.id}
                sx={{
                  p: 2.75,
                  bgcolor: '#ffffff',
                  borderRadius: '14px',
                  border: '1px solid rgba(32, 21, 21, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1.5,
                  '&:hover': {
                    borderColor: 'rgba(255, 79, 0, 0.35)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                    <Chip
                      label={task.id.slice(0, 8)}
                      size="small"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        bgcolor: '#f5efe6',
                        color: '#201515',
                        border: '1px solid rgba(32, 21, 21, 0.08)'
                      }}
                    />
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', wordBreak: 'break-word' }}>
                      {task.title}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#666155', fontSize: '0.75rem', fontWeight: 600 }}>
                      Cost: ${cost.toFixed(2)}
                    </Typography>
                    <Chip
                      label={task.status.toUpperCase()}
                      size="small"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        bgcolor: statusStyle.bg,
                        color: statusStyle.color,
                        border: `1px solid ${statusStyle.border}`
                      }}
                    />
                  </Stack>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: '0.75rem', color: '#666155' }}>
                  <CiLocationArrow1 size={16} color="#c2410c" />
                  <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#d64200', fontWeight: 700 }}>
                    {task.assignedAgent.toUpperCase()}
                  </Typography>
                  {task.error && (
                    <Typography variant="caption" sx={{ color: '#dc2626', ml: 1, wordBreak: 'break-word', fontWeight: 500 }}>
                      {task.error}
                    </Typography>
                  )}
                </Box>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* Zapier Create Task Modal */}
      <Dialog
        open={showModal}
        onClose={() => !submitting && setShowModal(false)}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#ffffff',
              border: '1px solid rgba(255, 79, 0, 0.25)',
              borderRadius: '16px',
              boxShadow: '0 10px 25px rgba(32, 21, 21, 0.08)'
            }
          }
        }}
      >
        <form onSubmit={handleCreate}>
          <DialogTitle sx={{ color: '#201515', fontWeight: 700, pb: 1, display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <CiPlay1 size={22} color="#c2410c" />
            Create Workflow for Chief Trigger
          </DialogTitle>
          <DialogContent sx={{ pt: 1.5 }}>
            <Typography variant="caption" sx={{ color: '#666155', display: 'block', mb: 2, fontWeight: 500 }}>
              Chief will trigger the loop, decompose tasks, and dispatch specialist workers.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              multiline
              rows={4}
              value={newGoal}
              onChange={e => setNewGoal(e.target.value)}
              placeholder="e.g. Susun agenda rapat marketing untuk besok pukul 10:00 WIB"
              variant="outlined"
              required
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: '#fbf8f2',
                  color: '#201515',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  '& fieldset': { borderColor: 'rgba(32, 21, 21, 0.15)' },
                  '&:hover fieldset': { borderColor: 'rgba(194, 65, 12, 0.4)' },
                  '&.Mui-focused fieldset': { borderColor: '#c2410c' }
                }
              }}
            />
          </DialogContent>
          <DialogActions sx={{ p: 2.5, pt: 1, borderTop: '1px solid rgba(32, 21, 21, 0.06)' }}>
            <Button onClick={() => setShowModal(false)} disabled={submitting} sx={{ color: '#666155' }}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              disabled={submitting || !newGoal.trim()}
              startIcon={<CiCirclePlus size={18} />}
            >
              {submitting ? 'Submitting…' : 'Trigger Workflow'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
