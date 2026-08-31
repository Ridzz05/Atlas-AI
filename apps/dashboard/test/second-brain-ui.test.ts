import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import theme from '../src/theme/theme';

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map(channel => Number.parseInt(channel, 16) / 255)
    .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(foreground: string, background: string): number {
  const luminances = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (luminances[0]! + 0.05) / (luminances[1]! + 0.05);
}

const brainPage = readFileSync(resolve(process.cwd(), 'src/app/brain/page.tsx'), 'utf8');

describe('Second Brain UI quality gates', () => {
  it('keeps primary actions and secondary text above WCAG AA contrast', () => {
    expect(contrastRatio(theme.palette.primary.contrastText, theme.palette.primary.main)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#71685f', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#71685f', theme.palette.background.default)).toBeGreaterThanOrEqual(4.5);
    expect(brainPage).not.toContain('#ff4f00');
    expect(brainPage).not.toContain('#8c827a');
  });

  it('renders honest initial loading and API failure states', () => {
    expect(brainPage).not.toContain('.catch(() => ({');
    expect(brainPage).toContain('loading &&');
    expect(brainPage).toContain('Loading Second Brain data');
  });

  it('keeps note submission state and errors inside the dialog', () => {
    expect(brainPage).toContain('const [ingestPending, setIngestPending]');
    expect(brainPage).toContain('const [ingestError, setIngestError]');
    expect(brainPage).toContain('role="alert"');
    expect(brainPage).toContain('disabled={ingestPending}');
    expect(brainPage).toContain('Adding note...');
  });

  it('names icon-only actions for assistive technology', () => {
    expect(brainPage).toContain('aria-label="Send message"');
    expect(brainPage).toContain('aria-label={`Delete ${doc.title}`}');
  });

  it('stacks dialog actions on narrow screens and uses one user-facing term', () => {
    const dialog = brainPage.slice(brainPage.indexOf('<Dialog'), brainPage.indexOf('</Dialog>'));
    expect(dialog).toContain("flexDirection: { xs: 'column-reverse', sm: 'row' }");
    expect(dialog).toContain("width: { xs: '100%', sm: 'auto' }");
    expect(dialog).toContain('minHeight: 44');
    expect(dialog).toContain('Add note to Second Brain');
    expect(dialog).toContain('Add note');
    expect(dialog).not.toContain('Ingest & Embed Note');
    expect(dialog).not.toContain('Add Document to Second Brain');
  });

  it('reserves monospace typography for code-like values', () => {
    const metricCard = brainPage.slice(brainPage.indexOf('function MetricCard'));
    expect(metricCard).not.toContain("fontFamily: 'monospace'");
    expect(brainPage).toContain('label="Documents"');
    expect(brainPage).toContain('label="Embedding model"');
  });
});
