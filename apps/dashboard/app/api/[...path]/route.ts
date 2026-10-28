import type { NextRequest } from 'next/server';

/**
 * Reverse-Proxy zur Fastify-API (Laufzeitkonfiguration über API_URL). Dashboard und API teilen sich damit
 * eine Origin: Sitzungs-Cookies, CSRF-Schutz, OAuth-Redirects und Server-Sent Events funktionieren ohne CORS.
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const base = process.env.API_URL ?? 'http://localhost:4000';
  const target = new URL(`/api/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`, base);
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  const forwardedFor = request.headers.get('x-forwarded-for');
  headers.set('x-forwarded-host', request.headers.get('host') ?? '');
  headers.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      redirect: 'manual',
      signal: request.signal,
      // Für Request-Bodys als Stream erforderlich.
      duplex: 'half',
    } as RequestInit);
  } catch {
    return Response.json(
      { error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Die API ist nicht erreichbar.' } },
      { status: 502 },
    );
  }
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (
      !HOP_BY_HOP.has(key.toLowerCase()) &&
      key.toLowerCase() !== 'set-cookie' &&
      key.toLowerCase() !== 'content-encoding'
    )
      responseHeaders.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
