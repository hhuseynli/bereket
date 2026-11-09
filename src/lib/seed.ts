// Demo data. All people and businesses are fictional. Prices are placeholders to be checked
// against real local wholesale prices before the pitch.
import type { Buyer, Farmer, Listing, State, Tender } from './types';

// ---------- Demo timeline ----------
// The scenario plays on one "demo day" in Baku (UTC+4, no daylight saving): it opens at 14:00, the buyer
// wants the tomatoes at 09:00 the next morning, and the seeded listings went up the day before.
// DEMO_DATE=YYYY-MM-DD pins the day; without it the demo day is today's date in Baku, so the dates on
// screen match the day of the pitch. Every time below is derived from that one date.

const BAKU_OFFSET_H = 4;

export function demoDate(): string {
  const env = process.env.DEMO_DATE;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env)) return env;
  return new Date(Date.now() + BAKU_OFFSET_H * 3600_000).toISOString().slice(0, 10);
}

/** A Baku wall-clock time on the demo day (plus dayOffset days), as a UTC ISO string. */
export function bakuAt(dayOffset: number, hour: number, minute = 0, day = demoDate()): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, hour - BAKU_OFFSET_H, minute)).toISOString();
}

export function timeline(day = demoDate()) {
  return {
    day,
    start: bakuAt(0, 14, 0, day), // demo "now" when the app starts or resets
    deadline: bakuAt(1, 9, 0, day), // tender T-1042 delivery, also where T jumps the clock
    seededAt: bakuAt(-1, 12, 0, day), // when the seeded listings were created
    cucumberDeadline: bakuAt(3, 9, 0, day),
  };
}
export const demoStart = () => timeline().start;
export const demoDeadline = () => timeline().deadline;

export const C = {
  indigo: '#263B6E',
  madder: '#8C2B1F',
  saffron: '#C08A2A',
  olive: '#5C6B34',
  walnut: '#7A5638',
  slate: '#4F6D8A',
  plum: '#6E3B5C',
  teal: '#2F6B66',
};

const F = (
  id: string, name: string, village: string, region: string, lat: number, lng: number,
  rating: number, deals: number, color: string,
): Farmer => ({ id, name, village, region, lat, lng, rating, deals, color });

export function seedFarmers(): Farmer[] {
  return [
    F('f-elsen', 'Elşən Məmmədov', 'Quba', 'Quba', 41.3611, 48.5134, 4.9, 31, C.indigo),
    F('f-gulnare', 'Gülnarə Həsənova', 'Xaçmaz', 'Xaçmaz', 41.4635, 48.8056, 4.8, 27, C.madder),
    F('f-rauf', 'Rauf Əliyev', 'Qusar', 'Qusar', 41.4275, 48.4302, 4.6, 12, C.saffron),
    F('f-sebine', 'Səbinə Kərimova', 'Talabı', 'Quba', 41.336, 48.562, 4.8, 23, C.olive),
    F('f-nurlan', 'Nurlan Quliyev', 'Qaraçaylı', 'Xaçmaz', 41.495, 48.77, 4.4, 9, C.walnut),
    F('f-tofiq', 'Tofiq Bağırov', 'Şabran', 'Şabran', 41.216, 48.987, 4.7, 18, C.slate),
    F('f-ferid', 'Fərid Cəfərov', 'Xudat', 'Xaçmaz', 41.633, 48.682, 4.5, 15, C.plum),
    F('f-nermin', 'Nərmin Səfərova', 'Ləcət', 'Xaçmaz', 41.44, 48.83, 4.3, 7, C.teal),
    F('f-elnur', 'Elnur Babayev', 'Qırmızı Qəsəbə', 'Quba', 41.37, 48.523, 4.7, 19, C.saffron),
    F('f-aynur', 'Aynur Rzayeva', 'Hil', 'Qusar', 41.4, 48.4, 4.9, 40, C.olive),
    F('f-vuqar', 'Vüqar Nəsirov', 'Amsar', 'Quba', 41.38, 48.47, 4.6, 22, C.madder),
    F('f-kamran', 'Kamran İsmayılov', 'Gədəbəy', 'Gədəbəy', 40.57, 45.81, 4.5, 33, C.indigo),
    F('f-leyla', 'Leyla Abbasova', 'Göygöl', 'Göygöl', 40.587, 46.317, 4.8, 14, C.plum),
    F('f-ramil', 'Ramil Hüseynov', 'Şabran', 'Şabran', 41.23, 48.95, 4.2, 6, C.teal),
    F('f-zaur', 'Zaur Qasımov', 'Qəbələ', 'Qəbələ', 40.98, 47.85, 4.6, 25, C.walnut),
    F('f-gulay', 'Gülay Əhmədova', 'Siyəzən', 'Siyəzən', 41.08, 49.11, 4.7, 11, C.slate),
    F('f-murad', 'Murad Vəliyev', 'Liman', 'Lənkəran', 38.874, 48.808, 4.4, 16, C.saffron),
    F('f-sevinc', 'Sevinc Hacıyeva', 'Qax', 'Qax', 41.42, 46.92, 4.9, 29, C.olive),
    F('f-orxan', 'Orxan Məlikov', 'Göyçay', 'Göyçay', 40.653, 47.741, 4.5, 13, C.indigo),
  ];
}

export function seedBuyers(): Buyer[] {
  return [
    { id: 'b-nergiz', name: 'Nərgiz Kitchen Group', kind: 'Restaurant group', address: 'Nəsimi, Baku', lat: 40.392, lng: 49.846, rating: 4.8 },
  ];
}

let n = 0;
let seedDay = '';
const L = (
  farmerId: string, product: string, variety: string, grade: 1 | 2 | 3, qtyKg: number, priceAzn: number,
  ripeness: number, extra: Partial<Listing> = {},
): Listing => ({
  id: `l-${++n}`,
  farmerId, product, variety, grade, qtyKg, priceAzn, ripeness,
  ripenessConfidence: 0.86,
  defects: [],
  harvest: seedDay,
  status: 'live',
  createdAt: timeline(seedDay).seededAt,
  source: 'seed',
  ...extra,
});

export function seedListings(day = demoDate()): Listing[] {
  n = 0;
  seedDay = day;
  return [
    // Tomatoes, Roma, Grade 1: the candidates for tender T-1042
    L('f-gulnare', 'Tomato', 'Roma', 1, 140, 1.2, 4),
    L('f-rauf', 'Tomato', 'Roma', 1, 80, 1.1, 3),
    L('f-sebine', 'Tomato', 'Roma', 1, 90, 1.22, 4),
    L('f-nurlan', 'Tomato', 'Roma', 1, 220, 1.0, 6, { defects: ['Fully red, soft spots on a few fruit'] }),
    L('f-tofiq', 'Tomato', 'Roma', 1, 260, 1.25, 3),
    L('f-ferid', 'Tomato', 'Roma', 1, 120, 1.18, 5),
    // Tomatoes that fail the spec
    L('f-ramil', 'Tomato', 'Roma', 3, 200, 0.7, 5, { defects: ['Cracked skins on many fruit'] }),
    L('f-nermin', 'Tomato', 'Roma', 2, 300, 0.85, 4),
    L('f-elnur', 'Tomato', 'Cherry', 1, 60, 2.4, 5),
    // Everything else on the platform
    L('f-elsen', 'Apple', 'Qızıl Əhmədi', 1, 300, 0.9, 0),
    L('f-gulnare', 'Cucumber', 'Local', 1, 120, 1.3, 0),
    L('f-rauf', 'Potato', 'Agria', 1, 500, 0.55, 0),
    L('f-sebine', 'Pepper', 'Sweet', 1, 60, 1.8, 0),
    L('f-nurlan', 'Pepper', 'Sweet', 2, 90, 1.4, 0),
    L('f-tofiq', 'Onion', 'Yellow', 1, 400, 0.45, 0),
    L('f-ferid', 'Cucumber', 'Local', 1, 200, 1.25, 0),
    L('f-nermin', 'Cucumber', 'Local', 2, 150, 1.0, 0),
    L('f-elnur', 'Cucumber', 'Mini', 1, 80, 1.6, 0),
    L('f-aynur', 'Apple', 'Gala', 1, 800, 1.1, 0),
    L('f-aynur', 'Pear', 'Nar armud', 1, 200, 1.5, 0),
    L('f-vuqar', 'Apple', 'Qızıl Əhmədi', 1, 1200, 0.95, 0),
    L('f-vuqar', 'Apple', 'Simirenko', 2, 400, 0.7, 0),
    L('f-kamran', 'Potato', 'Agria', 1, 2000, 0.5, 0),
    L('f-kamran', 'Cabbage', 'White', 1, 600, 0.35, 0),
    L('f-leyla', 'Pear', 'Nar armud', 1, 350, 1.45, 0),
    L('f-leyla', 'Quince', 'Local', 1, 200, 1.2, 0),
    L('f-ramil', 'Cucumber', 'Local', 1, 260, 1.2, 0),
    L('f-zaur', 'Potato', 'Sante', 1, 1500, 0.52, 0),
    L('f-zaur', 'Carrot', 'Nantes', 1, 300, 0.6, 0),
    L('f-gulay', 'Cucumber', 'Local', 1, 180, 1.25, 0),
    L('f-gulay', 'Eggplant', 'Long', 1, 120, 1.3, 0),
    L('f-murad', 'Cabbage', 'White', 1, 900, 0.32, 0),
    L('f-murad', 'Beans', 'Green', 1, 80, 2.2, 0),
    L('f-sevinc', 'Hazelnut', 'In shell', 1, 150, 7.5, 0),
    L('f-sevinc', 'Walnut', 'In shell', 1, 100, 6.0, 0),
    L('f-orxan', 'Persimmon', 'Local', 1, 250, 1.4, 0),
  ];
}

/** The listing Elşən creates live in Act 1 (also the mock AI result and the fallback). */
export function elsenListingFields() {
  return {
    product: 'Tomato',
    variety: 'Roma',
    grade: 1 as const,
    qtyKg: 180,
    priceAzn: 1.15,
    ripeness: 4,
    harvest: demoDate(),
  };
}

export function seedTenders(day = demoDate()): Tender[] {
  const t = timeline(day);
  return [
    {
      id: 'T-1042', buyerId: 'b-nergiz', product: 'Tomato', variety: 'Roma', grade: 1, qtyKg: 400,
      packaging: '10 kg crates', intendedUse: 'Kitchen', useWithinDays: 3, ripenessMin: 4, ripenessMax: 5,
      maxPriceAzn: 1.45, deadline: t.deadline, destination: 'Nəsimi kitchen, Baku', status: 'open', proposalIds: [],
    },
    {
      id: 'T-1043', buyerId: 'b-nergiz', product: 'Cucumber', variety: 'Local', grade: 1, qtyKg: 250,
      packaging: '10 kg crates', intendedUse: 'Kitchen', useWithinDays: 4, ripenessMin: 1, ripenessMax: 6,
      maxPriceAzn: 1.7, deadline: t.cucumberDeadline, destination: 'Nəsimi kitchen, Baku', status: 'draft', proposalIds: [],
    },
  ];
}

export function initialState(): State {
  const day = demoDate();
  return {
    version: 1,
    clock: { base: timeline(day).start, startedAtMs: Date.now() },
    farmers: seedFarmers(),
    buyers: seedBuyers(),
    listings: process.env.DEMO_DATA === '0' ? [] : seedListings(day),
    tenders: seedTenders(day),
    proposals: [],
    orders: [],
    messages: [],
    events: [],
    aiRuns: [],
    settings: { channel: process.env.WHATSAPP_CHANNEL === 'twilio' ? 'twilio' : 'simulator', aiMode: process.env.AI_OFFLINE === '1' ? 'simulated' : process.env.AI_MODE === 'cached' || process.env.AI_MODE === 'simulated' ? process.env.AI_MODE : 'live', voiceReplies: !!process.env.ELEVENLABS_API_KEY && process.env.TTS_REPLIES !== '0', demoData: process.env.DEMO_DATA !== '0' },
    lastInboundAt: {},
    seenSids: [],
  };
}
