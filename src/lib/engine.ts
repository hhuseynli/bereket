// Matching, aggregation, routing and recovery. Deterministic code: the AI never decides who is matched,
// it only explains. Every reason string below is built from the numbers that drove the decision.
import { bestRoute, round2, roadKm, transportCost } from './geo';
import { inWindow, stageAt, stageInfo } from './ripeness';
import type { Allocation, Costs, Farmer, Listing, Order, Proposal, Reason, Recovery, RecoveryCandidate, State, Stop, Tender } from './types';

export const PLATFORM_FEE = 0.03; // 3% of produce value
export const MIN_TAKE = 0.6; // a farmer sells at least 60% of a lot, or the whole lot
export const MAX_FARMS = 4;

export interface Candidate {
  listing: Listing;
  farmer: Farmer;
  arrival: number; // continuous stage on arrival
  fits: boolean; // arrival within the buyer's ripeness window
}

export function hoursUntil(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

const isUnsafe = (l: Listing) => l.defects.some((d) => /spoil|rot|mould|mold|xarab/i.test(d));
// Tomato matching depends on ripeness from the photo; a lot with no photo yet (confidence 0) waits for one.
const RIPENESS_MATTERS = new Set(['Tomato']);
const ripenessUnknown = (l: Listing) => RIPENESS_MATTERS.has(l.product) && !l.ripenessConfidence;

export function candidatesFor(state: State, tender: Tender, nowIso: string, excludeListingIds: string[] = []): Candidate[] {
  const hours = hoursUntil(nowIso, tender.deadline);
  return state.listings
    .filter(
      (l) =>
        l.status === 'live' &&
        l.product === tender.product &&
        l.variety === tender.variety &&
        l.grade <= tender.grade &&
        !isUnsafe(l) &&
        !ripenessUnknown(l) &&
        !excludeListingIds.includes(l.id),
    )
    .map((listing) => {
      const farmer = state.farmers.find((f) => f.id === listing.farmerId)!;
      const arrival = stageAt(listing.ripeness, hours);
      return { listing, farmer, arrival, fits: inWindow(arrival, tender.ripenessMin, tender.ripenessMax) };
    });
}

function combos<T>(xs: T[], maxK: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length > 0) out.push([...acc]);
    if (acc.length === maxK) return;
    for (let i = start; i < xs.length; i++) {
      acc.push(xs[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

export function costsFor(allocs: { qtyKg: number; priceAzn: number }[], routeKm: number, stops: number, qty: number): Costs {
  const produce = round2(allocs.reduce((s, a) => s + a.qtyKg * a.priceAzn, 0));
  const transport = transportCost(routeKm, stops);
  const fee = round2(produce * PLATFORM_FEE);
  const total = round2(produce + transport + fee);
  return { produce, transport, fee, total, perKg: round2(total / qty), routeKm: Math.round(routeKm) };
}

interface Evaluated {
  cands: Candidate[];
  allocations: Allocation[];
  route: Stop[];
  costs: Costs;
  avgArrival: number;
  allFit: boolean;
  worst: Candidate;
  key: string;
}

let allocSeq = 0;
const aid = () => `a-${Date.now().toString(36)}-${++allocSeq}`;

/** Fill the tender from these lots, cheapest first. Returns null when the lots cannot cover it under MIN_TAKE. */
function evaluate(cands: Candidate[], qty: number, dest: { lat: number; lng: number }): Evaluated | null {
  const totalAvail = cands.reduce((s, c) => s + c.listing.qtyKg, 0);
  if (totalAvail < qty) return null;
  const sorted = [...cands].sort((a, b) => a.listing.priceAzn - b.listing.priceAzn);
  let remaining = qty;
  const allocations: Allocation[] = [];
  for (const c of sorted) {
    if (remaining <= 0) return null; // a lot in the combo would be unused: a smaller combo covers this
    const take = Math.min(c.listing.qtyKg, remaining);
    if (take < c.listing.qtyKg && take < MIN_TAKE * c.listing.qtyKg) return null;
    allocations.push({
      id: aid(), listingId: c.listing.id, farmerId: c.farmer.id, qtyKg: take, priceAzn: c.listing.priceAzn,
      arrivalRipeness: c.arrival, status: 'proposed',
    });
    remaining -= take;
  }
  if (remaining > 0) return null;
  const stops: Stop[] = cands.map((c) => ({ farmerId: c.farmer.id, label: c.farmer.village, lat: c.farmer.lat, lng: c.farmer.lng }));
  const { order, km } = bestRoute(stops, dest);
  const costs = costsFor(allocations, km, stops.length, qty);
  const avgArrival = allocations.reduce((s, a) => s + a.arrivalRipeness * a.qtyKg, 0) / qty;
  const worst = [...cands].sort((a, b) => Math.abs(b.arrival - 4.5) - Math.abs(a.arrival - 4.5))[0];
  return {
    cands, allocations, route: order, costs, avgArrival, allFit: cands.every((c) => c.fits), worst,
    key: cands.map((c) => c.listing.id).sort().join('+'),
  };
}

const firstName = (f: Farmer) => f.name.split(' ')[0];
const weekday = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Asia/Baku' });

function ripenessPhrase(stage: number) {
  return `${stageInfo(stage).name} on arrival`;
}

export interface MatchResult {
  proposals: Proposal[];
  checkedListings: number;
  candidates: Candidate[];
}

export function generateProposals(state: State, tender: Tender, nowIso: string): MatchResult {
  const buyer = state.buyers.find((b) => b.id === tender.buyerId)!;
  const cands = candidatesFor(state, tender, nowIso);
  const evaluated = combos(cands, MAX_FARMS)
    .map((c) => evaluate(c, tender.qtyKg, buyer))
    .filter((e): e is Evaluated => !!e);

  const byCost = (a: Evaluated, b: Evaluated) => a.costs.total - b.costs.total;
  const fitting = evaluated.filter((e) => e.allFit).sort(byCost);
  const best = fitting[0];
  const cheapest = [...evaluated].sort(byCost)[0];
  const firmest = fitting
    .filter((e) => !best || e.key !== best.key)
    .sort((a, b) => a.avgArrival - b.avgArrival || byCost(a, b))[0];

  const picks: { e: Evaluated; key: Proposal['key']; title: string }[] = [];
  if (best) picks.push({ e: best, key: 'best_fit', title: 'Freshest on arrival' });
  if (cheapest && (!best || cheapest.key !== best.key)) picks.push({ e: cheapest, key: 'lowest_price', title: 'Lowest price' });
  if (firmest && !picks.some((p) => p.e.key === firmest.key)) picks.push({ e: firmest, key: 'firmest', title: 'Firmest stock' });

  const numerals = ['i', 'ii', 'iii'];
  const proposals: Proposal[] = picks.map((p, i) => {
    const misfit = p.e.cands.filter((c) => !c.fits);
    let warning: string | undefined;
    if (misfit.length) {
      const kg = p.e.allocations.filter((a) => misfit.some((m) => m.listing.id === a.listingId)).reduce((s, a) => s + a.qtyKg, 0);
      const over = misfit.some((m) => m.arrival > tender.ripenessMax + 0.5);
      warning = over ? `${kg} kg arrives fully red` : `${kg} kg arrives too firm`;
    }
    return {
      id: `${tender.id}-${p.key}`,
      tenderId: tender.id,
      key: p.key,
      numeral: numerals[i],
      title: p.title,
      recommended: p.key === 'best_fit',
      allocations: p.e.allocations.sort((a, b) => b.qtyKg - a.qtyKg),
      route: p.e.route,
      costs: p.e.costs,
      arrivalStage: p.e.avgArrival,
      worstStage: p.e.worst.arrival,
      arrivalSummary: misfit.length ? ripenessPhrase(p.e.worst.arrival) : ripenessPhrase(p.e.avgArrival),
      warning,
      reasons: [],
    };
  });

  // Reasons, written from the numbers.
  const rec = proposals.find((p) => p.recommended);
  if (rec) {
    const main = rec.allocations[0];
    const mainFarmer = state.farmers.find((f) => f.id === main.farmerId)!;
    const lot = state.listings.find((l) => l.id === main.listingId)!;
    rec.reasons.push({
      ref: main.id,
      text: `${firstName(mainFarmer)}'s photos show stage ${lot.ripeness} today. By ${weekday(tender.deadline)} morning it reaches stage ${Math.round(main.arrivalRipeness)}, right for your ${tender.useWithinDays}-day ${tender.intendedUse.toLowerCase()} use.`,
    });
    const other = proposals.find((p) => p.key === 'lowest_price');
    if (other) {
      const diff = round2(rec.costs.perKg - other.costs.perKg);
      const over = other.worstStage > tender.ripenessMax + 0.5;
      rec.reasons.push({
        ref: `option-${other.numeral}`,
        text: over
          ? `Option ${other.numeral} is ${diff.toFixed(2)} ₼/kg cheaper, but ${other.warning?.replace('arrives', 'of it arrives')}. Much of it would likely spoil before you use it.`
          : `Option ${other.numeral} is ${diff.toFixed(2)} ₼/kg cheaper, but part of it is still too firm for ${weekday(tender.deadline)}'s service.`,
      });
    }
    const pts = rec.route;
    let maxPair = 0;
    for (const a of pts) for (const b of pts) maxPair = Math.max(maxPair, roadKm(a, b));
    rec.reasons.push({
      ref: 'route',
      text: `All ${pts.length} farms sit within ${Math.round(maxPair)} km of each other, so one van covers the loop for ${(rec.costs.transport / tender.qtyKg).toFixed(2)} ₼/kg.`,
    });
  }
  for (const p of proposals.filter((x) => !x.recommended)) {
    const diff = rec ? round2(p.costs.perKg - rec.costs.perKg) : 0;
    if (p.key === 'lowest_price')
      p.reasons.push({ text: `Saves ${Math.abs(diff).toFixed(2)} ₼/kg, but ${p.warning ?? 'ripeness is outside your window'}.` });
    if (p.key === 'firmest')
      p.reasons.push({ text: `${ripenessPhrase(p.arrivalStage)}: lasts longer, but costs ${diff.toFixed(2)} ₼/kg more and needs a day before it is at its best.` });
  }

  const checked = state.listings.filter((l) => l.status === 'live' || l.status === 'reserved').length;
  return { proposals, checkedListings: checked, candidates: cands };
}

/** A farmer dropped out: keep everyone else, fill only the gap. */
export function planRecovery(state: State, order: Order, cancelledFarmerId: string, nowIso: string, cause?: string): Recovery {
  const tender = state.tenders.find((t) => t.id === order.tenderId)!;
  const buyer = state.buyers.find((b) => b.id === order.buyerId)!;
  const lost = order.allocations.find((a) => a.farmerId === cancelledFarmerId && a.status !== 'cancelled')!;
  const shortfall = lost.qtyKg;
  const kept = order.allocations.filter((a) => a.farmerId !== cancelledFarmerId && a.status !== 'cancelled' && a.status !== 'declined');
  const inOrder = order.allocations.map((a) => a.listingId);
  const cands = candidatesFor(state, tender, nowIso, inOrder).filter((c) => c.farmer.id !== cancelledFarmerId);
  const keptStops: Stop[] = kept.map((a) => {
    const f = state.farmers.find((x) => x.id === a.farmerId)!;
    return { farmerId: f.id, label: f.village, lat: f.lat, lng: f.lng };
  });

  const out: RecoveryCandidate[] = cands.map((c) => {
    const base = { farmerId: c.farmer.id, listingId: c.listing.id, priceAzn: c.listing.priceAzn, arrivalRipeness: c.arrival };
    if (!c.fits) {
      const over = c.arrival > tender.ripenessMax + 0.5;
      return { ...base, qtyKg: 0, accepted: false, why: over ? `${stageInfo(c.arrival).name} by ${weekday(tender.deadline)}: overripe on arrival` : 'Still too green on arrival' };
    }
    if (c.listing.qtyKg < shortfall) return { ...base, qtyKg: c.listing.qtyKg, accepted: false, why: `Only ${c.listing.qtyKg} kg available` };
    if (shortfall < MIN_TAKE * c.listing.qtyKg)
      return { ...base, qtyKg: shortfall, accepted: false, why: `${c.listing.qtyKg} kg lot is too large to split for ${shortfall} kg` };
    const stops = [...keptStops, { farmerId: c.farmer.id, label: c.farmer.village, lat: c.farmer.lat, lng: c.farmer.lng }];
    const { order: route, km } = bestRoute(stops, buyer);
    const allocs = [...kept.map((a) => ({ qtyKg: a.qtyKg, priceAzn: a.priceAzn })), { qtyKg: shortfall, priceAzn: c.listing.priceAzn }];
    const costs = costsFor(allocs, km, stops.length, tender.qtyKg);
    const nearest = Math.min(...keptStops.map((s) => roadKm(s, c.farmer)));
    return {
      ...base, qtyKg: shortfall, accepted: true, costs, route,
      why: `Same grade, stage ${c.listing.ripeness} like the lost lot, ${Math.round(nearest)} km from the nearest pickup.`,
    };
  });
  out.sort((a, b) => Number(b.accepted) - Number(a.accepted) || (a.costs?.total ?? 1e9) - (b.costs?.total ?? 1e9));
  const ok = out.some((c) => c.accepted);
  return {
    shortfallKg: shortfall,
    cancelledFarmerId,
    cause,
    candidates: out,
    selected: ok ? 0 : undefined,
    status: ok ? 'proposed' : 'no_backup',
    before: order.costs,
    after: ok ? out[0].costs : undefined,
  };
}
