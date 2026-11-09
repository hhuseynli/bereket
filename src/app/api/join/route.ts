import { FARMER_COOKIE, farmerToken, roleOf } from '@/lib/access';
import { CITIES } from '@/lib/map-features';
import { createFarmer, setFarmerLang } from '@/lib/flows';
import { getState } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Places a farmer can pick when signing up (district centres), and whether they already have an account. */
export function GET(req: Request) {
  const role = roleOf(req);
  const me = role.kind === 'farmer' ? getState().farmers.find((f) => f.id === role.farmerId) : undefined;
  return Response.json({
    places: CITIES.filter((c) => c.rank <= 3).map((c) => c.name).sort((a, b) => a.localeCompare(b, 'az')),
    farmerId: me?.id,
  });
}

/** Create the account (join code holders), or change the chat language (a signed-up farmer). */
export async function POST(req: Request) {
  const role = roleOf(req);
  const b = (await req.json().catch(() => ({}))) as { name?: string; place?: string; lang?: string };
  const lang = b.lang === 'en' ? 'en' : 'az';
  if (role.kind === 'farmer') {
    setFarmerLang(role.farmerId, lang);
    return Response.json({ farmerId: role.farmerId });
  }
  // The presenter switching a demo farmer's chat language from the laptop or a demo phone.
  const target = (b as { farmerId?: string }).farmerId;
  if (role.kind === 'admin' && target) {
    setFarmerLang(target, lang);
    return Response.json({ farmerId: target });
  }
  if (role.kind !== 'join' && role.kind !== 'admin') return Response.json({ error: 'scan the join QR first' }, { status: 401 });
  try {
    const farmerId = createFarmer({ name: String(b.name ?? ''), place: String(b.place ?? ''), lang });
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim();
    const res = Response.json({ farmerId });
    res.headers.append('Set-Cookie', `${FARMER_COOKIE}=${farmerToken(farmerId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 3600}${proto === 'https' ? '; Secure' : ''}`);
    return res;
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
