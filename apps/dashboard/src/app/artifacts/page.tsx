'use client';

import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { FileText, RefreshCw, Zap } from 'lucide-react';
import { atlasFetch } from '../../lib/atlas-api';

interface ArtifactRecord {
  id: string;
  taskId: string;
  runId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface ArtifactResponse {
  data: ArtifactRecord[];
  count: number;
  durable: boolean;
}

export default function ArtifactsPage() {
  const [records, setRecords] = useState<ArtifactRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<ArtifactResponse>('/artifacts?limit=100');
      setRecords(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load artifact metadata.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <Box sx={{ maxWidth: 1024, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Zap size={24} color="#ff4f00" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Artifacts & Deliverables
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Durable metadata from the worker artifact store. File paths stay server-side.
          </Typography>
        </Box>
        <IconButton
          onClick={() => void load()}
          sx={{
            color: '#666155',
            bgcolor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid rgba(32, 21, 21, 0.1)',
            boxShadow: '0 2px 6px rgba(32, 21, 21, 0.04)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
          aria-label="Refresh artifacts"
        >
          <RefreshCw size={16} />
        </IconButton>
      </Box>

      {error && (
        <Alert severity="error" sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}>
          {error}
        </Alert>
      )}

      <Card sx={{ bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)', overflow: 'hidden' }}>
        {loading ? (
          <Box sx={{ p: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
            <CircularProgress color="primary" size={32} />
            <Typography variant="caption" sx={{ color: '#666155' }}>
              Loading artifact metadata…
            </Typography>
          </Box>
        ) : records.length === 0 ? (
          <Box sx={{ p: 8, textAlign: 'center' }}>
            <FileText size={40} color="#ff4f00" style={{ margin: '0 auto 12px' }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
              No Artifacts Recorded
            </Typography>
            <Typography variant="caption" sx={{ color: '#8c827a', display: 'block', mt: 0.5 }}>
              Deliverables created by worker runs will automatically appear here.
            </Typography>
          </Box>
        ) : (
          <Stack divider={<Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.06)' }} />}>
            {records.map((record) => (
              <Box key={record.id} sx={{ p: 2.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#201515', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {record.name}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontFamily: 'monospace' }}>
                    {record.mimeType} · task {record.taskId}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#201515', fontSize: '0.78rem' }}>
                    {record.sizeBytes.toLocaleString()} bytes
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#8c827a', display: 'block' }}>
                    {new Date(record.createdAt).toLocaleString()}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        )}
      </Card>
    </Box>
  );
}
