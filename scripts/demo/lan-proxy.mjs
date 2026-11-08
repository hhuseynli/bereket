// HTTPS front door for phones on the same Wi-Fi: https://<laptop-ip>:3443 → http://127.0.0.1:3000.
// Phones need HTTPS for the microphone. The app still listens on 127.0.0.1 only; requests that come through here
// carry forwarding headers, so the app treats them as remote and requires the presenter token (in the QR link).
// Started and stopped by `npm run demo:phone`.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [certFile, keyFile, port = '3443', target = '3000'] = process.argv.slice(2);
const server = https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, (req, res) => {
  const headers = {
    ...req.headers,
    'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', '),
    'x-forwarded-proto': 'https',
    'x-forwarded-host': req.headers.host ?? '',
  };
  const up = http.request({ host: '127.0.0.1', port: Number(target), method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res); // streams Server-Sent Events as they come
  });
  up.on('error', (err) => {
    console.error('upstream error', req.method, req.url, err.code ?? err.message);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('BƏRƏKƏT is not running on the laptop (npm run demo:launch).');
  });
  req.pipe(up);
  // Stop the upstream request only if the phone goes away before the answer is complete (e.g. a closed SSE stream).
  res.on('close', () => { if (!res.writableFinished) up.destroy(); });
});
server.keepAliveTimeout = 65_000;
server.listen(Number(port), '0.0.0.0', () => console.log(`lan proxy https://0.0.0.0:${port} -> 127.0.0.1:${target}`));
