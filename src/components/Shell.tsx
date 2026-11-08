'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLive, type LiveState } from './live';
import { Phone } from './Phone';
import { Band, bakuDay, bakuTime, LogoMark, Wordmark } from './ui';

type Persp = 'buyer' | 'operator';

const NAV: Record<Persp, { href: string; label: string; key: string }[]> = {
  buyer: [
    { href: '/buyer', label: 'Tenders', key: 'tenders' },
    { href: '/buyer/orders', label: 'Orders', key: 'orders' },
  ],
  operator: [
    { href: '/operator', label: 'Live', key: 'live' },
    { href: '/operator/intake', label: 'Intake', key: 'intake' },
    { href: '/connect', label: 'Phones', key: 'connect' },
  ],
};

const KEYS: [string, string][] = [
  ['P', 'Backup: show the farmer phone on the laptop (real phones: /connect)'],
  ['B / O', 'Buyer / Operator view'],
  ['A', 'Other farmers accept their offers'],
  ['S', 'Səbinə says hello (opens her 24 h WhatsApp window)'],
  ['C', 'Rauf cancels by voice note'],
  ['T', 'Skip to delivery morning, 09:00 (pickup and arrival)'],
  ['L', "Fallback: put Elşən's listing live without Act 1"],
  ['F', 'AI mode: LIVE → CACHED → SIMULATED'],
  ['W', 'Switch WhatsApp channel: simulator or Twilio'],
  ['V', 'Voice replies on/off (Azerbaijani voice notes from the assistant)'],
  ['R', 'Reset all demo data'],
  ['?', 'This panel'],
];

export function Shell({ perspective, active, children }: { perspective: Persp; active: string; children: React.ReactNode }) {
  const { s, act, connected } = useLive();
  const router = useRouter();
  const path = usePathname();
  // The farmer's phone is a real phone now (/wa via /connect); the docked one is a backup behind P.
  const [dock, setDock] = useState(false);
  const [speak, setSpeak] = useState(false);
  const [help, setHelp] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    try { setDock(localStorage.getItem('berekat.dock') === '1'); setSpeak(localStorage.getItem('berekat.speak') === '1'); } catch { /* storage blocked */ }
    const t = setInterval(() => tick((x) => x + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const d = (op: string, arg?: string) => void act('director', { op, arg });
      if (k === 'p') setDock((v) => { const n = !v; try { localStorage.setItem('berekat.dock', n ? '1' : '0'); } catch { /* */ } return n; });
      else if (k === 'b') router.push('/buyer');
      else if (k === 'o') router.push('/operator');
      else if (k === 'a') d('acceptOthers');
      else if (k === 's') d('sebineHello');
      else if (k === 'c') { d('cancelRauf'); if (!path.startsWith('/operator')) router.push('/operator'); }
      else if (k === 't') d('thursday');
      else if (k === 'l') d('elsenFallback');
      else if (k === 'f') d('aiMode');
      else if (k === 'w') d('channel');
      else if (k === 'v') d('voice');
      else if (k === 'r') { d('reset'); router.push('/buyer'); }
      else if (e.key === '?') setHelp((v) => !v);
      else if (k === 'escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, router, path]);

  useVoiceAutoplay(speak, s?.messages);

  const nowIso = s ? new Date(new Date(s.clock.base).getTime() + (Date.now() - s.clock.startedAtMs)).toISOString() : undefined;
  const openRecovery = s?.orders.some((o) => o.recovery && ['searching', 'proposed', 'offered'].includes(o.recovery.status));
  const review = s?.aiRuns.filter((r) => r.status === 'needs_review').length ?? 0;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Band />
      <header style={{ minHeight: 64, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 32px', padding: '8px 40px', borderBottom: '1px solid var(--hair)', background: 'var(--paper)' }}>
        <Link href="/buyer" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label="BƏRƏKƏT home">
          <LogoMark />
          <Wordmark />
        </Link>
        <div role="group" aria-label="Perspective" style={{ display: 'flex', padding: 3, borderRadius: 3, background: '#EDE4D3' }}>
          {(['buyer', 'operator'] as Persp[]).map((p) => (
            <Link
              key={p}
              href={p === 'buyer' ? '/buyer' : '/operator'}
              aria-current={perspective === p ? 'page' : undefined}
              style={{
                height: 34, padding: '0 16px', display: 'flex', alignItems: 'center', borderRadius: 2, fontSize: 14,
                fontWeight: perspective === p ? 600 : 400,
                background: perspective === p ? '#fff' : 'transparent',
                boxShadow: perspective === p ? '0 1px 2px rgba(31,27,22,0.18)' : undefined,
                color: perspective === p ? (p === 'operator' ? 'var(--indigo)' : 'var(--soot)') : 'var(--muted)',
              }}
            >
              {p === 'buyer' ? 'Buyer' : 'Operator'}
            </Link>
          ))}
        </div>
        <nav aria-label={`${perspective} navigation`} style={{ display: 'flex', gap: 28, fontSize: 15, alignSelf: 'stretch' }}>
          {NAV[perspective].map((n) => (
            <Link
              key={n.key}
              href={n.href}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, fontWeight: active === n.key ? 600 : 400, color: active === n.key ? 'var(--soot)' : 'var(--muted)',
                borderBottom: active === n.key ? `2px dashed ${perspective === 'operator' ? 'var(--indigo)' : 'var(--madder)'}` : '2px solid transparent',
                minHeight: 44,
              }}
            >
              {n.label}
              {n.key === 'live' && openRecovery && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--madder)', borderRadius: 2, padding: '1px 6px' }}>1</span>}
              {n.key === 'intake' && review > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--saffron)', borderRadius: 2, padding: '1px 6px' }}>{review}</span>}
            </Link>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--ink2)' }}>
          {s && <AiModeChip mode={s.settings.aiMode} />}
          {s?.settings.voiceReplies && (
            <button className="chip" aria-pressed={speak} onClick={() => setSpeak((v) => { const n = !v; try { localStorage.setItem('berekat.speak', n ? '1' : '0'); } catch { /* */ } return n; })}
              title={speak ? 'Voice replies play on this laptop (click to mute)' : 'Voice replies are sent; click to also play them on this laptop'}
              style={{ border: 0, cursor: 'pointer', background: speak ? 'var(--olive)' : 'transparent', color: speak ? 'var(--paper)' : undefined }}>
              {speak ? '🔊 Voice replies' : '🔈 Voice replies'}
            </button>
          )}
          {s?.settings.channel === 'twilio' && <span className="chip" style={{ boxShadow: 'inset 0 0 0 1px var(--olive)', color: 'var(--olive-ink)' }}>WhatsApp live</span>}
          {perspective === 'buyer' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Nərgiz Kitchen Group</span>
              <span style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--indigo)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>NK</span>
            </span>
          ) : (
            <span className="num" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: connected ? 'var(--olive)' : 'var(--madder)' }} />
              {nowIso ? `${bakuDay(nowIso)}, ${bakuTime(nowIso)}` : ''}
            </span>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {dock && (
          <aside aria-label="Farmer phone" className="phone-dock" style={{ flex: 'none', overflow: 'hidden', borderRight: '1px solid var(--hair)', background: '#EAE2D3', display: 'flex' }}>
            <Phone />
          </aside>
        )}
        <main className="scroll" style={{ flex: 1, minWidth: 0 }}>
          {s ? children : <div className="muted" style={{ padding: 40 }}>Loading…</div>}
        </main>
      </div>

      {help && (
        <div role="dialog" aria-label="Presenter controls" onClick={() => setHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(31,27,22,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="card scroll" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: '94vw', maxHeight: '92vh', padding: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px 36px', alignContent: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="serif" style={{ fontSize: 24 }}>Presenter controls</h2>
            <div className="muted" style={{ fontSize: 13 }}>Keys work anywhere outside a text field.</div>
            {KEYS.map(([k, d]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span><span className="kbd">{k}</span></span>
                <span>{d}</span>
              </div>
            ))}
            </div>
            {s?.presenter && <Readiness r={s.presenter} />}
          </div>
        </div>
      )}
    </div>
  );
}

const MODE_STYLE: Record<string, { label: string; color: string; title: string }> = {
  live: { label: 'AI · LIVE', color: 'var(--olive-ink)', title: 'Real provider inference' },
  cached: { label: 'AI · CACHED', color: 'var(--indigo)', title: 'Previously verified provider results, no network' },
  simulated: { label: 'AI · SIMULATED', color: 'var(--saffron)', title: 'Scripted fallback, no AI calls' },
};

function AiModeChip({ mode }: { mode: string }) {
  const m = MODE_STYLE[mode] ?? MODE_STYLE.simulated;
  return <span className="chip" data-ai-mode={mode} title={m.title} style={{ color: m.color, boxShadow: `inset 0 0 0 1px ${m.color}` }}>{m.label}</span>;
}

function Readiness({ r }: { r: LiveState['presenter'] }) {
  const row = (k: string, v: React.ReactNode, ok?: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--hair2)' }}>
      <span className="muted">{k}</span>
      <span style={{ color: ok === false ? 'var(--madder)' : undefined, fontWeight: ok === false ? 600 : undefined }}>{v}</span>
    </div>
  );
  const fails = Object.entries(r.health).filter(([, h]) => !h.ok);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Readiness">
      <h2 className="serif" style={{ fontSize: 24 }}>Readiness</h2>
      <div className="card" style={{ padding: '12px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }} data-act={r.act.n}>
        <span className="eyebrow" style={{ color: 'var(--indigo)', fontSize: 11 }}>{r.act.n <= 4 ? `Act ${r.act.n} · ${r.act.title}` : r.act.title}</span>
        <span style={{ fontWeight: 600 }}>Next: {r.act.next}</span>
      </div>
      {row('AI mode', <AiModeChip mode={r.aiMode} />)}
      {row('Text + photo AI', r.text ? `${r.text.provider} · ${r.text.model}${r.text.vision ? '' : ' (no vision)'}` : 'none: simulated only', !!r.text)}
      {row('Speech-to-text', r.stt ? 'ElevenLabs · scribe_v2 (aze)' : 'none: scripted transcripts only', !!r.stt)}
      {row('Voice replies', !r.tts.available ? 'unavailable (no ElevenLabs key)' : r.tts.on ? `on · ${r.tts.model}, native Azerbaijani voice${r.tts.last && !r.tts.last.ok ? ` · last error: ${r.tts.last.detail}` : ''}` : 'off (press V)', r.tts.last ? r.tts.last.ok : undefined)}
      {row('WhatsApp', r.channel === 'twilio' ? 'Twilio sandbox (real phones)' : 'Simulator (docked phone)')}
      {row('Twilio', r.twilio.configured ? `keys set · ${r.twilio.farmersMapped} farmer phone${r.twilio.farmersMapped === 1 ? '' : 's'} · webhook URL ${r.twilio.webhookUrlKnown ? 'known' : 'not set'}` : 'not configured', r.channel === 'twilio' ? r.twilio.configured && r.twilio.farmersMapped > 0 : undefined)}
      {r.twilio.failedDeliveries > 0 && row('Deliveries', `${r.twilio.failedDeliveries} WhatsApp message(s) failed: see the Live ledger`, false)}
      {fails.map(([k, h]) => row(`Last ${k} error`, h.detail, false))}
      {r.restored && <div className="muted" style={{ fontSize: 12 }}>State restored after a server restart.</div>}
    </div>
  );
}

/** Play the assistant's new voice notes on the laptop speakers (for the audience), once each, in order. */
function useVoiceAutoplay(on: boolean, messages?: LiveState['messages']) {
  const played = useRef<Set<string> | null>(null);
  const queue = useRef<string[]>([]);
  const playing = useRef(false);
  const voiced = (messages ?? []).filter((m) => m.dir === 'out' && m.voiceUrl);
  const key = voiced.map((m) => m.id).join(',');
  useEffect(() => {
    if (!messages) return;
    if (!played.current) { played.current = new Set(voiced.map((m) => m.id)); return; } // never replay old ones
    const fresh = voiced.filter((m) => !played.current!.has(m.id));
    for (const m of fresh) played.current.add(m.id);
    if (!on) return;
    queue.current.push(...fresh.map((m) => m.voiceUrl!));
    const next = () => {
      const url = queue.current.shift();
      if (!url) { playing.current = false; return; }
      playing.current = true;
      const a = new Audio(url);
      a.onended = next;
      a.onerror = next;
      a.play().catch(next);
    };
    if (!playing.current) next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on]);
}
