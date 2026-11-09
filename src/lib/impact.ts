// Impact figures, computed only from what happened on the platform (no assumed baselines), except the van
// emission factor, which is cited. Shared by the Impact page and the landing page.
import { roadKm } from './geo';
import type { State } from './types';

/** kg CO2e per km, average van up to 3.5 t: UK DESNZ greenhouse gas conversion factors 2024. */
export const VAN_KG_CO2E_PER_KM = 0.249;

export interface Impact {
  farmers: number; // farmers who listed from their phone (incl. sign-ups)
  signups: number;
  languages: { az: number; en: number };
  phoneListings: number;
  voiceListings: number; // listings that started from a voice note
  avgListingSeconds?: number; // voice note → listing card
  liveKg: number;
  orders: number; // not cancelled
  orderedKg: number;
  deliveredKg: number;
  paidToFarmers: number; // ₼, settled orders
  farmerShare?: number; // share of what buyers pay that goes to farmers (0..1)
  escrowHeld: number;
  farmsPerOrder?: number;
  pooledKm: number; // one van per order
  separateKm: number; // each farm driving its lot to the buyer
  co2SavedKg: number;
  overripeAvoidedKg: number; // kg the cheapest option would have delivered overripe, avoided by the chosen option
  repairs: number; // orders where a dropped farm was replaced
  rescuedKg: number;
  photosRejected: number; // photos refused or held (not produce, screens, spoiled, old)
}

export function computeImpact(s: State): Impact {
  const phoneListings = s.listings.filter((l) => l.source === 'whatsapp');
  const farmerIds = new Set([...phoneListings.map((l) => l.farmerId), ...s.farmers.filter((f) => f.selfSignup).map((f) => f.id)]);
  const runs = s.aiRuns.filter((r) => r.listingId);
  const voiceRuns = runs.filter((r) => r.steps.some((x) => x.key === 'transcribe' && x.status === 'done'));
  const timed = voiceRuns.map((r) => r.steps.reduce((n, x) => n + (x.ms ?? 0), 0)).filter((ms) => ms > 0);

  const orders = s.orders.filter((o) => o.status !== 'cancelled');
  const kgOf = (o: (typeof orders)[number]) => o.allocations.filter((a) => !['cancelled', 'declined'].includes(a.status)).reduce((n, a) => n + a.qtyKg, 0);
  const settled = orders.filter((o) => o.status === 'settled');
  const buyer = (o: (typeof orders)[number]) => s.buyers.find((b) => b.id === o.buyerId) ?? s.buyers[0];

  let pooledKm = 0, separateKm = 0, overripeAvoidedKg = 0, rescuedKg = 0, repairs = 0, farms = 0;
  for (const o of orders) {
    const live = o.allocations.filter((a) => !['cancelled', 'declined'].includes(a.status));
    farms += live.length;
    pooledKm += o.costs.routeKm;
    for (const a of live) {
      const f = s.farmers.find((x) => x.id === a.farmerId);
      if (f) separateKm += roadKm(f, buyer(o));
    }
    // The buyer took the option that arrives at the right ripeness instead of a cheaper one that would not.
    const t = s.tenders.find((x) => x.id === o.tenderId);
    const chosen = s.proposals.find((p) => p.id === o.proposalId);
    const cheaper = t && s.proposals.find((p) => p.tenderId === t.id && p.key === 'lowest_price' && p.id !== o.proposalId);
    if (t && chosen && cheaper && cheaper.costs.perKg < chosen.costs.perKg) {
      overripeAvoidedKg += cheaper.allocations.filter((a) => a.arrivalRipeness > t.ripenessMax + 0.5).reduce((n, a) => n + a.qtyKg, 0);
    }
    if (o.recovery?.status === 'resolved' && o.recovery.after) { repairs += 1; rescuedKg += o.recovery.shortfallKg; }
  }
  const produce = orders.reduce((n, o) => n + o.costs.produce, 0);
  const total = orders.reduce((n, o) => n + o.costs.total, 0);
  const saved = Math.max(0, separateKm - pooledKm);

  return {
    farmers: farmerIds.size,
    signups: s.farmers.filter((f) => f.selfSignup).length,
    languages: { az: s.farmers.filter((f) => farmerIds.has(f.id) && f.lang !== 'en').length, en: s.farmers.filter((f) => farmerIds.has(f.id) && f.lang === 'en').length },
    phoneListings: phoneListings.length,
    voiceListings: voiceRuns.length,
    avgListingSeconds: timed.length ? timed.reduce((a, b) => a + b, 0) / timed.length / 1000 : undefined,
    liveKg: s.listings.filter((l) => l.status === 'live').reduce((n, l) => n + l.qtyKg, 0),
    orders: orders.length,
    orderedKg: orders.reduce((n, o) => n + kgOf(o), 0),
    deliveredKg: orders.filter((o) => ['delivered', 'settled'].includes(o.status)).reduce((n, o) => n + kgOf(o), 0),
    paidToFarmers: settled.reduce((n, o) => n + o.allocations.filter((a) => a.status === 'picked_up').reduce((m, a) => m + a.qtyKg * a.priceAzn, 0), 0),
    farmerShare: total ? produce / total : undefined,
    escrowHeld: orders.filter((o) => o.escrow.status === 'held').reduce((n, o) => n + o.escrow.amount, 0),
    farmsPerOrder: orders.length ? farms / orders.length : undefined,
    pooledKm: Math.round(pooledKm),
    separateKm: Math.round(separateKm),
    co2SavedKg: Math.round(saved * VAN_KG_CO2E_PER_KM),
    overripeAvoidedKg,
    repairs,
    rescuedKg,
    photosRejected: s.events.filter((e) => /^(Photo from .* not used|Listing held)/.test(e.title)).length,
  };
}
