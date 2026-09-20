import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import { CiCircleChevDown, CiCircleChevUp, CiReceipt, CiCircleCheck } from 'react-icons/ci';

interface FormattedMessageProps {
  content: string;
  defaultExpanded?: boolean;
  maxInitialHeight?: number;
  collapsible?: boolean;
}

// Inline formatting helper: handles **bold**, *italic*, `code`, and [[wiki-link]]
function renderInline(text: string): React.ReactNode[] {
  // Regex to match **bold**, `code`, *italic*, and [[wiki-link]]
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[\[[^\]]+\]\])/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith('[[') && part.endsWith(']]') && part.length >= 4) {
      const inner = part.slice(2, -2);
      const pipeIdx = inner.indexOf('|');
      const hashIdx = inner.indexOf('#');
      const display = pipeIdx > -1 ? inner.slice(pipeIdx + 1) : hashIdx > -1 ? inner.slice(0, hashIdx) : inner;
      return (
        <Box
          component="span"
          key={index}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            fontSize: '0.85em',
            bgcolor: 'rgba(194, 65, 12, 0.08)',
            color: '#c2410c',
            border: '1px solid rgba(194, 65, 12, 0.2)',
            px: 0.75,
            py: 0.1,
            borderRadius: '6px',
            fontWeight: 600,
            mx: 0.25,
            verticalAlign: 'baseline'
          }}
        >
          📎 {display}
        </Box>
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <strong key={index} style={{ fontWeight: 700, color: '#201515' }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <Box
          component="span"
          key={index}
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.82em',
            bgcolor: 'rgba(32, 21, 21, 0.06)',
            color: '#c2410c',
            px: 0.75,
            py: 0.25,
            borderRadius: '4px',
            fontWeight: 600
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <em key={index} style={{ fontStyle: 'italic', color: '#666155' }}>
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
}

// Table block parser helper
function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|');
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^\|(?:\s*:?-+:?\s*\|)+$/.test(trimmed);
}

function parseTableCells(line: string): string[] {
  const trimmed = line.trim();
  return trimmed
    .slice(1, -1)
    .split('|')
    .map(cell => cell.trim());
}

export function FormattedMessage({ content, defaultExpanded = false, maxInitialHeight = 360, collapsible = true }: FormattedMessageProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  if (!content) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const lines = content.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // 1. Code Blocks
    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!);
        i++;
      }
      i++; // Skip closing ```
      const codeContent = codeLines.join('\n');
      blocks.push(
        <Box
          key={`code-${i}`}
          sx={{
            my: 1.5,
            p: 2,
            bgcolor: '#201515',
            color: '#f5efe6',
            borderRadius: '10px',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            lineHeight: 1.6,
            overflowX: 'auto',
            whiteSpace: 'pre',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          {codeContent}
        </Box>
      );
      continue;
    }

    // 2. Markdown Tables
    if (isTableLine(trimmed)) {
      const tableLines: string[] = [trimmed];
      i++;
      while (i < lines.length && isTableLine(lines[i]!.trim())) {
        tableLines.push(lines[i]!.trim());
        i++;
      }

      if (tableLines.length >= 2) {
        const headerRow = parseTableCells(tableLines[0]!);
        const startIndex = isTableSeparator(tableLines[1]!) ? 2 : 1;
        const bodyRows = tableLines.slice(startIndex).map(parseTableCells);

        blocks.push(
          <TableContainer
            key={`table-${i}`}
            component={Paper}
            elevation={0}
            sx={{
              my: 1.5,
              border: '1px solid rgba(32, 21, 21, 0.12)',
              borderRadius: '8px',
              overflow: 'hidden'
            }}
          >
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: '#f5efe6' }}>
                  {headerRow.map((h, idx) => (
                    <TableCell
                      key={idx}
                      sx={{
                        fontWeight: 700,
                        color: '#201515',
                        fontSize: '0.78rem',
                        py: 1,
                        px: 1.5,
                        borderBottom: '1px solid rgba(32, 21, 21, 0.12)'
                      }}
                    >
                      {renderInline(h)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {bodyRows.map((row, rIdx) => (
                  <TableRow
                    key={rIdx}
                    sx={{
                      '&:nth-of-type(even)': { bgcolor: '#fbf8f2' },
                      '&:hover': { bgcolor: 'rgba(194, 65, 12, 0.04)' }
                    }}
                  >
                    {row.map((cell, cIdx) => (
                      <TableCell
                        key={cIdx}
                        sx={{
                          fontSize: '0.78rem',
                          color: '#666155',
                          py: 0.75,
                          px: 1.5,
                          borderBottom: rIdx === bodyRows.length - 1 ? 'none' : '1px solid rgba(32, 21, 21, 0.06)'
                        }}
                      >
                        {renderInline(cell)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        );
        continue;
      }
    }

    // 3. Horizontal Separator
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      blocks.push(<Divider key={`div-${i}`} sx={{ my: 2, borderColor: 'rgba(32, 21, 21, 0.1)' }} />);
      i++;
      continue;
    }

    // 4. Headings
    if (trimmed.startsWith('#')) {
      const match = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (match) {
        const level = match[1]!.length;
        const text = match[2]!;
        const fontSize = level === 1 ? '1.15rem' : level === 2 ? '1.02rem' : level === 3 ? '0.92rem' : '0.85rem';
        const mt = level === 1 ? 2.5 : level === 2 ? 2 : 1.5;

        blocks.push(
          <Typography
            key={`h-${i}`}
            variant="subtitle1"
            sx={{
              fontWeight: 800,
              color: '#201515',
              fontSize,
              mt,
              mb: 0.75,
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}
          >
            {level === 1 && (
              <Box component="span" sx={{ width: 4, height: 18, bgcolor: '#c2410c', borderRadius: 2, display: 'inline-block' }} />
            )}
            {renderInline(text)}
          </Typography>
        );
        i++;
        continue;
      }
    }

    // 5. Blockquotes
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i++;
      }

      blocks.push(
        <Box
          key={`quote-${i}`}
          sx={{
            my: 1.5,
            p: 1.75,
            pl: 2,
            bgcolor: '#fbf8f2',
            borderLeft: '4px solid #c2410c',
            borderRadius: '0 8px 8px 0',
            color: '#201515',
            fontSize: '0.84rem',
            lineHeight: 1.6
          }}
        >
          {quoteLines.map((ql, qIdx) => (
            <Box key={qIdx} sx={{ mb: qIdx === quoteLines.length - 1 ? 0 : 0.5 }}>
              {renderInline(ql)}
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    // 6. Bullet / Numbered Lists
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const listItems: string[] = [];
      const isNumbered = /^\d+\.\s+/.test(trimmed);

      while (i < lines.length && (/^[-*]\s+/.test(lines[i]!.trim()) || /^\d+\.\s+/.test(lines[i]!.trim()))) {
        listItems.push(lines[i]!.trim().replace(/^[-*]\s+|\d+\.\s+/, ''));
        i++;
      }

      blocks.push(
        <Box component={isNumbered ? 'ol' : 'ul'} key={`list-${i}`} sx={{ pl: 3, my: 1, color: '#666155', fontSize: '0.84rem' }}>
          {listItems.map((itemText, lIdx) => (
            <Box component="li" key={lIdx} sx={{ mb: 0.5, lineHeight: 1.6 }}>
              {renderInline(itemText)}
            </Box>
          ))}
        </Box>
      );
      continue;
    }

    // 7. Regular Text Paragraph
    if (trimmed.length > 0) {
      blocks.push(
        <Typography
          key={`p-${i}`}
          variant="body2"
          sx={{
            color: '#666155',
            fontSize: '0.84rem',
            lineHeight: 1.65,
            mb: 1,
            wordBreak: 'break-word'
          }}
        >
          {renderInline(line)}
        </Typography>
      );
    } else {
      // Empty line creates subtle vertical spacing
      blocks.push(<Box key={`sp-${i}`} sx={{ height: 6 }} />);
    }

    i++;
  }

  const isLongContent = collapsible && (content.length > 800 || lines.length > 15);

  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        sx={{
          maxHeight: !expanded && isLongContent ? `${maxInitialHeight}px` : 'none',
          overflow: 'hidden',
          position: 'relative',
          transition: 'max-height 0.25s ease-in-out'
        }}
      >
        {blocks}

        {/* Gradient fade overlay when collapsed */}
        {!expanded && isLongContent && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: 70,
              background: 'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,1))',
              pointerEvents: 'none'
            }}
          />
        )}
      </Box>

      {/* Action Footer: Expand/Collapse & Copy Button */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mt: 1.5,
          pt: 1,
          borderTop: '1px solid rgba(32,21,21,0.06)'
        }}
      >
        {isLongContent ? (
          <Button
            size="small"
            onClick={() => setExpanded(!expanded)}
            endIcon={expanded ? <CiCircleChevUp size={16} /> : <CiCircleChevDown size={16} />}
            sx={{
              color: '#c2410c',
              fontSize: '0.78rem',
              fontWeight: 700,
              textTransform: 'none',
              p: 0,
              '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' }
            }}
          >
            {expanded ? 'Tutup draft ringkas' : 'Lihat seluruh dokumen draft'}
          </Button>
        ) : (
          <Box />
        )}

        <Button
          size="small"
          onClick={handleCopy}
          startIcon={copied ? <CiCircleCheck size={16} color="#16a34a" /> : <CiReceipt size={16} />}
          sx={{
            color: copied ? '#16a34a' : '#666155',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'none',
            px: 1.25,
            py: 0.5,
            borderRadius: '6px',
            bgcolor: '#fbf8f2',
            border: '1px solid rgba(32, 21, 21, 0.08)',
            '&:hover': { bgcolor: '#f5efe6', color: '#201515' }
          }}
        >
          {copied ? 'Tersalin' : 'Salin Draft'}
        </Button>
      </Box>
    </Box>
  );
}
