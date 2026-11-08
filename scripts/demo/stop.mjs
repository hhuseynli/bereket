#!/usr/bin/env node
// npm run demo:stop [-- --keep-tunnel] — stop the presenter's server (and the tunnel).
import fs from 'node:fs';
import path from 'node:path';
import { DATA, args, stopPid } from './lib.mjs';

const a = args();
console.log((await stopPid('server')) ? 'Server stopped.' : 'No server was running (from demo:launch).');
console.log((await stopPid('phone')) ? 'Phone access stopped.' : 'Phone access was not running.');
fs.rmSync(path.join(DATA, 'phone.json'), { force: true });
if (!a['keep-tunnel']) {
  const t = await stopPid('tunnel');
  fs.rmSync(path.join(DATA, 'tunnel.json'), { force: true });
  console.log(t ? 'Tunnel stopped.' : 'No tunnel was running.');
}
