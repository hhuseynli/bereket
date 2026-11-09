#!/usr/bin/env node
// npm run demo:whatsapp-test [-- --no-reset] [-- --timeout=180]
// Guided end-to-end test with real phones. For each step it prints exactly what to send from which phone,
// then watches the running app and reports what actually happened. It never sends anything by itself
// except the replies the app normally sends, and it never fakes a step: a step you skip is reported as such.
// Needs: npm run demo:launch -- --whatsapp=twilio, npm run demo:tunnel (sandbox URL set), FARMER_PHONES.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { DATA, PORT, Report, action, args, bold, dim, director, farmerPhones, green, healthy, loadEnv, maskPhone, red, state, tunnelInfo, yellow } from './lib.mjs';

const a = args();
const env = loadEnv();
const TIMEOUT = Number(a.timeout ?? 180) * 1000;
const r = new Report('Real WhatsApp test');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const S = () => state(PORT);
const phones = Object.fromEntries(farmerPhones(env).filter((p) => p.valid).map((p) => [p.id, p.phone]));

// ---------- Preconditions ----------
r.section('Preconditions');
const pre = [];
const up = await healthy(PORT);
if (!up) pre.push('app not running: npm run demo:launch -- --whatsapp=twilio');
const t = tunnelInfo();
t?.running ? r.pass('Tunnel', `${t.url} — the sandbox "When a message comes in" must be ${t.url}/api/twilio`) : pre.push('tunnel not running: npm run demo:tunnel');
for (const id of ['f-elsen', 'f-rauf', 'f-sebine']) phones[id] ? r.pass(`Phone ${id}`, maskPhone(phones[id])) : pre.push(`FARMER_PHONES has no number for ${id}`);
if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) pre.push('Twilio keys missing in .env.local');
if (pre.length) {
  for (const p of pre) r.fail('Not ready', p);
  r.summary();
  rl.close();
  process.exit(1);
}
// Only now change the running app: everything needed for the test is in place.
if ((await S()).settings.channel !== 'twilio') {
  await director(PORT, 'channel', 'twilio');
  r.info('WhatsApp channel', 'switched to Twilio for this test (W switches back)');
} else r.pass('WhatsApp channel', 'Twilio');
console.log(dim('\n  Each phone must have joined the sandbox ("join <code>" to +1 415 523 8886) within the last 3 days.'));
if (!a['no-reset']) {
  await director(PORT, 'reset');
  r.info('State', 'reset to Act 1');
}

const steps = [];
async function stepWait(no, title, instruction, fn, { optional = false } = {}) {
  console.log(`\n${bold(`Step ${no}. ${title}`)}`);
  if (instruction) console.log(`  ${instruction}`);
  console.log(dim(`  Waiting up to ${TIMEOUT / 1000} s… (Ctrl+C to stop; type s + Enter to skip)`));
  const t0 = Date.now();
  let skip = false;
  const onLine = (l) => { if (l.trim() === 's') skip = true; };
  rl.on('line', onLine);
  let result;
  while (Date.now() - t0 < TIMEOUT && !skip) {
    result = await fn(await S()).catch(() => undefined);
    if (result?.ok) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  rl.off('line', onLine);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const status = result?.ok ? 'PASS' : skip ? 'SKIP' : optional ? 'WARN' : 'FAIL';
  r.add(status, `${no}. ${title}`, `${result?.detail ?? (skip ? 'skipped by you' : 'not observed')} (${secs} s)`);
  steps.push({ no, title, status, detail: result?.detail, secs: Number(secs) });
  return status === 'PASS';
}
const lastOut = (s, f) => [...s.messages].reverse().find((m) => m.farmerId === f && m.dir === 'out');
const delivered = (m) => (m ? (m.delivery === 'failed' ? `NOT delivered: ${m.deliveryError}` : m.delivery) : 'no reply yet');

// ---------- Elşən: voice note + photo → listing ----------
const elsen = maskPhone(phones['f-elsen']);
await stepWait(1, 'Elşən’s voice note reaches the app',
  `From ${bold(elsen)} send a ${bold('voice note')} in Azerbaijani: ${green('"Salam. Mənim yüz səksən kilo Roma pomidorum var, birinci sortdur. Bu gün yığıram. Kilosunu bir manat on beş qəpikdən verirəm."')}\n  then a ${bold('photo')} of pink tomatoes (order does not matter).`,
  async (s) => { const m = s.messages.find((x) => x.farmerId === 'f-elsen' && x.dir === 'in' && x.via === 'twilio' && x.kind === 'voice'); return { ok: !!m, detail: m ? 'voice note received through the Twilio webhook' : undefined }; });
await stepWait(2, 'ElevenLabs transcribes it (LIVE)', '',
  async (s) => { const run = s.aiRuns.find((x) => x.farmerId === 'f-elsen'); const st = run?.steps.find((x) => x.key === 'transcribe'); return { ok: st?.status === 'done' && st.mode === 'live', detail: st ? `${st.status}, ${st.mode ?? '?'}: “${(st.output ?? '').slice(0, 90)}”` : undefined }; });
await stepWait(3, 'The AI extracts the listing and inspects the photo', '',
  async (s) => { const run = s.aiRuns.find((x) => x.farmerId === 'f-elsen'); const ex = run?.steps.find((x) => x.key === 'extract'); const ins = run?.steps.find((x) => x.key === 'inspect'); const l = s.listings.find((x) => x.farmerId === 'f-elsen' && x.product === 'Tomato'); return { ok: !!l && ex?.mode === 'live', detail: l ? `${l.qtyKg} kg ${l.variety} @ ${l.priceAzn} ₼, stage ${l.ripeness} · extract ${ex?.mode}, photo ${ins?.mode}${run?.status === 'needs_review' ? ' · NEEDS REVIEW (approve on Intake)' : ''}` : run?.steps.map((x) => `${x.key}:${x.status}`).join(' ') }; });
await stepWait(4, 'The Intake screen shows it', dim('  Look at Operator → Intake on the laptop: the five steps should be ticked.'),
  async (s) => ({ ok: s.aiRuns.some((x) => x.farmerId === 'f-elsen' && x.listingId), detail: 'AI run with a drafted listing is in the shared state (the UI renders it via SSE)' }));
await stepWait(5, 'Elşən gets the confirmation card on WhatsApp', `On ${elsen}: a message titled ${bold('“Elanınız hazırdır”')} should arrive.`,
  async (s) => { const m = [...s.messages].reverse().find((x) => x.farmerId === 'f-elsen' && x.dir === 'out' && x.card?.title === 'Elanınız hazırdır'); return { ok: !!m && ['sent', 'delivered', 'read'].includes(m.delivery), detail: m ? `Twilio: ${delivered(m)}` : undefined }; });
await stepWait(6, 'Elşən replies 1 and the listing goes live', `From ${bold(elsen)} reply ${green('1')}`,
  async (s) => { const l = s.listings.find((x) => x.farmerId === 'f-elsen' && x.product === 'Tomato'); const m = lastOut(s, 'f-elsen'); return { ok: l?.status === 'live', detail: l ? `listing ${l.status}; reply ${delivered(m)}` : undefined }; });

// ---------- Order, then Rauf cancels ----------
console.log(`\n${bold('Preparing Act 2 automatically')} ${dim('(Find supply, confirm option i, other farmers accept)')}`);
try {
  const s0 = await S();
  if (!s0.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && l.status === 'live')) await director(PORT, 'elsenFallback');
  await action(PORT, 'findSupply', { tenderId: 'T-1042' });
  const p = (await S()).proposals.find((x) => x.key === 'best_fit');
  await action(PORT, 'confirmProposal', { proposalId: p.id });
  console.log(`  Offers went out on WhatsApp to the mapped farmers. ${bold(`From ${elsen} reply 1`)} to accept, or skip.`);
} catch (e) {
  r.fail('Act 2 setup', e.message);
}
await stepWait(7, 'Elşən accepts the order on WhatsApp', `From ${bold(elsen)} reply ${green('1')}`,
  async (s) => { const al = s.orders[0]?.allocations.find((x) => x.farmerId === 'f-elsen'); return { ok: al?.status === 'accepted', detail: al ? `allocation ${al.status}` : undefined }; }, { optional: true });
await director(PORT, 'acceptOthers'); // Gülnarə and Rauf accept (as in the live demo's A key)
await new Promise((res) => setTimeout(res, 2500));
const sebine = maskPhone(phones['f-sebine']);
await stepWait(8, 'Səbinə opens her 24-hour window', `From ${bold(sebine)} send any text, e.g. ${green('"Salam, pomidorlarım hələ satılmayıb."')}`,
  async (s) => ({ ok: s.messages.some((m) => m.farmerId === 'f-sebine' && m.dir === 'in' && m.via === 'twilio'), detail: 'message received' }));
const rauf = maskPhone(phones['f-rauf']);
await stepWait(9, 'Rauf cancels by voice → operator view offers the recovery',
  `From ${bold(rauf)} send a ${bold('voice note')}: ${green('"Salam, bağışlayın. Dünən gecə dolu pomidorları vurdu, göndərə bilmirəm."')}`,
  async (s) => { const rec = s.orders[0]?.recovery; const c = rec?.selected !== undefined ? rec.candidates[rec.selected] : undefined; return { ok: rec?.status === 'proposed' || rec?.status === 'offered' || rec?.status === 'resolved', detail: rec ? `${rec.status}: ${rec.shortfallKg} kg gap${c ? `, backup ${c.farmerId}` : ''}${rec.cause ? `, cause “${rec.cause}”` : ''}` : undefined }; });
console.log(dim('\n  Optional: click "Approve and send offer" on Operator → Logistics; Səbinə replies 1 on her phone; the order is repaired at 1.35 ₼/kg.'));
await stepWait(10, 'Səbinə accepts the backup offer (optional)', `Approve on the laptop, then from ${bold(sebine)} reply ${green('1')}`,
  async (s) => { const o = s.orders[0]; return { ok: o?.recovery?.status === 'resolved', detail: o ? `recovery ${o.recovery?.status}, ${o.costs.perKg} ₼/kg` : undefined }; }, { optional: true });

rl.close();
const failedOut = (await S()).messages.filter((m) => m.delivery === 'failed');
if (failedOut.length) r.warn('WhatsApp deliveries', `${failedOut.length} failed: ${[...new Set(failedOut.map((m) => m.deliveryError))].join(' | ')}`);
const ok = r.summary();
fs.writeFileSync(path.join(DATA, 'whatsapp-test.json'), JSON.stringify({ at: new Date().toISOString(), ok, steps }, null, 2));
console.log(ok ? green('\n  Real WhatsApp round trip verified.') : (steps.some((s) => s.status === 'FAIL') ? red : yellow)('\n  See the steps above; .data/whatsapp-test.json has the record.'));
process.exit(ok ? 0 : 1);
