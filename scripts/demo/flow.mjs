// The four acts driven through the HTTP API only (no browser), with the expected numbers asserted.
// Used by demo:fallback and demo:verify against an isolated server.
import { action, director, state, waitFor } from './lib.mjs';

async function phone(port, farmerId, fields) {
  const fd = new FormData();
  fd.set('farmerId', farmerId);
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch(`http://127.0.0.1:${port}/api/phone`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`/api/phone ${res.status}`);
}

/** Returns a list of [name, ok, detail]. Stops at the first failure. */
export async function apiFourActs(port, { useListingFallback = false } = {}) {
  const out = [];
  const S = () => state(port);
  const check = (name, ok, detail = '') => {
    out.push([name, !!ok, detail]);
    if (!ok) throw new Error(`${name}: ${detail}`);
  };
  try {
    await director(port, 'reset');
    check('Reset to Act 1', (await S()).presenter.act.n === 1);
    if (useListingFallback) {
      await director(port, 'elsenFallback');
      check('L: listing fallback puts Elşən live', (await S()).listings.some((l) => l.farmerId === 'f-elsen' && l.product === 'Tomato' && l.status === 'live'));
    } else {
      await phone(port, 'f-elsen', { demoVoice: 'elsen-listing', demoPhoto: 'tomatoes-stage4' });
      const s1 = await waitFor(async () => { const s = await S(); return s.listings.some((l) => l.farmerId === 'f-elsen' && l.status === 'draft') && s; }, { timeout: 60_000, what: 'draft listing' });
      const run = s1.aiRuns[0];
      check('Act 1: voice note + photo → draft listing', true, run.steps.map((x) => `${x.key}:${x.mode ?? x.status}`).join(' '));
      const l = s1.listings.find((x) => x.farmerId === 'f-elsen' && x.status === 'draft');
      check('Act 1: listing fields', l.qtyKg === 180 && l.priceAzn === 1.15 && l.ripeness === 4, `${l.qtyKg} kg @ ${l.priceAzn} ₼, stage ${l.ripeness}`);
      await phone(port, 'f-elsen', { text: '1' });
      await waitFor(async () => (await S()).listings.some((x) => x.farmerId === 'f-elsen' && x.product === 'Tomato' && x.status === 'live'), { what: 'listing live' });
      check('Act 1: farmer confirms → listing live', true);
    }
    await action(port, 'findSupply', { tenderId: 'T-1042' });
    const props = (await S()).proposals.filter((p) => p.tenderId === 'T-1042');
    check('Act 2: three options', JSON.stringify(props.map((p) => p.costs.perKg)) === '[1.33,1.23,1.38]', props.map((p) => p.costs.perKg).join(' / ') + ' ₼/kg');
    const { orderId } = await action(port, 'confirmProposal', { proposalId: props[0].id });
    const again = await action(port, 'confirmProposal', { proposalId: props[0].id });
    check('Act 2: double confirm creates one order', again.orderId === orderId && (await S()).orders.length === 1, orderId);
    await phone(port, 'f-elsen', { text: '1' });
    await director(port, 'acceptOthers');
    await waitFor(async () => (await S()).orders[0]?.status === 'confirmed', { what: 'order confirmed' });
    check('Act 2: all farmers accept → order confirmed', true, orderId);
    await director(port, 'sebineHello');
    await waitFor(async () => (await S()).messages.some((m) => m.farmerId === 'f-sebine' && m.dir === 'in'), { what: 'Səbinə hello' });
    await director(port, 'cancelRauf');
    const s3 = await waitFor(async () => { const s = await S(); return s.orders[0]?.recovery?.status === 'proposed' && s; }, { timeout: 30_000, what: 'recovery proposal' });
    const rec = s3.orders[0].recovery;
    check('Act 3: Rauf cancels → 80 kg gap', rec.shortfallKg === 80, `${rec.shortfallKg} kg${rec.cause ? `, cause: ${rec.cause}` : ''}`);
    check('Act 3: backup is Səbinə', rec.candidates[rec.selected].farmerId === 'f-sebine', rec.candidates[rec.selected].farmerId);
    await action(port, 'approveRecovery', { orderId });
    await phone(port, 'f-sebine', { text: '1' });
    const s3b = await waitFor(async () => { const s = await S(); return s.orders[0]?.recovery?.status === 'resolved' && s; }, { what: 'recovery resolved' });
    check('Act 3: order repaired at 1.35 ₼/kg', s3b.orders[0].costs.perKg === 1.35, `${s3b.orders[0].costs.perKg} ₼/kg`);
    await director(port, 'thursday');
    check('Act 4: T → delivered', (await S()).orders[0].status === 'delivered');
    await action(port, 'confirmReceipt', { orderId });
    for (const f of ['f-elsen', 'f-gulnare', 'f-sebine']) await action(port, 'rateFarmer', { orderId, farmerId: f, stars: 5 });
    await phone(port, 'f-elsen', { text: '5' });
    const s4 = await waitFor(async () => { const s = await S(); return s.orders[0].farmerRatings['f-elsen'] === 5 && s; }, { what: 'farmer rating' });
    check('Act 4: settled, payout released, rated both ways', s4.orders[0].status === 'settled' && s4.orders[0].escrow.status === 'released' && s4.presenter.act.n === 5);
  } catch (e) {
    if (!out.length || out[out.length - 1][1]) out.push(['Four-act run', false, e.message]);
  }
  return out;
}
