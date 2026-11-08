// Spoken replies: every message the assistant sends a farmer can also arrive as an Azerbaijani voice note
// (ElevenLabs, a native Azerbaijani voice), for farmers who prefer listening to reading. The text is sent at
// once; the voice note follows when it is ready, so a slow network never holds up the conversation.
// Clips are cached by text, so a phrase is only paid for once; CACHED mode only replays existing clips and
// SIMULATED mode makes none.
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AiMode, Mode } from './ai';
import { dataDir } from './paths';
import type { Message } from './types';

export const TTS_VOICE = () => process.env.TTS_VOICE_ID || 'BQgh92MxG7QAtCA8wY7O'; // "Ibrahim Mammadli", native Azerbaijani, conversational
export const TTS_MODEL = () => process.env.TTS_MODEL || 'eleven_v4_turbo';
export const ttsAvailable = () => !!process.env.ELEVENLABS_API_KEY && process.env.TTS_REPLIES !== '0';
const TIMEOUT_S = () => Number(process.env.TTS_TIMEOUT_MS ?? 25_000) / 1000;

// ---------- Azerbaijani numbers and money in words ----------

const ONES = ['', 'bir', 'iki', 'üç', 'dörd', 'beş', 'altı', 'yeddi', 'səkkiz', 'doqquz'];
const TENS = ['', 'on', 'iyirmi', 'otuz', 'qırx', 'əlli', 'altmış', 'yetmiş', 'səksən', 'doxsan'];

export function numAz(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'sıfır';
  const under1000 = (x: number) => {
    const h = Math.floor(x / 100);
    const rest = x % 100;
    return [h ? `${h === 1 ? '' : `${ONES[h]} `}yüz` : '', TENS[Math.floor(rest / 10)], ONES[rest % 10]].filter(Boolean).join(' ');
  };
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  return [th ? `${th === 1 ? '' : `${under1000(th)} `}min` : '', rest ? under1000(rest) : ''].filter(Boolean).join(' ').trim();
}

export function moneyAz(v: number): string {
  const m = Math.floor(v + 1e-9);
  const q = Math.round((v - m) * 100);
  if (!m) return `${numAz(q)} qəpik`;
  return `${numAz(m)} manat${q ? ` ${numAz(q)} qəpik` : ''}`;
}

/** Text as it should be spoken: money, kilos, times and digits in words; symbols and markup removed. */
export function spokenAz(text: string): string {
  return text
    .replace(/\*/g, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*₼(?:\s*\/\s*kq)?/g, (_, n) => moneyAz(parseFloat(n.replace(',', '.'))))
    .replace(/(\d+(?:[.,]\d+)?)\s*(manat|AZN)\b/gi, (_, n) => moneyAz(parseFloat(n.replace(',', '.'))))
    .replace(/(\d+)\s*kq\b/g, (_, n) => `${numAz(Number(n))} kilo`)
    .replace(/(\d+)\s*kilo/g, (_, n) => `${numAz(Number(n))} kilo`)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h, m) => `saat ${numAz(Number(h))}${m === '00' ? '' : ` ${numAz(Number(m))}`}`)
    .replace(/\b(\d)\/6,?\s*/g, '')
    .replace(/\s×\s/g, ', kilosu ')
    .replace(/\d+[.,]\d+/g, (x) => x.replace(/[.,]/, ' tam '))
    .replace(/\d+/g, (x) => numAz(Number(x)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the voice note says for a message: plain text as is, a card as one natural paragraph. */
export function speechFor(m: Pick<Message, 'text' | 'card'>): string {
  if (!m.card) return spokenAz(m.text ?? '');
  const row = (k: string) => m.card!.rows.find(([key]) => key === k)?.[1];
  let s: string;
  if (m.card.title === 'Elanınız hazırdır') {
    const ripe = row('Yetişmə');
    s = [
      m.text,
      `Elanınız hazırdır: ${row('Miqdar')} ${row('Məhsul')?.replace(/\s*\(Local\)/, '')}, ${row('Qiymət')}.`,
      ripe && !/şəkil/.test(ripe) ? `Yetişmə: ${ripe}.` : '',
      'Düzdürsə "bəli" deyin və ya bir yazın. Dəyişmək istədiyinizi də deyə bilərsiniz.',
    ].filter(Boolean).join(' ');
  } else if (m.card.title === 'Yeni sifariş') {
    s = `Yeni sifariş! ${row('Alıcı')} sizdən ${row('Miqdar')} alır, cəmi ${row('Məbləğ')}. Yığım ${row('Yığım')}. ${m.text ?? ''} Qəbul edirsinizsə "qəbul" deyin və ya bir yazın, imtina üçün iki.`;
  } else {
    s = [m.card.title + '.', ...m.card.rows.map(([k, v]) => `${k}: ${v}.`), m.text ?? ''].join(' ');
  }
  return spokenAz(s);
}

// ---------- Synthesis and storage ----------

let client: ElevenLabsClient | undefined;
const eleven = () => (client ??= new ElevenLabsClient());
const DIR = () => dataDir('tts');

/** Clip ids are keyed with a secret, so a URL cannot be guessed from the text (Twilio fetches them unauthenticated). */
export function clipId(spoken: string): string {
  const secret = process.env.DEMO_ADMIN_TOKEN || process.env.ELEVENLABS_API_KEY || 'berekat';
  return crypto.createHmac('sha256', secret).update(`${TTS_MODEL()}|${TTS_VOICE()}|${spoken}`).digest('hex').slice(0, 32);
}

export function readClip(id: string): Buffer | undefined {
  if (!/^[a-f0-9]{32}\.ogg$/.test(id)) return undefined;
  try {
    return fs.readFileSync(path.join(DIR(), id));
  } catch {
    return undefined;
  }
}

export interface Clip { id: string; url: string; mode: Mode; seconds?: number }

const gh = globalThis as unknown as { __ttsHealth?: { ok: boolean; at: string; detail: string } };
export const ttsHealth = () => gh.__ttsHealth;

export async function synthesize(spoken: string, aiMode: AiMode): Promise<Clip | undefined> {
  if (!spoken || aiMode === 'simulated') return undefined;
  const id = `${clipId(spoken)}.ogg`;
  const file = path.join(DIR(), id);
  if (fs.existsSync(file)) return { id, url: `/api/voice/${id}`, mode: 'cached' };
  if (aiMode !== 'live' || !ttsAvailable()) return undefined;
  try {
    const stream = await eleven().textToSpeech.convert(
      TTS_VOICE(),
      { text: spoken.slice(0, 1200), modelId: TTS_MODEL(), languageCode: 'az', outputFormat: 'opus_48000_64' },
      { timeoutInSeconds: TIMEOUT_S(), maxRetries: 1 },
    );
    const buf = Buffer.from(await new Response(stream as ReadableStream).arrayBuffer());
    if (buf.length < 500) throw new Error('empty audio');
    fs.mkdirSync(DIR(), { recursive: true });
    fs.writeFileSync(file, buf);
    gh.__ttsHealth = { ok: true, at: new Date().toISOString(), detail: `${TTS_MODEL()} ${buf.length} bytes` };
    return { id, url: `/api/voice/${id}`, mode: 'live' };
  } catch (err) {
    gh.__ttsHealth = { ok: false, at: new Date().toISOString(), detail: (err as Error).message.slice(0, 160) };
    console.error('[tts] failed:', (err as Error).message);
    return undefined;
  }
}
