import { getState, subscribe } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET(req: Request) {
  // Fallback for proxies that hold back event streams (Cloudflare quick tunnels): the page polls the version.
  if (new URL(req.url).searchParams.has('poll')) return Response.json({ version: getState().version }, { headers: { 'Cache-Control': 'no-store' } });
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: NodeJS.Timeout | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (v: number) => controller.enqueue(enc.encode(`data: ${v}\n\n`));
      send(getState().version);
      unsub = subscribe(send);
      ping = setInterval(() => controller.enqueue(enc.encode(': ping\n\n')), 15000);
      req.signal.addEventListener('abort', () => {
        unsub();
        if (ping) clearInterval(ping);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      unsub();
      if (ping) clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
