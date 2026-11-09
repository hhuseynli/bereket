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
  if (role.kind === 'none') return Response.json({ error: 'not allowed' }, { status: 401 });
  // The site is public; viewer tells the page whether to show the presenter controls.
  return Response.json({
    ...publicState(),
    keys: { claude: hasClaude(), elevenlabs: hasElevenLabs(), twilio: twilioConfigured() },
    presenter: readiness(),
    viewer: role.kind === 'farmer' ? `farmer:${role.farmerId}` : role.kind,
  });
}
