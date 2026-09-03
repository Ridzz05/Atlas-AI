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
import Avatar from '@mui/material/Avatar';
import { CiLock, CiSearch, CiBadgeDollar, CiEdit, CiCircleCheck, CiMicrochip, CiUser, CiRedo } from 'react-icons/ci';
import { atlasFetch } from '../../lib/atlas-api';

interface ApiAgent {
  id: string;
  name: string;
  role: string;
  version: number;
  description: string;
  permissions: { tools: string[] };
  limits: { maxTurns: number; maxDelegationDepth: number; maxCostUsd: number };
}

interface AgentListResponse {
  data: ApiAgent[];
}

const getAgentIcon = (id: string) => {
  switch (id) {
    case 'chief':
      return <CiLock size={20} color="#c2410c" />;
    case 'ned':
      return <CiSearch size={20} color="#2563eb" />;
    case 'layla':
      return <CiBadgeDollar size={20} color="#16a34a" />;
    case 'hermes':
      return <CiEdit size={20} color="#7c3aed" />;
    case 'argus':
      return <CiCircleCheck size={20} color="#d97706" />;
    default:
      return <CiMicrochip size={20} color="#c2410c" />;
  }
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<ApiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = async () => {
    setLoading(true);
    try {
      const response = await atlasFetch<AgentListResponse>('/agents');
      setAgents(response.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the agent registry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, []);

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiUser size={26} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Agent Fleet Registry
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Live agent roles, capability tools, and execution boundaries.
          </Typography>
        </Box>
        <IconButton
          onClick={() => void loadAgents()}
          sx={{
            color: '#666155',
            bgcolor: '#ffffff',
            borderRadius: '10px',
            border: '1px solid rgba(32, 21, 21, 0.1)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
          aria-label="Refresh agent registry"
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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 8, gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading live agent registry…
          </Typography>
        </Box>
      ) : agents.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '16px' }}>
          <Typography variant="body2" sx={{ color: '#666155', fontWeight: 500 }}>
            No agents are registered in the control plane.
          </Typography>
        </Card>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' },
            gap: 3
          }}
        >
          {agents.map(agent => (
            <Card
              key={agent.id}
              sx={{
                p: 3.5,
                bgcolor: '#ffffff',
                borderRadius: '16px',
                border: '1px solid rgba(32, 21, 21, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                '&:hover': {
                  borderColor: '#ff4f00'
                }
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  pb: 2,
                  borderBottom: '1px solid rgba(32, 21, 21, 0.06)'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '10px',
                      bgcolor: '#fff3eb',
                      border: '1px solid rgba(255, 79, 0, 0.25)'
                    }}
                  >
                    {getAgentIcon(agent.id)}
                  </Avatar>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515' }}>
                      {agent.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#d64200', fontFamily: 'monospace', fontWeight: 700 }}>
                      {agent.role.toUpperCase()} · v{agent.version}
                    </Typography>
                  </Box>
                </Box>
                <Chip
                  label="ACTIVE"
                  size="small"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid rgba(22, 163, 74, 0.3)'
                  }}
                />
              </Box>

              <Typography variant="body2" sx={{ color: '#666155', lineHeight: 1.6, fontSize: '0.85rem' }}>
                {agent.description}
              </Typography>

              {/* Execution Limits */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 1.5,
                  p: 1.75,
                  borderRadius: '12px',
                  bgcolor: '#fbf8f2',
                  border: '1px solid rgba(32, 21, 21, 0.06)'
                }}
              >
                <Box>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.68rem', fontWeight: 600 }}>
                    MAX TURNS
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#201515' }}>
                    {agent.limits.maxTurns}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.68rem', fontWeight: 600 }}>
                    MAX DEPTH
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#201515' }}>
                    {agent.limits.maxDelegationDepth}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: '#8c827a', fontSize: '0.68rem', fontWeight: 600 }}>
                    COST LIMIT
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800, color: '#201515' }}>
                    ${agent.limits.maxCostUsd}
                  </Typography>
                </Box>
              </Box>

              {/* Allowed Tools */}
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: '#8c827a', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.68rem', mb: 1, display: 'block' }}
                >
                  PERMITTED CAPABILITY TOOLS:
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                  {agent.permissions.tools.map(tool => (
                    <Chip
                      key={tool}
                      label={tool}
                      size="small"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        bgcolor: '#ffffff',
                        color: '#201515',
                        border: '1px solid rgba(32, 21, 21, 0.12)'
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
