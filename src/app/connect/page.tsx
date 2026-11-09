'use client';
// Laptop page: ONE QR code. Anyone who scans it creates their own farmer account and chats with the assistant
// (through the public tunnel when it runs, so any phone on any network works). Sign-ups appear live on the right.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLang } from '@/components/lang';
import { Shell } from '@/components/Shell';

interface Pair {
  join: { kind: 'internet' | 'wifi' | 'wifi-ip'; url: string; svg: string }[];
  demo: { farmerId: string; name: string; svg: string }[];
  signups: { id: string; name: string; village: string; lang: 'az' | 'en'; at: string; messages: number; listings: number; last: string }[];
  tunnel: boolean;
  wifi: boolean;
}

export default function Connect() {
  const { t } = useLang();
  const [p, setP] = useState<Pair>();
  const [pick, setPick] = useState(0);
  useEffect(() => {
    const load = () => fetch('/api/pair', { cache: 'no-store' }).then((r) => r.json()).then(setP).catch(() => undefined);
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, []);
  const code = p?.join[Math.min(pick, (p?.join.length ?? 1) - 1)];
  const label = (k: string) => (k === 'internet' ? t('Any phone, any network', 'İstənilən telefon, istənilən şəbəkə') : k === 'wifi' ? t('Same Wi-Fi as this laptop', 'Bu noutbukla eyni Wi-Fi') : t('Same Wi-Fi, by IP address', 'Eyni Wi-Fi, IP ünvanı ilə'));

  return (
    <Shell perspective="operator" active="connect">
      <div className="page">
        <div className="page-cols" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 1fr)' }}>
          <section className="card" style={{ padding: '26px 30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, minHeight: 0, textAlign: 'center' }}>
            <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{t('Try it on your phone', 'Telefonunuzda sınayın')}</div>
            <h1 className="serif" style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.1 }}>{t('Scan to join as a farmer', 'Fermer kimi qoşulmaq üçün skan edin')}</h1>
            <div className="muted" style={{ fontSize: 15, maxWidth: 560 }}>
              {t('Create your own account in 10 seconds, then talk to the assistant in Azerbaijani or English: say what you sell in a voice note, send a photo, fix anything by just saying it.',
                'Hesabınızı 10 saniyəyə yaradın, sonra köməkçi ilə azərbaycanca və ya ingiliscə danışın: satdığınızı səsli mesajla deyin, şəkil göndərin, səhvi sadəcə deyərək düzəldin.')}
            </div>
            {!p && <div className="muted">{t('Loading…', 'Yüklənir…')}</div>}
            {p && !code && (
              <div className="card" style={{ padding: '18px 22px', boxShadow: 'inset 0 0 0 1px var(--saffron)', textAlign: 'left' }}>
                {t('No link for phones yet. In the terminal:', 'Telefonlar üçün link hələ yoxdur. Terminalda:')} <code>npm run demo:phone -- --tunnel</code> {t('(internet) or', '(internet) və ya')} <code>npm run demo:phone</code> {t('(Wi-Fi)', '(Wi-Fi)')}
              </div>
            )}
            {code && (
              <>
                <div className="fill" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, width: '100%' }}>
                  <div style={{ height: '100%', maxHeight: 420, aspectRatio: '1', background: '#fff', padding: 12, boxShadow: '0 0 0 1px var(--hair)' }} dangerouslySetInnerHTML={{ __html: code.svg.replace('<svg', '<svg width="100%" height="100%"') }} />
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  {p!.join.map((j, i) => (
                    <button key={j.kind} className="chip" onClick={() => setPick(i)} aria-pressed={i === pick}
                      style={{ border: 0, cursor: 'pointer', background: i === pick ? 'var(--soot)' : 'transparent', color: i === pick ? 'var(--paper)' : undefined }}>{label(j.kind)}</button>
                  ))}
                </div>
                <div className="num muted" style={{ fontSize: 12, wordBreak: 'break-all', maxWidth: 560 }}>{code.url.replace(/\?c=.*/, '')}</div>
                {code.kind !== 'internet' && <div className="muted" style={{ fontSize: 12.5, maxWidth: 560 }}>{t('Wi-Fi link: phones show a one-time "not private" warning (self-signed certificate): Advanced → Proceed (Android) or Show Details → visit this website (iPhone).', 'Wi-Fi linki: telefon bir dəfə "təhlükəsiz deyil" xəbərdarlığı göstərir: Advanced → Proceed (Android) və ya Show Details → visit this website (iPhone).')}</div>}
              </>
            )}
          </section>

          <aside className="card" aria-label={t('Signed up', 'Qoşulanlar')} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '20px 22px 8px', flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{t('Signed up', 'Qoşulanlar')}</h2>
              <span className="muted num" style={{ fontSize: 13 }}>{p?.signups.length ?? 0}</span>
            </div>
            <div className="scroll fill" style={{ padding: '0 22px 12px' }}>
              {p && p.signups.length === 0 && <div className="muted" style={{ fontSize: 14 }}>{t('Nobody yet. New farmers appear here the moment they sign up.', 'Hələ heç kim. Yeni fermerlər qoşulan kimi burada görünəcək.')}</div>}
              {p?.signups.map((f) => (
                <Link key={f.id} href={`/wa/${f.id}`} target="_blank" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', padding: '10px 0', borderBottom: '1px solid var(--hair2)' }}>
                  <b>{f.name} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>· {f.village} · {f.lang === 'en' ? 'EN' : 'AZ'}</span></b>
                  <span className="num muted" style={{ fontSize: 12.5 }}>{new Date(f.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' })}</span>
                  <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.last || t('no messages yet', 'hələ mesaj yoxdur')}</span>
                  <span className="num muted" style={{ fontSize: 12.5 }}>{f.messages} {t('msg', 'mesaj')} · {f.listings} {t('listings', 'elan')}</span>
                </Link>
              ))}
            </div>
            {p && p.demo.length > 0 && (
              <details style={{ borderTop: '1px solid var(--hair)', padding: '12px 22px', flex: 'none' }}>
                <summary className="muted" style={{ cursor: 'pointer', fontSize: 13.5 }}>{t('Presenter: the scripted demo farmers', 'Aparıcı: ssenari fermerləri')}</summary>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, paddingTop: 10 }}>
                  {p.demo.map((d) => (
                    <div key={d.farmerId} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 12 }}>
                      <div style={{ width: '100%', aspectRatio: '1', background: '#fff', padding: 3 }} dangerouslySetInnerHTML={{ __html: d.svg.replace('<svg', '<svg width="100%" height="100%"') }} />
                      {d.name.split(' ')[0]}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </aside>
        </div>
      </div>
    </Shell>
  );
}
