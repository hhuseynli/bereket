// Distances, routing and transport cost. Small n (<= 4 pickups), so routes are solved exactly.
import type { Stop } from './types';

export const ROAD_FACTOR = 1.25; // straight-line km to road km on mountain-foothill roads

export const TRANSPORT = {
  base: 12, // ₼ per trip (driver, loading)
  perKm: 0.15, // ₼ per road km (fuel, wear) for a 1.5 t refrigerated van
  perStop: 2.5, // ₼ per pickup (waiting, loading at farm)
};

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    const rest = [...xs.slice(0, i), ...xs.slice(i + 1)];
    for (const p of permutations(rest)) out.push([x, ...p]);
  });
  return out;
}

/** Best pickup order: visit every stop once, then drive to the destination. Returns ordered stops and km. */
export function bestRoute(stops: Stop[], dest: { lat: number; lng: number }): { order: Stop[]; km: number } {
  if (stops.length === 0) return { order: [], km: 0 };
  let best: { order: Stop[]; km: number } | null = null;
  for (const p of permutations(stops)) {
    let km = 0;
    for (let i = 0; i < p.length - 1; i++) km += roadKm(p[i], p[i + 1]);
    km += roadKm(p[p.length - 1], dest);
    if (!best || km < best.km) best = { order: p, km };
  }
  return best!;
}

export function transportCost(km: number, stops: number): number {
  return round2(TRANSPORT.base + TRANSPORT.perKm * km + TRANSPORT.perStop * stops);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
