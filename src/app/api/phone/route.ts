import { saveMedia } from '@/lib/ai';
import { demoPhoto, handleInbound, sendDemoVoice } from '@/lib/flows';

export const dynamic = 'force-dynamic';

// The in-browser WhatsApp simulator posts here. Work continues in the background so the UI stays live.
export async function POST(req: Request) {
  const form = await req.formData();
  const farmerId = String(form.get('farmerId'));
  const text = form.get('text') ? String(form.get('text')) : undefined;
  const demoVoice = form.get('demoVoice') ? String(form.get('demoVoice')) : undefined;
  const demoPhotoId = form.get('demoPhoto') ? String(form.get('demoPhoto')) : undefined;
  const audio = form.get('audio') as File | null;
  const photo = form.get('photo') as File | null;

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
