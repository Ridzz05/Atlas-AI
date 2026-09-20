'use client';

import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import { CiPlay1, CiRedo, CiSquarePlus, CiBookmarkCheck, CiGrid41, CiSettings, CiSearch, CiFileOn } from 'react-icons/ci';
import { atlasFetch } from '../../lib/atlas-api';
import type { SDLCInitiative, SDLCPhase } from '@atlas/shared';

const SDLC_PHASES: { id: SDLCPhase; label: string; owner: string }[] = [
  { id: 'inception', label: '1. Inception', owner: 'CEO' },
  { id: 'architecture', label: '2. Architecture', owner: 'CTO' },
  { id: 'budget_gate', label: '3. Budget Gate', owner: 'CFO' },
  { id: 'sprint_planning', label: '4. Sprint Planning', owner: 'COO' },
  { id: 'implementation', label: '5. Implementation', owner: 'Specialists' },
  { id: 'qa_compliance', label: '6. QA Audit', owner: 'Argus' },
  { id: 'release_signoff', label: '7. Release', owner: 'Board' }
];

export default function ExecutiveBoardPage() {
  const [initiatives, setInitiatives] = useState<SDLCInitiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openModal, setOpenModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [advancingId, setAdvancingId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  // Form State
  const [newTitle, setNewTitle] = useState('');
  const [newIntent, setNewIntent] = useState('');
  const [newPriority, setNewPriority] = useState<'critical' | 'high' | 'medium' | 'low'>('high');

  const loadInitiatives = async () => {
    setLoading(true);
    try {
      const res = await atlasFetch<{ data: SDLCInitiative[] }>('/sdlc/initiatives');
      setInitiatives(res.data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load SDLC initiatives.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInitiatives();
  }, []);

  const handleCreate = async () => {
    if (!newTitle.trim() || !newIntent.trim()) return;
    setCreating(true);
    try {
      await atlasFetch('/sdlc/initiatives?autoAdvance=true', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          intent: newIntent.trim(),
          priority: newPriority
        })
      });
      setOpenModal(false);
      setNewTitle('');
      setNewIntent('');
      await loadInitiatives();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch initiative.');
    } finally {
      setCreating(false);
    }
  };

  const handleAdvance = async (id: string) => {
    setAdvancingId(id);
    try {
      await atlasFetch(`/sdlc/initiatives/${encodeURIComponent(id)}/advance`, {
        method: 'POST'
      });
      await loadInitiatives();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance initiative phase.');
    } finally {
      setAdvancingId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const getPhaseStepIndex = (phase: SDLCPhase): number => {
    if (phase === 'completed') return 7;
    if (phase === 'failed') return -1;
    const index = SDLC_PHASES.findIndex(p => p.id === phase);
    return index >= 0 ? index : 0;
  };

  return (
    <Box sx={{ p: { xs: 2.5, md: 4 }, maxWidth: 1400, mx: 'auto' }}>
      {/* Top Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3.5, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#201515', letterSpacing: '-0.02em' }}>
            Executive Boardroom & SDLC Pipeline
          </Typography>
          <Typography variant="body2" sx={{ color: '#666155', mt: 0.5, fontWeight: 500 }}>
            Enterprise governance: C-Suite strategic deliberation, budget gate, and specialist execution lifecycle.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<CiRedo size={18} />}
            onClick={() => void loadInitiatives()}
            disabled={loading}
            sx={{
              minHeight: 44,
              borderColor: 'rgba(32, 21, 21, 0.15)',
              color: '#201515',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { bgcolor: '#f5efe6', borderColor: '#d64200' }
            }}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<CiSquarePlus size={18} />}
            onClick={() => setOpenModal(true)}
            sx={{
              minHeight: 44,
              bgcolor: '#d64200',
              color: '#ffffff',
              fontWeight: 700,
              textTransform: 'none',
              boxShadow: 'none',
              '&:hover': { bgcolor: '#b53700', boxShadow: 'none' }
            }}
          >
            New Strategic Initiative
          </Button>
        </Stack>
      </Box>

      {/* C-Suite Authority Banner */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2, mb: 4 }}>
        <Card sx={{ p: 2, bgcolor: '#ffffff', borderRadius: '12px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
          <Typography variant="caption" sx={{ color: '#d64200', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tier 1: Vision
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mt: 0.5 }}>
            CEO (Chief Executive)
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
            Formulates Strategic Briefs, problem statements, and measurable acceptance criteria.
          </Typography>
        </Card>

        <Card sx={{ p: 2, bgcolor: '#ffffff', borderRadius: '12px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
          <Typography variant="caption" sx={{ color: '#0284c7', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tier 1: Architecture
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mt: 0.5 }}>
            CTO (Chief Technology)
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
            Specifies technical blueprints, allowed tools, data scopes, and security boundaries.
          </Typography>
        </Card>

        <Card sx={{ p: 2, bgcolor: '#ffffff', borderRadius: '12px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
          <Typography variant="caption" sx={{ color: '#16a34a', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tier 1: Capital Gate
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mt: 0.5 }}>
            CFO (Chief Financial)
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
            Evaluates token unit economics, enforces Budget Envelopes, and holds veto power.
          </Typography>
        </Card>

        <Card sx={{ p: 2, bgcolor: '#ffffff', borderRadius: '12px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
          <Typography variant="caption" sx={{ color: '#9333ea', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Tier 1: Operations
          </Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mt: 0.5 }}>
            COO (Chief Orchestrator)
          </Typography>
          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
            Decomposes technical specs into dependency DAG batches for specialist execution.
          </Typography>
        </Card>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Initiatives List */}
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress size={36} sx={{ color: '#d64200' }} />
        </Box>
      ) : initiatives.length === 0 ? (
        <Card sx={{ p: 6, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '14px', border: '1px dashed rgba(32, 21, 21, 0.15)' }}>
          <CiFileOn size={48} color="#8a8477" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#201515', mt: 2 }}>
            No Active Strategic Initiatives
          </Typography>
          <Typography variant="body2" sx={{ color: '#666155', mt: 0.5, maxWidth: 500, mx: 'auto' }}>
            Launch a new enterprise initiative to trigger C-Suite deliberation, budget approval, and the full SDLC lifecycle.
          </Typography>
          <Button
            variant="contained"
            onClick={() => setOpenModal(true)}
            sx={{ mt: 3, minHeight: 44, bgcolor: '#d64200', textTransform: 'none', fontWeight: 700 }}
          >
            Launch First Initiative
          </Button>
        </Card>
      ) : (
        <Stack spacing={3}>
          {initiatives.map(initiative => {
            const stepIndex = getPhaseStepIndex(initiative.currentPhase);
            const isExpanded = Boolean(expandedIds[initiative.id]);
            const isAdvancing = advancingId === initiative.id;

            return (
              <Card
                key={initiative.id}
                sx={{
                  p: 3,
                  bgcolor: '#ffffff',
                  borderRadius: '14px',
                  border: '1px solid rgba(32, 21, 21, 0.08)',
                  '&:hover': { borderColor: 'rgba(214, 66, 0, 0.35)' }
                }}
              >
                {/* Header */}
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
                  <Box>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Chip
                        label={initiative.status.toUpperCase()}
                        size="small"
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.68rem',
                          bgcolor: initiative.status === 'completed' ? '#dcfce7' : initiative.status === 'active' ? '#e0f2fe' : '#fee2e2',
                          color: initiative.status === 'completed' ? '#166534' : initiative.status === 'active' ? '#0369a1' : '#991b1b'
                        }}
                      />
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#8a8477' }}>
                        ID: {initiative.id.slice(0, 8)}
                      </Typography>
                    </Stack>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mt: 0.5 }}>
                      {initiative.title}
                    </Typography>
                    <Typography variant="body2" sx={{ color: '#666155', mt: 0.25 }}>
                      {initiative.intent}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    {initiative.status === 'active' && initiative.currentPhase !== 'completed' && (
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={isAdvancing ? <CircularProgress size={14} /> : <CiPlay1 size={16} />}
                        onClick={() => void handleAdvance(initiative.id)}
                        disabled={isAdvancing}
                        sx={{
                          minHeight: 40,
                          borderColor: '#d64200',
                          color: '#d64200',
                          fontWeight: 700,
                          textTransform: 'none',
                          '&:hover': { bgcolor: '#fff3eb' }
                        }}
                      >
                        Advance Phase
                      </Button>
                    )}
                    <Button
                      variant="text"
                      size="small"
                      onClick={() => toggleExpand(initiative.id)}
                      sx={{
                        minHeight: 40,
                        color: '#201515',
                        fontWeight: 700,
                        textTransform: 'none'
                      }}
                    >
                      {isExpanded ? 'Hide Deliverables ▲' : 'View Deliverables ▼'}
                    </Button>
                  </Stack>
                </Box>

                {/* SDLC Stepper */}
                <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(32, 21, 21, 0.06)' }}>
                  <Stepper
                    activeStep={stepIndex}
                    alternativeLabel
                    sx={{ '& .MuiStepLabel-label': { fontSize: '0.75rem', fontWeight: 600 } }}
                  >
                    {SDLC_PHASES.map(phase => (
                      <Step key={phase.id}>
                        <StepLabel
                          optional={
                            <Typography
                              variant="caption"
                              sx={{ color: '#8a8477', display: 'block', textAlign: 'center', fontSize: '0.68rem' }}
                            >
                              {phase.owner}
                            </Typography>
                          }
                        >
                          {phase.label}
                        </StepLabel>
                      </Step>
                    ))}
                  </Stepper>
                </Box>

                {/* Expandable Deliverables View */}
                <Collapse in={isExpanded} unmountOnExit>
                  <Box sx={{ mt: 3, pt: 2, borderTop: '1px solid rgba(32, 21, 21, 0.08)' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#201515', mb: 2 }}>
                      Executive Deliverables & Memos:
                    </Typography>

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
                      {/* CEO Strategic Brief */}
                      {initiative.strategicBrief && (
                        <Paper sx={{ p: 2, bgcolor: '#fdfbf7', border: '1px solid rgba(32, 21, 21, 0.08)', borderRadius: '10px' }}>
                          <Typography variant="caption" sx={{ color: '#d64200', fontWeight: 800, textTransform: 'uppercase' }}>
                            CEO Strategic Brief
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#201515', mt: 0.5 }}>
                            {initiative.strategicBrief.executiveSummary}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 1 }}>
                            <strong>Objectives:</strong> {initiative.strategicBrief.keyObjectives.join(', ')}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
                            <strong>Criteria:</strong> {initiative.strategicBrief.acceptanceCriteria.join(', ')}
                          </Typography>
                        </Paper>
                      )}

                      {/* CTO Technical Spec */}
                      {initiative.technicalSpec && (
                        <Paper sx={{ p: 2, bgcolor: '#fdfbf7', border: '1px solid rgba(32, 21, 21, 0.08)', borderRadius: '10px' }}>
                          <Typography variant="caption" sx={{ color: '#0284c7', fontWeight: 800, textTransform: 'uppercase' }}>
                            CTO Technical Specification
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#201515', mt: 0.5 }}>
                            {initiative.technicalSpec.architectureSummary}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 1 }}>
                            <strong>Allowed Tools:</strong> {initiative.technicalSpec.allowedTools.join(', ')}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
                            <strong>Feasibility:</strong> {initiative.technicalSpec.technicalFeasibility.toUpperCase()}
                          </Typography>
                        </Paper>
                      )}

                      {/* CFO Budget Envelope */}
                      {initiative.budgetEnvelope && (
                        <Paper sx={{ p: 2, bgcolor: '#fdfbf7', border: '1px solid rgba(32, 21, 21, 0.08)', borderRadius: '10px' }}>
                          <Typography variant="caption" sx={{ color: '#16a34a', fontWeight: 800, textTransform: 'uppercase' }}>
                            CFO Budget Envelope
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#201515', mt: 0.5 }}>
                            Cost Ceiling: ${initiative.budgetEnvelope.maxAuthorizedCostUsd.toFixed(2)} (Estimated: $
                            {initiative.budgetEnvelope.estimatedCostUsd.toFixed(2)})
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 1 }}>
                            <strong>ROI Rationale:</strong> {initiative.budgetEnvelope.roiRationale}
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
                            <strong>Verdict:</strong> {initiative.budgetEnvelope.financialApproval.toUpperCase()}
                          </Typography>
                        </Paper>
                      )}

                      {/* Argus QA Report */}
                      {initiative.qaReport && (
                        <Paper sx={{ p: 2, bgcolor: '#fdfbf7', border: '1px solid rgba(32, 21, 21, 0.08)', borderRadius: '10px' }}>
                          <Typography variant="caption" sx={{ color: '#9333ea', fontWeight: 800, textTransform: 'uppercase' }}>
                            Argus QA & Compliance Report
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#201515', mt: 0.5 }}>
                            Verification Score: {initiative.qaReport.verificationScore}/100 ({initiative.qaReport.verdict})
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 1 }}>
                            <strong>Risk Assessment:</strong> {initiative.qaReport.riskAssessment.toUpperCase()}
                          </Typography>
                          {initiative.qaReport.critique && (
                            <Typography variant="caption" sx={{ color: '#666155', display: 'block', mt: 0.5 }}>
                              <strong>Audit Notes:</strong> {initiative.qaReport.critique}
                            </Typography>
                          )}
                        </Paper>
                      )}
                    </Box>
                  </Box>
                </Collapse>
              </Card>
            );
          })}
        </Stack>
      )}

      {/* New Initiative Dialog */}
      <Dialog open={openModal} onClose={() => setOpenModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800, color: '#201515' }}>Launch New Strategic Enterprise Initiative</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '12px !important' }}>
          <TextField
            label="Initiative Title"
            fullWidth
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder="e.g. Q3 B2B Gym Expansion in South Sumatra"
          />
          <TextField
            label="Strategic Intent (Business Goal)"
            fullWidth
            multiline
            rows={3}
            value={newIntent}
            onChange={e => setNewIntent(e.target.value)}
            placeholder="Describe the high-level business outcome desired. The CEO agent will formulate the formal PRD & Objectives."
          />
          <TextField select label="Priority Level" value={newPriority} onChange={e => setNewPriority(e.target.value as any)} fullWidth>
            <MenuItem value="critical">Critical</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="medium">Medium</MenuItem>
            <MenuItem value="low">Low</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setOpenModal(false)} sx={{ minHeight: 44, color: '#666155', textTransform: 'none', fontWeight: 600 }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleCreate()}
            disabled={creating || !newTitle.trim() || !newIntent.trim()}
            sx={{ minHeight: 44, bgcolor: '#d64200', textTransform: 'none', fontWeight: 700 }}
          >
            {creating ? 'Launching...' : 'Trigger SDLC Cycle'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
