// Where runtime data lives (state snapshot, AI cache, media, WhatsApp inbox, tunnel URL).
// DEMO_DATA_DIR lets tests and `npm run demo:verify` use their own folder without touching the presenter's.
import path from 'node:path';

export const dataDir = (...parts: string[]) => path.join(process.env.DEMO_DATA_DIR || path.join(process.cwd(), '.data'), ...parts);
