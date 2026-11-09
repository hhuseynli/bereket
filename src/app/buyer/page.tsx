'use client';
import Link from 'next/link';
import { useLang, type Lang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { bakuDayL, bakuTime, Medallion, produceName, produceNameL, productL } from '@/components/ui';

const STATUS: Record<string, { en: string; az: string; color: string }> = {
  draft: { en: 'Draft', az: 'Qaralama', color: 'var(--muted)' },
  open: { en: 'Open', az: 'Açıq', color: 'var(--indigo)' },
  matching: { en: 'Matching', az: 'Uyğunlaşdırılır', color: 'var(--indigo)' },
  proposals: { en: 'Proposals ready', az: 'Variantlar hazırdır', color: 'var(--madder)' },
  ordered: { en: 'Ordered', az: 'Sifariş verildi', color: 'var(--olive-ink)' },
  cancelled: { en: 'Cancelled', az: 'Ləğv edildi', color: 'var(--muted)' },
};
const cap = (x: string) => x.replace(/^./, (c) => c.toUpperCase());
/** "Tomatoes" / "Pomidor" */
const capProduce = (p: string, lang: Lang) => (lang === 'az' ? productL(p, 'az') : cap(produceName(p)));
const ORDER_LABEL: Record<string, { en: string; az: string }> = {
  offers_sent: { en: 'Waiting for farmers', az: 'Fermerlər gözlənilir' },
  confirmed: { en: 'Confirmed, pickup next', az: 'Təsdiqləndi, növbəti götürmə' },
  picked_up: { en: 'On the way', az: 'Yoldadır' },
  delivered: { en: 'Arrived: confirm receipt', az: 'Çatdı: qəbulu təsdiq edin' },
  settled: { en: 'Settled', az: 'Bağlandı' },
  cancelled: { en: 'Cancelled', az: 'Ləğv edildi' },
};
const USE_AZ: Record<string, string> = { Kitchen: 'Mətbəx', 'Retail shelf': 'Pərakəndə rəf', Processing: 'Emal', Export: 'İxrac' };

/** Orders still moving, under the tenders: what is coming and when. */
function InProgress({ s }: { s: NonNullable<ReturnType<typeof useLive>['s']> }) {
  const { lang, t } = useLang();
  const kg = t('kg', 'kq');
  const open = s.orders.filter((o) => !['settled', 'cancelled'].includes(o.status));
  return (
    <section aria-label={t('Orders in progress', 'Davam edən sifarişlər')} className="card fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 120 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 24px 6px', flex: 'none' }}>
        <span className="eyebrow muted" style={{ fontSize: 11 }}>{open.length ? t('Orders in progress', 'Davam edən sifarişlər') : t('Nothing on the way · newest on the market', 'Yolda heç nə yoxdur · bazarda ən yenilər')}</span>
        <Link href="/buyer/orders" className="muted" style={{ fontSize: 13 }}>{t('All orders ›', 'Bütün sifarişlər ›')}</Link>
      </div>
      <div className="scroll fill" style={{ padding: '0 24px 12px' }}>
        {open.length === 0 && <NewListings s={s} />}
        {open.map((o) => {
          const tn = s.tenders.find((x) => x.id === o.tenderId);
          const repairing = o.recovery && ['searching', 'proposed', 'offered', 'no_backup'].includes(o.recovery.status);
          const ol = ORDER_LABEL[o.status];
          return (
            <Link key={o.id} href={`/buyer/orders/${o.id}`} style={{ display: 'grid', gridTemplateColumns: '74px 1fr 180px 150px', gap: 18, alignItems: 'center', padding: '11px 0', borderBottom: '1px solid var(--hair2)', fontSize: 14 }}>
              <span className="num muted">{o.id}</span>
              <span>{o.partialKg ?? tn?.qtyKg} {kg} {tn ? produceNameL(tn.product, lang) : ''} · {o.costs.perKg.toFixed(2)} ₼/{kg}</span>
              <span style={{ fontWeight: 600, color: repairing ? 'var(--madder)' : o.status === 'delivered' ? 'var(--madder)' : 'var(--olive-ink)' }}>{repairing ? t('Being repaired', 'Bərpa olunur') : ol ? t(ol.en, ol.az) : o.status}</span>
              <span className="num muted">{tn ? `${bakuDayL(tn.deadline, lang)}, ${bakuTime(tn.deadline)}` : ''}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function Tenders() {
  const { s } = useLive();
  const { lang, t } = useLang();
  const kg = t('kg', 'kq');
  if (!s) return <Shell perspective="buyer" active="tenders">{null}</Shell>;
  // What farmers offer right now, by product: the buyer sees what a tender could get before writing one.
  const live = s.listings.filter((l) => l.status === 'live');
  const market = [...new Set(live.map((l) => l.product))].map((p) => {
    const lots = live.filter((l) => l.product === p);
    const prices = lots.map((l) => l.priceAzn);
    return { product: p, kg: lots.reduce((n, l) => n + l.qtyKg, 0), farms: new Set(lots.map((l) => l.farmerId)).size, low: Math.min(...prices), high: Math.max(...prices), fresh: lots.filter((l) => l.source === 'whatsapp').length };
  }).sort((a, b) => b.kg - a.kg);
  const liveFarms = new Set(live.map((l) => l.farmerId)).size;
  const phones = s.settings.demoData === false;

  return (
    <Shell perspective="buyer" active="tenders">
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap', flex: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="eyebrow" style={{ color: 'var(--madder)' }}>{s.buyers[0]?.name}</div>
            <h1 className="serif" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em' }}>{t('Tenders', 'Tenderlər')}</h1>
          </div>
          <Link className="btn btn-primary" href="/buyer/tenders/new">{t('New tender', 'Yeni tender')}</Link>
        </div>
        <div className="page-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          <div className="card scroll" style={{ display: 'flex', flexDirection: 'column', flex: '0 1 auto', minHeight: 0 }}>
            {s.tenders.length === 0 && <div className="muted" style={{ padding: 26 }}>{t('No tenders yet. Post one with New tender.', 'Hələ tender yoxdur. «Yeni tender» ilə birini dərc edin.')}</div>}
            {s.tenders.map((tn, i) => {
              const st = STATUS[tn.status];
              const href = tn.orderId ? `/buyer/orders/${tn.orderId}` : `/buyer/tenders/${tn.id}`;
              const variety = /^any$/i.test(tn.variety) ? t('Any variety', 'İstənilən növ') : tn.variety;
              const use = t(tn.intendedUse, USE_AZ[tn.intendedUse] ?? tn.intendedUse);
              return (
                <Link key={tn.id} href={href} style={{ display: 'grid', gridTemplateColumns: '74px 1fr 150px 160px 16px', gap: 18, alignItems: 'center', padding: '18px 24px', borderTop: i ? '1px solid var(--hair2)' : undefined, opacity: tn.status === 'cancelled' ? 0.6 : 1 }}>
                  <span className="num muted" style={{ fontSize: 14 }}>{tn.id}</span>
                  <span>
                    <span className="serif" style={{ fontSize: 20, fontWeight: 600, display: 'block' }}>{capProduce(tn.product, lang)}, {tn.qtyKg} {kg}</span>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {t(`${variety}, Grade ${tn.grade} · ${use}, within ${tn.useWithinDays} days · ${tn.destination}`,
                        `${variety}, Sort ${tn.grade} · ${use}, ${tn.useWithinDays} gün ərzində · ${tn.destination}`)}
                    </span>
                  </span>
                  <span className="num" style={{ fontSize: 14 }}>{bakuDayL(tn.deadline, lang)}, {bakuTime(tn.deadline)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: st.color }}>
                    <Medallion size={14} stroke={st.color} inner={tn.status === 'draft' || tn.status === 'cancelled' ? undefined : st.color} />
                    {t(st.en, st.az)}
                  </span>
                  <span aria-hidden="true" className="muted">›</span>
                </Link>
              );
            })}
          </div>
          <InProgress s={s} />
          </div>

          <aside aria-label={t('On the market now', 'İndi bazarda')} className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '20px 22px 10px', flex: 'none' }}>
              <div className="eyebrow" style={{ color: 'var(--olive-ink)', fontSize: 11 }}>{t('On the market now', 'İndi bazarda')}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {t(`${live.length} live lots from ${liveFarms} farms${phones ? ', from the farmers’ phones' : ''}. Prices at the farm, before transport.`,
                  `${liveFarms} təsərrüfatdan ${live.length} aktiv partiya${phones ? ', fermerlərin telefonlarından' : ''}. Qiymətlər təsərrüfatda, daşınmadan əvvəl.`)}
              </div>
            </div>
            <div className="scroll fill" style={{ padding: '0 22px 16px' }}>
              {market.length === 0 && <div className="muted" style={{ fontSize: 14, paddingTop: 10 }}>{t('Nothing listed yet. Farmers list by sending a voice note and a photo on WhatsApp.', 'Hələ heç nə elan olunmayıb. Fermerlər WhatsApp-da səsli mesaj və şəkil göndərərək elan verirlər.')}</div>}
              {market.map((m) => (
                <Link key={m.product} href={`/buyer/tenders/new?product=${encodeURIComponent(m.product)}`} title={t(`New tender for ${produceName(m.product)}`, `${productL(m.product, 'az')} üçün yeni tender`)}
                  style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 12px', padding: '11px 0', borderBottom: '1px solid var(--hair2)' }}>
                  <b>{capProduce(m.product, lang)}</b>
                  <span className="num" style={{ fontWeight: 600 }}>{m.kg.toLocaleString('en-US')} {kg}</span>
                  <span className="muted num" style={{ fontSize: 12.5 }}>
                    {t(`${m.farms} farm${m.farms === 1 ? '' : 's'}${m.fresh ? ` · ${m.fresh} new today` : ''}`, `${m.farms} təsərrüfat${m.fresh ? ` · bu gün ${m.fresh} yeni` : ''}`)}
                  </span>
                  <span className="muted num" style={{ fontSize: 12.5 }}>{m.low === m.high ? m.low.toFixed(2) : `${m.low.toFixed(2)}–${m.high.toFixed(2)}`} ₼/{kg}</span>
                </Link>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

/** With no order on the way: the newest lots farmers listed, so the buyer sees the market move. */
function NewListings({ s }: { s: NonNullable<ReturnType<typeof useLive>['s']> }) {
  const { lang, t } = useLang();
  const kg = t('kg', 'kq');
  const lots = [...s.listings.filter((l) => l.status === 'live')].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12);
  return (
    <>
      {lots.map((l) => {
        const f = s.farmers.find((x) => x.id === l.farmerId);
        return (
          <Link key={l.id} href={`/buyer/tenders/new?product=${encodeURIComponent(l.product)}`} style={{ display: 'grid', gridTemplateColumns: '74px 1fr 180px 150px', gap: 18, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--hair2)', fontSize: 14 }}>
            <span className="num muted">{bakuTime(l.createdAt)}</span>
            <span><b>{f?.name ?? l.farmerId}</b> <span className="muted">· {f?.village}</span></span>
            <span>{l.qtyKg} {kg} {l.variety !== 'Local' ? `${l.variety} ` : ''}{produceNameL(l.product, lang)}</span>
            <span className="num muted">{l.priceAzn.toFixed(2)} ₼/{kg} · {t('grade', 'sort')} {l.grade}</span>
          </Link>
        );
      })}
    </>
  );
}
