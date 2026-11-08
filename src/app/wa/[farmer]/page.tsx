'use client';
// The farmer's phone: a WhatsApp (iOS) style chat with the BƏRƏKƏT assistant, opened on a real phone on the same
// Wi-Fi (npm run demo:phone). Voice messages work like WhatsApp: hold the mic to record, release to send, slide
// left to cancel, slide up to lock and record hands-free. Everything goes through the laptop's shared state.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '@/components/live';
import { LogoMark } from '@/components/ui';
import { DEMO_PHOTOS, DEMO_VOICE } from '@/lib/demo';
import type { Message } from '@/lib/types';
import { sys, WaTheme } from '../theme';

const v = (name: string) => `var(--wa-${name})`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const CANCEL_PX = 110;
const LOCK_PX = 80;

async function post(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, val] of Object.entries(fields)) fd.set(k, val);
  const res = await fetch('/api/phone', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Göndərilmədi (${res.status})`);
}

// ---------- Recorder ----------

type Phase = 'idle' | 'hold' | 'locked';
interface Rec { phase: Phase; elapsed: number; paused: boolean; dx: number; dy: number; levels: number[] }
const IDLE: Rec = { phase: 'idle', elapsed: 0, paused: false, dx: 0, dy: 0, levels: [] };

function useRecorder(onSend: (b: Blob) => void, toast: (t: string) => void, openSheet: () => void) {
  const [rec, setRec] = useState<Rec>(IDLE);
  const r = useRef<{
    stream?: MediaStream; release?: ReturnType<typeof setTimeout>; mr?: MediaRecorder; chunks: Blob[]; send: boolean;
    start: { x: number; y: number }; held: boolean; t0: number; pausedMs: number; pausedAt?: number; tick?: ReturnType<typeof setInterval>;
    ctx?: AudioContext; analyser?: AnalyserNode; phase: Phase;
  }>({ chunks: [], send: false, start: { x: 0, y: 0 }, held: false, t0: 0, pausedMs: 0, phase: 'idle' });

  // Keep the microphone open for a minute after a recording, so the next one starts instantly (like WhatsApp).
  const scheduleRelease = () => {
    clearTimeout(r.current.release);
    r.current.release = setTimeout(() => { r.current.stream?.getTracks().forEach((t) => t.stop()); r.current.stream = undefined; }, 60_000);
  };
  useEffect(() => () => { r.current.stream?.getTracks().forEach((t) => t.stop()); }, []);

  const stopTicking = () => { clearInterval(r.current.tick); r.current.tick = undefined; };

  const finish = (send: boolean) => {
    const s = r.current;
    if (s.phase === 'idle') return;
    s.send = send;
    s.phase = 'idle';
    stopTicking();
    if (s.mr && s.mr.state !== 'inactive') s.mr.stop();
    setRec(IDLE);
    scheduleRelease();
  };

  const begin = async (x: number, y: number) => {
    const s = r.current;
    s.start = { x, y };
    s.held = true;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Mikrofon üçün linki https ilə açın. İndilik + ilə hazır səs yazısı göndərin.');
      openSheet();
      return;
    }
    if (!s.stream || s.stream.getTracks().every((t) => t.readyState === 'ended')) {
      try {
        s.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      } catch {
        toast('Mikrofona icazə yoxdur. Ayarlardan icazə verin.');
        return;
      }
      if (!s.held) { scheduleRelease(); toast('Mikrofon hazırdır. Basıb saxlayın və danışın.'); return; } // first-time permission prompt
    }
    clearTimeout(s.release);
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const mr = new MediaRecorder(s.stream, mime ? { mimeType: mime } : undefined);
    s.mr = mr;
    s.chunks = [];
    s.send = false;
    mr.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
    mr.onstop = () => {
      const ms = Date.now() - s.t0 - s.pausedMs;
      if (!s.send) return;
      if (ms < 800) { toast('Səs yazmaq üçün basıb saxlayın, göndərmək üçün buraxın'); return; }
      onSend(new Blob(s.chunks, { type: (mr.mimeType || 'audio/webm').split(';')[0] }));
    };
    mr.start(200);
    s.t0 = Date.now();
    s.pausedMs = 0;
    s.pausedAt = undefined;
    s.phase = 'hold';
    navigator.vibrate?.(25);
    // Live level meter for the waveform.
    try {
      s.ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      void s.ctx.resume();
      const src = s.ctx.createMediaStreamSource(s.stream);
      s.analyser = s.ctx.createAnalyser();
      s.analyser.fftSize = 512;
      src.connect(s.analyser);
    } catch { s.analyser = undefined; }
    const buf = new Uint8Array(512);
    setRec({ ...IDLE, phase: 'hold' });
    s.tick = setInterval(() => {
      let level = 0.15 + Math.random() * 0.1;
      if (s.analyser) {
        s.analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += ((b - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(sum / buf.length) * 4.5);
      }
      const paused = s.pausedAt !== undefined;
      const elapsed = (Date.now() - s.t0 - s.pausedMs - (paused ? Date.now() - s.pausedAt! : 0)) / 1000;
      setRec((p) => (p.phase === 'idle' ? p : { ...p, elapsed, paused, levels: paused ? p.levels : [...p.levels.slice(-59), level] }));
    }, 100);
  };

  const move = (x: number, y: number) => {
    const s = r.current;
    if (s.phase !== 'hold') return;
    const dx = Math.min(0, x - s.start.x);
    const dy = Math.min(0, y - s.start.y);
    if (dx < -CANCEL_PX) { navigator.vibrate?.(15); return finish(false); }
    if (dy < -LOCK_PX) { s.phase = 'locked'; navigator.vibrate?.([15, 40, 15]); setRec((p) => ({ ...p, phase: 'locked', dx: 0, dy: 0 })); return; }
    setRec((p) => ({ ...p, dx, dy }));
  };

  const up = () => {
    const s = r.current;
    s.held = false;
    if (s.phase === 'hold') finish(true);
  };

  const togglePause = () => {
    const s = r.current;
    if (!s.mr) return;
    if (s.pausedAt === undefined) { s.mr.pause?.(); s.pausedAt = Date.now(); }
    else { s.mr.resume?.(); s.pausedMs += Date.now() - s.pausedAt; s.pausedAt = undefined; }
  };

  return { rec, begin, move, up, cancel: () => finish(false), send: () => finish(true), togglePause };
}

// ---------- Page ----------

export default function WaChat({ params }: { params: { farmer: string } }) {
  const farmerId = params.farmer;
  const { s, connected } = useLive();
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const [sending, setSending] = useState(0);
  const [toast, setToast] = useState<string>();
  const scroller = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  const send = async (fields: Record<string, string | Blob>) => {
    setSending((n) => n + 1);
    try { await post({ farmerId, ...fields }); } catch (e) { setToast((e as Error).message); } finally { setSending((n) => n - 1); }
  };
  const recorder = useRecorder((blob) => void send({ audio: blob }), setToast, () => setSheet(true));
  const { rec } = recorder;

  useEffect(() => { try { localStorage.setItem('berekat.waFarmer', farmerId); } catch { /* storage blocked */ } }, [farmerId]);
  const thread = useMemo(() => (s ? s.messages.filter((m) => m.farmerId === farmerId) : []), [s, farmerId]);
  const lastVoice = thread[thread.length - 1]?.voiceUrl;
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [thread.length, sending, lastVoice]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (rec.phase !== 'idle') setToast(undefined); }, [rec.phase]); // a hint must not cover the recorder

  if (!s) return <Frame><div style={{ margin: 'auto', color: v('meta') }}>Yüklənir…</div></Frame>;
  const farmer = s.farmers.find((f) => f.id === farmerId);
  if (!farmer) return <Frame><div style={{ margin: 'auto', padding: 24, textAlign: 'center' }}>Belə fermer yoxdur. <Link href="/wa" style={{ color: v('green') }}>Geri</Link></div></Frame>;

  // "yazır…" while the assistant works on the farmer's latest message; "səs yazır…" while a voice reply is made.
  const dirs = thread.map((m) => m.dir);
  const working = s.aiRuns.some((r) => r.farmerId === farmerId && r.steps.some((x) => x.status === 'running'));
  const awaitingMore = s.aiRuns.some((r) => r.farmerId === farmerId && r.status === 'running' && !r.steps.some((x) => x.status === 'running'));
  const busy = working || (dirs.lastIndexOf('in') > dirs.lastIndexOf('out') && !awaitingMore);
  const recording = thread.some((m) => m.dir === 'out' && m.voicePending);
  const lastCardId = [...thread].reverse().find((m) => m.dir === 'out' && m.card?.actions)?.id;
  const answered = lastCardId ? thread.slice(thread.findIndex((m) => m.id === lastCardId) + 1).some((m) => m.dir === 'in') : true;
  const demoVoices = Object.entries(DEMO_VOICE).filter(([, d]) => d.farmerId === farmerId);
  const pickFile = (kind: 'photo' | 'audio') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void send({ [kind]: f });
  };
  const status = !connected ? 'bağlantı gözlənilir…' : recording && !busy ? 'səs yazır…' : busy ? 'yazır…' : 'onlayn';

  return (
    <Frame>
      {/* Header */}
      <header className="wa-noselect" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', paddingTop: 'max(8px, env(safe-area-inset-top))', background: v('head'), color: v('head-text'), borderBottom: '0.5px solid rgba(127,127,127,0.18)' }}>
        <Link href="/wa" aria-label="Geri" style={{ height: 40, minWidth: 40, padding: '0 10px', borderRadius: 20, justifyContent: 'center', background: v('pill'), display: 'flex', alignItems: 'center', gap: 2, color: v('head-text') }}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5L7.5 12 15 19.5" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><LogoMark size={24} /></div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, fontSize: 17 }}>
            BƏRƏKƏT
            <svg width="16" height="16" viewBox="0 0 24 24" aria-label="Təsdiqlənmiş biznes"><path d="M12 1.8l2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.2l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1z" fill="#21c063" /><path d="M8 12.2l2.7 2.7L16.2 9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div style={{ fontSize: 13.5, color: busy || recording ? v('green') : v('sub'), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status}</div>
        </div>
        <span aria-hidden="true" style={{ height: 40, borderRadius: 20, background: v('pill'), display: 'flex', alignItems: 'center', gap: 16, padding: '0 14px', flex: 'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24"><rect x="2.5" y="6.5" width="13" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.7" fill="none" /><path d="M15.5 10.5l5-3v9l-5-3" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinejoin="round" /></svg>
          <svg width="20" height="20" viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1z" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" /></svg>
          <svg width="20" height="20" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
        </span>
      </header>

      {/* Messages */}
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 10px 14px', display: 'flex', flexDirection: 'column', gap: 2, background: v('bg'), backgroundImage: v('wall'), backgroundSize: '220px 220px' }}>
        <div style={{ alignSelf: 'center', background: v('banner'), color: v('banner-text'), fontSize: 12.5, lineHeight: 1.35, textAlign: 'center', borderRadius: 10, padding: '7px 12px', margin: '6px 16px 10px', maxWidth: 340 }}>
          🔒 Demo: mesajları BƏRƏKƏT köməkçisi cavablandırır. Real pul köçürülmür.
        </div>
        <Chip>Bu gün</Chip>
        {thread.length === 0 && <div style={{ alignSelf: 'center', color: v('meta'), fontSize: 14.5, textAlign: 'center', padding: '22px 30px' }}>Satmaq istədiyiniz məhsul barədə səsli mesaj göndərin: mikrofonu basıb saxlayın.</div>}
        {thread.map((m, i) => {
          const next = thread[i + 1];
          const prev = thread[i - 1];
          const read = m.dir === 'in' && thread.slice(i + 1).some((x) => x.dir === 'out');
          return (
            <Bubble key={m.id} m={m} first={!prev || prev.dir !== m.dir} last={!next || next.dir !== m.dir || !!m.voiceUrl || !!m.card?.actions}
              read={read} live={m.id === lastCardId && !answered} onReply={(r) => void send({ text: r })} />
          );
        })}
        {sending > 0 && <div style={{ alignSelf: 'flex-end', color: v('meta'), fontSize: 12.5, padding: '3px 6px' }}>göndərilir…</div>}
      </div>

      {/* Composer */}
      <div className="wa-noselect" style={{ flex: 'none', position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 8, padding: '7px 10px', width: '100%', boxSizing: 'border-box', paddingBottom: 'max(10px, env(safe-area-inset-bottom))', background: v('bar'), borderTop: '0.5px solid rgba(127,127,127,0.18)' }}>
        {rec.phase === 'idle' && (
          <>
            <button type="button" aria-label="Əlavə et" onClick={() => setSheet((x) => !x)} style={{ ...iconBtn, height: 36, width: 34 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16" stroke={v('icon')} strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { setText(''); void send({ text: t }); } }}
              style={{ flex: '1 1 0', minWidth: 0, minHeight: 36, borderRadius: 18, background: v('input'), border: `1px solid ${v('input-line')}`, display: 'flex', alignItems: 'center', padding: '0 8px 0 14px' }}>
              <label htmlFor="wa-msg" style={{ position: 'absolute', left: -9999 }}>Mesaj</label>
              <input id="wa-msg" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" enterKeyHint="send" size={1}
                style={{ flex: 1, minWidth: 0, width: '100%', border: 0, outline: 'none', fontSize: 17, fontFamily: sys, padding: '7px 0', background: 'transparent', color: v('text') }} />
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ flex: 'none', opacity: 0.85 }}><path d="M14.5 3.5h-6a5 5 0 00-5 5v7a5 5 0 005 5h4.5l7.5-7.5V8.5a5 5 0 00-5-5z" stroke={v('icon')} strokeWidth="1.7" fill="none" strokeLinejoin="round" /><path d="M13 20.5v-2.5a5 5 0 015-5h2.5" stroke={v('icon')} strokeWidth="1.7" fill="none" strokeLinejoin="round" /></svg>
            </form>
            {!text.trim() && (
              <button type="button" aria-label="Kamera" onClick={() => cameraRef.current?.click()} style={{ ...iconBtn, height: 36, width: 36 }}>
                <svg width="27" height="27" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h3l1.6-2.2h6.8L17 7.5h3a1.5 1.5 0 011.5 1.5v9A1.5 1.5 0 0120 19.5H4A1.5 1.5 0 012.5 18V9A1.5 1.5 0 014 7.5z" stroke={v('icon')} strokeWidth="1.6" fill="none" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.6" stroke={v('icon')} strokeWidth="1.6" fill="none" /></svg>
              </button>
            )}
          </>
        )}

        {rec.phase === 'hold' && (
          <div style={{ flex: 1, height: 40, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 6, fontSize: 17, color: v('text') }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ animation: 'wa-blink 1s ease-in-out infinite' }}><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill={v('red')} /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" stroke={v('red')} strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 42 }}>{mmss(rec.elapsed)}</span>
            <span style={{ marginLeft: 'auto', marginRight: 6, color: v('meta'), fontSize: 15.5, transform: `translateX(${rec.dx * 0.55}px)`, opacity: Math.max(0.15, 1 + rec.dx / CANCEL_PX), display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
              <span style={{ animation: 'wa-nudge 1.2s ease-in-out infinite' }}>‹</span> Ləğv üçün sürüşdürün
            </span>
          </div>
        )}

        {rec.phase === 'locked' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 36, padding: '0 6px', color: v('text') }}>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 17, minWidth: 40 }}>{mmss(rec.elapsed)}</span>
              <LiveWave levels={rec.levels} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button aria-label="Səs yazısını sil" onClick={recorder.cancel} style={{ ...iconBtn, height: 40 }}>
                <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l.9 13a1.5 1.5 0 001.5 1.4h6.2a1.5 1.5 0 001.5-1.4l.9-13M10 10v7M14 10v7" stroke={v('icon')} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button aria-label={rec.paused ? 'Davam et' : 'Pauza'} onClick={recorder.togglePause} style={{ ...iconBtn, height: 40, width: 40, borderRadius: 20, border: `2px solid ${v('red')}` }}>
                {rec.paused
                  ? <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill={v('red')} /><path d="M5.5 11a6.5 6.5 0 0013 0" stroke={v('red')} strokeWidth="2" fill="none" /></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.5" fill={v('red')} /><rect x="14" y="4" width="5" height="16" rx="1.5" fill={v('red')} /></svg>}
              </button>
              <button aria-label="Səs yazısını göndər" onClick={recorder.send} style={roundBtn}>
                <SendIcon />
              </button>
            </div>
          </div>
        )}

        {rec.phase !== 'locked' && (text.trim() ? (
          <button aria-label="Göndər" onClick={() => { const t = text.trim(); setText(''); void send({ text: t }); }} style={roundBtn}><SendIcon /></button>
        ) : (
          <div style={{ position: 'relative', flex: 'none' }}>
            {rec.phase === 'hold' && (
              // Slide up to lock
              <div aria-hidden="true" style={{ position: 'absolute', left: 0, bottom: 64 + Math.min(40, -rec.dy * 0.5), width: 36, height: 74, borderRadius: 18, background: v('sheet'), boxShadow: '0 2px 10px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly', color: v('meta') }}>
                <svg width="16" height="18" viewBox="0 0 16 18"><rect x="2" y="8" width="12" height="9" rx="2" fill="currentColor" /><path d="M4.5 8V5.5a3.5 3.5 0 017 0V8" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
                <svg width="14" height="10" viewBox="0 0 14 10" style={{ animation: 'wa-up 1.2s ease-in-out infinite' }}><path d="M2 8l5-5 5 5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
              </div>
            )}
            <button aria-label="Səs yazısı: basıb saxlayın" className="wa-noselect"
              style={{ ...roundBtn, touchAction: 'none', transform: rec.phase === 'hold' ? `translate(${rec.dx * 0.15}px, ${rec.dy * 0.4}px) scale(1.9)` : undefined, transition: rec.phase === 'hold' ? 'transform .05s' : 'transform .15s', zIndex: 3, position: 'relative', boxShadow: '0 0 0 10px transparent' }}
              onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId); void recorder.begin(e.clientX, e.clientY); }}
              onPointerMove={(e) => recorder.move(e.clientX, e.clientY)}
              onPointerUp={() => recorder.up()}
              onPointerCancel={() => recorder.cancel()}
              onContextMenu={(e) => e.preventDefault()}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="#fff" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
            </button>
          </div>
        ))}

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFile('photo')} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pickFile('photo')} />
        <input ref={audioFileRef} type="file" accept="audio/*" hidden onChange={pickFile('audio')} />

        {sheet && (
          <>
            <div onClick={() => setSheet(false)} style={{ position: 'fixed', inset: 0, zIndex: 10, background: 'rgba(0,0,0,0.25)' }} />
            <div role="dialog" aria-label="Əlavə et" style={{ position: 'absolute', left: 8, right: 8, bottom: 64, zIndex: 11, background: v('sheet'), color: v('text'), borderRadius: 18, padding: '18px 12px 10px', boxShadow: '0 8px 30px rgba(0,0,0,0.35)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 10 }}>
                <SheetIcon color="#007aff" label="Kamera" onClick={() => { setSheet(false); cameraRef.current?.click(); }} icon="📷" />
                <SheetIcon color="#5856d6" label="Foto" onClick={() => { setSheet(false); galleryRef.current?.click(); }} icon="🖼️" />
                <SheetIcon color="#ff9500" label="Audio" onClick={() => { setSheet(false); audioFileRef.current?.click(); }} icon="🎧" />
              </div>
              {(demoVoices.length > 0 || farmerId === 'f-elsen') && (
                <div style={{ borderTop: '0.5px solid rgba(127,127,127,0.3)', paddingTop: 8, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: 12, color: v('meta'), padding: '2px 8px 4px', letterSpacing: 0.3 }}>HAZIR SƏS YAZILARI (DEMO)</div>
                  {demoVoices.map(([id, d]) => (
                    <SheetRow key={id} onClick={() => { setSheet(false); void send({ demoVoice: id, ...(id === 'elsen-listing' ? { demoPhoto: 'tomatoes-stage4' } : {}) }); }}>
                      🎤 {id === 'elsen-listing' ? 'Səsli mesaj + şəkil: pomidor satışı' : d.label.split(': ')[1]}
                    </SheetRow>
                  ))}
                  {DEMO_PHOTOS.filter((p) => farmerId === 'f-elsen' || !p.id.includes('stage4')).map((p) => (
                    <SheetRow key={p.id} onClick={() => { setSheet(false); void send({ demoPhoto: p.id }); }}>🖼️ Şəkil: {p.label}</SheetRow>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
        {toast && <div role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 74, zIndex: 12, background: 'rgba(40,44,46,0.96)', color: '#fff', borderRadius: 12, padding: '11px 14px', fontSize: 14.5, textAlign: 'center' }}>{toast}</div>}
      </div>
    </Frame>
  );
}

/**
 * The visible part of the screen, tracked live: iPhone Safari's floating toolbar and the keyboard cover the bottom
 * of a full-height page, and that is where the input row and the mic are. Sizing to the visual viewport keeps them
 * on top, like WhatsApp.
 */
function useVisibleViewport() {
  const [vp, setVp] = useState<{ h: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVp({ h: Math.round(vv.height), top: Math.round(vv.offsetTop) });
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); window.removeEventListener('orientationchange', update); };
  }, []);
  return vp;
}

function Frame({ children }: { children: React.ReactNode }) {
  const vp = useVisibleViewport();
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, top: vp?.top ?? 0, height: vp ? `${vp.h}px` : '100dvh', display: 'flex', flexDirection: 'column', background: v('bg'), fontFamily: sys, color: v('text'), WebkitTapHighlightColor: 'transparent', maxWidth: 600, margin: '0 auto', overflow: 'hidden' }}>
      <WaTheme />
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <div style={{ alignSelf: 'center', background: v('chip'), color: v('chip-text'), fontSize: 13, fontWeight: 600, borderRadius: 9, padding: '5px 12px', margin: '4px 0 8px', boxShadow: v('shadow') }}>{children}</div>;
}

function SendIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.2 6.1 9 1.3-9 1.3-1.2 6.1c-.1.7.6 1.3 1.3 1z" fill="#fff" /></svg>;
}

const iconBtn: React.CSSProperties = { width: 40, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flex: 'none' };
const roundBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: 18, border: 0, background: 'var(--wa-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none', userSelect: 'none', WebkitUserSelect: 'none' };

function SheetIcon({ color, label, icon, onClick }: { color: string; label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ border: 0, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: v('meta'), fontFamily: sys }}>
      <span style={{ width: 54, height: 54, borderRadius: 27, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{icon}</span>
      {label}
    </button>
  );
}

function SheetRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ textAlign: 'left', border: 0, background: 'transparent', padding: '11px 8px', fontSize: 16, borderRadius: 8, cursor: 'pointer', color: v('text'), fontFamily: sys }}>{children}</button>;
}

/** Like WhatsApp: a dotted line that turns into bars where there is sound. */
function LiveWave({ levels }: { levels: number[] }) {
  const n = 60;
  const bars = [...Array(Math.max(0, n - levels.length)).fill(0), ...levels.slice(-n)];
  return (
    <div aria-hidden="true" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 26, overflow: 'hidden' }}>
      {bars.map((l, i) => (l < 0.12
        ? <span key={i} style={{ width: 2, height: 2, borderRadius: 1, background: v('meta') }} />
        : <span key={i} style={{ width: 2, height: `${Math.min(100, l * 110)}%`, borderRadius: 1, background: v('text') }} />))}
    </div>
  );
}

function Ticks({ read }: { read: boolean }) {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" aria-label={read ? 'oxundu' : 'çatdırıldı'} style={{ marginLeft: 3, flex: 'none' }}>
      <path d="M1 6l3 3 6-7.5M6.5 9l1 .9 6-7.5" stroke={read ? 'var(--wa-read)' : 'var(--wa-tick)'} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Meta({ m, read, mine }: { m: Message; read: boolean; mine: boolean }) {
  return (
    <span style={{ float: 'right', display: 'inline-flex', alignItems: 'center', fontSize: 11.5, color: mine ? v('meta-out') : v('meta'), margin: '8px 0 -5px 10px', position: 'relative', top: 4 }}>
      {hhmm(m.at)}{mine && <Ticks read={read} />}
    </span>
  );
}

/** The little curl on the last bubble of a group. */
function Tail({ mine }: { mine: boolean }) {
  return (
    <svg width="11" height="17" viewBox="0 0 11 17" aria-hidden="true" style={{ position: 'absolute', bottom: 0, [mine ? 'right' : 'left']: -5, transform: mine ? undefined : 'scaleX(-1)' }}>
      <path d="M0 0v17h11C5 15.5 1.2 11 0 0z" fill={mine ? 'var(--wa-out)' : 'var(--wa-in)'} />
    </svg>
  );
}

function Bubble({ m, first, last, read, live, onReply }: { m: Message; first: boolean; last: boolean; read: boolean; live: boolean; onReply: (r: string) => void }) {
  const mine = m.dir === 'in'; // the farmer's own messages
  const box = (tail: boolean): React.CSSProperties => ({
    position: 'relative', alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%', background: mine ? v('out') : v('in'), color: v('text'),
    borderRadius: 18, borderBottomRightRadius: mine && tail ? 4 : 18, borderBottomLeftRadius: !mine && tail ? 4 : 18,
    padding: m.kind === 'photo' ? 4 : '7px 11px 8px 12px', fontSize: 17, lineHeight: 1.3, boxShadow: v('shadow'),
    marginTop: first ? 8 : 2, marginLeft: mine ? 0 : 6, marginRight: mine ? 6 : 0, wordBreak: 'break-word',
  });
  const hasVoiceReply = !mine && (m.voiceUrl || m.voicePending);
  const tailOnMain = last && !m.card?.actions && !hasVoiceReply;
  return (
    <>
      <div style={box(tailOnMain)}>
        {tailOnMain && <Tail mine={mine} />}
        {m.kind === 'photo' && m.mediaUrl && (
          <div style={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.mediaUrl} alt="Şəkil" style={{ display: 'block', width: 250, maxWidth: '100%', borderRadius: 14 }} />
            <span style={{ position: 'absolute', right: 8, bottom: 6, fontSize: 11.5, color: '#fff', textShadow: '0 0 4px rgba(0,0,0,.7)', display: 'inline-flex', alignItems: 'center' }}>{hhmm(m.at)}<Ticks read={read} /></span>
          </div>
        )}
        {m.kind === 'voice' && <VoiceNote url={m.mediaUrl} mine meta={<Meta m={m} read={read} mine />} />}
        {m.kind === 'card' && m.card && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>{m.card.title}</div>
            {m.card.rows.map(([k, val]) => <div key={k} style={{ fontSize: 16 }}>{k}: <b style={{ fontWeight: 600 }}>{val}</b></div>)}
            {m.text && <div style={{ marginTop: 6, fontSize: 16 }}>{m.text}</div>}
            <Meta m={m} read={read} mine={mine} />
          </div>
        )}
        {m.kind === 'text' && <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}<Meta m={m} read={read} mine={mine} /></span>}
        {m.delivery === 'failed' && <div style={{ color: v('red'), fontSize: 12.5, marginTop: 4 }}>Göndərilmədi</div>}
      </div>
      {m.kind === 'card' && m.card?.actions && (
        <div style={{ alignSelf: 'flex-start', width: 'min(80%, 330px)', marginLeft: 6, display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {m.card.actions.map((a) => (
            <button key={a.reply} disabled={!live} onClick={() => onReply(a.reply)}
              style={{ border: 0, borderRadius: 12, background: v('in'), color: live ? v('link') : v('meta'), fontSize: 16.5, fontWeight: 500, padding: '11px 8px', cursor: live ? 'pointer' : 'default', boxShadow: v('shadow'), fontFamily: sys, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
              <svg width="16" height="14" viewBox="0 0 16 14" aria-hidden="true"><path d="M6 1L1 6l5 5M1.5 6H10a5 5 0 015 5v2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {hasVoiceReply && (
        <div style={{ ...box(last), marginTop: 2 }}>
          {last && <Tail mine={false} />}
          {m.voiceUrl ? <VoiceNote url={m.voiceUrl} meta={<Meta m={m} read={false} mine={false} />} /> : <div style={{ color: v('meta'), fontSize: 15, padding: '6px 4px' }}>🎙 səs yazır…</div>}
        </div>
      )}
    </>
  );
}

// ---------- Voice message: the real waveform of the audio, tap to seek, 1× / 1.5× / 2× ----------

const peaksCache = new Map<string, number[]>();
function fallbackPeaks(url: string) {
  let h = 0;
  for (const c of url) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: 36 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin((h % 97) + i * 1.7) * Math.cos(i * 0.37 + (h % 13))));
}

function usePeaks(url?: string) {
  const [peaks, setPeaks] = useState<number[] | undefined>(url ? peaksCache.get(url) : undefined);
  useEffect(() => {
    if (!url || peaksCache.has(url)) return;
    let gone = false;
    (async () => {
      try {
        const buf = await (await fetch(url)).arrayBuffer();
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const audio = await ctx.decodeAudioData(buf);
        void ctx.close();
        const data = audio.getChannelData(0);
        const n = 36;
        const step = Math.floor(data.length / n) || 1;
        const raw = Array.from({ length: n }, (_, i) => {
          let sum = 0;
          for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) sum += data[j] * data[j];
          return Math.sqrt(sum / (step / 8));
        });
        const max = Math.max(...raw, 1e-6);
        peaksCache.set(url, raw.map((x) => Math.max(0.12, x / max)));
      } catch {
        peaksCache.set(url, fallbackPeaks(url));
      }
      if (!gone) setPeaks(peaksCache.get(url));
    })();
    return () => { gone = true; };
  }, [url]);
  return peaks ?? (url ? fallbackPeaks(url) : []);
}

function VoiceNote({ url, mine, meta }: { url?: string; mine?: boolean; meta: React.ReactNode }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [heard, setHeard] = useState(false);
  const peaks = usePeaks(url);
  const frac = dur ? pos / dur : 0;
  const seek = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !dur) return;
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur;
    setPos(a.currentTime);
  };
  return (
    <div style={{ minWidth: 250 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button aria-label={playing ? 'Dayandır' : 'Oxut'} disabled={!url}
          onClick={() => { const a = ref.current; if (!a) return; if (playing) a.pause(); else { a.playbackRate = rate; void a.play(); } }}
          style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', flex: 'none', display: 'flex', color: v('icon') }}>
          {playing
            ? <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
            : <svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.8v14.4c0 .8.9 1.3 1.6.9l11-7.2a1.1 1.1 0 000-1.8l-11-7.2c-.7-.4-1.6.1-1.6.9z" fill="currentColor" /></svg>}
        </button>
        <div onPointerDown={seek} style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', gap: 2, height: 30, cursor: 'pointer', touchAction: 'none' }}>
          {peaks.map((p, i) => (
            <span key={i} style={{ flex: 1, minWidth: 2, height: `${p * 100}%`, borderRadius: 2, background: i / peaks.length < frac ? v('wave-on') : mine ? v('wave-out') : v('wave') }} />
          ))}
          <span style={{ position: 'absolute', left: `calc(${frac * 100}% - 6px)`, width: 12, height: 12, borderRadius: 6, background: mine ? 'var(--wa-green)' : 'var(--wa-read)', boxShadow: '0 0 2px rgba(0,0,0,0.3)' }} />
        </div>
        {playing || pos > 0 ? (
          <button onClick={() => { const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(n); if (ref.current) ref.current.playbackRate = n; }}
            style={{ flex: 'none', minWidth: 44, height: 26, borderRadius: 13, border: 0, background: 'rgba(127,127,127,0.25)', color: v('text'), fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {rate}×
          </button>
        ) : (
          <div style={{ width: 42, height: 42, borderRadius: 21, background: mine ? '#c5e8bf' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', position: 'relative' }}>
            {mine ? <span style={{ fontSize: 20 }}>🧑‍🌾</span> : <LogoMark size={24} />}
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ position: 'absolute', left: -4, bottom: -2 }}><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill={heard ? 'var(--wa-read)' : 'var(--wa-green)'} /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" stroke={heard ? 'var(--wa-read)' : 'var(--wa-green)'} strokeWidth="2.4" fill="none" strokeLinecap="round" /></svg>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 40, marginTop: -2 }}>
        <span style={{ fontSize: 12, color: mine ? v('meta-out') : v('meta'), fontVariantNumeric: 'tabular-nums' }}>{dur ? mmss(playing || pos > 0 ? pos : dur) : ''}</span>
        <span style={{ marginLeft: 'auto' }}>{meta}</span>
      </div>
      {url && (
        <audio ref={ref} src={url} preload="auto"
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (Number.isFinite(a.duration)) return setDur(a.duration);
            // Browser recordings (webm) report an unknown length until read to the end: seek far to learn it.
            const done = () => { a.removeEventListener('durationchange', done); if (Number.isFinite(a.duration)) { setDur(a.duration); a.currentTime = 0; setPos(0); } };
            a.addEventListener('durationchange', done);
            a.currentTime = 1e9;
          }}
          onTimeUpdate={(e) => { if (Number.isFinite(e.currentTarget.duration)) setPos(e.currentTarget.currentTime); }}
          onPlay={() => { setPlaying(true); setHeard(true); }} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }} />
      )}
    </div>
  );
}
