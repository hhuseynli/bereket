import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateProposals, planRecovery } from './engine';
import { DEMO_START, elsenListingFields, initialState } from './seed';
import type { Listing, Order, State } from './types';

function demoState(): State {
  const s = initialState();
  const l: Listing = {
    id: 'l-elsen', farmerId: 'f-elsen', ...elsenListingFields(), ripenessConfidence: 0.9, defects: [],
    status: 'live', createdAt: DEMO_START, source: 'whatsapp',
  };
  s.listings.push(l);
  return s;
}

test('three distinct options for T-1042 with the demo numbers', () => {
  const s = demoState();
  const { proposals, checkedListings } = generateProposals(s, s.tenders[0], DEMO_START);
  assert.equal(checkedListings, 37);
  assert.deepEqual(proposals.map((p) => p.key), ['best_fit', 'lowest_price', 'firmest']);
  assert.deepEqual(proposals.map((p) => p.costs.perKg), [1.33, 1.23, 1.38]);
  const best = proposals[0];
  assert.deepEqual(best.allocations.map((a) => [a.farmerId, a.qtyKg]), [['f-elsen', 180], ['f-gulnare', 140], ['f-rauf', 80]]);
  assert.equal(best.costs.produce, 463);
  assert.ok(best.allocations.every((a) => a.arrivalRipeness >= 3.5 && a.arrivalRipeness <= 5.5));
  for (const p of proposals) assert.equal(p.allocations.reduce((s2, a) => s2 + a.qtyKg, 0), 400);
});

test('lowest price option is flagged for overripe fruit and the reason says so', () => {
  const s = demoState();
  const { proposals } = generateProposals(s, s.tenders[0], DEMO_START);
  const cheap = proposals.find((p) => p.key === 'lowest_price')!;
  assert.match(cheap.warning ?? '', /220 kg arrives fully red/);
  assert.ok(proposals[0].reasons.some((r) => /cheaper, but 220 kg of it arrives fully red/.test(r.text)));
});

test('spoiled lots are never offered', () => {
  const s = demoState();
  const tomato = s.listings.find((l) => l.farmerId === 'f-gulnare' && l.product === 'Tomato')!;
  tomato.defects = ['Visible rot on several fruit'];
  const { proposals } = generateProposals(s, s.tenders[0], DEMO_START);
  assert.ok(proposals.every((p) => p.allocations.every((a) => a.listingId !== tomato.id)));
});

test('recovery replaces Rauf with Səbinə and explains the rejects', () => {
  const s = demoState();
  const best = generateProposals(s, s.tenders[0], DEMO_START).proposals[0];
  const order: Order = {
    id: 'O-1', tenderId: 'T-1042', proposalId: best.id, buyerId: 'b-nergiz',
    allocations: best.allocations.map((a) => ({ ...a, status: 'accepted' })), route: best.route, costs: best.costs,
    status: 'confirmed', escrow: { amount: best.costs.total, status: 'held', simulated: true }, buyerRatings: {}, farmerRatings: {}, createdAt: DEMO_START,
  };
  const r = planRecovery(s, order, 'f-rauf', DEMO_START);
  assert.equal(r.status, 'proposed');
  assert.equal(r.shortfallKg, 80);
  const pick = r.candidates[r.selected!];
  assert.equal(pick.farmerId, 'f-sebine');
  assert.equal(pick.costs!.perKg, 1.35);
  const nurlan = r.candidates.find((c) => c.farmerId === 'f-nurlan')!;
  assert.equal(nurlan.accepted, false);
  assert.match(nurlan.why, /overripe/);
  const tofiq = r.candidates.find((c) => c.farmerId === 'f-tofiq')!;
  assert.match(tofiq.why, /too large to split/);
});

test('no backup is reported honestly', () => {
  const s = demoState();
  const best = generateProposals(s, s.tenders[0], DEMO_START).proposals[0];
  s.listings.find((l) => l.farmerId === 'f-sebine' && l.product === 'Tomato')!.status = 'withdrawn';
  const order = {
    id: 'O-1', tenderId: 'T-1042', buyerId: 'b-nergiz', allocations: best.allocations.map((a) => ({ ...a, status: 'accepted' })), costs: best.costs,
  } as unknown as Order;
  const r = planRecovery(s, order, 'f-rauf', DEMO_START);
  assert.equal(r.status, 'no_backup');
});
