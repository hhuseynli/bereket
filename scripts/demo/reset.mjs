#!/usr/bin/env node
// npm run demo:reset — back to the start of Act 1: seeded listings, no orders, no recovered suppliers, ratings
// restored, intake cleared, demo clock at 14:00 on the demo day. Keeps keys, recordings and the AI cache.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, PORT, Report, director, healthy, state } from './lib.mjs';

const r = new Report('Reset to Act 1');
// Queued WhatsApp messages from a rehearsal must not replay into the next one.
const inbox = path.join(DATA, 'inbox');
const pending = fs.existsSync(inbox) ? fs.readdirSync(inbox).length : 0;
fs.rmSync(inbox, { recursive: true, force: true });
if (pending) r.pass('WhatsApp inbox', `${pending} queued message(s) cleared`);

if (await healthy(PORT)) {
  await director(PORT, 'reset');
  const s = await state(PORT);
  const checks = [
    ['Act', s.presenter.act.n === 1, `Act ${s.presenter.act.n}`],
    ['Orders', s.orders.length === 0, `${s.orders.length}`],
    ['Proposals', s.proposals.length === 0, `${s.proposals.length}`],
    ['Messages', s.messages.length === 0, `${s.messages.length}`],
    ['AI intake runs', s.aiRuns.length === 0, `${s.aiRuns.length}`],
    ["Elşən's tomato listing", !s.listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato'), 'not yet listed'],
    ['Tender T-1042', s.tenders.find((t) => t.id === 'T-1042')?.status === 'open', s.tenders.find((t) => t.id === 'T-1042')?.status],
    ['Ratings', s.farmers.find((f) => f.id === 'f-elsen')?.rating === 4.9 && s.buyers[0].rating === 4.8, 'seed values'],
    ['Demo clock', new Date(s.clock.base).toLocaleTimeString('en-GB', { timeZone: 'Asia/Baku', hour: '2-digit', minute: '2-digit' }) === '14:00', `${s.clock.base.slice(0, 10)} 14:00 Baku`],
  ];
  for (const [k, ok, d] of checks) ok ? r.pass(k, d) : r.fail(k, d);
  r.info('Modes kept', `AI ${s.settings.aiMode.toUpperCase()} · WhatsApp ${s.settings.channel}`);
} else {
  fs.rmSync(path.join(DATA, 'state-snapshot.json'), { force: true });
  r.pass('Saved state', 'cleared (server not running; the next launch starts at Act 1)');
}
console.log('\n  Browsers: press R, or reload, to return to the Buyer view.');
process.exit(r.summary() ? 0 : 1);
