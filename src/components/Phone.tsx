'use client';
// The farmer's WhatsApp, docked beside the platform. In simulator mode you type, record or pick demo
// media here. In Twilio mode it mirrors the real conversations that pass through the server.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEMO_PHOTOS, DEMO_VOICE } from '@/lib/demo';
import type { Message } from '@/lib/types';
import { useLive } from './live';
import { bakuTime, LogoMark, Medallion, Thread } from './ui';

const CONTACTS = ['f-elsen', 'f-gulnare', 'f-rauf', 'f-sebine'];

async function post(fd: FormData) {
  await fetch('/api/phone', { method: 'POST', body: fd });
}

export function Phone() {
  const { s, phoneFarmer: farmerId, setPhoneFarmer: setFarmerId } = useLive();
  const [text, setText] = useState('');
  const [showEn, setShowEn] = useState(true);
  const [menu, setMenu] = useState(false);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const thread = useMemo(() => (s ? s.messages.filter((m) => m.farmerId === farmerId) : []), [s, farmerId]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [thread.length, farmerId]);

  if (!s) return null;
  const farmer = s.farmers.find((f) => f.id === farmerId)!;
  const contacts = Array.from(new Set([...CONTACTS, ...s.messages.map((m) => m.farmerId)])).map((id) => s.farmers.find((f) => f.id === id)!).filter(Boolean);
  const busy = s.aiRuns.some((r) => r.farmerId === farmerId && r.status === 'running' && r.steps.some((x) => x.status === 'running'));
  const lastCardId = [...thread].reverse().find((m) => m.dir === 'out' && m.card?.actions)?.id;
  const repliedAfterCard = lastCardId ? thread.slice(thread.findIndex((m) => m.id === lastCardId) + 1).some((m) => m.dir === 'in') : true;
  const twilio = s.settings.channel === 'twilio';

  const send = async (fields: Record<string, string | Blob>) => {
    const fd = new FormData();
    fd.set('farmerId', farmerId);
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    await post(fd);
  };

  const toggleRecord = async () => {
    if (rec) { rec.stop(); setRec(null); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void send({ audio: new Blob(chunks, { type: r.mimeType || 'audio/webm' }) });
      };
      r.start();
      setRec(r);
    } catch {
      alert('Microphone not available. Use a demo voice note instead.');
    }
  };

  const demoVoices = Object.entries(DEMO_VOICE).filter(([, v]) => v.farmerId === farmerId);

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '16px 18px', gap: 12, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="tablist" aria-label="Farmer phones">
        {contacts.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={f.id === farmerId}
            onClick={() => setFarmerId(f.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px', borderRadius: 2, border: 0, cursor: 'pointer', fontSize: 13,
              background: f.id === farmerId ? 'var(--paper)' : 'transparent', boxShadow: f.id === farmerId ? '0 0 0 1px var(--line)' : undefined, fontWeight: f.id === farmerId ? 600 : 400,
            }}
          >
            <Thread color={f.color} w={4} h={14} />
            {f.name.split(' ')[0]}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', borderRadius: 34, background: '#1F1B16', padding: 10, boxShadow: '0 24px 48px -24px rgba(31,27,22,0.55)' }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 26, overflow: 'hidden', background: '#EFE7DA' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: '#2E3A2F', color: '#F4EEE3' }}>
            <div style={{ width: 36, height: 36, borderRadius: 18, background: '#FBF8F2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LogoMark size={22} /></div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>BƏRƏKƏT</div>
              <div style={{ fontSize: 12, opacity: 0.8 }}>{busy ? 'typing…' : twilio && farmer.phone ? 'WhatsApp · Twilio sandbox' : 'WhatsApp · simulated'}</div>
            </div>
            <button onClick={() => setShowEn((v) => !v)} aria-pressed={showEn} style={{ height: 30, padding: '0 10px', borderRadius: 15, border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: showEn ? '#F4EEE3' : 'transparent', color: showEn ? '#2E3A2F' : '#F4EEE3', boxShadow: 'inset 0 0 0 1px #F4EEE3' }}>EN</button>
          </div>
          <div style={{ padding: '6px 14px', fontSize: 12, color: 'var(--ink2)', background: '#E4DBC9', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Thread color={farmer.color} w={4} h={12} /> {farmer.name}'s phone · {farmer.village}
          </div>

          <div ref={scroller} className="scroll" style={{ flex: 1, minHeight: 0, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {thread.length === 0 && <div className="muted" style={{ fontSize: 13, textAlign: 'center', padding: 20 }}>No messages yet.</div>}
            {thread.map((m) => (
              <Bubble key={m.id} m={m} showEn={showEn} live={m.id === lastCardId && !repliedAfterCard} onReply={(r) => void send({ text: r })} />
            ))}
            {busy && (
              <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: 10, padding: '8px 12px', fontSize: 18, letterSpacing: 2 }} className="blink" aria-label="BƏRƏKƏT is typing">···</div>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); if (text.trim()) { void send({ text: text.trim() }); setText(''); } }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 10, background: '#E4DBC9', position: 'relative' }}
          >
            <button type="button" onClick={() => setMenu((v) => !v)} aria-label="Demo media" aria-expanded={menu} style={iconBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="#2E3A2F" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
            <label htmlFor="msg" style={{ position: 'absolute', left: -9999 }}>Message</label>
            <input id="msg" value={text} onChange={(e) => setText(e.target.value)} placeholder="Mesaj" autoComplete="off"
              style={{ flex: 1, minWidth: 0, height: 40, borderRadius: 20, border: 0, padding: '0 14px', fontSize: 15, background: '#fff', outline: 'none' }} />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Send photo" style={iconBtn}>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2" fill="none" stroke="#2E3A2F" strokeWidth="1.8" /><circle cx="12" cy="12.5" r="3.2" fill="none" stroke="#2E3A2F" strokeWidth="1.8" /><path d="M8 6l1.5-2h5L16 6" fill="none" stroke="#2E3A2F" strokeWidth="1.8" /></svg>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void send({ photo: f }); e.target.value = ''; }} />
            {text.trim() ? (
              <button type="submit" aria-label="Send" style={{ ...iconBtn, background: '#2E3A2F' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7z" fill="#F4EEE3" /></svg>
              </button>
            ) : (
              <button type="button" onClick={toggleRecord} aria-label={rec ? 'Stop and send voice note' : 'Record voice note'} style={{ ...iconBtn, background: rec ? 'var(--madder)' : '#2E3A2F' }}>
                {rec ? <span style={{ width: 12, height: 12, background: '#fff', borderRadius: 2 }} /> : (
                  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="#F4EEE3" /><path d="M6 11a6 6 0 0012 0M12 17v4" stroke="#F4EEE3" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
                )}
              </button>
            )}

            {menu && (
              <div className="card" style={{ position: 'absolute', bottom: 58, left: 8, right: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 2, zIndex: 5, boxShadow: '0 0 0 1px var(--line), 0 12px 24px -12px rgba(31,27,22,0.4)' }}>
                <div className="eyebrow muted" style={{ fontSize: 10, padding: '6px 8px' }}>Demo voice notes and photos</div>
                {demoVoices.map(([id, v]) => (
                  <MenuItem key={id} onClick={() => { setMenu(false); void send({ demoVoice: id, ...(id === 'elsen-listing' ? { demoPhoto: 'tomatoes-stage4' } : {}) }); }}>
                    {id === 'elsen-listing' ? 'Voice note + photo: ' : 'Voice note: '}{v.label.split(': ')[1]}
                  </MenuItem>
                ))}
                {DEMO_PHOTOS.map((p) => (
                  <MenuItem key={p.id} onClick={() => { setMenu(false); void send({ demoPhoto: p.id }); }}>Photo: {p.label}</MenuItem>
                ))}
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = { width: 40, height: 40, flex: 'none', borderRadius: 20, border: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent' };

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ textAlign: 'left', minHeight: 40, padding: '8px 10px', border: 0, background: 'transparent', cursor: 'pointer', borderRadius: 2, fontSize: 14 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper2)')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
      {children}
    </button>
  );
}

function Bubble({ m, showEn, live, onReply }: { m: Message; showEn: boolean; live: boolean; onReply: (r: string) => void }) {
  const mine = m.dir === 'in'; // the farmer's own messages sit on the right of their phone
  const box: React.CSSProperties = {
    alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '86%', background: mine ? '#DCEBC9' : '#fff', borderRadius: 10,
    padding: m.kind === 'photo' ? 4 : '8px 10px', fontSize: 14, lineHeight: 1.4, boxShadow: '0 1px 0 rgba(31,27,22,0.08)',
  };
  const gloss = showEn && (m.textEn) ? <div className="note" style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>{m.textEn}</div> : null;
  const meta = (
    <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'right', marginTop: 2 }} className="num">
      {bakuTime(m.at)}{m.via === 'twilio' && m.dir === 'out' ? (m.delivery === 'sent' ? ' ✓✓' : m.delivery === 'failed' ? ' · failed' : ' · sending') : ''}
    </div>
  );
  return (
    <div style={box} className="fade-up">
      {m.kind === 'photo' && m.mediaUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.mediaUrl} alt="Produce photo" style={{ display: 'block', width: 220, maxWidth: '100%', borderRadius: 8 }} />
      )}
      {m.kind === 'voice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
          <VoiceLine url={m.mediaUrl} />
          {m.transcript ? <div style={{ fontSize: 13, color: 'var(--ink2)' }}>“{m.transcript}”</div> : <div className="muted" style={{ fontSize: 12 }}>Transcribing…</div>}
        </div>
      )}
      {m.kind === 'card' && m.card && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 230 }}>
          <div style={{ fontWeight: 700 }}>{m.card.title}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: 13.5 }}>
            {m.card.rows.map(([k, v]) => (
              <span key={k} style={{ display: 'contents' }}><span className="muted">{k}</span><span style={{ fontWeight: 600 }}>{v}</span></span>
            ))}
          </div>
          {m.text && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{m.text}</div>}
          {m.card.actions && (
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {m.card.actions.map((a) => (
                <button key={a.reply} disabled={!live} onClick={() => onReply(a.reply)}
                  style={{ flex: 1, minHeight: 38, border: 0, borderRadius: 6, cursor: live ? 'pointer' : 'default', fontWeight: 700, fontSize: 14, background: live ? '#EAF1E2' : '#F1EEE7', color: live ? '#2E3A2F' : 'var(--muted)' }}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {m.kind === 'text' && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
      {m.kind !== 'photo' && gloss}
      {meta}
    </div>
  );
}

function VoiceLine({ url }: { url?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const bars = [6, 12, 9, 16, 11, 7, 14, 18, 10, 6, 13, 9, 15, 8, 12, 5, 10, 14, 7, 11];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button
        onClick={() => { if (!ref.current) return; if (playing) ref.current.pause(); else void ref.current.play(); }}
        disabled={!url}
        aria-label={playing ? 'Pause voice note' : 'Play voice note'}
        style={{ width: 34, height: 34, borderRadius: 17, border: 0, background: '#2E3A2F', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: url ? 'pointer' : 'default', opacity: url ? 1 : 0.5 }}
      >
        {playing ? <span style={{ width: 10, height: 12, borderLeft: '3px solid #fff', borderRight: '3px solid #fff' }} /> : <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z" fill="#fff" /></svg>}
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 20 }} aria-hidden="true">
        {bars.map((h, i) => <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: '#7C8A6E' }} />)}
      </div>
      <Medallion size={12} fill="#7C8A6E" />
      {url && <audio ref={ref} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="none" />}
    </div>
  );
}
