// Real provider checks, run with tsx so they use the app's own AI code (src/lib/ai.ts).
//   tsx scripts/demo/ai-check.mts assets   → transcribe/inspect the team's real recordings and photos
//   tsx scripts/demo/ai-check.mts smoke    → one minimal call per provider on fixed inputs
// Prints one JSON object. Results are cached by input hash, so repeating a check costs nothing.
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain ESM helper
import { parseEnvFile } from './lib.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
Object.assign(process.env, { ...parseEnvFile(path.join(ROOT, '.env.local')), ...process.env });
process.env.DEMO_STEP_MS = '0';

const { classifyIntent, extractListing, inspectPhoto, textProvider, transcribe, hasElevenLabs } = await import('../../src/lib/ai');
const { DEMO_VOICE } = await import('../../src/lib/demo');
const { timeline } = await import('../../src/lib/seed');

type Check = { name: string; status: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'; mode?: string; detail: string; data?: unknown };
const checks: Check[] = [];
const add = (c: Check) => checks.push(c);
const mode = process.argv[2] ?? 'smoke';
// Reuse a previously verified (cached) provider result unless --fresh: repeat runs cost nothing.
const fresh = process.argv.includes('--fresh');
async function cachedFirst<R extends { mode: string }>(fn: (m: 'live' | 'cached') => Promise<R>): Promise<R> {
  if (!fresh) {
    const c = await fn('cached');
    if (c.mode === 'cached') return c;
  }
  return fn('live');
}
const today = timeline().start;

const words = (s: string) => s.toLocaleLowerCase('az').replace(/[^a-zçəğıöşü0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
function overlap(a: string, b: string) {
  const A = new Set(words(a));
  const B = words(b);
  return B.length ? B.filter((w) => A.has(w)).length / B.length : 0;
}

async function sttCheck(name: string, file: string, mime: string, script: string, mustHave: RegExp[]) {
  if (!hasElevenLabs()) return add({ name, status: 'SKIP', detail: 'no ELEVENLABS_API_KEY' });
  try {
    const buf = fs.readFileSync(file);
    const r = await cachedFirst((m) => transcribe(buf, mime, { aiMode: m }).catch((e) => { if (m === 'cached') return { text: '', mode: 'miss' }; throw e; }));
    const sim = overlap(r.text, script);
    const missing = mustHave.filter((re) => !re.test(r.text.toLocaleLowerCase('az')));
    const status = r.mode === 'simulated' ? 'FAIL' : missing.length ? 'WARN' : sim < 0.5 ? 'WARN' : 'PASS';
    add({ name, status, mode: r.mode, detail: `${Math.round(sim * 100)}% of the script's words heard${missing.length ? `; missing: ${missing.map((m) => m.source).join(', ')}` : ''}${r.note ? `; ${r.note}` : ''}`, data: { transcript: r.text } });
    return r.text;
  } catch (e) {
    add({ name, status: 'FAIL', detail: (e as Error).message });
  }
}

async function extractCheck(name: string, az: string, expect: { qtyKg?: number; priceAzn?: number; product?: string }) {
  if (!textProvider()) return add({ name, status: 'SKIP', detail: 'no ANTHROPIC_API_KEY or DEEPSEEK_API_KEY' });
  try {
    const r = await cachedFirst((m) => extractListing(az, today, m));
    const d = r.data;
    const wrong = Object.entries(expect).filter(([k, v]) => (d as unknown as Record<string, unknown>)[k] !== v).map(([k, v]) => `${k}=${(d as unknown as Record<string, unknown>)[k] ?? 'none'} (expected ${v})`);
    const lowConf = Object.entries(d.confidence).filter(([, v]) => v < 0.6).map(([k]) => k);
    add({ name, status: r.mode !== 'live' && r.mode !== 'cached' ? 'FAIL' : wrong.length ? 'WARN' : 'PASS', mode: r.mode, detail: wrong.length ? `differs: ${wrong.join(', ')}` : `${d.product} ${d.variety ?? ''} ${d.qtyKg} kg @ ${d.priceAzn} ₼${lowConf.length ? `; low confidence: ${lowConf.join(', ')} (operator review)` : ''}${r.note ? `; ${r.note}` : ''}`, data: d });
  } catch (e) {
    add({ name, status: 'FAIL', detail: (e as Error).message });
  }
}

async function intentCheck(name: string, text: string) {
  if (!textProvider()) return add({ name, status: 'SKIP', detail: 'no text AI key' });
  try {
    const r = await cachedFirst((m) => classifyIntent(text, 'farmer has a confirmed order and may be cancelling it', m));
    add({ name, status: r.mode === 'simulated' ? 'FAIL' : r.intent === 'cancel' ? 'PASS' : 'WARN', mode: r.mode, detail: `intent=${r.intent}${r.cause ? `, cause: ${r.cause}` : ''}`, data: r });
  } catch (e) {
    add({ name, status: 'FAIL', detail: (e as Error).message });
  }
}

async function photoCheck(name: string, file: string, expect: { stage?: [number, number]; spoiled?: boolean }) {
  const p = textProvider();
  if (!p?.vision) return add({ name, status: 'SKIP', detail: p ? `${p.model} cannot read images` : 'no vision-capable AI key' });
  try {
    const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    const buf = fs.readFileSync(file);
    const r = await cachedFirst((m) => inspectPhoto(buf, mime, { aiMode: m }));
    const d = r.data;
    const problems: string[] = [];
    if (expect.stage && (d.ripeness < expect.stage[0] || d.ripeness > expect.stage[1])) problems.push(`ripeness ${d.ripeness}, expected ${expect.stage.join('–')}`);
    if (expect.spoiled !== undefined && d.spoiled !== expect.spoiled) problems.push(`spoiled=${d.spoiled}, expected ${expect.spoiled}`);
    add({ name, status: r.mode === 'simulated' ? 'FAIL' : problems.length ? 'WARN' : 'PASS', mode: r.mode, detail: `${d.product ?? '?'} stage ${d.ripeness}, ${Math.round(d.confidence * 100)}%${d.defects.length ? `, defects: ${d.defects.join('; ')}` : ''}${problems.length ? ` — ${problems.join(', ')}` : ''}${r.note ? `; ${r.note}` : ''}`, data: d });
  } catch (e) {
    add({ name, status: 'FAIL', detail: (e as Error).message });
  }
}

const demo = (id: string, exts: string[]) => exts.map((e) => path.join(ROOT, 'public', 'demo', `${id}.${e}`)).find((f) => fs.existsSync(f));
const mimeOf = (f: string) => ({ ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', webm: 'audio/webm', wav: 'audio/wav' } as Record<string, string>)[path.extname(f).slice(1)] ?? 'audio/ogg';

if (mode === 'assets') {
  const elsen = demo('elsen-listing', ['ogg', 'mp3', 'm4a', 'webm']);
  if (elsen) {
    const text = await sttCheck("Elşən's recording → transcript", elsen, mimeOf(elsen), DEMO_VOICE['elsen-listing'].az, [/pomidor/, /roma/]);
    if (text) await extractCheck("Elşən's transcript → listing", text, { product: 'Tomato', qtyKg: 180, priceAzn: 1.15 });
  } else add({ name: "Elşən's recording", status: 'SKIP', detail: 'public/demo/elsen-listing.ogg not provided' });
  const rauf = demo('rauf-cancel', ['ogg', 'mp3', 'm4a', 'webm']);
  if (rauf) {
    const text = await sttCheck("Rauf's recording → transcript", rauf, mimeOf(rauf), DEMO_VOICE['rauf-cancel'].az, [/dolu/]);
    if (text) await intentCheck("Rauf's transcript → cancellation intent", text);
  } else add({ name: "Rauf's recording", status: 'SKIP', detail: 'public/demo/rauf-cancel.ogg not provided' });
  for (const [id, expect] of [['tomatoes-stage4', { stage: [3, 5], spoiled: false }], ['tomatoes-stage6', { stage: [5, 6], spoiled: false }], ['tomatoes-spoiled', { spoiled: true }]] as const) {
    const f = demo(id, ['jpg']);
    if (f) await photoCheck(`Photo ${id}.jpg`, f, expect as { stage?: [number, number]; spoiled?: boolean });
    else add({ name: `Photo ${id}.jpg`, status: 'SKIP', detail: 'not provided' });
  }
} else {
  // Smoke: the scripted Azerbaijani texts, a synthetic photo and a synthetic voice clip prepared by the caller.
  await extractCheck('Listing extraction (Azerbaijani script text)', DEMO_VOICE['elsen-listing'].az, { product: 'Tomato', qtyKg: 180, priceAzn: 1.15 });
  await intentCheck('Cancellation intent (Rauf script text)', DEMO_VOICE['rauf-cancel'].az);
  const img = process.env.SMOKE_IMAGE;
  if (img && fs.existsSync(img)) await photoCheck('Photo inspection (rendered placeholder, synthetic)', img, {});
  else add({ name: 'Photo inspection', status: 'SKIP', detail: 'no test image' });
  const clip = process.env.SMOKE_AUDIO;
  if (clip && fs.existsSync(clip)) await sttCheck('Speech-to-text (synthetic macOS voice clip)', clip, mimeOf(clip), DEMO_VOICE['elsen-listing'].az, []);
  else add({ name: 'Speech-to-text', status: 'SKIP', detail: 'no test clip' });
}

const p = textProvider();
console.log(JSON.stringify({ mode, provider: p ? `${p.name}/${p.model}` : null, stt: hasElevenLabs() ? 'elevenlabs/scribe_v2' : null, checks }));
