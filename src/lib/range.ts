// Serve a file with HTTP byte ranges. iPhone Safari only plays <audio> when the server answers Range requests
// with 206 Partial Content.
export function rangeResponse(req: Request, buf: Buffer, mime: string): Response {
  const headers: Record<string, string> = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=86400' };
  const m = (req.headers.get('range') ?? '').match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (!m[1] && !m[2])) return new Response(new Uint8Array(buf), { headers: { ...headers, 'Content-Length': String(buf.length) } });
  let start = m[1] ? Number(m[1]) : Math.max(0, buf.length - Number(m[2]));
  let end = m[1] && m[2] ? Number(m[2]) : buf.length - 1;
  end = Math.min(end, buf.length - 1);
  if (start > end || start >= buf.length) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${buf.length}` } });
  start = Math.max(0, start);
  return new Response(new Uint8Array(buf.subarray(start, end + 1)), {
    status: 206,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': String(end - start + 1) },
  });
}
