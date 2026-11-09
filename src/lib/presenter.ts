// Presenter-only readiness: which act the demo is in, what to do next, and which integrations are active.
// No secrets or phone numbers: only whether things are configured and how they last behaved.
import { aiHealth, hasElevenLabs, textProvider } from './ai';
import { TTS_MODEL, ttsAvailable, ttsHealth } from './tts';
import { getState, wasRestored } from './store';
import { phoneMap, publicBaseUrl, twilioConfigured } from './twilio';
import type { State } from './types';

export interface ActInfo { n: 1 | 2 | 3 | 4 | 5; title: string; next: string }

export function currentAct(s: State): ActInfo {
  const elsenLive = s.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && ['live', 'reserved', 'sold'].includes(l.status));
  const elsenDraft = s.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && l.status === 'draft');
  if (!elsenLive) {
    return { n: 1, title: 'Farmer accessibility', next: elsenDraft ? "Tap Təsdiq on Elşən's phone (or reply 1 on WhatsApp)" : 'Operator → Intake, phone + → Voice note + photo (fallback: L)' };
  }
  const order = s.orders.find((o) => o.tenderId === 'T-1042');
  const tender = s.tenders.find((t) => t.id === 'T-1042');
  if (!order || (order.status === 'offers_sent' && !order.recovery)) {
    if (!order) return { n: 2, title: 'Intelligent procurement', next: tender?.status === 'proposals' ? 'Confirm option i' : 'B → T-1042 → Find supply' };
    const elsen = order.allocations.find((a) => a.farmerId === 'f-elsen');
    return { n: 2, title: 'Intelligent procurement', next: elsen?.status === 'offered' ? "Tap Qəbul on Elşən's phone, then A" : 'Press A (other farmers accept)' };
  }
  const rec = order.recovery;
  if (!rec || rec.status !== 'resolved') {
    let next = 'Press S (Səbinə says hello), then C (Rauf cancels)';
    if (rec?.status === 'searching') next = 'Re-matching…';
    else if (rec?.status === 'proposed') next = 'Operator → Logistics: Approve and send offer';
    else if (rec?.status === 'offered') next = "Tap Qəbul on Səbinə's phone (or she replies 1)";
    else if (rec?.status === 'no_backup') next = 'No backup: explain partial delivery and move on (T)';
    else if (s.lastInboundAt['f-sebine'] || s.messages.some((m) => m.farmerId === 'f-sebine' && m.dir === 'in')) next = 'Press C (Rauf cancels)';
    return { n: 3, title: 'Unexpected disruption', next };
  }
  if (order.status !== 'settled') {
    return { n: 4, title: 'Trust and fulfillment', next: order.status === 'delivered' ? `B → Orders → ${order.id} → Confirm receipt` : 'Press T (jump to delivery morning)' };
  }
  const rated = Object.keys(order.buyerRatings).length > 0;
  const farmerRated = Object.keys(order.farmerRatings).length > 0;
  if (!rated || !farmerRated) return { n: 4, title: 'Trust and fulfillment', next: !rated ? 'Rate the farmers (stars)' : "Reply 5 from Elşən's phone" };
  return { n: 5, title: 'Demo complete', next: 'R resets to Act 1' };
}

export function readiness() {
  const s = getState();
  const p = textProvider();
  const phones = phoneMap();
  const failedDeliveries = s.messages.filter((m) => m.delivery === 'failed').length;
  return {
    act: currentAct(s),
    aiMode: s.settings.aiMode,
    channel: s.settings.channel,
    text: p ? { provider: p.name, model: p.model, vision: p.vision } : null,
    stt: hasElevenLabs() ? { provider: 'elevenlabs', model: 'scribe_v2' } : null,
    demoData: s.settings.demoData !== false,
    tts: { available: ttsAvailable(), on: s.settings.voiceReplies, model: TTS_MODEL(), last: ttsHealth() ?? null },
    twilio: { configured: twilioConfigured(), farmersMapped: phones.size, webhookUrlKnown: !!publicBaseUrl(), failedDeliveries },
    health: aiHealth(),
    restored: wasRestored(),
  };
}
export type Readiness = ReturnType<typeof readiness>;
