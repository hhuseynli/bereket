// Shared helpers for the demo CLI: environment, reporting, the server process, the tunnel, and the app's API.
// Secrets are read from .env.local but never printed: only "set" / "missing" and lengths.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA = path.join(ROOT, '.data');
export const RUN = path.join(DATA, 'run');
export const LOGS = path.join(DATA, 'logs');
export const ENV_FILE = path.join(ROOT, '.env.local');
export const PORT = 3000;

// ---------- Output ----------

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const bold = c('1');
export const dim = c('2');
export const red = c('31');
export const green = c('32');
export const yellow = c('33');
export const blue = c('34');

const BADGE = { PASS: green('PASS'), WARN: yellow('WARN'), FAIL: red('FAIL'), INFO: blue('INFO'), SKIP: dim('SKIP') };

export class Report {
  constructor(title) {
    this.title = title;
    this.rows = [];
    if (title) console.log(`\n${bold(title)}`);
  }
  section(name) {
    console.log(`\n${bold(name)}`);
  }
  add(status, name, detail = '') {
    this.rows.push({ status, name, detail });
    console.log(`  ${BADGE[status] ?? status}  ${name}${detail ? dim(`  ${detail}`) : ''}`);
  }
  pass(n, d) { this.add('PASS', n, d); }
  warn(n, d) { this.add('WARN', n, d); }
  fail(n, d) { this.add('FAIL', n, d); }
  info(n, d) { this.add('INFO', n, d); }
  skip(n, d) { this.add('SKIP', n, d); }
  counts() {
    const n = (s) => this.rows.filter((r) => r.status === s).length;
    return { pass: n('PASS'), warn: n('WARN'), fail: n('FAIL') };
  }
  summary() {
    const { pass, warn, fail } = this.counts();
    console.log(`\n${bold('Summary')}  ${green(`${pass} pass`)} · ${yellow(`${warn} warn`)} · ${red(`${fail} fail`)}`);
    return fail === 0;
  }
  save(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ title: this.title, at: new Date().toISOString(), rows: this.rows, counts: this.counts() }, null, 2));
  }
}

export const args = (argv = process.argv.slice(2)) => {
  const out = { _: [] };
  for (const a of argv) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
    else out._.push(a);
  }
  return out;
};

// ---------- Environment ----------

export function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}

/** .env.local values, overridden by the real environment (as Next.js does). */
export function loadEnv() {
  return { ...parseEnvFile(path.join(ROOT, '.env')), ...parseEnvFile(ENV_FILE), ...process.env };
}

/** Set or add KEY=value in .env.local without touching other lines. */
export function setEnvValue(key, value) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8').split('\n') : [];
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, lines.join('\n').replace(/\n*$/, '\n'), { mode: 0o600 });
}

export const secretState = (v) => (v ? `set (${v.length} chars)` : 'missing');
export const maskPhone = (p) => (p ? `${p.slice(0, 6)}•••${p.slice(-2)}` : '');

export function farmerPhones(env) {
  const out = [];
  for (const pair of (env.FARMER_PHONES ?? '').split(',')) {
    const [id, phone] = pair.split('=').map((x) => x?.trim());
    if (id && phone) out.push({ id, phone, valid: /^\+\d{8,15}$/.test(phone) && !/X/.test(phone) });
  }
  return out;
}

export const randomToken = () => crypto.randomBytes(24).toString('base64url');

// ---------- Processes ----------

export function which(cmd) {
  try {
    return execFileSync('/usr/bin/which', [cmd], { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function run(cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { cwd: ROOT, stdio: opts.quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit', env: { ...process.env, ...(opts.env ?? {}) } });
    let out = '';
    p.stdout?.on('data', (d) => (out += d));
    p.stderr?.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function alive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readPid(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(RUN, `${name}.json`), 'utf8'));
  } catch {
    return undefined;
  }
}
export function writePid(name, info) {
  fs.mkdirSync(RUN, { recursive: true });
  fs.writeFileSync(path.join(RUN, `${name}.json`), JSON.stringify(info, null, 2));
}
export function clearPid(name) {
  fs.rmSync(path.join(RUN, `${name}.json`), { force: true });
}

export async function stopPid(name) {
  const info = readPid(name);
  if (!info || !alive(info.pid)) {
    clearPid(name);
    return false;
  }
  // Detached children lead their own process group: stop the whole group.
  try { process.kill(-info.pid, 'SIGTERM'); } catch { try { process.kill(info.pid, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 30 && alive(info.pid); i++) await sleep(200);
  if (alive(info.pid)) try { process.kill(-info.pid, 'SIGKILL'); } catch { /* gone */ }
  clearPid(name);
  return true;
}

export function portFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, host);
  });
}

export function portOwner(port) {
  try {
    return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n')[1]?.split(/\s+/).slice(0, 2).join(' pid ');
  } catch {
    return undefined;
  }
}

// ---------- Build ----------

function newest(dir, skip = /node_modules|\.next|\.data|\.git/) {
  let t = 0;
  if (!fs.existsSync(dir)) return 0;
  const st = fs.statSync(dir);
  if (!st.isDirectory()) return st.mtimeMs;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    if (skip.test(p)) continue;
    t = Math.max(t, newest(p, skip));
  }
  return t;
}

export function buildState() {
  const id = path.join(ROOT, '.next', 'BUILD_ID');
  if (!fs.existsSync(id)) return { ok: false, why: 'no production build' };
  const built = fs.statSync(id).mtimeMs;
  const src = Math.max(newest(path.join(ROOT, 'src')), ...['package-lock.json', 'next.config.mjs', 'tsconfig.json'].map((f) => newest(path.join(ROOT, f))));
  if (src > built) return { ok: false, why: 'source changed since the last build' };
  return { ok: true, at: new Date(built).toISOString() };
}

export async function ensureBuild({ force = false, quiet = false } = {}) {
  const b = buildState();
  if (b.ok && !force) return { built: false };
  if (!quiet) console.log(dim(`  Building (${force ? 'forced' : b.why})…`));
  const r = await run('npm', ['run', 'build'], { quiet: true });
  if (r.code !== 0) {
    console.error(r.out.split('\n').slice(-40).join('\n'));
    throw new Error('npm run build failed');
  }
  // A rebuild replaces .next under the presenter's running app, whose pages would then ask for files that no
  // longer exist ("ChunkLoadError"). Restart it on the new build, keeping its modes and its state.
  const srv = readPid('server');
  if (srv && alive(srv.pid) && (await healthy(PORT))) {
    const st = await state(PORT).catch(() => undefined);
    const argv = ['--restart', '--resume', '--no-open', ...(st ? [`--ai=${st.settings.aiMode}`, `--whatsapp=${st.settings.channel}`] : [])];
    if (!quiet) console.log(dim('  The app on :3000 was running the previous build: restarting it (state kept)…'));
    const re = await run(process.execPath, [path.join(ROOT, 'scripts/demo/launch.mjs'), ...argv], { quiet: true });
    if (re.code !== 0) console.error('  Could not restart the app: run npm run demo:launch -- --restart --resume');
    else if (st && !st.settings.voiceReplies) await director(PORT, 'voice', 'off').catch(() => {});
  }
  return { built: true };
}

// ---------- Server ----------

export const base = (port = PORT) => `http://127.0.0.1:${port}`;

export async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init?.timeout ?? 10_000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

export async function state(port = PORT) {
  const r = await getJson(`${base(port)}/api/state`);
  if (r.status !== 200) throw new Error(`/api/state ${r.status}`);
  return r.body;
}

export async function action(port, act, payload = {}) {
  const r = await getJson(`${base(port)}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: act, ...payload }), timeout: 30_000 });
  if (r.status !== 200) throw new Error(`action ${act}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
export const director = (port, op, arg) => action(port, 'director', { op, ...(arg !== undefined ? { arg } : {}) });

export async function healthy(port = PORT) {
  try {
    const s = await state(port);
    return !!s?.settings;
  } catch {
    return false;
  }
}

export async function waitFor(fn, { timeout = 15_000, every = 250, what = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
}

/**
 * Start `next start` bound to 127.0.0.1. Detached servers outlive the CLI (the presenter's server);
 * attached ones are for tests and stop with the returned handle.
 */
export async function startServer({ port = PORT, env = {}, detached = false, logFile, name } = {}) {
  if (!(await portFree(port))) throw new Error(`Port ${port} is already in use (${portOwner(port) ?? 'unknown process'})`);
  fs.mkdirSync(LOGS, { recursive: true });
  const log = logFile ?? path.join(LOGS, `server-${port}.log`);
  const fd = fs.openSync(log, 'a');
  fs.writeSync(fd, `\n===== ${new Date().toISOString()} next start -p ${port} =====\n`);
  const p = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: ROOT,
    detached: true, // own process group, so stop() reaches next's children too
    stdio: ['ignore', fd, fd],
    env: { ...process.env, ...env, NODE_ENV: 'production' },
  });
  if (detached) p.unref();
  if (name) writePid(name, { pid: p.pid, port, log, startedAt: new Date().toISOString() });
  await waitFor(() => healthy(port), { timeout: 45_000, what: `server on port ${port}` }).catch((e) => {
    try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ }
    throw new Error(`${e.message}. Log: ${path.relative(ROOT, log)}`);
  });
  return {
    pid: p.pid,
    port,
    log,
    stop: async () => {
      try { process.kill(-p.pid, 'SIGTERM'); } catch { /* gone */ }
      for (let i = 0; i < 25 && alive(p.pid); i++) await sleep(200);
      try { process.kill(-p.pid, 'SIGKILL'); } catch { /* gone */ }
      if (name) clearPid(name);
    },
  };
}

/** A throwaway data folder that shares the presenter's AI cache and voice clips (rehearsals reuse them for free). */
export function scratchDataDir(label) {
  const dir = path.join(DATA, 'scratch', `${label}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const shared of ['ai-cache', 'tts']) {
    fs.mkdirSync(path.join(DATA, shared), { recursive: true });
    fs.symlinkSync(path.join(DATA, shared), path.join(dir, shared));
  }
  return dir;
}

export function cleanScratch(keep = 3) {
  const d = path.join(DATA, 'scratch');
  if (!fs.existsSync(d)) return;
  const all = fs.readdirSync(d).sort();
  for (const x of all.slice(0, Math.max(0, all.length - keep))) fs.rmSync(path.join(d, x), { recursive: true, force: true });
}

export function tunnelInfo() {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(DATA, 'tunnel.json'), 'utf8'));
    return { ...t, running: alive(t.pid) };
  } catch {
    return undefined;
  }
}

/** Demo asset files found in public/demo, by role. */
export const ASSETS = {
  'elsen-listing': { kind: 'audio', required: true, label: "Elşən's listing voice note" },
  'rauf-cancel': { kind: 'audio', required: true, label: "Rauf's cancellation voice note" },
  'tomatoes-stage4': { kind: 'image', required: true, label: 'Pink (stage 4) Roma tomatoes photo' },
  'tomatoes-stage6': { kind: 'image', required: false, label: 'Red (stage 6) tomatoes photo' },
  'tomatoes-spoiled': { kind: 'image', required: false, label: 'Spoiled tomatoes photo' },
};
export const APP_AUDIO_EXT = ['ogg', 'mp3', 'm4a', 'webm']; // what the app plays and sends, in order
export const ANY_AUDIO_EXT = [...APP_AUDIO_EXT, 'wav', 'opus', 'aac', 'mp4', 'amr', 'flac'];
export const ANY_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];

export function findAsset(id) {
  const dir = path.join(ROOT, 'public', 'demo');
  const exts = ASSETS[id].kind === 'audio' ? ANY_AUDIO_EXT : ANY_IMAGE_EXT;
  const found = exts.map((e) => path.join(dir, `${id}.${e}`)).filter((p) => fs.existsSync(p));
  const appExts = ASSETS[id].kind === 'audio' ? APP_AUDIO_EXT : ['jpg'];
  const usable = found.find((p) => appExts.includes(path.extname(p).slice(1)));
  return { found, usable };
}

export function ffprobe(file) {
  if (!which('ffprobe')) return undefined;
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name,bit_rate:stream=codec_name,codec_type,sample_rate,channels,width,height', '-of', 'json', file], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

export function openUrl(url) {
  try {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

export function copyToClipboard(text) {
  try {
    execFileSync('pbcopy', { input: text });
    return true;
  } catch {
    return false;
  }
}
