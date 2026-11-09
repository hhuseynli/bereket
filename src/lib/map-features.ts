// Map features drawn over the borders in src/lib/map-data.json: cities, main highways, the Kür and Araz rivers and
// region names. Positions are real (lat, lng); roads and rivers follow their main towns, simplified for a small map.

/** rank 1 capital, 2 large city, 3 district centre, 4 village (shown only when zoomed in close) */
export const CITIES: { name: string; lat: number; lng: number; rank: 1 | 2 | 3 | 4 }[] = [
  { name: 'Bakı', lat: 40.409, lng: 49.867, rank: 1 },
  { name: 'Sumqayıt', lat: 40.59, lng: 49.669, rank: 2 },
  { name: 'Gəncə', lat: 40.683, lng: 46.361, rank: 2 },
  { name: 'Mingəçevir', lat: 40.764, lng: 47.059, rank: 2 },
  { name: 'Lənkəran', lat: 38.753, lng: 48.851, rank: 2 },
  { name: 'Şəki', lat: 41.192, lng: 47.171, rank: 2 },
  { name: 'Naxçıvan', lat: 39.209, lng: 45.412, rank: 2 },
  { name: 'Quba', lat: 41.361, lng: 48.513, rank: 2 },
  { name: 'Şirvan', lat: 39.932, lng: 48.921, rank: 2 },
  { name: 'Qusar', lat: 41.427, lng: 48.43, rank: 3 },
  { name: 'Xaçmaz', lat: 41.464, lng: 48.806, rank: 3 },
  { name: 'Şabran', lat: 41.216, lng: 48.986, rank: 3 },
  { name: 'Siyəzən', lat: 41.078, lng: 49.113, rank: 3 },
  { name: 'Şamaxı', lat: 40.631, lng: 48.636, rank: 3 },
  { name: 'İsmayıllı', lat: 40.787, lng: 48.152, rank: 3 },
  { name: 'Qəbələ', lat: 40.981, lng: 47.846, rank: 3 },
  { name: 'Göyçay', lat: 40.653, lng: 47.741, rank: 3 },
  { name: 'Kürdəmir', lat: 40.345, lng: 48.161, rank: 3 },
  { name: 'Yevlax', lat: 40.619, lng: 47.15, rank: 3 },
  { name: 'Zaqatala', lat: 41.633, lng: 46.643, rank: 3 },
  { name: 'Qazax', lat: 41.093, lng: 45.366, rank: 3 },
  { name: 'Tovuz', lat: 40.992, lng: 45.628, rank: 3 },
  { name: 'Şəmkir', lat: 40.829, lng: 46.017, rank: 3 },
  { name: 'Sabirabad', lat: 40.009, lng: 48.477, rank: 3 },
  { name: 'Salyan', lat: 39.596, lng: 48.985, rank: 3 },
  { name: 'Masallı', lat: 39.034, lng: 48.666, rank: 3 },
  { name: 'Astara', lat: 38.456, lng: 48.875, rank: 3 },
  { name: 'Ələt', lat: 39.945, lng: 49.408, rank: 3 },
  { name: 'Ağdam', lat: 39.993, lng: 46.93, rank: 3 },
  { name: 'Şuşa', lat: 39.758, lng: 46.75, rank: 3 },
  { name: 'Xudat', lat: 41.633, lng: 48.682, rank: 4 },
  { name: 'Nabran', lat: 41.8, lng: 48.7, rank: 4 },
  { name: 'Qaraçaylı', lat: 41.495, lng: 48.77, rank: 4 },
  { name: 'Ləcət', lat: 41.44, lng: 48.83, rank: 4 },
  { name: 'Hil', lat: 41.4, lng: 48.4, rank: 4 },
  { name: 'Amsar', lat: 41.38, lng: 48.47, rank: 4 },
  { name: 'Rustov', lat: 41.3, lng: 48.65, rank: 4 },
  { name: 'Talabı', lat: 41.336, lng: 48.562, rank: 4 },
  { name: 'Xınalıq', lat: 41.18, lng: 48.13, rank: 4 },
];

/** Main summits, drawn as a peak with the height. */
export const PEAKS: { name: string; lat: number; lng: number; m: number }[] = [
  { name: 'Bazardüzü', lat: 41.221, lng: 47.858, m: 4466 },
  { name: 'Şahdağ', lat: 41.285, lng: 48.012, m: 4243 },
  { name: 'Babadağ', lat: 41.03, lng: 48.42, m: 3629 },
];

const P = (name: string): [number, number] => { const c = CITIES.find((x) => x.name === name)!; return [c.lat, c.lng]; };

/** Main highways (M1 north, M2/M4 west, M3 south, the Şəki road), as lines through their towns. */
export const ROADS: { name: string; pts: [number, number][] }[] = [
  { name: 'M1', pts: [P('Bakı'), P('Sumqayıt'), [40.86, 49.37], P('Siyəzən'), P('Şabran'), P('Xaçmaz'), [41.77, 48.62]] },
  { name: '', pts: [P('Xaçmaz'), P('Quba'), P('Qusar')] },
  { name: 'M4', pts: [P('Bakı'), [40.52, 49.2], P('Şamaxı'), [40.57, 48.4], P('Kürdəmir')] },
  { name: 'M2', pts: [P('Ələt'), P('Kürdəmir'), [40.52, 47.65], P('Yevlax'), P('Gəncə'), P('Şəmkir'), P('Tovuz'), P('Qazax'), [41.25, 45.03]] },
  { name: '', pts: [P('Bakı'), P('Ələt')] },
  { name: 'M3', pts: [P('Ələt'), P('Salyan'), [39.3, 48.85], P('Masallı'), P('Lənkəran'), P('Astara')] },
  { name: '', pts: [P('Yevlax'), P('Şəki'), [41.42, 46.92], P('Zaqatala'), [41.73, 46.4]] },
  { name: '', pts: [P('Yevlax'), P('Ağdam'), P('Şuşa')] },
];

export const RIVERS: { name: string; pts: [number, number][] }[] = [
  { name: 'Kür', pts: [[41.3, 45.05], [41.08, 45.65], [40.95, 46.2], [40.9, 46.6], [40.84, 46.85], [40.77, 47.05], [40.62, 47.17], [40.4, 47.45], [40.22, 47.7], [40.05, 48.1], [40.0, 48.45], [39.85, 48.7], [39.6, 48.97], [39.4, 49.15], [39.3, 49.3]] },
  { name: 'Araz', pts: [[39.43, 47.35], [39.55, 47.62], [39.7, 47.95], [39.87, 48.25], [40.0, 48.45]] },
];

/** Landscape names, drawn in italics; size grows with the area they name. */
export const REGIONS: { name: string; lat: number; lng: number; rotate?: number; big?: boolean }[] = [
  { name: 'Böyük Qafqaz', lat: 41.33, lng: 47.75, rotate: -18, big: true },
  { name: 'Kiçik Qafqaz', lat: 40.15, lng: 46.0, rotate: -25, big: true },
  { name: 'Kür–Araz ovalığı', lat: 40.08, lng: 47.85, big: true },
  { name: 'Abşeron', lat: 40.56, lng: 50.2 },
  { name: 'Talış dağları', lat: 38.8, lng: 48.45, rotate: -70 },
];
