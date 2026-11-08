// Core domain types for BƏRƏKƏT. Everything the three surfaces show comes from one State object.

export type ThreadColor = string;

export interface Farmer {
  id: string;
  name: string;
  village: string;
  region: string;
  lat: number;
  lng: number;
  rating: number;
  deals: number;
  color: ThreadColor;
  phone?: string; // E.164, e.g. +99450..., used for the Twilio channel
}

export interface Buyer {
  id: string;
  name: string;
  kind: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
}

export type ListingStatus =
  | 'draft' // AI extracted, waiting for farmer confirmation
  | 'needs_review' // low confidence or flagged; operator looks
  | 'live'
  | 'reserved' // allocated in an active order
  | 'sold'
  | 'withdrawn'
  | 'rejected';

export interface Listing {
  id: string;
  farmerId: string;
  product: string; // "Tomato"
  variety: string; // "Roma"
  grade: 1 | 2 | 3;
  qtyKg: number;
  priceAzn: number; // per kg, farm gate
  ripeness: number; // 1..6 stage seen in photo today
  ripenessConfidence: number; // 0..1
  defects: string[];
  harvest: string; // ISO date the farmer harvests
  status: ListingStatus;
  photoUrl?: string;
  audioUrl?: string;
  transcriptAz?: string;
  transcriptEn?: string;
  createdAt: string;
  source: 'seed' | 'whatsapp';
  aiRunId?: string;
}

export interface Tender {
  id: string;
  buyerId: string;
  product: string;
  variety: string;
  grade: 1 | 2 | 3;
  qtyKg: number;
  packaging: string;
  intendedUse: string;
  useWithinDays: number;
  ripenessMin: number; // wanted stage on arrival
  ripenessMax: number;
  maxPriceAzn: number; // delivered, per kg
  deadline: string; // ISO
  destination: string;
  status: 'draft' | 'open' | 'matching' | 'proposals' | 'ordered';
  proposalIds: string[];
  orderId?: string;
}

export interface Stop {
  farmerId: string;
  label: string;
  lat: number;
  lng: number;
}

export interface Allocation {
  id: string;
  listingId: string;
  farmerId: string;
  qtyKg: number;
  priceAzn: number;
  arrivalRipeness: number; // continuous stage on arrival
  status: 'proposed' | 'offered' | 'accepted' | 'declined' | 'cancelled' | 'picked_up';
  pickedKg?: number;
}

export interface Costs {
  produce: number;
  transport: number;
  fee: number;
  total: number;
  perKg: number;
  routeKm: number;
}

export interface Reason {
  ref?: string; // allocation id or 'option-ii' etc.
  text: string;
}

export interface Proposal {
  id: string;
  tenderId: string;
  key: 'best_fit' | 'lowest_price' | 'firmest';
  numeral: string; // i, ii, iii
  title: string;
  recommended: boolean;
  allocations: Allocation[];
  route: Stop[];
  costs: Costs;
  arrivalSummary: string; // "Light red on arrival"
  arrivalStage: number; // weighted average
  worstStage: number;
  warning?: string;
  reasons: Reason[];
}

export interface RecoveryCandidate {
  farmerId: string;
  listingId: string;
  qtyKg: number;
  priceAzn: number;
  arrivalRipeness: number;
  costs?: Costs;
  route?: Stop[];
  accepted: boolean; // engine verdict
  why: string;
}

export interface Recovery {
  shortfallKg: number;
  cancelledFarmerId: string;
  cause?: string;
  candidates: RecoveryCandidate[];
  selected?: number; // index in candidates
  status: 'searching' | 'proposed' | 'offered' | 'accepted' | 'no_backup' | 'resolved';
  before: Costs;
  after?: Costs;
}

export type OrderStatus = 'offers_sent' | 'confirmed' | 'picked_up' | 'delivered' | 'settled';

export interface Order {
  id: string;
  tenderId: string;
  proposalId: string;
  buyerId: string;
  allocations: Allocation[];
  route: Stop[];
  costs: Costs;
  status: OrderStatus;
  escrow: { amount: number; status: 'held' | 'released'; simulated: true };
  recovery?: Recovery;
  priceNotice?: string; // shown to buyer after a recovery
  buyerRatings: Record<string, number>; // farmerId -> stars
  farmerRatings: Record<string, number>; // farmerId -> stars given to buyer
  createdAt: string;
}

export type MessageKind = 'text' | 'voice' | 'photo' | 'card';

export interface Message {
  id: string;
  farmerId: string;
  dir: 'in' | 'out';
  kind: MessageKind;
  text?: string; // Azerbaijani
  textEn?: string; // English gloss for the demo
  mediaUrl?: string;
  transcript?: string;
  card?: {
    title: string;
    rows: [string, string][];
    actions?: { label: string; reply: string }[];
  };
  at: string;
  via: 'simulator' | 'twilio';
  delivery?: 'queued' | 'sent' | 'failed' | 'local';
}

export interface LedgerEvent {
  id: string;
  at: string;
  type: 'listing' | 'ai' | 'order' | 'offer' | 'accept' | 'cancel' | 'recovery' | 'escrow' | 'delivery' | 'rating' | 'system';
  tone: 'neutral' | 'ai' | 'good' | 'alert';
  title: string;
  detail?: string;
  quote?: string;
  orderId?: string;
}

export interface AiStep {
  key: 'transcribe' | 'extract' | 'inspect' | 'price' | 'draft';
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  output?: string;
  ms?: number;
}

export interface AiRun {
  id: string;
  farmerId: string;
  startedAt: string;
  steps: AiStep[];
  transcriptAz?: string;
  transcriptEn?: string;
  fields?: Record<string, { value: string; confidence: number }>;
  ripeness?: number;
  ripenessConfidence?: number;
  defects?: string[];
  priceNote?: string;
  listingId?: string;
  photoUrl?: string;
  audioUrl?: string;
  mode: 'live' | 'cached' | 'mock';
  status: 'running' | 'done' | 'needs_review' | 'failed';
  note?: string;
}

export interface Settings {
  channel: 'simulator' | 'twilio';
  offline: boolean; // use cached / mock AI only
}

export interface State {
  version: number;
  clock: { base: string; startedAtMs: number }; // demo clock
  farmers: Farmer[];
  buyers: Buyer[];
  listings: Listing[];
  tenders: Tender[];
  proposals: Proposal[];
  orders: Order[];
  messages: Message[];
  events: LedgerEvent[];
  aiRuns: AiRun[];
  settings: Settings;
}
