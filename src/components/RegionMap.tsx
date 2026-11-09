'use client';
// The pickup map: real borders and coastline (Natural Earth, bundled), main roads, rivers and towns of Azerbaijan,
// zoomed to whatever farms are in view, anywhere in the country. Routes are drawn as running stitches; a cancelled
// leg comes loose as a frayed thread; a proposed backup pulses. A far-away destination (Baku from Quba) leaves the
// map with a distance tag; a small locator shows where the view sits in the country.
import { useMemo } from 'react';
import mapData from '@/lib/map-data.json';
import { CITIES, PEAKS, REGIONS, RIVERS, ROADS } from '@/lib/map-features';
import { haversineKm } from '@/lib/geo';
import type { Farmer, Stop } from '@/lib/types';
import { useLang } from './lang';
import { MEDALLION } from './ui';

const W = 600;
const H = 680;
const AZ = mapData.countries.find((c) => c.name === 'Azerbaijan')!;
const COUNTRY = { w: 44.75, e: 50.65, s: 38.38, n: 41.95 }; // Azerbaijan, used when nothing is selected

// Mountain ridges, drawn as rows of small peaks (main crests, simplified)
const RIDGES: [number, number][][] = [
  [[41.86, 46.3], [41.7, 46.75], [41.55, 47.1], [41.38, 47.55], [41.24, 47.95], [41.2, 48.3]],
  [[41.08, 45.42], [40.8, 45.7], [40.5, 45.95], [40.15, 46.25], [39.75, 46.45]],
  [[39.1, 48.22], [38.85, 48.38], [38.6, 48.55]],
];

export interface MapProps {
  farmers: Farmer[];
  route: Stop[];
  dest: { lat: number; lng: number; label: string };
  routeKm?: number;
  cancelled?: Farmer;
  candidate?: Farmer;
  candidateConfirmed?: boolean;
  dim?: Farmer[];
  caption?: string;
}

type LL = { lat: number; lng: number };

function Med({ x, y, fill, size = 26, inner = '#F8F3EA', stroke, cross }: { x: number; y: number; fill: string; size?: number; inner?: string; stroke?: string; cross?: boolean }) {
  const s = size / 24;
  return (
    <g transform={`translate(${x - size / 2},${y - size / 2}) scale(${s})`}>
      <polygon points={MEDALLION} fill={fill} stroke={stroke} strokeWidth={stroke ? 1.8 : 0} />
      {!cross && <polygon points="12,6 18,12 12,18 6,12" fill={inner} />}
      {cross && <path d="M8 8 L16 16 M16 8 L8 16" stroke="#8C2B1F" strokeWidth="2.2" />}
    </g>
  );
}

function inRing(lng: number, lat: number, ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const onLand = (lng: number, lat: number) => mapData.countries.some((c) => c.rings.some((r) => inRing(lng, lat, r)));

/** The view: the farms in play with a margin, shaped to the plate; the destination joins when it is close by. */
function viewFor(points: LL[], dest: LL) {
  let b = { ...COUNTRY };
  let destInside = true;
  if (points.length) {
    const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
    const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
    const spread = Math.max(...points.map((p) => haversineKm(p, c)));
    destInside = haversineKm(dest, c) < Math.max(70, spread * 2.2);
    const all = destInside ? [...points, dest] : points;
    const la = all.map((p) => p.lat), ln = all.map((p) => p.lng);
    b = { s: Math.min(...la), n: Math.max(...la), w: Math.min(...ln), e: Math.max(...ln) };
  }
  // margin and a minimum size (about 35 km), then match the plate's shape
  const mid = (b.s + b.n) / 2;
  const kx = Math.cos((mid * Math.PI) / 180);
  const m = points.length ? 1.45 : 1.08;
  let spanLat = Math.max(b.n - b.s, 0.32) * m;
  let spanLng = Math.max(b.e - b.w, 0.32 / kx) * (points.length ? 1.3 : 1.06);
  if (spanLng * kx / spanLat > W / H) spanLat = (spanLng * kx * H) / W;
  else spanLng = (spanLat * W) / H / kx;
  const cLat = (b.s + b.n) / 2, cLng = (b.w + b.e) / 2;
  return { lat0: cLat - spanLat / 2, lat1: cLat + spanLat / 2, lng0: cLng - spanLng / 2, lng1: cLng + spanLng / 2, kx, destInside };
}

export function RegionMap({ farmers, route, dest, cancelled, candidate, candidateConfirmed, dim = [], caption, routeKm }: MapProps) {
  const { t } = useLang();
  const focus: LL[] = [...route, ...(cancelled ? [cancelled] : []), ...(candidate ? [candidate] : [])];
  const v = viewFor(focus, dest);
  const s = H / (v.lat1 - v.lat0); // px per degree of latitude
  const px = (lng: number) => (lng - v.lng0) * v.kx * s;
  const py = (lat: number) => (v.lat1 - lat) * s;
  const spanLat = v.lat1 - v.lat0;
  const viewKey = `${v.lat0.toFixed(3)}:${v.lng0.toFixed(3)}:${spanLat.toFixed(3)}`;

  // Base map, recomputed only when the view moves.
  const base = useMemo(() => {
    const path = (rings: number[][][]) => rings.map((r) => `M${r.map(([x, y]) => `${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('L')}Z`).join('');
    const line = (pts: [number, number][]) => `M${pts.map(([la, ln]) => `${px(ln).toFixed(1)} ${py(la).toFixed(1)}`).join('L')}`;
    const step = spanLat > 2.5 ? 1 : spanLat > 1 ? 0.5 : spanLat > 0.45 ? 0.25 : 0.1;
    const grat: { d: string; label: string; x: number; y: number; vertical: boolean }[] = [];
    for (let la = Math.ceil(v.lat0 / step) * step; la < v.lat1; la += step) grat.push({ d: `M0 ${py(la)}H${W}`, label: `${la.toFixed(step < 0.5 ? 2 : 1)}°N`, x: W - 6, y: py(la) - 4, vertical: false });
    for (let ln = Math.ceil(v.lng0 / step) * step; ln < v.lng1; ln += step) grat.push({ d: `M${px(ln)} 0V${H}`, label: `${ln.toFixed(step < 0.5 ? 2 : 1)}°E`, x: px(ln) + 4, y: 14, vertical: true });
    // peaks along the ridges, spaced evenly on screen
    const peaks: string[] = [];
    for (const r of RIDGES) for (let i = 0; i < r.length - 1; i++) {
      const a = { x: px(r[i][1]), y: py(r[i][0]) }, b = { x: px(r[i + 1][1]), y: py(r[i + 1][0]) };
      const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 22));
      for (let k = 0; k < n; k++) {
        const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
        if (x > -10 && x < W + 10 && y > -10 && y < H + 10) peaks.push(`M${(x - 6).toFixed(1)} ${(y + 4).toFixed(1)}L${x.toFixed(1)} ${(y - 5).toFixed(1)}L${(x + 6).toFixed(1)} ${(y + 4).toFixed(1)}`);
      }
    }
    // the sea's name, at the first open-water spot in view
    // the whole label (about 190 px wide) must sit on water and inside the plate
    const half = 100 / (v.kx * s);
    const fits = (p: LL) => p.lat > v.lat0 + spanLat * 0.12 && p.lat < v.lat1 - spanLat * 0.06 && p.lng - half > v.lng0 && p.lng + half < v.lng1
      && [-1, -0.5, 0, 0.5, 1].every((t) => !onLand(p.lng + t * half, p.lat) && !onLand(p.lng + t * half, p.lat + 12 / s));
    const seaSpots: LL[] = [{ lat: 40.9, lng: 50.2 }, { lat: 41.4, lng: 49.9 }, { lat: 40.0, lng: 50.6 }, { lat: 39.3, lng: 50.0 }, { lat: 41.9, lng: 49.6 }];
    let sea = seaSpots.find(fits);
    for (let i = 1; !sea && i < 10; i++) for (let j = 1; !sea && j < 10; j++) {
      const p = { lat: v.lat0 + (spanLat * i) / 10, lng: v.lng0 + ((v.lng1 - v.lng0) * j) / 10 };
      if (fits(p)) sea = p;
    }
    return {
      neighbours: mapData.countries.filter((c) => c.name !== 'Azerbaijan').map((c) => ({ name: c.name, d: path(c.rings) })),
      az: path(AZ.rings),
      grat,
      peaks: peaks.join(''),
      rivers: RIVERS.map((r) => ({ name: r.name, d: line(r.pts), mid: r.pts[Math.floor(r.pts.length / 2)] })),
      roads: ROADS.map((r) => { const k = Math.floor((r.pts.length - 1) / 2); return { name: r.name, d: line(r.pts), mid: [(r.pts[k][0] + r.pts[k + 1][0]) / 2, (r.pts[k][1] + r.pts[k + 1][1]) / 2] as [number, number] }; }),
      sea,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const stops = route.map((r) => ({ x: px(r.lng), y: py(r.lat) }));
  const last = stops[stops.length - 1];
  const destPt = { x: px(dest.lng), y: py(dest.lat) };
  let exit: { x: number; y: number } | undefined;
  if (last && !v.destInside) {
    const dx = destPt.x - last.x, dy = destPt.y - last.y;
    let t = 1;
    if (destPt.x > W - 28) t = Math.min(t, (W - 28 - last.x) / dx);
    if (destPt.y > H - 28) t = Math.min(t, (H - 28 - last.y) / dy);
    if (destPt.x < 28) t = Math.min(t, (28 - last.x) / dx);
    if (destPt.y < 28) t = Math.min(t, (28 - last.y) / dy);
    exit = { x: last.x + dx * t, y: last.y + dy * t };
  }
  const end = exit ?? destPt;
  const d = stops.length ? `M${stops.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')} L${end.x.toFixed(1)} ${end.y.toFixed(1)}` : '';
  const routeKey = route.map((r) => r.farmerId).join('-');
  const fcol = (id: string) => farmers.find((f) => f.id === id)?.color ?? '#999';
  let fray: string | undefined;
  if (cancelled && route.length) {
    const near = route.reduce((b, r) => (Math.hypot(r.lat - cancelled.lat, r.lng - cancelled.lng) < Math.hypot(b.lat - cancelled.lat, b.lng - cancelled.lng) ? r : b), route[0]);
    fray = `M${px(near.lng)} ${py(near.lat)} L${px(cancelled.lng)} ${py(cancelled.lat)}`;
  }
  const cx = route.length ? route.reduce((a, r) => a + r.lng, 0) / route.length : (v.lng0 + v.lng1) / 2;
  const label = (f: LL, text: string, color = '#1F1B16', dy = 5, weight = 600, side?: 'left' | 'right') => {
    let left = side ? side === 'left' : f.lng < cx - 0.01;
    const w = text.length * 8.2;
    if (left && px(f.lng) - 18 - w < 6) left = false;
    if (!left && px(f.lng) + 18 + w > W - 6) left = true;
    return (
      <text x={px(f.lng) + (left ? -18 : 18)} y={py(f.lat) + dy} textAnchor={left ? 'end' : 'start'} fill={color} fontSize="15" fontWeight={weight} stroke="#FBF7EF" strokeWidth="5" paintOrder="stroke" fontFamily="var(--sans)">{text}</text>
    );
  };

  // Towns: the bigger ones when zoomed out; none where a farm marker already sits.
  const marks = [...stops, ...(cancelled ? [{ x: px(cancelled.lng), y: py(cancelled.lat) }] : []), ...(candidate ? [{ x: px(candidate.lng), y: py(candidate.lat) }] : []), destPt];
  const maxRank = spanLat > 2.4 ? 2 : spanLat > 0.9 ? 3 : 4;
  const towns = CITIES.filter((c) => c.rank <= maxRank).map((c) => ({ ...c, x: px(c.lng), y: py(c.lat) }))
    .filter((c) => c.x > 8 && c.x < W - 8 && c.y > 20 && c.y < H - 90 && !marks.some((m) => Math.hypot(m.x - c.x, m.y - c.y) < 30));

  // Scale bar: a round distance about 90 px long
  const kmPerPx = (spanLat * 111.2) / H;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200].find((k) => k / kmPerPx >= 70) ?? 200;
  const bar = nice / kmPerPx;
  const zoomedIn = spanLat < 2.2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={t(
        `Map of the pickup route: ${route.map((r) => r.label).join(', ')} to ${dest.label}${cancelled ? `; ${cancelled.village} cancelled` : ''}${candidate ? `; backup at ${candidate.village}` : ''}`,
        `Götürmə marşrutunun xəritəsi: ${route.map((r) => r.label).join(', ')} → ${dest.label}${cancelled ? `; ${cancelled.village} ləğv etdi` : ''}${candidate ? `; ehtiyat: ${candidate.village}` : ''}`,
      )}>
      <defs>
        <clipPath id="plate"><rect x="0" y="0" width={W} height={H} /></clipPath>
        <pattern id="waves" width="14" height="7" patternUnits="userSpaceOnUse"><path d="M0 5 Q3.5 2 7 5 T14 5" fill="none" stroke="#B9C9D6" strokeWidth="0.8" /></pattern>
        <filter id="shore" x="-5%" y="-5%" width="110%" height="110%"><feMorphology operator="dilate" radius="3" /><feGaussianBlur stdDeviation="2.5" /></filter>
      </defs>
      <g clipPath="url(#plate)">
        {/* water, with a soft shoreline under the land */}
        <rect x="0" y="0" width={W} height={H} fill="#DCE6EC" />
        <rect x="0" y="0" width={W} height={H} fill="url(#waves)" opacity="0.55" />
        <g filter="url(#shore)" opacity="0.55"><path d={base.az} fill="#A9BFCF" />{base.neighbours.map((n) => <path key={n.name} d={n.d} fill="#A9BFCF" />)}</g>
        {base.neighbours.map((n) => <path key={n.name} d={n.d} fill="#ECE5D6" stroke="#CDBFA5" strokeWidth="0.8" />)}
        <path d={base.az} fill="#FBF7EF" stroke="#7E6E52" strokeWidth="1.3" strokeDasharray="7 2 1.5 2" strokeLinejoin="round" />
        {base.grat.map((g, i) => <path key={i} d={g.d} stroke="#9A8B6E" strokeOpacity="0.16" strokeWidth="0.8" />)}
        <path d={base.peaks} fill="none" stroke="#B5A381" strokeWidth="1.2" strokeLinejoin="round" opacity="0.75" />

        {base.rivers.map((r) => <path key={r.name} d={r.d} fill="none" stroke="#7FA2BD" strokeWidth={zoomedIn ? 2.2 : 1.6} strokeLinecap="round" strokeLinejoin="round" />)}
        {base.roads.map((r, i) => <path key={`c${i}`} d={r.d} fill="none" stroke="#C3B395" strokeWidth={zoomedIn ? 5 : 3.4} strokeLinecap="round" strokeLinejoin="round" />)}
        {base.roads.map((r, i) => <path key={`r${i}`} d={r.d} fill="none" stroke="#FFFDF7" strokeWidth={zoomedIn ? 2.6 : 1.6} strokeLinecap="round" strokeLinejoin="round" />)}
        {base.roads.filter((r) => r.name).map((r) => {
          const x = px(r.mid[1]), y = py(r.mid[0]);
          if (x < 20 || x > W - 20 || y < 20 || y > H - 90) return null;
          return <g key={r.name}><rect x={x - 12} y={y - 8} width="24" height="15" rx="2" fill="#F1E6CF" stroke="#9A8B6E" strokeWidth="0.8" /><text x={x} y={y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#5F574A" fontFamily="var(--sans)">{r.name}</text></g>;
        })}
        {base.rivers.map((r) => (
          <text key={`t${r.name}`} x={px(r.mid[1]) + 6} y={py(r.mid[0]) - 6} fontSize="12" fontStyle="italic" fill="#5D7F9A" fontFamily="var(--serif)" stroke="#FBF7EF" strokeWidth="3" paintOrder="stroke">{r.name}</text>
        ))}
        {REGIONS.filter((r) => (r.big ? spanLat > 0.8 : true)).map((r) => (
          <text key={r.name} x={px(r.lng)} y={py(r.lat)} textAnchor="middle" fontSize={r.big ? 15 : 12} fontStyle="italic" letterSpacing={r.big ? 4 : 2} fill="#9A8B6E" fontFamily="var(--serif)"
            transform={r.rotate ? `rotate(${r.rotate} ${px(r.lng)} ${py(r.lat)})` : undefined}>{r.name}</text>
        ))}
        {base.sea && (
          <text x={px(base.sea.lng)} y={py(base.sea.lat)} textAnchor="middle" fontSize={zoomedIn ? 16 : 19} fontStyle="italic" letterSpacing="5" fill="#57718D" fontFamily="var(--serif)">Xəzər dənizi</text>
        )}
        {base.grat.filter((g) => (g.vertical ? !(zoomedIn && g.x > W - 160) : g.y < H - 75)).map((g, i) => <text key={`gl${i}`} x={g.x} y={g.y} textAnchor={g.vertical ? 'start' : 'end'} fontSize="9.5" fill="#8C7E64" fontFamily="var(--sans)">{g.label}</text>)}

        {towns.map((c) => (
          <g key={c.name}>
            {c.rank === 4 ? <circle cx={c.x} cy={c.y} r="2" fill="#6F6556" /> : c.rank === 1 ? <rect x={c.x - 4.5} y={c.y - 4.5} width="9" height="9" fill="#1F1B16" /> : <circle cx={c.x} cy={c.y} r={c.rank === 2 ? 3.6 : 2.6} fill="#FBF7EF" stroke="#4A4237" strokeWidth="1.4" />}
            <text x={c.x + 7} y={c.y + 4} fontSize={c.rank === 1 ? 14 : c.rank === 2 ? 12.5 : 11} fontWeight={c.rank === 1 ? 700 : 500} fill="#4A4237" stroke="#FBF7EF" strokeWidth="3.5" paintOrder="stroke" fontFamily="var(--sans)">{c.name}</text>
          </g>
        ))}

        {PEAKS.map((p) => {
          const x = px(p.lng), y = py(p.lat);
          if (x < 10 || x > W - 10 || y < 20 || y > H - 90 || spanLat > 2.6) return null;
          return (
            <g key={p.name}>
              <path d={`M${x - 7} ${y + 5}L${x} ${y - 7}L${x + 7} ${y + 5}Z`} fill="#8C7E64" />
              <text x={x} y={y + 18} textAnchor="middle" fontSize="10.5" fill="#6F6556" fontFamily="var(--sans)" stroke="#FBF7EF" strokeWidth="3" paintOrder="stroke">{p.name} {p.m.toLocaleString('en-US')} m</text>
            </g>
          );
        })}

        {dim.map((f) => (
          <g key={f.id} opacity="0.5"><Med x={px(f.lng)} y={py(f.lat)} fill="#FBF7EF" stroke="#A89A80" size={15} /></g>
        ))}

        {fray && <path d={fray} fill="none" stroke="#C49A92" strokeWidth="1.8" strokeDasharray="2 7" strokeLinecap="round" />}
        {route.length > 0 && (
          <>
            <path d={d} fill="none" stroke="#FBF7EF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
            <path key={routeKey} d={d} fill="none" stroke="#8C2B1F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 6"
              style={{ animation: 'stitch 1.6s ease-out both' }} pathLength={600} />
          </>
        )}

        {cancelled && (
          <g>
            <Med x={px(cancelled.lng)} y={py(cancelled.lat)} fill="#F8F3EA" stroke="#B9776C" cross />
            {label(cancelled, `${cancelled.village} · ${t('cancelled', 'ləğv etdi')}`, '#8C2B1F', 5, 600, 'left')}
          </g>
        )}
        {route.map((r) => (
          <g key={r.farmerId}>
            {candidate && r.farmerId === candidate.id ? null : <Med x={px(r.lng)} y={py(r.lat)} fill={fcol(r.farmerId)} />}
            {candidate && r.farmerId === candidate.id ? null : label(r, r.label)}
          </g>
        ))}
        {candidate && (
          <g>
            {!candidateConfirmed && <circle className="pulse" cx={px(candidate.lng)} cy={py(candidate.lat)} r="16" fill="none" stroke="#5C6B34" strokeWidth="1.5" />}
            <Med x={px(candidate.lng)} y={py(candidate.lat)} fill="#5C6B34" />
            {label(candidate, `${candidate.village} · ${candidateConfirmed ? t('confirmed', 'təsdiqlədi') : t('backup', 'ehtiyat')}`, '#4E5C2B', 18, 600, 'right')}
          </g>
        )}
        {route.length > 0 && (exit ? (
          <g>
            <rect x={exit.x - 9} y={exit.y - 9} width="18" height="18" fill="#1F1B16" />
            <text x={exit.x - 16} y={exit.y + 5} textAnchor="end" fontSize="15" fontWeight="700" fill="#1F1B16" stroke="#FBF7EF" strokeWidth="5" paintOrder="stroke" fontFamily="var(--sans)">
              {t(`to ${dest.label}`, `→ ${dest.label}`)} · {Math.round(haversineKm(route[route.length - 1], dest) * 1.25)} km{routeKm ? ` · ${routeKm} km ${t('loop', 'dövrə')}` : ''}
            </text>
          </g>
        ) : (
          <>
            <rect x={destPt.x - 11} y={destPt.y - 11} width="22" height="22" fill="#1F1B16" />
            {label(dest, dest.label, '#1F1B16', 34, 700, 'left')}
          </>
        ))}

        {/* compass */}
        <g transform={`translate(${W - 32} ${H - 44})`} opacity="0.85">
          <circle r="15" fill="#FBF7EF" stroke="#9A8B6E" strokeWidth="0.8" />
          <path d="M0 -12 L4 2 L0 -1 L-4 2 Z" fill="#1F1B16" />
          <path d="M0 12 L4 -2 L0 1 L-4 -2 Z" fill="#B5A381" />
          <text y="-19" textAnchor="middle" fontSize="10" fontWeight="700" fill="#4A4237" fontFamily="var(--sans)">{t('N', 'Ş')}</text>
        </g>

        {/* locator: where this view sits in Azerbaijan */}
        {zoomedIn && <Locator view={v} />}
      </g>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="none" stroke="#B9AA8D" />
      <g transform={`translate(18 ${H - 70})`}>
        <rect x="-8" y="-6" width={Math.max(bar + 110, caption ? caption.length * 9.6 + 16 : 0)} height="62" fill="#FBF7EF" opacity="0.88" rx="2" />
        {caption && <text x="0" y="16" fontFamily="var(--serif)" fontSize="17" fontWeight="600" fill="#1F1B16">{caption}</text>}
        <rect x="0" y="32" width={bar / 2} height="5" fill="#1F1B16" />
        <rect x={bar / 2} y="32" width={bar / 2} height="5" fill="#FBF7EF" stroke="#1F1B16" strokeWidth="0.8" />
        <text x={bar + 8} y="38" fontFamily="var(--sans)" fontSize="11.5" fill="#5F574A">{nice} km</text>
        <text x="0" y="51" fontFamily="var(--sans)" fontSize="9" fill="#8C7E64">{t('Borders: Natural Earth · roads simplified', 'Sərhədlər: Natural Earth · yollar sadələşdirilib')}</text>
      </g>
    </svg>
  );
}

/** A small Azerbaijan with a box around the current view. */
function Locator({ view }: { view: { lat0: number; lat1: number; lng0: number; lng1: number; kx: number } }) {
  const w = 118, h = 78;
  const sx = w / ((COUNTRY.e - COUNTRY.w) * view.kx), sy = h / (COUNTRY.n - COUNTRY.s);
  const k = Math.min(sx, sy);
  const x = (lng: number) => (lng - COUNTRY.w) * view.kx * k;
  const y = (lat: number) => (COUNTRY.n - lat) * k;
  const d = AZ.rings.map((r) => `M${r.map(([a, b]) => `${x(a).toFixed(1)} ${y(b).toFixed(1)}`).join('L')}Z`).join('');
  const bx = Math.max(0, x(view.lng0)), by = Math.max(0, y(view.lat1));
  return (
    <g transform={`translate(${W - w - 16} 14)`}>
      <rect x="-6" y="-6" width={w + 12} height={h + 12} fill="#FBF7EF" stroke="#B9AA8D" strokeWidth="0.8" rx="2" opacity="0.95" />
      <path d={d} fill="#EDE4D0" stroke="#7E6E52" strokeWidth="0.7" />
      <rect x={bx} y={by} width={Math.max(5, x(view.lng1) - bx)} height={Math.max(5, y(view.lat0) - by)} fill="rgba(140,43,31,0.12)" stroke="#8C2B1F" strokeWidth="1.3" />
      <rect x={x(49.867) - 2} y={y(40.409) - 2} width="4" height="4" fill="#1F1B16" />
    </g>
  );
}
