import { readMedia } from '@/lib/ai';
import { rangeResponse } from '@/lib/range';

export function GET(req: Request, { params }: { params: { id: string } }) {
  const m = readMedia(params.id);
  if (!m) return new Response('Not found', { status: 404 });
  return rangeResponse(req, m.buf, m.mime);
}
