import { roleOf } from '@/lib/access';
import { hasClaude, hasElevenLabs } from '@/lib/ai';
import { readiness } from '@/lib/presenter';
import { publicState } from '@/lib/store';
import { twilioConfigured } from '@/lib/twilio';
import { resumeInbox } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  resumeInbox();
  const role = roleOf(req);
  const s = publicState();
  const extra = { keys: { claude: hasClaude(), elevenlabs: hasElevenLabs(), twilio: twilioConfigured() }, presenter: readiness() };
  if (role.kind === 'farmer') {
    // A signed-up farmer sees their own chat and listings only, never other farmers or the buyer side.
    const id = role.farmerId;
    return Response.json({
      ...s, ...extra,
      farmers: s.farmers.filter((f) => f.id === id),
      messages: s.messages.filter((m) => m.farmerId === id),
      listings: s.listings.filter((l) => l.farmerId === id),
      aiRuns: s.aiRuns.filter((r) => r.farmerId === id),
      orders: [], tenders: [], proposals: [], events: [], lastInboundAt: {}, seenSids: [],
    });
  }
  if (role.kind !== 'admin') return Response.json({ error: 'not allowed' }, { status: 401 });
  return Response.json({ ...s, ...extra });
}
