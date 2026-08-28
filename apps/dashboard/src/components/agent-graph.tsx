'use client';

import React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import Stack from '@mui/material/Stack';
import Divider from '@mui/material/Divider';
import { Shield, Search, TrendingUp, Edit3, CheckCircle2, Zap } from 'lucide-react';

export type AgentNodeStatus = 'IDLE' | 'QUEUED' | 'WORKING' | 'ERROR';

export interface AgentNodeData {
  id: string;
  name: string;
  role: string;
  status: AgentNodeStatus;
  currentTask?: string;
}

interface AgentGraphProps {
  agents?: AgentNodeData[];
}

const DEFAULT_AGENTS: AgentNodeData[] = [
  { id: 'chief', name: 'Chief', role: 'Orchestrator', status: 'IDLE' },
  { id: 'ned', name: 'Ned', role: 'Researcher', status: 'IDLE' },
  { id: 'layla', name: 'Layla', role: 'Lead Scoring', status: 'IDLE' },
  { id: 'hermes', name: 'Hermes', role: 'Copywriter', status: 'IDLE' },
  { id: 'argus', name: 'Argus', role: 'QA & Risk Gate', status: 'IDLE' }
];

export function AgentGraph({ agents = DEFAULT_AGENTS }: AgentGraphProps) {
  const getStatusChip = (status: AgentNodeStatus) => {
    switch (status) {
      case 'WORKING':
        return (
          <Chip
            label="● RUNNING"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.68rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              bgcolor: '#ff4f00',
              color: '#ffffff'
            }}
          />
        );
      case 'QUEUED':
        return (
          <Chip
            label="⏳ QUEUED"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.68rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              bgcolor: '#fff3eb',
              color: '#d64200',
              border: '1px solid rgba(255, 79, 0, 0.25)'
            }}
          />
        );
      case 'ERROR':
        return (
          <Chip
            label="✖ ERROR"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.68rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              bgcolor: '#fee2e2',
              color: '#dc2626',
              border: '1px solid rgba(220, 38, 38, 0.25)'
            }}
          />
        );
      case 'IDLE':
      default:
        return (
          <Chip
            label="○ IDLE"
            size="small"
            sx={{
              height: 24,
              fontSize: '0.68rem',
              fontWeight: 600,
              fontFamily: 'monospace',
              bgcolor: '#f5efe6',
              color: '#666155',
              border: '1px solid rgba(32, 21, 21, 0.08)'
            }}
          />
        );
    }
  };

  const getAgentIcon = (id: string) => {
    switch (id) {
      case 'chief':
        return <Shield size={18} color="#ff4f00" />;
      case 'ned':
        return <Search size={18} color="#ff4f00" />;
      case 'layla':
        return <TrendingUp size={18} color="#ff4f00" />;
      case 'hermes':
        return <Edit3 size={18} color="#ff4f00" />;
      case 'argus':
        return <CheckCircle2 size={18} color="#ff4f00" />;
      default:
        return <Zap size={18} color="#ff4f00" />;
    }
  };

  const chief = agents.find((a) => a.id === 'chief') || DEFAULT_AGENTS[0]!;
  const specialists = agents.filter((a) => a.id !== 'chief' && a.id !== 'argus');
  const argus = agents.find((a) => a.id === 'argus') || DEFAULT_AGENTS[4]!;

  return (
    <Card
      sx={{
        p: 3.5,
        bgcolor: '#ffffff',
        borderRadius: '18px',
        border: '1px solid rgba(32, 21, 21, 0.08)'
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, pb: 2, borderBottom: '1px solid rgba(32, 21, 21, 0.06)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Zap size={20} color="#ff4f00" />
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: '0.02em', color: '#201515' }}>
              MULTI-AGENT FLEET TOPOLOGY
            </Typography>
            <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500 }}>
              Deterministic trigger, specialist execution, and QA gating (Depth 0 → Depth 2)
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={2} sx={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#666155' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ff4f00' }} />
            <Typography variant="caption" sx={{ color: '#201515', fontWeight: 700 }}>Active Fleet</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#8c827a' }}>Max Concurrency: 3</Typography>
          <Typography variant="caption" sx={{ color: '#8c827a' }}>Max Depth: 2</Typography>
        </Stack>
      </Box>

      {/* Hierarchy Visualizer */}
      <Stack spacing={2.5} sx={{ alignItems: 'center', py: 1 }}>
        {/* Depth 0: Chief */}
        <Card
          sx={{
            width: 330,
            p: 2.25,
            bgcolor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid rgba(255, 79, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar
              variant="rounded"
              sx={{
                width: 38,
                height: 38,
                borderRadius: '10px',
                bgcolor: '#fff3eb',
                border: '1px solid rgba(255, 79, 0, 0.25)'
              }}
            >
              {getAgentIcon('chief')}
            </Avatar>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                {chief.name}
              </Typography>
              <Typography variant="caption" sx={{ color: '#d64200', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700 }}>
                Depth 0 · Trigger & Orchestrator
              </Typography>
            </Box>
          </Box>
          {getStatusChip(chief.status)}
        </Card>

        {/* Vertical Connector */}
        <Box sx={{ width: 2, height: 20, bgcolor: 'rgba(255, 79, 0, 0.35)' }} />

        {/* Depth 1: Specialists */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 2.25,
            width: '100%',
            maxWidth: 860
          }}
        >
          {specialists.map((agent) => (
            <Card
              key={agent.id}
              sx={{
                p: 2.25,
                bgcolor: '#ffffff',
                borderRadius: '14px',
                border: '1px solid rgba(32, 21, 21, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 1.5,
                '&:hover': {
                  borderColor: 'rgba(255, 79, 0, 0.35)'
                }
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 34,
                      height: 34,
                      borderRadius: '8px',
                      bgcolor: '#fff3eb',
                      border: '1px solid rgba(255, 79, 0, 0.2)'
                    }}
                  >
                    {getAgentIcon(agent.id)}
                  </Avatar>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: '#201515' }}>
                      {agent.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#666155', fontSize: '0.72rem', fontWeight: 500 }}>
                      {agent.role}
                    </Typography>
                  </Box>
                </Box>
                {getStatusChip(agent.status)}
              </Box>

              <Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.06)' }} />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#8c827a', fontFamily: 'monospace', fontWeight: 600 }}>
                <span>Depth: 1</span>
                <span>Max Turns: 10</span>
              </Box>
            </Card>
          ))}
        </Box>

        {/* Vertical Connector */}
        <Box sx={{ width: 2, height: 20, bgcolor: 'rgba(255, 79, 0, 0.35)' }} />

        {/* Depth 2: Argus QA Gate */}
        <Card
          sx={{
            width: 330,
            p: 2.25,
            bgcolor: '#ffffff',
            borderRadius: '14px',
            border: '1px solid rgba(255, 79, 0, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar
              variant="rounded"
              sx={{
                width: 38,
                height: 38,
                borderRadius: '10px',
                bgcolor: '#fff3eb',
                border: '1px solid rgba(255, 79, 0, 0.25)'
              }}
            >
              {getAgentIcon('argus')}
            </Avatar>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                {argus.name}
              </Typography>
              <Typography variant="caption" sx={{ color: '#d64200', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700 }}>
                Depth 2 · QA & Risk Gate
              </Typography>
            </Box>
          </Box>
          {getStatusChip(argus.status)}
        </Card>
      </Stack>
    </Card>
  );
}
