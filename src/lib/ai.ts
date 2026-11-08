// AI primitives: Azerbaijani speech-to-text (ElevenLabs Scribe v2), listing extraction and photo inspection
// (Claude with vision), and intent detection. Every call is cached by input hash so rehearsals are free and
// the demo survives a dead network (offline mode uses the cache, then a scripted fallback).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), '.data');
const CACHE_DIR = path.join(DATA_DIR, 'ai-cache');

export const hasElevenLabs = () => !!process.env.ELEVENLABS_API_KEY;
export const hasClaude = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

function hash(...parts: (string | Buffer | undefined)[]): string {
  const h = crypto.createHash('sha256');
  for (const p of parts) if (p) h.update(p);
  return h.digest('hex').slice(0, 24);
}

function cacheGet<T>(key: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${key}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}
function cachePut(key: string, value: unknown) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2));
}

export type Mode = 'live' | 'cached' | 'mock';

export { DEMO_PHOTOS, DEMO_VOICE } from './demo';
import { DEMO_VOICE } from './demo';

// ---------- Azerbaijani number words -> digits (used by the offline extractor) ----------

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
  transcriptEn?: string;
  confidence: Record<string, number>;
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
  const mq = t.match(/(\d+)\s*manat\s*(\d+)\s*q[əe]pik/);
  const md = t.match(/(\d+[.,]\d+)\s*manat/);
  const mm = t.match(/(\d+)\s*manat/);
  const qp = t.match(/(\d+)\s*q[əe]pik/);
  if (mq) out.priceAzn = parseInt(mq[1]) + parseInt(mq[2]) / 100;
  else if (md) out.priceAzn = parseFloat(md[1].replace(',', '.'));
  else if (mm) out.priceAzn = parseInt(mm[1]);
  else if (qp) out.priceAzn = parseInt(qp[1]) / 100;
  if (out.priceAzn) out.confidence.priceAzn = 0.9;
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

export async function transcribe(audio: Buffer, mime: string, opts: { offline: boolean; scriptedAz?: string }): Promise<{ text: string; mode: Mode }> {
  const key = hash('stt', audio);
  const cached = cacheGet<{ text: string }>(key);
  if (cached) return { text: cached.text, mode: 'cached' };
  if (!opts.offline && hasElevenLabs()) {
    const form = new FormData();
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'aze');
    form.append('file', new Blob([audio], { type: mime }), `voice.${mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : 'audio'}`);
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
      body: form,
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { text: string };
    cachePut(key, { text: json.text });
    return { text: json.text, mode: 'live' };
  }
  if (opts.scriptedAz) return { text: opts.scriptedAz, mode: 'mock' };
  throw new Error('No speech-to-text key and no scripted transcript');
}

// ---------- Claude ----------

async function claude(system: string, content: unknown[], maxTokens = 900): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { content: { type: string; text?: string }[] };
  return json.content.map((c) => c.text ?? '').join('');
}

function parseJson<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in model output');
  return JSON.parse(m[0]) as T;
}

const EXTRACT_SYSTEM = `You turn an Azerbaijani farmer's WhatsApp voice-note transcript into a produce listing.
Return ONLY JSON: {"product": English name or null, "variety": string or null, "grade": 1|2|3 or null,
"qtyKg": number or null, "priceAzn": price per kg in manat or null (1 manat = 100 qəpik),
"harvestDate": "YYYY-MM-DD" or null, "transcriptEn": faithful English translation,
"confidence": {"product":0-1,"qtyKg":0-1,"priceAzn":0-1,"grade":0-1,"harvest":0-1}}.
Never invent values that were not said; use null.`;

export async function extractListing(az: string, todayIso: string, offline: boolean): Promise<{ data: Extracted; mode: Mode }> {
  const key = hash('extract', az, todayIso.slice(0, 10));
  const cached = cacheGet<Extracted>(key);
  if (cached) return { data: cached, mode: 'cached' };
  if (!offline && hasClaude()) {
    const text = await claude(EXTRACT_SYSTEM, [{ type: 'text', text: `Today is ${todayIso.slice(0, 10)} (${new Date(todayIso).toLocaleDateString('en-GB', { weekday: 'long' })}).\nTranscript:\n${az}` }]);
    const j = parseJson<{ product?: string; variety?: string; grade?: 1 | 2 | 3; qtyKg?: number; priceAzn?: number; harvestDate?: string; transcriptEn?: string; confidence?: Record<string, number> }>(text);
    const data: Extracted = {
      product: j.product ?? undefined, variety: j.variety ?? undefined, grade: j.grade ?? undefined, qtyKg: j.qtyKg ?? undefined,
      priceAzn: j.priceAzn ?? undefined, harvest: j.harvestDate ?? undefined, transcriptEn: j.transcriptEn, confidence: j.confidence ?? {},
    };
    cachePut(key, data);
    return { data, mode: 'live' };
  }
  return { data: offlineExtract(az, todayIso), mode: 'mock' };
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
Tomato ripeness uses six stages: 1 Green, 2 Breaker, 3 Turning, 4 Pink, 5 Light red, 6 Red.
Return ONLY JSON: {"product": English name, "ripeness": 1-6 (dominant stage), "confidence": 0-1,
"defects": [short strings, e.g. "cracked skin on a few fruit"], "spoiled": true if rot, mould or heavy damage is visible,
"note": one short sentence for a buyer}. Be conservative: if unsure, lower confidence.`;

export async function inspectPhoto(image: Buffer | undefined, mime: string, opts: { offline: boolean; hintStage?: number; hintSpoiled?: boolean }): Promise<{ data: Inspection; mode: Mode }> {
  const scripted = (): Inspection => ({
    product: 'Tomato',
    ripeness: opts.hintStage ?? 4,
    confidence: opts.hintStage ? 0.88 : 0.6,
    defects: opts.hintSpoiled ? ['Mould and split fruit visible'] : [],
    spoiled: !!opts.hintSpoiled,
    note: opts.hintSpoiled ? 'Visible mould on several fruit.' : 'Even colour, firm, no visible damage.',
  });
  if (!image || mime.includes('svg')) return { data: scripted(), mode: 'mock' };
  const key = hash('inspect', image);
  const cached = cacheGet<Inspection>(key);
  if (cached) return { data: cached, mode: 'cached' };
  if (!opts.offline && hasClaude()) {
    const text = await claude(INSPECT_SYSTEM, [
      { type: 'image', source: { type: 'base64', media_type: mime.includes('png') ? 'image/png' : mime.includes('webp') ? 'image/webp' : 'image/jpeg', data: image.toString('base64') } },
      { type: 'text', text: 'Inspect this produce photo.' },
    ]);
    const data = parseJson<Inspection>(text);
    data.ripeness = Math.max(1, Math.min(6, Math.round(Number(data.ripeness) || 4)));
    data.defects = data.defects ?? [];
    cachePut(key, data);
    return { data, mode: 'live' };
  }
  return { data: scripted(), mode: 'mock' };
}

export type Intent = 'accept' | 'decline' | 'cancel' | 'rating' | 'listing' | 'other';

export function offlineIntent(text: string): { intent: Intent; stars?: number } {
  const t = text.trim().toLocaleLowerCase('az');
  if (/^[1-5]$/.test(t)) return { intent: 'rating', stars: Number(t) };
  if (/(qəbul|bəli|^hə\b|razıyam|təsdiq)/.test(t)) return { intent: 'accept' };
  if (/(imtina|ləğv|göndərə bilmirəm|verə bilmirəm|olmayacaq|dolu|xarab oldu|bağışlayın)/.test(t)) return { intent: 'cancel' };
  if (/(kilo|kq|manat|pomidor|xiyar|alma|kartof)/.test(t)) return { intent: 'listing' };
  return { intent: 'other' };
}

export async function classifyIntent(text: string, context: string, offline: boolean): Promise<{ intent: Intent; cause?: string; en?: string; mode: Mode }> {
  const quick = offlineIntent(text);
  if (quick.intent !== 'other' && quick.intent !== 'listing' && quick.intent !== 'cancel') return { intent: quick.intent, mode: 'mock' };
  const key = hash('intent', text, context);
  const cached = cacheGet<{ intent: Intent; cause?: string; en?: string }>(key);
  if (cached) return { ...cached, mode: 'cached' };
  if (!offline && hasClaude()) {
    const out = await claude(
      `Classify an Azerbaijani farmer's WhatsApp message for a produce marketplace. Context: ${context}.
Return ONLY JSON: {"intent": "accept"|"decline"|"cancel"|"listing"|"other", "cause": short English reason if cancelling else null, "en": English translation}.`,
      [{ type: 'text', text }],
      300,
    );
    const j = parseJson<{ intent: Intent; cause?: string; en?: string }>(out);
    cachePut(key, j);
    return { ...j, mode: 'live' };
  }
  const known = Object.values(DEMO_VOICE).find((d) => d.az === text);
  const cause = quick.intent === 'cancel' ? (/dolu/.test(text.toLocaleLowerCase('az')) ? 'Hail damaged the crop' : 'Farmer cannot deliver') : undefined;
  return { intent: quick.intent, cause, en: known?.en, mode: 'mock' };
}

// ---------- Media storage ----------

const MEDIA_DIR = path.join(DATA_DIR, 'media');

export function saveMedia(buf: Buffer, mime: string): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('webm') ? 'webm' : mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'm4a' : mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('svg') ? 'svg' : 'jpg';
  const id = `${hash('media', buf)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, id), buf);
  return `/api/media/${id}`;
}

export function readMedia(id: string): { buf: Buffer; mime: string } | undefined {
  if (!/^[a-f0-9]{24}\.[a-z0-9]+$/.test(id)) return undefined;
  try {
    const buf = fs.readFileSync(path.join(MEDIA_DIR, id));
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
