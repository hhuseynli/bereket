import { getState } from '@/lib/store';
import { hasClaude, hasElevenLabs } from '@/lib/ai';

export const dynamic = 'force-dynamic';

export function GET() {
  const s = getState();
  return Response.json({
    ...s,
    keys: { claude: hasClaude(), elevenlabs: hasElevenLabs(), twilio: !!process.env.TWILIO_ACCOUNT_SID },
  });
}
