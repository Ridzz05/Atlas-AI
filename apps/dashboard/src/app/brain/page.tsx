'use client';

import React, { useEffect, useState, useTransition } from 'react';
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
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import {
  CiVault,
  CiRedo,
  CiSearch,
  CiRead,
  CiChat1,
  CiMicrochip,
  CiBoxes,
  CiFileOn,
  CiTrash,
  CiPaperplane,
  CiCirclePlus,
  CiDatabase,
  CiPlay1
} from 'react-icons/ci';
import { atlasFetch } from '../../lib/atlas-api';
import { FormattedMessage } from '../../components/formatted-message';

interface SecondBrainStats {
  totalDocuments: number;
  totalChunks: number;
  totalEmbeddings: number;
  embeddingProvider: string;
  embeddingModel: string;
  vectorDimension: number;
  lastSyncAt: string | null;
}

interface SecondBrainDocument {
  id: string;
  title: string;
  filePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  links: string[];
  scope: string;
  chunksCount: number;
  createdAt: string;
  updatedAt: string;
}

interface SecondBrainCitation {
  documentId: string;
  noteTitle: string;
  filePath: string;
  sectionHeading: string | null;
  chunkIndex: number;
  relevanceScore: number;
  excerpt: string;
}

interface GroundedRAGResponse {
  query: string;
  answer: string;
  citations: SecondBrainCitation[];
  sources: Array<{
    title: string;
    filePath: string;
    sectionHeading: string | null;
    score: number;
  }>;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  citations?: SecondBrainCitation[];
  sources?: Array<{
    title: string;
    filePath: string;
    sectionHeading: string | null;
    score: number;
  }>;
}

interface RawMemoryItem {
  id: string;
  type: string;
  status: string;
  content: string;
  scope: string;
  source: string;
  confidence: number;
  updatedAt: string;
}

export default function SecondBrainPage() {
  const [activeTab, setActiveTab] = useState<'chat' | 'vault' | 'raw_memory'>('chat');
  const [stats, setStats] = useState<SecondBrainStats | null>(null);
  const [documents, setDocuments] = useState<SecondBrainDocument[]>([]);
  const [rawMemoryItems, setRawMemoryItems] = useState<RawMemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your **Second Brain Assistant**. Ask me questions grounded in your personal markdown notes and knowledge vault.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatPending, setChatPending] = useState(false);
  const [activeCitation, setActiveCitation] = useState<SecondBrainCitation | null>(null);

  // Vault Management State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [newNotePath, setNewNotePath] = useState('');
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteTags, setNewNoteTags] = useState('');
  const [ingestPending, setIngestPending] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestVaultPath, setIngestVaultPath] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  const [, startTransition] = useTransition();

  const autoSyncedRef = React.useRef(false);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      let [statsRes, docsRes, memoryRes] = await Promise.all([
        atlasFetch<{ data: SecondBrainStats }>('/brain/stats'),
        atlasFetch<{ data: SecondBrainDocument[]; count: number }>('/brain/notes?limit=100'),
        atlasFetch<{ data: RawMemoryItem[]; count: number }>('/memory?limit=50')
      ]);

      if (docsRes.data.length === 0 && !autoSyncedRef.current) {
        autoSyncedRef.current = true;
        try {
          await atlasFetch('/brain/ingest', { method: 'POST', body: JSON.stringify({}) });
          [statsRes, docsRes] = await Promise.all([
            atlasFetch<{ data: SecondBrainStats }>('/brain/stats'),
            atlasFetch<{ data: SecondBrainDocument[]; count: number }>('/brain/notes?limit=100')
          ]);
        } catch {}
      }

      setStats(statsRes.data);
      setDocuments(docsRes.data);
      setRawMemoryItems(memoryRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Second Brain data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const openIngestDialog = () => {
    setIngestError(null);
    setShowIngestModal(true);
  };

  const closeIngestDialog = () => {
    if (ingestPending) return;
    setIngestError(null);
    setShowIngestModal(false);
  };

  // Handle RAG Chat Submit
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatPending) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: chatInput.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setChatMessages(prev => [...prev, userMsg]);
    const query = chatInput.trim();
    setChatInput('');
    setChatPending(true);
    setError(null);

    startTransition(async () => {
      try {
        const ragRes = await atlasFetch<{ data: GroundedRAGResponse }>('/brain/query', {
          method: 'POST',
          body: JSON.stringify({ query, limit: 5 })
        });

        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          sender: 'assistant',
          text: ragRes.data.answer,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          citations: ragRes.data.citations,
          sources: ragRes.data.sources
        };

        setChatMessages(prev => [...prev, assistantMsg]);
      } catch (err) {
        const errorMsg: ChatMessage = {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: `Error querying Second Brain: ${err instanceof Error ? err.message : 'Knowledge retrieval failed.'}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        setChatMessages(prev => [...prev, errorMsg]);
      } finally {
        setChatPending(false);
      }
    });
  };

  // Handle Ingest Single Note
  const handleIngestNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteTitle.trim() || !newNoteContent.trim() || ingestPending) return;

    setIngestPending(true);
    setIngestError(null);
    try {
      const tags = newNoteTags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      await atlasFetch('/brain/notes', {
        method: 'POST',
        body: JSON.stringify({
          title: newNoteTitle.trim(),
          filePath: newNotePath.trim() || `vault/${newNoteTitle.trim().toLowerCase().replace(/\s+/g, '-')}.md`,
          content: newNoteContent.trim(),
          tags
        })
      });

      setSuccessMsg(`Note "${newNoteTitle}" added and indexed for search.`);
      setShowIngestModal(false);
      setNewNoteTitle('');
      setNewNotePath('');
      setNewNoteContent('');
      setNewNoteTags('');
      void loadData();
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : 'Failed to add note.');
    } finally {
      setIngestPending(false);
    }
  };

  // Handle Vault Directory Sync
  const handleSyncVault = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      const res = await atlasFetch<{ ingested: number; totalFiles: number }>('/brain/ingest', {
        method: 'POST',
        body: JSON.stringify({ vaultPath: ingestVaultPath.trim() || undefined })
      });
      setSuccessMsg(`Vault sync complete! Ingested ${res.ingested} of ${res.totalFiles} notes.`);
      setIngestVaultPath('');
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Vault sync failed.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Handle Delete Note
  const handleDeleteNote = async (id: string, title: string) => {
    if (!confirm(`Are you sure you want to delete note "${title}" from the Second Brain index?`)) return;
    try {
      await atlasFetch(`/brain/notes/${id}`, { method: 'DELETE' });
      setSuccessMsg(`Note "${title}" removed.`);
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note.');
    }
  };

  const allTags = Array.from(new Set(documents.flatMap(d => d.tags))).sort();

  const filteredDocuments = documents.filter(doc => {
    const matchesSearch =
      searchQuery === '' ||
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.filePath.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.content.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTag = !selectedTag || doc.tags.some(t => t.toLowerCase() === selectedTag.toLowerCase());

    return matchesSearch && matchesTag;
  });

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3.5 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CiVault size={28} color="#c2410c" />
            <Typography variant="h5" sx={{ fontWeight: 700, color: '#201515', letterSpacing: '-0.02em' }}>
              Second Brain & Knowledge RAG
            </Typography>
            <Chip
              label="Global knowledge"
              size="small"
              variant="outlined"
              sx={{ bgcolor: '#f5efe6', color: '#201515', fontWeight: 650, fontSize: '0.75rem' }}
            />
          </Box>
          <Typography variant="caption" sx={{ color: '#666155', fontWeight: 500, mt: 0.5, display: 'block' }}>
            Markdown knowledge vault with dense vector search, auto-chunking, and traceable citations.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <IconButton
            onClick={() => void loadData()}
            sx={{
              color: '#666155',
              bgcolor: '#ffffff',
              borderRadius: '10px',
              border: '1px solid rgba(32, 21, 21, 0.1)',
              '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
            }}
            aria-label="Refresh Second Brain"
          >
            <CiRedo size={18} />
          </IconButton>
          <Button variant="contained" color="primary" startIcon={<CiCirclePlus size={18} />} onClick={openIngestDialog} sx={{ px: 2.5 }}>
            Add Note
          </Button>
        </Stack>
      </Box>

      {loading && (
        <Alert icon={<CircularProgress size={18} color="inherit" />} severity="info" role="status">
          Loading Second Brain data...
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          role="alert"
          action={
            <Button color="inherit" size="small" onClick={() => void loadData()}>
              Retry
            </Button>
          }
          sx={{ bgcolor: '#fee2e2', border: '1px solid rgba(220, 38, 38, 0.3)', color: '#991b1b', borderRadius: '12px' }}
        >
          {error}
        </Alert>
      )}
      {successMsg && (
        <Alert
          severity="success"
          sx={{ bgcolor: '#dcfce7', border: '1px solid rgba(22, 163, 74, 0.3)', color: '#14532d', borderRadius: '12px' }}
          onClose={() => setSuccessMsg(null)}
        >
          {successMsg}
        </Alert>
      )}

      {/* Metrics Row */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2.25
        }}
      >
        <MetricCard label="Documents" value={stats ? String(stats.totalDocuments) : '—'} icon={<CiRead size={22} />} />
        <MetricCard label="Indexed chunks" value={stats ? String(stats.totalChunks) : '—'} icon={<CiBoxes size={22} />} />
        <MetricCard label="Vector embeddings" value={stats ? String(stats.totalEmbeddings) : '—'} icon={<CiDatabase size={22} />} />
        <MetricCard label="Embedding model" value={stats?.embeddingModel?.split('/')[1] || '—'} icon={<CiMicrochip size={22} />} />
      </Box>

      {/* Navigation Tabs */}
      <Card sx={{ bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)', p: 0.5 }}>
        <Tabs
          value={activeTab}
          onChange={(_, val) => setActiveTab(val)}
          textColor="inherit"
          indicatorColor="primary"
          sx={{
            minHeight: 44,
            '& .MuiTab-root': {
              minHeight: 44,
              fontSize: '0.85rem',
              fontWeight: 600,
              textTransform: 'none',
              color: '#666155',
              '&.Mui-selected': { color: '#c2410c' },
              '&.Mui-focusVisible': { outline: '2px solid #a83200', outlineOffset: '-2px' }
            }
          }}
        >
          <Tab value="chat" icon={<CiChat1 size={18} />} iconPosition="start" label="Grounded RAG Chat" />
          <Tab value="vault" icon={<CiFileOn size={18} />} iconPosition="start" label={`Vault Knowledge (${documents.length})`} />
          <Tab
            value="raw_memory"
            icon={<CiMicrochip size={18} />}
            iconPosition="start"
            label={`Agent Memory Store (${rawMemoryItems.length})`}
          />
        </Tabs>
      </Card>

      {/* Tab 1: Grounded RAG Chat */}
      {activeTab === 'chat' && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' }, gap: 2.5 }}>
          {/* Chat Stream */}
          <Card
            sx={{
              bgcolor: '#ffffff',
              borderRadius: '16px',
              border: '1px solid rgba(32, 21, 21, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              height: 600
            }}
          >
            <Box
              sx={{
                p: 2.5,
                borderBottom: '1px solid rgba(32, 21, 21, 0.06)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CiPlay1 size={18} color="#c2410c" />
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                  Grounded Knowledge Dialogue
                </Typography>
              </Box>
              <Typography variant="caption" sx={{ color: '#71685f' }}>
                Semantic search
              </Typography>
            </Box>

            {/* Message History */}
            <Box sx={{ flex: 1, overflowY: 'auto', p: 3, display: 'flex', flexDirection: 'column', gap: 2.5, bgcolor: '#fbf8f2' }}>
              {chatMessages.map(msg => (
                <Box
                  key={msg.id}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.sender === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    alignSelf: msg.sender === 'user' ? 'flex-end' : 'flex-start'
                  }}
                >
                  <Box
                    sx={{
                      p: msg.sender === 'user' ? 2 : 2.5,
                      borderRadius: '16px',
                      bgcolor: msg.sender === 'user' ? '#c2410c' : '#ffffff',
                      color: msg.sender === 'user' ? '#ffffff' : '#201515',
                      border: msg.sender === 'user' ? 'none' : '1px solid rgba(32, 21, 21, 0.08)',
                      boxShadow: msg.sender === 'user' ? 'none' : '0 1px 3px rgba(0, 0, 0, 0.02)',
                      width: msg.sender === 'user' ? 'auto' : '100%'
                    }}
                  >
                    {msg.sender === 'user' ? (
                      <Typography variant="body2" sx={{ color: '#ffffff', fontWeight: 500, fontSize: '0.88rem', lineHeight: 1.6 }}>
                        {msg.text}
                      </Typography>
                    ) : (
                      <FormattedMessage content={msg.text} collapsible={false} />
                    )}
                  </Box>

                  {/* Citations Preview */}
                  {msg.citations && msg.citations.length > 0 && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                      {msg.citations.map((cit, i) => (
                        <Chip
                          key={i}
                          size="small"
                          label={`[[${cit.noteTitle}]] (${Math.round(cit.relevanceScore * 100)}%)`}
                          onClick={() => setActiveCitation(cit)}
                          sx={{
                            fontSize: '0.68rem',
                            fontWeight: 600,
                            bgcolor: '#ffffff',
                            color: '#c2410c',
                            border: '1px solid rgba(255, 79, 0, 0.3)',
                            cursor: 'pointer',
                            '&:hover': { bgcolor: '#fff3eb' }
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              ))}
              {chatPending && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, color: '#666155', fontSize: '0.8rem' }}>
                  <CircularProgress size={16} color="primary" />
                  <span>Synthesizing answer from Second Brain vault…</span>
                </Box>
              )}
            </Box>

            {/* Input Form */}
            <Box
              component="form"
              onSubmit={handleChatSubmit}
              sx={{ p: 2, borderTop: '1px solid rgba(32, 21, 21, 0.06)', bgcolor: '#ffffff', display: 'flex', gap: 1.5 }}
            >
              <TextField
                fullWidth
                size="small"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Ask about architecture, loop engineering, QA gating, or your notes…"
                disabled={chatPending}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: '#fbf8f2',
                    borderRadius: '10px',
                    '& fieldset': { borderColor: 'rgba(32, 21, 21, 0.12)' },
                    '&:hover fieldset': { borderColor: '#201515' },
                    '&.Mui-focused fieldset': { borderColor: '#c2410c' }
                  }
                }}
              />
              <Button
                type="submit"
                variant="contained"
                color="primary"
                aria-label="Send message"
                disabled={chatPending || !chatInput.trim()}
                sx={{ px: 2.5 }}
              >
                <CiPaperplane size={18} />
              </Button>
            </Box>
          </Card>

          {/* Citation / Source Side Panel */}
          <Card
            sx={{
              bgcolor: '#ffffff',
              borderRadius: '16px',
              border: '1px solid rgba(32, 21, 21, 0.08)',
              p: 3,
              display: 'flex',
              flexDirection: 'column',
              gap: 2
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
              Citation Inspector
            </Typography>
            {activeCitation ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Chip
                  label={`Relevance: ${Math.round(activeCitation.relevanceScore * 100)}%`}
                  color="primary"
                  size="small"
                  sx={{ width: 'fit-content', fontWeight: 700 }}
                />
                <Typography variant="body2" sx={{ fontWeight: 700, color: '#201515' }}>
                  {activeCitation.noteTitle}
                </Typography>
                <Typography variant="caption" sx={{ color: '#71685f', fontFamily: 'monospace' }}>
                  {activeCitation.filePath}
                </Typography>
                <Paper
                  sx={{
                    p: 2,
                    bgcolor: '#fbf8f2',
                    borderRadius: '10px',
                    border: '1px solid rgba(32, 21, 21, 0.08)',
                    fontSize: '0.78rem',
                    color: '#201515',
                    lineHeight: 1.6
                  }}
                >
                  {activeCitation.excerpt}
                </Paper>
              </Box>
            ) : (
              <Typography variant="caption" sx={{ color: '#71685f' }}>
                Click on any [[Citation]] badge in the conversation to inspect grounded evidence and source excerpts.
              </Typography>
            )}
          </Card>
        </Box>
      )}

      {/* Tab 2: Vault Notes */}
      {activeTab === 'vault' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          {/* Sync Directory Bar */}
          <Card sx={{ p: 2.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField
                size="small"
                fullWidth
                value={ingestVaultPath}
                onChange={e => setIngestVaultPath(e.target.value)}
                placeholder="Obsidian Vault path (default: project vault/ folder)..."
                sx={{ flex: 1, minWidth: 260 }}
              />
              <Button
                variant="contained"
                color="primary"
                startIcon={<CiRedo size={18} />}
                onClick={() => void handleSyncVault()}
                disabled={isSyncing}
                sx={{ borderRadius: '10px', px: 2.5 }}
              >
                {isSyncing ? 'Syncing...' : 'Sync Vault (27 Notes)'}
              </Button>
            </Box>
          </Card>

          {/* Search & Tags */}
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <TextField
              size="small"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search vault documents..."
              slotProps={{
                input: {
                  startAdornment: <CiSearch size={18} style={{ marginRight: 8, color: '#71685f' }} />
                }
              }}
              sx={{ flex: 1, minWidth: 260 }}
            />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              <Chip
                label="All Tags"
                size="small"
                onClick={() => setSelectedTag(null)}
                sx={{
                  bgcolor: selectedTag === null ? '#201515' : '#ffffff',
                  color: selectedTag === null ? '#ffffff' : '#201515',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              />
              {allTags.map(tag => (
                <Chip
                  key={tag}
                  label={`#${tag}`}
                  size="small"
                  onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
                  sx={{
                    bgcolor: selectedTag === tag ? '#201515' : '#ffffff',
                    color: selectedTag === tag ? '#ffffff' : '#201515',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                />
              ))}
            </Stack>
          </Box>

          {/* Documents Grid */}
          {documents.length === 0 && !loading && (
            <Card sx={{ p: 4, textAlign: 'center', bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
              <CiVault size={42} color="#c2410c" style={{ marginBottom: 12 }} />
              <Typography variant="h6" sx={{ fontWeight: 800, color: '#201515', mb: 1 }}>
                Second Brain Belum Disinkronkan ke Memori Server
              </Typography>
              <Typography variant="body2" sx={{ color: '#666155', maxWidth: 480, mx: 'auto', mb: 3, fontSize: '0.84rem' }}>
                Terdapat 27 catatan Obsidian di folder <code>vault/</code>. Klik tombol di bawah untuk menyinkronkan seluruh catatan ke indeks vektor secara instan.
              </Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<CiRedo size={18} />}
                onClick={() => void handleSyncVault()}
                disabled={isSyncing}
                sx={{ px: 3, py: 1, borderRadius: '10px', fontWeight: 700 }}
              >
                {isSyncing ? 'Menyinkronkan...' : '🔄 Sinkronkan 27 Catatan Vault Sekarang'}
              </Button>
            </Card>
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }, gap: 2.25 }}>
            {filteredDocuments.map(doc => (
              <Card
                key={doc.id}
                sx={{
                  p: 3,
                  bgcolor: '#ffffff',
                  borderRadius: '16px',
                  border: '1px solid rgba(32, 21, 21, 0.08)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 2,
                  '&:hover': { borderColor: 'rgba(32, 21, 21, 0.22)' }
                }}
              >
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515' }}>
                    {doc.title}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#71685f', fontFamily: 'monospace', display: 'block', mt: 0.5 }}>
                    {doc.filePath}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      color: '#666155',
                      fontSize: '0.78rem',
                      mt: 1.5,
                      display: '-webkit-box',
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}
                  >
                    {doc.content}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    pt: 1,
                    borderTop: '1px solid rgba(32, 21, 21, 0.06)'
                  }}
                >
                  <Typography variant="caption" sx={{ color: '#71685f' }}>
                    {doc.chunksCount} chunks
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={`Delete ${doc.title}`}
                    onClick={() => void handleDeleteNote(doc.id, doc.title)}
                    sx={{ color: '#dc2626' }}
                  >
                    <CiTrash size={16} />
                  </IconButton>
                </Box>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Tab 3: Raw Memory Items */}
      {activeTab === 'raw_memory' && (
        <Card sx={{ p: 3.5, bgcolor: '#ffffff', borderRadius: '16px', border: '1px solid rgba(32, 21, 21, 0.08)' }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#201515', mb: 2 }}>
            Learned Fleet Memories
          </Typography>
          {rawMemoryItems.length === 0 ? (
            <Typography variant="caption" sx={{ color: '#71685f' }}>
              No learned memories recorded yet. Memories are automatically saved when agents complete tasks.
            </Typography>
          ) : (
            <Stack spacing={2} divider={<Divider sx={{ borderColor: 'rgba(32, 21, 21, 0.06)' }} />}>
              {rawMemoryItems.map(item => (
                <Box key={item.id} sx={{ py: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                    <Chip
                      label={item.type}
                      size="small"
                      variant="outlined"
                      sx={{ bgcolor: '#f5efe6', color: '#201515', fontWeight: 650, fontSize: '0.75rem', textTransform: 'capitalize' }}
                    />
                    <Typography variant="caption" sx={{ color: '#71685f' }}>
                      Source: {item.source} · Confidence: {Math.round(item.confidence * 100)}%
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ color: '#201515', fontWeight: 500 }}>
                    {item.content}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Card>
      )}

      {/* Add Note Modal */}
      <Dialog
        open={showIngestModal}
        onClose={closeIngestDialog}
        maxWidth="sm"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              bgcolor: '#ffffff',
              border: '1px solid rgba(32, 21, 21, 0.12)',
              borderRadius: { xs: '12px', sm: '16px' },
              m: { xs: 2, sm: 4 },
              boxShadow: '0 12px 32px rgba(32, 21, 21, 0.08)'
            }
          }
        }}
      >
        <form onSubmit={handleIngestNote} aria-busy={ingestPending}>
          <DialogTitle sx={{ color: '#201515', fontWeight: 700, px: 3, pt: 3, pb: 1 }}>Add note to Second Brain</DialogTitle>
          <DialogContent sx={{ px: 3, pt: '16px !important', display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {ingestError && (
              <Alert severity="error" role="alert" sx={{ borderRadius: '10px' }}>
                {ingestError}
              </Alert>
            )}
            <TextField
              label="Note title"
              fullWidth
              required
              autoFocus
              disabled={ingestPending}
              value={newNoteTitle}
              onChange={e => setNewNoteTitle(e.target.value)}
              placeholder="e.g. Q1 Architecture Strategy"
            />
            <TextField
              label="File path"
              fullWidth
              disabled={ingestPending}
              value={newNotePath}
              onChange={e => setNewNotePath(e.target.value)}
              placeholder="vault/my-note.md"
              helperText="Optional. A vault path is generated if left blank."
            />
            <TextField
              label="Tags"
              fullWidth
              disabled={ingestPending}
              value={newNoteTags}
              onChange={e => setNewNoteTags(e.target.value)}
              placeholder="marketing, strategy, q1"
              helperText="Separate multiple tags with commas."
            />
            <TextField
              label="Note content"
              fullWidth
              multiline
              rows={6}
              required
              disabled={ingestPending}
              value={newNoteContent}
              onChange={e => setNewNoteContent(e.target.value)}
              placeholder="Write your note in Markdown..."
              helperText="Markdown is supported. The note is indexed for search after saving."
            />
          </DialogContent>
          <DialogActions
            sx={{
              p: 3,
              pt: 2,
              borderTop: '1px solid rgba(32, 21, 21, 0.08)',
              flexDirection: { xs: 'column-reverse', sm: 'row' },
              alignItems: 'stretch',
              gap: 1.5,
              '& .MuiButton-root': { minHeight: 44 },
              '& > :not(style) ~ :not(style)': { ml: 0 }
            }}
          >
            <Button onClick={closeIngestDialog} disabled={ingestPending} sx={{ color: '#666155', width: { xs: '100%', sm: 'auto' } }}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" color="primary" disabled={ingestPending} sx={{ width: { xs: '100%', sm: 'auto' } }}>
              {ingestPending ? (
                <>
                  <CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />
                  Adding note...
                </>
              ) : (
                'Add note'
              )}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card
      sx={{
        p: 2.5,
        bgcolor: '#ffffff',
        borderRadius: '14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        border: '1px solid rgba(32, 21, 21, 0.08)',
        boxShadow: 'none'
      }}
    >
      <Box>
        <Typography variant="caption" sx={{ color: '#666155', fontWeight: 650, fontSize: '0.78rem' }}>
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
          bgcolor: '#f5efe6',
          color: '#201515',
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
