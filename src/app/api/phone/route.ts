import { roleOf } from '@/lib/access';
import { saveMedia } from '@/lib/ai';
import { DEMO_PHOTOS, DEMO_VOICE } from '@/lib/demo';
import { demoPhoto, handleInbound, sendDemoVoice } from '@/lib/flows';
import { getState } from '@/lib/store';
import { mediaKind } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 16 * 1024 * 1024;

// The in-browser WhatsApp simulator posts here. Work continues in the background so the UI stays live;
// the server is one long-lived Node process, so the promise is not cut off when the response is sent.
export async function POST(req: Request) {
  const form = await req.formData();
  const farmerId = String(form.get('farmerId'));
  if (!getState().farmers.some((f) => f.id === farmerId)) return Response.json({ error: 'unknown farmer' }, { status: 400 });
  // A signed-up farmer may only write as themselves, and the presenter's scripted demo notes are not theirs.
  const role = roleOf(req);
  if (role.kind !== 'admin' && (role.kind !== 'farmer' || role.farmerId !== farmerId || form.get('demoVoice'))) return Response.json({ error: 'not allowed' }, { status: 403 });
  const text = form.get('text') ? String(form.get('text')).slice(0, 1000) : undefined;
  const demoVoice = form.get('demoVoice') ? String(form.get('demoVoice')) : undefined;
  const demoPhotoId = form.get('demoPhoto') ? String(form.get('demoPhoto')) : undefined;
  if (demoVoice && !DEMO_VOICE[demoVoice]) return Response.json({ error: 'unknown demo voice' }, { status: 400 });
  if (demoPhotoId && !DEMO_PHOTOS.some((p) => p.id === demoPhotoId)) return Response.json({ error: 'unknown demo photo' }, { status: 400 });
  const audio = form.get('audio') as File | null;
  const photo = form.get('photo') as File | null;
  for (const f of [audio, photo]) {
    if (f && f.size > MAX_BYTES) return Response.json({ error: 'file too large' }, { status: 413 });
  }
  if (photo && photo.size && mediaKind(photo.type || 'image/jpeg') !== 'image') return Response.json({ error: 'unsupported image type' }, { status: 415 });

  const run = async () => {
    if (demoVoice) return sendDemoVoice(demoVoice, demoPhotoId);
    const inb: Parameters<typeof handleInbound>[0] = { farmerId, text, via: 'simulator' };
    if (demoPhotoId) inb.photo = demoPhoto(demoPhotoId);
    if (photo && photo.size) {
      const buf = Buffer.from(await photo.arrayBuffer());
      inb.photo = { buf, mime: photo.type || 'image/jpeg', url: saveMedia(buf, photo.type || 'image/jpeg') };
    }
    if (audio && audio.size) {
      const buf = Buffer.from(await audio.arrayBuffer());
      inb.audio = { buf, mime: audio.type || 'audio/webm', url: saveMedia(buf, audio.type || 'audio/webm') };
    }
    return handleInbound(inb);
  };
  run().catch((err) => console.error('phone inbound failed', err));
  return Response.json({ ok: true });
}
