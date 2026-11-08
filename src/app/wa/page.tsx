'use client';
// "Whose phone is this?": pick the demo farmer this phone plays. Looks like a WhatsApp chat list.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLive } from '@/components/live';
import { LogoMark } from '@/components/ui';

const PHONES = ['f-elsen', 'f-rauf', 'f-sebine', 'f-gulnare'];
const sys = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export default function WaHome() {
  const { s } = useLive();
  const [mine, setMine] = useState<string>();
  useEffect(() => { try { setMine(localStorage.getItem('berekat.waFarmer') ?? undefined); } catch { /* storage blocked */ } }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', background: '#fff', fontFamily: sys, color: '#111b21', maxWidth: 560, margin: '0 auto' }}>
      <header style={{ background: '#008069', color: '#fff', padding: '16px 18px', paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <div style={{ fontSize: 21, fontWeight: 600 }}>WhatsApp</div>
        <div style={{ fontSize: 13.5, opacity: 0.9, marginTop: 4 }}>Demo telefonu: bu telefon hansı fermerindir?</div>
      </header>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!s && <div style={{ padding: 24, color: '#667781' }}>Yüklənir…</div>}
        {s && PHONES.map((id) => {
          const f = s.farmers.find((x) => x.id === id);
          if (!f) return null;
          const last = [...s.messages].reverse().find((m) => m.farmerId === id);
          const preview = last ? (last.kind === 'voice' ? '🎤 Səsli mesaj' : last.kind === 'photo' ? '📷 Şəkil' : last.card?.title ?? last.text ?? '') : 'BƏRƏKƏT köməkçisi';
          return (
            <Link key={id} href={`/wa/${id}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: '1px solid #f0f2f5', background: mine === id ? '#f0f2f5' : undefined }}>
              <span style={{ width: 50, height: 50, borderRadius: 25, background: f.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 600, flex: 'none' }}>{f.name[0]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <b style={{ fontWeight: 600, fontSize: 16.5 }}>{f.name}</b>
                  {mine === id && <span style={{ fontSize: 12, color: '#008069' }}>bu telefon</span>}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#667781', fontSize: 14, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <LogoMark size={14} /> {preview}
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
