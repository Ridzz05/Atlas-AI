'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
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
import { CiCircleCheck, CiClock2, CiCircleAlert, CiDollar, CiCirclePlus, CiRedo, CiPause1, CiPlay1, CiWarning } from 'react-icons/ci';
import { AgentGraph, AgentNodeData } from '../components/agent-graph';
import { WorkflowLiveStream } from '../components/workflow-live-stream';
import { ChiefVoiceAssistant } from '../components/chief-voice-assistant';
import { atlasFetch } from '../lib/atlas-api';
import { subscribeToAtlasEvents } from '../lib/event-stream';

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
interface ApprovalListResponse {
  data: unknown[];
  count: number;
}
interface CostMetrics {
  periodCostUsd: number;
  totalCostUsd: number;
  runCount: number;
  activeRunCount: number;
  completedRunCount: number;
  failedRunCount: number;
}
interface BudgetMetrics {
  limitUsd: number;
  usedUsd: number;
  reservedUsd: number;
  availableUsd: number;
  resetAt: string | null;
}
interface CostSummaryResponse {
  data: { costs: CostMetrics | null; budget: BudgetMetrics | null };
  durable: boolean;
}
interface LeaseMetrics {
  checkedAt: string;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  unleasedExecutableRunCount: number;
  cancellationRequestedCount: number;
}
interface RecoverySummaryResponse {
  data: LeaseMetrics | null;
  durable: boolean;
}
interface ControlState {
  paused: boolean;
  emergencyStop: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}
interface ControlResponse {
  data: ControlState;
  durable: boolean;
}
type ControlAction = 'pause' | 'resume' | 'emergency-stop';

const toAgentStatus = (tasks: ApiTask[], agentId: string): AgentNodeData['status'] => {
  const assigned = tasks.filter(task => task.assignedAgent === agentId);
  if (assigned.length === 0) return 'IDLE';

  // 1. Is the agent actively executing, planning, or waiting for review right now?
  const activeTask = assigned.find(task => ['running', 'planning', 'review_pending', 'approval_pending'].includes(task.status));
  if (activeTask) return 'WORKING';

  // 2. Is there a queued task waiting for this agent?
  const queuedTask = assigned.find(task => task.status === 'queued');
  if (queuedTask) return 'QUEUED';

  // 3. Otherwise, check the most recent task: if the most recent task failed, report ERROR, else IDLE
  const latestTask = assigned[0];
  if (latestTask && ['failed', 'cancelled'].includes(latestTask.status)) {
    return 'ERROR';
  }

  return 'IDLE';
};

export default function CommandCenterPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [costMetrics, setCostMetrics] = useState<CostSummaryResponse['data'] | null>(null);
  const [recoveryMetrics, setRecoveryMetrics] = useState<LeaseMetrics | null>(null);
  const [controlState, setControlState] = useState<ControlState | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const loadOverview = async () => {
    setLoading(true);
    try {
      const [taskResponse, approvalResponse, costResponse, recoveryResponse] = await Promise.all([
        atlasFetch<TaskListResponse>('/tasks?limit=100'),
        atlasFetch<ApprovalListResponse>('/approvals?status=pending&limit=100'),
        atlasFetch<CostSummaryResponse>('/costs'),
        atlasFetch<RecoverySummaryResponse>('/recovery')
      ]);
      setTasks(taskResponse.data);
      setPendingApprovals(approvalResponse.count);
      setCostMetrics(costResponse.data);
      setRecoveryMetrics(recoveryResponse.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the live command center.');
    } finally {
      setLoading(false);
    }
  };

  const loadControl = async () => {
    try {
      const response = await atlasFetch<ControlResponse>(`/control`);
      setControlState(response.data);
      setControlError(null);
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Durable control state is unavailable.');
    }
  };

  const invokeControl = async (action: ControlAction) => {
    const messages: Record<ControlAction, string> = {
      pause: 'Pause task intake and worker dispatch?',
      resume: 'Resume task intake and worker dispatch?',
      'emergency-stop': 'Activate emergency stop? Active runs will receive cancellation signals.'
    };
    if (typeof window !== 'undefined' && !window.confirm(messages[action])) return;

    setControlBusy(true);
    try {
      const response = await atlasFetch<ControlResponse>(`/control/${action}`, {
        method: 'POST',
        body: JSON.stringify({ reason: `Dashboard ${action}` })
      });
      setControlState(response.data);
      setControlError(null);
      await loadOverview();
    } catch (err) {
      setControlError(err instanceof Error ? err.message : 'Control action could not be completed.');
    } finally {
      setControlBusy(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);
  useEffect(() => {
    void loadControl();
  }, []);

  useEffect(() => {
    const stream = new EventSource('/api/atlas/events/stream');
    const refresh = () => {
      void loadOverview();
    };
    const unsubscribe = subscribeToAtlasEvents(stream, refresh);
    return () => {
      unsubscribe();
      stream.close();
    };
  }, []);

  const activeCount = tasks.filter(task => ['running', 'planning', 'review_pending', 'approval_pending'].includes(task.status)).length;
  const completedCount = tasks.filter(task => task.status === 'completed').length;
  const costToday = costMetrics?.costs?.periodCostUsd;
  const budget = costMetrics?.budget;
  const agentIds = ['chief', 'ned', 'luna', 'layla', 'hermes', 'argus'];
  const agentRoleMap: Record<string, string> = {
    chief: 'System Orchestrator',
    ned: 'Research Specialist',
    luna: 'Data & Market Analyst',
    layla: 'Lead Scoring Specialist',
    hermes: 'Content Specialist',
    argus: 'QA & Risk Gate'
  };
  const graphAgents: AgentNodeData[] = agentIds.map(id => ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    role: agentRoleMap[id] || id,
    status: toAgentStatus(tasks, id)
  }));

  const activeTask = tasks.find(task => ['running', 'planning', 'review_pending', 'approval_pending'].includes(task.status));
  const latestTask = activeTask || tasks[0];
  const effectiveTaskId = selectedTaskId || latestTask?.id || null;
  const currentTask = tasks.find(t => t.id === effectiveTaskId) || latestTask;

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiPlay1 size={24} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Command Center
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Live fleet automation and workflow triggers derived from ATLAS AI Engine.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <IconButton
            onClick={() => void loadOverview()}
            sx={{
              color: '#666155',
              bgcolor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid rgba(32, 21, 21, 0.1)',
              '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
            }}
            aria-label="Refresh command center"
          >
            <CiRedo size={18} />
          </IconButton>
          <Button component={Link} href="/tasks" variant="contained" color="primary" endIcon={<CiCirclePlus size={18} />} sx={{ px: 2.5 }}>
            Create Zap Goal
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

      {/* Live Voice Communicator with Chief */}
      <ChiefVoiceAssistant
        onTaskCreated={newTask => {
          setSelectedTaskId(newTask.id);
          void loadOverview();
        }}
      />

      {/* Zapier Fleet Control Bar */}
      <Card sx={{ p: 3, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'flex-start', md: 'center' },
            justifyContent: 'space-between',
            gap: 2
          }}
        >
          <Box>
            <Typography variant="caption" sx={{ color: '#d64200', fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.06em' }}>
              DURABLE WORKFLOW DISPATCH
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5 }}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: controlState?.emergencyStop ? '#dc2626' : controlState?.paused ? '#ff4f00' : controlState ? '#16a34a' : '#a8a29e'
                }}
              />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515' }}>
                {controlState?.emergencyStop
                  ? 'Emergency Stop Active'
                  : controlState?.paused
                    ? 'Workflow Intake Paused'
                    : controlState
                      ? 'Workflow Engine Live & Active'
                      : 'State Unavailable'}
              </Typography>
            </Box>
            <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500 }}>
              {controlState ? 'Shared state synchronized with Telegram bot & distributed worker fleet.' : controlError || 'Loading state…'}
            </Typography>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            {controlState &&
              !controlState.emergencyStop &&
              (controlState.paused ? (
                <Button
                  variant="contained"
                  color="primary"
                  disabled={controlBusy}
                  startIcon={<CiPlay1 size={18} />}
                  onClick={() => void invokeControl('resume')}
                >
                  Resume Workflows
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={controlBusy}
                  startIcon={<CiPause1 size={18} />}
                  onClick={() => void invokeControl('pause')}
                >
                  Pause Workflows
                </Button>
              ))}
            {controlState && !controlState.emergencyStop && (
              <Button
                variant="contained"
                color="error"
                disabled={controlBusy}
                startIcon={<CiWarning size={18} />}
                onClick={() => void invokeControl('emergency-stop')}
              >
                Emergency Stop
              </Button>
            )}
            {controlState?.emergencyStop && (
              <Button
                variant="contained"
                color="primary"
                disabled={controlBusy}
                startIcon={<CiPlay1 size={18} />}
                onClick={() => void invokeControl('resume')}
              >
                Resume System
              </Button>
            )}
          </Stack>
        </Box>
        {controlError && (
          <Typography variant="caption" sx={{ color: '#dc2626', display: 'block', mt: 1.5 }}>
            {controlError}
          </Typography>
        )}
      </Card>

      {loading ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 8, gap: 2 }}>
          <CircularProgress color="primary" size={32} />
          <Typography variant="caption" sx={{ color: '#666155' }}>
            Loading live fleet telemetry…
          </Typography>
        </Box>
      ) : (
        <>
          {/* Top Zapier Metrics Grid */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(5, 1fr)' },
              gap: 2.25
            }}
          >
            <VanillaMetricCard label="ACTIVE TASKS" value={String(activeCount)} icon={<CiClock2 size={20} />} accent={activeCount > 0} />
            <VanillaMetricCard label="COMPLETED" value={String(completedCount)} icon={<CiCircleCheck size={20} />} />
            <VanillaMetricCard
              label="APPROVALS PENDING"
              value={String(pendingApprovals)}
              icon={<CiCircleAlert size={20} />}
              accent={pendingApprovals > 0}
            />
            <VanillaMetricCard
              label="COST TODAY"
              value={costToday == null ? '$0.00' : `$${costToday.toFixed(2)}`}
              icon={<CiDollar size={20} />}
            />
            <VanillaMetricCard
              label="DAILY BUDGET"
              value={budget ? `$${budget.usedUsd.toFixed(2)} / $${budget.limitUsd.toFixed(2)}` : '$0 / $10'}
              icon={<CiDollar size={20} />}
            />
          </Box>

          {/* Multi-Agent Topology Graph */}
          <AgentGraph agents={graphAgents} />

          {/* Live Autonomous Workflow & Inter-Agent Deliberation Feed */}
          <WorkflowLiveStream
            selectedTaskId={effectiveTaskId}
            activeTaskTitle={currentTask?.title}
            isTaskRunning={currentTask ? ['running', 'planning', 'review_pending', 'approval_pending'].includes(currentTask.status) : false}
            onSelectTask={id => setSelectedTaskId(id)}
            availableTasks={tasks.map(t => ({ id: t.id, title: t.title, status: t.status }))}
          />

          {/* Recovery Telemetry Grid */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: 2.25
            }}
          >
            <VanillaMetricCard
              label="ACTIVE LEASES"
              value={recoveryMetrics == null ? '0' : String(recoveryMetrics.activeLeaseCount)}
              icon={<CiClock2 size={18} />}
            />
            <VanillaMetricCard
              label="EXPIRED LEASES"
              value={recoveryMetrics == null ? '0' : String(recoveryMetrics.expiredLeaseCount)}
              icon={<CiCircleAlert size={18} />}
            />
            <VanillaMetricCard
              label="UNLEASED RUNS"
              value={recoveryMetrics == null ? '0' : String(recoveryMetrics.unleasedExecutableRunCount)}
              icon={<CiClock2 size={18} />}
            />
            <VanillaMetricCard
              label="CANCEL REQUESTS"
              value={recoveryMetrics == null ? '0' : String(recoveryMetrics.cancellationRequestedCount)}
              icon={<CiRedo size={18} />}
            />
          </Box>

          {/* Recent Pipelines Card */}
          <Card sx={{ p: 3.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                Recent Automated Executions
              </Typography>
              <Button component={Link} href="/tasks" size="small" sx={{ color: '#ff4f00', fontSize: '0.75rem', fontWeight: 600 }}>
                View All Workflows →
              </Button>
            </Box>
            {tasks.length === 0 ? (
              <Typography variant="caption" sx={{ color: '#8c827a', display: 'block', py: 4, textAlign: 'center', fontWeight: 500 }}>
                No automated tasks have been triggered yet.
              </Typography>
            ) : (
              <Stack divider={<Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.05)' }} />} spacing={1}>
                {tasks.slice(0, 5).map(task => (
                  <Box key={task.id} sx={{ py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, color: '#201515', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {task.title}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#666155', fontFamily: 'monospace', fontWeight: 600 }}>
                        Trigger Agent: {task.assignedAgent}
                      </Typography>
                    </Box>
                    <Chip
                      label={task.status.toUpperCase()}
                      size="small"
                      sx={{
                        fontSize: '0.65rem',
                        fontFamily: 'monospace',
                        fontWeight: 700,
                        bgcolor: task.status === 'completed' ? '#ff4f00' : '#f5efe6',
                        color: task.status === 'completed' ? '#ffffff' : '#201515'
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            )}
          </Card>
        </>
      )}
    </Box>
  );
}

function VanillaMetricCard({
  label,
  value,
  icon,
  accent = false
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card
      sx={{
        p: 2.5,
        bgcolor: '#ffffff',
        borderRadius: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: accent ? '1px solid rgba(255, 79, 0, 0.35)' : '1px solid rgba(32, 21, 21, 0.08)',
        boxShadow: 'none',
        '&:hover': {
          borderColor: '#ff4f00'
        }
      }}
    >
      <Box>
        <Typography
          variant="caption"
          sx={{ color: '#666155', fontFamily: 'monospace', fontWeight: 700, fontSize: '0.68rem', letterSpacing: '0.04em' }}
        >
          {label}
        </Typography>
        <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>
          {value}
        </Typography>
      </Box>
      <Box
        sx={{
          p: 1.25,
          borderRadius: '10px',
          bgcolor: accent ? '#ff4f00' : '#f5efe6',
          color: accent ? '#ffffff' : '#201515',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {icon}
      </Box>
    </Card>
  );
}
