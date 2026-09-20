/**
 * Contract: every ATLAS API path the dashboard requests must be a route the API registers.
 *
 * The dashboard is a separate app talking to the API over HTTP, so nothing type-checks the two
 * against each other. Two controls shipped that POSTed to routes that did not exist —
 * `POST /brain/notes` and `POST /messages` — and each one failed only when an operator filled the
 * form in. This test is the missing link: it reads both sides as text and compares them.
 *
 * Run by `pnpm test` (see the `test` script in package.json) alongside the workspace suites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const DASHBOARD_SRC = join(ROOT, 'apps', 'dashboard', 'src');
const API_SRC = join(ROOT, 'apps', 'agent-service', 'src');

/**
 * Call sites whose path segment is a runtime value, so it cannot be matched textually.
 *
 * Each entry is asserted to still exist below, so a stale entry fails the test rather than quietly
 * widening it.
 */
const DYNAMIC_PATH_ALLOWLIST = [
  {
    path: '/control/${action}',
    resolvesTo: [
      { method: 'POST', path: '/api/v1/control/pause' },
      { method: 'POST', path: '/api/v1/control/emergency-stop' },
      { method: 'POST', path: '/api/v1/control/resume' }
    ],
    reason: '`action` is one of pause | emergency-stop | resume; all three routes are registered'
  }
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** Every `atlasFetch(path, { method })` call in the dashboard, with the method resolved. */
function dashboardCalls() {
  const calls = [];
  for (const file of walk(DASHBOARD_SRC)) {
    const source = readFileSync(file, 'utf8');
    const pattern = /atlasFetch(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]([\s\S]{0,200}?)\)\s*[;)]/g;
    for (const match of source.matchAll(pattern)) {
      const path = match[1];
      const methodMatch = match[2].match(/method:\s*'([A-Z]+)'/);
      calls.push({
        method: methodMatch ? methodMatch[1] : 'GET',
        path,
        file: relative(ROOT, file).replace(/\\/g, '/')
      });
    }
  }
  return calls;
}

/** Every route the API registers, as (METHOD, path) pairs. */
function registeredRoutes() {
  const routes = new Set();
  for (const file of walk(API_SRC)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      routes.add(`${match[1].toUpperCase()} ${match[2]}`);
    }
  }
  return routes;
}

/** Turn a call path into a concrete API path, substituting runtime segments. */
function toApiPath(path) {
  const withoutQuery = path.split('?')[0];
  const withPlaceholders = withoutQuery.replace(/\$\{[^}]*\}/g, ':segment');
  return withPlaceholders.startsWith('/api/') ? withPlaceholders : `/api/v1${withPlaceholders}`;
}

/** Compare against a registered route pattern, treating `:param` as one path segment. */
function routeMatches(method, apiPath, routes) {
  for (const route of routes) {
    const [routeMethod, routePath] = route.split(' ');
    if (routeMethod !== method) continue;
    const escaped = routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:param|:[A-Za-z_]+/g, '[^/]+');
    if (new RegExp(`^${escaped}$`).test(apiPath)) return route;
  }
  return null;
}

test('every dashboard API call resolves to a registered route', () => {
  const routes = registeredRoutes();
  assert.ok(routes.size > 20, `expected to find the API routes, found ${routes.size}`);

  const calls = dashboardCalls();
  assert.ok(calls.length > 10, `expected to find the dashboard calls, found ${calls.length}`);

  const allowlisted = new Set(DYNAMIC_PATH_ALLOWLIST.map(entry => entry.path));
  const unresolved = [];

  for (const call of calls) {
    if (allowlisted.has(call.path)) continue;
    if (!routeMatches(call.method, toApiPath(call.path), routes)) {
      unresolved.push(`${call.method} ${call.path}  (${call.file})`);
    }
  }

  assert.deepEqual(unresolved, [], `these dashboard calls have no matching API route:\n  ${unresolved.join('\n  ')}`);
});

test('the dynamic-path allowlist is not stale', () => {
  const paths = new Set(dashboardCalls().map(call => call.path));
  const routes = registeredRoutes();

  for (const entry of DYNAMIC_PATH_ALLOWLIST) {
    assert.ok(paths.has(entry.path), `allowlisted call '${entry.path}' no longer exists in the dashboard`);
    for (const resolved of entry.resolvesTo) {
      const target = `${resolved.method} ${resolved.path}`;
      assert.ok(routes.has(target), `allowlisted target '${target}' is not a registered route`);
    }
  }
});
