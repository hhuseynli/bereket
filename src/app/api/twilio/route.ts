import { enqueueInbound } from '@/lib/inbox';
import { emit, getState, ledger } from '@/lib/store';
import { maskPhone, phoneMap, validateTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMPTY = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
const twiml = (status = 200) => new Response(EMPTY, { status, headers: { 'Content-Type': 'text/xml' } });

// Twilio WhatsApp webhook ("When a message comes in"). The request is checked against Twilio's signature,
// only farmers listed in FARMER_PHONES are accepted, retries are dropped by MessageSid, and the message is
// queued durably before we answer, so slow AI calls never hit Twilio's timeout and nothing is lost on restart.
export async function POST(req: Request) {
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const check = validateTwilioRequest(req, params);
  if (!check.ok) {
    console.warn(`[twilio] rejected webhook: ${check.reason}`);
    return new Response('Forbidden', { status: 403 });
  }

  const sid = params.get('MessageSid') ?? params.get('SmsMessageSid') ?? '';
  const from = (params.get('From') ?? '').replace('whatsapp:', '');
  const s = getState();
  if (!sid) return twiml(400);
  if (s.seenSids.includes(sid)) return twiml(); // Twilio retry: already queued

  const farmerId = phoneMap().get(from);
  if (!farmerId) {
    // Not a registered demo farmer: never auto-register strangers who find the sandbox number.
    console.warn(`[twilio] ignored message from unregistered number ${maskPhone(from)}`);
    ledger({ type: 'system', tone: 'alert', title: 'Ignored WhatsApp from an unregistered number', detail: `${maskPhone(from)} is not in FARMER_PHONES` });
    emit();
    return twiml();
  }

  s.seenSids.push(sid);
  if (s.seenSids.length > 500) s.seenSids.splice(0, s.seenSids.length - 500);
  s.lastInboundAt[farmerId] = Date.now();
  const obj: Record<string, string> = {};
  for (const [k, v] of params) obj[k] = v;
  enqueueInbound({ sid, farmerId, receivedAt: Date.now(), params: obj });
  emit();
  return twiml();
}
