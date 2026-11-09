// Who is asking: the presenter (local, or the presenter token), a farmer who signed up from the join QR, or
// someone holding the join code. The middleware decides and passes the result on in x-berekat-role; routes read
// it with roleOf(). Tokens are HMACs keyed with DEMO_ADMIN_TOKEN, so they cannot be made without the server.
import crypto from 'node:crypto';

const secret = () => process.env.DEMO_ADMIN_TOKEN || 'berekat-dev';
const mac = (msg: string) => crypto.createHmac('sha256', secret()).update(msg).digest('hex');

/** The code printed in the join QR (same value the middleware computes). */
export const joinCode = () => mac('join').slice(0, 12);

/** Cookie value that lets a signed-up farmer into their own chat only. */
export const farmerToken = (farmerId: string) => `${farmerId}.${mac(`farmer:${farmerId}`).slice(0, 32)}`;

export type Role = { kind: 'admin' } | { kind: 'farmer'; farmerId: string } | { kind: 'join' } | { kind: 'none' };

export function roleOf(req: Request): Role {
  const r = req.headers.get('x-berekat-role') ?? '';
  if (r === 'admin') return { kind: 'admin' };
  if (r.startsWith('farmer:')) return { kind: 'farmer', farmerId: r.slice(7) };
  if (r === 'join') return { kind: 'join' };
  return { kind: 'none' };
}

export const FARMER_COOKIE = 'berekat_farmer';
export const JOIN_COOKIE = 'berekat_join';
