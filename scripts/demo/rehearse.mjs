#!/usr/bin/env node
// npm run demo:rehearse [-- --size=1920x1080|1366x768|all] [-- --ai=cached|live|simulated] [-- --fast] [-- --headed] [-- --use-running]
// Plays the four acts in a real browser exactly as the presenter would (same keys and clicks), asserting the
// app state after each act, timing every step, and saving screenshots. By default it starts its own server
// on port 3100 with a scratch copy of the data (sharing the AI cache), so the presenter's app is untouched.
// --use-running rehearses against the app on port 3000 instead (it resets it first).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, PORT, Report, args, base, bold, cleanScratch, dim, director, ensureBuild, green, healthy, red, scratchDataDir, startServer, state, yellow } from './lib.mjs';

const BUDGET_S = 180;
const SLOW_WAIT_MS = 8000;

export async function rehearse({ port, size, outDir, headed = false, log = console.log }) {
  const { chromium } = await import('playwright-core');
  const [w, h] = size.split('x').map(Number);
  const browser = await chromium.launch({ channel: 'chrome', headless: !headed }).catch(() => chromium.launch({ headless: !headed }));
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  // Elşən's real phone: the WhatsApp-style page in a phone-sized browser (on stage: a phone via npm run demo:phone).
  const { devices } = await import('playwright-core');
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const phone = await phoneCtx.newPage();
  const url = base(port).replace('127.0.0.1', 'localhost');
  const result = { size, acts: [], steps: [], interactions: 0, issues: [], consoleErrors: [], externalRequests: [], ok: false, totalMs: 0 };
  page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 200)); });
  phone.on('pageerror', (e) => result.consoleErrors.push(`phone: ${e.message.slice(0, 200)}`));
  page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('request', (r) => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname)) result.externalRequests.push(u.hostname); });

  const t0 = Date.now();
  let act = 0;
  let actStart = t0;
  const S = () => state(port);

  async function stepDo(name, fn, { interactions = 1 } = {}) {
    const s0 = Date.now();
    try {
      await fn();
    } catch (e) {
      const shot = path.join(outDir, `${size}-FAILED-act${act}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      await phone.screenshot({ path: shot.replace('.png', '-phone.png') }).catch(() => {});
      throw new Error(`Act ${act}, "${name}": ${e.message.split('\n')[0]} (screenshot ${path.relative(process.cwd(), shot)})`);
    }
    const ms = Date.now() - s0;
    result.interactions += interactions;
    result.steps.push({ act, name, ms });
    const slow = ms > SLOW_WAIT_MS;
    if (slow) result.issues.push(`Act ${act}: "${name}" took ${(ms / 1000).toFixed(1)} s`);
    log(`    ${slow ? yellow('slow') : green(' ok ')}  ${name} ${dim(`${(ms / 1000).toFixed(1)} s`)}`);
  }
  const until = async (what, fn, timeout = 30_000) => {
    const s0 = Date.now();
    while (Date.now() - s0 < timeout) {
      try { if (await fn()) return; } catch { /* retry */ }
      await page.waitForTimeout(150);
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const key = async (k) => { await page.keyboard.press(k); };
  // The newest enabled reply button on Elşən's phone (older cards are disabled once answered).
  const tapPhone = async (label) => {
    const btn = () => phone.locator('button:not([disabled])', { hasText: new RegExp(`${label}$`) });
    await until(`"${label}" on the phone`, async () => (await btn().count()) > 0);
    await btn().last().click();
  };

  async function layoutCheck(label) {
    const m = await page.evaluate(() => {
      const de = document.documentElement;
      const main = document.querySelector('main');
      const phone = document.querySelector('aside[aria-label="Farmer phone"]');
      // Elements wider than their scroll container, i.e. clipped content.
      const clipped = [];
      for (const el of document.querySelectorAll('h1, h2, button, .chip')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > window.innerWidth + 1 || el.scrollWidth > el.clientWidth + 2) && getComputedStyle(el).overflow !== 'visible') clipped.push((el.textContent || '').trim().slice(0, 40));
        else if (r.width && r.right > window.innerWidth + 1) clipped.push((el.textContent || '').trim().slice(0, 40));
      }
      return { hOverflow: de.scrollWidth > window.innerWidth + 1, mainW: main?.clientWidth ?? 0, dock: !!phone, clipped: clipped.slice(0, 5) };
    });
    if (m.hOverflow) result.issues.push(`${label}: page scrolls horizontally at ${size}`);
    if (m.clipped.length) result.issues.push(`${label}: content cut off at ${size}: ${m.clipped.join(' | ')}`);
    const ph = await phone.evaluate(() => ({ h: document.documentElement.scrollWidth > window.innerWidth + 1 }));
    if (ph.h) result.issues.push(`${label}: phone page scrolls sideways`);
    return m;
  }
  async function endAct(n, title, check) {
    const s = await S();
    const problems = check(s);
    const ms = Date.now() - actStart;
    await page.screenshot({ path: path.join(outDir, `${size}-act${n}.png`) });
    await phone.screenshot({ path: path.join(outDir, `${size}-act${n}-phone.png`) });
    const lay = await layoutCheck(`Act ${n}`);
    result.acts.push({ n, title, ms, ok: problems.length === 0, problems, layout: lay });
    log(`  ${problems.length ? red('FAIL') : green('PASS')}  ${bold(`Act ${n}: ${title}`)} ${dim(`${(ms / 1000).toFixed(1)} s`)}${problems.length ? `  ${problems.join('; ')}` : ''}`);
    if (problems.length) throw new Error(`Act ${n} state check failed: ${problems.join('; ')}`);
    actStart = Date.now();
  }

  try {
    await director(port, 'reset');
    await page.goto(`${url}/operator/intake`, { waitUntil: 'networkidle' });
    await phone.goto(`${url}/wa/f-elsen`, { waitUntil: 'networkidle' });
    await phone.getByRole('button', { name: 'Əlavə et' }).waitFor();

    // Typography: the bundled fonts load and cover the Azerbaijani letters.
    const fonts = await page.evaluate(async () => {
      const sans = await document.fonts.load('16px "Source Sans 3"', 'ƏəĞğıİÖöŞşÜüÇç₼');
      const serif = await document.fonts.load('600 16px "Source Serif 4"', 'BƏRƏKƏT');
      return { sans: sans.length, serif: serif.length, check: document.fonts.check('16px "Source Sans 3"', 'Əəğış₼') };
    });
    result.fonts = fonts;
    if (!fonts.sans || !fonts.serif || !fonts.check) result.issues.push(`Fonts: Azerbaijani glyph faces not loaded (${JSON.stringify(fonts)})`);

    // ---------- Act 1 ----------
    act = 1;
    log(`  ${bold('Act 1')} Farmer accessibility`);
    await stepDo('Phone: 📎 → voice note + photo', async () => {
      await phone.getByRole('button', { name: 'Əlavə et' }).click();
      await phone.getByRole('button', { name: /Səsli mesaj \+ şəkil/ }).click();
    }, { interactions: 2 });
    await stepDo('AI pipeline drafts the listing', () => until('the draft listing', async () => (await S()).listings.some((l) => l.farmerId === 'f-elsen' && l.status === 'draft')), { interactions: 0 });
    const run = (await S()).aiRuns[0];
    result.aiModes = Object.fromEntries(run.steps.map((x) => [x.key, x.mode ?? x.status]));
    await stepDo('Tap Təsdiq on Elşən’s phone', () => tapPhone('Təsdiq'));
    await stepDo('Listing goes live', () => until('listing live', async () => (await S()).listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && l.status === 'live')), { interactions: 0 });
    await endAct(1, 'Farmer accessibility', (s) => {
      const l = s.listings.find((x) => x.farmerId === 'f-elsen' && x.product === 'Tomato');
      const p = [];
      if (!l || l.status !== 'live') p.push('listing not live');
      if (l && (l.qtyKg !== 180 || l.priceAzn !== 1.15 || l.ripeness !== 4)) p.push(`listing is ${l.qtyKg} kg @ ${l.priceAzn}, stage ${l.ripeness} (expected 180 kg @ 1.15, stage 4)`);
      return p;
    });

    // ---------- Act 2 ----------
    act = 2;
    log(`  ${bold('Act 2')} Intelligent procurement`);
    await stepDo('B → Buyer view', async () => { await key('b'); await page.waitForURL('**/buyer'); });
    await stepDo('Open tender T-1042', () => page.getByRole('link', { name: /T-1042/ }).click());
    await stepDo('Find supply → three options', async () => {
      await page.getByRole('button', { name: 'Find supply' }).click();
      await page.getByRole('button', { name: 'Confirm option i' }).waitFor({ timeout: 20_000 });
    });
    const margin = await page.getByText(/cheaper, but 220 kg of it arrives fully red/).count();
    if (!margin) result.issues.push('Act 2: margin note about the overripe cheap option not visible');
    await stepDo('Confirm option i → Confirm and send offers', async () => {
      await page.getByRole('button', { name: 'Confirm option i' }).click();
      await page.getByRole('button', { name: 'Confirm and send offers' }).click();
    }, { interactions: 2 });
    await stepDo('Tap Qəbul on Elşən’s phone', () => tapPhone('Qəbul'));
    await stepDo('A → other farmers accept', async () => {
      await key('a');
      await until('order confirmed', async () => (await S()).orders[0]?.status === 'confirmed');
    });
    await endAct(2, 'Intelligent procurement', (s) => {
      const props = s.proposals.filter((p) => p.tenderId === 'T-1042').map((p) => p.costs.perKg);
      const o = s.orders[0];
      const p = [];
      if (JSON.stringify(props) !== '[1.33,1.23,1.38]') p.push(`options ${props.join('/')} (expected 1.33/1.23/1.38)`);
      if (!o || o.status !== 'confirmed') p.push(`order ${o?.status ?? 'missing'}`);
      return p;
    });

    // ---------- Act 3 ----------
    act = 3;
    log(`  ${bold('Act 3')} Unexpected disruption`);
    await stepDo('S → Səbinə says hello', async () => {
      await key('s');
      await until('Səbinə’s message', async () => (await S()).messages.some((m) => m.farmerId === 'f-sebine' && m.dir === 'in'));
    });
    await stepDo('C → Rauf cancels by voice, view jumps to Operator', async () => {
      await key('c');
      await page.waitForURL('**/operator');
    });
    await stepDo('Re-matching → backup proposal', async () => {
      await page.getByRole('button', { name: 'Approve and send offer' }).waitFor({ timeout: 25_000 });
    }, { interactions: 0 });
    if (!(await page.getByText(/Fill the 80 kg gap/).count())) result.issues.push('Act 3: "Fill the 80 kg gap" heading not visible');
    await stepDo('Approve and send offer', () => page.getByRole('button', { name: 'Approve and send offer' }).click());
    await stepDo('A → Səbinə accepts', async () => {
      await until('backup offer sent', async () => (await S()).orders[0]?.recovery?.status === 'offered');
      await key('a');
    });
    await stepDo('Order repaired', () => until('recovery resolved', async () => (await S()).orders[0]?.recovery?.status === 'resolved'), { interactions: 0 });
    await endAct(3, 'Unexpected disruption', (s) => {
      const o = s.orders[0];
      const p = [];
      if (o?.recovery?.shortfallKg !== 80) p.push(`shortfall ${o?.recovery?.shortfallKg} (expected 80)`);
      if (o?.costs.perKg !== 1.35) p.push(`delivered cost ${o?.costs.perKg} (expected 1.35)`);
      if (!o?.allocations.some((a) => a.farmerId === 'f-sebine' && a.status === 'accepted')) p.push('Səbinə not in the order');
      return p;
    });

    // ---------- Act 4 ----------
    act = 4;
    log(`  ${bold('Act 4')} Trust and fulfillment`);
    await stepDo('T → delivery morning', async () => {
      await key('t');
      await until('order delivered', async () => (await S()).orders[0]?.status === 'delivered');
    });
    const orderId = (await S()).orders[0].id;
    await stepDo(`B → Orders → ${orderId}`, async () => {
      await key('b');
      await page.waitForURL('**/buyer');
      await page.getByRole('link', { name: 'Orders', exact: true }).click();
      await page.getByRole('link', { name: new RegExp(orderId) }).first().click();
    }, { interactions: 3 });
    await stepDo('Confirm receipt and release payment', () => page.getByRole('button', { name: 'Confirm receipt and release payment' }).click());
    await stepDo('Rate the three farmers', async () => {
      await page.getByRole('button', { name: '5 stars' }).first().waitFor();
      const n = await page.getByRole('button', { name: '5 stars' }).count();
      for (let i = 0; i < n; i++) await page.getByRole('button', { name: '5 stars' }).nth(i).click();
      result.interactions += n - 1;
    });
    await stepDo('Elşən replies 5 on his phone', async () => {
      await phone.locator('#wa-msg').fill('5');
      await phone.keyboard.press('Enter');
      await until('Elşən’s rating', async () => (await S()).orders[0]?.farmerRatings['f-elsen'] === 5);
    }, { interactions: 3 });
    await endAct(4, 'Trust and fulfillment', (s) => {
      const o = s.orders[0];
      const p = [];
      if (o.status !== 'settled' || o.escrow.status !== 'released') p.push(`order ${o.status}, escrow ${o.escrow.status}`);
      if (Object.keys(o.buyerRatings).length < 3) p.push(`${Object.keys(o.buyerRatings).length} farmer ratings`);
      if (o.farmerRatings['f-elsen'] !== 5) p.push('buyer not rated by Elşən');
      if (s.presenter.act.n !== 5) p.push(`act tracker says ${s.presenter.act.n}`);
      return p;
    });
    result.ok = true;
  } catch (e) {
    result.error = e.message;
    log(`  ${red('FAIL')}  ${e.message}`);
  } finally {
    result.totalMs = Date.now() - t0;
    await browser.close();
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = args();
  const sizes = a.size === 'all' ? ['1920x1080', '1366x768'] : [a.size ?? '1920x1080'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(DATA, 'rehearsals', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  let server;
  let port = PORT;
  const ai = a.ai ?? 'cached';
  if (a['use-running']) {
    if (!(await healthy(PORT))) { console.error('No app on port 3000: run npm run demo:launch, or drop --use-running.'); process.exit(1); }
    if (a.ai) await director(PORT, 'aiMode', a.ai);
  } else {
    await ensureBuild();
    port = 3100;
    cleanScratch();
    server = await startServer({ port, env: { DEMO_DATA_DIR: scratchDataDir('rehearse'), DEMO_RESTORE: '0', AI_MODE: ai, WHATSAPP_CHANNEL: 'simulator', ...(a.fast ? { DEMO_STEP_MS: '0', DEMO_RECOVERY_MS: '300' } : {}) }, logFile: path.join(outDir, 'server.log') });
  }
  const results = [];
  try {
    for (const size of sizes) {
      console.log(`\n${bold(`Rehearsal at ${size}`)} ${dim(`(AI ${(a['use-running'] ? (await state(port)).settings.aiMode : ai).toUpperCase()}, ${a['use-running'] ? 'presenter app on :3000' : 'isolated server on :3100'})`)}`);
      results.push(await rehearse({ port, size, outDir, headed: !!a.headed }));
    }
  } finally {
    await server?.stop();
  }
  const r = new Report('Rehearsal result');
  for (const res of results) {
    const secs = res.totalMs / 1000;
    if (res.ok) r.pass(`Four acts at ${res.size}`, `${secs.toFixed(0)} s of app time, ${res.interactions} presenter interactions`);
    else r.fail(`Four acts at ${res.size}`, res.error);
    if (res.ok) secs <= BUDGET_S * 0.5 ? r.pass('Fits the 3-minute slot', `app time ${secs.toFixed(0)} s leaves ${Math.round(BUDGET_S - secs)} s for talking`) : r.warn('Fits the 3-minute slot', `app time ${secs.toFixed(0)} s is over half of 180 s`);
    for (const i of res.issues) r.warn(res.size, i);
    if (res.fonts) res.fonts.sans && res.fonts.check ? r.pass('Azerbaijani typography', 'bundled Source Sans 3 / Source Serif 4 faces loaded for Ə ə ğ ı ö ş ü ç ₼') : r.fail('Azerbaijani typography', JSON.stringify(res.fonts));
    const ext = Array.from(new Set(res.externalRequests));
    ext.length ? r.warn('External requests', ext.join(', ')) : r.pass('No external requests', 'works without internet in the browser');
    const errs = Array.from(new Set(res.consoleErrors));
    errs.length ? r.warn('Browser console errors', errs.slice(0, 3).join(' | ')) : r.pass('Browser console', 'no errors');
    if (res.aiModes) r.info('AI step results', Object.entries(res.aiModes).map(([k, v]) => `${k}: ${v}`).join(', '));
  }
  const ok = r.summary();
  const summary = { at: new Date().toISOString(), ok, ai: a['use-running'] ? 'running app' : ai, fast: !!a.fast, outDir: path.relative(process.cwd(), outDir), results };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(DATA, 'last-rehearsal.json'), JSON.stringify(summary, null, 2));
  console.log(dim(`\n  Screenshots and report: ${path.relative(process.cwd(), outDir)}/`));
  process.exit(ok ? 0 : 1);
}
