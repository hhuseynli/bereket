import { saveMedia } from '@/lib/ai';
import { handleInbound } from '@/lib/flows';
import { emit, getState, uid } from '@/lib/store';
import { C } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// Twilio WhatsApp webhook ("When a message comes in"). We answer with empty TwiML at once and reply
// through the REST API after the AI has worked, so slow calls never hit Twilio's webhook timeout.
export async function POST(req: Request) {
  const form = await req.formData();
  const from = String(form.get('From') ?? '').replace('whatsapp:', '');
  const body = String(form.get('Body') ?? '').trim();
  const numMedia = Number(form.get('NumMedia') ?? 0);
  const s = getState();
  let f = s.farmers.find((x) => x.phone === from);
  if (!f) {
    // Unknown number: register them as a new farmer near Quba so they can try the flow.
    f = {
      id: uid('f'), name: String(form.get('ProfileName') ?? 'New farmer'), village: 'Quba', region: 'Quba',
      lat: 41.36, lng: 48.51, rating: 0, deals: 0, color: C.teal, phone: from,
    };
    s.farmers.push(f);
    emit();
  }
  const farmerId = f.id;

  const work = async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const token = process.env.TWILIO_AUTH_TOKEN ?? '';
    const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64');
    const inb: Parameters<typeof handleInbound>[0] = { farmerId, via: 'twilio' };
    for (let i = 0; i < numMedia; i++) {
      const url = String(form.get(`MediaUrl${i}`));
      const mime = String(form.get(`MediaContentType${i}`) ?? '');
      const res = await fetch(url, { headers: { Authorization: auth }, redirect: 'follow' });
      if (!res.ok) { console.error('media download failed', res.status); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      const local = saveMedia(buf, mime);
      if (mime.startsWith('audio/')) inb.audio = { buf, mime, url: local };
      else if (mime.startsWith('image/')) inb.photo = { buf, mime, url: local };
    }
    if (body) inb.text = body;
    await handleInbound(inb);
  };
  work().catch((err) => console.error('twilio inbound failed', err));
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', { headers: { 'Content-Type': 'text/xml' } });
}
