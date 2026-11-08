import { updateDelivery } from '@/lib/store';
import { validateTwilioRequest } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Twilio message status callback: marks outgoing WhatsApp messages delivered, read or failed.
export async function POST(req: Request) {
  const params = new URLSearchParams(await req.text());
  if (!validateTwilioRequest(req, params).ok) return new Response('Forbidden', { status: 403 });
  const sid = params.get('MessageSid');
  const status = params.get('MessageStatus');
  if (sid && status) updateDelivery(sid, status, params.get('ErrorCode') ?? undefined);
  return new Response(null, { status: 204 });
}
