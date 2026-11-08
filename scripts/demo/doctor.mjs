#!/usr/bin/env node
// npm run demo:doctor [-- --offline]
// A readable diagnostic. Online checks use only free, read-only endpoints (account/model listings): nothing
// is transcribed, generated or sent. "present" means a key is configured; "verified" means the provider
// accepted it just now. Secrets and phone numbers are never printed.
import fs from 'node:fs';
import path from 'node:path';
import { checkAssets } from './assets.mjs';
import { DATA, PORT, ROOT, Report, args, buildState, dim, farmerPhones, healthy, loadEnv, maskPhone, portFree, portOwner, readPid, run, secretState, state, tunnelInfo, which } from './lib.mjs';

const a = args();
const env = loadEnv();
const online = !a.offline;
const r = new Report('BƏRƏKƏT demo doctor');

async function get(url, headers = {}) {
  const first = await get1(url, headers);
  return first.status === 0 ? get1(url, headers) : first; // one retry on a network blip
}
async function get1(url, headers) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  } catch (e) {
    return { status: 0, error: `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}` };
  }
}

// ---------- AI providers ----------
r.section('AI providers');
const provider = env.AI_PROVIDER === 'deepseek' ? 'deepseek' : env.ANTHROPIC_API_KEY ? 'anthropic' : env.DEEPSEEK_API_KEY ? 'deepseek' : undefined;
if (env.ANTHROPIC_API_KEY) {
  const model = env.ANTHROPIC_MODEL || 'claude-opus-5-5';
  if (!online) r.info('Anthropic', `key ${secretState(env.ANTHROPIC_API_KEY)}, model ${model} (not verified: --offline)`);
  else {
    const res = await get(`https://api.anthropic.com/v1/models/${model}`, { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' });
    if (res.status === 200) r.pass('Anthropic', `verified: key accepted, model ${model} available`);
    else if (res.status === 401) r.fail('Anthropic', 'key rejected (401)');
    else if (res.status === 404) r.fail('Anthropic', `model ${model} not available to this key: set ANTHROPIC_MODEL`);
    else r.warn('Anthropic', `could not verify (${res.status || res.error})`);
  }
} else r.info('Anthropic', 'no key (optional: DeepSeek is used instead when its key is set)');

if (env.DEEPSEEK_API_KEY) {
  const model = env.DEEPSEEK_MODEL || 'deepseek-flash';
  if (!online) r.info('DeepSeek', `key ${secretState(env.DEEPSEEK_API_KEY)}, model ${model} (not verified)`);
  else {
    const res = await get('https://api.deepseek.com/models', { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` });
    if (res.status === 200) {
      const m = res.body.data?.find((x) => x.id === model);
      if (!m) r.fail('DeepSeek', `key verified, but model ${model} is not listed (${res.body.data?.map((x) => x.id).join(', ')})`);
      else r.pass('DeepSeek', `verified: key accepted, ${model} available, image input ${m.input_modalities?.includes('image') ? 'yes' : 'NO'}`);
      const bal = await get('https://api.deepseek.com/user/balance', { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` });
      const b = bal.body?.balance_infos?.[0];
      if (b) Number(b.total_balance) > 0.2 ? r.pass('DeepSeek balance', `${b.total_balance} ${b.currency}`) : r.warn('DeepSeek balance', `${b.total_balance} ${b.currency}: top up before the demo`);
    } else if (res.status === 401) r.fail('DeepSeek', 'key rejected (401)');
    else r.warn('DeepSeek', `could not verify (${res.status || res.error})`);
  }
}
if (!provider) r.warn('Text + photo AI', 'no key: listing extraction, photo checks and intent run SIMULATED');
else r.info('Text + photo AI in use', provider === 'anthropic' ? `Anthropic ${env.ANTHROPIC_MODEL || 'claude-opus-5-5'}` : `DeepSeek ${env.DEEPSEEK_MODEL || 'deepseek-flash'} (Anthropic-compatible API)`);

if (env.ELEVENLABS_API_KEY) {
  if (!online) r.info('ElevenLabs', `key ${secretState(env.ELEVENLABS_API_KEY)} (not verified)`);
  else {
    const res = await get('https://api.elevenlabs.io/v1/user/subscription', { 'xi-api-key': env.ELEVENLABS_API_KEY });
    if (res.status === 200) {
      r.pass('ElevenLabs', `verified: key accepted, plan ${res.body.tier} (${res.body.status}); transcription itself is tested by demo:verify / demo:assets --ai`);
      const left = res.body.character_limit - res.body.character_count;
      const reset = res.body.next_character_count_reset_unix ? new Date(res.body.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : '?';
      left > 3000 ? r.pass('ElevenLabs voice credits', `${left.toLocaleString()} of ${res.body.character_limit.toLocaleString()} characters left (resets ${reset}); one demo run ≈ 1,000`) : r.warn('ElevenLabs voice credits', `only ${left} characters left: voice replies will stop; cached clips still play`);
    }
    else if (res.status === 401) r.fail('ElevenLabs', 'key rejected (401): run npx -y @elevenlabs/cli@latest onboard init');
    else r.warn('ElevenLabs', `could not verify (${res.status || res.error})`);
  }
} else r.warn('ElevenLabs', 'no key: voice notes use scripted transcripts (SIMULATED)');
r.info('AI mode at launch', (env.AI_MODE || 'live').toUpperCase());
r.info('Voice replies at launch', env.ELEVENLABS_API_KEY && env.TTS_REPLIES !== '0' ? `on (${env.TTS_MODEL || 'eleven_v4_turbo'}, native Azerbaijani voice)` : 'off');
const clips = fs.existsSync(path.join(DATA, 'tts')) ? fs.readdirSync(path.join(DATA, 'tts')).length : 0;
r.info('Cached voice notes', `${clips} clip(s) in .data/tts (replayed for free, also in CACHED mode)`);

// ---------- Twilio ----------
r.section('WhatsApp (Twilio sandbox)');
const sid = env.TWILIO_ACCOUNT_SID;
if (sid && env.TWILIO_AUTH_TOKEN) {
  if (!/^AC[0-9a-f]{32}$/.test(sid)) r.fail('Twilio Account SID', 'does not look like AC + 32 hex characters');
  if (!online) r.info('Twilio', 'credentials present (not verified)');
  else {
    const auth = { Authorization: 'Basic ' + Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString('base64') };
    const acc = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, auth);
    if (acc.status === 200) {
      r.pass('Twilio credentials', `verified: account ${acc.body.status}, ${acc.body.type}`);
      if (acc.body.type === 'Trial') r.info('Trial account', 'can only message phones that joined the sandbox');
      const since = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
      const msgs = await get(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?PageSize=100&DateSent%3E=${since}`, auth);
      if (msgs.status === 200) {
        const list = msgs.body.messages ?? [];
        const failed = list.filter((m) => ['failed', 'undelivered'].includes(m.status));
        r.info('Messages in the last ~24 h', `${list.length} (${list.filter((m) => m.direction === 'inbound').length} in, ${failed.length} failed${failed.length ? `: errors ${Array.from(new Set(failed.map((m) => m.error_code))).join(', ')}` : ''})`);
      }
    } else if (acc.status === 401) r.fail('Twilio credentials', 'rejected (401): check SID and auth token');
    else r.warn('Twilio credentials', `could not verify (${acc.status || acc.error})`);
  }
  /^whatsapp:\+\d{8,15}$/.test(env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886') ? r.pass('Sandbox sender', env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886') : r.fail('Sandbox sender', 'TWILIO_WHATSAPP_FROM must look like whatsapp:+14155238886');
} else r.warn('Twilio', 'not configured: WhatsApp runs in the simulator only');
const phones = farmerPhones(env);
const valid = phones.filter((p) => p.valid);
for (const need of ['f-elsen', 'f-rauf', 'f-sebine']) {
  const p = phones.find((x) => x.id === need);
  if (p?.valid) r.pass(`Farmer phone ${need}`, maskPhone(p.phone));
  else if (p) r.fail(`Farmer phone ${need}`, 'not a valid E.164 number (e.g. +994501234567)');
  else r.warn(`Farmer phone ${need}`, 'not mapped in FARMER_PHONES (needed for the real-WhatsApp version of this act)');
}
const dupes = valid.filter((p, i) => valid.findIndex((q) => q.phone === p.phone) !== i);
if (dupes.length) r.warn('FARMER_PHONES', `the same number is mapped twice (${dupes.map((d) => d.id).join(', ')}): only the first farmer receives messages`);
r.info('WhatsApp channel at launch', env.WHATSAPP_CHANNEL === 'twilio' ? 'TWILIO' : 'SIMULATOR');

// ---------- Tunnel ----------
r.section('Public webhook');
const ngrok = which('ngrok');
const cf = which('cloudflared');
if (ngrok) {
  const chk = await run('ngrok', ['config', 'check'], { quiet: true });
  chk.code === 0 ? r.pass('ngrok', 'installed and configured') : r.warn('ngrok', 'installed, not configured: ngrok config add-authtoken <token>');
} else r.info('ngrok', 'not installed');
cf ? r.pass('cloudflared', 'installed (quick tunnels, no account needed)') : r.info('cloudflared', 'not installed');
if (!ngrok && !cf) r.warn('Tunnel', 'install one: brew install cloudflared');
const t = tunnelInfo();
if (t?.running) {
  r.pass('Tunnel', `${t.provider} ${t.url}`);
  if (online) {
    const st = await get(`${t.url}/api/state`);
    st.status === 401 ? r.pass('Public URL', 'reaches the app and requires the presenter token') : st.status === 200 ? r.warn('Public URL', 'reaches the app but is NOT protected (DEMO_ADMIN_TOKEN)') : r.fail('Public URL', `HTTP ${st.status || st.error}`);
  }
  r.info('Twilio sandbox URL to set', `${t.url}/api/twilio (POST)`);
} else r.info('Tunnel', 'not running (only needed for real WhatsApp): npm run demo:tunnel');
env.DEMO_ADMIN_TOKEN?.length >= 16 ? r.pass('Presenter token', secretState(env.DEMO_ADMIN_TOKEN)) : r.fail('Presenter token', 'DEMO_ADMIN_TOKEN missing: run npm run demo:setup');
env.TWILIO_VALIDATE_SIGNATURE === '0' ? r.fail('Webhook signatures', 'TWILIO_VALIDATE_SIGNATURE=0: anyone could post fake messages') : r.pass('Webhook signatures', 'validated');

// ---------- Assets ----------
r.section('Recordings and photos');
if (!which('ffmpeg')) r.warn('FFmpeg', 'not installed: audio formats cannot be checked');
await checkAssets(r, {});
const aiRep = path.join(DATA, 'assets-ai-report.json');
if (fs.existsSync(aiRep)) {
  const j = JSON.parse(fs.readFileSync(aiRep, 'utf8'));
  const bad = j.checks.filter((c) => c.status === 'FAIL' || c.status === 'WARN');
  r.info('Last AI check of the assets', `${j.at.slice(0, 16)}: ${j.checks.length - bad.length}/${j.checks.length} OK${bad.length ? ` (${bad.map((c) => c.name).join('; ')})` : ''}`);
} else r.info('AI check of the assets', 'not run yet: npm run demo:assets -- --ai');

// ---------- App ----------
r.section('Application');
const fontPkgs = ['source-sans-3', 'source-serif-4'].every((f) => fs.existsSync(path.join(ROOT, 'node_modules', '@fontsource', f)));
fontPkgs ? r.pass('Fonts', 'Source Sans 3 / Source Serif 4 bundled locally (OFL), latin-ext covers Ə ə ğ ı ö ş ü ₼') : r.fail('Fonts', 'run npm ci');
const layout = fs.readFileSync(path.join(ROOT, 'src/app/layout.tsx'), 'utf8');
/fonts\.googleapis/.test(layout) ? r.warn('Google Fonts', 'still referenced: needs internet') : r.pass('Google Fonts', 'not needed');
const b = buildState();
b.ok ? r.pass('Production build', `up to date (${b.at.slice(0, 16)})`) : r.warn('Production build', `${b.why}: demo:launch rebuilds automatically`);
const tests = await run('npm', ['test'], { quiet: true });
const pass = tests.out.match(/ℹ pass (\d+)/)?.[1];
const fail = tests.out.match(/ℹ fail (\d+)/)?.[1];
tests.code === 0 ? r.pass('Matching engine + demo flow tests', `${pass} passed (1.33 / 1.23 / 1.38 ₼/kg, recovery 1.35, 80 kg gap)`) : r.fail('Matching engine + demo flow tests', `${fail} failed: run npm test`);
const chrome = ['/Applications/Google Chrome.app', '/Applications/Chromium.app'].find((p) => fs.existsSync(p));
chrome ? r.pass('Browser', `${path.basename(chrome, '.app')} (used for automated rehearsal)`) : r.warn('Browser', 'Chrome not found');

const srv = readPid('server');
if (await healthy(PORT)) {
  const s = await state(PORT);
  r.pass('Port 3000', `BƏRƏKƏT running${srv ? ` (pid ${srv.pid})` : ''}: AI ${s.settings.aiMode.toUpperCase()}, WhatsApp ${s.settings.channel}, Act ${s.presenter.act.n}`);
  const failed = Object.entries(s.presenter.health).filter(([, h]) => !h.ok);
  for (const [k, h] of failed) r.warn(`Last ${k} call`, h.detail);
} else if (await portFree(PORT)) r.pass('Port 3000', 'free');
else r.fail('Port 3000', `in use by ${portOwner(PORT) ?? 'another process'}`);

// ---------- Fallback and timeline ----------
r.section('Fallback and timeline');
const scripted = fs.readFileSync(path.join(ROOT, 'src/lib/demo.ts'), 'utf8');
['elsen-listing', 'rauf-cancel', 'sebine-hello'].every((k) => scripted.includes(`'${k}'`)) ? r.pass('Scripted fallback', 'voice scripts and placeholder photos present (SIMULATED mode always works)') : r.fail('Scripted fallback', 'demo scripts missing');
const cacheDir = path.join(DATA, 'ai-cache');
const cached = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json')).length : 0;
cached ? r.pass('Cached AI results', `${cached} verified results stored (CACHED mode)`) : r.warn('Cached AI results', 'none yet: run npm run demo:assets -- --ai or a live rehearsal');
const day = /^\d{4}-\d{2}-\d{2}$/.test(env.DEMO_DATE ?? '') ? env.DEMO_DATE : new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const [y, m, d] = day.split('-').map(Number);
const start = new Date(Date.UTC(y, m - 1, d, 10));
const due = new Date(Date.UTC(y, m - 1, d + 1, 5));
const fmt = (x) => x.toLocaleString('en-GB', { timeZone: 'Asia/Baku', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
(due - start) / 3600_000 === 19 ? r.pass('Demo timeline', `${env.DEMO_DATE ? 'pinned' : 'today'}: starts ${fmt(start)}, delivery ${fmt(due)} (Baku)`) : r.fail('Demo timeline', 'inconsistent');
const last = path.join(DATA, 'last-rehearsal.json');
if (fs.existsSync(last)) {
  const j = JSON.parse(fs.readFileSync(last, 'utf8'));
  r[j.ok ? 'pass' : 'warn']('Last rehearsal', `${j.at.slice(0, 16)} ${j.ok ? 'passed' : 'FAILED'} (${j.results.map((x) => `${x.size} ${(x.totalMs / 1000).toFixed(0)} s`).join(', ')})`);
} else r.info('Last rehearsal', 'none: npm run demo:rehearse');

const ok = r.summary();
r.save(path.join(DATA, 'doctor-report.json'));
console.log(dim('  Report saved to .data/doctor-report.json'));
process.exit(ok ? 0 : 1);
