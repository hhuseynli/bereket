'use client';
import Link from 'next/link';
import { useLang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { azn, bakuDayL, bakuTime, tenderGoodsL, Thread, Weave, weaveParts } from '@/components/ui';

const LABEL: Record<string, { en: string; az: string }> = {
  offers_sent: { en: 'Waiting for farmers', az: 'Fermerlər gözlənilir' },
  confirmed: { en: 'Confirmed', az: 'Təsdiqləndi' },
  picked_up: { en: 'On the way', az: 'Yoldadır' },
  delivered: { en: 'Arrived', az: 'Çatdı' },
  settled: { en: 'Settled', az: 'Bağlandı' },
  cancelled: { en: 'Cancelled, refunded', az: 'Ləğv edildi, geri qaytarıldı' },
};

export default function Orders() {
  const { s } = useLive();
  const { lang, t } = useLang();
  const kgU = t('kg', 'kq');
  if (!s) return <Shell perspective="buyer" active="orders">{null}</Shell>;
  const done = s.orders.filter((o) => o.status !== 'cancelled');
  const settled = s.orders.filter((o) => o.status === 'settled');
  const kg = settled.reduce((n, o) => n + (o.partialKg ?? s.tenders.find((x) => x.id === o.tenderId)?.qtyKg ?? 0), 0);
  const spent = settled.reduce((n, o) => n + o.escrow.amount, 0);
  const held = done.filter((o) => o.escrow.status === 'held').reduce((n, o) => n + o.escrow.amount, 0);
  // Farms this buyer has bought from, with how much and the buyer's own rating.
  const farms = new Map<string, { kg: number; orders: number; stars?: number }>();
  for (const o of done) for (const a of o.allocations.filter((x) => x.status === 'accepted' || x.status === 'picked_up')) {
    const e = farms.get(a.farmerId) ?? { kg: 0, orders: 0 };
    e.kg += a.qtyKg; e.orders += 1; e.stars = o.buyerRatings[a.farmerId] ?? e.stars;
    farms.set(a.farmerId, e);
  }

  return (
    <Shell perspective="buyer" active="orders">
      <div className="page">
        <h1 className="serif" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', flex: 'none' }}>{t('Orders', 'Sifarişlər')}</h1>
        <div className="page-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)' }}>
          <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
            {s.orders.length === 0 && <div className="card muted" style={{ padding: 32 }}>{t('No orders yet. Confirm a proposal on a tender to create one.', 'Hələ sifariş yoxdur. Sifariş yaratmaq üçün tenderdə bir variantı təsdiq edin.')}</div>}
            {s.orders.map((o) => {
              const tn = s.tenders.find((x) => x.id === o.tenderId)!;
              const lb = LABEL[o.status];
              const label = lb ? t(lb.en, lb.az) : o.status;
              return (
                <Link key={o.id} href={`/buyer/orders/${o.id}`} className="card" style={{ padding: '18px 24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(160px, 260px) 110px', gap: 24, alignItems: 'center', flex: 'none', opacity: o.status === 'cancelled' ? 0.6 : 1 }}>
                  <span>
                    <span className="serif" style={{ fontSize: 20, fontWeight: 600, display: 'block' }}>{o.id} · {o.partialKg ?? tn.qtyKg} {kgU} {tenderGoodsL(tn, lang)}</span>
                    <span className="muted" style={{ fontSize: 14 }}>
                      {t(`${label} · ${azn(o.costs.total)} delivered · due ${bakuDayL(tn.deadline, lang)} ${bakuTime(tn.deadline)}`,
                        `${label} · ${azn(o.costs.total)} çatdırılma ilə · son tarix ${bakuDayL(tn.deadline, lang)} ${bakuTime(tn.deadline)}`)}
                    </span>
                  </span>
                  <Weave parts={weaveParts(o.allocations, s.farmers)} total={o.partialKg ?? tn.qtyKg} />
                  <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{o.costs.perKg.toFixed(2)} ₼/{kgU}</span>
                </Link>
              );
            })}
          </div>

          <aside aria-label={t('Summary', 'Xülasə')} className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div className="num" style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', flex: 'none', borderBottom: '1px solid var(--hair)' }}>
              <Fig k={t('Delivered and paid', 'Çatdırılıb və ödənilib')} v={azn(spent)} />
              <Fig k={t('Held in escrow', 'Əmanət hesabında saxlanılır')} v={azn(held)} />
              <Fig k={t('Received', 'Qəbul edilib')} v={`${kg.toLocaleString('en-US')} ${kgU}`} />
              <Fig k={t('Average delivered', 'Orta qiymət, çatdırılma ilə')} v={kg ? `${(spent / kg).toFixed(2)} ₼/${kgU}` : '–'} />
            </div>
            <div className="eyebrow muted" style={{ fontSize: 11, padding: '16px 22px 4px', flex: 'none' }}>{t('Farms you buy from', 'Aldığınız təsərrüfatlar')}</div>
            <div className="scroll fill" style={{ padding: '0 22px 14px' }}>
              {farms.size === 0 && <div className="muted" style={{ fontSize: 14, paddingTop: 6 }}>{t('Farms appear here once they accept your orders.', 'Təsərrüfatlar sifarişlərinizi qəbul etdikdən sonra burada görünür.')}</div>}
              {[...farms.entries()].sort((a, b) => b[1].kg - a[1].kg).map(([id, e]) => {
                const f = s.farmers.find((x) => x.id === id);
                if (!f) return null;
                return (
                  <div key={id} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid var(--hair2)' }}>
                    <Thread color={f.color} h={26} />
                    <span><b style={{ display: 'block', fontSize: 14 }}>{f.name}</b><span className="muted" style={{ fontSize: 12.5 }}>{f.village} · ★ {f.rating} · {t(`${e.orders} order${e.orders === 1 ? '' : 's'}`, `${e.orders} sifariş`)}</span></span>
                    <span className="num" style={{ fontSize: 14, textAlign: 'right' }}>{e.kg} {kgU}{e.stars ? <span className="muted" style={{ display: 'block', fontSize: 12 }}>{t('you', 'siz')}: {'★'.repeat(e.stars)}</span> : null}</span>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      </div>
    </Shell>
  );
}

function Fig({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <b style={{ fontSize: 19 }}>{v}</b>
      <span className="muted" style={{ fontSize: 12 }}>{k}</span>
    </div>
  );
}
