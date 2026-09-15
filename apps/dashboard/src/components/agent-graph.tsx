'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Divider from '@mui/material/Divider';
import {
  CiLock,
  CiSearch,
  CiBadgeDollar,
  CiEdit,
  CiCircleCheck,
  CiPlay1,
  CiClock2,
  CiCircleAlert,
  CiCircleMinus,
  CiBoxes,
  CiVault,
  CiRedo,
  CiRoute,
  CiGrid41
} from 'react-icons/ci';

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

interface GraphLink {
  source: string;
  target: string;
  label?: string;
}

interface SimNode {
  id: string;
  name: string;
  role: string;
  status: AgentNodeStatus;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  glowColor: string;
  isKnowledge?: boolean;
}

const DEFAULT_AGENTS: AgentNodeData[] = [
  { id: 'chief', name: 'Chief', role: 'System Orchestrator', status: 'IDLE' },
  { id: 'ned', name: 'Ned', role: 'Research Specialist', status: 'IDLE' },
  { id: 'luna', name: 'Luna', role: 'Data & Market Analyst', status: 'IDLE' },
  { id: 'layla', name: 'Layla', role: 'Lead Scoring Specialist', status: 'IDLE' },
  { id: 'hermes', name: 'Hermes', role: 'Content Specialist', status: 'IDLE' },
  { id: 'argus', name: 'Argus', role: 'QA & Risk Gate', status: 'IDLE' }
];

const GRAPH_LINKS: GraphLink[] = [
  // Orchestration backbone
  { source: 'chief', target: 'ned', label: 'Delegates Research' },
  { source: 'chief', target: 'luna', label: 'Delegates Analysis' },
  { source: 'chief', target: 'layla', label: 'Delegates Scoring' },
  { source: 'chief', target: 'hermes', label: 'Delegates Copywriting' },
  // Multi-Agent Pipeline (Ned -> Luna -> Layla/Hermes)
  { source: 'ned', target: 'luna', label: 'Raw Findings' },
  { source: 'luna', target: 'layla', label: 'Market Benchmarks' },
  { source: 'luna', target: 'hermes', label: 'Analytical Insights' },
  // QA verification gate
  { source: 'ned', target: 'argus', label: 'Fact Verification' },
  { source: 'luna', target: 'argus', label: 'Math & Logic QA' },
  { source: 'layla', target: 'argus', label: 'Rubric Audit' },
  { source: 'hermes', target: 'argus', label: 'Language & Safety QA' },
  { source: 'argus', target: 'chief', label: 'Final Verdict' },
  // Second Brain Knowledge links
  { source: 'vault', target: 'chief', label: 'System Context' },
  { source: 'vault', target: 'ned', label: 'Vault Search' },
  { source: 'vault', target: 'luna', label: 'Knowledge Base' }
];

const AGENT_CONFIGS: Record<string, { color: string; glow: string; radius: number; defaultX: number; defaultY: number }> = {
  chief: { color: '#ff4f00', glow: 'rgba(255, 79, 0, 0.45)', radius: 32, defaultX: 450, defaultY: 210 },
  ned: { color: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)', radius: 24, defaultX: 240, defaultY: 110 },
  luna: { color: '#06b6d4', glow: 'rgba(6, 182, 212, 0.45)', radius: 25, defaultX: 660, defaultY: 110 },
  layla: { color: '#10b981', glow: 'rgba(16, 185, 129, 0.4)', radius: 24, defaultX: 170, defaultY: 260 },
  hermes: { color: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)', radius: 24, defaultX: 730, defaultY: 260 },
  argus: { color: '#f59e0b', glow: 'rgba(245, 158, 11, 0.45)', radius: 27, defaultX: 450, defaultY: 370 },
  vault: { color: '#94a3b8', glow: 'rgba(148, 163, 184, 0.35)', radius: 22, defaultX: 280, defaultY: 370 }
};

export function AgentGraph({ agents = DEFAULT_AGENTS }: AgentGraphProps) {
  const [viewMode, setViewMode] = useState<'obsidian' | 'hierarchy'>('obsidian');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // SVG dimensions
  const svgWidth = 900;
  const svgHeight = 480;

  // Initialize interactive simulation nodes
  const [nodes, setNodes] = useState<SimNode[]>(() => {
    const list: SimNode[] = agents.map(a => {
      const cfg = AGENT_CONFIGS[a.id] || { color: '#ff4f00', glow: 'rgba(255,79,0,0.3)', radius: 24, defaultX: 450, defaultY: 240 };
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        status: a.status,
        x: cfg.defaultX,
        y: cfg.defaultY,
        vx: 0,
        vy: 0,
        radius: cfg.radius,
        color: cfg.color,
        glowColor: cfg.glow
      };
    });

    // Add Second Brain node
    const vaultCfg = AGENT_CONFIGS.vault!;
    list.push({
      id: 'vault',
      name: 'Second Brain',
      role: 'Obsidian Knowledge Vault (RAG)',
      status: 'IDLE',
      x: vaultCfg.defaultX,
      y: vaultCfg.defaultY,
      vx: 0,
      vy: 0,
      radius: vaultCfg.radius,
      color: vaultCfg.color,
      glowColor: vaultCfg.glow,
      isKnowledge: true
    });

    return list;
  });

  // Sync statuses from external props
  useEffect(() => {
    setNodes(prev =>
      prev.map(node => {
        const found = agents.find(a => a.id === node.id);
        return found ? { ...node, status: found.status, role: found.role } : node;
      })
    );
  }, [agents]);

  // Dragging interaction state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const handlePointerDown = (id: string, e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingId(id);
    setSelectedNodeId(id);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingId || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const y = ((e.clientY - rect.top) / rect.height) * svgHeight;

    setNodes(prev =>
      prev.map(n => (n.id === draggingId ? { ...n, x: Math.max(35, Math.min(svgWidth - 35, x)), y: Math.max(35, Math.min(svgHeight - 35, y)) } : n))
    );
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingId) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {}
      setDraggingId(null);
    }
  };

  const resetPositions = () => {
    setNodes(prev =>
      prev.map(n => {
        const cfg = AGENT_CONFIGS[n.id];
        return cfg ? { ...n, x: cfg.defaultX, y: cfg.defaultY } : n;
      })
    );
  };

  // Node lookup map
  const nodeMap = useMemo(() => {
    const map = new Map<string, SimNode>();
    for (const n of nodes) map.set(n.id, n);
    return map;
  }, [nodes]);

  // Find connected links for hovered node
  const activeLinks = useMemo(() => {
    if (!hoveredNodeId && !selectedNodeId) return new Set<string>();
    const activeTarget = hoveredNodeId || selectedNodeId;
    const set = new Set<string>();
    for (const l of GRAPH_LINKS) {
      if (l.source === activeTarget || l.target === activeTarget) {
        set.add(`${l.source}->${l.target}`);
      }
    }
    return set;
  }, [hoveredNodeId, selectedNodeId]);

  const getAgentIcon = (id: string) => {
    switch (id) {
      case 'chief':
        return <CiLock size={18} color="#ffffff" />;
      case 'ned':
        return <CiSearch size={16} color="#ffffff" />;
      case 'luna':
        return <CiBoxes size={16} color="#ffffff" />;
      case 'layla':
        return <CiBadgeDollar size={16} color="#ffffff" />;
      case 'hermes':
        return <CiEdit size={16} color="#ffffff" />;
      case 'argus':
        return <CiCircleCheck size={17} color="#ffffff" />;
      case 'vault':
        return <CiVault size={16} color="#ffffff" />;
      default:
        return <CiPlay1 size={16} color="#ffffff" />;
    }
  };

  const getStatusChip = (status: AgentNodeStatus) => {
    switch (status) {
      case 'WORKING':
        return (
          <Chip
            icon={<CiPlay1 size={14} style={{ color: '#ffffff' }} />}
            label="RUNNING"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.65rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              bgcolor: '#c2410c',
              color: '#ffffff'
            }}
          />
        );
      case 'QUEUED':
        return (
          <Chip
            icon={<CiClock2 size={14} style={{ color: '#d64200' }} />}
            label="QUEUED"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.65rem',
              fontWeight: 700,
              fontFamily: 'monospace',
              bgcolor: '#fff3eb',
              color: '#d64200',
              border: '1px solid rgba(194, 65, 12, 0.25)'
            }}
          />
        );
      case 'ERROR':
        return (
          <Chip
            icon={<CiCircleAlert size={14} style={{ color: '#dc2626' }} />}
            label="ERROR"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.65rem',
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
            icon={<CiCircleMinus size={14} style={{ color: '#666155' }} />}
            label="IDLE"
            size="small"
            sx={{
              height: 22,
              fontSize: '0.65rem',
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

  const selectedNode = selectedNodeId ? nodeMap.get(selectedNodeId) : null;

  return (
    <Card
      sx={{
        p: { xs: 2, md: 3.5 },
        bgcolor: '#ffffff',
        borderRadius: '20px',
        border: '1px solid rgba(32, 21, 21, 0.08)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)'
      }}
    >
      {/* Topology Header & View Switcher */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
          mb: 2.5,
          pb: 2,
          borderBottom: '1px solid rgba(32, 21, 21, 0.06)'
        }}
      >
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
            <CiRoute size={22} color="#c2410c" />
          </Box>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: '-0.01em', color: '#201515' }}>
              Multi-Agent Fleet Topology
            </Typography>
            <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500 }}>
              Interconnected agent workflow graph, live status, and Second Brain grounding
            </Typography>
          </Box>
        </Box>

        {/* View Mode & Controls */}
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              display: 'flex',
              bgcolor: '#f5efe6',
              p: 0.5,
              borderRadius: '10px',
              border: '1px solid rgba(32, 21, 21, 0.08)'
            }}
          >
            <Button
              size="small"
              onClick={() => setViewMode('obsidian')}
              startIcon={<CiRoute size={16} />}
              sx={{
                px: 1.5,
                py: 0.5,
                fontSize: '0.74rem',
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: '8px',
                bgcolor: viewMode === 'obsidian' ? '#ffffff' : 'transparent',
                color: viewMode === 'obsidian' ? '#c2410c' : '#666155',
                boxShadow: viewMode === 'obsidian' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                '&:hover': { bgcolor: viewMode === 'obsidian' ? '#ffffff' : 'rgba(32,21,21,0.04)' }
              }}
            >
              Obsidian Graph
            </Button>
            <Button
              size="small"
              onClick={() => setViewMode('hierarchy')}
              startIcon={<CiGrid41 size={16} />}
              sx={{
                px: 1.5,
                py: 0.5,
                fontSize: '0.74rem',
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: '8px',
                bgcolor: viewMode === 'hierarchy' ? '#ffffff' : 'transparent',
                color: viewMode === 'hierarchy' ? '#c2410c' : '#666155',
                boxShadow: viewMode === 'hierarchy' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                '&:hover': { bgcolor: viewMode === 'hierarchy' ? '#ffffff' : 'rgba(32,21,21,0.04)' }
              }}
            >
              Hierarchy Fleet
            </Button>
          </Box>

          {viewMode === 'obsidian' && (
            <Tooltip title="Reset Graph Constellation">
              <IconButton
                size="small"
                onClick={resetPositions}
                sx={{
                  bgcolor: '#f5efe6',
                  color: '#666155',
                  borderRadius: '8px',
                  border: '1px solid rgba(32, 21, 21, 0.08)',
                  '&:hover': { bgcolor: '#ece4d6', color: '#201515' }
                }}
              >
                <CiRedo size={16} />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Box>

      {/* VIEW 1: OBSIDIAN GRAPH VIEW */}
      {viewMode === 'obsidian' && (
        <Box sx={{ position: 'relative' }}>
          {/* Obsidian Graph SVG Canvas */}
          <Box
            sx={{
              width: '100%',
              height: svgHeight,
              borderRadius: '16px',
              bgcolor: '#191817', // Obsidian dark graphite canvas
              border: '1px solid rgba(255, 255, 255, 0.08)',
              overflow: 'hidden',
              position: 'relative',
              cursor: draggingId ? 'grabbing' : 'default',
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.04) 1px, transparent 0)',
              backgroundSize: '24px 24px'
            }}
          >
            <svg
              ref={svgRef}
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              style={{ width: '100%', height: '100%', userSelect: 'none' }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
            >
              <defs>
                {/* Glow Filter for Active Nodes */}
                <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="6" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                {/* Linear gradient for working task flows */}
                <linearGradient id="flowPulse" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff4f00" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.8" />
                </linearGradient>
              </defs>

              {/* 1. Connecting Graph Edges (Lines) */}
              {GRAPH_LINKS.map(link => {
                const sNode = nodeMap.get(link.source);
                const tNode = nodeMap.get(link.target);
                if (!sNode || !tNode) return null;

                const linkKey = `${link.source}->${link.target}`;
                const isHighlight = activeLinks.has(linkKey);
                const isWorking = sNode.status === 'WORKING' || tNode.status === 'WORKING';

                return (
                  <g key={linkKey}>
                    {/* Base Edge Line */}
                    <line
                      x1={sNode.x}
                      y1={sNode.y}
                      x2={tNode.x}
                      y2={tNode.y}
                      stroke={
                        isHighlight
                          ? '#ff4f00'
                          : isWorking
                            ? '#f97316'
                            : 'rgba(255, 255, 255, 0.12)'
                      }
                      strokeWidth={isHighlight ? 2.5 : isWorking ? 2 : 1.2}
                      strokeDasharray={isWorking ? '4 4' : 'none'}
                      style={{
                        transition: 'stroke 0.25s, stroke-width 0.25s'
                      }}
                    />

                    {/* Animated moving pulse circle along working links */}
                    {isWorking && (
                      <circle r={3} fill="#ff4f00">
                        <animate
                          attributeName="cx"
                          from={sNode.x}
                          to={tNode.x}
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="cy"
                          from={sNode.y}
                          to={tNode.y}
                          dur="2.2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                  </g>
                );
              })}

              {/* 2. Interactive Graph Nodes */}
              {nodes.map(node => {
                const isHovered = hoveredNodeId === node.id;
                const isSelected = selectedNodeId === node.id;
                const isDimmed = (hoveredNodeId || selectedNodeId) && !isHovered && !isSelected && !activeLinks.has(`${node.id}->${hoveredNodeId || selectedNodeId}`) && !activeLinks.has(`${hoveredNodeId || selectedNodeId}->${node.id}`);
                const isWorking = node.status === 'WORKING';

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{
                      cursor: 'grab',
                      opacity: isDimmed ? 0.35 : 1,
                      transition: 'opacity 0.25s'
                    }}
                    onPointerDown={e => handlePointerDown(node.id, e)}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId(null)}
                  >
                    {/* Breathing Outer Ring when WORKING */}
                    {isWorking && (
                      <circle
                        r={node.radius + 8}
                        fill="none"
                        stroke={node.color}
                        strokeWidth={2}
                        opacity={0.6}
                      >
                        <animate
                          attributeName="r"
                          values={`${node.radius + 4}; ${node.radius + 14}; ${node.radius + 4}`}
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                        <animate
                          attributeName="opacity"
                          values="0.8; 0.1; 0.8"
                          dur="1.8s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}

                    {/* Outer Glow Circle */}
                    <circle
                      r={node.radius}
                      fill={node.color}
                      fillOpacity={isSelected ? 0.35 : isHovered ? 0.25 : 0.15}
                      stroke={isSelected ? '#ffffff' : node.color}
                      strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.5}
                      filter={isWorking ? 'url(#nodeGlow)' : undefined}
                    />

                    {/* Inner Core Circle */}
                    <circle
                      r={node.radius - 6}
                      fill="#22201e"
                      stroke={node.color}
                      strokeWidth={1.5}
                    />

                    {/* Icon container */}
                    <g transform="translate(-8, -8)">
                      {getAgentIcon(node.id)}
                    </g>

                    {/* Node Title Text (Obsidian style label underneath) */}
                    <text
                      y={node.radius + 16}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : '#e4dfd7'}
                      fontSize={node.id === 'chief' ? 12 : 11}
                      fontWeight={700}
                      fontFamily="system-ui, sans-serif"
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.name}
                    </text>

                    {/* Role caption */}
                    <text
                      y={node.radius + 28}
                      textAnchor="middle"
                      fill={node.isKnowledge ? '#94a3b8' : '#a8a29e'}
                      fontSize={9}
                      fontFamily="monospace"
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.role}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Floating Info Overlay for Selected or Hovered Node */}
            {selectedNode && (
              <Box
                sx={{
                  position: 'absolute',
                  bottom: 16,
                  left: 16,
                  maxWidth: 320,
                  p: 2,
                  bgcolor: 'rgba(30, 28, 26, 0.88)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: '12px',
                  border: `1px solid ${selectedNode.color}`,
                  color: '#ffffff',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
                  animation: 'fadeIn 0.2s ease-out'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        bgcolor: selectedNode.color,
                        boxShadow: `0 0 8px ${selectedNode.color}`
                      }}
                    />
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#ffffff' }}>
                      {selectedNode.name}
                    </Typography>
                  </Box>
                  {getStatusChip(selectedNode.status)}
                </Box>
                <Typography variant="caption" sx={{ color: '#d6d3d1', display: 'block', mb: 1, fontWeight: 500 }}>
                  {selectedNode.role}
                </Typography>
                <Typography variant="caption" sx={{ color: '#a8a29e', fontSize: '0.72rem', display: 'block' }}>
                  {selectedNode.isKnowledge
                    ? '27 synced markdown notes in vault vector store. Provides semantic context to Ned, Luna, and Chief.'
                    : selectedNode.id === 'luna'
                      ? 'Specialized in quantitative analysis, tariff comparison, statistical modeling, and actionable market gaps.'
                      : selectedNode.id === 'ned'
                        ? 'Specialized in live web search via Chromium, verified source extraction, and factual evidence gathering.'
                        : selectedNode.id === 'argus'
                          ? 'Strict QA gate: Factuality, numerical check, language purity, and policy safety before delivery.'
                          : 'Root orchestrator: Designs dependency-ordered DAG plans and delegates subtasks to specialists.'}
                </Typography>
              </Box>
            )}

            {/* Obsidian Legend on Top Left */}
            <Box
              sx={{
                position: 'absolute',
                top: 14,
                left: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                bgcolor: 'rgba(24, 23, 22, 0.75)',
                backdropFilter: 'blur(6px)',
                px: 1.5,
                py: 0.75,
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <Typography variant="caption" sx={{ color: '#a8a29e', fontFamily: 'monospace', fontSize: '0.72rem' }}>
                💡 Drag nodes to rearrange · Click to inspect · Lines indicate live delegation flow
              </Typography>
            </Box>
          </Box>
        </Box>
      )}

      {/* VIEW 2: HIERARCHY FLEET VIEW (All 6 Agents in Grid) */}
      {viewMode === 'hierarchy' && (
        <Stack spacing={2.5} sx={{ alignItems: 'center', py: 1 }}>
          {/* Depth 0: Chief */}
          {(() => {
            const chief = agents.find(a => a.id === 'chief') || DEFAULT_AGENTS[0]!;
            return (
              <Card
                sx={{
                  width: { xs: '100%', sm: 380 },
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
                      width: 40,
                      height: 40,
                      borderRadius: '10px',
                      bgcolor: '#fff3eb',
                      border: '1px solid rgba(255, 79, 0, 0.25)'
                    }}
                  >
                    <CiLock size={20} color="#c2410c" />
                  </Avatar>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#201515' }}>
                      {chief.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#d64200', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700 }}>
                      Depth 0 · Root Orchestrator
                    </Typography>
                  </Box>
                </Box>
                {getStatusChip(chief.status)}
              </Card>
            );
          })()}

          {/* Vertical Connector */}
          <Box sx={{ width: 2, height: 20, bgcolor: 'rgba(255, 79, 0, 0.35)' }} />

          {/* Depth 1: Specialists (Ned, Luna, Layla, Hermes) */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
              gap: 2,
              width: '100%'
            }}
          >
            {agents
              .filter(a => a.id !== 'chief' && a.id !== 'argus')
              .map(agent => (
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
                    transition: 'border-color 0.2s',
                    '&:hover': {
                      borderColor: AGENT_CONFIGS[agent.id]?.color || '#c2410c'
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
                          bgcolor: '#f5efe6',
                          border: `1px solid ${AGENT_CONFIGS[agent.id]?.color || 'rgba(32, 21, 21, 0.12)'}`
                        }}
                      >
                        <Box sx={{ color: AGENT_CONFIGS[agent.id]?.color || '#201515', display: 'flex' }}>
                          {agent.id === 'ned' && <CiSearch size={18} color="#3b82f6" />}
                          {agent.id === 'luna' && <CiBoxes size={18} color="#06b6d4" />}
                          {agent.id === 'layla' && <CiBadgeDollar size={18} color="#10b981" />}
                          {agent.id === 'hermes' && <CiEdit size={18} color="#a855f7" />}
                        </Box>
                      </Avatar>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: '#201515' }}>
                          {agent.name}
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#666155', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                          {agent.role}
                        </Typography>
                      </Box>
                    </Box>
                    {getStatusChip(agent.status)}
                  </Box>

                  <Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.05)' }} />

                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem', color: '#8c827a' }}>
                    <span>Depth: 1</span>
                    <span>Max Turns: 10</span>
                  </Box>
                </Card>
              ))}
          </Box>

          {/* Vertical Connector */}
          <Box sx={{ width: 2, height: 20, bgcolor: 'rgba(255, 79, 0, 0.35)' }} />

          {/* Depth 2: Argus QA Gate */}
          {(() => {
            const argus = agents.find(a => a.id === 'argus') || DEFAULT_AGENTS[5]!;
            return (
              <Card
                sx={{
                  width: { xs: '100%', sm: 380 },
                  p: 2.25,
                  bgcolor: '#ffffff',
                  borderRadius: '14px',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Avatar
                    variant="rounded"
                    sx={{
                      width: 40,
                      height: 40,
                      borderRadius: '10px',
                      bgcolor: '#fffbeb',
                      border: '1px solid rgba(245, 158, 11, 0.3)'
                    }}
                  >
                    <CiCircleCheck size={20} color="#d97706" />
                  </Avatar>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#201515' }}>
                      {argus.name}
                    </Typography>
                    <Typography variant="caption" sx={{ color: '#d97706', fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700 }}>
                      Depth 2 · QA & Risk Gate
                    </Typography>
                  </Box>
                </Box>
                {getStatusChip(argus.status)}
              </Card>
            );
          })()}
        </Stack>
      )}
    </Card>
  );
}
