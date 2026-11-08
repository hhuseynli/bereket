import { hasClaude, hasElevenLabs } from '@/lib/ai';
import { readiness } from '@/lib/presenter';
import { publicState } from '@/lib/store';
import { twilioConfigured } from '@/lib/twilio';
import { resumeInbox } from '@/lib/inbox';

export const dynamic = 'force-dynamic';

export function GET() {
  resumeInbox();
  return Response.json({
    ...publicState(),
    keys: { claude: hasClaude(), elevenlabs: hasElevenLabs(), twilio: twilioConfigured() },
    presenter: readiness(),
  });
}
