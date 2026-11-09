export const dynamic = 'force-dynamic';

/** For the host's health check (no token needed, no data). */
export function GET() {
  return Response.json({ ok: true });
}
