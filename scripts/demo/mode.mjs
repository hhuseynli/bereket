#!/usr/bin/env node
// npm run demo:mode [-- --ai=live|cached|simulated] [-- --whatsapp=simulator|twilio] [-- --voice=on|off] [-- --save]
// Switch the running app's AI mode or WhatsApp channel (same as F / W in the app). --save also writes the
// choice to .env.local so the next launch starts that way. With no flags, prints the current modes.
import { PORT, args, bold, director, healthy, setEnvValue, state } from './lib.mjs';

const a = args();
if (a.ai && !['live', 'cached', 'simulated'].includes(a.ai)) throw new Error('--ai must be live, cached or simulated');
if (a.whatsapp && !['simulator', 'twilio'].includes(a.whatsapp)) throw new Error('--whatsapp must be simulator or twilio');
const running = await healthy(PORT);
if (running) {
  if (a.ai) await director(PORT, 'aiMode', a.ai);
  if (a.whatsapp) await director(PORT, 'channel', a.whatsapp);
  if (a.voice) await director(PORT, 'voice', a.voice === 'off' ? 'off' : 'on');
}
if (a.save) {
  if (a.ai) setEnvValue('AI_MODE', a.ai);
  if (a.whatsapp) setEnvValue('WHATSAPP_CHANNEL', a.whatsapp);
  if (a.voice) setEnvValue('TTS_REPLIES', a.voice === 'off' ? '0' : '1');
}
if (running) {
  const s = await state(PORT);
  console.log(`AI ${bold(s.settings.aiMode.toUpperCase())} · WhatsApp ${bold(s.settings.channel)} · voice replies ${bold(s.settings.voiceReplies ? 'on' : 'off')}${a.save ? ' (saved to .env.local)' : ''}`);
  if (s.settings.channel === 'twilio' && !s.presenter.twilio.webhookUrlKnown) console.log('Note: no tunnel URL known yet: run npm run demo:tunnel');
} else console.log(a.save ? 'Saved to .env.local; the app is not running.' : 'The app is not running (npm run demo:launch).');
