// One shared demo state for all three surfaces, kept in the server process. Every change bumps
// `version` and notifies Server-Sent Events subscribers, so the phone, Buyer and Operator views stay in sync.
// The state is snapshotted to .data/state-snapshot.json and restored after a server restart.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';
import { initialState, seedListings } from './seed';
import { forFarmer } from './farmer-lang';
import { speechFor, synthesize } from './tts';
import { maskPhone, publicBaseUrl } from './twilio';
import type { Farmer, LedgerEvent, Message, State } from './types';

type Listener = (version: number) => void;

interface Hub {
  state: State;
  listeners: Set<Listener>;
  twilioQueue: Promise<void>;
  seq: number;
  restored: boolean;
}

const g = globalThis as unknown as { __berekat?: Hub };
const SNAPSHOT = () => dataDir('state-snapshot.json');

function applyPhones(s: State) {
  // FARMER_PHONES="f-elsen=+99450...,f-rauf=+99455..."
  for (const f of s.farmers) delete f.phone;
  for (const pair of (process.env.FARMER_PHONES ?? '').split(',')) {
    const [id, phone] = pair.split('=').map((x) => x?.trim());
    const f = s.farmers.find((x) => x.id === id);
    if (f && phone) f.phone = phone;
  }
}

/** Restore the last snapshot unless DEMO_RESTORE=0. Settings always come from the environment at boot. */
function loadSnapshot(): State | undefined {
  if (process.env.DEMO_RESTORE === '0') return undefined;
  try {
    const s = JSON.parse(fs.readFileSync(SNAPSHOT(), 'utf8')) as State;
    if (!s || !Array.isArray(s.farmers) || !s.clock) return undefined;
    const fresh = initialState();
    s.settings = fresh.settings;
    for (const m of s.messages) delete m.voicePending;
    s.lastInboundAt ??= {};
    s.seenSids ??= [];
    return s;
  } catch {
    return undefined;
  }
}

function hub(): Hub {
  if (!g.__berekat) {
    const restored = loadSnapshot();
    const state = restored ?? initialState();
    applyPhones(state);
    g.__berekat = { state, listeners: new Set(), twilioQueue: Promise.resolve(), seq: 0, restored: !!restored };
  }
  return g.__berekat;
}

export function getState(): State {
  return hub().state;
}
export const wasRestored = () => hub().restored;

export function resetState() {
  const h = hub();
  const { settings, lastInboundAt, seenSids, version } = h.state;
  h.state = initialState();
  h.state.version = version; // clients only ever see the version go up
  // Real WhatsApp facts survive a reset: the 24-hour windows and the webhooks already handled.
  h.state.settings = settings;
  h.state.listings = settings.demoData === false ? [] : seedListings(); // a reset keeps the demo-data choice
  h.state.lastInboundAt = lastInboundAt ?? {};
  h.state.seenSids = seenSids ?? [];
  applyPhones(h.state);
  emit();
  persistNow();
}

export function emit() {
  const h = hub();
  h.state.version++;
  for (const l of h.listeners) {
    try {
      l(h.state.version);
    } catch {
      /* closed stream */
    }
  }
  persist();
}

function persistNow() {
  try {
    fs.mkdirSync(path.dirname(SNAPSHOT()), { recursive: true });
    const tmp = SNAPSHOT() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(hub().state));
    fs.renameSync(tmp, SNAPSHOT());
  } catch {
    /* best effort */
  }
}

let persistTimer: NodeJS.Timeout | undefined;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    persistNow();
  }, 500);
}

export function subscribe(l: Listener): () => void {
  hub().listeners.add(l);
  return () => hub().listeners.delete(l);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(++hub().seq).toString(36)}`;
}

/** The state as the browser may see it: phone numbers masked. */
export function publicState(): State {
  const s = getState();
  return { ...s, farmers: s.farmers.map((f) => (f.phone ? { ...f, phone: maskPhone(f.phone) } : f)) };
}

// ---------- Demo clock ----------

export function now(): string {
  const { base, startedAtMs } = getState().clock;
  return new Date(new Date(base).getTime() + (Date.now() - startedAtMs)).toISOString();
}

export function setClock(iso: string) {
  getState().clock = { base: iso, startedAtMs: Date.now() };
}

// ---------- Ledger ----------

export function ledger(e: Omit<LedgerEvent, 'id' | 'at'>) {
  getState().events.unshift({ id: uid('e'), at: now(), ...e });
}

// ---------- WhatsApp out ----------

export const farmer = (id: string): Farmer => getState().farmers.find((f) => f.id === id)!;

export function cardToText(m: Pick<Message, 'card' | 'text' | 'textEn'>): string {
  if (!m.card) return m.text || m.textEn || '';
  const rows = m.card.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  // In WhatsApp there are no buttons in the sandbox, so offers ask for a numbered reply.
  const actions = m.card.actions?.map((a) => `${a.reply} = ${a.label}`).join(', ');
  return `*${m.card.title}*\n${rows}${m.text ? `\n\n${m.text}` : ''}${actions ? `\n\nCavab: ${actions}` : ''}`;
}

const WINDOW_MS = 24 * 3600_000;

export function sendToFarmer(farmerId: string, msg: Omit<Message, 'id' | 'farmerId' | 'dir' | 'at' | 'via'>): Message {
  const s = getState();
  const f = farmer(farmerId);
  const viaTwilio = s.settings.channel === 'twilio' && !!f.phone && !!process.env.TWILIO_ACCOUNT_SID;
  const m: Message = { id: uid('m'), farmerId, dir: 'out', at: now(), via: viaTwilio ? 'twilio' : 'simulator', delivery: viaTwilio ? 'queued' : 'local', ...forFarmer(msg, f.lang) };
  s.messages.push(m);
  if (viaTwilio) {
    // WhatsApp only allows free-form messages within 24 hours of the farmer's last message.
    const last = s.lastInboundAt[farmerId];
    if (!last || Date.now() - last > WINDOW_MS - 5 * 60_000) {
      deliveryFailed(m, 'Outside the WhatsApp 24-hour window: the farmer must send any message first.');
    } else enqueueTwilio(m, f.phone!);
  }
  if (s.settings.voiceReplies) void attachVoice(m, viaTwilio ? f.phone : undefined);
  return m;
}

// Voice notes for one farmer go out in the order their messages were written.
const voiceChains = new Map<string, Promise<void>>();
const voiceBudget = new Map<string, number>(); // characters of voice replies per self-signed-up farmer

async function attachVoice(m: Message, phone?: string) {
  const f = farmer(m.farmerId);
  const lang = f?.lang === 'en' ? 'en' : 'az';
  const spoken = speechFor(m, lang);
  if (!spoken) return;
  // Accounts made from the join QR get a voice budget (ElevenLabs credits), then text only.
  if (f?.selfSignup) {
    const used = voiceBudget.get(f.id) ?? 0;
    if (used + spoken.length > Number(process.env.DEMO_SIGNUP_VOICE_CHARS ?? 1500)) return;
    voiceBudget.set(f.id, used + spoken.length);
  }
  m.voicePending = true;
  const prev = voiceChains.get(m.farmerId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const clip = await synthesize(spoken, getState().settings.aiMode, lang);
    m.voicePending = false;
    if (clip) {
      m.voiceUrl = clip.url;
      m.voiceMode = clip.mode === 'live' ? 'live' : 'cached';
      // On WhatsApp the clip is sent as a voice note right after the text (Twilio fetches it from the public URL).
      const base = publicBaseUrl();
      if (phone && m.delivery !== 'failed') {
        if (base) enqueueTwilio(m, phone, `${base}${clip.url}`);
        else m.voiceDelivery = 'failed';
      }
    }
    emit();
  });
  voiceChains.set(m.farmerId, next.catch(() => {}));
  await next.catch(() => {});
}

function deliveryFailed(m: Message, why: string) {
  m.delivery = 'failed';
  m.deliveryError = why;
  ledger({ type: 'system', tone: 'alert', title: `WhatsApp to ${farmer(m.farmerId).name.split(' ')[0]} not delivered`, titleAz: `${farmer(m.farmerId).name.split(' ')[0]} fermerinə WhatsApp mesajı çatmadı`, detail: why });
}

/** The sandbox allows about one message every 3 seconds, so sends are serialised with a gap and retried once. */
function enqueueTwilio(m: Message, phone: string, mediaUrl?: string) {
  const h = hub();
  h.twilioQueue = h.twilioQueue.then(async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
    // A voice note is its own WhatsApp message (audio cannot carry a caption).
    const body = new URLSearchParams(mediaUrl ? { From: from, To: `whatsapp:${phone}`, MediaUrl: mediaUrl } : { From: from, To: `whatsapp:${phone}`, Body: cardToText(m).slice(0, 1600) });
    if (mediaUrl) m.voiceDelivery = 'queued';
    const base = publicBaseUrl();
    if (base) body.set('StatusCallback', `${base}/api/twilio/status`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        const j = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
        if (res.ok) {
          if (mediaUrl) { m.voiceDelivery = 'sent'; m.voiceSid = j.sid; } else { m.delivery = 'sent'; m.sid = j.sid; }
          break;
        }
        if ((res.status === 429 || res.status >= 500) && attempt === 0) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        if (mediaUrl) { m.voiceDelivery = 'failed'; console.error('Twilio voice note failed', res.status, j.code, j.message); break; }
        deliveryFailed(m, `Twilio ${res.status}${j.code ? ` (error ${j.code})` : ''}: ${j.message ?? 'send failed'}`);
        console.error('Twilio send failed', res.status, j.code, j.message);
        break;
      } catch (err) {
        if (attempt === 0) continue;
        if (mediaUrl) m.voiceDelivery = 'failed';
        else deliveryFailed(m, `Twilio unreachable: ${(err as Error).message}`);
      }
    }
    emit();
    await new Promise((r) => setTimeout(r, Number(process.env.TWILIO_GAP_MS ?? 3200)));
  });
}

/** Twilio status callback: sent → delivered → read, or failed/undelivered with an error code. */
export function updateDelivery(messageSid: string, status: string, errorCode?: string) {
  const v = getState().messages.find((x) => x.voiceSid === messageSid);
  if (v) {
    if (['delivered', 'read', 'failed', 'undelivered'].includes(status)) v.voiceDelivery = status === 'undelivered' ? 'failed' : (status as Message['voiceDelivery']);
    return emit();
  }
  const m = getState().messages.find((x) => x.sid === messageSid);
  if (!m) return;
  if (status === 'delivered' || status === 'read') m.delivery = status;
  else if ((status === 'failed' || status === 'undelivered') && m.delivery !== 'failed') {
    deliveryFailed(m, `WhatsApp ${status}${errorCode ? ` (Twilio error ${errorCode}${errorCode === '63016' ? ': outside the 24-hour window' : ''})` : ''}`);
  }
  emit();
}
