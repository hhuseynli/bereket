'use client';
// A stylized cartographic plate of the Quba–Xaçmaz pickup region. Baku is ~170 km away, so the run there
// leaves the plate with a distance tag. Routes are drawn as running stitches; a cancelled leg comes loose
// as a frayed thread; a proposed backup pulses.
import type { Farmer, Stop } from '@/lib/types';
import { MEDALLION } from './ui';

const W = 600;
const H = 680;
const LNG0 = 48.3, LNG1 = 49.15, LAT0 = 41.0, LAT1 = 41.72;
const px = (lng: number) => ((lng - LNG0) / (LNG1 - LNG0)) * W;
const py = (lat: number) => ((LAT1 - lat) / (LAT1 - LAT0)) * H;

// Approximate Caspian coastline, north to south (lat, lng). Stylized, not for navigation.
const COAST: [number, number][] = [
  [41.85, 48.58], [41.77, 48.66], [41.64, 48.8], [41.52, 48.95], [41.38, 49.07], [41.25, 49.15], [41.1, 49.2], [40.95, 49.32],
  [40.85, 49.42], [40.7, 49.52], [40.59, 49.65], [40.56, 49.8], [40.57, 49.95], [40.58, 50.05], [40.53, 50.2], [40.47, 50.36],
  [40.4, 50.3], [40.37, 50.2], [40.38, 50.05], [40.35, 49.92], [40.34, 49.84], [40.28, 49.76], [40.18, 49.62], [40.1, 49.55],
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

/** Where the straight line from a (inside) towards b leaves the plate. */
function exitPoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  let t = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  if (b.x > W - 24) t = Math.min(t, (W - 24 - a.x) / dx);
  if (b.y > H - 24) t = Math.min(t, (H - 24 - a.y) / dy);
  if (b.x < 24) t = Math.min(t, (24 - a.x) / dx);
  if (b.y < 24) t = Math.min(t, (24 - a.y) / dy);
  return { x: a.x + dx * t, y: a.y + dy * t, inside: t >= 1 };
}

export function RegionMap({ farmers, route, dest, cancelled, candidate, candidateConfirmed, dim = [], caption, routeKm }: MapProps) {
  const sea = `M${COAST.map(([la, ln]) => `${px(ln).toFixed(1)} ${py(la).toFixed(1)}`).join(' L')} L${W} ${H} L${W} 0 Z`;
  const coast = `M${COAST.map(([la, ln]) => `${px(ln).toFixed(1)} ${py(la).toFixed(1)}`).join(' L')}`;
  const stops = route.map((r) => ({ x: px(r.lng), y: py(r.lat) }));
  const last = stops[stops.length - 1];
  const exit = last ? exitPoint(last, { x: px(dest.lng), y: py(dest.lat) }) : undefined;
  const d = stops.length ? `M${stops.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L')} L${exit!.x.toFixed(1)} ${exit!.y.toFixed(1)}` : '';
  const routeKey = route.map((r) => r.farmerId).join('-');
  const fcol = (id: string) => farmers.find((f) => f.id === id)?.color ?? '#999';
  let fray: string | undefined;
  if (cancelled && route.length) {
    const near = route.reduce((b, r) => (Math.hypot(r.lat - cancelled.lat, r.lng - cancelled.lng) < Math.hypot(b.lat - cancelled.lat, b.lng - cancelled.lng) ? r : b), route[0]);
    fray = `M${px(near.lng)} ${py(near.lat)} L${px(cancelled.lng)} ${py(cancelled.lat)}`;
  }
  // Labels go on the outside of the cluster: west of the centre to the left, east to the right.
  const cx = route.length ? route.reduce((a, r) => a + r.lng, 0) / route.length : 48.6;
  const label = (f: { lat: number; lng: number }, text: string, color = '#1F1B16', dy = 5, weight = 600, side?: 'left' | 'right') => {
    let left = side ? side === 'left' : f.lng < cx - 0.01;
    const w = text.length * 8.2;
    if (left && px(f.lng) - 18 - w < 6) left = false;
    if (!left && px(f.lng) + 18 + w > W - 6) left = true;
    return (
      <text x={px(f.lng) + (left ? -18 : 18)} y={py(f.lat) + dy} textAnchor={left ? 'end' : 'start'} fill={color} fontSize="15" fontWeight={weight} stroke="#F8F3EA" strokeWidth="5" paintOrder="stroke" fontFamily="var(--sans)">{text}</text>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`Map of the pickup route: ${route.map((r) => r.label).join(', ')} to ${dest.label}${cancelled ? `; ${cancelled.village} cancelled` : ''}${candidate ? `; backup at ${candidate.village}` : ''}`}>
      <defs>
        <pattern id="seahatch" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="1" fill="#CDD3E0" /></pattern>
        <clipPath id="plate"><rect x="0" y="0" width={W} height={H} /></clipPath>
      </defs>
      <g clipPath="url(#plate)">
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} fill="#F8F3EA" stroke="#CDBFA5" />
      <path d={sea} fill="url(#seahatch)" />
      <path d={coast} fill="none" stroke="#9AA6BE" strokeWidth="1" />
      <text x={px(49.08)} y={py(41.42)} fill="#6B7896" fontSize="17" fontStyle="italic" letterSpacing="6" fontFamily="var(--serif)" transform={`rotate(90 ${px(49.08)} ${py(41.42)})`}>Caspian Sea</text>
      <text x={px(48.34)} y={py(41.13)} fill="#9A8B6E" fontSize="14" fontStyle="italic" letterSpacing="3" fontFamily="var(--serif)">Greater Caucasus foothills</text>

      {dim.map((f) => (
        <g key={f.id} opacity="0.45"><Med x={px(f.lng)} y={py(f.lat)} fill="none" stroke="#A89A80" size={16} /></g>
      ))}

      {fray && <path d={fray} fill="none" stroke="#C49A92" strokeWidth="1.8" strokeDasharray="2 7" strokeLinecap="round" />}
      {route.length > 0 && (
        <path key={routeKey} d={d} fill="none" stroke="#8C2B1F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 6"
          style={{ animation: 'stitch 1.6s ease-out both' }} pathLength={600} />
      )}

      {cancelled && (
        <g>
          <Med x={px(cancelled.lng)} y={py(cancelled.lat)} fill="#F8F3EA" stroke="#B9776C" cross />
          {label(cancelled, `${cancelled.village} · cancelled`, '#8C2B1F', 5, 600, 'left')}
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
          {label(candidate, `${candidate.village} · ${candidateConfirmed ? 'confirmed' : 'backup'}`, '#4E5C2B', 18, 600, 'right')}
        </g>
      )}
      {exit && (exit.inside ? (
        <>
          <rect x={px(dest.lng) - 11} y={py(dest.lat) - 11} width="22" height="22" fill="#1F1B16" />
          {label(dest, dest.label, '#1F1B16', 34, 700, 'left')}
        </>
      ) : (
        <g>
          <rect x={exit.x - 9} y={exit.y - 9} width="18" height="18" fill="#1F1B16" />
          <text x={exit.x - 16} y={exit.y + 5} textAnchor="end" fontSize="15" fontWeight="700" fill="#1F1B16" stroke="#F8F3EA" strokeWidth="5" paintOrder="stroke" fontFamily="var(--sans)">
            to {dest.label}{routeKm ? ` · ${routeKm} km loop` : ''}
          </text>
        </g>
      ))}
      </g>
      {caption && (
        <g transform={`translate(24 ${H - 64})`}>
          <text x="0" y="18" fontFamily="var(--serif)" fontSize="18" fontWeight="600" fill="#1F1B16">{caption}</text>
          {/* 600 px spans ~71 km here, so 85 px is ~10 km */}
          <rect x="0" y="34" width="28" height="5" fill="#1F1B16" />
          <rect x="28" y="34" width="28" height="5" fill="#F8F3EA" stroke="#1F1B16" />
          <rect x="56" y="34" width="29" height="5" fill="#1F1B16" />
          <text x="95" y="40" fontFamily="var(--sans)" fontSize="12" fill="#5F574A">10 km · stylized</text>
        </g>
      )}
    </svg>
  );
}
