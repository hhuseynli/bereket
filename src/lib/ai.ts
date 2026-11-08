// AI primitives: Azerbaijani speech-to-text (ElevenLabs Scribe v2), listing extraction and photo inspection
// (Claude, or DeepSeek through its Anthropic-compatible API), and intent detection.
//
// Three modes, always reported per result so the UI never passes scripted output off as a model's:
//   live       call the provider; on failure fall back to a cached verified result, then to the script
//   cached     reuse a previously verified provider result (no network); on a miss, the script
//   simulated  scripted fallback only, no network
// Every live result is cached by input hash in .data/ai-cache/, so rehearsals with the same recordings are free.
import Anthropic from '@anthropic-ai/sdk';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';

const CACHE_DIR = () => dataDir('ai-cache');
// Per call; one retry. A stuck provider then falls back (cache, then script) in about 40 s at most.
const TIMEOUT_MS = () => Number(process.env.AI_TIMEOUT_MS ?? 20_000);

export type Mode = 'live' | 'cached' | 'simulated';
export type AiMode = Mode;

export function defaultAiMode(): AiMode {
  if (process.env.AI_OFFLINE === '1') return 'simulated';
  const m = process.env.AI_MODE;
  return m === 'live' || m === 'cached' || m === 'simulated' ? m : 'live';
}

export const hasElevenLabs = () => !!process.env.ELEVENLABS_API_KEY;

// ---------- Text and vision provider ----------

export interface TextProvider {
  name: 'anthropic' | 'deepseek';
  model: string;
  vision: boolean;
}

export function textProvider(): TextProvider | undefined {
  const want = process.env.AI_PROVIDER;
  const anthropic = !!process.env.ANTHROPIC_API_KEY && want !== 'deepseek';
  const deepseek = !!process.env.DEEPSEEK_API_KEY && want !== 'anthropic';
  if (anthropic) return { name: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5', vision: true };
  if (deepseek) {
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
    // deepseek-v4-pro replaces images with "[Unsupported Image]", so only flash inspects photos.
    return { name: 'deepseek', model, vision: model.includes('flash') };
  }
  return undefined;
}
export const hasClaude = () => !!textProvider();

let anthropicClient: Anthropic | undefined;
let deepseekClient: Anthropic | undefined;
function clientFor(p: TextProvider): Anthropic {
  if (p.name === 'anthropic') return (anthropicClient ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2 }));
  return (deepseekClient ??= new Anthropic({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com/anthropic', maxRetries: 2 }));
}

let elevenClient: ElevenLabsClient | undefined;
const eleven = () => (elevenClient ??= new ElevenLabsClient());

// ---------- Provider health, for the presenter panel and doctor ----------

export interface Health { ok: boolean; at: string; detail: string }
const gh = globalThis as unknown as { __aiHealth?: Record<string, Health> };
export const aiHealth = () => (gh.__aiHealth ??= {});
function noteHealth(kind: string, ok: boolean, detail: string) {
  aiHealth()[kind] = { ok, at: new Date().toISOString(), detail: detail.slice(0, 160) };
}

// ---------- Cache ----------

export function hash(...parts: (string | Buffer | undefined)[]): string {
  const h = crypto.createHash('sha256');
  for (const p of parts) if (p) h.update(p);
  return h.digest('hex').slice(0, 24);
}

interface CacheEntry<T> { value: T; meta?: { provider: string; model: string; at: string } }

function cacheGet<T>(key: string): CacheEntry<T> | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR(), `${key}.json`), 'utf8'));
    // Older cache files hold the bare value.
    return raw && typeof raw === 'object' && 'value' in raw && 'meta' in raw ? raw : { value: raw as T };
  } catch {
    return undefined;
  }
}
function cachePut(key: string, value: unknown, provider: string, model: string) {
  fs.mkdirSync(CACHE_DIR(), { recursive: true });
  const entry: CacheEntry<unknown> = { value, meta: { provider, model, at: new Date().toISOString() } };
  fs.writeFileSync(path.join(CACHE_DIR(), `${key}.json`), JSON.stringify(entry, null, 2));
}

export interface Resolved<T> { value: T; mode: Mode; note?: string }

/** Apply the mode policy: live, then cache, then script. Never labels a fallback as live. */
const LIVE_GRACE_MS = () => Number(process.env.AI_LIVE_GRACE_MS ?? 8000);
const BREAKER_MS = () => Number(process.env.AI_BREAKER_MS ?? 45_000);
const NETWORK = /fetch failed|timed? ?out|connection error|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|socket|network/i;
const gb = globalThis as unknown as { __aiDown?: Record<string, number> };
const down = () => (gb.__aiDown ??= {});

export async function resolveAi<T>(
  kind: string,
  key: string,
  aiMode: AiMode,
  live: { provider: string; model: string; run: () => Promise<T> } | undefined,
  scripted: () => T | undefined,
): Promise<Resolved<T>> {
  let note: string | undefined;
  const cached = aiMode !== 'simulated' ? cacheGet<T>(key) : undefined;
  if (aiMode === 'live') {
    const since = live ? Date.now() - (down()[live.provider] ?? 0) : 0;
    if (!live) note = 'no provider key';
    else if (since < BREAKER_MS()) note = `${live.provider} unreachable ${Math.round(since / 1000)} s ago, not retried yet`;
    else {
      const call = live.run().then((value) => {
        cachePut(key, value, live.provider, live.model);
        noteHealth(kind, true, `${live.provider} ${live.model}`);
        delete down()[live.provider];
        return value;
      });
      call.catch((err) => {
        const msg = (err as Error).message;
        noteHealth(kind, false, `${live.provider} failed: ${msg}`);
        if (NETWORK.test(msg)) down()[live.provider] = Date.now();
        console.error(`[ai] ${kind}: ${live.provider} failed: ${msg}`);
      });
      try {
        if (!cached) return { value: await call, mode: 'live' };
        // A verified result exists: give the live call a few seconds, then show the verified one (it keeps refreshing).
        const won = await Promise.race([call.then((v) => ({ v })), new Promise<null>((r) => setTimeout(() => r(null), LIVE_GRACE_MS()))]);
        if (won) return { value: won.v, mode: 'live' };
        note = `${live.provider} slower than ${LIVE_GRACE_MS() / 1000} s, showing the result it gave earlier`;
      } catch (err) {
        note = `${live.provider} failed: ${(err as Error).message}`;
      }
    }
  }
  if (cached) return { value: cached.value, mode: 'cached', note };
  const s = scripted();
  if (s !== undefined) return { value: s, mode: 'simulated', note };
  throw new Error(note ?? `No ${kind} result available in ${aiMode} mode`);
}

export { DEMO_PHOTOS, DEMO_VOICE } from './demo';
import { DEMO_VOICE } from './demo';

// ---------- Azerbaijani number words -> digits ----------

const NUM: Record<string, number> = {
  bir: 1, iki: 2, 'üç': 3, 'dörd': 4, 'beş': 5, 'altı': 6, yeddi: 7, 'səkkiz': 8, doqquz: 9, on: 10,
  iyirmi: 20, otuz: 30, 'qırx': 40, 'əlli': 50, 'altmış': 60, 'yetmiş': 70, 'səksən': 80, doxsan: 90, 'yüz': 100, min: 1000,
};

export function wordsToDigits(text: string): string {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  let total = 0;
  let current = 0;
  let inNum = false;
  let pendingSpace = '';
  const flush = () => {
    if (inNum) out.push(String(total + current), pendingSpace);
    total = 0; current = 0; inNum = false; pendingSpace = '';
  };
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) {
      if (inNum) pendingSpace = tok;
      else out.push(tok);
      continue;
    }
    // Speech-to-text sometimes mixes digits and words ("100 səksən kilo" for 180): digits join the number too.
    const d = tok.match(/^(\d+)([^\d.,]*)$/);
    if (d) {
      const n = parseInt(d[1], 10);
      if (inNum && n < 100 && current % 100 === 0 && current > 0) current += n;
      else { flush(); current = n; inNum = true; }
      if (d[2]) { out.push(String(total + current) + d[2]); total = 0; current = 0; inNum = false; pendingSpace = ''; }
      continue;
    }
    const m = tok.toLocaleLowerCase('az').match(/^([a-zçəğıöşü]+)([^a-zçəğıöşü]*)$/);
    const v = m ? NUM[m[1]] : undefined;
    if (v !== undefined) {
      if (v === 100) current = (current || 1) * 100;
      else if (v === 1000) { total += (current || 1) * 1000; current = 0; }
      else current += v;
      inNum = true;
      if (m && m[2]) { out.push(String(total + current) + m[2]); total = 0; current = 0; inNum = false; pendingSpace = ''; }
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();
  return out.join('').replace(/\s+$/, '');
}

const WEEKDAYS: [RegExp, number][] = [
  [/bazar ert[əe]si/, 1], [/ç[əe]rş[əe]nb[əe] axşamı/, 2], [/ç[əe]rş[əe]nb[əe]/, 3], [/cüm[əe] axşamı/, 4], [/cüm[əe]/, 5], [/ş[əe]nb[əe]/, 6], [/bazar/, 0],
];

export interface Extracted {
  product?: string;
  variety?: string;
  grade?: 1 | 2 | 3;
  qtyKg?: number;
  priceAzn?: number;
  harvest?: string;
  notes?: string; // short English note for buyers (e.g. "wants pickup within 2-3 days")
  transcriptEn?: string;
  confidence: Record<string, number>;
}

/** Every price the farmer mentions, with its position, in a digits-normalised lower-case text. */
export function priceMentions(t: string): { value: number; index: number }[] {
  const out: { value: number; index: number }[] = [];
  const taken: [number, number][] = [];
  const add = (value: number, m: RegExpExecArray) => {
    if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) return;
    taken.push([m.index, m.index + m[0].length]);
    if (value > 0 && value <= 100) out.push({ value: Math.round(value * 100) / 100, index: m.index });
  };
  for (const m of t.matchAll(/(\d+)\s*manat\s*(\d+)\s*q[əe]pik/g)) add(parseInt(m[1]) + parseInt(m[2]) / 100, m as RegExpExecArray);
  for (const m of t.matchAll(/(\d+[.,]\d+)\s*(manat|azn|₼)/g)) add(parseFloat(m[1].replace(',', '.')), m as RegExpExecArray);
  for (const m of t.matchAll(/(\d+)\s*(manat|azn|₼)/g)) add(parseInt(m[1]), m as RegExpExecArray);
  for (const m of t.matchAll(/(\d+)\s*q[əe]pik/g)) add(parseInt(m[1]) / 100, m as RegExpExecArray);
  return out.sort((a, b) => a.index - b.index);
}

/** The asking price among several: near "sat-/ver-" (sell/give) wins, near "maya" (cost) loses, else the last one. */
export function askingPrice(t: string): { value?: number; ambiguous: boolean } {
  const ps = priceMentions(t);
  if (!ps.length) return { ambiguous: false };
  const distinct = Array.from(new Set(ps.map((p) => p.value)));
  if (distinct.length === 1) return { value: distinct[0], ambiguous: false };
  const score = (p: { index: number }) => {
    const near = t.slice(Math.max(0, p.index - 40), p.index + 60);
    return (/sat|ver[iəeə]|istəyirəm|qiymət/.test(near) ? 1 : 0) - (/maya|başa gəl|xərc|alış/.test(near) ? 2 : 0);
  };
  const best = [...ps].sort((a, b) => score(b) - score(a) || b.index - a.index)[0];
  return { value: best.value, ambiguous: true };
}

export function offlineExtract(az: string, todayIso: string): Extracted {
  const t = wordsToDigits(az).toLocaleLowerCase('az');
  const out: Extracted = { confidence: {} };
  if (/pomidor/.test(t)) out.product = 'Tomato';
  else if (/xiyar/.test(t)) out.product = 'Cucumber';
  else if (/alma/.test(t)) out.product = 'Apple';
  else if (/kartof/.test(t)) out.product = 'Potato';
  if (out.product) out.confidence.product = 0.95;
  if (/roma/.test(t)) out.variety = 'Roma';
  else if (/çeri|cherry/.test(t)) out.variety = 'Cherry';
  else if (out.product) out.variety = 'Local';
  out.confidence.variety = /roma|çeri/.test(t) ? 0.9 : 0.5;
  const qty = t.match(/(\d+(?:[.,]\d+)?)\s*(kilo|kq|kiloqram|kg|ton)/);
  if (qty) {
    out.qtyKg = parseFloat(qty[1].replace(',', '.')) * (qty[2] === 'ton' ? 1000 : 1);
    out.confidence.qtyKg = 0.93;
  }
  const price = askingPrice(t);
  if (price.value) {
    out.priceAzn = price.value;
    out.confidence.priceAzn = price.ambiguous ? 0.55 : 0.9;
  }
  if (/birinci sort|1-ci sort|əla/.test(t)) out.grade = 1;
  else if (/ikinci sort|2-ci sort/.test(t)) out.grade = 2;
  if (out.grade) out.confidence.grade = 0.8;
  const today = new Date(todayIso);
  if (/bu gün|bugün/.test(t)) out.harvest = todayIso.slice(0, 10);
  else if (/sabah/.test(t)) out.harvest = new Date(today.getTime() + 864e5).toISOString().slice(0, 10);
  else {
    for (const [re, wd] of WEEKDAYS) {
      if (re.test(t)) {
        const diff = (wd - today.getUTCDay() + 7) % 7;
        out.harvest = new Date(today.getTime() + diff * 864e5).toISOString().slice(0, 10);
        break;
      }
    }
  }
  if (out.harvest) out.confidence.harvest = 0.85;
  const known = Object.values(DEMO_VOICE).find((d) => d.az === az);
  out.transcriptEn = known?.en;
  return out;
}

// ---------- Speech to text ----------

// Words the demo depends on. Biasing Scribe towards them costs 20% more per request and fixes the usual misses.
const KEYTERMS = ['pomidor', 'Roma', 'manat', 'qəpik', 'kilo', 'birinci sort', 'dolu', 'BƏRƏKƏT'];

export async function transcribe(audio: Buffer, mime: string, opts: { aiMode: AiMode; scriptedAz?: string }): Promise<{ text: string; mode: Mode; note?: string }> {
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'audio';
  const live = hasElevenLabs()
    ? {
        provider: 'elevenlabs',
        model: 'scribe_v2',
        run: async () => {
          const r = await eleven().speechToText.convert(
            {
              file: { data: audio, filename: `voice.${ext}`, contentType: mime.split(';')[0] },
              modelId: 'scribe_v2',
              languageCode: 'aze',
              tagAudioEvents: false,
              keyterms: KEYTERMS,
            },
            { timeoutInSeconds: TIMEOUT_MS() / 1000, maxRetries: 1 },
          );
          const text = 'text' in r && typeof r.text === 'string' ? r.text.trim() : '';
          if (!text) throw new Error('ElevenLabs returned an empty transcript');
          return { text };
        },
      }
    : undefined;
  // A real recording has no script unless it is one of the demo voice notes; never invent one.
  const r = await resolveAi('stt', hash('stt', audio), opts.aiMode, live, () => (opts.scriptedAz ? { text: opts.scriptedAz } : undefined));
  return { text: r.value.text, mode: r.mode, note: r.note };
}

// ---------- Text model ----------

export async function complete(p: TextProvider, system: string, content: Anthropic.ContentBlockParam[], maxTokens = 1200, req: { timeoutMs?: number; retries?: number } = {}): Promise<string> {
  const c = clientFor(p);
  const opts = { timeout: req.timeoutMs ?? TIMEOUT_MS(), maxRetries: req.retries ?? 1 };
  if (p.name === 'anthropic') {
    // Claude Opus 5.5 always thinks; low effort keeps extraction quick. Server-side fallbacks retry a
    // classifier refusal on another model inside the same call.
    const r = await c.beta.messages.create(
      {
        model: p.model,
        max_tokens: 8000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system,
        messages: [{ role: 'user', content: content as Anthropic.Beta.BetaContentBlockParam[] }],
      },
      opts,
    );
    if (r.stop_reason === 'refusal') throw new Error('Model declined the request');
    return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  }
  const r = await c.messages.create(
    { model: p.model, max_tokens: maxTokens, thinking: { type: 'disabled' }, system, messages: [{ role: 'user', content }] },
    opts,
  );
  return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
}

export function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model output');
  try {
    return JSON.parse(m[0]) as T;
  } catch {
    throw new Error('Malformed JSON in model output');
  }
}

// The matching engine compares product names exactly, so model output is mapped onto the platform's names.
const PRODUCTS: Record<string, string> = {
  tomato: 'Tomato', tomatoes: 'Tomato', pomidor: 'Tomato', cucumber: 'Cucumber', cucumbers: 'Cucumber', xiyar: 'Cucumber',
  apple: 'Apple', apples: 'Apple', alma: 'Apple', potato: 'Potato', potatoes: 'Potato', kartof: 'Potato',
  pepper: 'Pepper', peppers: 'Pepper', bibər: 'Pepper', onion: 'Onion', onions: 'Onion', soğan: 'Onion',
  pear: 'Pear', pears: 'Pear', armud: 'Pear', cabbage: 'Cabbage', kələm: 'Cabbage', carrot: 'Carrot', carrots: 'Carrot', yerkökü: 'Carrot',
  eggplant: 'Eggplant', eggplants: 'Eggplant', badımcan: 'Eggplant', quince: 'Quince', heyva: 'Quince', persimmon: 'Persimmon', xurma: 'Persimmon',
  beans: 'Beans', lobya: 'Beans', hazelnut: 'Hazelnut', hazelnuts: 'Hazelnut', fındıq: 'Hazelnut', walnut: 'Walnut', walnuts: 'Walnut', qoz: 'Walnut',
};
export function canonicalProduct(p?: string): string | undefined {
  if (!p) return undefined;
  const k = p.trim().toLocaleLowerCase('az');
  return PRODUCTS[k] ?? PRODUCTS[k.replace(/(es|s)$/, '')] ?? k.charAt(0).toLocaleUpperCase('en') + k.slice(1);
}
const canonicalVariety = (v?: string) => (v ? (/^roma$/i.test(v.trim()) ? 'Roma' : /^(cherry|çeri)$/i.test(v.trim()) ? 'Cherry' : v.trim().charAt(0).toUpperCase() + v.trim().slice(1)) : undefined);

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const clamp01 = (v: unknown, d: number) => {
  const n = num(v);
  return n === undefined ? d : Math.max(0, Math.min(1, n));
};

/**
 * Check a model's listing against the transcript. Values outside sane ranges are dropped (the farmer is
 * then asked), and numbers that cannot be found in the transcript keep their value but get low confidence,
 * which sends the listing to operator review instead of silently trusting it.
 */
export function validateExtracted(j: Record<string, unknown>, az: string): Extracted {
  const conf = (j.confidence ?? {}) as Record<string, unknown>;
  const out: Extracted = { confidence: {} };
  const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.toLowerCase() !== 'null' ? v.trim() : undefined);
  out.product = canonicalProduct(str(j.product));
  out.variety = canonicalVariety(str(j.variety));
  const g = num(j.grade);
  if (g === 1 || g === 2 || g === 3) out.grade = g;
  const q = num(j.qtyKg);
  if (q !== undefined && q > 0 && q <= 100_000) out.qtyKg = q;
  const p = num(j.priceAzn);
  if (p !== undefined && p > 0 && p <= 100) out.priceAzn = Math.round(p * 100) / 100;
  const h = str(j.harvestDate);
  if (h && /^\d{4}-\d{2}-\d{2}$/.test(h)) out.harvest = h;
  out.transcriptEn = str(j.transcriptEn);
  out.notes = str(j.notes)?.slice(0, 160);
  for (const k of ['product', 'variety', 'qtyKg', 'priceAzn', 'grade', 'harvest'] as const) {
    if (out[k] !== undefined) out.confidence[k] = clamp01(conf[k], 0.7);
  }
  const digits = wordsToDigits(az).replace(/\s+/g, ' ');
  if (out.qtyKg !== undefined && !new RegExp(`(^|\\D)${out.qtyKg}(\\D|$)`).test(digits)) out.confidence.qtyKg = Math.min(out.confidence.qtyKg, 0.5);
  if (out.priceAzn !== undefined) {
    const whole = Math.floor(out.priceAzn);
    const kop = Math.round((out.priceAzn - whole) * 100);
    const forms = [out.priceAzn.toFixed(2).replace('.', '[.,]'), String(out.priceAzn).replace('.', '[.,]'), `${whole}\\s*manat\\s*${kop}\\s*q[əe]pik`];
    if (kop === 0) forms.push(`${whole}\\s*manat`);
    if (whole === 0) forms.push(`${kop}\\s*q[əe]pik`);
    const said = new RegExp(`(^|\\D)(${forms.join('|')})`).test(digits.toLocaleLowerCase('az'));
    if (!said) out.confidence.priceAzn = Math.min(out.confidence.priceAzn, 0.5);
    // Several different prices (cost and selling price, or a range): keep the model's pick, but ask the farmer.
    else if (askingPrice(digits.toLocaleLowerCase('az')).ambiguous) out.confidence.priceAzn = Math.min(out.confidence.priceAzn, 0.55);
  }
  return out;
}

/** True when the number appears in what the farmer said (digits or Azerbaijani number words). */
export function saidNumber(text: string, n: number): boolean {
  const d = wordsToDigits(text).toLocaleLowerCase('az');
  if (new RegExp(`(^|\\D)${String(n).replace('.', '[.,]')}(\\D|$)`).test(d)) return true;
  return priceMentions(d).some((p) => p.value === n);
}

const EXTRACT_SYSTEM = `You turn an Azerbaijani farmer's WhatsApp message (often a speech-to-text transcript with recognition
errors, greetings and small talk) into a produce listing for a wholesale marketplace.
Return ONLY JSON: {"product": singular English name, capitalised (Tomato, Cucumber, Apple, Potato, Pepper, Onion, ...) or null,
"variety": string or null (e.g. "Roma"; null if unclear or misheard), "grade": 1|2|3 or null,
"qtyKg": number or null, "priceAzn": the price per kg the farmer wants to SELL at, in manat, or null,
"harvestDate": "YYYY-MM-DD" or null (only if a harvest/picking day is said),
"notes": short English note for buyers with other useful facts (timing, delivery wishes, cost price) or null,
"evidence": {"qtyKg": farmer's exact words, "priceAzn": farmer's exact words},
"transcriptEn": faithful English translation,
"confidence": {"product":0-1,"qtyKg":0-1,"priceAzn":0-1,"grade":0-1,"harvest":0-1}}.
Rules:
- Azerbaijani numbers may be words: "yüz səksən" = 180, "bir manat on beş qəpik" = 1.15, "bir manat əlli qəpik" = 1.50. 1 manat = 100 qəpik. "ton" = 1000 kg, "sentner" = 100 kg.
- If the farmer gives a cost price ("maya", "mayası", "özümə başa gəlir") and a selling price, priceAzn is the SELLING price; mention the cost in notes. If two prices are possible, pick the one they want to sell at and set its confidence to at most 0.6.
- "In 2-3 days I want a buyer" is timing for notes, not a harvest date.
- Never invent values that were not said; use null.`;

export async function extractListing(az: string, todayIso: string, aiMode: AiMode): Promise<{ data: Extracted; mode: Mode; note?: string }> {
  const p = textProvider();
  const live = p
    ? {
        provider: p.name,
        model: p.model,
        run: async () => {
          const text = await complete(p, EXTRACT_SYSTEM, [{ type: 'text', text: `Today is ${todayIso.slice(0, 10)} (${new Date(todayIso).toLocaleDateString('en-GB', { weekday: 'long' })}).\nTranscript:\n${az}` }]);
          return validateExtracted(parseJson<Record<string, unknown>>(text), az);
        },
      }
    : undefined;
  const r = await resolveAi('extract', hash('extract', az, todayIso.slice(0, 10)), aiMode, live, () => offlineExtract(az, todayIso));
  // Also applied to results cached before names were normalised.
  const data = { ...r.value, product: canonicalProduct(r.value.product), variety: canonicalVariety(r.value.variety) };
  return { data, mode: r.mode, note: r.note };
}

export interface Inspection {
  product?: string;
  ripeness: number;
  confidence: number;
  defects: string[];
  spoiled: boolean;
  note: string;
}

const INSPECT_SYSTEM = `You inspect a farmer's produce photo for a wholesale marketplace. Judge only what is visible.
This is a visual estimate for buyers, not a food-safety certification.
Tomato ripeness uses six stages: 1 Green, 2 Breaker, 3 Turning, 4 Pink, 5 Light red, 6 Red.
Return ONLY JSON: {"product": English name, "ripeness": 1-6 (dominant stage), "confidence": 0-1,
"defects": [short strings, e.g. "cracked skin on a few fruit"], "spoiled": true if rot, mould or heavy damage is visible,
"note": one short sentence for a buyer}. Be conservative: if the photo is unclear or not produce, set confidence below 0.5.`;

export function validateInspection(j: Record<string, unknown>): Inspection {
  return {
    product: typeof j.product === 'string' ? j.product : undefined,
    ripeness: Math.max(1, Math.min(6, Math.round(num(j.ripeness) ?? 4))),
    confidence: clamp01(j.confidence, 0.5),
    defects: Array.isArray(j.defects) ? j.defects.filter((d): d is string => typeof d === 'string').slice(0, 6) : [],
    spoiled: j.spoiled === true || j.spoiled === 'true',
    note: typeof j.note === 'string' ? j.note.slice(0, 240) : '',
  };
}

export async function inspectPhoto(image: Buffer | undefined, mime: string, opts: { aiMode: AiMode; hintStage?: number; hintSpoiled?: boolean }): Promise<{ data: Inspection; mode: Mode; note?: string }> {
  const scripted = (): Inspection => ({
    product: 'Tomato',
    ripeness: opts.hintStage ?? 4,
    confidence: opts.hintStage ? 0.88 : 0.6,
    defects: opts.hintSpoiled ? ['Mould and split fruit visible'] : [],
    spoiled: !!opts.hintSpoiled,
    note: opts.hintSpoiled ? 'Visible mould on several fruit.' : 'Even colour, firm, no visible damage.',
  });
  // The SVG placeholders are drawings, not photos: always scripted.
  if (!image || mime.includes('svg')) return { data: scripted(), mode: 'simulated', note: 'placeholder image' };
  const p = textProvider();
  const media = mime.includes('png') ? 'image/png' : mime.includes('webp') ? 'image/webp' : 'image/jpeg';
  const live = p?.vision
    ? {
        provider: p.name,
        model: p.model,
        run: async () => {
          const text = await complete(p, INSPECT_SYSTEM, [
            { type: 'image', source: { type: 'base64', media_type: media, data: image.toString('base64') } },
            { type: 'text', text: 'Inspect this produce photo.' },
          ]);
          return validateInspection(parseJson<Record<string, unknown>>(text));
        },
      }
    : undefined;
  // A photo the team did not script (a real farmer's upload) gets no scripted verdict, only a low-confidence default.
  const r = await resolveAi('inspect', hash('inspect', image), opts.aiMode, live, () =>
    opts.hintStage ? scripted() : { ripeness: 4, confidence: 0.3, defects: [], spoiled: false, note: 'Not inspected: AI unavailable. Operator to check.' },
  );
  return { data: r.value, mode: r.mode, note: r.note };
}

export type Intent = 'accept' | 'decline' | 'cancel' | 'rating' | 'listing' | 'other';
const INTENTS: Intent[] = ['accept', 'decline', 'cancel', 'listing', 'other'];

export function offlineIntent(text: string): { intent: Intent; stars?: number } {
  const t = text.trim().toLocaleLowerCase('az');
  if (/^[1-5]$/.test(t)) return { intent: 'rating', stars: Number(t) };
  if (/(qəbul|bəli|^hə\b|razıyam|təsdiq)/.test(t)) return { intent: 'accept' };
  if (/(imtina|ləğv|göndərə bilmirəm|verə bilmirəm|olmayacaq|dolu|xarab oldu|bağışlayın)/.test(t)) return { intent: 'cancel' };
  if (/(kilo|kq|manat|pomidor|xiyar|alma|kartof)/.test(t)) return { intent: 'listing' };
  return { intent: 'other' };
}

export async function classifyIntent(text: string, context: string, aiMode: AiMode): Promise<{ intent: Intent; cause?: string; en?: string; mode: Mode }> {
  const quick = offlineIntent(text);
  // Unambiguous keyword replies need no model.
  if (quick.intent !== 'other' && quick.intent !== 'listing' && quick.intent !== 'cancel') return { intent: quick.intent, mode: 'simulated' };
  const p = textProvider();
  const live = p
    ? {
        provider: p.name,
        model: p.model,
        run: async () => {
          const out = await complete(
            p,
            `Classify an Azerbaijani farmer's WhatsApp message for a produce marketplace. Context: ${context}.
Return ONLY JSON: {"intent": "accept"|"decline"|"cancel"|"listing"|"other", "cause": short English reason if cancelling else null, "en": faithful English translation}.`,
            [{ type: 'text', text }],
            300,
          );
          const j = parseJson<{ intent?: string; cause?: string | null; en?: string }>(out);
          return { intent: (INTENTS.includes(j.intent as Intent) ? j.intent : 'other') as Intent, cause: j.cause ?? undefined, en: j.en };
        },
      }
    : undefined;
  const r = await resolveAi('intent', hash('intent', text, context), aiMode, live, () => {
    const known = Object.values(DEMO_VOICE).find((d) => d.az === text);
    const cause = quick.intent === 'cancel' ? (/dolu/.test(text.toLocaleLowerCase('az')) ? 'Hail damaged the crop' : 'Farmer cannot deliver') : undefined;
    return { intent: quick.intent, cause, en: known?.en };
  });
  return { ...r.value, mode: r.mode };
}

// ---------- Media storage ----------

const MEDIA_DIR = () => dataDir('media');

export function saveMedia(buf: Buffer, mime: string): string {
  fs.mkdirSync(MEDIA_DIR(), { recursive: true });
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('svg') ? 'svg' : 'jpg';
  const id = `${hash('media', buf)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR(), id), buf);
  return `/api/media/${id}`;
}

export function readMedia(id: string): { buf: Buffer; mime: string } | undefined {
  if (!/^[a-f0-9]{24}\.[a-z0-9]+$/.test(id)) return undefined;
  try {
    const buf = fs.readFileSync(path.join(MEDIA_DIR(), id));
    const ext = id.split('.').pop()!;
    const mime = ({ ogg: 'audio/ogg', webm: 'audio/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml', jpg: 'image/jpeg' } as Record<string, string>)[ext];
    return { buf, mime };
  } catch {
    return undefined;
  }
}

/** Read a file that ships in /public (demo assets), if the team has added it. */
export function readPublic(url: string): Buffer | undefined {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
  } catch {
    return undefined;
  }
}
