// Access control for when the app is reachable from outside the laptop (LAN relay or a public tunnel).
// The server listens on 127.0.0.1 only, so a request is local only when its Host is loopback and every
// forwarded address is loopback (Next.js itself adds x-forwarded-for: 127.0.0.1; ngrok appends the real
// client address; cloudflared always adds cf-connecting-ip). Anything else came from outside. Three ways in:
//  - the presenter token (DEMO_ADMIN_TOKEN): open the app once with ?key=<token>, an httpOnly cookie is set;
//  - the join QR (/join?c=<code>): anyone with it may create a farmer account, and nothing else;
//  - a farmer account: a signed cookie that opens that farmer's own chat (/wa/<id>) and its APIs only.
// The decision is passed to routes in x-berekat-role (any incoming value is overwritten).
// The Twilio webhooks are exempt: they check Twilio's signature.
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'berekat_admin';
const FARMER_COOKIE = 'berekat_farmer';
const JOIN_COOKIE = 'berekat_join';
const TUNNEL_HEADERS = ['cf-connecting-ip', 'cf-ray', 'x-real-ip', 'forwarded', 'ngrok-trace-id'];
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1', '::ffff:127.0.0.1'];

function hostnameOf(host: string) {
  const h = host.toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0];
}

function isLocal(req: NextRequest): boolean {
  if (!LOOPBACK.includes(hostnameOf(req.headers.get('host') ?? ''))) return false;
  const fwdHost = req.headers.get('x-forwarded-host');
  if (fwdHost && !LOOPBACK.includes(hostnameOf(fwdHost))) return false;
  const xff = req.headers.get('x-forwarded-for');
  if (xff && !xff.split(',').every((ip) => LOOPBACK.includes(ip.trim()))) return false;
  return !TUNNEL_HEADERS.some((h) => req.headers.has(h));
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function hmac(msg: string) {
  const secret = process.env.DEMO_ADMIN_TOKEN || 'berekat-dev';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

function pass(req: NextRequest, role: string, res?: NextResponse) {
  const headers = new Headers(req.headers);
  headers.set('x-berekat-role', role);
  const out = NextResponse.next({ request: { headers } });
  res?.cookies.getAll().forEach((c) => out.cookies.set(c));
  return out;
}

function publicOrigin(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
  return { origin: `${proto}://${host}`, secure: proto === 'https' };
}

export async function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname === '/api/twilio' || pathname === '/api/twilio/status' || pathname === '/api/health') return NextResponse.next();
  // Voice-note clips: Twilio downloads them; their ids are unguessable (keyed with a secret).
  if (/^\/api\/voice\/[a-f0-9]{32}\.(ogg|mp3)$/.test(pathname)) return NextResponse.next();
  if (process.env.DEMO_PUBLIC_ACCESS === '1' || isLocal(req)) return pass(req, 'admin');

  const token = process.env.DEMO_ADMIN_TOKEN ?? '';
  const { origin, secure } = publicOrigin(req);
  const key = searchParams.get('key');
  if (token.length >= 16 && key && same(key, token)) {
    // Redirect on the public host (nextUrl holds the internal 127.0.0.1 address).
    const params = new URLSearchParams(searchParams);
    params.delete('key');
    const res = NextResponse.redirect(`${origin}${pathname}${params.size ? `?${params}` : ''}`, 307);
    res.cookies.set(COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 12 * 3600 });
    return res;
  }
  const cookie = req.cookies.get(COOKIE)?.value ?? '';
  if (token.length >= 16 && same(cookie, token)) return pass(req, 'admin');

  // A farmer who signed up from the join QR: their own chat and the APIs behind it.
  const ft = req.cookies.get(FARMER_COOKIE)?.value ?? '';
  const dot = ft.lastIndexOf('.');
  if (dot > 0) {
    const id = ft.slice(0, dot);
    if (/^f-[a-z0-9-]{3,40}$/.test(id) && same(ft.slice(dot + 1), (await hmac(`farmer:${id}`)).slice(0, 32))) {
      const own = `/wa/${id}`;
      if (pathname === own || pathname === '/api/state' || pathname === '/api/events' || pathname === '/api/phone'
        || pathname === '/api/join' || /^\/api\/media\/[\w.-]+$/.test(pathname) || pathname.startsWith('/demo/')) return pass(req, `farmer:${id}`);
      // anything else (the join page again, another chat, the presenter screens): back to their own chat
      if (!pathname.startsWith('/api/')) return NextResponse.redirect(`${origin}${own}`, 307);
      return NextResponse.json({ error: 'not allowed for a farmer account' }, { status: 403 });
    }
  }

  // The join QR: /join?c=<code> sets a cookie; with it, only the sign-up page and its API.
  const code = (await hmac('join')).slice(0, 12);
  const c = searchParams.get('c');
  if (pathname === '/join' && c && same(c, code)) {
    const res = NextResponse.redirect(`${origin}/join`, 307);
    res.cookies.set(JOIN_COOKIE, code, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 7 * 24 * 3600 });
    return res;
  }
  if (same(req.cookies.get(JOIN_COOKIE)?.value ?? '', code) && (pathname === '/join' || pathname === '/api/join' || pathname.startsWith('/demo/'))) return pass(req, 'join');

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'presenter token required' }, { status: 401 });
  return new NextResponse('BƏRƏKƏT: scan the join QR code to create your account. / Hesab yaratmaq üçün QR kodu skan edin.', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
