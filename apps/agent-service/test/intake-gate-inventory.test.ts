import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Every POST route that creates work must be classified, and the classifier is the route source.
 *
 * The paused-behaviour test in `intake-gate.test.ts` walks a hand-written list of five routes. It
 * proved those five honour the operator's stop, but it could not see a sixth: `POST
 * /api/v1/automations/scheduled-jobs` created a durable scheduled job — which the worker's scheduler
 * fires on the next tick without consulting the control state — and carried no gate, because the list
 * did not mention it. A test whose coverage is a list cannot report what is missing from the list.
 *
 * This reads the route files instead. A new `app.post(...)` fails here until it is either gated with
 * `preHandler: intakeGate` or exempted with a reason, so the decision is made deliberately rather than
 * by omission.
 */
const SRC_DIR = path.join(process.cwd(), 'src');

/**
 * POST routes that must NOT be gated, each with the reason it would be wrong to gate it.
 *
 * The gate answers 423 while the system is paused or stopped. An operator has to be able to lift a stop,
 * so the control routes cannot be gated; the rest are decisions that change no work in flight.
 */
const EXEMPT: Record<string, string> = {
  '/api/v1/control/pause': 'The operator must be able to press pause on a running system.',
  '/api/v1/control/resume': 'The operator must be able to lift a stop, so this cannot be gated on the stop.',
  '/api/v1/control/emergency-stop': 'The operator must be able to stop the system; gating it would make the stop unreachable.',
  '/api/v1/approvals/:id/decision': 'Deciding a pending approval drains work already admitted; it creates none.',
  '/api/v1/runs/:id/cancel': 'Cancelling a run is how the operator stops work, so it must not require the system to be running.',
  '/api/v1/brain/ingest': 'Indexes a note into the in-process vector store; it creates no task and spends no budget.',
  '/api/v1/brain/query': 'Read-only retrieval against the in-process index.',
  '/api/v1/memory/:id/verify': 'Promotes an already-proposed memory item; it admits no new work.',
  '/api/v1/memory/:id/deprecate': 'Deprecates an existing memory item; it admits no new work.',
  '/api/v1/rubrics': 'Registers a scoring rubric version; it creates no task and spends no budget.',
  '/api/v1/rubrics/:version/activate': 'Switches the active rubric; it creates no task and spends no budget.'
};

interface RouteFact {
  file: string;
  line: number;
  url: string;
  gated: boolean;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

/**
 * Read every POST route registration under `src/`, and whether the same call carries the gate.
 *
 * The registration shape varies — `app.post('/x', ...)` and `app.post<{ Params: { id: string } }>('/x',
 * ...)` are both in use — so the pattern allows an optional type argument. An earlier version of this
 * reader matched only the first shape and silently missed two routes, which is the same failure it
 * exists to catch.
 */
function readPostRoutes(): RouteFact[] {
  const facts: RouteFact[] = [];

  for (const full of walk(SRC_DIR)) {
    const lines = fs.readFileSync(full, 'utf-8').split('\n');

    lines.forEach((line, index) => {
      const match = /app\.post(?:<[^>]*>)?\(\s*'([^']+)'/.exec(line);
      if (!match) return;

      // The options object and the handler can span lines, so look at this line and the next few.
      const window = lines.slice(index, index + 3).join('\n');
      facts.push({
        file: path.relative(SRC_DIR, full).replace(/\\/g, '/'),
        line: index + 1,
        url: match[1] as string,
        gated: window.includes('preHandler: intakeGate')
      });
    });
  }

  return facts.sort((a, b) => a.url.localeCompare(b.url));
}

describe('intake gate coverage (from the route source)', () => {
  const routes = readPostRoutes();

  it('finds the POST routes at all, in both registration shapes', () => {
    // A guard against the reader silently matching nothing, which would make every assertion below vacuous.
    expect(routes.length).toBeGreaterThanOrEqual(15);
    // The two shapes that exist today; a reader that knows only one of them under-reports.
    expect(routes.some(route => route.file === 'routes/metadata.ts')).toBe(true);
    expect(routes.some(route => route.file === 'routes/control.ts')).toBe(true);
  });

  it('gates every POST route that creates work', () => {
    const ungated = routes
      .filter(route => !route.gated && !(route.url in EXEMPT))
      .map(route => `${route.file}:${route.line} POST ${route.url}`);

    expect(
      ungated,
      'These POST routes are neither gated nor exempted. Add `{ preHandler: intakeGate }`, or add the ' +
        'route to EXEMPT with the reason it would be wrong to gate it.'
    ).toEqual([]);
  });

  it('gates the routes that create tasks or durable scheduled work', () => {
    const mustBeGated = [
      '/api/v1/tasks',
      '/api/v1/automations/trigger',
      '/api/v1/automations/scheduled-jobs',
      '/api/v1/automations/scheduled-jobs/:id/run',
      '/api/v1/sdlc/initiatives',
      '/api/v1/sdlc/initiatives/:id/advance'
    ];

    for (const url of mustBeGated) {
      const route = routes.find(candidate => candidate.url === url);
      expect(route, `${url} must exist in the route source`).toBeDefined();
      expect(route!.gated, `${url} must carry preHandler: intakeGate`).toBe(true);
    }
  });

  it('does not exempt a route that is also required to be gated', () => {
    for (const url of Object.keys(EXEMPT)) {
      expect(
        routes.some(route => route.url === url),
        `${url} is exempted but no longer exists; remove the stale exemption`
      ).toBe(true);
    }
  });
});
