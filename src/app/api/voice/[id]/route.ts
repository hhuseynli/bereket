import { rangeResponse } from '@/lib/range';
import { readClip } from '@/lib/tts';

export const dynamic = 'force-dynamic';

// The assistant's voice notes. Public on purpose (Twilio downloads them to deliver WhatsApp voice notes),
// but the ids are keyed with a secret, so a clip URL cannot be guessed.
export function GET(req: Request, { params }: { params: { id: string } }) {
  const clip = readClip(params.id);
  if (!clip) return new Response('Not found', { status: 404 });
  return rangeResponse(req, clip.buf, clip.mime);
}
