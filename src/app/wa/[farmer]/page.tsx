'use client';
// The farmer's phone: a WhatsApp-style chat with the BƏRƏKƏT assistant, made to be opened on a real phone on the
// same Wi-Fi (npm run demo:phone). Everything goes through the same server state as the laptop views.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLive } from '@/components/live';
import { LogoMark } from '@/components/ui';
import { DEMO_PHOTOS, DEMO_VOICE } from '@/lib/demo';
import type { Message } from '@/lib/types';

const WA = {
  header: '#008069', bg: '#efeae2', out: '#d9fdd3', in: '#ffffff', meta: '#667781', tickRead: '#53bdeb', tick: '#8696a0',
  green: '#00a884', text: '#111b21', button: '#027eb5', chip: '#ffffff',
};
const sys = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' });

async function post(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const res = await fetch('/api/phone', { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`send failed (${res.status})`);
}

export default function WaChat({ params }: { params: { farmer: string } }) {
  const farmerId = params.farmer;
  const { s, connected } = useLive();
  const [text, setText] = useState('');
  const [sheet, setSheet] = useState(false);
  const [sending, setSending] = useState(0);
  const [toast, setToast] = useState<string>();
  const [rec, setRec] = useState<{ t0: number; now: number; cancelling: boolean } | null>(null);
  const recRef = useRef<{ r?: MediaRecorder; stream?: MediaStream; chunks: Blob[]; t0: number; released: boolean; cancelled: boolean; x: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const audioFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { try { localStorage.setItem('berekat.waFarmer', farmerId); } catch { /* storage blocked */ } }, [farmerId]);
  const thread = useMemo(() => (s ? s.messages.filter((m) => m.farmerId === farmerId) : []), [s, farmerId]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [thread.length, sending, thread[thread.length - 1]?.voiceUrl]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), 3500); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setRec((r) => (r ? { ...r, now: Date.now() } : r)), 200); return () => clearInterval(t); }, [rec?.t0]);

  if (!s) return <Frame><div style={{ margin: 'auto', color: WA.meta }}>Yüklənir…</div></Frame>;
  const farmer = s.farmers.find((f) => f.id === farmerId);
  if (!farmer) return <Frame><div style={{ margin: 'auto', padding: 24, textAlign: 'center' }}>Belə fermer yoxdur. <Link href="/wa" style={{ color: WA.green }}>Geri</Link></div></Frame>;

  // "typing…" while the assistant works on the farmer's latest message.
  const lastInIdx = thread.map((m) => m.dir).lastIndexOf('in');
  const lastOutIdx = thread.map((m) => m.dir).lastIndexOf('out');
  const working = s.aiRuns.some((r) => r.farmerId === farmerId && r.steps.some((x) => x.status === 'running'));
  const awaitingMore = s.aiRuns.some((r) => r.farmerId === farmerId && r.status === 'running' && !r.steps.some((x) => x.status === 'running'));
  const busy = working || (lastInIdx > lastOutIdx && lastInIdx >= 0 && !awaitingMore);
  const recording = thread.some((m) => m.dir === 'out' && m.voicePending);
  const lastCardId = [...thread].reverse().find((m) => m.dir === 'out' && m.card?.actions)?.id;
  const answered = lastCardId ? thread.slice(thread.findIndex((m) => m.id === lastCardId) + 1).some((m) => m.dir === 'in') : true;

  const send = async (fields: Record<string, string | Blob>) => {
    setSending((n) => n + 1);
    try { await post({ farmerId, ...fields }); } catch (e) { setToast((e as Error).message); } finally { setSending((n) => n - 1); }
  };

  // ---------- Voice notes: press and hold to record, release to send, slide left to cancel ----------
  const startRec = async (x: number) => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setToast('Mikrofon üçün HTTPS linkini açın. İndilik 📎 ilə hazır səs yazısı göndərin.');
      setSheet(true);
      return;
    }
    const st = { chunks: [] as Blob[], t0: Date.now(), released: false, cancelled: false, x } as NonNullable<typeof recRef.current>;
    recRef.current = st;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (st.released) { stream.getTracks().forEach((t) => t.stop()); recRef.current = null; setToast('Mikrofona icazə verildi. İndi basıb saxlayın.'); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      st.r = r; st.stream = stream; st.t0 = Date.now();
      r.ondataavailable = (e) => e.data.size && st.chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const ms = Date.now() - st.t0;
        if (st.cancelled) return;
        if (ms < 700) { setToast('Səs yazmaq üçün basıb saxlayın'); return; }
        void send({ audio: new Blob(st.chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] }) });
      };
      r.start(250);
      navigator.vibrate?.(30);
      setRec({ t0: Date.now(), now: Date.now(), cancelling: false });
    } catch {
      recRef.current = null;
      setToast('Mikrofon icazəsi yoxdur. Brauzer ayarlarından icazə verin.');
    }
  };
  const moveRec = (x: number) => {
    const st = recRef.current;
    if (!st?.r) return;
    const cancelling = st.x - x > 90;
    setRec((r) => (r && r.cancelling !== cancelling ? { ...r, cancelling } : r));
  };
  const endRec = (x: number) => {
    const st = recRef.current;
    if (!st) return;
    st.released = true;
    if (st.r) {
      st.cancelled = st.x - x > 90;
      if (st.r.state !== 'inactive') st.r.stop();
      recRef.current = null;
      setRec(null);
    }
  };

  const pickFile = (kind: 'photo' | 'audio') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) void send({ [kind]: f });
  };
  const demoVoices = Object.entries(DEMO_VOICE).filter(([, v]) => v.farmerId === farmerId);
  const secs = rec ? Math.floor((rec.now - rec.t0) / 1000) : 0;

  return (
    <Frame>
      {/* Header */}
      <header style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 10px 4px', paddingTop: 'max(10px, env(safe-area-inset-top))', background: WA.header, color: '#fff' }}>
        <Link href="/wa" aria-label="Geri" style={{ display: 'flex', alignItems: 'center', padding: 6, color: '#fff' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><LogoMark size={24} /></div>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontWeight: 600, fontSize: 17, letterSpacing: 0.2 }}>BƏRƏKƏT</div>
          <div style={{ fontSize: 13, opacity: 0.9 }}>{!connected ? 'bağlantı gözlənilir…' : recording && !busy ? 'səs yazır…' : busy ? 'yazır…' : 'onlayn'}</div>
        </div>
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" style={{ margin: '0 8px', opacity: 0.95 }}><rect x="2.5" y="6.5" width="13" height="11" rx="2" stroke="#fff" strokeWidth="1.8" fill="none" /><path d="M15.5 10.5l5-3v9l-5-3" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinejoin="round" /></svg>
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ margin: '0 8px', opacity: 0.95 }}><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.25 11.4 11.4 0 003.6.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.45.57 3.57a1 1 0 01-.25 1z" fill="#fff" /></svg>
      </header>

      {/* Messages */}
      <div ref={scroller} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 3, background: `${WA.bg} radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1.5px) 0 0 / 22px 22px` }}>
        <div style={{ alignSelf: 'center', background: '#fff8c4', color: '#54656f', fontSize: 12.5, lineHeight: 1.35, textAlign: 'center', borderRadius: 8, padding: '6px 10px', margin: '6px 18px 8px', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
          🔒 Mesajlar BƏRƏKƏT köməkçisi tərəfindən emal olunur. Demo: real pul köçürülmür.
        </div>
        <div style={{ alignSelf: 'center', background: WA.chip, color: '#54656f', fontSize: 12.5, fontWeight: 500, borderRadius: 8, padding: '5px 12px', margin: '4px 0 8px', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>BU GÜN</div>
        {thread.length === 0 && (
          <div style={{ alignSelf: 'center', color: WA.meta, fontSize: 14, textAlign: 'center', padding: '24px 30px' }}>Satmaq istədiyiniz məhsul barədə səsli mesaj və ya yazı göndərin.</div>
        )}
        {thread.map((m, i) => {
          const prev = thread[i - 1];
          const firstOfGroup = !prev || prev.dir !== m.dir;
          const read = m.dir === 'in' && thread.slice(i + 1).some((x) => x.dir === 'out');
          return (
            <Bubble key={m.id} m={m} first={firstOfGroup} read={read}
              live={m.id === lastCardId && !answered} onReply={(r) => void send({ text: r })} />
          );
        })}
        {sending > 0 && <div style={{ alignSelf: 'flex-end', color: WA.meta, fontSize: 12, padding: '2px 6px' }}>göndərilir…</div>}
      </div>

      {/* Composer */}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'flex-end', gap: 6, padding: '6px 6px', paddingBottom: 'max(8px, env(safe-area-inset-bottom))', background: WA.bg, position: 'relative' }}>
        {rec ? (
          <div style={{ flex: 1, height: 48, borderRadius: 24, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', fontSize: 16, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: '#ea0038', animation: 'blink 1s ease-in-out infinite' }} />
            <span style={{ fontVariantNumeric: 'tabular-nums', color: WA.text }}>{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}</span>
            <span style={{ marginLeft: 'auto', color: rec.cancelling ? '#ea0038' : WA.meta, fontSize: 14 }}>{rec.cancelling ? 'Buraxın: ləğv' : '‹ Ləğv üçün sürüşdürün'}</span>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) { setText(''); void send({ text: t }); } }}
            style={{ flex: 1, minHeight: 48, borderRadius: 24, background: '#fff', display: 'flex', alignItems: 'center', gap: 2, padding: '0 6px 0 10px', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
            <span aria-hidden="true" style={{ fontSize: 22, opacity: 0.55, padding: '0 4px' }}>☺</span>
            <label htmlFor="wa-msg" style={{ position: 'absolute', left: -9999 }}>Mesaj</label>
            <input id="wa-msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mesaj" autoComplete="off" enterKeyHint="send"
              style={{ flex: 1, minWidth: 0, border: 0, outline: 'none', fontSize: 17, fontFamily: sys, padding: '12px 4px', background: 'transparent', color: WA.text }} />
            <button type="button" aria-label="Əlavə et" onClick={() => setSheet((v) => !v)} style={iconBtn}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6.5l-7.8 7.8a2 2 0 002.8 2.8l8-8a4 4 0 00-5.6-5.6l-8.2 8.2a6 6 0 008.5 8.5l6.4-6.4" stroke="#54656f" strokeWidth="1.8" fill="none" strokeLinecap="round" /></svg>
            </button>
            {!text.trim() && (
              <button type="button" aria-label="Kamera" onClick={() => cameraRef.current?.click()} style={iconBtn}>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="18" height="13" rx="2.5" stroke="#54656f" strokeWidth="1.8" fill="none" /><circle cx="12" cy="13" r="3.4" stroke="#54656f" strokeWidth="1.8" fill="none" /><path d="M8.5 6.5L10 4h4l1.5 2.5" stroke="#54656f" strokeWidth="1.8" fill="none" /></svg>
              </button>
            )}
            {text.trim() && <button type="submit" aria-hidden="true" tabIndex={-1} style={{ display: 'none' }} />}
          </form>
        )}
        {text.trim() && !rec ? (
          <button aria-label="Göndər" onClick={() => { const t = text.trim(); setText(''); void send({ text: t }); }} style={roundBtn}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.4 20.4l17.4-7.5c.8-.4.8-1.5 0-1.8L3.4 3.6c-.7-.3-1.4.3-1.3 1l1.2 6.1 9 1.3-9 1.3-1.2 6.1c-.1.7.6 1.3 1.3 1z" fill="#fff" /></svg>
          </button>
        ) : (
          <button aria-label="Səs yazısı: basıb saxlayın" style={{ ...roundBtn, transform: rec ? 'scale(1.25)' : undefined, transition: 'transform .12s', touchAction: 'none' }}
            onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId); void startRec(e.clientX); }}
            onPointerMove={(e) => moveRec(e.clientX)}
            onPointerUp={(e) => endRec(e.clientX)}
            onPointerCancel={(e) => endRec(e.clientX + 1000)}
            onContextMenu={(e) => e.preventDefault()}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="#fff" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          </button>
        )}

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFile('photo')} />
        <input ref={galleryRef} type="file" accept="image/*" hidden onChange={pickFile('photo')} />
        <input ref={audioFileRef} type="file" accept="audio/*" hidden onChange={pickFile('audio')} />

        {sheet && (
          <>
            <div onClick={() => setSheet(false)} style={{ position: 'fixed', inset: 0, zIndex: 10 }} />
            <div role="dialog" aria-label="Əlavə et" style={{ position: 'absolute', left: 8, right: 8, bottom: 64, zIndex: 11, background: '#fff', borderRadius: 16, padding: '18px 12px 12px', boxShadow: '0 8px 30px rgba(11,20,26,0.25)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 12 }}>
                <SheetIcon color="#d3396d" label="Kamera" onClick={() => { setSheet(false); cameraRef.current?.click(); }} icon="📷" />
                <SheetIcon color="#bf59cf" label="Qalereya" onClick={() => { setSheet(false); galleryRef.current?.click(); }} icon="🖼️" />
                <SheetIcon color="#ec7a2a" label="Audio fayl" onClick={() => { setSheet(false); audioFileRef.current?.click(); }} icon="🎧" />
              </div>
              {(demoVoices.length > 0 || farmerId === 'f-elsen') && (
                <div style={{ borderTop: '1px solid #e9edef', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <div style={{ fontSize: 12, color: WA.meta, padding: '0 6px 4px', letterSpacing: 0.3 }}>HAZIR SƏS YAZILARI (DEMO)</div>
                  {demoVoices.map(([id, v]) => (
                    <SheetRow key={id} onClick={() => { setSheet(false); void send({ demoVoice: id, ...(id === 'elsen-listing' ? { demoPhoto: 'tomatoes-stage4' } : {}) }); }}>
                      🎤 {id === 'elsen-listing' ? 'Səsli mesaj + şəkil: pomidor satışı' : v.label.split(': ')[1]}
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
        {toast && <div role="status" style={{ position: 'absolute', left: 16, right: 16, bottom: 70, zIndex: 12, background: '#323739', color: '#fff', borderRadius: 10, padding: '10px 14px', fontSize: 14, textAlign: 'center' }}>{toast}</div>}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: WA.bg, fontFamily: sys, color: WA.text, WebkitTapHighlightColor: 'transparent', maxWidth: 560, margin: '0 auto', boxShadow: '0 0 0 1px rgba(0,0,0,0.04)' }}>
      {children}
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 40, height: 44, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flex: 'none' };
const roundBtn: React.CSSProperties = { width: 48, height: 48, borderRadius: 24, border: 0, background: WA.green, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flex: 'none', boxShadow: '0 1px 2px rgba(11,20,26,0.2)', userSelect: 'none', WebkitUserSelect: 'none' };

function SheetIcon({ color, label, icon, onClick }: { color: string; label: string; icon: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ border: 0, background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#54656f', fontFamily: sys }}>
      <span style={{ width: 54, height: 54, borderRadius: 27, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{icon}</span>
      {label}
    </button>
  );
}

function SheetRow({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} style={{ textAlign: 'left', border: 0, background: 'transparent', padding: '11px 8px', fontSize: 15.5, borderRadius: 8, cursor: 'pointer', color: WA.text, fontFamily: sys }}>{children}</button>;
}

function Ticks({ read }: { read: boolean }) {
  return (
    <svg width="17" height="11" viewBox="0 0 17 11" aria-label={read ? 'oxundu' : 'çatdırıldı'} style={{ marginLeft: 3, flex: 'none' }}>
      <path d="M1 6l3 3 6-7.5M6.5 9l1 .9 6-7.5" stroke={read ? WA.tickRead : WA.tick} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Meta({ m, read }: { m: Message; read: boolean }) {
  return (
    <span style={{ float: 'right', display: 'inline-flex', alignItems: 'center', gap: 1, fontSize: 11.5, color: WA.meta, margin: '6px 0 -4px 10px', position: 'relative', top: 4 }}>
      {hhmm(m.at)}{m.dir === 'in' && <Ticks read={read} />}
    </span>
  );
}

function Bubble({ m, first, read, live, onReply }: { m: Message; first: boolean; read: boolean; live: boolean; onReply: (r: string) => void }) {
  const mine = m.dir === 'in'; // the farmer's own messages
  const box: React.CSSProperties = {
    alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '82%', background: mine ? WA.out : WA.in, color: WA.text,
    borderRadius: first ? (mine ? '8px 0 8px 8px' : '0 8px 8px 8px') : 8, padding: m.kind === 'photo' ? 3 : '6px 8px 8px 9px', fontSize: 15.5, lineHeight: 1.36,
    boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', marginTop: first ? 6 : 0, wordBreak: 'break-word',
  };
  return (
    <>
      <div style={box}>
        {m.kind === 'photo' && m.mediaUrl && (
          <div style={{ position: 'relative' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.mediaUrl} alt="Şəkil" style={{ display: 'block', width: 240, maxWidth: '100%', borderRadius: 6 }} />
            <span style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 11, color: '#fff', textShadow: '0 0 3px rgba(0,0,0,.6)', display: 'inline-flex', alignItems: 'center' }}>{hhmm(m.at)}<Ticks read={read} /></span>
          </div>
        )}
        {m.kind === 'voice' && <><VoiceNote url={m.mediaUrl} mine /><Meta m={m} read={read} /></>}
        {m.kind === 'card' && m.card && (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>{m.card.title}</div>
            {m.card.rows.map(([k, v]) => <div key={k}>{k}: <b style={{ fontWeight: 600 }}>{v}</b></div>)}
            {m.text && <div style={{ marginTop: 6 }}>{m.text}</div>}
            <Meta m={m} read={read} />
          </div>
        )}
        {m.kind === 'text' && <span style={{ whiteSpace: 'pre-wrap' }}>{m.text}<Meta m={m} read={read} /></span>}
        {m.delivery === 'failed' && <div style={{ color: '#ea0038', fontSize: 12, marginTop: 4 }}>Göndərilmədi</div>}
      </div>
      {m.kind === 'card' && m.card?.actions && (
        <div style={{ alignSelf: 'flex-start', width: 'min(82%, 320px)', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 3 }}>
          {m.card.actions.map((a) => (
            <button key={a.reply} disabled={!live} onClick={() => onReply(a.reply)}
              style={{ border: 0, borderRadius: 8, background: '#fff', color: live ? WA.button : WA.meta, fontSize: 15.5, fontWeight: 500, padding: '10px 8px', cursor: live ? 'pointer' : 'default', boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', fontFamily: sys, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <span aria-hidden="true" style={{ fontSize: 14 }}>↩</span> {a.label}
            </button>
          ))}
        </div>
      )}
      {!mine && (m.voiceUrl || m.voicePending) && (
        <div style={{ ...box, borderRadius: 8, marginTop: 3, padding: '6px 8px 8px 9px' }}>
          {m.voiceUrl ? <VoiceNote url={m.voiceUrl} /> : <div style={{ color: WA.meta, fontSize: 14, padding: '6px 4px' }}>🎙 səs yazır…</div>}
          {m.voiceUrl && <Meta m={m} read={false} />}
        </div>
      )}
    </>
  );
}

const BARS = [8, 14, 10, 18, 12, 7, 16, 20, 11, 6, 15, 10, 17, 9, 13, 6, 11, 16, 8, 12, 18, 10, 7, 14, 9, 12];

function VoiceNote({ url, mine }: { url?: string; mine?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const t = playing || pos > 0 ? pos : dur;
  const showTime = playing || pos > 0 || dur > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 230, padding: '2px 0' }}>
      <div style={{ width: 40, height: 40, borderRadius: 20, background: mine ? '#c5e8bf' : '#dfe5e7', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none', position: 'relative' }}>
        {mine ? <span style={{ fontSize: 18 }}>🧑‍🌾</span> : <LogoMark size={22} />}
        <span style={{ position: 'absolute', right: -3, bottom: -2, fontSize: 12 }}>🎤</span>
      </div>
      <button aria-label={playing ? 'Dayandır' : 'Oxut'} disabled={!url}
        onClick={() => { const a = ref.current; if (!a) return; if (playing) a.pause(); else void a.play(); }}
        style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', flex: 'none', display: 'flex' }}>
        {playing
          ? <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="#54656f" /><rect x="14" y="5" width="4" height="14" rx="1" fill="#54656f" /></svg>
          : <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="#54656f" /></svg>}
      </button>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 22 }} aria-hidden="true">
          {BARS.map((h, i) => <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: dur && i / BARS.length < pos / dur ? (mine ? '#3e8f7b' : WA.tickRead) : '#b5bfc6' }} />)}
        </div>
        <span style={{ fontSize: 11.5, color: WA.meta, fontVariantNumeric: 'tabular-nums', minHeight: 14 }}>{showTime ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : ''}</span>
      </div>
      {url && (
        <audio ref={ref} src={url} preload="auto"
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            if (Number.isFinite(a.duration)) return setDur(a.duration);
            // Browser recordings (webm) report an unknown length until read to the end: seek far to learn it.
            const done = () => { a.removeEventListener('durationchange', done); if (Number.isFinite(a.duration)) { setDur(a.duration); a.currentTime = 0; } };
            a.addEventListener('durationchange', done);
            a.currentTime = 1e9;
          }}
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }} />
      )}
    </div>
  );
}
