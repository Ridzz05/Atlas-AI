import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };
const defaultProxyTimeoutMs = 60_000;
const configuredTimeout = Number(process.env.ATLAS_PROXY_TIMEOUT_MS);
const proxyTimeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : defaultProxyTimeoutMs;

async function proxy(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { path } = await context.params;
  const defaultBaseUrl = process.env.NODE_ENV === 'production' ? 'http://agent-service:4000/api/v1' : 'http://127.0.0.1:4000/api/v1';
  const baseUrl = (process.env.ATLAS_API_BASE_URL || defaultBaseUrl).replace(/\/$/, '');
  const targetUrl = `${baseUrl}/${path.map(segment => encodeURIComponent(segment)).join('/')}${request.nextUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('authorization', `Bearer ${process.env.ATLAS_API_AUTH_TOKEN || ''}`);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const isEventStream = path.length === 2 && path[0] === 'events' && path[1] === 'stream';

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      cache: 'no-store',
      signal: isEventStream ? request.signal : AbortSignal.any([request.signal, AbortSignal.timeout(proxyTimeoutMs)])
    });
  } catch {
    const contentType = isEventStream ? 'text/event-stream; charset=utf-8' : 'application/json; charset=utf-8';
    const responseBody = isEventStream
      ? 'event: error\ndata: {"error":"ATLAS API unavailable."}\n\n'
      : JSON.stringify({ error: 'ATLAS API unavailable.' });
    return new NextResponse(responseBody, {
      status: 503,
      headers: {
        'cache-control': 'no-store',
        'content-type': contentType
      }
    });
  }

  const responseHeaders = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) responseHeaders.set('content-type', contentType);
  return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
