import { readMedia } from '@/lib/ai';

export function GET(_req: Request, { params }: { params: { id: string } }) {
  const m = readMedia(params.id);
  if (!m) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(m.buf), { headers: { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=86400' } });
}
