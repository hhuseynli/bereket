#!/usr/bin/env node
// npm run demo:phone [-- start|stop|status] [-- --tunnel] [-- --ip]
// Lets real phones on the same Wi-Fi open the farmer's WhatsApp-style screen (/wa). Starts an HTTPS relay on
// port 3443 with a self-signed certificate for this laptop's IP (phones only allow the microphone over HTTPS),
// prints a QR code per farmer, and writes .data/phone.json for the /connect page. Nothing leaves the local network.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { DATA, LOGS, PORT, ROOT, Report, alive, args, bold, dim, green, healthy, loadEnv, portFree, readPid, run, sleep, stopPid, tunnelInfo, writePid, yellow } from './lib.mjs';

const a = args();
const cmd = a._[0] ?? 'start';
const HTTPS_PORT = Number(a.port ?? 3443);
const INFO = path.join(DATA, 'phone.json');
const CERT_DIR = path.join(DATA, 'run', 'lan');
export const FARMERS = [
  ['f-elsen', 'Elşən', 'sells tomatoes (Act 1, 2, 4)'],
  ['f-rauf', 'Rauf', 'cancels (Act 3)'],
  ['f-sebine', 'Səbinə', 'backup farmer (Act 3)'],
  ['f-gulnare', 'Gülnarə', 'third farmer (Act 2)'],
];

export function lanIp() {
  const nets = os.networkInterfaces();
  const order = ['en0', 'en1', ...Object.keys(nets)];
  for (const name of order) {
    for (const n of nets[name] ?? []) if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) return n.address;
  }
  return undefined;
}

/** This Mac's Bonjour name (e.g. huseyns-macbook.local): iPhones on the same network find it even when the IP changes. */
export function localName() {
  try {
    const n = execFileSync('scutil', ['--get', 'LocalHostName'], { encoding: 'utf8' }).trim();
    return n ? `${n}.local` : undefined;
  } catch {
    return undefined;
  }
}

function ensureCert(ip, name) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const cert = path.join(CERT_DIR, 'cert.pem');
  const key = path.join(CERT_DIR, 'key.pem');
  const ipFile = path.join(CERT_DIR, 'ip.txt');
  const tag = `${ip}|${name ?? ''}`;
  if (fs.existsSync(cert) && fs.existsSync(key) && fs.existsSync(ipFile) && fs.readFileSync(ipFile, 'utf8').trim() === tag) return { cert, key, fresh: false };
  const san = [`IP:${ip}`, 'DNS:localhost', ...(name ? [`DNS:${name}`] : [])].join(',');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '30', '-subj', '/CN=BEREKET demo', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  fs.writeFileSync(ipFile, tag);
  fs.chmodSync(key, 0o600);
  return { cert, key, fresh: true };
}

async function stop() {
  const s = await stopPid('phone');
  fs.rmSync(INFO, { force: true });
  console.log(s ? 'Phone access stopped.' : 'Phone access was not running.');
}

/**
 * Through the public tunnel instead of the local network: for Wi-Fi that isolates devices (hotels, venues) or a
 * phone on mobile data. Real HTTPS (no warning, microphone works); the presenter token in the link still applies.
 */
async function startViaTunnel(env) {
  const r = new Report('Phones through the internet (tunnel)');
  let t = tunnelInfo();
  if (!t?.running) {
    const res = await run(process.execPath, [path.join(ROOT, 'scripts/demo/tunnel.mjs')], { quiet: true });
    t = tunnelInfo();
    if (!t?.running) { r.fail('Tunnel', res.out.split('\n').filter((l) => /FAIL|error/i.test(l)).join(' ') || 'did not start'); return r.summary(); }
  }
  r.pass('Tunnel', t.url);
  const info = { mode: 'tunnel', host: new URL(t.url).host, base: t.url, startedAt: new Date().toISOString() };
  fs.writeFileSync(INFO, JSON.stringify(info, null, 2));
  try {
    const out = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '15', `${t.url}/api/state`], { encoding: 'utf8' });
    out === '401' ? r.pass('Tunnel check', 'reaches the app and requires the token') : r.warn('Tunnel check', `HTTP ${out} (a new tunnel can take a few seconds)`);
  } catch { r.warn('Tunnel check', 'no answer yet'); }
  console.log(`\n${bold('On each phone')} ${dim('(any network: hotel Wi-Fi, mobile data)')}: scan the code. No certificate warning.\n`);
  for (const [id, name, role] of FARMERS.slice(0, a.all ? 4 : 3)) {
    console.log(`${bold(name)} ${dim(`— ${role}`)}`);
    console.log(await QRCode.toString(`${t.url}/wa/${id}?key=${env.DEMO_ADMIN_TOKEN}`, { type: 'terminal', small: true }));
  }
  console.log(`${green('Also on the laptop:')} http://localhost:${PORT}/connect`);
  console.log(dim('  Stop: npm run demo:phone -- stop (the tunnel: npm run demo:tunnel -- stop)'));
  return r.summary();
}

async function start() {
  const env = loadEnv();
  if (a.tunnel) return startViaTunnel(env);
  const r = new Report('Phones on the local network');
  if (!(await healthy(PORT))) r.warn('App', 'not running yet: start it with npm run demo:launch (phones will wait)');
  if (!env.DEMO_ADMIN_TOKEN) { r.fail('Presenter token', 'missing: run npm run demo:setup'); return r.summary(); }
  const ip = (typeof a.ip === 'string' ? a.ip : undefined) ?? lanIp();
  // Links use the Mac's .local name unless --ip is given: they keep working when the Wi-Fi hands out a new address.
  const name = a.ip ? undefined : localName();
  const host = name ?? ip;
  if (!ip) { r.fail('Wi-Fi', 'no local network address found: connect the laptop to Wi-Fi (or the phone hotspot)'); return r.summary(); }
  const prev = readPid('phone');
  let info = fs.existsSync(INFO) ? JSON.parse(fs.readFileSync(INFO, 'utf8')) : undefined;
  if (prev && alive(prev.pid) && info?.ip === ip && info?.host === host) r.pass('HTTPS relay', `already running on ${info.base}`);
  else {
    if (prev) await stopPid('phone');
    if (!(await portFree(HTTPS_PORT, '0.0.0.0'))) { r.fail(`Port ${HTTPS_PORT}`, 'in use'); return r.summary(); }
    const { cert, key, fresh } = ensureCert(ip, name);
    r.pass('Certificate', `${fresh ? 'created' : 'reused'} for ${name ? `${name} and ` : ''}${ip} (self-signed: phones show a one-time warning)`);
    fs.mkdirSync(LOGS, { recursive: true });
    const fd = fs.openSync(path.join(LOGS, 'phone-proxy.log'), 'a');
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts/demo/lan-proxy.mjs'), cert, key, String(HTTPS_PORT), String(PORT)], { detached: true, stdio: ['ignore', fd, fd] });
    p.unref();
    await sleep(600);
    if (!alive(p.pid)) { r.fail('HTTPS relay', 'did not start: see .data/logs/phone-proxy.log'); return r.summary(); }
    writePid('phone', { pid: p.pid, startedAt: new Date().toISOString() });
    info = { ip, host, port: HTTPS_PORT, base: `https://${host}:${HTTPS_PORT}`, fallback: `https://${ip}:${HTTPS_PORT}`, pid: p.pid, startedAt: new Date().toISOString() };
    fs.writeFileSync(INFO, JSON.stringify(info, null, 2));
    r.pass('HTTPS relay', `${info.base} → the app (local network only)${name ? `; if a phone cannot find ${name}, use ${info.fallback}` : ''}`);
  }
  // Check the relay end to end, as a phone would (anonymous → 401).
  try {
    const out = execFileSync('curl', ['-sk', '-o', '/dev/null', '-w', '%{http_code}', `${info.base}/api/state`], { encoding: 'utf8', timeout: 8000 });
    out === '401' ? r.pass('Relay check', 'reaches the app and requires the token') : out === '502' ? r.warn('Relay check', 'relay up, app not running') : r.warn('Relay check', `HTTP ${out}`);
  } catch { r.warn('Relay check', 'no answer'); }

  console.log(`\n${bold('On each phone')} ${dim('(same Wi-Fi as this laptop; venue Wi-Fi blocking devices? use the phone hotspot)')}`);
  console.log('  1. Scan the code with the camera and open the link.');
  console.log(`  2. "Not private" warning: ${bold('Advanced → Proceed')} (Android) or ${bold('Show Details → visit this website')} (iPhone). Once.`);
  console.log('  3. Add to Home Screen for a full-screen app look (optional).\n');
  for (const [id, name, role] of FARMERS.slice(0, a.all ? 4 : 3)) {
    const url = `${info.base}/wa/${id}?key=${env.DEMO_ADMIN_TOKEN}`;
    console.log(`${bold(name)} ${dim(`— ${role}`)}`);
    console.log(await QRCode.toString(url, { type: 'terminal', small: true }));
  }
  console.log(`${green('Also on the laptop:')} http://localhost:${PORT}/connect ${dim('(same codes, bigger)')}`);
  console.log(dim(`  Stop: npm run demo:phone -- stop`));
  if (env.WHATSAPP_CHANNEL === 'twilio') console.log(yellow('  Note: WhatsApp channel is Twilio; phones on /wa work in simulator mode (W).'));
  return r.summary();
}

async function status() {
  const p = readPid('phone');
  const info = fs.existsSync(INFO) ? JSON.parse(fs.readFileSync(INFO, 'utf8')) : undefined;
  if (info?.mode === 'tunnel') { const t = tunnelInfo(); console.log(t?.running ? `Phone access through the tunnel: ${info.base}` : 'Tunnel for phones is not running (npm run demo:phone -- --tunnel).'); return true; }
  if (p && alive(p.pid) && info) console.log(`Phone access running: ${info.base} (pid ${p.pid}). Current Wi-Fi address: ${lanIp() ?? 'none'}${lanIp() !== info.ip ? (info.host?.endsWith('.local') ? ' (changed; the .local link still works)' : ' — CHANGED, run npm run demo:phone again') : ''}`);
  else console.log('Phone access not running (npm run demo:phone).');
  return true;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const ok = cmd === 'stop' ? (await stop(), true) : cmd === 'status' ? await status() : await start();
  process.exit(ok ? 0 : 1);
}
