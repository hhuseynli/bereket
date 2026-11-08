import fs from 'node:fs';
import QRCode from 'qrcode';
import { dataDir } from '@/lib/paths';
import { getState } from '@/lib/store';

export const dynamic = 'force-dynamic';

const PHONES = ['f-elsen', 'f-rauf', 'f-sebine', 'f-gulnare'];

// Links and QR codes for phones on the local network (written by `npm run demo:phone`). The links carry the
// presenter token, so this route is only reachable from the laptop itself or by someone who already has it.
export async function GET() {
  let info: { base: string; ip: string };
  try {
    info = JSON.parse(fs.readFileSync(dataDir('phone.json'), 'utf8'));
  } catch {
    return Response.json({ running: false });
  }
  const token = process.env.DEMO_ADMIN_TOKEN ?? '';
  const farmers = getState().farmers;
  const links = await Promise.all(
    PHONES.map(async (id) => {
      const url = `${info.base}/wa/${id}?key=${token}`;
      return { farmerId: id, name: farmers.find((f) => f.id === id)?.name ?? id, url: `${info.base}/wa/${id}`, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
    }),
  );
  return Response.json({ running: true, base: info.base, ip: info.ip, links });
}
