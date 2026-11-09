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
  lang?: 'az' | 'en'; // language the farmer chats in (default Azerbaijani)
  selfSignup?: string; // ISO time the farmer created their own account from the join QR
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
  ripenessConfidence: number; // confidence of the photo inspection (0 = no photo yet)
  freshness?: 'fresh' | 'aging' | 'old'; // from the photo; ripeness stages apply to tomatoes only // 0..1
  defects: string[];
  harvest: string; // ISO date the farmer harvests
  status: ListingStatus;
  photoUrl?: string;
  audioUrl?: string;
  transcriptAz?: string;
  transcriptEn?: string;
  notes?: string; // extra facts for buyers, in English (timing, delivery wishes)
  createdAt: string;
  source: 'seed' | 'whatsapp';
  aiRunId?: string;
}

export interface Tender {
  id: string;
  buyerId: string;
  product: string;
  variety: string; // 'Any' matches every variety
  grade: 1 | 2 | 3;
  qtyKg: number;
  packaging: string;
  intendedUse: string;
  useWithinDays: number;
  ripenessMin: number; // wanted stage on arrival (tomatoes; other produce: 1..6, not checked)
  ripenessMax: number;
  maxPriceAzn: number; // delivered, per kg
  priceTolerancePct?: number; // how much a repair may raise the delivered price without asking (default 2)
  deadline: string; // ISO
  destination: string;
  status: 'draft' | 'open' | 'matching' | 'proposals' | 'ordered' | 'cancelled';
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
  textAz?: string;
}

export interface Proposal {
  id: string;
  tenderId: string;
  key: 'best_fit' | 'lowest_price' | 'firmest';
  numeral: string; // i, ii, iii
  title: string;
  titleAz?: string;
  recommended: boolean;
  allocations: Allocation[];
  route: Stop[];
  costs: Costs;
  arrivalSummary: string; // "Light red on arrival"
  arrivalSummaryAz?: string;
  arrivalStage: number; // weighted average
  worstStage: number;
  warning?: string;
  warningAz?: string;
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
  whyAz?: string;
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

export type OrderStatus = 'offers_sent' | 'confirmed' | 'picked_up' | 'delivered' | 'settled' | 'cancelled';

export interface Order {
  id: string;
  tenderId: string;
  proposalId: string;
  buyerId: string;
  allocations: Allocation[];
  route: Stop[];
  costs: Costs;
  status: OrderStatus;
  escrow: { amount: number; status: 'held' | 'released' | 'refunded'; simulated: true };
  recovery?: Recovery;
  partialKg?: number; // the buyer accepted a smaller delivery after a farmer dropped out
  priceNotice?: string; // shown to buyer after a recovery
  priceNoticeAz?: string;
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
  delivery?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'local';
  ai?: 'live' | 'cached' | 'simulated'; // a reply written by the conversational assistant, and how
  voiceUrl?: string; // the same reply as an Azerbaijani voice note (text-to-speech)
  voiceMode?: 'live' | 'cached';
  voicePending?: boolean;
  voiceSid?: string;
  voiceDelivery?: 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
  deliveryError?: string; // Twilio error, shown to the presenter
  sid?: string; // Twilio message SID
}

export interface LedgerEvent {
  id: string;
  at: string;
  type: 'listing' | 'ai' | 'order' | 'offer' | 'accept' | 'cancel' | 'recovery' | 'escrow' | 'delivery' | 'rating' | 'system';
  tone: 'neutral' | 'ai' | 'good' | 'alert';
  title: string;
  detail?: string;
  quote?: string;
  // Azerbaijani versions for the website in AZ (the English fields are the fallback)
  titleAz?: string;
  detailAz?: string;
  quoteAz?: string;
  orderId?: string;
}

export interface AiStep {
  key: 'transcribe' | 'extract' | 'inspect' | 'price' | 'draft';
  label: string;
  labelAz?: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  output?: string;
  outputAz?: string;
  ms?: number;
  mode?: 'live' | 'cached' | 'simulated'; // which kind of result this step used
  note?: string; // why a fallback was used
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
  freshness?: 'fresh' | 'aging' | 'old';
  defects?: string[];
  priceNote?: string;
  priceNoteAz?: string;
  listingId?: string;
  photoUrl?: string;
  audioUrl?: string;
  mode: 'live' | 'cached' | 'simulated' | 'mixed';
  status: 'running' | 'done' | 'needs_review' | 'failed';
  note?: string;
  noteAz?: string;
  waitingFor?: string; // what the assistant is waiting for from the farmer, shown on Intake
  waitingForAz?: string;
  edits?: { field: string; from?: string; to: string; by: 'farmer' | 'operator'; at: string; quote?: string }[];
}

export interface Settings {
  channel: 'simulator' | 'twilio';
  aiMode: 'live' | 'cached' | 'simulated'; // live provider, cached verified results, or scripted fallback
  voiceReplies: boolean; // the assistant also answers with Azerbaijani voice notes
  demoData?: boolean; // seeded marketplace (other farms' listings); off = only listings sent from real phones. Missing = on
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
  /** Real wall-clock time of each farmer's last WhatsApp message (for the 24-hour session window). */
  lastInboundAt: Record<string, number>;
  /** Twilio MessageSids already handled, so a retried webhook is not processed twice. */
  seenSids: string[];
}
