import fs from 'node:fs';
import QRCode from 'qrcode';
import { joinCode, roleOf } from '@/lib/access';
import { dataDir } from '@/lib/paths';
import { getState } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PHONES = ['f-elsen', 'f-rauf', 'f-sebine', 'f-gulnare'];
const qr = (url: string) => QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
const alive = (pid?: number) => { try { return !!pid && process.kill(pid, 0); } catch { return false; } };
const read = (name: string) => { try { return JSON.parse(fs.readFileSync(dataDir(name), 'utf8')); } catch { return undefined; } };

// The join QR (anyone may create a farmer account with it), through the public tunnel when it runs and on the
// local network otherwise; the presenter's per-farmer demo links; and who has signed up. The demo links carry
// the presenter token, so this route is only reachable from the laptop itself or with that token.
export async function GET(req: Request) {
  const admin = roleOf(req).kind === 'admin';
  const tunnel = read('tunnel.json') as { url?: string; pid?: number } | undefined;
  const lan = read('phone.json') as { base?: string; ip?: string; fallback?: string; mode?: string } | undefined;
  const code = joinCode();
  const token = process.env.DEMO_ADMIN_TOKEN ?? '';
  const s = getState();

  const join: { kind: 'internet' | 'wifi' | 'wifi-ip'; url: string; svg: string }[] = [];
  // Hosted (Render sets RENDER_EXTERNAL_URL): the public address is the app itself.
  const hosted = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  if (hosted) join.push({ kind: 'internet', url: `${hosted}/join?c=${code}`, svg: await qr(`${hosted}/join?c=${code}`) });
  else if (tunnel?.url && alive(tunnel.pid)) join.push({ kind: 'internet', url: `${tunnel.url}/join?c=${code}`, svg: await qr(`${tunnel.url}/join?c=${code}`) });
  if (lan?.base && lan.mode !== 'tunnel') {
    join.push({ kind: 'wifi', url: `${lan.base}/join?c=${code}`, svg: await qr(`${lan.base}/join?c=${code}`) });
    if (lan.fallback) join.push({ kind: 'wifi-ip', url: `${lan.fallback}/join?c=${code}`, svg: await qr(`${lan.fallback}/join?c=${code}`) });
  }
  const demoBase = hosted || (tunnel?.url && alive(tunnel.pid) ? tunnel.url : lan?.base);
  // The demo-farmer links carry the presenter token: only for the presenter.
  const demo = demoBase && admin
    ? await Promise.all(PHONES.map(async (id) => ({ farmerId: id, name: s.farmers.find((f) => f.id === id)?.name ?? id, svg: await qr(`${demoBase}/wa/${id}?key=${token}`) })))
    : [];
  const signups = s.farmers.filter((f) => f.selfSignup).map((f) => {
    const mine = s.messages.filter((m) => m.farmerId === f.id);
    const last = [...mine].reverse().find((m) => m.dir === 'in');
    return {
      id: f.id, name: f.name, village: f.village, lang: f.lang ?? 'az', at: f.selfSignup!,
      messages: mine.filter((m) => m.dir === 'in').length,
      listings: s.listings.filter((l) => l.farmerId === f.id && l.status !== 'withdrawn').length,
      last: last ? (last.kind === 'voice' ? `🎤 ${last.transcript ?? ''}` : last.kind === 'photo' ? '📷' : last.text ?? '') : '',
    };
  }).reverse();
  return Response.json({ join, demo, signups, tunnel: !!hosted || !!(tunnel?.url && alive(tunnel.pid)), wifi: !!lan?.base });
}
