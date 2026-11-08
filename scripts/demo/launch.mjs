#!/usr/bin/env node
// npm run demo:launch [-- --ai=live|cached|simulated] [-- --whatsapp=simulator|twilio] [-- --resume] [-- --restart] [-- --no-open]
// The presentation command: preflight, one production server on 127.0.0.1:3000, health check, readiness summary.
// Starts at Act 1 unless --resume (continue after a crash from the last saved state).
import fs from 'node:fs';
import path from 'node:path';
import { LOGS, PORT, ROOT, Report, args, base, bold, dim, ensureBuild, farmerPhones, findAsset, green, healthy, loadEnv, openUrl, portFree, portOwner, readPid, red, startServer, state, stopPid, tunnelInfo, yellow } from './lib.mjs';

const a = args();
const env = loadEnv();
const r = new Report('BƏRƏKƏT launch');
const ai = a.ai ?? env.AI_MODE ?? 'live';
const wa = a.whatsapp ?? env.WHATSAPP_CHANNEL ?? 'simulator';
if (!['live', 'cached', 'simulated'].includes(ai)) { console.error(red(`--ai must be live, cached or simulated (got ${ai})`)); process.exit(2); }
if (!['simulator', 'twilio'].includes(wa)) { console.error(red(`--whatsapp must be simulator or twilio (got ${wa})`)); process.exit(2); }

// ---------- Preflight ----------
r.section('Preflight');
if (!fs.existsSync(path.join(ROOT, 'node_modules', 'next'))) { r.fail('Dependencies', 'run npm run demo:setup first'); process.exit(r.summary() ? 0 : 1); }
if (!fs.existsSync(path.join(ROOT, '.env.local'))) r.warn('.env.local', 'missing: run npm run demo:setup (everything will be simulated)');
if (!env.DEMO_ADMIN_TOKEN) r.warn('DEMO_ADMIN_TOKEN', 'missing: run npm run demo:setup before exposing the app through a tunnel');

const textAi = env.ANTHROPIC_API_KEY ? `Anthropic ${env.ANTHROPIC_MODEL || 'claude-opus-5-5'}` : env.DEEPSEEK_API_KEY ? `DeepSeek ${env.DEEPSEEK_MODEL || 'deepseek-flash'}` : undefined;
if (ai === 'live') {
  textAi ? r.pass('Text + photo AI', textAi) : r.warn('Text + photo AI', 'no key: extraction and photo checks fall back to cache/script');
  env.ELEVENLABS_API_KEY ? r.pass('Speech-to-text', 'ElevenLabs scribe_v2 (aze)') : r.warn('Speech-to-text', 'no key: scripted transcripts');
} else r.info('AI', `${ai.toUpperCase()} mode: no AI network calls`);

for (const id of ['elsen-listing', 'rauf-cancel', 'tomatoes-stage4']) {
  const f = findAsset(id).usable;
  f ? r.pass(`Asset ${id}`, path.basename(f)) : r.warn(`Asset ${id}`, 'missing: the scripted fallback / SVG placeholder will be used');
}

if (wa === 'twilio') {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) r.fail('Twilio', 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing');
  const phones = farmerPhones(env).filter((p) => p.valid);
  phones.length ? r.pass('Farmer phones', phones.map((p) => p.id).join(', ')) : r.fail('Farmer phones', 'FARMER_PHONES has no real numbers');
  const t = tunnelInfo();
  t?.running ? r.pass('Tunnel', t.url) : r.warn('Tunnel', 'not running: start it with npm run demo:tunnel, then set the sandbox URL');
}

// ---------- Already running? ----------
const prev = readPid('server');
if (prev && (await healthy(PORT))) {
  if (!a.restart) {
    r.info('Server', `already running (pid ${prev.pid}) — not starting a second one. Use --restart to replace it.`);
    await summary();
    process.exit(0);
  }
  await stopPid('server');
  r.info('Server', 'previous server stopped (--restart)');
} else if (prev) await stopPid('server');
if (!(await portFree(PORT))) {
  r.fail('Port 3000', `in use by ${portOwner(PORT) ?? 'another process'}: stop it or run npm run demo:stop`);
  process.exit(r.summary() ? 0 : 1);
}

if (r.counts().fail) process.exit(r.summary() ? 0 : 1);

// ---------- Build and start ----------
r.section('Server');
try {
  const b = await ensureBuild();
  r.pass('Production build', b.built ? 'rebuilt' : 'up to date');
} catch (e) {
  r.fail('Production build', e.message);
  process.exit(r.summary() ? 0 : 1);
}
fs.mkdirSync(LOGS, { recursive: true });
const log = path.join(LOGS, 'server.log');
try {
  const s = await startServer({ port: PORT, detached: true, name: 'server', logFile: log, env: { AI_MODE: ai, WHATSAPP_CHANNEL: wa, DEMO_RESTORE: a.resume ? '1' : '0' } });
  r.pass('next start', `pid ${s.pid}, 127.0.0.1:${PORT}, log ${path.relative(ROOT, log)}`);
} catch (e) {
  r.fail('next start', e.message);
  process.exit(r.summary() ? 0 : 1);
}
const s0 = await state();
s0.settings.aiMode === ai ? r.pass('AI mode', ai.toUpperCase()) : r.fail('AI mode', `server reports ${s0.settings.aiMode}`);
s0.settings.channel === wa ? r.pass('WhatsApp channel', wa) : r.fail('WhatsApp channel', `server reports ${s0.settings.channel}`);
if (!a.resume) s0.presenter.act.n === 1 ? r.pass('Scenario', 'Act 1, freshly seeded') : r.warn('Scenario', `Act ${s0.presenter.act.n}`);
else r.info('Scenario', `resumed at Act ${s0.presenter.act.n}: ${s0.presenter.act.next}`);

await summary();
if (!a['no-open']) openUrl(`http://localhost:${PORT}/operator/intake`);
process.exit(r.summary() ? 0 : 1);

async function summary() {
  const s = await state();
  const p = s.presenter;
  const modeColor = p.aiMode === 'live' ? green : p.aiMode === 'cached' ? bold : yellow;
  console.log(`\n${bold('Ready')}  ${base(PORT).replace('127.0.0.1', 'localhost')}/operator/intake`);
  console.log(`  AI         ${modeColor(p.aiMode.toUpperCase())}  ${dim(p.text ? `${p.text.provider} ${p.text.model}` : 'no text AI key')} · ${dim(p.stt ? 'ElevenLabs scribe_v2' : 'no speech-to-text key')}`);
  console.log(`  WhatsApp   ${p.channel === 'twilio' ? green('TWILIO (real phones)') : 'SIMULATOR (docked phone)'}${p.channel === 'twilio' ? dim(` · ${p.twilio.farmersMapped} phones · webhook URL ${p.twilio.webhookUrlKnown ? 'known' : 'NOT SET'}`) : ''}`);
  console.log(`  Now        Act ${p.act.n <= 4 ? p.act.n : '—'}: ${p.act.next}`);
  console.log(`  Phones     ${dim('real phones on the same Wi-Fi: npm run demo:phone (QR codes, also at /connect)')}`);
  console.log(dim(`  Keys: ? presenter panel · F AI mode · V voice · R reset.  Stop: npm run demo:stop.  Logs: .data/logs/server.log`));
}
