// Everything that changes state: the farmer's WhatsApp conversation, the AI listing pipeline, orders,
// cancellation and recovery, and the hidden presenter controls. Farmer-facing text is Azerbaijani with
// an English gloss shown in the demo.
import { classifyIntent, DEMO_PHOTOS, DEMO_VOICE, extractListing, inspectPhoto, readPublic, transcribe, wordsToDigits, type Extracted, type Mode } from './ai';
import { generateProposals, planRecovery } from './engine';
import { stageInfo } from './ripeness';
import { DEADLINE, elsenListingFields, THURSDAY_0900 } from './seed';
import { emit, farmer, getState, ledger, now, resetState, sendToFarmer, setClock, uid } from './store';
import type { AiRun, AiStep, Allocation, Listing, Message, Order } from './types';

const STEP_MS = Number(process.env.DEMO_STEP_MS ?? 750);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (n: number) => n.toFixed(2);
const first = (id: string) => farmer(id).name.split(' ')[0];
const AZ_PRODUCT: Record<string, string> = { Tomato: 'Pomidor', Cucumber: 'Xiyar', Apple: 'Alma', Potato: 'Kartof', Pepper: 'Bibər' };

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
    mode: 'mock',
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

async function step<T>(run: AiRun, key: AiStep['key'], fn: () => Promise<{ value: T; output: string }>): Promise<T> {
  const s = run.steps.find((x) => x.key === key)!;
  s.status = 'running';
  emit();
  const t0 = Date.now();
  try {
    const { value, output } = await fn();
    const spent = Date.now() - t0;
    if (spent < STEP_MS) await sleep(STEP_MS - spent);
    s.status = 'done';
    s.output = output;
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

function aggregateMode(modes: Mode[]): Mode {
  return modes.includes('live') ? 'live' : modes.includes('cached') ? 'cached' : 'mock';
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

export async function handleInbound(inb: Inbound) {
  const s = getState();
  const base = { farmerId: inb.farmerId, dir: 'in' as const, at: now(), via: inb.via, delivery: 'local' as const };

  if (inb.photo) {
    s.messages.push({ id: uid('m'), ...base, kind: 'photo', mediaUrl: inb.photo.url });
    emit();
    await onPhoto(inb.farmerId, inb.photo, !!inb.audio);
  }

  if (inb.audio) {
    const msg: Message = { id: uid('m'), ...base, kind: 'voice', mediaUrl: inb.audio.url };
    s.messages.push(msg);
    emit();
    const pendingWork = hasPendingOfferOrOrder(inb.farmerId);
    let az: string;
    let mode: Mode;
    const it = pendingWork ? undefined : intakeFor(inb.farmerId);
    try {
      const doIt = async () => {
        const r = inb.audio!.buf
          ? await transcribe(inb.audio!.buf, inb.audio!.mime, { offline: s.settings.offline, scriptedAz: inb.audio!.scriptedAz })
          : { text: inb.audio!.scriptedAz ?? '', mode: 'mock' as Mode };
        if (!r.text) throw new Error('Speech-to-text needs an ElevenLabs key for recorded audio');
        return r;
      };
      const r = it
        ? await step(runOf(it), 'transcribe', async () => {
            const x = await doIt();
            return { value: x, output: x.text };
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
      console.error(err);
      say(inb.farmerId, 'Səs aydın eşidilmədi, zəhmət olmasa yenidən göndərin.', 'The audio was not clear, please send it again.');
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

async function routeText(farmerId: string, text: string, fromVoice: boolean, msg: Message) {
  const s = getState();
  const t = text.trim().toLocaleLowerCase('az');

  // 1. An open offer waits for yes/no.
  const offered = activeAllocation(farmerId, ['offered']);
  if (offered) {
    const r = t === '1' ? { intent: 'accept' as const } : t === '2' ? { intent: 'decline' as const } : await classifyIntent(text, 'farmer is answering a purchase offer', s.settings.offline);
    if ('en' in r && r.en && !msg.textEn) msg.textEn = r.en;
    if (r.intent === 'accept') return acceptOffer(offered.order, offered.alloc);
    if (r.intent === 'decline' || r.intent === 'cancel') return cancelAllocation(offered.order, offered.alloc, text, 'cause' in r ? r.cause : undefined);
    return say(farmerId, 'Qəbul üçün 1, imtina üçün 2 yazın.', 'Reply 1 to accept, 2 to decline.');
  }

  // 2. A confirmed order can still be cancelled until pickup.
  const committed = activeAllocation(farmerId, ['accepted']);
  if (committed && committed.order.status !== 'delivered') {
    const r = await classifyIntent(text, 'farmer has a confirmed order and may be cancelling it', s.settings.offline);
    if (r.en && !msg.textEn) msg.textEn = r.en;
    if (r.intent === 'cancel' || r.intent === 'decline') return cancelAllocation(committed.order, committed.alloc, text, r.cause);
    return say(farmerId, 'Sifarişiniz qüvvədədir. Sürücü vaxtında gələcək.', 'Your order stands. The driver will come on time.');
  }

  // 3. A draft listing waits for confirmation.
  const draft = s.listings.find((l) => l.farmerId === farmerId && l.status === 'draft');
  if (draft && !fromVoice) {
    if (t === '1' || /təsdiq|bəli|qəbul/.test(t)) return confirmListing(draft);
    if (t === '2' || /düzəliş/.test(t)) {
      draft.status = 'withdrawn';
      intakes().delete(farmerId);
      return say(farmerId, 'Yaxşı. Düzəlişlə yeni səsli mesaj göndərin.', 'OK. Send a new voice note with the correction.');
    }
  }

  // 4. A rating request.
  const toRate = s.orders.find((o) => o.status === 'settled' && o.allocations.some((a) => a.farmerId === farmerId && a.status === 'picked_up') && o.farmerRatings[farmerId] === undefined);
  if (toRate && /^[1-5]$/.test(t)) {
    toRate.farmerRatings[farmerId] = Number(t);
    const b = s.buyers.find((x) => x.id === toRate.buyerId)!;
    const given = Object.values(toRate.farmerRatings);
    b.rating = Math.round(((b.rating * 20 + given.reduce((x, y) => x + y, 0)) / (20 + given.length)) * 10) / 10;
    ledger({ type: 'rating', tone: 'good', title: `${first(farmerId)} rated the buyer ${t}/5`, orderId: toRate.id });
    return say(farmerId, 'Təşəkkürlər! Qiymətiniz qeydə alındı.', 'Thank you! Your rating is saved.');
  }

  // 5. The intake pipeline is waiting for a missing field.
  const it = intakes().get(farmerId);
  if (it?.awaiting && ['qtyKg', 'priceAzn', 'product'].includes(it.awaiting) && it.extracted) {
    const num = parseFloat(t.replace(',', '.').replace(/[^0-9.]/g, ''));
    if (it.awaiting === 'qtyKg' && num > 0) it.extracted.qtyKg = num;
    else if (it.awaiting === 'priceAzn' && num > 0) it.extracted.priceAzn = num;
    else if (it.awaiting === 'product') it.extracted.product = /pomidor/.test(t) ? 'Tomato' : text;
    it.awaiting = undefined;
    return finishIntake(farmerId);
  }

  // 6. New produce: start or continue the intake. A plain hello from a farmer with a live lot just gets a status.
  const liveLot = s.listings.find((l) => l.farmerId === farmerId && (l.status === 'live' || l.status === 'reserved'));
  if (liveLot && !/\d/.test(wordsToDigits(t)) && !/kilo|manat|qəpik/.test(t)) {
    return say(
      farmerId,
      `Salam! Elanınız aktivdir: ${liveLot.qtyKg} kq ${AZ_PRODUCT[liveLot.product] ?? liveLot.product}. Alıcı tapılan kimi xəbər verəcəyik.`,
      `Hi! Your listing is live: ${liveLot.qtyKg} kg ${liveLot.product.toLowerCase()}. We'll tell you as soon as a buyer is found.`,
    );
  }
  if (fromVoice || /(kilo|kq|manat|pomidor|xiyar|alma|kartof)/.test(t)) return onDescription(farmerId, text);

  return say(
    farmerId,
    'Salam! Mən BƏRƏKƏT köməkçisiyəm. Satmaq istədiyiniz məhsul barədə səsli mesaj və şəkil göndərin.',
    "Hi! I'm the BƏRƏKƏT assistant. Send a voice note and a photo of the produce you want to sell.",
  );
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
  const ex = await step(run, 'extract', async () => {
    const r = await extractListing(az, now(), s.settings.offline);
    it.modes.push(r.mode);
    const d = r.data;
    const parts = [d.product && `${d.product}${d.variety ? ` (${d.variety})` : ''}`, d.qtyKg && `${d.qtyKg} kg`, d.priceAzn && `${fmt(d.priceAzn)} ₼/kg`, d.grade && `grade ${d.grade}`];
    return { value: d, output: parts.filter(Boolean).join(' · ') || 'Nothing recognised' };
  });
  it.extracted = ex;
  run.transcriptEn = ex.transcriptEn;
  run.fields = Object.fromEntries(
    (['product', 'variety', 'qtyKg', 'priceAzn', 'grade', 'harvest'] as const)
      .filter((k) => ex[k] !== undefined)
      .map((k) => [k, { value: String(ex[k]), confidence: ex.confidence[k] ?? 0.7 }]),
  );
  emit();
  if (it.photo) return finishIntake(farmerId);
  it.awaiting = 'photo';
  say(farmerId, 'Səsli mesaj alındı. İndi məhsulun şəklini göndərin.', 'Voice note received. Now send a photo of the produce.');
}

async function onPhoto(farmerId: string, photo: PhotoIn, voiceComing = false) {
  if (hasPendingOfferOrOrder(farmerId)) return;
  const it = intakeFor(farmerId);
  it.photo = photo;
  runOf(it).photoUrl = photo.url;
  emit();
  if (it.extracted) return finishIntake(farmerId);
  it.awaiting = 'voice';
  if (voiceComing) return;
  say(farmerId, 'Şəkil alındı. İndi məhsul, miqdar və qiymət barədə səsli mesaj göndərin.', 'Photo received. Now send a voice note about the product, quantity and price.');
}

async function finishIntake(farmerId: string) {
  const s = getState();
  const it = intakes().get(farmerId)!;
  const run = runOf(it);
  const ex = it.extracted!;

  if (run.steps[2].status === 'pending') {
    const insp = await step(run, 'inspect', async () => {
      const r = await inspectPhoto(it.photo?.buf, it.photo?.mime ?? 'image/svg+xml', { offline: s.settings.offline, hintStage: it.photo?.hintStage, hintSpoiled: it.photo?.hintSpoiled });
      it.modes.push(r.mode);
      const d = r.data;
      return { value: d, output: d.spoiled ? `Spoilage visible: ${d.defects.join(', ')}` : `Stage ${d.ripeness}, ${stageInfo(d.ripeness).name} · ${Math.round(d.confidence * 100)}% confidence${d.defects.length ? ` · ${d.defects.join(', ')}` : ''}` };
    });
    run.ripeness = insp.ripeness;
    run.ripenessConfidence = insp.confidence;
    run.defects = insp.defects;
    if (insp.spoiled) {
      run.status = 'needs_review';
      run.note = 'Held: spoilage visible in the photo. Not offered to buyers.';
      run.mode = aggregateMode(it.modes);
      for (const k of ['price', 'draft'] as const) run.steps.find((x) => x.key === k)!.status = 'skipped';
      ledger({ type: 'ai', tone: 'alert', title: `Listing held: ${first(farmerId)}'s photo shows spoilage`, detail: insp.defects.join(', ') });
      intakes().delete(farmerId);
      return say(
        farmerId,
        'Şəkildə məhsulun bir hissəsi xarab görünür. Təhlükəsizlik üçün bu partiyanı alıcılara təklif edə bilmirik. Yeni şəkil göndərə bilərsiniz.',
        "Part of the produce looks spoiled in the photo. For safety we can't offer this lot to buyers. You can send a new photo.",
      );
    }
    (it as Intake & { insp?: typeof insp }).insp = insp;
  }

  // Missing fields: ask one question at a time.
  if (!ex.product) { it.awaiting = 'product'; return say(farmerId, 'Hansı məhsuldur?', 'Which product is it?'); }
  if (!ex.qtyKg) { it.awaiting = 'qtyKg'; return say(farmerId, 'Neçə kiloqram var?', 'How many kilos do you have?'); }
  if (!ex.priceAzn) { it.awaiting = 'priceAzn'; return say(farmerId, 'Kilosunu neçəyə satırsınız?', 'What is your price per kilo?'); }

  const insp = (it as Intake & { insp?: { ripeness: number; confidence: number; defects: string[] } }).insp ?? { ripeness: 4, confidence: 0.5, defects: [] };
  const peers = s.listings.filter((l) => l.status === 'live' && l.product === ex.product && l.variety === (ex.variety ?? l.variety) && l.grade === (ex.grade ?? 1));
  const note = await step(run, 'price', async () => {
    if (!peers.length) return { value: 'No comparable listings today.', output: 'No comparable listings today' };
    const lo = Math.min(...peers.map((p) => p.priceAzn));
    const hi = Math.max(...peers.map((p) => p.priceAzn));
    const inRange = ex.priceAzn! >= lo * 0.9 && ex.priceAzn! <= hi * 1.1;
    const out = `${fmt(ex.priceAzn!)} ₼ ${inRange ? 'is within' : 'is outside'} today's range of ${fmt(lo)} to ${fmt(hi)} ₼ for ${peers.length} similar lots`;
    return { value: out, output: out };
  });
  run.priceNote = note;

  const listing: Listing = {
    id: uid('l'),
    farmerId,
    product: ex.product!,
    variety: ex.variety ?? 'Local',
    grade: ex.grade ?? 1,
    qtyKg: ex.qtyKg!,
    priceAzn: ex.priceAzn!,
    ripeness: insp.ripeness,
    ripenessConfidence: insp.confidence,
    defects: insp.defects,
    harvest: ex.harvest ?? now().slice(0, 10),
    status: 'draft',
    photoUrl: it.photo?.url,
    audioUrl: run.audioUrl,
    transcriptAz: it.transcriptAz,
    transcriptEn: ex.transcriptEn,
    createdAt: now(),
    source: 'whatsapp',
    aiRunId: run.id,
  };
  await step(run, 'draft', async () => ({ value: null, output: `${listing.qtyKg} kg ${listing.variety} at ${fmt(listing.priceAzn)} ₼, stage ${listing.ripeness}, sent to ${first(farmerId)} to confirm` }));
  s.listings.push(listing);
  run.listingId = listing.id;
  run.mode = aggregateMode(it.modes);
  const lowConf = insp.confidence < 0.6 || Object.values(run.fields ?? {}).some((f) => f.confidence < 0.6);
  run.status = lowConf ? 'needs_review' : 'done';
  if (lowConf) run.note = 'Low confidence on some fields. Check before buyers see it.';
  intakes().delete(farmerId);
  ledger({ type: 'ai', tone: 'ai', title: `AI drafted a listing for ${first(farmerId)}`, detail: `${listing.qtyKg} kg ${listing.variety} ${listing.product.toLowerCase()}, stage ${listing.ripeness}` });

  const harvestAz = sameBakuDay(listing.harvest + 'T08:00:00Z', now()) ? 'bu gün' : listing.harvest.split('-').reverse().slice(0, 2).join('.');
  say(farmerId, '', `Your listing is ready: ${listing.product} (${listing.variety}), ${listing.qtyKg} kg, ${fmt(listing.priceAzn)} ₼/kg, grade ${listing.grade}, ripeness ${listing.ripeness}/6, harvest ${harvestAz === 'bu gün' ? 'today' : harvestAz}. Reply 1 to confirm, 2 to edit.`, {
    title: 'Elanınız hazırdır',
    rows: [
      ['Məhsul', `${AZ_PRODUCT[listing.product] ?? listing.product} (${listing.variety})`],
      ['Miqdar', `${listing.qtyKg} kq`],
      ['Qiymət', `${fmt(listing.priceAzn)} ₼/kq`],
      ['Sort', `${listing.grade}`],
      ['Yetişmə', `${listing.ripeness}/6, ${stageInfo(listing.ripeness).az}`],
      ['Yığım', harvestAz],
    ],
    actions: [{ label: 'Təsdiq', reply: '1' }, { label: 'Düzəliş', reply: '2' }],
  });
}

function confirmListing(l: Listing) {
  l.status = 'live';
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

let orderSeq = 2206;
export function confirmProposal(proposalId: string): string {
  const s = getState();
  const p = s.proposals.find((x) => x.id === proposalId)!;
  const t = s.tenders.find((x) => x.id === p.tenderId)!;
  const order: Order = {
    id: `O-${++orderSeq}`,
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
  const pickup = new Date(new Date(DEADLINE).getTime() - 15 * 3600_000).toISOString();
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
  setClock(THURSDAY_0900);
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
    case 'offline':
      s.settings.offline = !s.settings.offline;
      return emit();
    case 'channel':
      s.settings.channel = s.settings.channel === 'twilio' ? 'simulator' : 'twilio';
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
