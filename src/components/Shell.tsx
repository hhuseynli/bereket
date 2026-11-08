'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLive } from './live';
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
  ],
};

const KEYS: [string, string][] = [
  ['P', 'Show or hide the phone'],
  ['B / O', 'Buyer / Operator view'],
  ['A', 'Other farmers accept their offers'],
  ['S', 'Səbinə says hello (opens her 24 h WhatsApp window)'],
  ['C', 'Rauf cancels by voice note'],
  ['T', 'Skip to Thursday 09:00 (pickup and arrival)'],
  ['L', "Fallback: put Elşən's listing live without Act 1"],
  ['F', 'Offline AI: use cached or scripted results'],
  ['W', 'Switch WhatsApp channel: simulator or Twilio'],
  ['R', 'Reset all demo data'],
  ['?', 'This panel'],
];

export function Shell({ perspective, active, children }: { perspective: Persp; active: string; children: React.ReactNode }) {
  const { s, act, connected } = useLive();
  const router = useRouter();
  const path = usePathname();
  const [dock, setDock] = useState(true);
  const [help, setHelp] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    try { const v = localStorage.getItem('berekat.dock'); if (v) setDock(v === '1'); } catch { /* storage blocked */ }
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
      else if (k === 'f') d('offline');
      else if (k === 'w') d('channel');
      else if (k === 'r') { d('reset'); router.push('/buyer'); }
      else if (e.key === '?') setHelp((v) => !v);
      else if (k === 'escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, router, path]);

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
          {s?.settings.offline && <span className="chip" title="AI uses cached or scripted results">Offline AI</span>}
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
          <aside aria-label="Farmer phone" style={{ width: 400, flex: 'none', overflow: 'hidden', borderRight: '1px solid var(--hair)', background: '#EAE2D3', display: 'flex' }}>
            <Phone />
          </aside>
        )}
        <main className="scroll" style={{ flex: 1, minWidth: 0 }}>
          {s ? children : <div className="muted" style={{ padding: 40 }}>Loading…</div>}
        </main>
      </div>

      {help && (
        <div role="dialog" aria-label="Presenter controls" onClick={() => setHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(31,27,22,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '92vw', padding: 28, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="serif" style={{ fontSize: 24 }}>Presenter controls</h2>
            <div className="muted" style={{ fontSize: 13 }}>Keys work anywhere outside a text field.</div>
            {KEYS.map(([k, d]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span><span className="kbd">{k}</span></span>
                <span>{d}</span>
              </div>
            ))}
            <div className="muted" style={{ fontSize: 13, paddingTop: 8 }}>
              AI keys: Claude {s?.keys.claude ? 'set' : 'missing'} · ElevenLabs {s?.keys.elevenlabs ? 'set' : 'missing'} · Twilio {s?.keys.twilio ? 'set' : 'missing'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
