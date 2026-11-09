// Demo-readiness checks added for the live presentation: timeline, AI result validation and labelling,
// Twilio webhook security and de-duplication. No network, no keys.
import os from 'node:os';
import path from 'node:path';
process.env.DEMO_DATA_DIR = path.join(os.tmpdir(), `berekat-readiness-${process.pid}`);
process.env.DEMO_RESTORE = '0';
process.env.DEMO_STEP_MS = '0';
process.env.ELEVENLABS_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.DEEPSEEK_API_KEY = '';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractListing, inspectPhoto, offlineExtract, transcribe, validateExtracted, validateInspection, wordsToDigits } from './ai';
import { generateProposals } from './engine';
import { director } from './flows';
import { currentAct } from './presenter';
import { elsenListingFields, initialState, timeline } from './seed';
import { getState } from './store';
import { twilioSignature, validateTwilioRequest } from './twilio';
import type { Listing } from './types';

test('timeline is built from one demo day and stays internally consistent', () => {
  for (const day of ['2026-11-10', '2026-11-11', '2027-03-01']) {
    process.env.DEMO_DATE = day;
    const t = timeline();
    assert.equal(t.day, day);
    assert.equal(new Date(t.start).toLocaleString('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', minute: '2-digit' }), '14:00');
    assert.equal((new Date(t.deadline).getTime() - new Date(t.start).getTime()) / 3600_000, 19);
    assert.ok(new Date(t.seededAt) < new Date(t.start));
    const s = initialState();
    assert.equal(s.clock.base, t.start);
    assert.equal(s.tenders[0].deadline, t.deadline);
    assert.ok(s.listings.every((l) => l.harvest === day));
    // The engine numbers do not depend on the calendar date.
    const l: Listing = { id: 'l-x', farmerId: 'f-elsen', ...elsenListingFields(), ripenessConfidence: 0.9, defects: [], status: 'live', createdAt: t.start, source: 'whatsapp' };
    s.listings.push(l);
    assert.deepEqual(generateProposals(s, s.tenders[0], t.start).proposals.map((p) => p.costs.perKg), [1.33, 1.23, 1.38]);
  }
  delete process.env.DEMO_DATE;
});

test('mixed digits and Azerbaijani number words from speech-to-text', () => {
  assert.equal(wordsToDigits('100 səksən kilo'), '180 kilo');
  assert.equal(wordsToDigits('iki yüz 20 kilo'), '220 kilo');
  assert.equal(wordsToDigits('180 kilo, 1 manat 15 qəpik'), '180 kilo, 1 manat 15 qəpik');
  assert.equal(wordsToDigits('yüz səksən kilo'), '180 kilo');
  const ex = offlineExtract('Mənim 100 səksən kilo Roma pomidorum var. Kilosu bir manat on beş qəpik.', '2026-11-10T10:00:00Z');
  assert.equal(ex.qtyKg, 180);
  assert.equal(ex.priceAzn, 1.15);
});

test('model output that invents or mangles numbers is caught', () => {
  const az = 'Mənim yüz səksən kilo Roma pomidorum var. Kilosunu bir manat on beş qəpikdən verirəm.';
  const good = validateExtracted({ product: 'Tomato', variety: 'Roma', qtyKg: 180, priceAzn: 1.15, confidence: { qtyKg: 0.95, priceAzn: 0.95 } }, az);
  assert.equal(good.qtyKg, 180);
  assert.equal(good.confidence.qtyKg, 0.95);
  assert.equal(good.confidence.priceAzn, 0.95);
  const bad = validateExtracted({ product: 'Tomato', qtyKg: 1800, priceAzn: '1,50', grade: 7, harvestDate: 'today', confidence: { qtyKg: 0.99, priceAzn: 0.99 } }, az);
  assert.equal(bad.qtyKg, 1800);
  assert.ok(bad.confidence.qtyKg <= 0.5, 'quantity not in transcript gets low confidence');
  assert.ok(bad.confidence.priceAzn <= 0.5, 'price not in transcript gets low confidence');
  assert.equal(bad.grade, undefined);
  assert.equal(bad.harvest, undefined);
  // Live models answer "tomato" or "Tomatoes"; the engine needs the platform's exact name.
  assert.equal(validateExtracted({ product: 'tomatoes', variety: 'roma' }, az).product, 'Tomato');
  assert.equal(validateExtracted({ product: 'tomato', variety: 'roma' }, az).variety, 'Roma');
  const none = validateExtracted({ product: null, qtyKg: null, priceAzn: -3 }, 'Salam');
  assert.equal(none.product, undefined);
  assert.equal(none.priceAzn, undefined);
  const insp = validateInspection({ ripeness: '9', confidence: 3, defects: ['ok', 5], spoiled: 'true' });
  assert.deepEqual([insp.ripeness, insp.confidence, insp.defects, insp.spoiled], [6, 1, ['ok'], true]);
});

test('without keys, results are labelled simulated and real recordings are never given a made-up transcript', async () => {
  const ex = await extractListing('yüz səksən kilo pomidor', '2026-11-10T10:00:00Z', 'live');
  assert.equal(ex.mode, 'simulated');
  assert.equal(ex.data.qtyKg, 180);
  const scripted = await transcribe(Buffer.from('fake audio'), 'audio/ogg', { aiMode: 'live', scriptedAz: 'Salam' });
  assert.equal(scripted.mode, 'simulated');
  await assert.rejects(transcribe(Buffer.from('a real farmer recording'), 'audio/ogg', { aiMode: 'live' }));
  const photo = await inspectPhoto(Buffer.from('jpeg bytes'), 'image/jpeg', { aiMode: 'cached' });
  assert.equal(photo.mode, 'simulated');
  assert.ok(photo.data.confidence < 0.6, 'an unscripted photo without AI goes to review');
});

test('Twilio signature matches the published algorithm and is required on the webhook', async () => {
  // Test vector from Twilio's own request-validator tests (twilio-python).
  const params = new URLSearchParams({ CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' });
  assert.equal(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params), 'RSOYDt4T1cUTdK1PDd93/VVr8B8=');

  process.env.TWILIO_AUTH_TOKEN = 'test-token-123';
  process.env.PUBLIC_BASE_URL = 'https://demo.example.com';
  const body = new URLSearchParams({ MessageSid: 'SM1', From: 'whatsapp:+994501112233', Body: 'Salam', NumMedia: '0' });
  const sig = twilioSignature('test-token-123', 'https://demo.example.com/api/twilio', body);
  // Behind the tunnel the request arrives on the local address; the public URL is what was signed.
  const local = (h: Record<string, string>) => new Request('http://127.0.0.1:3000/api/twilio', { method: 'POST', headers: h, body: body.toString() });
  assert.equal(validateTwilioRequest(local({ 'x-twilio-signature': sig }), body).ok, true);
  assert.equal(validateTwilioRequest(local({ 'x-twilio-signature': 'forged=' }), body).ok, false);
  assert.equal(validateTwilioRequest(local({}), body).ok, false);
  delete process.env.PUBLIC_BASE_URL;
  const viaHeaders = local({ 'x-twilio-signature': twilioSignature('test-token-123', 'https://abc.trycloudflare.com/api/twilio', body), 'x-forwarded-host': 'abc.trycloudflare.com', 'x-forwarded-proto': 'https' });
  assert.equal(validateTwilioRequest(viaHeaders, body).ok, true);
});

test('webhook: unknown numbers are ignored, known farmers are queued once', async () => {
  process.env.TWILIO_AUTH_TOKEN = 'test-token-123';
  process.env.PUBLIC_BASE_URL = 'https://demo.example.com';
  process.env.FARMER_PHONES = 'f-sebine=+994701112233';
  const { POST } = await import('../app/api/twilio/route');
  await director('reset');
  const send = (fields: Record<string, string>) => {
    const body = new URLSearchParams(fields);
    const sig = twilioSignature('test-token-123', 'https://demo.example.com/api/twilio', body);
    return POST(new Request('http://127.0.0.1:3000/api/twilio', { method: 'POST', headers: { 'x-twilio-signature': sig }, body: body.toString() }));
  };
  const farmersBefore = getState().farmers.length;
  assert.equal((await send({ MessageSid: 'SMstranger', From: 'whatsapp:+15550001111', Body: 'hi', NumMedia: '0' })).status, 200);
  assert.equal(getState().farmers.length, farmersBefore, 'strangers are not registered');

  const msg = { MessageSid: 'SMsebine1', From: 'whatsapp:+994701112233', Body: 'Salam, pomidorlarım hələ satılmayıb.', NumMedia: '0' };
  assert.equal((await send(msg)).status, 200);
  assert.equal((await send(msg)).status, 200); // Twilio retry
  for (let i = 0; i < 50 && getState().messages.filter((m) => m.farmerId === 'f-sebine' && m.dir === 'in').length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(getState().messages.filter((m) => m.farmerId === 'f-sebine' && m.dir === 'in').length, 1, 'duplicate webhook processed once');
  assert.ok(getState().lastInboundAt['f-sebine'] > 0, '24-hour window opened');
  delete process.env.PUBLIC_BASE_URL;
  delete process.env.FARMER_PHONES;
});

test('presenter act tracker starts at Act 1 after a reset', async () => {
  await director('reset');
  const a = currentAct(getState());
  assert.equal(a.n, 1);
  await director('elsenFallback');
  assert.equal(currentAct(getState()).n, 2);
});

test('cost vs selling price: the asking price wins and is flagged for the farmer to confirm', () => {
  const az = 'Salam əleykum, necəsiz? Dəməli, mənim əşşək 400 kilo almam var. İki günə, üç günə müştəri istəyirəm getsin Bakıya. Qiyməti belə bir manat 25 qəpikdən mayasıdır. Özünü satacam bir manat 50 qəpikə. Nə tərdir sizin üçün?';
  const ex = offlineExtract(az, '2026-11-08T10:00:00Z');
  assert.equal(ex.product, 'Apple');
  assert.equal(ex.qtyKg, 400);
  assert.equal(ex.priceAzn, 1.5);
  assert.ok(ex.confidence.priceAzn < 0.6, 'two prices said: ask the farmer');
  // A model that picks the cost price is not trusted blindly either.
  const fromModel = validateExtracted({ product: 'Apple', qtyKg: 400, priceAzn: 1.25, confidence: { priceAzn: 0.95 } }, az);
  assert.ok(fromModel.confidence.priceAzn <= 0.6);
});

test('chat: draft without a photo, fix the price by message, Düzəliş keeps the draft, photo later, confirm', async () => {
  const { handleInbound, demoPhoto } = await import('./flows');
  await director('reset');
  const s = () => getState();
  const say = (text: string) => handleInbound({ farmerId: 'f-elsen', text, via: 'simulator' });
  await say('Mənim 400 kilo almam var. Mayası bir manat 25 qəpikdir, bir manat 50 qəpikə satacam.');
  const draft = s().listings.find((l) => l.farmerId === 'f-elsen' && l.status === 'draft')!;
  assert.ok(draft, 'a draft is made even without a photo');
  assert.equal(draft.priceAzn, 1.5);
  const run = s().aiRuns.find((r) => r.listingId === draft.id)!;
  assert.match(run.waitingFor ?? '', /confirmation.*photo/);
  const card = [...s().messages].reverse().find((m) => m.farmerId === 'f-elsen' && m.card)!;
  assert.match(card.text ?? '', /satış qiymətiniz budurmu/, 'the bot asks about the uncertain price');

  await say('yox, qiymət bir manat 40 qəpik olsun');
  assert.equal(draft.priceAzn, 1.4);
  assert.deepEqual(run.edits?.map((e) => [e.field, e.from, e.to]), [['priceAzn', '1.5', '1.4']]);

  await say('2');
  assert.equal(draft.status, 'draft', 'Düzəliş asks what to fix instead of throwing the draft away');
  await say('350 kilo');
  assert.equal(draft.qtyKg, 350);

  // A tomato photo for an apple listing is not used: the farmer is told why and the listing is unchanged.
  await handleInbound({ farmerId: 'f-elsen', photo: demoPhoto('tomatoes-stage4'), via: 'simulator' });
  assert.equal(draft.ripenessConfidence, 0);
  assert.equal(draft.photoUrl, undefined);
  assert.match([...s().messages].reverse().find((m) => m.farmerId === 'f-elsen' && m.dir === 'out')!.text ?? '', /pomidor görünür.*alma üçündür/);

  await say('1');
  assert.equal(draft.status, 'live');
});

test('photos: non-produce, screens, drawings, cooked food and old produce are never used as they are', async () => {
  const { judgePhoto } = await import('./flows');
  const v = (j: Record<string, unknown>, product = 'Tomato') => judgePhoto(validateInspection(j), product);
  const ok = { problem: null, product: 'Tomato', ripeness: 4, confidence: 0.9, freshness: 'fresh', grade: 1, defects: [], spoiled: false };
  assert.equal(v(ok).kind, 'use');
  assert.equal((v(ok) as { minGrade?: number }).minGrade, undefined);
  for (const problem of ['not_produce', 'not_a_real_photo', 'screen', 'cooked_or_processed', 'unclear']) assert.equal(v({ ...ok, problem }).kind, 'reject', problem);
  assert.equal(v({ ...ok, product: 'N/A - not produce', problem: null }).kind, 'reject', 'no product named: not produce');
  assert.equal(v({ ...ok, product: 'cucumbers' }).kind, 'reject', 'wrong product');
  assert.equal(v({ ...ok, product: 'tomatoes' }).kind, 'use', 'plural names match');
  assert.equal(v({ ...ok, freshness: 'old', defects: ['wrinkled skin'] }).kind, 'hold');
  assert.equal(v({ ...ok, spoiled: true, defects: ['mould'] }).kind, 'hold');
  assert.equal((v({ ...ok, freshness: 'aging', defects: ['dry calyx'] }) as { minGrade?: number }).minGrade, 2);
  assert.equal((v({ ...ok, grade: 3, defects: ['cracks on many fruit'] }) as { minGrade?: number }).minGrade, 3);
  assert.equal((v({ ...ok, grade: 2, defects: [] }) as { minGrade?: number }).minGrade, undefined, 'a grade without visible reasons does not downgrade');
});

test('chat: the model can never apply numbers the farmer did not say, or act outside the situation', async () => {
  const { validateTurn } = await import('./agent');
  const ctx = { farmerFirstName: 'Elşən', today: '2026-11-08', situation: 'draft' as const, facts: {}, history: [], allowed: ['update_listing', 'confirm_listing', 'withdraw_listing', 'reply'] as never, fromVoice: false };
  const t1 = validateTurn({ action: 'update_listing', fields: { priceAzn: 2.0, qtyKg: 350 }, reply_az: 'Oldu' }, 'miqdar 350 kilo', ctx);
  assert.deepEqual(t1.fields, { qtyKg: 350 });
  assert.deepEqual(t1.rejected, ['priceAzn=2']);
  const t2 = validateTurn({ action: 'cancel_order', reply_az: 'Ləğv etdim' }, 'ləğv et', ctx);
  assert.equal(t2.action, 'reply', 'cancel_order is not allowed while a draft is open');
  const t3 = validateTurn({ action: 'update_listing', fields: { priceAzn: 1.5 } }, 'bir manat əlli qəpik', ctx);
  assert.equal(t3.fields?.priceAzn, 1.5, 'number words count as said');
});

test('chat: a farmer’s quick follow-up waits for the message before it (no double drafts)', async () => {
  const { handleInbound } = await import('./flows');
  await director('reset');
  process.env.DEMO_STEP_MS = '40';
  const say = (text: string) => handleInbound({ farmerId: 'f-gulnare', text, via: 'simulator' });
  // Fired together, like a farmer typing fast.
  await Promise.all([say('Mənim 200 kilo xiyarım var, kilosu bir manat 20 qəpik.'), say('yox, 180 kilo')]);
  process.env.DEMO_STEP_MS = '0';
  const drafts = getState().listings.filter((l) => l.farmerId === 'f-gulnare' && l.status === 'draft');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].qtyKg, 180, 'the correction applied after the draft existed');
});

test('bad network: a slow live call shows the verified result after the grace period; a dead provider is skipped', async () => {
  const { resolveAi } = await import('./ai');
  process.env.AI_LIVE_GRACE_MS = '50';
  const live = (v: string) => ({ provider: 'p-test', model: 'm', run: async () => v });
  assert.equal((await resolveAi('t', 'grace-key', 'live', live('fresh'), () => 'script')).mode, 'live');
  const slow = { provider: 'p-test', model: 'm', run: () => new Promise<string>((r) => setTimeout(() => r('late'), 400)) };
  const r1 = await resolveAi('t', 'grace-key', 'live', slow, () => 'script');
  assert.deepEqual([r1.mode, r1.value], ['cached', 'fresh']);
  assert.match(r1.note ?? '', /slower than/);
  const dead = { provider: 'p-dead', model: 'm', run: async () => { throw new Error('fetch failed'); } };
  assert.equal((await resolveAi('t', 'dead-key', 'live', dead, () => 'script')).mode, 'simulated');
  let called = false;
  const again = { provider: 'p-dead', model: 'm', run: async () => { called = true; return 'x'; } };
  const r2 = await resolveAi('t', 'dead-key-2', 'live', again, () => 'script');
  assert.equal(called, false, 'provider skipped while the breaker is open');
  assert.match(r2.note ?? '', /unreachable/);
  delete process.env.AI_LIVE_GRACE_MS;
  await new Promise((r) => setTimeout(r, 450)); // let the slow call settle
});

test('voice replies: numbers, money and cards are spoken as natural Azerbaijani', async () => {
  const { numAz, moneyAz, spokenAz, speechFor } = await import('./tts');
  assert.equal(numAz(180), 'yüz səksən');
  assert.equal(numAz(1250), 'min iki yüz əlli');
  assert.equal(numAz(2206), 'iki min iki yüz altı');
  assert.equal(moneyAz(1.15), 'bir manat on beş qəpik');
  assert.equal(moneyAz(97.6), 'doxsan yeddi manat altmış qəpik');
  assert.equal(moneyAz(0.5), 'əlli qəpik');
  assert.equal(spokenAz('Düzəltdim: qiymət 1.40 ₼/kq, miqdar 350 kq.'), 'Düzəltdim: qiymət bir manat qırx qəpik, miqdar üç yüz əlli kilo.');
  assert.equal(spokenAz('Yığım: bu gün, 18:00'), 'Yığım: bu gün, saat on səkkiz');
  const card = speechFor({ text: '', card: { title: 'Elanınız hazırdır', rows: [['Məhsul', 'Pomidor (Roma)'], ['Miqdar', '180 kq'], ['Qiymət', '1.15 ₼/kq'], ['Sort', '1'], ['Yetişmə', '4/6, çəhrayı'], ['Yığım', 'bu gün']] } });
  assert.match(card, /^Elanınız hazırdır: yüz səksən kilo Pomidor \(Roma\), bir manat on beş qəpik\. Yetişmə: çəhrayı\./);
  assert.ok(!/\d/.test(card), 'no digits left for the voice to misread');
  const offer = speechFor({ text: 'Ödəniş təhlükəsiz hesabda saxlanılır.', card: { title: 'Yeni sifariş', rows: [['Alıcı', 'Nərgiz Kitchen Group'], ['Miqdar', '80 kq × 1.22 ₼'], ['Məbləğ', '97.60 ₼'], ['Yığım', 'bu gün, 18:00']] } });
  assert.match(offer, /səksən kilo, kilosu bir manat iyirmi iki qəpik alır, cəmi doxsan yeddi manat altmış qəpik\. Yığım bu gün, saat on səkkiz\./);
});

test('demo data off: only listings from phones are matched, and a reset keeps the choice', async () => {
  await director('reset');
  const t = () => getState().tenders.find((x) => x.id === 'T-1042')!;
  assert.ok(getState().listings.some((l) => l.source === 'seed'));
  await director('demoData', 'off');
  assert.equal(getState().listings.length, 0);
  await director('elsenFallback'); // Elşən's 180 kg from the phone: not enough for 400 kg
  const { findSupply } = await import('./flows');
  await findSupply('T-1042');
  assert.equal(t().proposalIds.length, 0);
  await director('reset');
  assert.equal(getState().settings.demoData, false);
  assert.equal(getState().listings.length, 0);
  await director('demoData', 'on');
  await director('elsenFallback');
  await findSupply('T-1042');
  assert.deepEqual(getState().proposals.map((p) => p.costs.perKg.toFixed(2)), ['1.33', '1.23', '1.38']);
  await director('reset');
  assert.equal(getState().settings.demoData, true);
});

test('product workflow: post a tender for any product, match, accept, partial delivery, pickup, arrival, payout; cancel and refund', async () => {
  const f = await import('./flows');
  await director('reset');
  await director('demoData', 'off');
  const s = () => getState();
  const lot = (id: string, farmerId: string, qtyKg: number, priceAzn: number): Listing => ({
    id, farmerId, product: 'Cucumber', variety: 'Local', grade: 1, qtyKg, priceAzn, ripeness: 3, ripenessConfidence: 0.8,
    defects: [], harvest: '2026-11-10', status: 'live', createdAt: new Date().toISOString(), source: 'whatsapp',
  });
  s().listings.push(lot('c-1', 'f-elsen', 150, 1.1), lot('c-2', 'f-gulnare', 140, 1.2));
  const deadline = new Date(Date.parse(s().clock.base) + 30 * 3600_000).toISOString();
  assert.throws(() => f.createTender({ product: 'Cucumber', qtyKg: 0, maxPriceAzn: 2, deadline }), /Quantity/);
  assert.throws(() => f.createTender({ product: 'Cucumber', qtyKg: 10, maxPriceAzn: 2, deadline: s().clock.base }), /3 hours/);
  const id = f.createTender({ product: 'cucumbers', qtyKg: 250, maxPriceAzn: 1.6, deadline });
  const t = s().tenders.find((x) => x.id === id)!;
  assert.equal(t.product, 'Cucumber');
  assert.equal(t.variety, 'Any');

  await f.findSupply(id);
  assert.ok(t.proposalIds.length >= 1, 'cucumbers are matched without a ripeness window');
  const orderId = f.confirmProposal(t.proposalIds[0]);
  const o = s().orders.find((x) => x.id === orderId)!;
  // 150 + 100 of Gülnarə's 140: the 40 kg she has left stays on sale as its own listing.
  for (const a of o.allocations) assert.equal(s().listings.find((l) => l.id === a.listingId)!.status, 'reserved');
  assert.ok(s().listings.some((l) => l.farmerId === 'f-gulnare' && l.product === 'Cucumber' && l.status === 'live' && l.qtyKg === 40));
  const offer = [...s().messages].reverse().find((m) => m.farmerId === o.allocations[0].farmerId && m.card?.title === 'Yeni sifariş')!;
  assert.ok(offer.card!.rows.some(([k, v]) => k === 'Məhsul' && /Xiyar/.test(v)));

  // Elşən declines; nobody else has enough cucumbers: the buyer takes the rest.
  const first = o.allocations.find((a) => a.farmerId === 'f-elsen')!;
  const rest = o.allocations.filter((a) => a !== first);
  await f.handleInbound({ farmerId: first.farmerId, text: '2', via: 'simulator' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(o.recovery?.status, 'no_backup');
  for (const a of rest) await f.handleInbound({ farmerId: a.farmerId, text: '1', via: 'simulator' });
  f.acceptPartial(orderId);
  assert.equal(o.partialKg, rest.reduce((n, a) => n + a.qtyKg, 0));
  assert.equal(o.status, 'confirmed');

  f.markPickedUp(orderId);
  assert.equal(o.status, 'picked_up');
  f.markDelivered(orderId);
  assert.equal(o.status, 'delivered');
  f.confirmReceipt(orderId);
  assert.equal(o.status, 'settled');
  assert.equal(o.escrow.status, 'released');

  // A second tender, cancelled by the buyer after ordering: refunded, lots back on sale, tender open again.
  s().listings.push(lot('c-4', 'f-sebine', 100, 1.15));
  const id2 = f.createTender({ product: 'Cucumber', qtyKg: 100, maxPriceAzn: 2, deadline });
  await f.findSupply(id2);
  const t2 = s().tenders.find((x) => x.id === id2)!;
  const o2id = f.confirmProposal(t2.proposalIds[0]);
  const o2 = s().orders.find((x) => x.id === o2id)!;
  f.cancelOrder(o2.id);
  assert.equal(o2.status, 'cancelled');
  assert.equal(o2.escrow.status, 'refunded');
  assert.equal(t2.status, 'open');
  for (const a of o2.allocations) assert.equal(s().listings.find((l) => l.id === a.listingId)!.status, 'live');
  await director('demoData', 'on');
  await director('reset');
});

test('matching splits lots so every farm sells at least 60%: 180 + 120 kg fill 250 kg as 178 + 72', () => {
  const st = initialState();
  const t = st.tenders.find((x) => x.id === 'T-1043')!;
  st.listings = st.listings.filter((l) => l.product !== 'Cucumber');
  const lot = (id: string, farmerId: string, qtyKg: number, priceAzn: number): Listing => ({
    id, farmerId, product: 'Cucumber', variety: 'Local', grade: 1, qtyKg, priceAzn, ripeness: 0, ripenessConfidence: 0.8,
    defects: [], harvest: '2026-11-10', status: 'live', createdAt: st.clock.base, source: 'seed',
  });
  st.listings.push(lot('a', 'f-gulay', 180, 1.25), lot('b', 'f-gulnare', 120, 1.3));
  const r = generateProposals(st, t, st.clock.base);
  assert.equal(r.proposals.length, 1);
  assert.deepEqual(r.proposals[0].allocations.map((a) => [a.listingId, a.qtyKg]).sort(), [['a', 178], ['b', 72]]);
});

test('self sign-up: a judge creates a farmer, chats in English, and gets English cards and voice text', async () => {
  const f = await import('./flows');
  const { forFarmer } = await import('./farmer-lang');
  const { speechFor } = await import('./tts');
  await director('reset');
  assert.throws(() => f.createFarmer({ name: 'A', place: 'Quba', lang: 'en' }), /name/);
  assert.throws(() => f.createFarmer({ name: 'Judge One', place: 'Atlantis', lang: 'en' }), /district/);
  const id = f.createFarmer({ name: 'Judge <b>One</b>', place: 'Lənkəran', lang: 'en' });
  const me = getState().farmers.find((x) => x.id === id)!;
  assert.equal(me.name, 'Judge bOne/b');
  assert.ok(Math.abs(me.lat - 38.753) < 0.05 && me.selfSignup);
  const welcome = getState().messages.find((m) => m.farmerId === id)!;
  assert.match(welcome.text ?? '', /^Welcome!/);

  // Cards are translated for English farmers; Azerbaijani farmers get them unchanged.
  const card = { kind: 'card' as const, text: 'Ödəniş təhlükəsiz hesabda saxlanılır.', textEn: 'Payment is held safely. New order from X: 80 kg.', card: { title: 'Yeni sifariş', rows: [['Məhsul', 'Pomidor (Roma)'], ['Miqdar', '80 kq × 1.22 ₼'], ['Yığım', 'bu gün, 18:00']] as [string, string][], actions: [{ label: 'Qəbul', reply: '1' }, { label: 'İmtina', reply: '2' }] } };
  const en = forFarmer(card, 'en');
  assert.equal(en.card!.title, 'New order');
  assert.deepEqual(en.card!.rows, [['Product', 'Tomato (Roma)'], ['Quantity', '80 kg × 1.22 ₼'], ['Pickup', 'today, 18:00']]);
  assert.deepEqual(en.card!.actions!.map((a) => a.label), ['Accept', 'Decline']);
  assert.equal(en.text, 'Payment is held safely.');
  assert.equal(forFarmer(card, 'az'), card);
  assert.match(speechFor(en, 'en'), /New order! .*wants 80 kilos at 1\.22 manat/);

  // The assistant's rule path understands English too.
  f.setFarmerLang(id, 'en');
  await f.handleInbound({ farmerId: id, text: 'I have 300 kg of potatoes at 0.6 manat', via: 'simulator' });
  const draft = getState().listings.find((l) => l.farmerId === id && l.status === 'draft');
  assert.ok(draft, 'an English message makes a draft');
  assert.equal(draft!.product, 'Potato');
  const last = [...getState().messages].reverse().find((m) => m.farmerId === id && m.card)!;
  assert.equal(last.card!.title, 'Your listing is ready');
  await director('reset');
});
