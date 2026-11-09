#!/usr/bin/env node
// npm run demo:fallback — is the backup plan ready? Proves, on an isolated server with every API key removed,
// that the whole demo runs SIMULATED, that the L listing fallback works, that a server restart resumes where it
// stopped, and reports which inputs already have CACHED (previously verified) AI results for today's demo day.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apiFourActs } from './flow.mjs';
import { DATA, ROOT, Report, cleanScratch, dim, ensureBuild, findAsset, loadEnv, scratchDataDir, startServer, state } from './lib.mjs';

const r = new Report('Fallback readiness');
const env = loadEnv();
await ensureBuild();
cleanScratch();

// 1. Everything with no keys and no network services.
r.section('SIMULATED mode, all keys removed');
const noKeys = { ANTHROPIC_API_KEY: '', DEEPSEEK_API_KEY: '', ELEVENLABS_API_KEY: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', AI_MODE: 'simulated', WHATSAPP_CHANNEL: 'simulator', DEMO_RESTORE: '0', DEMO_STEP_MS: '0', DEMO_RECOVERY_MS: '200' };
const dir = scratchDataDir('fallback');
let srv = await startServer({ port: 3102, env: { ...noKeys, DEMO_DATA: '1', DEMO_DATA_DIR: dir } });
try {
  for (const [n, ok, d] of await apiFourActs(3102)) r.add(ok ? 'PASS' : 'FAIL', n, d);
  r.section('L: Act 1 skipped with the listing fallback');
  const viaL = await apiFourActs(3102, { useListingFallback: true });
  const bad = viaL.filter((x) => !x[1]);
  bad.length ? r.fail('Acts 2–4 after L', bad.map((x) => `${x[0]}: ${x[2]}`).join('; ')) : r.pass('Acts 2–4 after L', 'same numbers: 1.33 / 1.23 / 1.38, 80 kg, 1.35');

  // 2. Restart in the middle of Act 3: state comes back.
  r.section('Server restart mid-demo');
  const { action, director } = await import('./lib.mjs');
  await director(3102, 'reset');
  await director(3102, 'elsenFallback');
  await action(3102, 'findSupply', { tenderId: 'T-1042' });
  const before = await state(3102);
  await action(3102, 'confirmProposal', { proposalId: before.proposals[0].id });
  await new Promise((res) => setTimeout(res, 800)); // snapshot is written within 500 ms
  await srv.stop();
  srv = await startServer({ port: 3102, env: { ...noKeys, DEMO_DATA: '1', DEMO_DATA_DIR: dir, DEMO_RESTORE: '1' } });
  const after = await state(3102);
  after.orders[0]?.id === 'O-2207' && after.presenter.restored ? r.pass('Restart with --resume', `order ${after.orders[0].id} and Act ${after.presenter.act.n} restored`) : r.fail('Restart with --resume', 'state not restored');
} finally {
  await srv.stop();
}

// 3. Which inputs have verified results cached for today's demo day.
r.section('CACHED mode coverage (previously verified results)');
const h = (...parts) => { const x = crypto.createHash('sha256'); for (const p of parts) if (p) x.update(p); return x.digest('hex').slice(0, 24); };
const cache = (k) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'ai-cache', `${k}.json`), 'utf8')); } catch { return undefined; } };
const valueOf = (e) => (e && 'meta' in e && 'value' in e ? e.value : e);
const day = /^\d{4}-\d{2}-\d{2}$/.test(env.DEMO_DATE ?? '') ? env.DEMO_DATE : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const demoTs = fs.readFileSync(path.join(ROOT, 'src/lib/demo.ts'), 'utf8');
const scriptOf = (id) => demoTs.match(new RegExp(`'${id}': \\{[\\s\\S]*?az: '([^']+)'`))?.[1];
const cover = (label, entry, why) => (entry ? r.pass(label, `cached ${entry.meta ? `from ${entry.meta.provider} ${entry.meta.model}, ${entry.meta.at.slice(0, 16)}` : ''}`) : r.warn(label, why));

for (const id of ['elsen-listing', 'rauf-cancel']) {
  const f = findAsset(id).usable;
  if (!f) { r.info(`${id} recording`, 'none: the scripted transcript is used (SIMULATED), no cache needed'); continue; }
  const stt = cache(h('stt', fs.readFileSync(f)));
  cover(`${id}: transcript`, stt, 'not cached: run npm run demo:assets -- --ai');
  const text = valueOf(stt)?.text;
  if (id === 'elsen-listing' && text) cover('elsen-listing: extracted listing (today)', cache(h('extract', text, day)), `not cached for ${day}: run npm run demo:assets -- --ai today (or pin DEMO_DATE)`);
  if (id === 'rauf-cancel' && text) cover('rauf-cancel: cancellation intent', cache(h('intent', text, 'farmer has a confirmed order and may be cancelling it')), 'not cached: run npm run demo:assets -- --ai');
}
const photo = findAsset('tomatoes-stage4').usable;
if (photo) cover('tomatoes-stage4.jpg: photo inspection', cache(h('inspect', fs.readFileSync(photo))), 'not cached: run npm run demo:assets -- --ai');
else r.info('tomatoes-stage4.jpg', 'none: the placeholder and scripted inspection are used');
const elsenScript = scriptOf('elsen-listing');
if (elsenScript) cover('Scripted Elşən text: extraction (today)', cache(h('extract', elsenScript, day)), 'not cached (only used if a scripted voice note runs in LIVE/CACHED mode)');

const ok = r.summary();
console.log(dim('  Priority on stage: LIVE → CACHED (F once) → SIMULATED (F twice). L skips Act 1. The SIMULATED run above needed no keys.'));
r.save(path.join(DATA, 'fallback-report.json'));
process.exit(ok ? 0 : 1);
