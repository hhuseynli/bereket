'use client';
// Public front page: what BƏRƏKƏT is in ten seconds, a way in for every visitor (farmer, buyer, operations) and live
// numbers from the platform. Bilingual; one column on a phone.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Band, LogoMark, Medallion, Wordmark } from '@/components/ui';
import { computeImpact } from '@/lib/impact';

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

export default function Landing() {
  const { lang, setLang, t } = useLang();
  const { s } = useLive();
  const [qr, setQr] = useState<string>();
  useEffect(() => {
    fetch('/api/pair', { cache: 'no-store' }).then((r) => r.json()).then((j) => setQr(j.join?.[0]?.svg)).catch(() => undefined);
  }, []);
  const m = s ? computeImpact(s) : undefined;

  const steps = [
    { n: '1', color: 'var(--indigo)', title: t('Farmers just talk', 'Fermer sadəcə danışır'), body: t('A voice note in Azerbaijani and a photo on WhatsApp. AI writes the listing, checks the photo (ripeness, freshness, defects) and the farmer fixes anything by saying it.', 'WhatsApp-da azərbaycanca səsli mesaj və şəkil. Sİ elanı yazır, şəkli yoxlayır (yetişmə, təzəlik, qüsurlar), fermer səhvi sadəcə deyərək düzəldir.') },
    { n: '2', color: 'var(--madder)', title: t('Many farms, one order', 'Çox təsərrüfat, bir sifariş'), body: t('A restaurant asks for 400 kg. BƏRƏKƏT combines small farms, picks the lots that arrive at the right ripeness, and plans one van.', 'Restoran 400 kq istəyir. BƏRƏKƏT kiçik təsərrüfatları birləşdirir, vaxtında yetişən partiyaları seçir, bir furqon planlaşdırır.') },
    { n: '3', color: 'var(--olive-ink)', title: t('Nothing falls apart', 'Heç nə dağılmır'), body: t('If hail hits a farm, a backup farm fills the gap within the buyer’s price tolerance. Payment is held until delivery; both sides rate each other.', 'Dolu bir təsərrüfatı vursa, əvəzedici təsərrüfat alıcının qiymət dözümlülüyü daxilində boşluğu doldurur. Ödəniş çatdırılanadək saxlanılır.') },
  ];
  const stats = m ? [
    { big: n0(m.farmers), label: t('farmers selling by phone', 'telefonla satan fermer') },
    { big: `${n0(m.liveKg)} ${t('kg', 'kq')}`, label: t('on sale right now', 'hazırda satışda') },
    { big: n0(m.orders), label: t('orders woven', 'toxunmuş sifariş') },
    { big: `${n0(m.co2SavedKg)} kg`, label: t('CO₂e avoided by shared vans', 'ortaq furqonla qənaət CO₂e') },
  ] : [];

  return (
    <div className="landing">
      <Band />
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 24px', flexWrap: 'wrap', borderBottom: '1px solid var(--hair)', background: 'var(--paper)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}><LogoMark /><Wordmark /></span>
        <nav style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 18, fontSize: 14.5 }}>
          <Link href="/buyer" className="muted">{t('Buyers', 'Alıcılar')}</Link>
          <Link href="/operator" className="muted">{t('Operations', 'Əməliyyatlar')}</Link>
          <Link href="/impact" className="muted">{t('Impact', 'Təsir')}</Link>
          <span role="group" aria-label="Language / Dil" style={{ display: 'flex', boxShadow: 'inset 0 0 0 1px var(--hair)', borderRadius: 3, padding: 2 }}>
            {(['en', 'az'] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
                style={{ border: 0, borderRadius: 2, padding: '3px 9px', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: lang === l ? 'var(--soot)' : 'transparent', color: lang === l ? 'var(--paper)' : 'var(--ink2)' }}>{l.toUpperCase()}</button>
            ))}
          </span>
        </nav>
      </header>

      <main className="landing-main">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22, minWidth: 0 }}>
          <div className="eyebrow" style={{ color: 'var(--madder)' }}>{t('Farm-to-kitchen supply for Azerbaijan', 'Azərbaycan üçün tarladan mətbəxə təchizat')}</div>
          <h1 className="serif" style={{ fontSize: 'clamp(34px, 5.2vw, 58px)', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.03 }}>
            {t('Many small farms, woven into one reliable supply.', 'Çoxlu kiçik təsərrüfat, bir etibarlı təchizata toxunur.')}
          </h1>
          <p style={{ fontSize: 'clamp(16px, 1.6vw, 19px)', lineHeight: 1.5, color: 'var(--ink2)', maxWidth: 640 }}>
            {t('Smallholders sell by talking to WhatsApp, in Azerbaijani or English. Restaurants and shops get one dependable order from many farms, at the right ripeness, with no middleman taking the margin.',
              'Kiçik fermerlər WhatsApp-a azərbaycanca və ya ingiliscə danışaraq satır. Restoran və mağazalar çox təsərrüfatdan bir etibarlı sifariş alır: vaxtında yetişmiş, vasitəçisiz.')}
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link href="/join" className="btn btn-primary" style={{ height: 52, padding: '0 26px', fontSize: 16 }}>{t('Join as a farmer', 'Fermer kimi qoşul')}</Link>
            <Link href="/buyer" className="btn btn-ghost" style={{ height: 52, padding: '0 22px', fontSize: 16 }}>{t('Order as a buyer', 'Alıcı kimi sifariş et')}</Link>
            <Link href="/operator" className="btn btn-ghost" style={{ height: 52, padding: '0 22px', fontSize: 16 }}>{t('See operations', 'Əməliyyatlara bax')}</Link>
          </div>
          <div className="landing-steps">
            {steps.map((x) => (
              <div key={x.n} className="card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Medallion size={18} fill={x.color} inner="var(--paper)" />
                  <b style={{ fontSize: 15.5 }}>{x.title}</b>
                </span>
                <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.45 }}>{x.body}</span>
              </div>
            ))}
          </div>
          {m && (
            <Link href="/impact" className="landing-stats" aria-label={t('Live numbers', 'Canlı rəqəmlər')}>
              {stats.map((x) => (
                <div key={x.label} style={{ display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--hair)', paddingLeft: 12 }}>
                  <b className="serif num" style={{ fontSize: 26, lineHeight: 1.1 }}>{x.big}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>{x.label}</span>
                </div>
              ))}
            </Link>
          )}
        </div>

        <aside className="landing-qr card" style={{ flexDirection: 'column', alignItems: 'center', gap: 12, padding: '24px 26px', textAlign: 'center' }}>
          <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{t('Try it on your phone', 'Telefonunuzda sınayın')}</div>
          <div className="serif" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.15 }}>{t('Scan, pick a name, and talk to the assistant', 'Skan edin, ad seçin və köməkçi ilə danışın')}</div>
          {qr
            ? <div style={{ width: '100%', maxWidth: 300, aspectRatio: '1', background: '#fff', padding: 10, boxShadow: '0 0 0 1px var(--hair)' }} dangerouslySetInnerHTML={{ __html: qr.replace('<svg', '<svg width="100%" height="100%"') }} />
            : <Link href="/join" className="btn btn-primary">{t('Join as a farmer', 'Fermer kimi qoşul')}</Link>}
          <div className="muted" style={{ fontSize: 12.5 }}>{t('Demo: no real money moves. Voice notes need the microphone.', 'Demo: real pul köçürülmür. Səsli mesaj üçün mikrofon lazımdır.')}</div>
        </aside>
      </main>
    </div>
  );
}
