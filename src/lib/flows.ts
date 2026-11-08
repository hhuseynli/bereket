// Everything that changes state: the farmer's WhatsApp conversation, the AI listing pipeline, orders,
// cancellation and recovery, and the hidden presenter controls. Farmer-facing text is Azerbaijani with
// an English gloss shown in the demo.
import { classifyIntent, DEMO_PHOTOS, DEMO_VOICE, extractListing, inspectPhoto, readPublic, transcribe, wordsToDigits, type AiMode, type Extracted, type Mode } from './ai';
import { farmerTurn, type ActionType, type FieldChanges, type TurnContext } from './agent';
import { generateProposals, planRecovery } from './engine';
import { stageInfo } from './ripeness';
import { demoDeadline, elsenListingFields } from './seed';
import { emit, farmer, getState, ledger, now, resetState, sendToFarmer, setClock, uid } from './store';
import type { AiRun, AiStep, Allocation, Listing, Message, Order } from './types';

// Read at call time so tests (and the CLI) can change pacing after import.
const stepMs = () => Number(process.env.DEMO_STEP_MS ?? 750);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toFixed(2);
const first = (id: string) => farmer(id).name.split(' ')[0];
const AZ_PRODUCT: Record<string, string> = { Tomato: 'Pomidor', Cucumber: 'Xiyar', Apple: 'Alma', Potato: 'Kartof', Pepper: 'Bibər', Onion: 'Soğan', Pear: 'Armud', Cabbage: 'Kələm', Carrot: 'Yerkökü', Eggplant: 'Badımcan', Beans: 'Lobya', Quince: 'Heyva', Persimmon: 'Xurma', Hazelnut: 'Fındıq', Walnut: 'Qoz' };

function bakuTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' });
}
function sameBakuDay(a: string, b: string) {
  const d = (x: string) => new Date(x).toLocaleDateString('en-CA', { timeZone: 'Asia/Baku' });
  return d(a) === d(b);
}

function say(farmerId: string, az: string, en: string, card?: Message['card']) {
  sendToFarmer(farmerId, { kind: card ? 'card' : 'text', text: az, textEn: en, card });
  emit();
}

// ---------- Intake buffers (one per farmer) ----------

interface PhotoIn { buf?: Buffer; mime: string; url: string; hintStage?: number; hintSpoiled?: boolean }
interface Intake {
  runId: string;
  transcriptAz?: string;
  extracted?: Extracted;
  photo?: PhotoIn;
  awaiting?: 'photo' | 'voice' | 'qtyKg' | 'priceAzn' | 'product';
  modes: Mode[];
}
const gi = globalThis as unknown as { __intake?: Map<string, Intake> };
const intakes = () => (gi.__intake ??= new Map());

function newRun(farmerId: string): AiRun {
  const run: AiRun = {
    id: uid('run'),
    farmerId,
    startedAt: now(),
    mode: 'simulated',
    status: 'running',
    steps: [
      { key: 'transcribe', label: 'Transcribe Azerbaijani voice note', status: 'pending' },
      { key: 'extract', label: 'Extract listing fields', status: 'pending' },
      { key: 'inspect', label: 'Inspect photo: ripeness and defects', status: 'pending' },
      { key: 'price', label: 'Check price against the region', status: 'pending' },
      { key: 'draft', label: 'Draft listing for farmer to confirm', status: 'pending' },
    ],
  };
  getState().aiRuns.unshift(run);
  return run;
}

function intakeFor(farmerId: string): Intake {
  let it = intakes().get(farmerId);
  const run = it && getState().aiRuns.find((r) => r.id === it!.runId);
  if (!it || !run || run.status !== 'running') {
    it = { runId: newRun(farmerId).id, modes: [] };
    intakes().set(farmerId, it);
  }
  return it;
}
const runOf = (it: Intake) => getState().aiRuns.find((r) => r.id === it.runId)!;

async function step<T>(run: AiRun, key: AiStep['key'], fn: () => Promise<{ value: T; output: string; mode?: Mode; note?: string }>): Promise<T> {
  const s = run.steps.find((x) => x.key === key)!;
  s.status = 'running';
  emit();
  const t0 = Date.now();
  try {
    const { value, output, mode, note } = await fn();
    const spent = Date.now() - t0;
    if (spent < stepMs()) await sleep(stepMs() - spent);
    s.status = 'done';
    s.output = output;
    s.mode = mode;
    s.note = note;
    s.ms = Date.now() - t0;
    emit();
    return value;
  } catch (err) {
    s.status = 'failed';
    s.output = (err as Error).message;
    run.status = 'failed';
    emit();
    throw err;
  }
}

/** One label for the whole run; 'mixed' when steps used different kinds of results (each step shows its own). */
function aggregateMode(modes: Mode[]): AiRun['mode'] {
  const kinds = Array.from(new Set(modes));
  return kinds.length === 1 ? kinds[0] : kinds.length === 0 ? 'simulated' : 'mixed';
}

// ---------- Inbound ----------

export interface InboundAudio { buf?: Buffer; mime: string; url?: string; scriptedAz?: string }
export interface Inbound {
  farmerId: string;
  text?: string;
  audio?: InboundAudio;
  photo?: PhotoIn;
  via: 'simulator' | 'twilio';
}

// One farmer's messages are handled strictly in order (a correction must not overtake the voice note it corrects),
// while different farmers are handled independently. The Twilio inbox already serialises; this covers the simulator.
const gc = globalThis as unknown as { __farmerChains?: Map<string, Promise<void>> };
const chains = () => (gc.__farmerChains ??= new Map<string, Promise<void>>());

export function handleInbound(inb: Inbound): Promise<void> {
  const prev = chains().get(inb.farmerId) ?? Promise.resolve();
  const next = prev.then(() => handleInboundNow(inb));
  const settled = next.catch((err: unknown) => console.error('[inbound] failed:', (err as Error).message));
  chains().set(inb.farmerId, settled);
  void settled.then(() => { if (chains().get(inb.farmerId) === settled) chains().delete(inb.farmerId); });
  return next;
}

async function handleInboundNow(inb: Inbound) {
  const s = getState();
  const base = { farmerId: inb.farmerId, dir: 'in' as const, at: now(), via: inb.via, delivery: 'local' as const };
  if (inb.via === 'twilio') s.lastInboundAt[inb.farmerId] = Date.now();

  if (inb.photo) {
    s.messages.push({ id: uid('m'), ...base, kind: 'photo', mediaUrl: inb.photo.url });
    emit();
    await onPhoto(inb.farmerId, inb.photo, !!inb.audio);
  }

  if (inb.audio) {
    const msg: Message = { id: uid('m'), ...base, kind: 'voice', mediaUrl: inb.audio.url };
    s.messages.push(msg);
    emit();
    // Only a voice note that may describe new produce gets an intake run; corrections and answers do not.
    const pendingWork = hasPendingOfferOrOrder(inb.farmerId) || s.listings.some((l) => l.farmerId === inb.farmerId && l.status === 'draft');
    let az: string;
    let mode: Mode;
    const it = pendingWork ? undefined : intakeFor(inb.farmerId);
    try {
      const doIt = async () => {
        const r = inb.audio!.buf
          ? await transcribe(inb.audio!.buf, inb.audio!.mime, { aiMode: s.settings.aiMode, scriptedAz: inb.audio!.scriptedAz })
          : { text: inb.audio!.scriptedAz ?? '', mode: 'simulated' as Mode, note: 'scripted voice note, no recording' };
        if (!r.text) throw new Error('Speech-to-text needs an ElevenLabs key for recorded audio');
        return r;
      };
      const r = it
        ? await step(runOf(it), 'transcribe', async () => {
            const x = await doIt();
            return { value: x, output: x.text, mode: x.mode, note: x.note };
          })
        : await doIt();
      az = r.text;
      mode = r.mode;
      if (it) {
        it.modes.push(mode);
        runOf(it).transcriptAz = az;
        runOf(it).audioUrl = inb.audio.url;
      }
    } catch (err) {
      console.error('[inbound] transcription failed:', (err as Error).message);
      ledger({ type: 'ai', tone: 'alert', title: `Could not transcribe ${first(inb.farmerId)}'s voice note`, detail: (err as Error).message.slice(0, 140) });
      say(inb.farmerId, 'Səs aydın eşidilmədi, zəhmət olmasa yenidən göndərin və ya yazın.', 'The audio was not clear, please send it again or type it.');
      return;
    }
    msg.transcript = az;
    const known = Object.values(DEMO_VOICE).find((d) => d.az === az);
    if (known) msg.textEn = known.en;
    emit();
    await routeText(inb.farmerId, az, true, msg);
  }

  if (inb.text) {
    const msg: Message = { id: uid('m'), ...base, kind: 'text', text: inb.text, textEn: Object.values(DEMO_VOICE).find((d) => d.az === inb.text)?.en };
    s.messages.push(msg);
    emit();
    await routeText(inb.farmerId, inb.text, false, msg);
  }
}

function activeAllocation(farmerId: string, statuses: Allocation['status'][]): { order: Order; alloc: Allocation } | undefined {
  for (const order of getState().orders) {
    if (order.status === 'settled') continue;
    const alloc = order.allocations.find((a) => a.farmerId === farmerId && statuses.includes(a.status));
    if (alloc) return { order, alloc };
  }
  return undefined;
}

function hasPendingOfferOrOrder(farmerId: string) {
  return !!activeAllocation(farmerId, ['offered']) || !!activeAllocation(farmerId, ['accepted']);
}

// ---------- Conversation ----------
// Quick replies ("1", "2", a star rating, a bare number the bot asked for) are handled instantly. Everything else
// goes to the conversational assistant (src/lib/agent.ts), which proposes one action that is checked here.

function liveLotOf(farmerId: string) {
  return getState().listings.find((l) => l.farmerId === farmerId && (l.status === 'live' || l.status === 'reserved') && l.source === 'whatsapp')
    ?? getState().listings.find((l) => l.farmerId === farmerId && (l.status === 'live' || l.status === 'reserved'));
}

function rateableOrder(farmerId: string) {
  return getState().orders.find((o) => o.status === 'settled' && o.allocations.some((a) => a.farmerId === farmerId && a.status === 'picked_up') && o.farmerRatings[farmerId] === undefined);
}

function priceRange(product?: string, variety?: string, grade?: number) {
  if (!product) return undefined;
  const all = getState().listings.filter((l) => l.status === 'live' && l.product === product);
  const same = all.filter((l) => (!variety || l.variety === variety) && (!grade || l.grade === grade));
  const peers = same.length ? same : all; // an unknown variety ("Local") compares with the product as a whole
  if (!peers.length) return `No other live ${product.toLowerCase()} listings today`;
  const ps = peers.map((p) => p.priceAzn);
  const label = same.length && variety ? `${product} ${variety}${grade ? `, grade ${grade}` : ''}` : `${product} (all varieties)`;
  return `${label}: ${fmt(Math.min(...ps))} to ${fmt(Math.max(...ps))} ₼/kg across ${peers.length} live lots today`;
}

function listingFacts(l: Listing) {
  return {
    status: l.status, product: l.product, productAz: AZ_PRODUCT[l.product] ?? l.product, variety: l.variety, grade: l.grade, qtyKg: l.qtyKg,
    priceAzn: l.priceAzn, harvest: l.harvest, ripeness: l.ripenessConfidence ? `stage ${l.ripeness}/6 (${stageInfo(l.ripeness).name}) from the photo` : 'no photo yet', notes: l.notes,
    canEdit: l.status === 'draft' || l.status === 'live',
  };
}

function historyFor(farmerId: string, exclude: string) {
  return getState().messages
    .filter((m) => m.farmerId === farmerId && m.id !== exclude)
    .slice(-8)
    .map((m) => {
      const who = m.dir === 'in' ? 'Farmer' : 'BƏRƏKƏT';
      const body = m.kind === 'photo' ? '[photo]' : m.kind === 'voice' ? `[voice] ${m.transcript ?? ''}` : m.card ? `[${m.card.title}] ${m.card.rows.map(([k, v]) => `${k}: ${v}`).join(', ')}${m.text ? ` ${m.text}` : ''}` : m.text ?? '';
      return `${who}: ${body}`.slice(0, 400);
    });
}

function turnContext(farmerId: string, fromVoice: boolean, msgId: string) {
  const s = getState();
  const offered = activeAllocation(farmerId, ['offered']);
  const committedRaw = activeAllocation(farmerId, ['accepted']);
  const committed = committedRaw && committedRaw.order.status !== 'delivered' ? committedRaw : undefined;
  const draft = s.listings.find((l) => l.farmerId === farmerId && l.status === 'draft');
  const it = intakes().get(farmerId);
  const liveLot = liveLotOf(farmerId);
  const toRate = rateableOrder(farmerId);
  const today = now();
  const facts: Record<string, unknown> = {};
  let situation: TurnContext['situation'] = 'idle';
  let allowed: ActionType[] = ['reply'];
  const buyer = (o: Order) => s.buyers.find((b) => b.id === o.buyerId)!.name;
  if (offered) {
    situation = 'offer';
    allowed = ['accept_offer', 'decline_offer', 'reply'];
    const pickup = new Date(new Date(demoDeadline()).getTime() - 15 * 3600_000).toISOString();
    facts.offer = { buyer: buyer(offered.order), qtyKg: offered.alloc.qtyKg, priceAzn: offered.alloc.priceAzn, totalAzn: fmt(offered.alloc.qtyKg * offered.alloc.priceAzn), pickup: `today ${bakuTime(pickup)}`, payment: 'held safely until delivery (demo)' };
  } else if (committed) {
    situation = 'order';
    allowed = ['cancel_order', 'reply'];
    facts.order = { buyer: buyer(committed.order), qtyKg: committed.alloc.qtyKg, priceAzn: committed.alloc.priceAzn, status: committed.order.status, pickup: 'today 18:00, the driver comes to the farm' };
  } else if (draft) {
    situation = 'draft';
    allowed = ['update_listing', 'confirm_listing', 'withdraw_listing', 'reply'];
    facts.listing = listingFacts(draft);
    facts.prices = priceRange(draft.product, draft.variety, draft.grade);
  } else if (it?.extracted) {
    situation = 'intake';
    allowed = ['update_listing', 'withdraw_listing', 'reply'];
    facts.listing = { status: 'being drafted', ...it.extracted, confidence: undefined, waitingFor: it.awaiting ?? 'nothing' };
    facts.prices = priceRange(it.extracted.product, it.extracted.variety, it.extracted.grade);
  } else {
    situation = liveLot ? 'live' : 'idle';
    allowed = ['new_listing', 'reply'];
    if (liveLot) {
      facts.listing = listingFacts(liveLot);
      facts.prices = priceRange(liveLot.product, liveLot.variety, liveLot.grade);
      if (liveLot.status === 'live') allowed.push('update_listing', 'withdraw_listing');
    }
  }
  if (toRate) {
    allowed.push('rate');
    facts.ratingRequest = `Order ${toRate.id} was delivered and paid; we asked the farmer to rate the buyer 1-5`;
  }
  const ctx: TurnContext = {
    farmerFirstName: first(farmerId),
    today: `${today.slice(0, 10)} (${new Date(today).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Baku' })})`,
    situation, facts, allowed, fromVoice, history: historyFor(farmerId, msgId),
  };
  return { ctx, offered, committed, draft, it, liveLot, toRate };
}

async function routeText(farmerId: string, text: string, fromVoice: boolean, msg: Message) {
  const s = getState();
  const t = text.trim().toLocaleLowerCase('az');
  const c0 = turnContext(farmerId, fromVoice, msg.id);

  // Quick replies: instant, no AI.
  if (c0.offered && (t === '1' || t === '2')) return t === '1' ? acceptOffer(c0.offered.order, c0.offered.alloc) : cancelAllocation(c0.offered.order, c0.offered.alloc, text);
  if (c0.ctx.situation === 'draft' && c0.draft && !fromVoice && (t === '1' || t === '2')) {
    if (t === '1') return confirmListing(c0.draft);
    const run = s.aiRuns.find((r) => r.listingId === c0.draft!.id);
    if (run) { run.waitingFor = 'a correction'; }
    return say(farmerId, 'Nəyi düzəldək? Yazın və ya səsli deyin, məsələn: "qiymət 1 manat 50 qəpik" və ya "350 kilo".', 'What should we fix? Write or say it, for example: "price 1 manat 50 qəpik" or "350 kilos".');
  }
  if (c0.toRate && /^[1-5]$/.test(t)) return rateBuyer(farmerId, c0.toRate, Number(t));
  const it0 = c0.it;
  if (it0?.awaiting && ['qtyKg', 'priceAzn', 'product'].includes(it0.awaiting) && it0.extracted && /^\s*[\d.,]+\s*(kq|kilo|kg|manat|azn|₼)?\s*$/i.test(t)) {
    const n = parseFloat(t.replace(',', '.').replace(/[^0-9.]/g, ''));
    if (it0.awaiting === 'qtyKg' && n > 0) it0.extracted.qtyKg = n;
    else if (it0.awaiting === 'priceAzn' && n > 0) it0.extracted.priceAzn = n;
    it0.awaiting = undefined;
    return finishIntake(farmerId);
  }

  // Everything else: the assistant.
  const turn = await farmerTurn(text, c0.ctx, s.settings.aiMode);
  if (turn.messageEn && !msg.textEn) msg.textEn = turn.messageEn;
  const reply = (az?: string, en?: string) => az && sayAi(farmerId, az, en ?? '', turn.mode);
  const { offered, committed, draft, it, liveLot, toRate } = c0;
  // A voice note that was not new produce should not leave an empty intake run behind.
  if (turn.action !== 'new_listing' && it && !it.extracted && runOf(it)?.steps[1].status === 'pending') {
    s.aiRuns = s.aiRuns.filter((r) => r.id !== it.runId);
    intakes().delete(farmerId);
  }
  switch (turn.action) {
    case 'accept_offer':
      return offered && acceptOffer(offered.order, offered.alloc);
    case 'decline_offer':
      return offered && cancelAllocation(offered.order, offered.alloc, text, turn.cause);
    case 'cancel_order':
      return committed && cancelAllocation(committed.order, committed.alloc, text, turn.cause);
    case 'rate':
      return toRate && turn.stars && rateBuyer(farmerId, toRate, turn.stars);
    case 'new_listing':
      return onDescription(farmerId, text);
    case 'confirm_listing':
      return draft && confirmListing(draft);
    case 'withdraw_listing': {
      const l = draft ?? (liveLot?.status === 'live' ? liveLot : undefined);
      if (l) {
        l.status = 'withdrawn';
        const run = s.aiRuns.find((r) => r.listingId === l.id);
        if (run) { run.note = 'Withdrawn by the farmer'; run.waitingFor = undefined; }
        ledger({ type: 'listing', tone: 'neutral', title: `${first(farmerId)} withdrew ${l.qtyKg} kg ${l.product.toLowerCase()}` });
      } else if (it) {
        const run = runOf(it);
        run.status = 'done';
        run.note = 'Withdrawn by the farmer before the draft';
        run.waitingFor = undefined;
        intakes().delete(farmerId);
      }
      return say(farmerId, 'Yaxşı, elanı geri götürdük. Yeni məhsul olanda yazın.', 'OK, we withdrew the listing. Write when you have new produce.');
    }
    case 'update_listing': {
      const changes = turn.fields ?? {};
      const quote = text.slice(0, 160);
      // The confirmation is written from what was actually applied, never from the model's wording.
      const [doneAz, doneEn] = describeChanges(changes, turn.rejected);
      if (draft) {
        applyChanges(draft, changes, quote);
        return sendDraftCard(draft, doneAz, doneEn, turn.mode);
      }
      if (it?.extracted) {
        const run = runOf(it);
        for (const [k, v] of Object.entries(changes)) {
          const key = k as keyof FieldChanges;
          const from = it.extracted[key];
          (it.extracted as unknown as Record<string, unknown>)[key] = v;
          if (key !== 'notes') it.extracted.confidence[key] = 1;
          recordEdit(run, key, from, v, quote);
        }
        if (it.awaiting && it.awaiting !== 'photo' && it.awaiting !== 'voice' && it.extracted[it.awaiting as 'qtyKg']) it.awaiting = undefined;
        return finishIntake(farmerId);
      }
      if (liveLot && liveLot.status === 'live') {
        applyChanges(liveLot, changes, quote);
        ledger({ type: 'listing', tone: 'neutral', title: `${first(farmerId)} updated the live listing`, detail: `${liveLot.qtyKg} kg · ${fmt(liveLot.priceAzn)} ₼/kg` });
        return sayAi(farmerId, `${doneAz} Elanınız: ${liveLot.qtyKg} kq, ${fmt(liveLot.priceAzn)} ₼/kq.`, `${doneEn} Your listing: ${liveLot.qtyKg} kg, ${fmt(liveLot.priceAzn)} ₼/kg.`, turn.mode);
      }
      return reply(turn.replyAz, turn.replyEn);
    }
    default: {
      if (turn.rejected?.length && !turn.replyAz) return reply('Rəqəmi tam eşidə bilmədim. Zəhmət olmasa yazın, məsələn: "1.50 manat".', "I couldn't catch the number. Please write it, e.g. \"1.50 manat\".");
      return reply(turn.replyAz, turn.replyEn);
    }
  }
}

const FIELD_AZ: Record<string, (v: unknown) => [string, string]> = {
  priceAzn: (v) => [`qiymət ${fmt(Number(v))} ₼/kq`, `price ${fmt(Number(v))} ₼/kg`],
  qtyKg: (v) => [`miqdar ${v} kq`, `quantity ${v} kg`],
  product: (v) => [`məhsul ${AZ_PRODUCT[String(v)] ?? v}`, `product ${v}`],
  variety: (v) => [`növ ${v}`, `variety ${v}`],
  grade: (v) => [`sort ${v}`, `grade ${v}`],
  harvest: (v) => [`yığım ${String(v).split('-').reverse().slice(0, 2).join('.')}`, `harvest ${v}`],
  notes: () => ['qeyd', 'note'],
};

function describeChanges(c: FieldChanges, rejected?: string[]): [string, string] {
  const parts = Object.entries(c).filter(([, v]) => v !== undefined).map(([k, v]) => (FIELD_AZ[k] ?? ((x: unknown) => [`${k} ${x}`, `${k} ${x}`]))(v));
  let az = parts.length ? `Düzəltdim: ${parts.map((p) => p[0]).join(', ')}.` : '';
  let en = parts.length ? `Updated: ${parts.map((p) => p[1]).join(', ')}.` : '';
  if (rejected?.length) {
    az += ' Bir rəqəmi tam eşitmədim, zəhmət olmasa yazın.';
    en += " I didn't catch one number, please write it.";
  }
  return [az.trim(), en.trim()];
}

function sayAi(farmerId: string, az: string, en: string, mode: Mode) {
  const m = sendToFarmer(farmerId, { kind: 'text', text: az, textEn: en, ai: mode });
  emit();
  return m;
}

function rateBuyer(farmerId: string, order: Order, stars: number) {
  const s = getState();
  order.farmerRatings[farmerId] = stars;
  const b = s.buyers.find((x) => x.id === order.buyerId)!;
  const given = Object.values(order.farmerRatings);
  b.rating = Math.round(((b.rating * 20 + given.reduce((x, y) => x + y, 0)) / (20 + given.length)) * 10) / 10;
  ledger({ type: 'rating', tone: 'good', title: `${first(farmerId)} rated the buyer ${stars}/5`, orderId: order.id });
  return say(farmerId, 'Təşəkkürlər! Qiymətiniz qeydə alındı.', 'Thank you! Your rating is saved.');
}

const FIELD_LABEL: Record<string, string> = { product: 'product', variety: 'variety', grade: 'grade', qtyKg: 'quantity', priceAzn: 'price', harvest: 'harvest', notes: 'notes', photo: 'photo' };

function recordEdit(run: AiRun | undefined, field: string, from: unknown, to: unknown, quote?: string, by: 'farmer' | 'operator' = 'farmer') {
  if (!run || String(from ?? '') === String(to ?? '')) return;
  (run.edits ??= []).push({ field, from: from === undefined ? undefined : String(from), to: String(to), by, at: now(), quote });
  run.fields ??= {};
  if (field in FIELD_LABEL && field !== 'photo' && field !== 'notes') run.fields[field] = { value: String(to), confidence: 1 };
}

function applyChanges(l: Listing, c: FieldChanges, quote?: string) {
  const run = getState().aiRuns.find((r) => r.listingId === l.id);
  for (const [k, v] of Object.entries(c)) {
    if (v === undefined) continue;
    const key = k as keyof FieldChanges;
    recordEdit(run, key, (l as unknown as Record<string, unknown>)[key], v, quote);
    (l as unknown as Record<string, unknown>)[key] = v;
  }
  if (run && (c.priceAzn !== undefined || c.product !== undefined)) run.priceNote = priceNoteFor(l);
  if (run && run.status !== 'running') reviewStatus(run, l);
  emit();
}

/** Review state from what is still uncertain: weak fields, a doubtful photo, or a tomato lot with no photo yet. */
function reviewStatus(run: AiRun, l: Pick<Listing, 'product' | 'ripenessConfidence'>) {
  const weak = Object.entries(run.fields ?? {}).filter(([, f]) => f.confidence < 0.6).map(([k]) => FIELD_LABEL[k] ?? k);
  const doubtfulPhoto = l.ripenessConfidence > 0 && l.ripenessConfidence < 0.6;
  const tomatoNoPhoto = l.product === 'Tomato' && !l.ripenessConfidence;
  if (weak.length || doubtfulPhoto) {
    run.status = 'needs_review';
    run.note = `Check before buyers see it: ${[...weak, ...(doubtfulPhoto ? ['ripeness from the photo'] : [])].join(', ')} uncertain.`;
  } else {
    run.status = 'done';
    run.note = tomatoNoPhoto ? 'No photo yet: tomatoes are offered to buyers once a photo shows the ripeness.' : undefined;
  }
}

function priceNoteFor(l: Pick<Listing, 'product' | 'variety' | 'grade' | 'priceAzn' | 'id'>) {
  const live = getState().listings.filter((x) => x.id !== l.id && x.status === 'live' && x.product === l.product);
  const exact = live.filter((x) => x.variety === l.variety && x.grade === l.grade);
  const peers = exact.length ? exact : live;
  if (!peers.length) return 'No comparable listings today';
  const lo = Math.min(...peers.map((p) => p.priceAzn));
  const hi = Math.max(...peers.map((p) => p.priceAzn));
  const inRange = l.priceAzn >= lo * 0.9 && l.priceAzn <= hi * 1.1;
  return `${fmt(l.priceAzn)} ₼ ${inRange ? 'is within' : 'is outside'} today's range of ${fmt(lo)} to ${fmt(hi)} ₼ for ${peers.length} ${exact.length ? 'similar lots' : `${l.product.toLowerCase()} lots of any variety`}`;
}

// ---------- AI listing pipeline ----------

async function onDescription(farmerId: string, az: string) {
  const s = getState();
  const it = intakeFor(farmerId);
  const run = runOf(it);
  if (run.steps[0].status === 'pending') {
    run.steps[0].status = 'skipped';
    run.steps[0].output = 'Typed message, no audio';
  }
  it.transcriptAz = az;
  run.transcriptAz = az;
  run.waitingFor = undefined;
  const ex = await step(run, 'extract', async () => {
    const r = await extractListing(az, now(), s.settings.aiMode);
    it.modes.push(r.mode);
    const d = r.data;
    const parts = [d.product && `${d.product}${d.variety ? ` (${d.variety})` : ''}`, d.qtyKg && `${d.qtyKg} kg`, d.priceAzn && `${fmt(d.priceAzn)} ₼/kg`, d.grade && `grade ${d.grade}`];
    return { value: d, output: parts.filter(Boolean).join(' · ') || 'Nothing recognised', mode: r.mode, note: r.note };
  });
  it.extracted = ex;
  run.transcriptEn = ex.transcriptEn;
  run.fields = Object.fromEntries(
    (['product', 'variety', 'qtyKg', 'priceAzn', 'grade', 'harvest'] as const)
      .filter((k) => ex[k] !== undefined)
      .map((k) => [k, { value: String(ex[k]), confidence: ex.confidence[k] ?? 0.7 }]),
  );
  emit();
  // No photo yet: draft the listing anyway and ask for one, instead of waiting silently.
  return finishIntake(farmerId);
}

async function onPhoto(farmerId: string, photo: PhotoIn, voiceComing = false) {
  if (hasPendingOfferOrOrder(farmerId)) return;
  const s = getState();
  // A photo for a listing that is already drafted (or live without a photo) is added to it.
  const target = s.listings.find((l) => l.farmerId === farmerId && (l.status === 'draft' || (l.status === 'live' && l.source === 'whatsapp' && !l.photoUrl)));
  if (target && !voiceComing) return addPhotoToListing(target, photo);
  const it = intakeFor(farmerId);
  it.photo = photo;
  runOf(it).photoUrl = photo.url;
  emit();
  if (it.extracted) return finishIntake(farmerId);
  it.awaiting = 'voice';
  runOf(it).waitingFor = 'a voice note or text about the produce';
  if (voiceComing) return;
  say(farmerId, 'Şəkil alındı. İndi məhsul, miqdar və qiymət barədə səsli mesaj göndərin.', 'Photo received. Now send a voice note about the product, quantity and price.');
}

async function inspectInto(run: AiRun, photo: PhotoIn, modes: Mode[]) {
  const s = getState();
  return step(run, 'inspect', async () => {
    const r = await inspectPhoto(photo.buf, photo.mime ?? 'image/svg+xml', { aiMode: s.settings.aiMode, hintStage: photo.hintStage, hintSpoiled: photo.hintSpoiled });
    modes.push(r.mode);
    const d = r.data;
    return { value: d, mode: r.mode, note: r.note, output: d.spoiled ? `Spoilage visible: ${d.defects.join(', ')}` : `Stage ${d.ripeness}, ${stageInfo(d.ripeness).name} · ${Math.round(d.confidence * 100)}% confidence${d.defects.length ? ` · ${d.defects.join(', ')}` : ''}` };
  });
}

function holdSpoiled(farmerId: string, run: AiRun, defects: string[]) {
  run.status = 'needs_review';
  run.note = 'Held: spoilage visible in the photo. Not offered to buyers.';
  run.waitingFor = undefined;
  ledger({ type: 'ai', tone: 'alert', title: `Listing held: ${first(farmerId)}'s photo shows spoilage`, detail: defects.join(', ') });
  say(
    farmerId,
    'Şəkildə məhsulun bir hissəsi xarab görünür. Təhlükəsizlik üçün bu partiyanı alıcılara təklif edə bilmirik. Yeni şəkil göndərə bilərsiniz.',
    "Part of the produce looks spoiled in the photo. For safety we can't offer this lot to buyers. You can send a new photo.",
  );
}

async function addPhotoToListing(l: Listing, photo: PhotoIn) {
  const s = getState();
  let run = s.aiRuns.find((r) => r.listingId === l.id);
  if (!run) {
    run = newRun(l.farmerId);
    run.listingId = l.id;
    for (const st of run.steps) if (st.key !== 'inspect') st.status = 'skipped';
  }
  run.photoUrl = photo.url;
  run.status = 'running';
  const st = run.steps.find((x) => x.key === 'inspect')!;
  st.status = 'pending';
  const modes: Mode[] = [];
  const insp = await inspectInto(run, photo, modes);
  run.ripeness = insp.ripeness;
  run.ripenessConfidence = insp.confidence;
  run.defects = insp.defects;
  recordEdit(run, 'photo', l.photoUrl ? 'earlier photo' : 'none', `stage ${insp.ripeness}, ${Math.round(insp.confidence * 100)}%`);
  if (insp.spoiled) {
    l.status = 'withdrawn';
    return holdSpoiled(l.farmerId, run, insp.defects);
  }
  Object.assign(l, { photoUrl: photo.url, ripeness: insp.ripeness, ripenessConfidence: insp.confidence, defects: insp.defects });
  reviewStatus(run, l);
  if (l.status === 'draft') return sendDraftCard(l, 'Şəkil əlavə olundu.', 'Photo added.');
  run.waitingFor = undefined;
  ledger({ type: 'listing', tone: 'neutral', title: `${first(l.farmerId)} added a photo`, detail: `Stage ${insp.ripeness} · ${l.qtyKg} kg ${l.product.toLowerCase()}` });
  say(l.farmerId, 'Şəkil elana əlavə olundu. Təşəkkürlər!', 'The photo was added to your listing. Thank you!');
}

async function finishIntake(farmerId: string) {
  const s = getState();
  const it = intakes().get(farmerId)!;
  const run = runOf(it);
  const ex = it.extracted!;

  let insp: { ripeness: number; confidence: number; defects: string[]; spoiled?: boolean } | undefined = (it as Intake & { insp?: typeof insp }).insp;
  if (run.steps[2].status === 'pending' && it.photo) {
    insp = await inspectInto(run, it.photo, it.modes);
    run.ripeness = insp.ripeness;
    run.ripenessConfidence = insp.confidence;
    run.defects = insp.defects;
    if (insp.spoiled) {
      run.mode = aggregateMode(it.modes);
      for (const k of ['price', 'draft'] as const) run.steps.find((x) => x.key === k)!.status = 'skipped';
      intakes().delete(farmerId);
      return holdSpoiled(farmerId, run, insp.defects);
    }
    (it as Intake & { insp?: typeof insp }).insp = insp;
  } else if (run.steps[2].status === 'pending') {
    run.steps[2].status = 'skipped';
    run.steps[2].output = 'No photo yet: the farmer is asked for one';
  }

  // Missing fields: ask one question at a time.
  const ask = (field: Intake['awaiting'], what: string, az: string, en: string) => {
    it.awaiting = field;
    run.waitingFor = what;
    emit();
    return say(farmerId, az, en);
  };
  if (!ex.product) return ask('product', 'which product it is', 'Hansı məhsuldur?', 'Which product is it?');
  if (!ex.qtyKg) return ask('qtyKg', 'the quantity in kg', 'Neçə kiloqram var?', 'How many kilos do you have?');
  if (!ex.priceAzn) return ask('priceAzn', 'the selling price per kg', 'Kilosunu neçəyə satmaq istəyirsiniz?', 'What price per kilo do you want to sell at?');

  const draftShape = { id: '', product: ex.product, variety: ex.variety ?? 'Local', grade: ex.grade ?? 1, priceAzn: ex.priceAzn };
  const note = await step(run, 'price', async () => {
    const out = priceNoteFor(draftShape);
    return { value: out, output: out };
  });
  run.priceNote = note;

  const listing: Listing = {
    id: uid('l'),
    farmerId,
    product: ex.product,
    variety: ex.variety ?? 'Local',
    grade: ex.grade ?? 1,
    qtyKg: ex.qtyKg,
    priceAzn: ex.priceAzn,
    ripeness: insp?.ripeness ?? 0,
    ripenessConfidence: insp?.confidence ?? 0,
    defects: insp?.defects ?? [],
    harvest: ex.harvest ?? now().slice(0, 10),
    status: 'draft',
    photoUrl: it.photo?.url,
    audioUrl: run.audioUrl,
    transcriptAz: it.transcriptAz,
    transcriptEn: ex.transcriptEn,
    notes: ex.notes,
    createdAt: now(),
    source: 'whatsapp',
    aiRunId: run.id,
  };
  await step(run, 'draft', async () => ({ value: null, output: `${listing.qtyKg} kg ${listing.variety} at ${fmt(listing.priceAzn)} ₼${insp ? `, stage ${listing.ripeness}` : ', no photo yet'}, sent to ${first(farmerId)} to confirm` }));
  s.listings.push(listing);
  run.listingId = listing.id;
  run.mode = aggregateMode(it.modes);
  const weak = Object.entries(run.fields ?? {}).filter(([, f]) => f.confidence < 0.6).map(([k]) => k);
  reviewStatus(run, listing);
  intakes().delete(farmerId);
  ledger({ type: 'ai', tone: 'ai', title: `AI drafted a listing for ${first(farmerId)}`, detail: `${listing.qtyKg} kg ${listing.variety} ${listing.product.toLowerCase()}${insp ? `, stage ${listing.ripeness}` : ', no photo yet'}` });

  // Ask the farmer to double-check what the AI was unsure about, in plain words.
  const az: string[] = [];
  const en: string[] = [];
  if (weak.includes('priceAzn')) { az.push(`Qiyməti ${fmt(listing.priceAzn)} ₼ kimi yazdım, satış qiymətiniz budurmu?`); en.push(`I wrote the price as ${fmt(listing.priceAzn)} ₼, is that your selling price?`); }
  if (weak.includes('qtyKg')) { az.push(`Miqdarı ${listing.qtyKg} kq yazdım, düzdür?`); en.push(`I wrote ${listing.qtyKg} kg, is that right?`); }
  if (!insp) { az.push('Məhsulun şəklini də göndərin, alıcılar şəkilli elanlara daha çox güvənir.'); en.push('Please also send a photo of the produce; buyers trust listings with photos more.'); }
  sendDraftCard(listing, az.join(' ') || undefined, en.join(' ') || undefined);
}

function sendDraftCard(l: Listing, leadAz?: string, leadEn?: string, aiMode?: Mode) {
  const run = getState().aiRuns.find((r) => r.listingId === l.id);
  if (run) run.waitingFor = `confirmation on WhatsApp${l.ripenessConfidence ? '' : ', and a photo'}`;
  const harvestAz = sameBakuDay(l.harvest + 'T08:00:00Z', now()) ? 'bu gün' : l.harvest.split('-').reverse().slice(0, 2).join('.');
  const ripeAz = l.ripenessConfidence ? `${l.ripeness}/6, ${stageInfo(l.ripeness).az}` : 'şəkil gözlənilir';
  sendToFarmer(l.farmerId, {
    kind: 'card',
    text: leadAz ?? '',
    textEn: `${leadEn ? `${leadEn} ` : ''}Your listing: ${l.product} (${l.variety}), ${l.qtyKg} kg, ${fmt(l.priceAzn)} ₼/kg, grade ${l.grade}, ripeness ${l.ripenessConfidence ? `${l.ripeness}/6` : 'photo needed'}, harvest ${harvestAz === 'bu gün' ? 'today' : harvestAz}. Reply 1 to confirm, or just tell me what to change.`,
    ai: aiMode,
    card: {
      title: 'Elanınız hazırdır',
      rows: [
        ['Məhsul', `${AZ_PRODUCT[l.product] ?? l.product} (${l.variety})`],
        ['Miqdar', `${l.qtyKg} kq`],
        ['Qiymət', `${fmt(l.priceAzn)} ₼/kq`],
        ['Sort', `${l.grade}`],
        ['Yetişmə', ripeAz],
        ['Yığım', harvestAz],
      ],
      actions: [{ label: 'Təsdiq', reply: '1' }, { label: 'Düzəliş', reply: '2' }],
    },
  });
  emit();
}

function confirmListing(l: Listing) {
  l.status = 'live';
  const run = getState().aiRuns.find((r) => r.listingId === l.id);
  if (run) run.waitingFor = l.ripenessConfidence ? undefined : 'a photo (ripeness is unknown until then)';
  ledger({ type: 'listing', tone: 'good', title: `New listing live: ${first(l.farmerId)}, ${l.qtyKg} kg ${l.variety}`, detail: `Stage ${l.ripeness} · ${fmt(l.priceAzn)} ₼/kg` });
  say(l.farmerId, 'Elanınız aktivdir. Alıcı tapılan kimi xəbər verəcəyik.', "Your listing is live. We'll tell you as soon as a buyer is found.");
}

export function operatorApproveListing(listingId: string) {
  const l = getState().listings.find((x) => x.id === listingId);
  if (!l) return;
  const run = getState().aiRuns.find((r) => r.listingId === listingId);
  if (run) run.status = 'done';
  if (l.status === 'needs_review' || l.status === 'draft') confirmListing(l);
  else emit();
}

export function operatorRejectListing(listingId: string) {
  const l = getState().listings.find((x) => x.id === listingId);
  if (!l) return;
  l.status = 'rejected';
  const run = getState().aiRuns.find((r) => r.listingId === listingId);
  if (run) { run.status = 'needs_review'; run.note = 'Rejected by operator'; }
  say(l.farmerId, 'Bu elan dərc edilmədi. Sualınız olsa, yazın.', 'This listing was not published. Write to us if you have questions.');
}

// ---------- Buyer: matching and orders ----------

export async function findSupply(tenderId: string) {
  const s = getState();
  const t = s.tenders.find((x) => x.id === tenderId)!;
  t.status = 'matching';
  emit();
  const r = generateProposals(s, t, now());
  s.proposals = s.proposals.filter((p) => p.tenderId !== t.id).concat(r.proposals);
  t.proposalIds = r.proposals.map((p) => p.id);
  t.status = 'proposals';
  (t as typeof t & { checked?: number }).checked = r.checkedListings;
  ledger({ type: 'ai', tone: 'ai', title: `Matched ${t.id}: ${r.proposals.length} options from ${r.checkedListings} listings`, detail: r.proposals.map((p) => `${p.numeral}. ${p.title} ${fmt(p.costs.perKg)} ₼/kg`).join(' · ') });
  emit();
}

export function confirmProposal(proposalId: string): string {
  const s = getState();
  const p = s.proposals.find((x) => x.id === proposalId);
  if (!p) throw new Error(`Unknown proposal ${proposalId}`);
  const t = s.tenders.find((x) => x.id === p.tenderId)!;
  // A tender becomes one order; confirming twice (double click, retry) returns the same order.
  if (t.orderId) return t.orderId;
  // Order numbers follow the state, so a reset or a restart starts at O-2207 again.
  const orderSeq = Math.max(2206, ...s.orders.map((o) => Number(o.id.slice(2)) || 0));
  const order: Order = {
    id: `O-${orderSeq + 1}`,
    tenderId: t.id,
    proposalId: p.id,
    buyerId: t.buyerId,
    allocations: p.allocations.map((a) => ({ ...a, id: uid('a'), status: 'offered' })),
    route: p.route,
    costs: p.costs,
    status: 'offers_sent',
    escrow: { amount: p.costs.total, status: 'held', simulated: true },
    buyerRatings: {},
    farmerRatings: {},
    createdAt: now(),
  };
  s.orders.unshift(order);
  t.status = 'ordered';
  t.orderId = order.id;
  for (const a of order.allocations) {
    const l = s.listings.find((x) => x.id === a.listingId);
    if (l) l.status = 'reserved';
  }
  ledger({ type: 'order', tone: 'neutral', title: `${order.id} created from option ${p.numeral}`, detail: `${t.qtyKg} kg · ${fmt(p.costs.perKg)} ₼/kg`, orderId: order.id });
  ledger({ type: 'escrow', tone: 'neutral', title: `Buyer deposit of ${fmt(p.costs.total)} ₼ held`, detail: 'Simulated escrow, demo funds only', orderId: order.id });
  // The main farmer's offer goes last, so the docked phone lands on their chat.
  for (const a of [...order.allocations].reverse()) sendOffer(order, a);
  emit();
  return order.id;
}

function sendOffer(order: Order, a: Allocation) {
  const b = getState().buyers.find((x) => x.id === order.buyerId)!;
  const pickup = new Date(new Date(demoDeadline()).getTime() - 15 * 3600_000).toISOString();
  sendToFarmer(a.farmerId, {
    kind: 'card',
    text: 'Ödəniş təhlükəsiz hesabda saxlanılır (demo, real pul deyil).',
    textEn: `New order from ${b.name}: ${a.qtyKg} kg × ${fmt(a.priceAzn)} ₼ = ${fmt(a.qtyKg * a.priceAzn)} ₼. Pickup ${bakuTime(pickup)} today. Payment is held safely (demo, not real money). Reply 1 to accept, 2 to decline.`,
    card: {
      title: 'Yeni sifariş',
      rows: [
        ['Alıcı', b.name],
        ['Miqdar', `${a.qtyKg} kq × ${fmt(a.priceAzn)} ₼`],
        ['Məbləğ', `${fmt(a.qtyKg * a.priceAzn)} ₼`],
        ['Yığım', `bu gün, ${bakuTime(pickup)}`],
      ],
      actions: [{ label: 'Qəbul', reply: '1' }, { label: 'İmtina', reply: '2' }],
    },
  });
  ledger({ type: 'offer', tone: 'neutral', title: `Offer sent to ${first(a.farmerId)}: ${a.qtyKg} kg`, orderId: order.id });
}

function acceptOffer(order: Order, a: Allocation) {
  a.status = 'accepted';
  ledger({ type: 'accept', tone: 'good', title: `${farmer(a.farmerId).name} confirmed ${a.qtyKg} kg`, orderId: order.id });
  say(a.farmerId, 'Təşəkkürlər! Sifariş təsdiqləndi. Sürücü vaxtında gələcək.', 'Thank you! Order confirmed. The driver will come on time.');
  const rec = order.recovery;
  if (rec && rec.status === 'offered' && rec.selected !== undefined && rec.candidates[rec.selected].farmerId === a.farmerId) {
    finishRecovery(order);
  }
  const live = order.allocations.filter((x) => x.status !== 'cancelled' && x.status !== 'declined');
  if (live.every((x) => x.status === 'accepted') && order.status === 'offers_sent' && (!order.recovery || order.recovery.status === 'resolved')) {
    order.status = 'confirmed';
    ledger({ type: 'order', tone: 'good', title: `${order.id} confirmed: all ${live.length} farmers accepted`, orderId: order.id });
  }
  emit();
}

async function cancelAllocation(order: Order, a: Allocation, said: string, cause?: string) {
  const s = getState();
  const wasOffer = a.status === 'offered';
  a.status = wasOffer ? 'declined' : 'cancelled';
  const l = s.listings.find((x) => x.id === a.listingId);
  if (l) l.status = 'withdrawn';
  const known = Object.values(DEMO_VOICE).find((d) => d.az === said);
  ledger({
    type: 'cancel', tone: 'alert', orderId: order.id,
    title: `${farmer(a.farmerId).name} ${wasOffer ? 'declined' : 'drops'} ${a.qtyKg} kg`,
    quote: known?.en ?? cause ?? said,
    detail: known || cause ? 'Translated from WhatsApp' : undefined,
  });
  order.status = 'offers_sent';
  say(a.farmerId, 'Başa düşdük, çox təəssüf. Sifarişdən çıxarıldınız. Narahat olmayın, əvəzedici tapırıq.', "Understood, very sorry. You're removed from the order. Don't worry, we're finding a replacement.");

  order.recovery = { shortfallKg: a.qtyKg, cancelledFarmerId: a.farmerId, cause, candidates: [], status: 'searching', before: order.costs };
  ledger({ type: 'recovery', tone: 'ai', title: `AI re-matching ${a.qtyKg} kg`, detail: 'Other farmers stay as they are', orderId: order.id });
  emit();
  await sleep(Number(process.env.DEMO_RECOVERY_MS ?? 1800));
  const plan = planRecovery(s, { ...order, allocations: order.allocations.map((x) => (x.id === a.id ? { ...x, status: 'accepted' } : x)) }, a.farmerId, now(), cause);
  order.recovery = plan;
  if (plan.status === 'proposed') {
    const c = plan.candidates[plan.selected!];
    ledger({ type: 'recovery', tone: 'ai', title: `Backup found: ${farmer(c.farmerId).name}`, detail: `${c.qtyKg} kg · ${fmt(c.costs!.perKg)} ₼/kg delivered · waiting for operator`, orderId: order.id });
  } else {
    ledger({ type: 'recovery', tone: 'alert', title: 'No backup found', detail: 'Buyer chooses partial delivery, a later date or a refund', orderId: order.id });
  }
  emit();
}

export function operatorApproveRecovery(orderId: string, candidateIndex?: number) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  const rec = order?.recovery;
  if (!order || !rec || (rec.status !== 'proposed' && rec.status !== 'offered')) return;
  if (candidateIndex !== undefined && rec.candidates[candidateIndex]?.accepted) rec.selected = candidateIndex;
  const c = rec.candidates[rec.selected!];
  rec.after = c.costs;
  rec.status = 'offered';
  // Switching to another candidate withdraws the earlier backup offer.
  const candidateListings = new Set(rec.candidates.map((k) => k.listingId));
  for (const x of order.allocations.filter((y) => y.status === 'offered' && candidateListings.has(y.listingId) && y.listingId !== c.listingId)) {
    const ol = s.listings.find((q) => q.id === x.listingId);
    if (ol) ol.status = 'live';
  }
  order.allocations = order.allocations.filter((x) => !(x.status === 'offered' && candidateListings.has(x.listingId) && x.listingId !== c.listingId));
  if (order.allocations.some((x) => x.listingId === c.listingId)) return emit();
  const alloc: Allocation = { id: uid('a'), listingId: c.listingId, farmerId: c.farmerId, qtyKg: c.qtyKg, priceAzn: c.priceAzn, arrivalRipeness: c.arrivalRipeness, status: 'offered' };
  order.allocations.push(alloc);
  const l = s.listings.find((x) => x.id === c.listingId);
  if (l) l.status = 'reserved';
  sendOffer(order, alloc);
  emit();
}

function finishRecovery(order: Order) {
  const rec = order.recovery!;
  const c = rec.candidates[rec.selected!];
  const before = order.costs;
  order.costs = c.costs!;
  order.route = c.route!;
  const delta = Math.round((order.costs.total - order.escrow.amount) * 100) / 100;
  order.escrow.amount = order.costs.total;
  rec.status = 'resolved';
  const pct = ((order.costs.perKg - before.perKg) / before.perKg) * 100;
  order.priceNotice = `${farmer(rec.cancelledFarmerId).name} dropped out${rec.cause ? ` (${rec.cause.toLowerCase()})` : ''}. ${farmer(c.farmerId).name} now supplies ${c.qtyKg} kg. Delivered cost ${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kg (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%), within your 2% tolerance. Arrival unchanged.`;
  ledger({ type: 'recovery', tone: 'good', title: `Order repaired: ${first(c.farmerId)} fills ${c.qtyKg} kg`, detail: `${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kg · arrival unchanged`, orderId: order.id });
  if (delta !== 0) ledger({ type: 'escrow', tone: 'neutral', title: `Escrow adjusted by ${delta > 0 ? '+' : ''}${fmt(delta)} ₼`, detail: 'Simulated', orderId: order.id });
}

export function skipToThursday(orderId?: string) {
  const s = getState();
  setClock(demoDeadline());
  const order = orderId ? s.orders.find((o) => o.id === orderId) : s.orders.find((o) => o.status !== 'settled');
  if (order) {
    for (const a of order.allocations.filter((x) => x.status === 'accepted')) {
      a.status = 'picked_up';
      a.pickedKg = a.qtyKg;
      sendToFarmer(a.farmerId, { kind: 'text', text: `Sürücü ${a.qtyKg} kq götürdü. Keyfiyyət yoxlanıldı.`, textEn: `The driver picked up ${a.qtyKg} kg. Quality checked.` });
    }
    order.status = 'delivered';
    ledger({ type: 'delivery', tone: 'neutral', title: `${order.id} picked up from ${order.allocations.filter((x) => x.status === 'picked_up').length} farms`, orderId: order.id });
    ledger({ type: 'delivery', tone: 'good', title: `${order.id} arrived in Baku at 09:00`, detail: 'Waiting for buyer to confirm receipt', orderId: order.id });
  }
  emit();
}

export function confirmReceipt(orderId: string) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.status = 'settled';
  order.escrow.status = 'released';
  for (const a of order.allocations.filter((x) => x.status === 'picked_up')) {
    const l = s.listings.find((x) => x.id === a.listingId);
    if (l) l.status = 'sold';
    const amount = fmt(a.qtyKg * a.priceAzn);
    sendToFarmer(a.farmerId, {
      kind: 'text',
      text: `Ödəniş göndərildi: ${amount} ₼ (demo, real pul deyil). Alıcını 1-dən 5-ə qədər qiymətləndirin.`,
      textEn: `Payment sent: ${amount} ₼ (demo, not real money). Rate the buyer from 1 to 5.`,
    });
  }
  ledger({ type: 'escrow', tone: 'good', title: `Payout released to ${order.allocations.filter((x) => x.status === 'picked_up').length} farmers`, detail: 'Simulated, no real money moved', orderId: order.id });
  emit();
}

export function rateFarmer(orderId: string, farmerId: string, stars: number) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  if (!order) return;
  order.buyerRatings[farmerId] = stars;
  const f = farmer(farmerId);
  f.rating = Math.round(((f.rating * f.deals + stars) / (f.deals + 1)) * 10) / 10;
  f.deals += 1;
  ledger({ type: 'rating', tone: 'good', title: `Buyer rated ${f.name} ${stars}/5`, orderId });
  emit();
}

// ---------- Presenter controls ----------

export async function director(action: string, arg?: string) {
  const s = getState();
  switch (action) {
    case 'reset':
      intakes().clear();
      resetState();
      return;
    case 'offline': // F: cycle live → cached → simulated, or set one directly
    case 'aiMode': {
      const order: AiMode[] = ['live', 'cached', 'simulated'];
      s.settings.aiMode = order.includes(arg as AiMode) ? (arg as AiMode) : order[(order.indexOf(s.settings.aiMode) + 1) % order.length];
      return emit();
    }
    case 'voice': // V: voice replies on/off
      s.settings.voiceReplies = arg === 'on' ? true : arg === 'off' ? false : !s.settings.voiceReplies;
      return emit();
    case 'channel':
      s.settings.channel = arg === 'twilio' || arg === 'simulator' ? arg : s.settings.channel === 'twilio' ? 'simulator' : 'twilio';
      return emit();
    case 'acceptOthers': {
      const order = s.orders.find((o) => o.status === 'offers_sent');
      if (!order) return;
      for (const a of order.allocations.filter((x) => x.status === 'offered' && x.farmerId !== (arg ?? 'f-elsen'))) {
        await handleInbound({ farmerId: a.farmerId, text: 'Qəbul', via: 'simulator' });
        await sleep(400);
      }
      return;
    }
    case 'cancelRauf':
      return sendDemoVoice('rauf-cancel');
    case 'sebineHello':
      return handleInbound({ farmerId: 'f-sebine', text: DEMO_VOICE['sebine-hello'].az, via: 'simulator' });
    case 'thursday':
      return skipToThursday(arg);
    case 'elsenFallback': {
      if (s.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && l.status !== 'withdrawn')) return;
      s.listings.push({
        id: uid('l'), farmerId: 'f-elsen', ...elsenListingFields(), ripenessConfidence: 0.88, defects: [], status: 'live',
        photoUrl: '/demo/tomatoes-stage4.svg', transcriptAz: DEMO_VOICE['elsen-listing'].az, transcriptEn: DEMO_VOICE['elsen-listing'].en,
        createdAt: now(), source: 'whatsapp',
      });
      ledger({ type: 'listing', tone: 'good', title: 'New listing live: Elşən, 180 kg Roma', detail: 'Stage 4 · 1.15 ₼/kg' });
      return emit();
    }
  }
}

/** Send one of the scripted demo voice notes as if the farmer recorded it. Uses public/demo/<id>.ogg|.mp3|.m4a if present. */
export async function sendDemoVoice(id: string, withPhotoId?: string) {
  const v = DEMO_VOICE[id];
  if (!v) return;
  let audio: InboundAudio = { mime: 'audio/ogg', scriptedAz: v.az };
  for (const ext of ['ogg', 'mp3', 'm4a', 'webm']) {
    const buf = readPublic(`/demo/${id}.${ext}`);
    if (buf) {
      audio = { buf, mime: ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : `audio/${ext}`, url: `/demo/${id}.${ext}`, scriptedAz: v.az };
      break;
    }
  }
  const photo = withPhotoId ? demoPhoto(withPhotoId) : undefined;
  await handleInbound({ farmerId: v.farmerId, audio, photo, via: 'simulator' });
}

export function demoPhoto(id: string): PhotoIn | undefined {
  const p = DEMO_PHOTOS.find((x) => x.id === id);
  if (!p) return undefined;
  // A real photo can replace the placeholder: public/demo/<id>.jpg
  const jpg = readPublic(`/demo/${id}.jpg`);
  if (jpg) return { buf: jpg, mime: 'image/jpeg', url: `/demo/${id}.jpg`, hintStage: p.stage, hintSpoiled: id.includes('spoiled') };
  return { mime: 'image/svg+xml', url: p.url, hintStage: p.stage, hintSpoiled: id.includes('spoiled') };
}
