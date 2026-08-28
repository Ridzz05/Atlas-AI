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
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import { ShieldCheck, Check, X, Edit2, Zap, RefreshCw } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface Approval {
  id: string;
  action: string;
  target: string;
  agentId: string;
  riskLevel: string;
  reason: string;
  payload: Record<string, unknown>;
}

interface ApprovalListResponse {
  data: Approval[];
  count: number;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<ApprovalListResponse>('/approvals?status=pending');
      setApprovals(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load approvals.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadApprovals();
  }, []);

  const handleDecision = async (id: string, status: 'approved' | 'rejected' | 'revision_requested') => {
    setActingId(id);
    try {
      await atlasFetch(`/approvals/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      setApprovals((current) => current.filter((approval) => approval.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record approval decision.');
    } finally {
      setActingId(null);
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
              Human Approval Control Room
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            One-time token validation and high-risk action gating (Andreas Tobing Approve-Gate Protocol).
          </Typography>
        </Box>
        <IconButton
          onClick={() => void loadApprovals()}
          sx={{
            color: '#666155',
            bgcolor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid rgba(32, 21, 21, 0.1)',
            boxShadow: '0 2px 6px rgba(32, 21, 21, 0.04)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
          aria-label="Refresh approvals"
        >
          <RefreshCw size={16} />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 8, gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading pending approvals…
          </Typography>
        </Box>
      ) : approvals.length === 0 ? (
        <Card sx={{ p: 8, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '16px' }}>
          <ShieldCheck size={48} color="#16a34a" style={{ margin: '0 auto 16px' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515' }}>
            No Pending Approvals
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5, fontWeight: 500 }}>
            The workflow engine has no pending external actions waiting for token confirmation.
          </Typography>
        </Card>
      ) : (
        <Stack spacing={2.5}>
          {approvals.map((req) => {
            const isActing = actingId === req.id;
            return (
              <Card
                key={req.id}
                sx={{
                  p: 3.5,
                  bgcolor: '#ffffff',
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  border: '1px solid rgba(32, 21, 21, 0.1)',
                  boxShadow: '0 4px 16px rgba(32, 21, 21, 0.05)'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, pb: 2, borderBottom: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box
                      sx={{
                        p: 1.25,
                        borderRadius: '8px',
                        bgcolor: '#fff3eb',
                        color: '#ff4f00',
                        border: '1px solid rgba(255, 79, 0, 0.25)',
                        display: 'flex'
                      }}
                    >
                      <Zap size={18} />
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                        {req.action}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#666155', fontFamily: 'monospace', fontWeight: 600 }}>
                        Target: {req.target} · Trigger Agent: {req.agentId}
                      </Typography>
                    </Box>
                  </Box>
                  <Chip
                    label={`${req.riskLevel.toUpperCase()} RISK`}
                    size="small"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      bgcolor: req.riskLevel === 'high' ? '#fee2e2' : '#fff3eb',
                      color: req.riskLevel === 'high' ? '#dc2626' : '#d64200',
                      border: `1px solid ${req.riskLevel === 'high' ? 'rgba(220, 38, 38, 0.3)' : 'rgba(255, 79, 0, 0.25)'}`
                    }}
                  />
                </Box>

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  <Typography variant="body2" sx={{ color: '#201515', fontWeight: 500 }}>
                    <strong style={{ color: '#201515', fontWeight: 700 }}>Reason:</strong> {req.reason}
                  </Typography>
                  <Paper
                    sx={{
                      p: 2.25,
                      bgcolor: '#fbf8f2',
                      borderRadius: '12px',
                      overflowX: 'auto',
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      color: '#201515',
                      border: '1px solid rgba(32, 21, 21, 0.08)'
                    }}
                  >
                    <pre style={{ margin: 0 }}>{JSON.stringify(req.payload, null, 2)}</pre>
                  </Paper>
                </Box>

                <Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.06)' }} />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
                  <Button
                    variant="outlined"
                    color="inherit"
                    size="small"
                    disabled={isActing}
                    startIcon={<Edit2 size={14} />}
                    onClick={() => void handleDecision(req.id, 'revision_requested')}
                  >
                    Request Revision
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    disabled={isActing}
                    startIcon={<X size={14} />}
                    onClick={() => void handleDecision(req.id, 'rejected')}
                    sx={{
                      borderColor: 'rgba(220, 38, 38, 0.3)',
                      color: '#dc2626',
                      '&:hover': {
                        borderColor: '#dc2626',
                        backgroundColor: '#fee2e2'
                      }
                    }}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    disabled={isActing}
                    startIcon={<Check size={14} />}
                    onClick={() => void handleDecision(req.id, 'approved')}
                  >
                    Approve Workflow
                  </Button>
                </Box>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
