import { readClip } from '@/lib/tts';

export const dynamic = 'force-dynamic';

// The assistant's voice notes. Public on purpose (Twilio downloads them to deliver WhatsApp voice notes),
// but the ids are keyed with a secret, so a clip URL cannot be guessed.
export function GET(_req: Request, { params }: { params: { id: string } }) {
  const buf = readClip(params.id);
  if (!buf) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { 'Content-Type': 'audio/ogg', 'Cache-Control': 'private, max-age=86400' } });
}
