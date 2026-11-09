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
// English replies: the same voice by default (a local farmer's assistant speaking English); TTS_VOICE_ID_EN to change it.
export const TTS_VOICE_EN = () => process.env.TTS_VOICE_ID_EN || TTS_VOICE();
export const TTS_MODEL = () => process.env.TTS_MODEL || 'eleven_v4_turbo';
export const ttsAvailable = () => !!process.env.ELEVENLABS_API_KEY && process.env.TTS_REPLIES !== '0';
const TIMEOUT_S = () => Number(process.env.TTS_TIMEOUT_MS ?? 25_000) / 1000;
// MP3 plays everywhere, including iPhone Safari (which is unreliable with OGG/Opus). TTS_FORMAT=ogg for Opus.
const FORMAT = () => (process.env.TTS_FORMAT === 'ogg' ? { ext: 'ogg', api: 'opus_48000_64' as const } : { ext: 'mp3', api: 'mp3_44100_64' as const });

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

/** English voice notes: units read out, the manat sign as a word. */
export function spokenEn(text: string): string {
  return text
    .replace(/[*_~`#]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/(\d+(?:[.,]\d+)?)\s*₼\s*\/\s*(kg|kq)/g, '$1 manat per kilo')
    .replace(/(\d+(?:[.,]\d+)?)\s*₼/g, '$1 manat')
    .replace(/(\d+)\s*(kg|kq)\b/g, '$1 kilos')
    .replace(/\b(\d)\/6\b/g, 'stage $1')
    .replace(/\s×\s/g, ' at ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What the voice note says for a message: plain text as is, a card as one natural paragraph. */
export function speechFor(m: Pick<Message, 'text' | 'card'>, lang: 'az' | 'en' = 'az'): string {
  if (lang === 'en') {
    if (!m.card) return spokenEn(m.text ?? '');
    const row = (k: string) => m.card!.rows.find(([key]) => key === k)?.[1];
    if (m.card.title === 'Your listing is ready') {
      const ripe = row('Ripeness');
      return spokenEn([m.text, `Your listing is ready: ${row('Quantity')} of ${row('Product')?.replace(/\s*\(Local\)/, '')}, at ${row('Price')}.`,
        ripe && !/photo/.test(ripe) ? `Ripeness: ${ripe}.` : '', 'If it is right, say "yes" or reply 1. You can also tell me what to change.'].filter(Boolean).join(' '));
    }
    if (m.card.title === 'New order') {
      return spokenEn(`New order! ${row('Buyer')} wants ${row('Quantity')}, ${row('Total')} in total. Pickup ${row('Pickup')}. ${m.text ?? ''} To accept, say "accept" or reply 1; to decline, reply 2.`);
    }
    return spokenEn([m.card.title + '.', ...m.card.rows.map(([k, v]) => `${k}: ${v}.`), m.text ?? ''].join(' '));
  }
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
export function clipId(spoken: string, lang: 'az' | 'en' = 'az'): string {
  const secret = process.env.DEMO_ADMIN_TOKEN || process.env.ELEVENLABS_API_KEY || 'berekat';
  // Azerbaijani clips keep their original ids (already cached); English ones add the language and voice.
  const key = lang === 'en' ? `${TTS_MODEL()}|${TTS_VOICE_EN()}|en|${spoken}` : `${TTS_MODEL()}|${TTS_VOICE()}|${spoken}`;
  return crypto.createHmac('sha256', secret).update(key).digest('hex').slice(0, 32);
}

export function readClip(id: string): { buf: Buffer; mime: string } | undefined {
  const m = id.match(/^[a-f0-9]{32}\.(ogg|mp3)$/);
  if (!m) return undefined;
  try {
    return { buf: fs.readFileSync(path.join(DIR(), id)), mime: m[1] === 'mp3' ? 'audio/mpeg' : 'audio/ogg' };
  } catch {
    return undefined;
  }
}

export interface Clip { id: string; url: string; mode: Mode; seconds?: number }

const gh = globalThis as unknown as { __ttsHealth?: { ok: boolean; at: string; detail: string } };
export const ttsHealth = () => gh.__ttsHealth;

export async function synthesize(spoken: string, aiMode: AiMode, lang: 'az' | 'en' = 'az'): Promise<Clip | undefined> {
  if (!spoken || aiMode === 'simulated') return undefined;
  const id = `${clipId(spoken, lang)}.${FORMAT().ext}`;
  const file = path.join(DIR(), id);
  if (fs.existsSync(file)) return { id, url: `/api/voice/${id}`, mode: 'cached' };
  if (aiMode !== 'live' || !ttsAvailable()) return undefined;
  try {
    const stream = await eleven().textToSpeech.convert(
      lang === 'en' ? TTS_VOICE_EN() : TTS_VOICE(),
      { text: spoken.slice(0, 1200), modelId: TTS_MODEL(), languageCode: lang, outputFormat: FORMAT().api },
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
