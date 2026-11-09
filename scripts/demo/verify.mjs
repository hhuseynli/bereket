#!/usr/bin/env node
// npm run demo:verify [-- --no-live] [-- --fresh] [-- --no-browser]
// Automated integration checks. Ends with a table that says, for every component, exactly how it was
// tested: LIVE (real provider call just now), CACHED (real provider result from an earlier verified call),
// LOCAL (automated test on this machine), SIMULATED, or NOT TESTED (needs a human or a phone).
// Paid calls: at most one tiny DeepSeek/Anthropic text call, one intent call, one image call and one ~8 s
// ElevenLabs transcription, each cached by input hash: later runs reuse the verified result (reported CACHED)
// unless --fresh. --no-live skips them.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apiFourActs } from './flow.mjs';
import { DATA, ROOT, Report, args, bold, cleanScratch, dim, ensureBuild, farmerPhones, getJson, loadEnv, run, scratchDataDir, startServer, state, tunnelInfo, waitFor, which } from './lib.mjs';
import { rehearse } from './rehearse.mjs';

const a = args();
const env = loadEnv();
const r = new Report('BƏRƏKƏT verification');
const tested = []; // [component, how, detail]
const T = (component, how, detail = '') => tested.push([component, how, detail]);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(DATA, 'verify', stamp);
fs.mkdirSync(outDir, { recursive: true });

// ---------- 1. Static checks and unit tests ----------
r.section('1. TypeScript, tests, build');
const tsc = await run('npx', ['tsc', '--noEmit'], { quiet: true });
tsc.code === 0 ? r.pass('TypeScript', 'no errors') : r.fail('TypeScript', tsc.out.split('\n').slice(0, 3).join(' '));
const unit = await run('npm', ['test'], { quiet: true });
const up = unit.out.match(/ℹ pass (\d+)/)?.[1];
unit.code === 0 ? r.pass('Existing tests (engine + demo flow)', `${up}/8 passed`) : r.fail('Existing tests', unit.out.split('\n').filter((l) => /✖/.test(l)).join(' '));
const ready = await run('npm', ['run', 'test:readiness'], { quiet: true });
const rp = ready.out.match(/ℹ pass (\d+)/)?.[1];
ready.code === 0 ? r.pass('Readiness tests (timeline, AI validation, webhook security)', `${rp} passed`) : r.fail('Readiness tests', ready.out.split('\n').filter((l) => /✖/.test(l)).join(' '));
T('Matching engine, cost optimisation, recovery', 'LOCAL', `${up}/8 existing tests`);
try {
  const b = await ensureBuild();
  r.pass('Production build', b.built ? 'rebuilt' : 'up to date');
} catch (e) {
  r.fail('Production build', e.message);
  r.summary();
  process.exit(1);
}

// ---------- 2. HTTP smoke tests on an isolated server ----------
r.section('2. HTTP API (isolated server on :3101, SIMULATED AI, simulator WhatsApp)');
cleanScratch();
const TOKEN = 'verify-twilio-token-0123456789';
const ADMIN = 'verify-admin-token-0123456789';
const PUBLIC = 'https://verify.example.test';
const port = 3101;
const srv = await startServer({
  port,
  logFile: path.join(outDir, 'server.log'),
  env: {
    DEMO_DATA_DIR: scratchDataDir('verify'), DEMO_RESTORE: '0', DEMO_DATA: '1', AI_MODE: 'simulated', WHATSAPP_CHANNEL: 'simulator',
    TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: TOKEN, PUBLIC_BASE_URL: PUBLIC, DEMO_ADMIN_TOKEN: ADMIN,
    FARMER_PHONES: 'f-elsen=+15550000001,f-sebine=+15550000003', DEMO_STEP_MS: '0', DEMO_RECOVERY_MS: '300',
  },
});
const B = `http://127.0.0.1:${port}`;
const sign = (url, params) => { const keys = [...new Set(params.keys())].sort(); let d = url; for (const k of keys) for (const v of params.getAll(k).sort()) d += k + v; return crypto.createHmac('sha1', TOKEN).update(d).digest('base64'); };
const twilioPost = async (p, pathName = '/api/twilio') => {
  const body = new URLSearchParams(p);
  return fetch(B + pathName, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sign(PUBLIC + pathName, body) }, body: body.toString() });
};
const remote = { 'x-forwarded-for': '203.0.113.9', host: 'verify.example.test', 'x-forwarded-proto': 'https' }; // as the tunnel / phone relay send it
try {
  const http = [];
  const exp = async (name, p, want) => { const res = await p; const ok = Array.isArray(want) ? want.includes(res.status) : res.status === want; http.push([name, ok, `HTTP ${res.status}`]); return res; };
  await exp('GET / redirects to the Buyer view', fetch(B + '/', { redirect: 'manual' }), [307, 308]);
  for (const p of ['/buyer', '/buyer/orders', '/operator', '/operator/intake', '/buyer/tenders/T-1042']) await exp(`GET ${p}`, fetch(B + p), 200);
  const st = await getJson(B + '/api/state');
  http.push(['GET /api/state has presenter readiness', st.status === 200 && st.body.presenter?.act?.n === 1, `Act ${st.body.presenter?.act?.n}`]);
  http.push(['Phone numbers are masked in /api/state', !JSON.stringify(st.body).includes('+15550000001') && JSON.stringify(st.body).includes('•••'), 'masked']);
  const sse = await fetch(B + '/api/events', { signal: AbortSignal.timeout(3000) });
  const reader = sse.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  reader.cancel();
  http.push(['GET /api/events streams versions (SSE)', /^data: \d+/.test(first), first.trim().slice(0, 20)]);
  await exp('Unknown action → 400', fetch(B + '/api/action', { method: 'POST', body: '{"action":"nope"}', headers: { 'content-type': 'application/json' } }), 400);
  const fd = new FormData(); fd.set('farmerId', 'f-nobody'); fd.set('text', 'x');
  await exp('Simulator: unknown farmer → 400', fetch(B + '/api/phone', { method: 'POST', body: fd }), 400);
  await exp('Media: bad id → 404', fetch(B + '/api/media/..%2F..%2Fetc%2Fpasswd'), [404, 400]);
  // Access control through a tunnel
  await exp('Tunnel visitor, no token: /api/state → 401', fetch(B + '/api/state', { headers: remote }), 401);
  await exp('Tunnel visitor, no token: /api/action → 401', fetch(B + '/api/action', { method: 'POST', headers: { ...remote, 'content-type': 'application/json' }, body: '{"action":"director","op":"reset"}' }), 401);
  await exp('Tunnel visitor, no token: /api/phone → 401', fetch(B + '/api/phone', { method: 'POST', headers: remote, body: fd }), 401);
  await exp('Tunnel visitor, no token: /operator → 401', fetch(B + '/operator', { headers: remote }), 401);
  await exp('Tunnel visitor, wrong key → 401', fetch(B + '/operator?key=wrong', { headers: remote, redirect: 'manual' }), 401);
  const login = await exp('Tunnel visitor, ?key=token → cookie + redirect', fetch(B + '/operator?key=' + ADMIN, { headers: remote, redirect: 'manual' }), 307);
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  http.push(['Login cookie is HttpOnly + Secure', /HttpOnly/i.test(login.headers.get('set-cookie') ?? '') && /Secure/i.test(login.headers.get('set-cookie') ?? ''), '']);
  await exp('Tunnel visitor with cookie: /api/state → 200', fetch(B + '/api/state', { headers: { ...remote, cookie } }), 200);
  // Twilio webhook
  await exp('Webhook: unsigned → 403', fetch(B + '/api/twilio', { method: 'POST', headers: remote, body: 'MessageSid=SMx&From=whatsapp%3A%2B15550000001' }), 403);
  await exp('Webhook: forged signature → 403', fetch(B + '/api/twilio', { method: 'POST', headers: { ...remote, 'x-twilio-signature': 'AAAA' }, body: 'MessageSid=SMx&From=whatsapp%3A%2B15550000001' }), 403);
  const farmersBefore = (await state(port)).farmers.length;
  await exp('Webhook: signed, unregistered number → 200 (ignored)', twilioPost({ MessageSid: 'SMstranger1', From: 'whatsapp:+15559999999', Body: 'hello', NumMedia: '0' }), 200);
  http.push(['Unregistered number is not auto-registered', (await state(port)).farmers.length === farmersBefore, '']);
  const hello = { MessageSid: 'SMverify1', From: 'whatsapp:+15550000003', Body: 'Salam, pomidorlarım hələ satılmayıb. Alıcı olsa, xəbər verin.', NumMedia: '0', ProfileName: 'Test' };
  await exp('Webhook: signed message from Səbinə → 200', twilioPost(hello), 200);
  await exp('Webhook: Twilio retry of the same MessageSid → 200', twilioPost(hello), 200);
  await waitFor(async () => (await state(port)).messages.some((m) => m.farmerId === 'f-sebine' && m.dir === 'in'), { what: 'webhook message processed' });
  await new Promise((res) => setTimeout(res, 500));
  const sMsgs = (await state(port)).messages.filter((m) => m.farmerId === 'f-sebine' && m.dir === 'in' && m.via === 'twilio');
  http.push(['Webhook message processed once (dedupe by MessageSid)', sMsgs.length === 1, `${sMsgs.length} inbound`]);
  const sReply = (await state(port)).messages.filter((m) => m.farmerId === 'f-sebine' && m.dir === 'out');
  http.push(['Webhook message gets a WhatsApp reply (queued locally: simulator channel)', sReply.length >= 1, sReply[0]?.text?.slice(0, 50) ?? '']);
  await exp('Webhook: media from a non-Twilio host is refused (no SSRF)', twilioPost({ MessageSid: 'SMverify2', From: 'whatsapp:+15550000001', NumMedia: '1', MediaUrl0: 'http://169.254.169.254/latest', MediaContentType0: 'image/jpeg' }), 200);
  await waitFor(async () => (await state(port)).events.some((e) => /Could not download image/.test(e.title)), { what: 'media refusal logged', timeout: 8000 });
  http.push(['Refused media is reported to the operator and the farmer asked to resend', true, '']);
  await exp('Voice clip URL reachable through a tunnel (Twilio fetches it), unknown id → 404 not 401', fetch(B + '/api/voice/' + 'a'.repeat(32) + '.mp3', { headers: remote }), 404);
  await exp('Voice clip URL rejects anything but a clip id → 401 through a tunnel', fetch(B + '/api/voice/../state', { headers: remote }), [401, 404]);
  await exp('Status callback: signed → 204', twilioPost({ MessageSid: 'SMnone', MessageStatus: 'delivered' }, '/api/twilio/status'), 204);
  for (const [n, ok, d] of http) r.add(ok ? 'PASS' : 'FAIL', n, d);
  T('HTTP API, access control, Twilio webhook security', http.every((x) => x[1]) ? 'LOCAL' : 'FAILED', `${http.filter((x) => x[1]).length}/${http.length} checks (signed requests built with a test token)`);

  // ---------- 3. Full demo through the API, simulated ----------
  r.section('3. Four acts through the API (SIMULATED mode)');
  const flow = await apiFourActs(port);
  for (const [n, ok, d] of flow) r.add(ok ? 'PASS' : 'FAIL', n, d);
  T('Four-act flow, simulation mode', flow.every((x) => x[1]) ? 'SIMULATED' : 'FAILED', 'scripted voice/photo, real engine, real state machine');

  // ---------- 4. Browser ----------
  r.section('4. Browser end to end (Chrome, both projector sizes)');
  if (a['no-browser']) { r.skip('Browser', '--no-browser'); T('Browser UI', 'NOT TESTED', '--no-browser'); }
  else {
    const results = [];
    for (const size of ['1920x1080', '1366x768']) results.push(await rehearse({ port, size, outDir, log: () => {} }));
    for (const res of results) {
      res.ok ? r.pass(`Four acts in Chrome at ${res.size}`, `${(res.totalMs / 1000).toFixed(0)} s, ${res.interactions} interactions`) : r.fail(`Four acts in Chrome at ${res.size}`, res.error);
      for (const i of res.issues) r.warn(res.size, i);
      res.fonts?.sans && res.fonts?.check ? r.pass(`Azerbaijani glyphs at ${res.size}`, 'bundled fonts loaded for Ə ə ğ ı ö ş ü ç ₼') : r.fail(`Azerbaijani glyphs at ${res.size}`, JSON.stringify(res.fonts));
      const ext = [...new Set(res.externalRequests)];
      ext.length ? r.warn('External requests', ext.join(', ')) : r.pass(`No external requests at ${res.size}`, 'fonts and assets are local');
      if (res.consoleErrors.length) r.warn('Console errors', [...new Set(res.consoleErrors)].slice(0, 2).join(' | '));
    }
    T('Browser UI: all acts, perspective switch, presenter keys, 1920×1080 + 1366×768', results.every((x) => x.ok) ? 'LOCAL' : 'FAILED', `screenshots in ${path.relative(ROOT, outDir)}`);
  }
} finally {
  await srv.stop();
}

// ---------- 5. Real AI ----------
r.section('5. Real AI providers (minimal calls, cached by input hash)');
const hasText = !!(env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY);
if (a['no-live']) {
  r.skip('Live AI', '--no-live');
  T('Speech-to-text (ElevenLabs)', 'NOT TESTED', '--no-live');
  T('Listing extraction / photo / intent', 'NOT TESTED', '--no-live');
} else if (!hasText && !env.ELEVENLABS_API_KEY) {
  r.skip('Live AI', 'no keys');
  T('AI providers', 'SIMULATED', 'no keys configured');
} else {
  // Synthetic inputs, clearly labelled: a rendered placeholder photo and a macOS text-to-speech clip.
  let img;
  let clip;
  try {
    const { chromium } = await import('playwright-core');
    const b = await chromium.launch({ channel: 'chrome' });
    const p = await b.newPage({ viewport: { width: 640, height: 480 } });
    await p.goto('file://' + path.join(ROOT, 'public/demo/tomatoes-stage4.svg'));
    img = path.join(outDir, 'smoke-tomatoes.png');
    await p.screenshot({ path: img });
    await b.close();
  } catch (e) { r.warn('Test image', e.message); }
  if (env.ELEVENLABS_API_KEY && which('say') && which('ffmpeg')) {
    try {
      const demoTs = fs.readFileSync(path.join(ROOT, 'src/lib/demo.ts'), 'utf8');
      const az = demoTs.match(/'elsen-listing': \{[\s\S]*?az: '([^']+)'/)[1];
      const aiff = path.join(DATA, 'smoke-voice.aiff');
      clip = path.join(DATA, 'smoke-voice.ogg');
      if (!fs.existsSync(clip)) {
        execFileSync('say', ['-v', 'Yelda', '-o', aiff, az]);
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', aiff, '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', clip]);
        fs.rmSync(aiff, { force: true });
      }
    } catch (e) { r.warn('Test voice clip', e.message); clip = undefined; }
  }
  const res = await run(path.join(ROOT, 'node_modules/.bin/tsx'), [path.join(ROOT, 'scripts/demo/ai-check.mts'), 'smoke', ...(a.fresh ? ['--fresh'] : [])], { quiet: true, env: { SMOKE_IMAGE: img ?? '', SMOKE_AUDIO: clip ?? '' } });
  const line = res.out.split('\n').reverse().find((l) => l.startsWith('{'));
  if (!line) r.fail('AI smoke test', res.out.split('\n').filter((l) => !/DEP0205|trace-deprecation/.test(l)).slice(-4).join(' '));
  else {
    const j = JSON.parse(line);
    for (const c of j.checks) {
      r.add(c.status, c.name, `${c.mode ? `[${c.mode.toUpperCase()}] ` : ''}${c.detail}`);
      if (c.data?.transcript) console.log(dim(`        “${c.data.transcript}”`));
      const how = c.status === 'SKIP' ? 'NOT TESTED' : c.status === 'FAIL' ? 'FAILED' : c.mode === 'live' ? 'LIVE' : c.mode === 'cached' ? 'CACHED' : 'SIMULATED';
      T(c.name, how, `${c.mode === 'cached' ? 'result from an earlier live call; ' : ''}${j.provider && /Listing|intent|Photo/.test(c.name) ? j.provider : /Speech/.test(c.name) ? 'elevenlabs/scribe_v2' : ''}`);
    }
  }
  const assetsRep = path.join(DATA, 'assets-ai-report.json');
  if (fs.existsSync(assetsRep)) {
    const j = JSON.parse(fs.readFileSync(assetsRep, 'utf8'));
    for (const c of j.checks.filter((x) => x.status !== 'SKIP')) T(`Real recording/photo: ${c.name}`, c.status === 'PASS' ? (c.mode === 'live' ? 'LIVE' : 'CACHED') : c.status, `demo:assets --ai at ${j.at.slice(0, 16)}`);
  } else T('Team recordings and photos with real AI', 'NOT TESTED', 'not provided yet (npm run demo:assets -- --ai once they are in public/demo)');
}

// ---------- 6. WhatsApp configuration ----------
r.section('6. WhatsApp (Twilio) configuration');
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  const lookup = () => getJson(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, { headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64') }, timeout: 20_000 }).catch((e) => ({ status: 0, body: `${e.message}${e.cause ? `: ${e.cause.message ?? e.cause}` : ''}` }));
  let acc = await lookup();
  if (acc.status === 0) acc = await lookup();
  // Optional: the demo's farmer side is the phone screen (/wa); Twilio is only needed for real WhatsApp.
  const needed = env.WHATSAPP_CHANNEL === 'twilio';
  acc.status === 200 ? r.pass('Twilio credentials', `verified (account ${acc.body.status}, ${acc.body.type})`) : r[needed ? 'fail' : 'warn']('Twilio credentials', `${acc.status ? `HTTP ${acc.status}` : `network error: ${acc.body}`}${needed ? '' : ' (optional: not used by the phone-screen demo)'}`);
  T('Twilio credentials', acc.status === 200 ? 'LIVE' : needed ? 'FAILED' : 'NOT TESTED', 'read-only account lookup, no message sent; optional');
} else { r.warn('Twilio credentials', 'not configured'); T('Twilio credentials', 'NOT TESTED', 'no keys'); }
const phones = farmerPhones(env).filter((p) => p.valid);
phones.length >= 3 ? r.pass('Twilio farmer phones', `${phones.length} mapped`) : r.info('Twilio farmer phones', `${phones.length} mapped (only for real WhatsApp; the phone screen needs none)`);
const t = tunnelInfo();
t?.running ? r.pass('Tunnel', t.url) : r.info('Tunnel', 'not running (npm run demo:tunnel)');
T('Phone screen (/wa) on a physical phone over Wi-Fi', 'NOT TESTED', 'needs your phone: npm run demo:phone, scan the QR');
T('Real WhatsApp via Twilio', 'NOT TESTED', 'sandbox unavailable from Azerbaijan; optional');

const ok = r.summary();
console.log(`\n${bold('What was actually tested')}`);
const w = Math.max(...tested.map((x) => x[0].length));
const col = { LIVE: '\x1b[32mLIVE\x1b[0m', CACHED: '\x1b[34mCACHED\x1b[0m', LOCAL: '\x1b[32mLOCAL\x1b[0m', SIMULATED: '\x1b[33mSIMULATED\x1b[0m', 'NOT TESTED': '\x1b[2mNOT TESTED\x1b[0m', FAILED: '\x1b[31mFAILED\x1b[0m', WARN: '\x1b[33mWARN\x1b[0m', FAIL: '\x1b[31mFAILED\x1b[0m' };
for (const [c, how, d] of tested) console.log(`  ${c.padEnd(w)}  ${(process.stdout.isTTY ? col[how] ?? how : how).padEnd(process.stdout.isTTY ? 20 : 10)}  ${dim(d)}`);
console.log(dim('\n  LIVE = real provider call during this run · CACHED = real provider result from an earlier call · LOCAL = automated test here'));
fs.writeFileSync(path.join(DATA, 'verify-report.json'), JSON.stringify({ at: new Date().toISOString(), ok, counts: r.counts(), rows: r.rows, tested }, null, 2));
console.log(dim(`  Report: .data/verify-report.json · artifacts: ${path.relative(ROOT, outDir)}/`));
process.exit(ok ? 0 : 1);
