// Twilio WhatsApp plumbing that does not touch demo state: webhook signatures, the public URL Twilio sees,
// the farmer allowlist, and safe media downloads.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { dataDir } from './paths';

export const twilioConfigured = () => !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN;

/** The public HTTPS base URL (tunnel) that Twilio calls. PUBLIC_BASE_URL wins, then the file written by `npm run demo:tunnel`. */
export function publicBaseUrl(): string | undefined {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  try {
    const j = JSON.parse(fs.readFileSync(dataDir('tunnel.json'), 'utf8')) as { url?: string };
    return j.url?.replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

/** Twilio's request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function twilioSignature(authToken: string, url: string, params: URLSearchParams): string {
  const keys = Array.from(new Set(params.keys())).sort();
  let data = url;
  for (const k of keys) for (const v of params.getAll(k).sort()) data += k + v;
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Behind a tunnel the request reaches us as http://127.0.0.1:3000/..., but Twilio signed the public https URL.
 * Try the configured public URL first, then the URL rebuilt from the forwarding headers.
 */
export function candidateUrls(req: Request): string[] {
  const u = new URL(req.url);
  const tail = u.pathname + u.search;
  const out: string[] = [];
  const base = publicBaseUrl();
  if (base) out.push(base + tail);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
    out.push(`${proto}://${host}${tail}`, `https://${host}${tail}`);
  }
  return Array.from(new Set(out));
}

export function validateTwilioRequest(req: Request, params: URLSearchParams): { ok: boolean; reason?: string } {
  if (process.env.TWILIO_VALIDATE_SIGNATURE === '0') return { ok: true, reason: 'validation disabled' };
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return { ok: false, reason: 'TWILIO_AUTH_TOKEN not set' };
  const sig = req.headers.get('x-twilio-signature');
  if (!sig) return { ok: false, reason: 'missing X-Twilio-Signature' };
  for (const url of candidateUrls(req)) if (safeEqual(twilioSignature(token, url, params), sig)) return { ok: true };
  return { ok: false, reason: 'signature mismatch (check the webhook URL matches the tunnel URL)' };
}

/** FARMER_PHONES="f-elsen=+99450...,f-rauf=+99455..." → { '+99450...': 'f-elsen' } */
export function phoneMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.FARMER_PHONES ?? '').split(',')) {
    const [id, phone] = pair.split('=').map((x) => x?.trim());
    if (id && phone && /^\+\d{8,15}$/.test(phone)) m.set(phone, id);
  }
  return m;
}

export const maskPhone = (p?: string) => (p ? `${p.slice(0, 6)}•••${p.slice(-2)}` : undefined);

// ---------- Media ----------

const AUDIO = ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/webm', 'audio/amr'];
const IMAGE = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_AUDIO = () => Number(process.env.MEDIA_MAX_AUDIO_MB ?? 16) * 1024 * 1024;
const MAX_IMAGE = () => Number(process.env.MEDIA_MAX_IMAGE_MB ?? 8) * 1024 * 1024;

export function mediaKind(mime: string): 'audio' | 'image' | undefined {
  const base = mime.split(';')[0].trim().toLowerCase();
  if (AUDIO.includes(base)) return 'audio';
  if (IMAGE.includes(base)) return 'image';
  return undefined;
}

/** Download one Twilio media item with the account's credentials. Only api.twilio.com URLs are fetched. */
export async function downloadTwilioMedia(url: string, mime: string): Promise<Buffer> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)twilio\.com$/.test(u.hostname)) throw new Error(`refusing media URL on ${u.hostname}`);
  const kind = mediaKind(mime);
  if (!kind) throw new Error(`unsupported media type ${mime}`);
  const max = kind === 'audio' ? MAX_AUDIO() : MAX_IMAGE();
  const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const auth = 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN ?? ''}`).toString('base64');
  // Node's fetch drops the Authorization header when Twilio redirects to its media CDN.
  const res = await fetch(url, { headers: { Authorization: auth }, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > max) throw new Error(`media too large (${Math.round(len / 1e6)} MB)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error(`media too large (${Math.round(buf.length / 1e6)} MB)`);
  if (buf.length < 100) throw new Error('media empty');
  return buf;
}
