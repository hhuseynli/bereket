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

  await handleInbound({ farmerId: 'f-elsen', photo: demoPhoto('tomatoes-stage4'), via: 'simulator' });
  assert.equal(draft.ripeness, 4);
  assert.ok(draft.ripenessConfidence > 0);

  await say('1');
  assert.equal(draft.status, 'live');
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
