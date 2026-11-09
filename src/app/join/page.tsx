'use client';
// Sign-up from the join QR: name, district, language. The account opens straight into a WhatsApp-style chat
// with the BƏRƏKƏT assistant. Styled like the phone screens (light and dark follow the phone).
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogoMark, Wordmark } from '@/components/ui';
import { sys, WaTheme } from '../wa/theme';

type L = 'az' | 'en';
const T = {
  az: {
    title: 'Fermer kimi qoşulun', lead: 'BƏRƏKƏT fermerlərin məhsulunu WhatsApp-dan restoran və mağazalara satır. Hesab yaradın və köməkçi ilə danışın: səsli mesajla nə satdığınızı deyin, şəkil göndərin.',
    name: 'Adınız', namePh: 'məsələn, Elşən Məmmədov', place: 'Rayonunuz', choose: 'Seçin…', lang: 'Söhbət dili', go: 'Hesab yarat və başla', busy: 'Yaradılır…',
    note: 'Demo: real pul və ya real sifariş yoxdur. Mikrofon icazəsi səsli mesaj üçün lazımdır.',
  },
  en: {
    title: 'Join as a farmer', lead: 'BƏRƏKƏT sells farmers’ produce to restaurants and shops over WhatsApp. Create an account and talk to the assistant: say in a voice note what you are selling, then send a photo.',
    name: 'Your name', namePh: 'e.g. Elshan Mammadov', place: 'Your district', choose: 'Choose…', lang: 'Chat language', go: 'Create account and start', busy: 'Creating…',
    note: 'Demo: no real money or real orders. Allow the microphone to send voice notes.',
  },
};

export default function Join() {
  const router = useRouter();
  const [lang, setLang] = useState<L>('az');
  const [places, setPlaces] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = T[lang];

  useEffect(() => {
    if (typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('az')) setLang('en');
    fetch('/api/join', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j.farmerId) router.replace(`/wa/${j.farmerId}`);
      setPlaces(j.places ?? []);
    }).catch(() => setError('Network error / Şəbəkə xətası'));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await fetch('/api/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, place, lang }) }).then((x) => x.json()).catch(() => ({ error: 'Network error / Şəbəkə xətası' }));
    if (r.farmerId) {
      try { localStorage.setItem('berekat.waFarmer', r.farmerId); } catch { /* */ }
      router.replace(`/wa/${r.farmerId}`);
    } else { setBusy(false); setError(r.error ?? 'Error'); }
  };

  const field: React.CSSProperties = { height: 48, borderRadius: 12, border: 0, padding: '0 14px', fontSize: 17, background: 'var(--wa-input)', color: 'var(--wa-text)', boxShadow: 'inset 0 0 0 1px var(--wa-input-line)', width: '100%', boxSizing: 'border-box', fontFamily: sys };
  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: 'var(--wa-head)', fontFamily: sys, color: 'var(--wa-text)' }}>
      <WaTheme />
      <form onSubmit={submit} style={{ maxWidth: 460, margin: '0 auto', padding: '28px 22px 40px', paddingTop: 'max(28px, env(safe-area-inset-top))', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><LogoMark size={26} /><Wordmark size={20} /></span>
          <span role="group" aria-label="Language / Dil" style={{ display: 'flex', background: 'var(--wa-pill)', borderRadius: 9, padding: 2 }}>
            {(['az', 'en'] as L[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                style={{ border: 0, borderRadius: 7, padding: '5px 12px', fontSize: 14, fontWeight: 600, cursor: 'pointer', background: lang === l ? 'var(--wa-in)' : 'transparent', color: 'var(--wa-text)' }}>{l === 'az' ? 'AZ' : 'EN'}</button>
            ))}
          </span>
        </div>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.4, margin: '6px 0 8px' }}>{t.title}</h1>
          <p style={{ fontSize: 16, lineHeight: 1.45, color: 'var(--wa-sub)', margin: 0 }}>{t.lead}</p>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }}>{t.name}
          <input required minLength={2} maxLength={40} autoComplete="name" value={name} placeholder={t.namePh} onChange={(e) => setName(e.target.value)} style={field} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }}>{t.place}
          <select required value={place} onChange={(e) => setPlace(e.target.value)} style={{ ...field, appearance: 'none' }}>
            <option value="" disabled>{t.choose}</option>
            {places.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 600 }}>{t.lang}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(['az', 'en'] as L[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l}
                style={{ height: 48, borderRadius: 12, border: 0, fontSize: 16, fontWeight: 600, cursor: 'pointer', background: lang === l ? 'var(--wa-green)' : 'var(--wa-input)', color: lang === l ? '#fff' : 'var(--wa-text)', boxShadow: lang === l ? undefined : 'inset 0 0 0 1px var(--wa-input-line)' }}>
                {l === 'az' ? 'Azərbaycanca' : 'English'}
              </button>
            ))}
          </div>
        </div>
        {error && <div style={{ color: 'var(--wa-red)', fontSize: 15 }}>{error}</div>}
        <button disabled={busy} style={{ height: 52, borderRadius: 26, border: 0, background: 'var(--wa-green)', color: '#fff', fontSize: 17, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? t.busy : t.go}</button>
        <p style={{ fontSize: 13, color: 'var(--wa-sub)', margin: 0, lineHeight: 1.4 }}>{t.note}</p>
      </form>
    </div>
  );
}
