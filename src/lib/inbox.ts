// A small durable queue for incoming WhatsApp messages. The webhook writes each message to .data/inbox and
// answers Twilio at once; one worker processes the files in arrival order (so a farmer's photo, voice note and
// reply are handled in sequence) and deletes each when done. Anything left after a restart is picked up again.
import fs from 'node:fs';
import path from 'node:path';
import { saveMedia } from './ai';
import { dataDir } from './paths';
import { handleInbound, type Inbound } from './flows';
import { emit, farmer, getState, ledger, sendToFarmer } from './store';
import { downloadTwilioMedia, mediaKind } from './twilio';

const DIR = () => dataDir('inbox');

export interface InboxJob {
  sid: string;
  farmerId: string;
  receivedAt: number;
  attempts: number;
  params: Record<string, string>;
}

const g = globalThis as unknown as { __inbox?: { running: boolean; resumed: boolean } };
const st = () => (g.__inbox ??= { running: false, resumed: false });

export function enqueueInbound(job: Omit<InboxJob, 'attempts'>) {
  fs.mkdirSync(DIR(), { recursive: true });
  const file = path.join(DIR(), `${job.receivedAt}-${job.sid.replace(/[^A-Za-z0-9]/g, '')}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...job, attempts: 0 }));
  void work();
}

/** Called on the first state request after a restart, so queued messages are not lost. */
export function resumeInbox() {
  if (st().resumed) return;
  st().resumed = true;
  void work();
}

export function pendingInbox(): number {
  try {
    return fs.readdirSync(DIR()).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function work() {
  if (st().running) return;
  st().running = true;
  try {
    for (;;) {
      let files: string[] = [];
      try {
        files = fs.readdirSync(DIR()).filter((f) => f.endsWith('.json')).sort();
      } catch {
        /* no inbox yet */
      }
      if (!files.length) break;
      const file = path.join(DIR(), files[0]);
      let job: InboxJob;
      try {
        job = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        fs.rmSync(file, { force: true });
        continue;
      }
      try {
        await processJob(job);
        fs.rmSync(file, { force: true });
      } catch (err) {
        job.attempts++;
        console.error(`[inbox] ${job.sid} failed (attempt ${job.attempts}):`, (err as Error).message);
        if (job.attempts >= 2) {
          ledger({ type: 'system', tone: 'alert', title: `WhatsApp message from ${farmer(job.farmerId)?.name.split(' ')[0] ?? 'farmer'} could not be processed`, detail: (err as Error).message.slice(0, 140) });
          emit();
          fs.rmSync(file, { force: true });
        } else fs.writeFileSync(file, JSON.stringify(job));
      }
    }
  } finally {
    st().running = false;
  }
}

async function processJob(job: InboxJob) {
  const p = job.params;
  const inb: Inbound = { farmerId: job.farmerId, via: 'twilio' };
  const n = Math.min(Number(p.NumMedia ?? 0) || 0, 5);
  for (let i = 0; i < n; i++) {
    const url = p[`MediaUrl${i}`];
    const mime = (p[`MediaContentType${i}`] ?? '').toLowerCase();
    const kind = mediaKind(mime);
    if (!url) continue;
    if (!kind) {
      ledger({ type: 'system', tone: 'alert', title: `Unsupported file from ${farmer(job.farmerId).name.split(' ')[0]}`, detail: mime || 'unknown type' });
      sendToFarmer(job.farmerId, { kind: 'text', text: 'Bu fayl növünü qəbul edə bilmirik. Səsli mesaj və ya şəkil göndərin.', textEn: "We can't accept this file type. Send a voice note or a photo." });
      emit();
      continue;
    }
    try {
      const buf = await downloadTwilioMedia(url, mime);
      const local = saveMedia(buf, mime);
      if (kind === 'audio') inb.audio = { buf, mime, url: local };
      else inb.photo = { buf, mime, url: local };
    } catch (err) {
      ledger({ type: 'system', tone: 'alert', title: `Could not download ${kind} from ${farmer(job.farmerId).name.split(' ')[0]}`, detail: (err as Error).message });
      sendToFarmer(job.farmerId, { kind: 'text', text: 'Faylı ala bilmədik, zəhmət olmasa yenidən göndərin.', textEn: "We couldn't receive the file, please send it again." });
      emit();
    }
  }
  const body = (p.Body ?? '').trim();
  if (body) inb.text = body.slice(0, 1000);
  if (!inb.audio && !inb.photo && !inb.text) {
    // Still counts for the 24-hour window.
    getState().lastInboundAt[job.farmerId] = Date.now();
    return;
  }
  await handleInbound(inb);
}
