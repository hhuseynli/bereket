// One shared demo state for all three surfaces, kept in the server process. Every change bumps
// `version` and notifies Server-Sent Events subscribers, so the phone, Buyer and Operator views stay in sync.
import fs from 'node:fs';
import path from 'node:path';
import { initialState } from './seed';
import type { Farmer, LedgerEvent, Message, State } from './types';

type Listener = (version: number) => void;

interface Hub {
  state: State;
  listeners: Set<Listener>;
  twilioQueue: Promise<void>;
  seq: number;
}

const g = globalThis as unknown as { __berekat?: Hub };

function applyPhones(s: State) {
  // FARMER_PHONES="f-elsen=+99450...,f-rauf=+99455..."
  for (const pair of (process.env.FARMER_PHONES ?? '').split(',')) {
    const [id, phone] = pair.split('=').map((x) => x?.trim());
    const f = s.farmers.find((x) => x.id === id);
    if (f && phone) f.phone = phone;
  }
}

function hub(): Hub {
  if (!g.__berekat) {
    const state = initialState();
    applyPhones(state);
    g.__berekat = { state, listeners: new Set(), twilioQueue: Promise.resolve(), seq: 0 };
  }
  return g.__berekat;
}

export function getState(): State {
  return hub().state;
}

export function resetState() {
  const h = hub();
  const settings = h.state.settings;
  h.state = initialState();
  h.state.settings = settings;
  applyPhones(h.state);
  emit();
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

let persistTimer: NodeJS.Timeout | undefined;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    try {
      const dir = path.join(process.cwd(), '.data');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'state-snapshot.json'), JSON.stringify(hub().state));
    } catch {
      /* best effort */
    }
  }, 500);
}

export function subscribe(l: Listener): () => void {
  hub().listeners.add(l);
  return () => hub().listeners.delete(l);
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(++hub().seq).toString(36)}`;
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

function cardToText(m: Message): string {
  if (!m.card) return m.text ?? '';
  const rows = m.card.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  const actions = m.card.actions?.map((a) => `${a.reply} = ${a.label}`).join(', ');
  return `*${m.card.title}*\n${rows}${m.text ? `\n\n${m.text}` : ''}${actions ? `\n\nCavab: ${actions}` : ''}`;
}

export function sendToFarmer(farmerId: string, msg: Omit<Message, 'id' | 'farmerId' | 'dir' | 'at' | 'via'>): Message {
  const s = getState();
  const f = farmer(farmerId);
  const viaTwilio = s.settings.channel === 'twilio' && !!f.phone && !!process.env.TWILIO_ACCOUNT_SID;
  const m: Message = { id: uid('m'), farmerId, dir: 'out', at: now(), via: viaTwilio ? 'twilio' : 'simulator', delivery: viaTwilio ? 'queued' : 'local', ...msg };
  s.messages.push(m);
  if (viaTwilio) enqueueTwilio(m, f.phone!);
  return m;
}

/** The sandbox allows one message every 3 seconds, so sends are serialised with a gap. */
function enqueueTwilio(m: Message, phone: string) {
  const h = hub();
  h.twilioQueue = h.twilioQueue.then(async () => {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID!;
      const token = process.env.TWILIO_AUTH_TOKEN!;
      const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
      const body = new URLSearchParams({ From: from, To: `whatsapp:${phone}`, Body: cardToText(m) });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      m.delivery = res.ok ? 'sent' : 'failed';
      if (!res.ok) console.error('Twilio send failed', res.status, await res.text());
    } catch (err) {
      m.delivery = 'failed';
      console.error('Twilio send error', err);
    }
    emit();
    await new Promise((r) => setTimeout(r, Number(process.env.TWILIO_GAP_MS ?? 3200)));
  });
}
