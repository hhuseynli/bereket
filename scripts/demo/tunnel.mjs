#!/usr/bin/env node
// npm run demo:tunnel [-- start|stop|status] [-- --provider=ngrok|cloudflared]
// Opens a public HTTPS tunnel to the local app, detects its URL, records it in .data/tunnel.json (the app
// reads it to validate Twilio signatures and to request delivery receipts), checks the webhook end to end,
// and prints the one Twilio Console change that cannot be automated.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA, LOGS, PORT, Report, args, bold, copyToClipboard, dim, green, healthy, loadEnv, readPid, run, sleep, stopPid, tunnelInfo, waitFor, which, writePid, yellow } from './lib.mjs';

const a = args();
const cmd = a._[0] ?? 'start';
const TUNNEL_FILE = path.join(DATA, 'tunnel.json');

async function stop() {
  const stopped = await stopPid('tunnel');
  fs.rmSync(TUNNEL_FILE, { force: true });
  console.log(stopped ? 'Tunnel stopped.' : 'No tunnel was running.');
}

async function ngrokReady() {
  if (!which('ngrok')) return false;
  const r = await run('ngrok', ['config', 'check'], { quiet: true });
  return r.code === 0;
}

// cloudflared otherwise reads ~/.cloudflared/config.yml, and if that file belongs to a named tunnel (another
// project's domain) it would connect THAT tunnel and route its hostname here. An explicit empty config keeps
// this an anonymous quick tunnel; the guard below kills it before it connects if credentials still appear.
async function startCloudflared(port, log) {
  const empty = path.join(DATA, 'run', 'cloudflared-quick.yml');
  fs.mkdirSync(path.dirname(empty), { recursive: true });
  fs.writeFileSync(empty, '# Anonymous quick tunnel only: no tunnel name, no credentials.\nno-autoupdate: true\n');
  const fd = fs.openSync(log, 'w');
  const p = spawn(which('cloudflared'), ['tunnel', '--config', empty, '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { detached: true, stdio: ['ignore', fd, fd] });
  p.unref();
  const kill = () => { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ } };
  try {
    await waitFor(() => /Settings: map\[/.test(fs.readFileSync(log, 'utf8')), { timeout: 20_000, what: 'cloudflared settings' });
    const settings = fs.readFileSync(log, 'utf8').match(/Settings: map\[[^\n]*/)?.[0] ?? '';
    if (/cred-file|credentials-file|tunnel:[0-9a-f-]{36}/.test(settings)) {
      kill();
      throw new Error('cloudflared loaded named-tunnel credentials (from an existing cloudflared config); stopped before connecting');
    }
    const url = await waitFor(() => fs.readFileSync(log, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0], { timeout: 40_000, what: 'cloudflared URL' });
    await waitFor(() => /Registered tunnel connection/.test(fs.readFileSync(log, 'utf8')), { timeout: 40_000, what: 'cloudflared connection' });
    return { pid: p.pid, url };
  } catch (e) {
    kill();
    throw e;
  }
}

async function startNgrok(port, log, env) {
  const fd = fs.openSync(log, 'w');
  const extra = env.NGROK_DOMAIN ? [`--url=https://${env.NGROK_DOMAIN.replace(/^https?:\/\//, '')}`] : [];
  const p = spawn(which('ngrok'), ['http', `127.0.0.1:${port}`, '--log=stdout', ...extra], { detached: true, stdio: ['ignore', fd, fd] });
  p.unref();
  const url = await waitFor(async () => {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels').then((x) => x.json()).catch(() => undefined);
    return r?.tunnels?.find((t) => t.public_url?.startsWith('https://'))?.public_url;
  }, { timeout: 30_000, what: 'ngrok URL' });
  return { pid: p.pid, url };
}

async function checkPublic(r, url) {
  // The app must answer through the tunnel, refuse anonymous visitors, and reject unsigned webhooks.
  try {
    let st;
    for (let i = 0; i < 8; i++) {
      st = await fetch(`${url}/api/state`, { signal: AbortSignal.timeout(15_000) }).catch(() => undefined);
      if (st && st.status !== 530 && st.status !== 502 && st.status !== 404) break;
      await sleep(2500); // a brand-new quick tunnel takes a few seconds to route
    }
    if (!st) throw new Error('no response');
    if (st.status === 401) r.pass('Tunnel reaches the app', 'anonymous visitors get 401 (presenter token required)');
    else if (st.status === 200) r.warn('Tunnel reaches the app', 'but /api/state is public: set DEMO_ADMIN_TOKEN and restart (npm run demo:setup)');
    else r.fail('Tunnel reaches the app', `HTTP ${st.status}`);
    const wh = await fetch(`${url}/api/twilio`, { method: 'POST', body: 'MessageSid=SMtest&From=whatsapp%3A%2B10000000000', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
    if (wh.status === 403) r.pass('Webhook /api/twilio', 'reachable, rejects unsigned requests (signature validation on)');
    else r.warn('Webhook /api/twilio', `unsigned request returned ${wh.status}, expected 403`);
  } catch (e) {
    r.fail('Tunnel reaches the app', e.message);
  }
}

async function start() {
  const env = loadEnv();
  const r = new Report('Public HTTPS tunnel');
  const existing = tunnelInfo();
  let info;
  if (existing?.running) {
    r.pass('Tunnel', `already running (${existing.provider}) ${existing.url}`);
    info = existing;
  } else {
    if (existing) fs.rmSync(TUNNEL_FILE, { force: true });
    const want = a.provider ?? env.TUNNEL_PROVIDER;
    const provider = want ?? ((await ngrokReady()) ? 'ngrok' : which('cloudflared') ? 'cloudflared' : undefined);
    if (!provider) {
      r.fail('Tunnel provider', 'install one: brew install cloudflared   (or brew install ngrok && ngrok config add-authtoken <token>)');
      return r.summary();
    }
    fs.mkdirSync(LOGS, { recursive: true });
    const log = path.join(LOGS, `tunnel-${provider}.log`);
    try {
      const t = provider === 'ngrok' ? await startNgrok(PORT, log, env) : await startCloudflared(PORT, log);
      info = { provider, url: t.url, pid: t.pid, webhook: `${t.url}/api/twilio`, startedAt: new Date().toISOString(), log };
      writePid('tunnel', { pid: t.pid, log, startedAt: info.startedAt });
      fs.writeFileSync(TUNNEL_FILE, JSON.stringify(info, null, 2));
      r.pass('Tunnel started', `${provider}: ${t.url}`);
      if (provider === 'cloudflared') r.info('Note', 'quick-tunnel URLs change on every start: update the Twilio sandbox URL each time (an ngrok static domain avoids this: set NGROK_DOMAIN)');
    } catch (e) {
      r.fail('Tunnel start', `${e.message}. Log: ${path.relative(process.cwd(), log)}`);
      return r.summary();
    }
  }
  // Give DNS a moment for brand-new quick tunnels.
  if (await healthy()) {
    await sleep(info.provider === 'cloudflared' && !existing?.running ? 4000 : 0);
    await checkPublic(r, info.url);
  } else r.warn('App', 'not running on port 3000 yet: start it with npm run demo:launch (the tunnel keeps waiting)');

  const webhook = `${info.url}/api/twilio`;
  const copied = copyToClipboard(webhook);
  console.log(`\n${bold('One manual step in the Twilio Console')} ${dim("(Twilio's docs describe this setting in the Console only)")}`);
  console.log(`  1. Open https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn → ${bold('Sandbox settings')}`);
  console.log(`  2. ${bold('When a message comes in')}: ${green(webhook)}   Method: ${bold('POST')}${copied ? dim('   (copied to clipboard)') : ''}`);
  console.log('  3. Save.');
  if (env.DEMO_ADMIN_TOKEN) console.log(`\n${bold('Remote presenter link')} ${dim('(only if you need the UI from another device; keep it private)')}\n  ${info.url}/operator?key=<DEMO_ADMIN_TOKEN from .env.local>`);
  console.log(dim(`\n  Stop: npm run demo:tunnel -- stop`));
  if (env.WHATSAPP_CHANNEL !== 'twilio') console.log(yellow('\n  WhatsApp channel is "simulator". Press W in the app, or: npm run demo:mode -- --whatsapp=twilio'));
  return r.summary();
}

async function status() {
  const t = tunnelInfo();
  const pid = readPid('tunnel');
  if (!t || !t.running) {
    console.log('No tunnel running.' + (pid ? ' (stale pid file cleared)' : ''));
    if (pid) await stopPid('tunnel');
    return true;
  }
  const r = new Report('Tunnel status');
  r.pass('Tunnel', `${t.provider} ${t.url} (pid ${t.pid}, since ${t.startedAt})`);
  if (await healthy()) await checkPublic(r, t.url);
  return r.summary();
}

const ok = cmd === 'stop' ? (await stop(), true) : cmd === 'status' ? await status() : await start();
process.exit(ok ? 0 : 1);
