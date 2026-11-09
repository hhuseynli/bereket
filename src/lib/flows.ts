// Everything that changes state: the farmer's WhatsApp conversation, the AI listing pipeline, orders,
// cancellation and recovery, and the hidden presenter controls. Farmer-facing text is Azerbaijani with
// an English gloss shown in the demo.
import { canonicalProduct, classifyIntent, DEMO_PHOTOS, DEMO_VOICE, extractListing, inspectPhoto, readPublic, transcribe, wordsToDigits, type AiMode, type Extracted, type Inspection, type Mode, type PhotoProblem } from './ai';
import { farmerTurn, type ActionType, type FieldChanges, type TurnContext } from './agent';
import { costsFor, generateProposals, planRecovery } from './engine';
import { bestRoute } from './geo';
import { stageInfo, tracksRipeness } from './ripeness';
import { C, demoDeadline, elsenListingFields, seedListings } from './seed';
import { CITIES } from './map-features';
import { emit, farmer, getState, ledger, now, resetState, sendToFarmer, setClock, uid } from './store';
import type { AiRun, AiStep, Allocation, Farmer, Listing, Message, Order, RecoveryCandidate, Stop, Tender } from './types';

// Read at call time so tests (and the CLI) can change pacing after import.
const stepMs = () => Number(process.env.DEMO_STEP_MS ?? 750);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toFixed(2);
const first = (id: string) => farmer(id).name.split(' ')[0];
const AZ_PRODUCT: Record<string, string> = { Tomato: 'Pomidor', Cucumber: 'Xiyar', Apple: 'Alma', Potato: 'Kartof', Pepper: 'Bibər', Onion: 'Soğan', Pear: 'Armud', Cabbage: 'Kələm', Carrot: 'Yerkökü', Eggplant: 'Badımcan', Beans: 'Lobya', Quince: 'Heyva', Persimmon: 'Xurma', Hazelnut: 'Fındıq', Walnut: 'Qoz' };

/** Product name in Azerbaijani running text ("pomidor"). */
const azp = (p: string) => (AZ_PRODUCT[p] ?? p).toLocaleLowerCase('az');
const CAUSE_AZ: Record<string, string> = { 'Hail damaged the crop': 'dolu məhsulu vurdu', 'Farmer is ill': 'fermer xəstədir', 'Farmer cannot deliver': 'fermer çatdıra bilmir' };

function bakuTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' });
}
function sameBakuDay(a: string, b: string) {
  const d = (x: string) => new Date(x).toLocaleDateString('en-CA', { timeZone: 'Asia/Baku' });
  return d(a) === d(b);
}

/** When the driver collects an order: the evening before delivery (deadline − 15 h), never in the past. */
function pickupFor(order: Order) {
  const t = getState().tenders.find((x) => x.id === order.tenderId);
  const at = Math.max(new Date(t?.deadline ?? demoDeadline()).getTime() - 15 * 3600_000, new Date(now()).getTime() + 3600_000);
  return new Date(at).toISOString();
}
function dayLabel(iso: string): { az: string; en: string } {
  const tomorrow = new Date(new Date(now()).getTime() + 86_400_000).toISOString();
  if (sameBakuDay(iso, now())) return { az: 'bu gün', en: 'today' };
  if (sameBakuDay(iso, tomorrow)) return { az: 'sabah', en: 'tomorrow' };
  const d = new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Baku' }).replace('/', '.');
  return { az: d, en: d };
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
      { key: 'transcribe', label: 'Transcribe Azerbaijani voice note', labelAz: 'Azərbaycanca səsli mesajı mətnə çevir', status: 'pending' },
      { key: 'extract', label: 'Extract listing fields', labelAz: 'Elan sahələrini çıxar', status: 'pending' },
      { key: 'inspect', label: 'Inspect photo: ripeness and defects', labelAz: 'Şəkli yoxla: yetişmə və qüsurlar', status: 'pending' },
      { key: 'price', label: 'Check price against the region', labelAz: 'Qiyməti bölgə ilə müqayisə et', status: 'pending' },
      { key: 'draft', label: 'Draft listing for farmer to confirm', labelAz: 'Fermerin təsdiqi üçün elan hazırla', status: 'pending' },
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

async function step<T>(run: AiRun, key: AiStep['key'], fn: () => Promise<{ value: T; output: string; outputAz?: string; mode?: Mode; note?: string }>): Promise<T> {
  const s = run.steps.find((x) => x.key === key)!;
  s.status = 'running';
  emit();
  const t0 = Date.now();
  try {
    const { value, output, outputAz, mode, note } = await fn();
    const spent = Date.now() - t0;
    if (spent < stepMs()) await sleep(stepMs() - spent);
    s.status = 'done';
    s.output = output;
    s.outputAz = outputAz;
    s.mode = mode;
    s.note = note;
    s.ms = Date.now() - t0;
    emit();
    return value;
  } catch (err) {
    s.status = 'failed';
    s.output = (err as Error).message;
    s.outputAz = undefined;
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
          ? await transcribe(inb.audio!.buf, inb.audio!.mime, { aiMode: s.settings.aiMode, scriptedAz: inb.audio!.scriptedAz, lang: farmer(inb.farmerId).lang })
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
      ledger({ type: 'ai', tone: 'alert', title: `Could not transcribe ${first(inb.farmerId)}'s voice note`, titleAz: `${first(inb.farmerId)} fermerinin səsli mesajı mətnə çevrilə bilmədi`, detail: (err as Error).message.slice(0, 140) });
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
    if (order.status === 'settled' || order.status === 'cancelled') continue;
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
    const pickup = pickupFor(offered.order);
    facts.offer = { buyer: buyer(offered.order), qtyKg: offered.alloc.qtyKg, priceAzn: offered.alloc.priceAzn, totalAzn: fmt(offered.alloc.qtyKg * offered.alloc.priceAzn), pickup: `${dayLabel(pickup).en} ${bakuTime(pickup)}`, payment: 'held safely until delivery (demo)' };
  } else if (committed) {
    situation = 'order';
    allowed = ['cancel_order', 'reply'];
    facts.order = { buyer: buyer(committed.order), qtyKg: committed.alloc.qtyKg, priceAzn: committed.alloc.priceAzn, status: committed.order.status, pickup: `${dayLabel(pickupFor(committed.order)).en} ${bakuTime(pickupFor(committed.order))}, the driver comes to the farm` };
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
    situation, facts, allowed, fromVoice, history: historyFor(farmerId, msgId), lang: farmer(farmerId).lang ?? 'az',
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
    if (run) { run.waitingFor = 'a correction'; run.waitingForAz = 'düzəliş'; }
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
        if (run) { run.note = 'Withdrawn by the farmer'; run.noteAz = 'Fermer geri götürdü'; run.waitingFor = undefined; run.waitingForAz = undefined; }
        ledger({ type: 'listing', tone: 'neutral', title: `${first(farmerId)} withdrew ${l.qtyKg} kg ${l.product.toLowerCase()}`, titleAz: `${first(farmerId)} ${l.qtyKg} kq ${azp(l.product)} elanını geri götürdü` });
      } else if (it) {
        const run = runOf(it);
        run.status = 'done';
        run.note = 'Withdrawn by the farmer before the draft';
        run.noteAz = 'Fermer elan hazırlanmamış geri götürdü';
        run.waitingFor = undefined;
        run.waitingForAz = undefined;
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
        ledger({ type: 'listing', tone: 'neutral', title: `${first(farmerId)} updated the live listing`, titleAz: `${first(farmerId)} aktiv elanı yenilədi`, detail: `${liveLot.qtyKg} kg · ${fmt(liveLot.priceAzn)} ₼/kg`, detailAz: `${liveLot.qtyKg} kq · ${fmt(liveLot.priceAzn)} ₼/kq` });
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
  ledger({ type: 'rating', tone: 'good', title: `${first(farmerId)} rated the buyer ${stars}/5`, titleAz: `${first(farmerId)} alıcını ${stars}/5 qiymətləndirdi`, orderId: order.id });
  return say(farmerId, 'Təşəkkürlər! Qiymətiniz qeydə alındı.', 'Thank you! Your rating is saved.');
}

const FIELD_LABEL: Record<string, string> = { product: 'product', variety: 'variety', grade: 'grade', qtyKg: 'quantity', priceAzn: 'price', harvest: 'harvest', notes: 'notes', photo: 'photo' };
const FIELD_LABEL_AZ: Record<string, string> = { product: 'məhsul', variety: 'növ', grade: 'sort', qtyKg: 'miqdar', priceAzn: 'qiymət', harvest: 'yığım', notes: 'qeydlər', photo: 'şəkil' };

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
  if (run && (c.priceAzn !== undefined || c.product !== undefined)) setPriceNote(run, l);
  if (run && run.status !== 'running') reviewStatus(run, l);
  emit();
}

/** Review state from what is still uncertain: weak fields, a doubtful photo, or a tomato lot with no photo yet. */
function reviewStatus(run: AiRun, l: Pick<Listing, 'product' | 'ripenessConfidence'>) {
  const weakKeys = Object.entries(run.fields ?? {}).filter(([, f]) => f.confidence < 0.6).map(([k]) => k);
  const weak = weakKeys.map((k) => FIELD_LABEL[k] ?? k);
  const weakAz = weakKeys.map((k) => FIELD_LABEL_AZ[k] ?? k);
  const doubtfulPhoto = l.ripenessConfidence > 0 && l.ripenessConfidence < 0.6;
  const tomatoNoPhoto = l.product === 'Tomato' && !l.ripenessConfidence;
  if (weak.length || doubtfulPhoto) {
    run.status = 'needs_review';
    run.note = `Check before buyers see it: ${[...weak, ...(doubtfulPhoto ? ['ripeness from the photo'] : [])].join(', ')} uncertain.`;
    run.noteAz = `Alıcılar görməzdən əvvəl yoxlayın: ${[...weakAz, ...(doubtfulPhoto ? ['şəkildən yetişmə'] : [])].join(', ')} dəqiq deyil.`;
  } else {
    run.status = 'done';
    run.note = tomatoNoPhoto ? 'No photo yet: tomatoes are offered to buyers once a photo shows the ripeness.' : undefined;
    run.noteAz = tomatoNoPhoto ? 'Hələ şəkil yoxdur: pomidor alıcılara şəkil yetişməni göstərəndən sonra təklif edilir.' : undefined;
  }
}

/** The price check against today's live lots, in English and Azerbaijani. */
function priceNoteFor(l: Pick<Listing, 'product' | 'variety' | 'grade' | 'priceAzn' | 'id'>): { en: string; az: string } {
  const live = getState().listings.filter((x) => x.id !== l.id && x.status === 'live' && x.product === l.product);
  const exact = live.filter((x) => x.variety === l.variety && x.grade === l.grade);
  const peers = exact.length ? exact : live;
  if (!peers.length) return { en: 'No comparable listings today', az: 'Bu gün müqayisə üçün elan yoxdur' };
  const lo = Math.min(...peers.map((p) => p.priceAzn));
  const hi = Math.max(...peers.map((p) => p.priceAzn));
  const inRange = l.priceAzn >= lo * 0.9 && l.priceAzn <= hi * 1.1;
  return {
    en: `${fmt(l.priceAzn)} ₼ ${inRange ? 'is within' : 'is outside'} today's range of ${fmt(lo)} to ${fmt(hi)} ₼ for ${peers.length} ${exact.length ? 'similar lots' : `${l.product.toLowerCase()} lots of any variety`}`,
    az: `${fmt(l.priceAzn)} ₼ bu gün ${peers.length} ${exact.length ? 'oxşar partiya' : `${azp(l.product)} partiyası (istənilən növ)`} üzrə ${fmt(lo)}–${fmt(hi)} ₼ aralığının ${inRange ? 'daxilindədir' : 'xaricindədir'}`,
  };
}
function setPriceNote(run: AiRun, l: Pick<Listing, 'product' | 'variety' | 'grade' | 'priceAzn' | 'id'>) {
  const n = priceNoteFor(l);
  run.priceNote = n.en;
  run.priceNoteAz = n.az;
  return n;
}

// ---------- AI listing pipeline ----------

async function onDescription(farmerId: string, az: string) {
  const s = getState();
  const it = intakeFor(farmerId);
  const run = runOf(it);
  if (run.steps[0].status === 'pending') {
    run.steps[0].status = 'skipped';
    run.steps[0].output = 'Typed message, no audio';
    run.steps[0].outputAz = 'Yazılı mesaj, səs yoxdur';
  }
  it.transcriptAz = az;
  run.transcriptAz = az;
  run.waitingFor = undefined;
  run.waitingForAz = undefined;
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
  runOf(it).waitingForAz = 'məhsul haqqında səsli və ya yazılı mesaj';
  if (voiceComing) return;
  say(farmerId, 'Şəkil alındı. İndi məhsul, miqdar və qiymət barədə səsli mesaj göndərin.', 'Photo received. Now send a voice note about the product, quantity and price.');
}

const isTomato = (product?: string) => tracksRipeness(canonicalProduct(product) ?? product ?? 'Tomato');
const FRESH_AZ = { fresh: 'təzə', aging: 'təzəliyini itirməyə başlayıb', old: 'köhnə görünür' } as const;

async function inspectInto(run: AiRun, photo: PhotoIn, modes: Mode[]) {
  const s = getState();
  return step(run, 'inspect', async () => {
    const r = await inspectPhoto(photo.buf, photo.mime ?? 'image/svg+xml', { aiMode: s.settings.aiMode, hintStage: photo.hintStage, hintSpoiled: photo.hintSpoiled });
    modes.push(r.mode);
    const d = r.data;
    const output = d.problem
      ? `Photo not usable: ${PHOTO_REJECT[d.problem].why}${d.note ? ` (${d.note})` : ''}`
      : d.spoiled
        ? `Spoilage visible: ${d.defects.join(', ')}`
        : `${d.product ? `${d.product} · ` : ''}${isTomato(d.product) ? `Stage ${d.ripeness}, ${stageInfo(d.ripeness).name}` : `Looks ${d.freshness}`} · ${Math.round(d.confidence * 100)}% confidence${isTomato(d.product) && d.freshness !== 'fresh' ? ` · looks ${d.freshness}` : ''}${d.grade ? ` · grade ${d.grade} by eye` : ''}${d.defects.length ? ` · ${d.defects.join(', ')}` : ''}`;
    const seenAz = d.product ? AZ_PRODUCT[canonicalProduct(d.product) ?? ''] ?? d.product : '';
    const outputAz = d.problem
      ? `Şəkil yararsızdır: ${PHOTO_REJECT[d.problem].whyAz}${d.note ? ` (${d.note})` : ''}`
      : d.spoiled
        ? `Xarablıq görünür: ${d.defects.join(', ')}`
        : `${seenAz ? `${seenAz} · ` : ''}${isTomato(d.product) ? `Mərhələ ${d.ripeness}, ${stageInfo(d.ripeness).az}` : FRESH_AZ[d.freshness]} · ${Math.round(d.confidence * 100)}% əminlik${isTomato(d.product) && d.freshness !== 'fresh' ? ` · ${FRESH_AZ[d.freshness]}` : ''}${d.grade ? ` · gözlə sort ${d.grade}` : ''}${d.defects.length ? ` · ${d.defects.join(', ')}` : ''}`;
    return { value: d, mode: r.mode, note: r.note, output, outputAz };
  });
}

// ---------- Photo checks: buyers pay for what the photo shows ----------

const PHOTO_REJECT: Record<PhotoProblem, { why: string; whyAz: string; az: string; en: string }> = {
  not_produce: {
    why: 'no produce in the photo',
    whyAz: 'şəkildə məhsul yoxdur',
    az: 'Bu şəkildə məhsul görünmür. Zəhmət olmasa, satdığınız məhsulun şəklini çəkib göndərin.',
    en: "There's no produce in this photo. Please take a photo of the produce you are selling and send it.",
  },
  not_a_real_photo: {
    why: 'a drawing, edited or stock image, not a photo of the lot',
    whyAz: 'rəsm, redaktə olunmuş və ya internetdən şəkil, partiyanın şəkli deyil',
    az: 'Bu, sizin məhsulunuzun real şəkli kimi görünmür (rəsm, redaktə olunmuş və ya internetdən şəkil). Alıcılar məhsulun özünü görmək istəyir: zəhmət olmasa, indi kamera ilə çəkib göndərin.',
    en: "This doesn't look like a real photo of your produce (a drawing, an edited or an internet image). Buyers want to see the produce itself: please take one with the camera now and send it.",
  },
  screen: {
    why: 'a photo of a screen',
    whyAz: 'ekrandan çəkilmiş şəkil',
    az: 'Bu şəkil ekrandan çəkilib. Zəhmət olmasa, məhsulun özünün şəklini kamera ilə çəkib göndərin.',
    en: 'This photo was taken of a screen. Please photograph the produce itself with the camera and send it.',
  },
  cooked_or_processed: {
    why: 'cooked or processed food, not a harvested lot',
    whyAz: 'bişmiş və ya emal olunmuş məhsul, yığılmış partiya deyil',
    az: 'Şəkildə bişmiş və ya emal olunmuş məhsul görünür. Satış üçün yığılmış təzə məhsulun şəklini göndərin.',
    en: 'The photo shows cooked or processed food. Please send a photo of the fresh, harvested produce you are selling.',
  },
  unclear: {
    why: 'too blurry, dark or far to judge',
    whyAz: 'qiymətləndirmək üçün çox bulanıq, qaranlıq və ya uzaqdır',
    az: 'Şəkil aydın deyil. Zəhmət olmasa, işıqlı yerdə, məhsula yaxından yenidən çəkib göndərin.',
    en: 'The photo is not clear enough. Please take it again in good light, close to the produce.',
  },
};

const azProduct = (p: string) => (AZ_PRODUCT[p] ?? p).toLocaleLowerCase('az');

type PhotoVerdict =
  | { kind: 'reject'; why: string; whyAz?: string; az: string; en: string }
  | { kind: 'hold'; why: string; whyAz?: string; az: string; en: string; defects: string[] }
  | { kind: 'use'; minGrade?: 2 | 3; az?: string; en?: string };

/**
 * What a photo may do for a listing of `product`: rejected (the farmer is asked for another, nothing changes), the lot
 * held from buyers (spoiled or old produce), or used, possibly at a lower grade than the farmer said.
 */
export function judgePhoto(insp: Inspection, product?: string): PhotoVerdict {
  if (insp.problem) return { kind: 'reject', ...PHOTO_REJECT[insp.problem] };
  const seen = canonicalProduct(insp.product);
  if (product && seen && seen !== product)
    return {
      kind: 'reject',
      why: `the photo shows ${seen.toLowerCase()}, the listing is for ${product.toLowerCase()}`,
      whyAz: `şəkildə ${azProduct(seen)} görünür, elan isə ${azProduct(product)} üçündür`,
      az: `Şəkildə ${azProduct(seen)} görünür, amma elanınız ${azProduct(product)} üçündür. ${AZ_PRODUCT[product] ?? product} şəklini göndərin, ya da elanı dəyişmək üçün yazın.`,
      en: `The photo shows ${seen.toLowerCase()}, but your listing is for ${product.toLowerCase()}. Send a photo of the ${product.toLowerCase()}, or write to change the listing.`,
    };
  if (insp.spoiled)
    return {
      kind: 'hold', defects: insp.defects, why: 'spoilage visible in the photo', whyAz: 'şəkildə xarablıq görünür',
      az: 'Şəkildə məhsulun bir hissəsi xarab görünür. Təhlükəsizlik üçün bu partiyanı alıcılara təklif edə bilmirik. Yeni şəkil göndərə bilərsiniz.',
      en: "Part of the produce looks spoiled in the photo. For safety we can't offer this lot to buyers. You can send a new photo.",
    };
  if (insp.freshness === 'old')
    return {
      kind: 'hold', defects: insp.defects, why: 'the produce looks old (wrinkled, wilted or long past harvest)',
      whyAz: 'məhsul köhnə görünür (qırışmış, solmuş və ya yığımdan çox keçib)',
      az: 'Şəkildəki məhsul köhnə görünür (qırışmış və ya solmuş). Bu partiyanı alıcılara təklif edə bilmirik. Bu günün təzə məhsulunun şəklini göndərə bilərsiniz.',
      en: "The produce in the photo looks old (wrinkled or wilted). We can't offer this lot to buyers. You can send a photo of today's fresh produce.",
    };
  // A lower grade only when the model also names what it saw, so a vague "2" does not downgrade a good lot.
  const byEye = insp.grade && insp.grade > 1 && insp.defects.length ? insp.grade : undefined;
  const minGrade = Math.max(byEye ?? 1, insp.freshness === 'aging' ? 2 : 1);
  if (minGrade < 2) return { kind: 'use' };
  const g = minGrade as 2 | 3;
  return {
    kind: 'use', minGrade: g,
    az: `Şəkilə görə məhsul ${g}-ci sort kimi görünür${insp.freshness === 'aging' ? ' (bir qismi təzəliyini itirib)' : ''}, elanı ${g}-ci sort yazdım. Razı deyilsinizsə, daha yaxşı şəkil göndərin.`,
    en: `From the photo the produce looks grade ${g}${insp.freshness === 'aging' ? ' (some of it is no longer fresh)' : ''}, so I listed it as grade ${g}. If you disagree, send a better photo.`,
  };
}

function holdPhoto(farmerId: string, run: AiRun, v: Extract<PhotoVerdict, { kind: 'hold' }>) {
  run.status = 'needs_review';
  run.note = `Held: ${v.why}. Not offered to buyers.`;
  run.noteAz = `Saxlanılır: ${v.whyAz ?? v.why}. Alıcılara təklif edilmir.`;
  run.waitingFor = undefined;
  run.waitingForAz = undefined;
  ledger({ type: 'ai', tone: 'alert', title: `Listing held: ${first(farmerId)}'s photo, ${v.why}`, titleAz: `Elan saxlanılır: ${first(farmerId)} fermerinin şəkli, ${v.whyAz ?? v.why}`, detail: v.defects.join(', ') });
  say(farmerId, v.az, v.en);
}

function rejectPhoto(farmerId: string, run: AiRun, v: Extract<PhotoVerdict, { kind: 'reject' }>) {
  run.waitingFor = 'a real photo of the produce';
  run.waitingForAz = 'məhsulun real şəkli';
  ledger({ type: 'ai', tone: 'alert', title: `Photo from ${first(farmerId)} not used: ${v.why}`, titleAz: `${first(farmerId)} fermerinin şəkli istifadə edilmədi: ${v.whyAz ?? v.why}` });
  say(farmerId, v.az, v.en);
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
  const v = judgePhoto(insp, l.product);
  if (v.kind === 'reject') {
    reviewStatus(run, l); // the listing stays as it was
    return rejectPhoto(l.farmerId, run, v);
  }
  run.ripeness = insp.ripeness;
  run.ripenessConfidence = insp.confidence;
  run.defects = insp.defects;
  recordEdit(run, 'photo', l.photoUrl ? 'earlier photo' : 'none', `stage ${insp.ripeness}, ${Math.round(insp.confidence * 100)}%`);
  if (v.kind === 'hold') {
    l.status = 'withdrawn';
    return holdPhoto(l.farmerId, run, v);
  }
  Object.assign(l, { photoUrl: photo.url, ripeness: insp.ripeness, ripenessConfidence: insp.confidence, defects: insp.defects, freshness: insp.freshness });
  run.freshness = insp.freshness;
  if (v.minGrade && v.minGrade > l.grade) {
    recordEdit(run, 'grade', String(l.grade), `${v.minGrade} (from the photo)`);
    l.grade = v.minGrade;
  }
  reviewStatus(run, l);
  if (l.status === 'draft') return sendDraftCard(l, v.az ?? 'Şəkil əlavə olundu.', v.en ?? 'Photo added.');
  run.waitingFor = undefined;
  run.waitingForAz = undefined;
  ledger({
    type: 'listing', tone: 'neutral', title: `${first(l.farmerId)} added a photo`, titleAz: `${first(l.farmerId)} şəkil əlavə etdi`,
    detail: `${tracksRipeness(l.product) ? `Stage ${insp.ripeness}` : `Looks ${insp.freshness}`} · grade ${l.grade} · ${l.qtyKg} kg ${l.product.toLowerCase()}`,
    detailAz: `${tracksRipeness(l.product) ? `Mərhələ ${insp.ripeness}` : FRESH_AZ[insp.freshness]} · sort ${l.grade} · ${l.qtyKg} kq ${azp(l.product)}`,
  });
  say(l.farmerId, v.az ?? 'Şəkil elana əlavə olundu. Təşəkkürlər!', v.en ?? 'The photo was added to your listing. Thank you!');
}

async function finishIntake(farmerId: string) {
  const s = getState();
  const it = intakes().get(farmerId)!;
  const run = runOf(it);
  const ex = it.extracted!;

  type Kept = { ripeness: number; confidence: number; defects: string[]; freshness?: Inspection['freshness']; minGrade?: 2 | 3; az?: string; en?: string };
  let insp: Kept | undefined = (it as Intake & { insp?: Kept }).insp;
  if (run.steps[2].status === 'pending' && it.photo) {
    const raw = await inspectInto(run, it.photo, it.modes);
    const v = judgePhoto(raw, ex.product);
    if (v.kind === 'reject') {
      // The photo is dropped; the listing goes on from the voice note and asks for a real photo.
      it.photo = undefined;
      run.photoUrl = undefined;
      rejectPhoto(farmerId, run, v);
    } else {
      run.ripeness = raw.ripeness;
      run.ripenessConfidence = raw.confidence;
      run.defects = raw.defects;
      if (v.kind === 'hold') {
        run.mode = aggregateMode(it.modes);
        for (const k of ['price', 'draft'] as const) run.steps.find((x) => x.key === k)!.status = 'skipped';
        intakes().delete(farmerId);
        return holdPhoto(farmerId, run, v);
      }
      insp = { ripeness: raw.ripeness, confidence: raw.confidence, defects: raw.defects, freshness: raw.freshness, minGrade: v.minGrade, az: v.az, en: v.en };
      run.freshness = raw.freshness;
      (it as Intake & { insp?: Kept }).insp = insp;
    }
  } else if (run.steps[2].status === 'pending') {
    run.steps[2].status = 'skipped';
    run.steps[2].output = 'No photo yet: the farmer is asked for one';
    run.steps[2].outputAz = 'Hələ şəkil yoxdur: fermerdən şəkil istənilir';
  }

  // Missing fields: ask one question at a time.
  const ask = (field: Intake['awaiting'], what: string, whatAz: string, az: string, en: string) => {
    it.awaiting = field;
    run.waitingFor = what;
    run.waitingForAz = whatAz;
    emit();
    return say(farmerId, az, en);
  };
  if (!ex.product) return ask('product', 'which product it is', 'hansı məhsul olduğu', 'Hansı məhsuldur?', 'Which product is it?');
  if (!ex.qtyKg) return ask('qtyKg', 'the quantity in kg', 'kq ilə miqdar', 'Neçə kiloqram var?', 'How many kilos do you have?');
  if (!ex.priceAzn) return ask('priceAzn', 'the selling price per kg', '1 kq üçün satış qiyməti', 'Kilosunu neçəyə satmaq istəyirsiniz?', 'What price per kilo do you want to sell at?');

  const draftShape = { id: '', product: ex.product, variety: ex.variety ?? 'Local', grade: ex.grade ?? 1, priceAzn: ex.priceAzn };
  await step(run, 'price', async () => {
    const out = setPriceNote(run, draftShape);
    return { value: out, output: out.en, outputAz: out.az };
  });

  const listing: Listing = {
    id: uid('l'),
    farmerId,
    product: ex.product,
    variety: ex.variety ?? 'Local',
    grade: Math.max(ex.grade ?? 1, insp?.minGrade ?? 1) as 1 | 2 | 3,
    qtyKg: ex.qtyKg,
    priceAzn: ex.priceAzn,
    ripeness: insp?.ripeness ?? 0,
    freshness: insp?.freshness,
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
  await step(run, 'draft', async () => ({
    value: null,
    output: `${listing.qtyKg} kg ${listing.variety} at ${fmt(listing.priceAzn)} ₼${insp ? (tracksRipeness(listing.product) ? `, stage ${listing.ripeness}` : `, looks ${listing.freshness ?? 'fresh'}`) : ', no photo yet'}, sent to ${first(farmerId)} to confirm`,
    outputAz: `${listing.qtyKg} kq ${listing.variety}, ${fmt(listing.priceAzn)} ₼${insp ? (tracksRipeness(listing.product) ? `, mərhələ ${listing.ripeness}` : `, ${FRESH_AZ[listing.freshness ?? 'fresh']}`) : ', hələ şəkil yoxdur'}, təsdiq üçün ${first(farmerId)} fermerinə göndərildi`,
  }));
  s.listings.push(listing);
  run.listingId = listing.id;
  run.mode = aggregateMode(it.modes);
  const weak = Object.entries(run.fields ?? {}).filter(([, f]) => f.confidence < 0.6).map(([k]) => k);
  reviewStatus(run, listing);
  intakes().delete(farmerId);
  ledger({
    type: 'ai', tone: 'ai', title: `AI drafted a listing for ${first(farmerId)}`, titleAz: `Sİ ${first(farmerId)} üçün elan hazırladı`,
    detail: `${listing.qtyKg} kg ${listing.variety} ${listing.product.toLowerCase()}${insp ? (tracksRipeness(listing.product) ? `, stage ${listing.ripeness}` : `, looks ${listing.freshness ?? 'fresh'}`) : ', no photo yet'}`,
    detailAz: `${listing.qtyKg} kq ${listing.variety} ${azp(listing.product)}${insp ? (tracksRipeness(listing.product) ? `, mərhələ ${listing.ripeness}` : `, ${FRESH_AZ[listing.freshness ?? 'fresh']}`) : ', hələ şəkil yoxdur'}`,
  });

  // Ask the farmer to double-check what the AI was unsure about, in plain words.
  const az: string[] = [];
  const en: string[] = [];
  if (weak.includes('priceAzn')) { az.push(`Qiyməti ${fmt(listing.priceAzn)} ₼ kimi yazdım, satış qiymətiniz budurmu?`); en.push(`I wrote the price as ${fmt(listing.priceAzn)} ₼, is that your selling price?`); }
  if (weak.includes('qtyKg')) { az.push(`Miqdarı ${listing.qtyKg} kq yazdım, düzdür?`); en.push(`I wrote ${listing.qtyKg} kg, is that right?`); }
  if (insp?.az && insp.minGrade && insp.minGrade > (ex.grade ?? 1)) { az.push(insp.az); en.push(insp.en!); }
  if (!insp && run.waitingFor !== 'a real photo of the produce') { az.push('Məhsulun şəklini də göndərin, alıcılar şəkilli elanlara daha çox güvənir.'); en.push('Please also send a photo of the produce; buyers trust listings with photos more.'); }
  sendDraftCard(listing, az.join(' ') || undefined, en.join(' ') || undefined);
}

function sendDraftCard(l: Listing, leadAz?: string, leadEn?: string, aiMode?: Mode) {
  const run = getState().aiRuns.find((r) => r.listingId === l.id);
  if (run) {
    run.waitingFor = `confirmation on WhatsApp${l.ripenessConfidence ? '' : ', and a photo'}`;
    run.waitingForAz = `WhatsApp-da təsdiq${l.ripenessConfidence ? '' : ' və şəkil'}`;
  }
  const harvestAz = sameBakuDay(l.harvest + 'T08:00:00Z', now()) ? 'bu gün' : l.harvest.split('-').reverse().slice(0, 2).join('.');
  // Tomatoes: the ripeness stage. Everything else: how fresh it looks.
  const tomato = tracksRipeness(l.product);
  const ripeAz = !l.ripenessConfidence ? 'şəkil gözlənilir' : tomato ? `${l.ripeness}/6, ${stageInfo(l.ripeness).az}` : FRESH_AZ[l.freshness ?? 'fresh'];
  const ripeEn = !l.ripenessConfidence ? 'photo needed' : tomato ? `${l.ripeness}/6` : `looks ${l.freshness ?? 'fresh'}`;
  sendToFarmer(l.farmerId, {
    kind: 'card',
    text: leadAz ?? '',
    textEn: `${leadEn ? `${leadEn} ` : ''}Your listing: ${l.product} (${l.variety}), ${l.qtyKg} kg, ${fmt(l.priceAzn)} ₼/kg, grade ${l.grade}, ${tomato ? 'ripeness' : 'freshness'} ${ripeEn}, harvest ${harvestAz === 'bu gün' ? 'today' : harvestAz}. Reply 1 to confirm, or just tell me what to change.`,
    ai: aiMode,
    card: {
      title: 'Elanınız hazırdır',
      rows: [
        ['Məhsul', `${AZ_PRODUCT[l.product] ?? l.product} (${l.variety})`],
        ['Miqdar', `${l.qtyKg} kq`],
        ['Qiymət', `${fmt(l.priceAzn)} ₼/kq`],
        ['Sort', `${l.grade}`],
        [tomato ? 'Yetişmə' : 'Təzəlik', ripeAz],
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
  if (run) {
    run.waitingFor = l.ripenessConfidence ? undefined : 'a photo (ripeness is unknown until then)';
    run.waitingForAz = l.ripenessConfidence ? undefined : 'şəkil (o vaxtadək yetişmə bilinmir)';
  }
  ledger({
    type: 'listing', tone: 'good', title: `New listing live: ${first(l.farmerId)}, ${l.qtyKg} kg ${l.variety}`, titleAz: `Yeni elan aktivdir: ${first(l.farmerId)}, ${l.qtyKg} kq ${l.variety}`,
    detail: `${tracksRipeness(l.product) ? `Stage ${l.ripeness}` : `Grade ${l.grade}`} · ${fmt(l.priceAzn)} ₼/kg`, detailAz: `${tracksRipeness(l.product) ? `Mərhələ ${l.ripeness}` : `Sort ${l.grade}`} · ${fmt(l.priceAzn)} ₼/kq`,
  });
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
  if (run) { run.status = 'needs_review'; run.note = 'Rejected by operator'; run.noteAz = 'Operator rədd etdi'; }
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
  ledger({
    type: 'ai', tone: 'ai', title: `Matched ${t.id}: ${r.proposals.length} options from ${r.checkedListings} listings`,
    titleAz: `${t.id} uyğunlaşdırıldı: ${r.checkedListings} elandan ${r.proposals.length} variant`,
    detail: r.proposals.map((p) => `${p.numeral}. ${p.title} ${fmt(p.costs.perKg)} ₼/kg`).join(' · '),
    detailAz: r.proposals.map((p) => `${p.numeral}. ${p.titleAz ?? p.title} ${fmt(p.costs.perKg)} ₼/kq`).join(' · '),
  });
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
  for (const a of order.allocations) reserveLot(a);
  ledger({
    type: 'order', tone: 'neutral', title: `${order.id} created from option ${p.numeral}`, titleAz: `${order.id} sifarişi ${p.numeral} variantından yaradıldı`,
    detail: `${t.qtyKg} kg · ${fmt(p.costs.perKg)} ₼/kg`, detailAz: `${t.qtyKg} kq · ${fmt(p.costs.perKg)} ₼/kq`, orderId: order.id,
  });
  ledger({
    type: 'escrow', tone: 'neutral', title: `Buyer deposit of ${fmt(p.costs.total)} ₼ held`, titleAz: `Alıcının ${fmt(p.costs.total)} ₼ depoziti əmanət hesabında saxlanılır`,
    detail: 'Simulated escrow, demo funds only', detailAz: 'Simulyasiya əmanət hesabı, yalnız demo vəsait', orderId: order.id,
  });
  // The main farmer's offer goes last, so the docked phone lands on their chat.
  for (const a of [...order.allocations].reverse()) sendOffer(order, a);
  emit();
  return order.id;
}

/** Reserve what an order takes from a lot; the rest of the lot stays on sale as its own listing. */
function reserveLot(a: Allocation) {
  const s = getState();
  const l = s.listings.find((x) => x.id === a.listingId);
  if (!l) return;
  if (a.qtyKg < l.qtyKg) {
    s.listings.push({ ...l, id: uid('l'), qtyKg: l.qtyKg - a.qtyKg, status: 'live', aiRunId: undefined });
    l.qtyKg = a.qtyKg;
  }
  l.status = 'reserved';
}

function sendOffer(order: Order, a: Allocation) {
  const b = getState().buyers.find((x) => x.id === order.buyerId)!;
  const pickup = pickupFor(order);
  const day = dayLabel(pickup);
  const l = getState().listings.find((x) => x.id === a.listingId);
  sendToFarmer(a.farmerId, {
    kind: 'card',
    text: 'Ödəniş təhlükəsiz hesabda saxlanılır (demo, real pul deyil).',
    textEn: `New order from ${b.name}: ${l ? `${l.product.toLowerCase()}, ` : ''}${a.qtyKg} kg × ${fmt(a.priceAzn)} ₼ = ${fmt(a.qtyKg * a.priceAzn)} ₼. Pickup ${day.en} ${bakuTime(pickup)}. Payment is held safely (demo, not real money). Reply 1 to accept, 2 to decline.`,
    card: {
      title: 'Yeni sifariş',
      rows: [
        ['Alıcı', b.name],
        ...(l ? [['Məhsul', `${AZ_PRODUCT[l.product] ?? l.product} (${l.variety})`] as [string, string]] : []),
        ['Miqdar', `${a.qtyKg} kq × ${fmt(a.priceAzn)} ₼`],
        ['Məbləğ', `${fmt(a.qtyKg * a.priceAzn)} ₼`],
        ['Yığım', `${day.az}, ${bakuTime(pickup)}`],
      ],
      actions: [{ label: 'Qəbul', reply: '1' }, { label: 'İmtina', reply: '2' }],
    },
  });
  ledger({ type: 'offer', tone: 'neutral', title: `Offer sent to ${first(a.farmerId)}: ${a.qtyKg} kg`, titleAz: `${first(a.farmerId)} fermerinə təklif göndərildi: ${a.qtyKg} kq`, orderId: order.id });
}

function acceptOffer(order: Order, a: Allocation) {
  a.status = 'accepted';
  ledger({ type: 'accept', tone: 'good', title: `${farmer(a.farmerId).name} confirmed ${a.qtyKg} kg`, titleAz: `${farmer(a.farmerId).name} ${a.qtyKg} kq təsdiqlədi`, orderId: order.id });
  say(a.farmerId, 'Təşəkkürlər! Sifariş təsdiqləndi. Sürücü vaxtında gələcək.', 'Thank you! Order confirmed. The driver will come on time.');
  const rec = order.recovery;
  if (rec && rec.status === 'offered' && rec.selected !== undefined && rec.candidates[rec.selected].farmerId === a.farmerId) {
    finishRecovery(order);
  }
  const live = order.allocations.filter((x) => x.status !== 'cancelled' && x.status !== 'declined');
  if (live.every((x) => x.status === 'accepted') && order.status === 'offers_sent' && (!order.recovery || order.recovery.status === 'resolved')) {
    order.status = 'confirmed';
    ledger({
      type: 'order', tone: 'good', orderId: order.id,
      title: live.length === 1 ? `${order.id} confirmed: the farmer accepted` : `${order.id} confirmed: all ${live.length} farmers accepted`,
      titleAz: live.length === 1 ? `${order.id} təsdiqləndi: fermer qəbul etdi` : `${order.id} təsdiqləndi: ${live.length} fermerin hamısı qəbul etdi`,
    });
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
    titleAz: wasOffer ? `${farmer(a.farmerId).name} ${a.qtyKg} kq təklifdən imtina etdi` : `${farmer(a.farmerId).name} ${a.qtyKg} kq ilə sifarişdən çıxır`,
    quote: known?.en ?? cause ?? said,
    quoteAz: known?.az ?? said,
    detail: known || cause ? 'Translated from WhatsApp' : undefined,
    detailAz: known || cause ? 'Fermerin WhatsApp-dakı öz sözləri' : undefined,
  });
  order.status = 'offers_sent';
  say(a.farmerId, 'Başa düşdük, çox təəssüf. Sifarişdən çıxarıldınız. Narahat olmayın, əvəzedici tapırıq.', "Understood, very sorry. You're removed from the order. Don't worry, we're finding a replacement.");

  order.recovery = { shortfallKg: a.qtyKg, cancelledFarmerId: a.farmerId, cause, candidates: [], status: 'searching', before: order.costs };
  ledger({
    type: 'recovery', tone: 'ai', title: `AI re-matching ${a.qtyKg} kg`, titleAz: `Sİ ${a.qtyKg} kq üçün yenidən uyğunlaşdırma aparır`,
    detail: 'Other farmers stay as they are', detailAz: 'Digər fermerlər olduğu kimi qalır', orderId: order.id,
  });
  emit();
  await sleep(Number(process.env.DEMO_RECOVERY_MS ?? 1800));
  const plan = planRecovery(s, { ...order, allocations: order.allocations.map((x) => (x.id === a.id ? { ...x, status: 'accepted' } : x)) }, a.farmerId, now(), cause);
  order.recovery = plan;
  if (plan.status === 'proposed') backupFound(order, plan.candidates[plan.selected!]);
  else {
    ledger({
      type: 'recovery', tone: 'alert', title: 'No backup found', titleAz: 'Əvəzedici tapılmadı',
      detail: 'Buyer chooses partial delivery, a later date or a refund', detailAz: 'Alıcı qismən çatdırılma, sonrakı tarix və ya pulun qaytarılmasını seçir', orderId: order.id,
    });
  }
  emit();
}

function backupFound(order: Order, c: RecoveryCandidate) {
  ledger({
    type: 'recovery', tone: 'ai', title: `Backup found: ${farmer(c.farmerId).name}`, titleAz: `Əvəzedici tapıldı: ${farmer(c.farmerId).name}`,
    detail: `${c.qtyKg} kg · ${fmt(c.costs!.perKg)} ₼/kg delivered · waiting for operator`,
    detailAz: `${c.qtyKg} kq · çatdırılma ilə ${fmt(c.costs!.perKg)} ₼/kq · operator gözlənilir`, orderId: order.id,
  });
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
  reserveLot(alloc);
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
  const tol = getState().tenders.find((t) => t.id === order.tenderId)?.priceTolerancePct ?? 2;
  order.priceNotice = `${farmer(rec.cancelledFarmerId).name} dropped out${rec.cause ? ` (${rec.cause.toLowerCase()})` : ''}. ${farmer(c.farmerId).name} now supplies ${c.qtyKg} kg. Delivered cost ${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kg (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%), ${pct <= tol ? `within your ${tol}% tolerance` : `above your ${tol}% tolerance: our operations team approved it`}. Arrival unchanged.`;
  const causeAz = rec.cause ? CAUSE_AZ[rec.cause] ?? rec.cause.toLowerCase() : undefined;
  order.priceNoticeAz = `${farmer(rec.cancelledFarmerId).name} sifarişdən çıxdı${causeAz ? ` (${causeAz})` : ''}. İndi ${c.qtyKg} kq-ı ${farmer(c.farmerId).name} verir. Çatdırılma ilə qiymət ${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kq (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%), ${pct <= tol ? `${tol}% dözümlülük həddiniz daxilində` : `${tol}% dözümlülük həddinizdən yuxarı: əməliyyat komandamız təsdiqlədi`}. Çatma vaxtı dəyişmir.`;
  ledger({
    type: 'recovery', tone: 'good', title: `Order repaired: ${first(c.farmerId)} fills ${c.qtyKg} kg`, titleAz: `Sifariş bərpa olundu: ${c.qtyKg} kq-ı ${first(c.farmerId)} verir`,
    detail: `${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kg · arrival unchanged`, detailAz: `${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kq · çatma vaxtı dəyişmir`, orderId: order.id,
  });
  if (delta !== 0) ledger({ type: 'escrow', tone: 'neutral', title: `Escrow adjusted by ${delta > 0 ? '+' : ''}${fmt(delta)} ₼`, titleAz: `Əmanət hesabı ${delta > 0 ? '+' : ''}${fmt(delta)} ₼ düzəldildi`, detail: 'Simulated', detailAz: 'Simulyasiya', orderId: order.id });
}

/** The driver collected every accepted lot (operator, or the T time skip). */
export function markPickedUp(orderId: string) {
  const order = getState().orders.find((o) => o.id === orderId);
  if (!order || !['offers_sent', 'confirmed'].includes(order.status)) return;
  const accepted = order.allocations.filter((x) => x.status === 'accepted');
  if (!accepted.length) return;
  for (const a of accepted) {
    a.status = 'picked_up';
    a.pickedKg = a.qtyKg;
    sendToFarmer(a.farmerId, { kind: 'text', text: `Sürücü ${a.qtyKg} kq götürdü. Keyfiyyət yoxlanıldı.`, textEn: `The driver picked up ${a.qtyKg} kg. Quality checked.` });
  }
  // Offers nobody answered by pickup time lapse; the lots go back on the market.
  for (const a of order.allocations.filter((x) => x.status === 'offered')) {
    a.status = 'declined';
    const l = getState().listings.find((x) => x.id === a.listingId);
    if (l) l.status = 'live';
  }
  order.status = 'picked_up';
  const onVan = accepted.reduce((n, a) => n + a.qtyKg, 0);
  ledger({
    type: 'delivery', tone: 'neutral', title: `${order.id} picked up from ${accepted.length} farm${accepted.length === 1 ? '' : 's'}`, titleAz: `${order.id} ${accepted.length} fermadan götürüldü`,
    detail: `${onVan} kg on the van`, detailAz: `Furqonda ${onVan} kq`, orderId: order.id,
  });
  emit();
}

/** The van reached the buyer; payment waits for the buyer to confirm receipt. */
export function markDelivered(orderId: string) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  if (!order || order.status !== 'picked_up') return;
  const t = s.tenders.find((x) => x.id === order.tenderId);
  order.status = 'delivered';
  ledger({
    type: 'delivery', tone: 'good', title: `${order.id} arrived${t ? ` at ${t.destination}` : ''} at ${bakuTime(now())}`,
    titleAz: `${order.id}${t ? ` ${t.destination} ünvanına` : ''} çatdı, saat ${bakuTime(now())}`,
    detail: 'Waiting for buyer to confirm receipt', detailAz: 'Alıcının qəbulu təsdiqləməsi gözlənilir', orderId: order.id,
  });
  emit();
}

/** Presenter T: jump the clock to the delivery deadline, then pickup and arrival happen at once. */
export function skipToThursday(orderId?: string) {
  const s = getState();
  const order = orderId ? s.orders.find((o) => o.id === orderId) : s.orders.find((o) => ['offers_sent', 'confirmed', 'picked_up'].includes(o.status));
  const t = order && s.tenders.find((x) => x.id === order.tenderId);
  setClock(t?.deadline ?? demoDeadline());
  if (order) {
    markPickedUp(order.id);
    markDelivered(order.id);
  }
  emit();
}

// ---------- Buyer: tenders, and the choices when a gap cannot be filled ----------

export interface TenderInput {
  product: string; variety?: string; grade?: number; qtyKg: number; packaging?: string; intendedUse?: string;
  useWithinDays?: number; ripenessMin?: number; ripenessMax?: number; maxPriceAzn: number; deadline: string; destination?: string;
  priceTolerancePct?: number;
}

export function createTender(input: TenderInput): string {
  const s = getState();
  const product = canonicalProduct(input.product);
  if (!product) throw new Error('Choose a product');
  const qty = Math.round(Number(input.qtyKg));
  if (!(qty > 0 && qty <= 100_000)) throw new Error('Quantity must be between 1 and 100000 kg');
  const max = Number(input.maxPriceAzn);
  if (!(max > 0 && max < 1000)) throw new Error('Enter a maximum delivered price per kg');
  const deadline = new Date(input.deadline);
  if (Number.isNaN(deadline.getTime())) throw new Error('Enter a delivery date and time');
  if (deadline.getTime() < new Date(now()).getTime() + 3 * 3600_000) throw new Error('The delivery time must be at least 3 hours from now');
  const grade = Math.max(1, Math.min(3, Math.round(Number(input.grade) || 1))) as 1 | 2 | 3;
  const rMin = tracksRipeness(product) ? Math.max(1, Math.min(6, Math.round(Number(input.ripenessMin) || 4))) : 1;
  const rMax = tracksRipeness(product) ? Math.max(rMin, Math.min(6, Math.round(Number(input.ripenessMax) || 5))) : 6;
  const buyer = s.buyers[0];
  const seq = Math.max(1043, ...s.tenders.map((t) => Number(t.id.slice(2)) || 0)) + 1;
  const t: Tender = {
    id: `T-${seq}`, buyerId: buyer.id, product, variety: input.variety?.trim() || 'Any', grade, qtyKg: qty,
    packaging: input.packaging?.trim() || '10 kg crates', intendedUse: input.intendedUse?.trim() || 'Kitchen',
    useWithinDays: Math.max(1, Math.min(30, Math.round(Number(input.useWithinDays) || 3))),
    ripenessMin: rMin, ripenessMax: rMax, maxPriceAzn: Math.round(max * 100) / 100,
    priceTolerancePct: Math.max(0, Math.min(20, Number(input.priceTolerancePct ?? 2))),
    deadline: deadline.toISOString(), destination: input.destination?.trim() || buyer.address, status: 'open', proposalIds: [],
  };
  s.tenders.unshift(t);
  ledger({
    type: 'order', tone: 'neutral', title: `New tender ${t.id}: ${qty} kg ${product.toLowerCase()}`, titleAz: `Yeni tender ${t.id}: ${qty} kq ${azp(product)}`,
    detail: `${t.variety === 'Any' ? 'any variety' : t.variety}, grade ${grade} · by ${bakuTime(t.deadline)} ${dayLabel(t.deadline).en}`,
    detailAz: `${t.variety === 'Any' ? 'istənilən növ' : t.variety}, sort ${grade} · ${dayLabel(t.deadline).az} saat ${bakuTime(t.deadline)}-dək`,
  });
  emit();
  return t.id;
}

export function cancelTender(tenderId: string) {
  const s = getState();
  const t = s.tenders.find((x) => x.id === tenderId);
  if (!t || t.status === 'ordered') return;
  t.status = 'cancelled';
  s.proposals = s.proposals.filter((p) => p.tenderId !== t.id);
  t.proposalIds = [];
  ledger({ type: 'order', tone: 'neutral', title: `Tender ${t.id} cancelled by the buyer`, titleAz: `Tender ${t.id} alıcı tərəfindən ləğv edildi` });
  emit();
}

/** Look for a backup again (new listings may have come in since). */
export function retryRecovery(orderId: string) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  const rec = order?.recovery;
  if (!order || !rec || rec.status !== 'no_backup') return;
  const lost = order.allocations.find((a) => a.farmerId === rec.cancelledFarmerId && (a.status === 'cancelled' || a.status === 'declined'));
  if (!lost) return;
  const plan = planRecovery(s, { ...order, allocations: order.allocations.map((x) => (x.id === lost.id ? { ...x, status: 'accepted' } : x)) }, rec.cancelledFarmerId, now(), rec.cause);
  order.recovery = plan;
  if (plan.status === 'proposed') backupFound(order, plan.candidates[plan.selected!]);
  else ledger({ type: 'recovery', tone: 'alert', title: 'Still no backup', titleAz: 'Hələ də əvəzedici yoxdur', detail: `${plan.candidates.length} farms checked`, detailAz: `${plan.candidates.length} ferma yoxlanıldı`, orderId: order.id });
  emit();
}

/** The buyer takes what the remaining farmers supply; the escrow shrinks to match. */
export function acceptPartial(orderId: string) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  const rec = order?.recovery;
  if (!order || !rec || rec.status !== 'no_backup') return;
  const kept = order.allocations.filter((a) => a.status === 'accepted' || a.status === 'offered');
  if (!kept.length) return cancelOrder(orderId);
  const buyer = s.buyers.find((b) => b.id === order.buyerId)!;
  const stops: Stop[] = kept.map((a) => { const f = farmer(a.farmerId); return { farmerId: f.id, label: f.village, lat: f.lat, lng: f.lng }; });
  const { order: route, km } = bestRoute(stops, buyer);
  const kg = kept.reduce((n, a) => n + a.qtyKg, 0);
  const before = order.costs;
  order.costs = costsFor(kept, km, stops.length, kg);
  order.route = route;
  order.partialKg = kg;
  const refund = Math.round((order.escrow.amount - order.costs.total) * 100) / 100;
  order.escrow.amount = order.costs.total;
  rec.status = 'resolved';
  order.priceNotice = `${farmer(rec.cancelledFarmerId).name} dropped out and no backup was found. You accepted a partial delivery of ${kg} kg; ${fmt(refund)} ₼ goes back to you. Delivered cost ${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kg.`;
  order.priceNoticeAz = `${farmer(rec.cancelledFarmerId).name} sifarişdən çıxdı və əvəzedici tapılmadı. Siz ${kg} kq qismən çatdırılmanı qəbul etdiniz; ${fmt(refund)} ₼ sizə qaytarılır. Çatdırılma ilə qiymət ${fmt(before.perKg)} → ${fmt(order.costs.perKg)} ₼/kq.`;
  ledger({
    type: 'order', tone: 'neutral', title: `${order.id}: buyer accepts ${kg} kg`, titleAz: `${order.id}: alıcı ${kg} kq qəbul edir`,
    detail: `${fmt(refund)} ₼ back to the buyer (simulated)`, detailAz: `${fmt(refund)} ₼ alıcıya qaytarılır (simulyasiya)`, orderId: order.id,
  });
  if (kept.every((a) => a.status === 'accepted') && order.status === 'offers_sent') {
    order.status = 'confirmed';
    ledger({ type: 'order', tone: 'good', title: `${order.id} confirmed: ${kept.length} farmer${kept.length === 1 ? '' : 's'}`, titleAz: `${order.id} təsdiqləndi: ${kept.length} fermer`, orderId: order.id });
  }
  emit();
}

/** The buyer cancels before pickup: escrow refunded, every lot goes back on the market, farmers are told. */
export function cancelOrder(orderId: string) {
  const s = getState();
  const order = s.orders.find((o) => o.id === orderId);
  if (!order || !['offers_sent', 'confirmed'].includes(order.status)) return;
  for (const a of order.allocations.filter((x) => x.status === 'offered' || x.status === 'accepted')) {
    const l = s.listings.find((x) => x.id === a.listingId);
    if (l && l.status === 'reserved') l.status = 'live';
    a.status = 'declined';
    say(a.farmerId, 'Alıcı sifarişi ləğv etdi. Məhsulunuz yenidən satışdadır, yeni alıcı tapan kimi xəbər verəcəyik.', 'The buyer cancelled the order. Your produce is back on sale; we will tell you when we find a new buyer.');
  }
  order.status = 'cancelled';
  order.escrow.status = 'refunded';
  if (order.recovery && order.recovery.status !== 'resolved') order.recovery.status = 'resolved';
  const t = s.tenders.find((x) => x.id === order.tenderId);
  if (t) { t.status = 'open'; t.orderId = undefined; t.proposalIds = []; s.proposals = s.proposals.filter((p) => p.tenderId !== t.id); }
  ledger({
    type: 'escrow', tone: 'alert', title: `${order.id} cancelled by the buyer`, titleAz: `${order.id} alıcı tərəfindən ləğv edildi`,
    detail: `${fmt(order.escrow.amount)} ₼ refunded (simulated)`, detailAz: `${fmt(order.escrow.amount)} ₼ qaytarıldı (simulyasiya)`, orderId: order.id,
  });
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
  const paid = order.allocations.filter((x) => x.status === 'picked_up').length;
  ledger({
    type: 'escrow', tone: 'good', title: `Payout released to ${paid} farmers`, titleAz: `Ödəniş ${paid} fermerə köçürüldü`,
    detail: 'Simulated, no real money moved', detailAz: 'Simulyasiya, real pul köçürülmədi', orderId: order.id,
  });
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
  ledger({ type: 'rating', tone: 'good', title: `Buyer rated ${f.name} ${stars}/5`, titleAz: `Alıcı ${f.name} fermerini ${stars}/5 qiymətləndirdi`, orderId });
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
    case 'demoData': // D: seeded marketplace on/off
      return setDemoData(arg === 'on' ? true : arg === 'off' ? false : s.settings.demoData === false);
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
      ledger({ type: 'listing', tone: 'good', title: 'New listing live: Elşən, 180 kg Roma', titleAz: 'Yeni elan aktivdir: Elşən, 180 kq Roma', detail: 'Stage 4 · 1.15 ₼/kg', detailAz: 'Mərhələ 4 · 1.15 ₼/kq' });
      return emit();
    }
  }
}

/**
 * Demo data on: the seeded farms' listings (the other side of the marketplace) are on the platform. Off: only
 * listings the farmers sent from their phones, so every match and backup is a real one. Seeded lots already in an
 * order stay until that order is done; proposals worked out from the old supply are cleared so Find supply reruns.
 */
export function setDemoData(on: boolean) {
  const s = getState();
  if ((s.settings.demoData !== false) === on) return emit();
  s.settings.demoData = on;
  const inOrders = new Set(s.orders.filter((o) => o.status !== 'delivered').flatMap((o) => o.allocations.map((a) => a.listingId)));
  if (on) {
    const have = new Set(s.listings.map((l) => l.id));
    s.listings.push(...seedListings().filter((l) => !have.has(l.id)));
  } else s.listings = s.listings.filter((l) => l.source !== 'seed' || inOrders.has(l.id));
  for (const t of s.tenders.filter((x) => x.status === 'proposals' || x.status === 'matching')) {
    s.proposals = s.proposals.filter((p) => p.tenderId !== t.id);
    t.proposalIds = [];
    t.status = 'open';
  }
  const liveCount = s.listings.filter((l) => l.status === 'live').length;
  ledger({
    type: 'listing', tone: 'neutral',
    title: on ? 'Demo data on: seeded farms are listed' : 'Demo data off: only listings from real phones',
    titleAz: on ? 'Demo məlumatlar açıqdır: nümunə fermalar siyahıdadır' : 'Demo məlumatlar bağlıdır: yalnız real telefonlardan gələn elanlar',
    detail: `${liveCount} live listings`, detailAz: `${liveCount} aktiv elan`,
  });
  emit();
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

// ---------- Self sign-up (the join QR) ----------

export const MAX_SIGNUPS = Number(process.env.DEMO_MAX_SIGNUPS ?? 150);

/** A judge or visitor creates their own farmer account from the join QR; they then chat like any farmer. */
export function createFarmer(input: { name: string; place: string; lang: 'az' | 'en' }): string {
  const s = getState();
  const name = input.name.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (name.length < 2) throw new Error(input.lang === 'en' ? 'Please enter your name' : 'Adınızı yazın');
  const town = CITIES.find((c) => c.name === input.place && c.rank <= 3);
  if (!town) throw new Error(input.lang === 'en' ? 'Choose your district' : 'Rayonunuzu seçin');
  if (s.farmers.filter((f) => f.selfSignup).length >= MAX_SIGNUPS) throw new Error(input.lang === 'en' ? 'Sign-ups are full for this demo' : 'Bu demo üçün qeydiyyat dolub');
  const colors = Object.values(C);
  // A farm a few kilometres outside the town centre, so markers do not sit on top of each other.
  const jitter = () => (Math.random() - 0.5) * 0.06;
  const f: Farmer = {
    id: `f-u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name, village: town.name, region: town.name, lat: town.lat + jitter(), lng: town.lng + jitter(),
    rating: 5, deals: 0, color: colors[s.farmers.length % colors.length], lang: input.lang, selfSignup: new Date().toISOString(),
  };
  s.farmers.push(f);
  ledger({ type: 'system', tone: 'neutral', title: `New farmer joined: ${name}, ${town.name}`, titleAz: `Yeni fermer qoşuldu: ${name}, ${town.name}`, detail: f.lang === 'en' ? 'Chats in English' : 'Azərbaycanca yazışır', detailAz: f.lang === 'en' ? 'İngiliscə yazışır' : 'Azərbaycanca yazışır' });
  say(
    f.id,
    'Xoş gəldiniz! Mən BƏRƏKƏT köməkçisiyəm. Satmaq istədiyiniz məhsulu səsli mesajla deyin: nə, neçə kilo və kilosu neçəyə. Sonra məhsulun şəklini göndərin. Elanınızı mən hazırlayacağam.',
    "Welcome! I'm the BƏRƏKƏT assistant. Tell me in a voice note what you want to sell: what it is, how many kilos and the price per kilo. Then send a photo of the produce. I'll prepare your listing.",
  );
  return f.id;
}

/** The farmer switches the chat language (the assistant, its voice and speech recognition follow). */
export function setFarmerLang(farmerId: string, lang: 'az' | 'en') {
  const f = getState().farmers.find((x) => x.id === farmerId);
  if (!f) return;
  f.lang = lang;
  emit();
}
