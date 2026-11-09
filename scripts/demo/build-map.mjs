#!/usr/bin/env node
// Builds src/lib/map-data.json: Azerbaijan and its neighbours from Natural Earth (world-atlas, 1:10m), clipped to
// the region and simplified, so the map works offline. Run again only to change the area or the detail:
//   node scripts/demo/build-map.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const world = require('world-atlas/countries-10m.json');
const BBOX = { w: 41.5, e: 53, s: 35.5, n: 44.5 };
const KEEP = { '031': 'Azerbaijan', '051': 'Armenia', '268': 'Georgia', '643': 'Russia', '364': 'Iran', '792': 'Turkey', '795': 'Turkmenistan', '398': 'Kazakhstan' };
const TOL = 0.004; // degrees (~400 m): plenty for a city-to-region map

// Sutherland–Hodgman clip of one ring against the box.
function clip(ring) {
  const edges = [
    [(p) => p[0] >= BBOX.w, (a, b) => at(a, b, 0, BBOX.w)],
    [(p) => p[0] <= BBOX.e, (a, b) => at(a, b, 0, BBOX.e)],
    [(p) => p[1] >= BBOX.s, (a, b) => at(a, b, 1, BBOX.s)],
    [(p) => p[1] <= BBOX.n, (a, b) => at(a, b, 1, BBOX.n)],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
function at(a, b, k, v) { const t = (v - a[k]) / (b[k] - a[k]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

// Douglas–Peucker. A closed ring (first point = last) is split at its farthest point first.
function simplify(pts) {
  if (pts.length < 4) return pts;
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (pts.length > 4 && fx === lx && fy === ly) {
    let far = 1;
    for (let k = 1; k < pts.length - 1; k++) if (Math.hypot(pts[k][0] - fx, pts[k][1] - fy) > Math.hypot(pts[far][0] - fx, pts[far][1] - fy)) far = k;
    return [...dp(pts.slice(0, far + 1)).slice(0, -1), ...dp(pts.slice(far))];
  }
  return dp(pts);
}
function dp(pts) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let max = 0, idx = -1;
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = k; }
    }
    if (max > TOL) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

const countries = [];
for (const g of world.objects.countries.geometries) {
  if (!KEEP[g.id]) continue;
  const f = feature(world, g);
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) for (const ring of poly) {
    const c = simplify(clip(ring)).map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    if (c.length >= 3) rings.push(c);
  }
  if (rings.length) countries.push({ id: g.id, name: KEEP[g.id], rings });
}
const out = { source: 'Natural Earth 1:10m via world-atlas (public domain), clipped and simplified', bbox: BBOX, countries };
const file = path.join(ROOT, 'src/lib/map-data.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`${file}: ${countries.map((c) => `${c.name} ${c.rings.reduce((n, r) => n + r.length, 0)} pts`).join(', ')} · ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
