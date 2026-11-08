// Access control for when the app is reachable through a public tunnel.
// The server listens on 127.0.0.1 only, so a request is local only when its Host is loopback and every
// forwarded address is loopback (Next.js itself adds x-forwarded-for: 127.0.0.1; ngrok appends the real
// client address; cloudflared always adds cf-connecting-ip). Anything else came through the tunnel. Those requests need the presenter token (DEMO_ADMIN_TOKEN): open the app once with
// ?key=<token> and an httpOnly cookie is set. The Twilio webhooks are exempt: they check Twilio's signature.
import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'berekat_admin';
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

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (pathname === '/api/twilio' || pathname === '/api/twilio/status') return NextResponse.next();
  // Voice-note clips: Twilio downloads them; their ids are unguessable (keyed with a secret).
  if (/^\/api\/voice\/[a-f0-9]{32}\.ogg$/.test(pathname)) return NextResponse.next();
  if (process.env.DEMO_PUBLIC_ACCESS === '1' || isLocal(req)) return NextResponse.next();

  const token = process.env.DEMO_ADMIN_TOKEN ?? '';
  const key = searchParams.get('key');
  if (token.length >= 16 && key && same(key, token)) {
    // Redirect on the tunnel's public host (nextUrl holds the internal 127.0.0.1 address).
    const params = new URLSearchParams(searchParams);
    params.delete('key');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() || 'https';
    const res = NextResponse.redirect(`${proto}://${host}${pathname}${params.size ? `?${params}` : ''}`, 307);
    res.cookies.set(COOKIE, token, { httpOnly: true, secure: proto === 'https', sameSite: 'lax', path: '/', maxAge: 12 * 3600 });
    return res;
  }
  const cookie = req.cookies.get(COOKIE)?.value ?? '';
  if (token.length >= 16 && same(cookie, token)) return NextResponse.next();

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'presenter token required' }, { status: 401 });
  return new NextResponse('BƏRƏKƏT demo: presenter access only. Open the link printed by npm run demo:tunnel.', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
