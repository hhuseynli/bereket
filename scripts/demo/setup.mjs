#!/usr/bin/env node
// npm run demo:setup — safe to run any number of times. Never overwrites keys, recordings or photos.
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, DATA, ENV_FILE, LOGS, ROOT, RUN, Report, bold, dim, farmerPhones, findAsset, loadEnv, parseEnvFile, randomToken, run, secretState, setEnvValue, which } from './lib.mjs';

const r = new Report('BƏRƏKƏT demo setup');
const todo = [];

// 1. Toolchain
r.section('Toolchain');
const major = Number(process.versions.node.split('.')[0]);
if (major >= 18) r.pass('Node.js', `v${process.versions.node}`);
else r.fail('Node.js', `v${process.versions.node}: Next.js 14 needs Node 18 or newer`);
const npmV = (await run('npm', ['-v'], { quiet: true })).out.trim();
r.pass('npm', npmV);

// 2. Dependencies
r.section('Dependencies');
const lock = path.join(ROOT, 'package-lock.json');
const marker = path.join(ROOT, 'node_modules', '.package-lock.json');
const stale = !fs.existsSync(marker) || fs.statSync(lock).mtimeMs > fs.statSync(marker).mtimeMs + 1000;
if (stale) {
  console.log(dim('  Installing with npm ci…'));
  const res = await run('npm', ['ci', '--no-audit', '--no-fund'], { quiet: true });
  if (res.code === 0) r.pass('npm ci', 'dependencies installed from the lockfile');
  else {
    r.fail('npm ci', res.out.split('\n').slice(-5).join(' '));
  }
} else r.pass('node_modules', 'up to date with package-lock.json');

// 3. Folders
r.section('Folders');
for (const d of [DATA, RUN, LOGS, path.join(DATA, 'ai-cache'), path.join(DATA, 'media'), path.join(ROOT, 'public', 'demo')]) fs.mkdirSync(d, { recursive: true });
r.pass('.data/, .data/logs, .data/ai-cache, public/demo', 'present');
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const must of ['.env.local', '.data']) {
  if (!gi.split('\n').includes(must)) {
    fs.appendFileSync(path.join(ROOT, '.gitignore'), `\n${must}\n`);
    r.pass('.gitignore', `added ${must}`);
  }
}

// 4. .env.local
r.section('Configuration (.env.local)');
if (!fs.existsSync(ENV_FILE)) {
  fs.copyFileSync(path.join(ROOT, '.env.example'), ENV_FILE);
  fs.chmodSync(ENV_FILE, 0o600);
  r.pass('.env.local', 'created from .env.example');
} else {
  // Add keys introduced since the file was created, empty, without touching existing values.
  const have = parseEnvFile(ENV_FILE);
  const example = parseEnvFile(path.join(ROOT, '.env.example'));
  const added = Object.keys(example).filter((k) => !(k in have) && ['DEMO_ADMIN_TOKEN', 'DEEPSEEK_API_KEY', 'AI_MODE'].includes(k));
  for (const k of added) setEnvValue(k, example[k] ?? '');
  r.pass('.env.local', added.length ? `kept your values, added ${added.join(', ')}` : 'exists, values kept');
  try { fs.chmodSync(ENV_FILE, 0o600); } catch { /* not owner */ }
}
let env = loadEnv();
if (!env.DEMO_ADMIN_TOKEN || env.DEMO_ADMIN_TOKEN.length < 16) {
  setEnvValue('DEMO_ADMIN_TOKEN', randomToken());
  r.pass('DEMO_ADMIN_TOKEN', 'generated (protects the app when it is exposed through a tunnel)');
  env = loadEnv();
} else r.pass('DEMO_ADMIN_TOKEN', secretState(env.DEMO_ADMIN_TOKEN));

const text = env.ANTHROPIC_API_KEY ? 'Anthropic' : env.DEEPSEEK_API_KEY ? 'DeepSeek' : undefined;
if (text) r.pass('Text + photo AI key', `${text} ${secretState(env.ANTHROPIC_API_KEY || env.DEEPSEEK_API_KEY)} (presence only; run demo:doctor to verify)`);
else { r.warn('Text + photo AI key', 'missing: listing extraction and photo checks will be simulated'); todo.push('Add ANTHROPIC_API_KEY (or DEEPSEEK_API_KEY) to .env.local'); }
if (env.ELEVENLABS_API_KEY) r.pass('ElevenLabs key', secretState(env.ELEVENLABS_API_KEY));
else { r.warn('ElevenLabs key', 'missing: voice notes use scripted transcripts'); todo.push('Run: npx -y @elevenlabs/cli@latest onboard init'); }
if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) r.pass('Twilio keys', `SID ${secretState(env.TWILIO_ACCOUNT_SID)}, token ${secretState(env.TWILIO_AUTH_TOKEN)}`);
else { r.warn('Twilio keys', 'missing: WhatsApp stays in simulator mode'); todo.push('Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to .env.local'); }
const phones = farmerPhones(env);
const good = phones.filter((p) => p.valid);
if (good.length) r.pass('FARMER_PHONES', `${good.length} mapped: ${good.map((p) => p.id).join(', ')}`);
else {
  r.warn('FARMER_PHONES', 'no real phone numbers mapped');
  todo.push('Set FARMER_PHONES in .env.local, e.g. f-elsen=+99450…,f-rauf=+99455…,f-sebine=+99470… (each phone must first send "join <code>" to the sandbox)');
}

// 5. Tools
r.section('Optional tools');
const ffmpeg = which('ffmpeg');
ffmpeg ? r.pass('FFmpeg', 'audio checks and conversion available') : r.warn('FFmpeg', 'missing: brew install ffmpeg (for audio checks)');
const ngrok = which('ngrok');
const cloudflared = which('cloudflared');
if (ngrok) r.pass('ngrok', ngrok);
else if (cloudflared) r.pass('cloudflared', 'will be used for the public HTTPS tunnel (ngrok not installed)');
else { r.warn('Tunnel', 'neither ngrok nor cloudflared installed'); todo.push('Install a tunnel: brew install cloudflared (no account needed) or brew install ngrok'); }
const chrome = ['/Applications/Google Chrome.app', '/Applications/Chromium.app', '/Applications/Microsoft Edge.app'].find((p) => fs.existsSync(p));
chrome ? r.pass('Browser for automated rehearsal', path.basename(chrome, '.app')) : r.warn('Browser', 'Google Chrome not found: install it or run npx playwright install chromium');

// 6. Assets
r.section('Demo recordings and photos (public/demo)');
for (const [id, a] of Object.entries(ASSETS)) {
  const { found, usable } = findAsset(id);
  if (usable) r.pass(a.label, path.basename(usable));
  else if (found.length) r.warn(a.label, `${path.basename(found[0])} found: run npm run demo:assets -- --fix to convert it`);
  else if (a.required) { r.warn(a.label, `missing ${id}.${a.kind === 'audio' ? 'ogg' : 'jpg'}: the scripted fallback will be used`); }
  else r.info(a.label, 'optional, not provided');
}
if (!findAsset('elsen-listing').usable || !findAsset('rauf-cancel').usable || !findAsset('tomatoes-stage4').usable) {
  todo.push('Record the two voice notes and take the stage-4 photo (exact script: public/demo/README.md), then run npm run demo:assets');
}

const ok = r.summary();
console.log(`\n${bold('What only you can do')}`);
if (!todo.length) console.log('  Nothing. Next: npm run demo:doctor');
else todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
console.log(dim('\n  Then: npm run demo:doctor → npm run demo:verify → npm run demo:launch'));
process.exit(ok ? 0 : 1);
