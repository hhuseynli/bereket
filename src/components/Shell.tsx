'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useLive, type LiveState } from './live';
import { Phone } from './Phone';
import { Band, bakuDayL, bakuTime, LogoMark, Wordmark } from './ui';
import { useLang } from './lang';

type Persp = 'buyer' | 'operator';

const NAV: Record<Persp, { href: string; label: [string, string]; key: string }[]> = {
  buyer: [
    { href: '/buyer', label: ['Tenders', 'Tenderlər'], key: 'tenders' },
    { href: '/buyer/orders', label: ['Orders', 'Sifarişlər'], key: 'orders' },
    { href: '/impact?p=buyer', label: ['Impact', 'Təsir'], key: 'impact' },
  ],
  operator: [
    { href: '/operator', label: ['Logistics', 'Logistika'], key: 'logistics' },
    { href: '/operator/intake', label: ['Intake', 'Elan qəbulu'], key: 'intake' },
    { href: '/connect', label: ['Phones', 'Telefonlar'], key: 'connect' },
    { href: '/impact', label: ['Impact', 'Təsir'], key: 'impact' },
  ],
};

const KEYS: [string, string, string][] = [
  ['P', 'Backup: show the farmer phone on the laptop (real phones: /connect)', 'Ehtiyat: fermerin telefonunu noutbukda göstər (real telefonlar: /connect)'],
  ['B / O', 'Buyer / Operator view', 'Alıcı / Operator görünüşü'],
  ['A', 'Other farmers accept their offers', 'Digər fermerlər təkliflərini qəbul edir'],
  ['S', 'Səbinə says hello (opens her 24 h WhatsApp window)', 'Səbinə salam yazır (24 saatlıq WhatsApp pəncərəsini açır)'],
  ['C', 'Rauf cancels by voice note', 'Rauf səsli mesajla ləğv edir'],
  ['T', 'Skip to delivery morning, 09:00 (pickup and arrival)', 'Çatdırılma səhərinə keç, 09:00 (götürmə və çatma)'],
  ['L', "Fallback: put Elşən's listing live without Act 1", 'Ehtiyat: Elşənin elanını 1-ci pərdə olmadan aktiv et'],
  ['F', 'AI mode: LIVE → CACHED → SIMULATED', 'Sİ rejimi: CANLI → KEŞ → SİMULYASİYA'],
  ['W', 'Switch WhatsApp channel: simulator or Twilio', 'WhatsApp kanalını dəyiş: simulyator və ya Twilio'],
  ['V', 'Voice replies on/off (Azerbaijani voice notes from the assistant)', 'Səsli cavablar açıq/bağlı (köməkçidən azərbaycanca səsli mesajlar)'],
  ['D', "Demo data on/off (off: only listings sent from the farmers' phones)", 'Demo məlumat açıq/bağlı (bağlı: yalnız fermerlərin telefonlarından göndərilən elanlar)'],
  ['R', 'Reset all demo data', 'Bütün demo məlumatı sıfırla'],
  ['?', 'This panel', 'Bu panel'],
];

export function Shell({ perspective, active, children }: { perspective: Persp; active: string; children: React.ReactNode }) {
  const { s, act, connected } = useLive();
  const presenter = !!s && (s.viewer === undefined || s.viewer === "admin"); // visitors see no presenter controls
  const { lang, setLang, t } = useLang();
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
      // Visitors navigate; the presenter keys (reset, modes, scripted farmers, time skip) are the presenter's only.
      if (!presenter && !['b', 'o', 'escape'].includes(k)) return;
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
      else if (k === 'd') d('demoData');
      else if (k === 'r') { d('reset'); router.push('/buyer'); }
      else if (e.key === '?') setHelp((v) => !v);
      else if (k === 'escape') setHelp(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, router, path, presenter]);

  useVoiceAutoplay(speak, s?.messages);

  const nowIso = s ? new Date(new Date(s.clock.base).getTime() + (Date.now() - s.clock.startedAtMs)).toISOString() : undefined;
  const openRecovery = s?.orders.some((o) => o.recovery && ['searching', 'proposed', 'offered'].includes(o.recovery.status));
  const review = s?.aiRuns.filter((r) => r.status === 'needs_review').length ?? 0;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Band />
      <header style={{ minHeight: 64, flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 32px', padding: '8px 40px', borderBottom: '1px solid var(--hair)', background: 'var(--paper)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-label={t('BƏRƏKƏT home', 'BƏRƏKƏT ana səhifə')}>
          <LogoMark />
          <Wordmark />
        </Link>
        <div role="group" aria-label={t('Perspective', 'Baxış')} style={{ display: 'flex', padding: 3, borderRadius: 3, background: '#EDE4D3' }}>
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
              {p === 'buyer' ? t('Buyer', 'Alıcı') : 'Operator'}
            </Link>
          ))}
        </div>
        <nav aria-label={t(`${perspective} navigation`, perspective === 'buyer' ? 'Alıcı naviqasiyası' : 'Operator naviqasiyası')} style={{ display: 'flex', gap: 28, fontSize: 15, alignSelf: 'stretch' }}>
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
              {t(n.label[0], n.label[1])}
              {n.key === 'logistics' && openRecovery && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--madder)', borderRadius: 2, padding: '1px 6px' }}>1</span>}
              {n.key === 'intake' && review > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--saffron)', borderRadius: 2, padding: '1px 6px' }}>{review}</span>}
            </Link>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, fontSize: 13, color: 'var(--ink2)' }}>
          <div role="group" aria-label="Language / Dil" style={{ display: 'flex', padding: 2, borderRadius: 3, boxShadow: 'inset 0 0 0 1px var(--hair)' }}>
            {(['en', 'az'] as const).map((l) => (
              <button key={l} className="chip" aria-pressed={lang === l} onClick={() => setLang(l)}
                title={l === 'en' ? 'English' : 'Azərbaycanca'}
                style={{ border: 0, cursor: 'pointer', background: lang === l ? 'var(--soot)' : 'transparent', color: lang === l ? 'var(--paper)' : 'var(--muted)', fontWeight: lang === l ? 600 : 400 }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {s && presenter && <AiModeChip mode={s.settings.aiMode} />}
          {s && presenter && (
            <button className="chip" aria-pressed={s.settings.demoData !== false} onClick={() => void act('director', { op: 'demoData' })}
              title={s.settings.demoData !== false
                ? t("Seeded farms are listed. Click (or D) to match only listings from the farmers' phones", 'Nümunə təsərrüfatlar siyahıdadır. Yalnız fermerlərin telefonlarından gələn elanlara uyğunlaşdırmaq üçün klikləyin (və ya D)')
                : t("Only listings from the farmers' phones. Click (or D) to add the seeded farms back", 'Yalnız fermerlərin telefonlarından gələn elanlar. Nümunə təsərrüfatları qaytarmaq üçün klikləyin (və ya D)')}
              style={{ border: 0, cursor: 'pointer', boxShadow: `inset 0 0 0 1px var(${s.settings.demoData !== false ? '--saffron' : '--olive'})`, color: s.settings.demoData !== false ? 'var(--ink2)' : 'var(--olive-ink)', background: 'transparent' }}>
              {s.settings.demoData !== false ? t('Demo data on', 'Demo məlumat açıq') : t('Real listings only', 'Yalnız real elanlar')}
            </button>
          )}
          {s?.settings.voiceReplies && (
            <button className="chip" aria-pressed={speak} onClick={() => setSpeak((v) => { const n = !v; try { localStorage.setItem('berekat.speak', n ? '1' : '0'); } catch { /* */ } return n; })}
              title={speak ? t('Voice replies play on this laptop (click to mute)', 'Səsli cavablar bu noutbukda səslənir (səssizləşdirmək üçün klikləyin)') : t('Voice replies are sent; click to also play them on this laptop', 'Səsli cavablar göndərilir; bu noutbukda da səsləndirmək üçün klikləyin')}
              style={{ border: 0, cursor: 'pointer', background: speak ? 'var(--olive)' : 'transparent', color: speak ? 'var(--paper)' : undefined }}>
              {speak ? '🔊 ' : '🔈 '}{t('Voice replies', 'Səsli cavablar')}
            </button>
          )}
          {s?.settings.channel === 'twilio' && <span className="chip" style={{ boxShadow: 'inset 0 0 0 1px var(--olive)', color: 'var(--olive-ink)' }}>{t('WhatsApp live', 'WhatsApp canlı')}</span>}
          {perspective === 'buyer' ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>Nərgiz Kitchen Group</span>
              <span style={{ width: 34, height: 34, borderRadius: 17, background: 'var(--indigo)', color: 'var(--paper)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600 }}>NK</span>
            </span>
          ) : (
            <span className="num" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: connected ? 'var(--olive)' : 'var(--madder)' }} />
              {nowIso ? `${bakuDayL(nowIso, lang)}, ${bakuTime(nowIso)}` : ''}
            </span>
          )}
        </div>
      </header>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {dock && (
          <aside aria-label={t('Farmer phone', 'Fermerin telefonu')} className="phone-dock" style={{ flex: 'none', overflow: 'hidden', borderRight: '1px solid var(--hair)', background: '#EAE2D3', display: 'flex' }}>
            <Phone />
          </aside>
        )}
        <main className="scroll" style={{ flex: 1, minWidth: 0 }}>
          {s ? children : <div className="muted" style={{ padding: 40 }}>{t('Loading…', 'Yüklənir…')}</div>}
        </main>
      </div>

      {help && (
        <div role="dialog" aria-label={t('Presenter controls', 'Aparıcı idarəetməsi')} onClick={() => setHelp(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(31,27,22,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div className="card scroll" onClick={(e) => e.stopPropagation()} style={{ width: 860, maxWidth: '94vw', maxHeight: '92vh', padding: 28, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '12px 36px', alignContent: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 className="serif" style={{ fontSize: 24 }}>{t('Presenter controls', 'Aparıcı idarəetməsi')}</h2>
            <div className="muted" style={{ fontSize: 13 }}>{t('Keys work anywhere outside a text field.', 'Düymələr mətn sahəsindən kənar hər yerdə işləyir.')}</div>
            {KEYS.map(([k, en, az]) => (
              <div key={k} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span><span className="kbd">{k}</span></span>
                <span>{t(en, az)}</span>
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

const MODE_STYLE: Record<string, { label: [string, string]; color: string; title: [string, string] }> = {
  live: { label: ['AI · LIVE', 'Sİ · CANLI'], color: 'var(--olive-ink)', title: ['Real provider inference', 'Provayderin real cavabları'] },
  cached: { label: ['AI · CACHED', 'Sİ · KEŞ'], color: 'var(--indigo)', title: ['Previously verified provider results, no network', 'Əvvəlcədən yoxlanmış provayder nəticələri, şəbəkəsiz'] },
  simulated: { label: ['AI · SIMULATED', 'Sİ · SİMULYASİYA'], color: 'var(--saffron)', title: ['Scripted fallback, no AI calls', 'Ssenarili ehtiyat rejim, Sİ çağırışı yoxdur'] },
};

function AiModeChip({ mode }: { mode: string }) {
  const { t } = useLang();
  const m = MODE_STYLE[mode] ?? MODE_STYLE.simulated;
  return <span className="chip" data-ai-mode={mode} title={t(...m.title)} style={{ color: m.color, boxShadow: `inset 0 0 0 1px ${m.color}` }}>{t(...m.label)}</span>;
}

function Readiness({ r }: { r: LiveState['presenter'] }) {
  const { t } = useLang();
  const row = (k: string, v: React.ReactNode, ok?: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, fontSize: 13.5, padding: '5px 0', borderBottom: '1px solid var(--hair2)' }}>
      <span className="muted">{k}</span>
      <span style={{ color: ok === false ? 'var(--madder)' : undefined, fontWeight: ok === false ? 600 : undefined }}>{v}</span>
    </div>
  );
  const fails = Object.entries(r.health).filter(([, h]) => !h.ok);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label={t('Readiness', 'Hazırlıq')}>
      <h2 className="serif" style={{ fontSize: 24 }}>{t('Readiness', 'Hazırlıq')}</h2>
      <div className="card" style={{ padding: '12px 14px', background: '#fff', display: 'flex', flexDirection: 'column', gap: 4 }} data-act={r.act.n}>
        <span className="eyebrow" style={{ color: 'var(--indigo)', fontSize: 11 }}>{r.act.n <= 4 ? `${t(`Act ${r.act.n}`, `${r.act.n}-${[3, 4].includes(r.act.n) ? 'cü' : 'ci'} pərdə`)} · ${r.act.title}` : r.act.title}</span>
        <span style={{ fontWeight: 600 }}>{t('Next', 'Növbəti')}: {r.act.next}</span>
      </div>
      {row(t('AI mode', 'Sİ rejimi'), <AiModeChip mode={r.aiMode} />)}
      {row(t('Text + photo AI', 'Mətn + foto Sİ'), r.text ? `${r.text.provider} · ${r.text.model}${r.text.vision ? '' : t(' (no vision)', ' (görmə yoxdur)')}` : t('none: simulated only', 'yoxdur: yalnız simulyasiya'), !!r.text)}
      {row(t('Speech-to-text', 'Nitqdən mətnə'), r.stt ? 'ElevenLabs · scribe_v2 (aze)' : t('none: scripted transcripts only', 'yoxdur: yalnız ssenarili transkriptlər'), !!r.stt)}
      {row(t('Voice replies', 'Səsli cavablar'), !r.tts.available ? t('unavailable (no ElevenLabs key)', 'əlçatan deyil (ElevenLabs açarı yoxdur)') : r.tts.on ? `${t('on', 'açıq')} · ${r.tts.model}, ${t('native Azerbaijani voice', 'doğma azərbaycanca səs')}${r.tts.last && !r.tts.last.ok ? ` · ${t('last error', 'son xəta')}: ${r.tts.last.detail}` : ''}` : t('off (press V)', 'bağlı (V düyməsi)'), r.tts.last ? r.tts.last.ok : undefined)}
      {row(t('Demo data', 'Demo məlumat'), !r.demoData ? t("off: only listings from the farmers' phones", 'bağlı: yalnız fermerlərin telefonlarından gələn elanlar') : t('on: seeded farms are listed (press D)', 'açıq: nümunə təsərrüfatlar siyahıdadır (D düyməsi)'))}
      {row('WhatsApp', r.channel === 'twilio' ? t('Twilio sandbox (real phones)', 'Twilio sandbox (real telefonlar)') : t('Simulator (docked phone)', 'Simulyator (ekrandakı telefon)'))}
      {row('Twilio', r.twilio.configured
        ? t(`keys set · ${r.twilio.farmersMapped} farmer phone${r.twilio.farmersMapped === 1 ? '' : 's'} · webhook URL ${r.twilio.webhookUrlKnown ? 'known' : 'not set'}`,
            `açarlar var · ${r.twilio.farmersMapped} fermer telefonu · webhook URL ${r.twilio.webhookUrlKnown ? 'məlumdur' : 'təyin edilməyib'}`)
        : t('not configured', 'qurulmayıb'), r.channel === 'twilio' ? r.twilio.configured && r.twilio.farmersMapped > 0 : undefined)}
      {r.twilio.failedDeliveries > 0 && row(t('Deliveries', 'Çatdırılmalar'), t(`${r.twilio.failedDeliveries} WhatsApp message(s) failed: see the order's activity in Logistics`, `${r.twilio.failedDeliveries} WhatsApp mesajı çatmadı: Logistika bölməsində sifarişin fəaliyyətinə baxın`), false)}
      {fails.map(([k, h]) => row(t(`Last ${k} error`, `Son ${k} xətası`), h.detail, false))}
      {r.restored && <div className="muted" style={{ fontSize: 12 }}>{t('State restored after a server restart.', 'Server yenidən başladıqdan sonra vəziyyət bərpa edildi.')}</div>}
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
