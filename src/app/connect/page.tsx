'use client';
// Laptop page: QR codes that open each farmer's WhatsApp-style screen on a real phone (same Wi-Fi).
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';

interface Pair { running: boolean; base?: string; ip?: string; links?: { farmerId: string; name: string; url: string; svg: string }[] }
const ROLE: Record<string, string> = { 'f-elsen': 'Acts 1, 2, 4: sells tomatoes', 'f-rauf': 'Act 3: cancels', 'f-sebine': 'Act 3: backup farmer', 'f-gulnare': 'Act 2: optional' };

export default function Connect() {
  const [p, setP] = useState<Pair>();
  useEffect(() => {
    const load = () => fetch('/api/pair', { cache: 'no-store' }).then((r) => r.json()).then(setP).catch(() => setP({ running: false }));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <Shell perspective="operator" active="connect">
      <div style={{ padding: '32px 40px', display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 1200 }}>
        <div>
          <div className="eyebrow" style={{ color: 'var(--indigo)' }}>Farmer phones</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600 }}>Open WhatsApp on a real phone</h1>
          <div className="muted" style={{ marginTop: 6, maxWidth: 760 }}>
            Phones on the same Wi-Fi scan a code and become that farmer&apos;s WhatsApp. The first time, the phone warns the
            connection is not private (a self-signed certificate, needed for the microphone): Android <b>Advanced → Proceed</b>,
            iPhone <b>Show Details → visit this website</b>.
          </div>
        </div>
        {!p && <div className="muted">Loading…</div>}
        {p && !p.running && (
          <div className="card" style={{ padding: '18px 22px', boxShadow: 'inset 0 0 0 1px var(--saffron)' }}>
            Phone access is not running. In the terminal: <code>npm run demo:phone</code>
          </div>
        )}
        {p?.running && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20 }}>
            {p.links!.map((l) => (
              <div key={l.farmerId} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center', textAlign: 'center' }}>
                <div style={{ width: 210, height: 210, background: '#fff', padding: 6 }} dangerouslySetInnerHTML={{ __html: l.svg }} />
                <b style={{ fontSize: 18 }}>{l.name}</b>
                <span className="muted" style={{ fontSize: 13 }}>{ROLE[l.farmerId]}</span>
                <span className="num muted" style={{ fontSize: 12 }}>{l.url}</span>
              </div>
            ))}
          </div>
        )}
        {p?.running && <div className="muted" style={{ fontSize: 13 }}>Venue Wi-Fi that blocks devices from seeing each other: connect the laptop to a phone hotspot and run <code>npm run demo:phone</code> again.</div>}
      </div>
    </Shell>
  );
}
