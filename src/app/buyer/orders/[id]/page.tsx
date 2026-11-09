'use client';
import { useLang, type Lang } from '@/components/lang';
import { useLive } from '@/components/live';
import { RegionMap } from '@/components/RegionMap';
import { Shell } from '@/components/Shell';
import { azn, bakuDayL, bakuTime, Medallion, produceName, productL, Stars, tenderGoodsL, Thread, Weave, weaveParts } from '@/components/ui';
import type { Allocation, LedgerEvent, Order } from '@/lib/types';

const ALLOC: Record<Allocation['status'], { en: string; az: string; color: string }> = {
  proposed: { en: 'Proposed', az: 'Təklif olunub', color: 'var(--muted)' },
  offered: { en: 'Offer sent', az: 'Təklif göndərildi', color: 'var(--indigo)' },
  accepted: { en: 'Accepted', az: 'Qəbul etdi', color: 'var(--olive-ink)' },
  declined: { en: 'Declined', az: 'İmtina etdi', color: 'var(--madder)' },
  cancelled: { en: 'Dropped out', az: 'Çıxdı', color: 'var(--madder)' },
  picked_up: { en: 'Picked up', az: 'Götürüldü', color: 'var(--olive-ink)' },
};

/** Causes the farmers' assistant records (in English); shown in Azerbaijani when the site is in AZ. */
const CAUSE_AZ: Record<string, string> = {
  'hail damaged the crop': 'dolu məhsula ziyan vurub',
  'farmer is ill': 'fermer xəstədir',
  'farmer cannot deliver': 'fermer çatdıra bilmir',
};
const causeL = (cause: string, lang: Lang) => (lang === 'az' ? CAUSE_AZ[cause.toLowerCase()] ?? cause.toLowerCase() : cause.toLowerCase());

function steps(o: Order, t: (en: string, az: string) => string) {
  const live = o.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined');
  const ok = live.filter((a) => a.status === 'accepted' || a.status === 'picked_up').length;
  const order = ['offers_sent', 'confirmed', 'picked_up', 'delivered', 'settled'];
  const idx = order.indexOf(o.status);
  return [
    { key: 'offers', label: t('Offers sent', 'Təkliflər göndərildi'), done: true },
    { key: 'confirmed', label: t(`Farmers confirmed ${ok}/${live.length}`, `Fermerlər təsdiqlədi ${ok}/${live.length}`), done: idx >= 1 },
    { key: 'picked', label: t('Picked up', 'Götürüldü'), done: idx >= 2 },
    { key: 'arrived', label: t('Arrived', 'Çatdı'), done: idx >= 3 },
    { key: 'paid', label: t('Paid out (simulated)', 'Ödənildi (simulyasiya)'), done: idx >= 4 },
  ];
}

export default function OrderPage({ params }: { params: { id: string } }) {
  const { s, act } = useLive();
  const { lang, t, loc } = useLang();
  const kgU = t('kg', 'kq');
  const o = s?.orders.find((x) => x.id === params.id);
  if (!s || !o) return <Shell perspective="buyer" active="orders"><div className="muted" style={{ padding: 48 }}>{t('Order not found.', 'Sifariş tapılmadı.')}</div></Shell>;
  const tn = s.tenders.find((x) => x.id === o.tenderId)!;
  const rec = o.recovery;
  const repairing = rec && ['searching', 'proposed', 'offered'].includes(rec.status);
  const offered = o.allocations.filter((a) => a.status === 'offered').length;
  const noBackup = rec?.status === 'no_backup';
  const title = o.status === 'cancelled' ? t('Order cancelled and refunded', 'Sifariş ləğv edildi, pul geri qaytarıldı')
    : noBackup ? t(`${rec!.shortfallKg} kg cannot be replaced in time`, `${rec!.shortfallKg} kq vaxtında əvəz edilə bilmir`)
    : repairing ? t('A farmer dropped out. We are repairing your order.', 'Bir fermer çıxdı. Sifarişinizi bərpa edirik.')
    : o.status === 'offers_sent' ? t(`Waiting for ${offered} farmer${offered === 1 ? '' : 's'} to accept`, `${offered} fermerin qəbulu gözlənilir`)
    : o.status === 'confirmed' ? t('Your order is confirmed', 'Sifarişiniz təsdiqləndi')
    : o.status === 'picked_up' ? t(`Your ${produceName(tn.product)} are on the way`, `${productL(tn.product, 'az')} yoldadır`)
    : o.status === 'delivered' ? t(`Your ${produceName(tn.product)} have arrived`, `${productL(tn.product, 'az')} çatdı`)
    : t('Delivered and paid', 'Çatdırıldı və ödənildi');
  const kg = o.partialKg ?? tn.qtyKg;
  const kept = o.allocations.filter((a) => a.status === 'accepted' || a.status === 'offered').reduce((n, a) => n + a.qtyKg, 0);
  const st = steps(o, t);
  const current = st.findIndex((x) => !x.done);
  const cancelled = rec ? s.farmers.find((f) => f.id === rec.cancelledFarmerId) : undefined;
  const cause = rec?.cause ? ` (${causeL(rec.cause, lang)})` : '';

  return (
    <Shell perspective="buyer" active="orders">
      <div className="page">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 'none' }}>
          <div className="eyebrow" style={{ color: 'var(--madder)' }}>{t('Order', 'Sifariş')} {o.id} · Tender {tn.id}</div>
          <h1 className="serif" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.08 }}>{title}</h1>
          <div className="muted" style={{ fontSize: 14 }}>
            {kg} {kgU} {tenderGoodsL(tn, lang)}{o.partialKg ? t(` (of ${tn.qtyKg} kg ordered)`, ` (sifariş edilən ${tn.qtyKg} kq-dan)`) : ''} · {t('arriving', 'çatma vaxtı')} {bakuDayL(tn.deadline, lang)}, {bakuTime(tn.deadline)} · {tn.destination}
          </div>
        </div>

        <ol aria-label={t('Order progress', 'Sifarişin gedişatı')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 0, flex: 'none' }}>
          {st.map((x, i) => (
            <li key={x.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Medallion size={22} fill={x.done ? 'var(--olive)' : undefined} stroke={x.done ? undefined : i === current ? 'var(--soot)' : 'var(--line)'} inner={x.done ? 'var(--paper)' : undefined} dot={!x.done && i === current ? 'var(--soot)' : undefined} />
                {i < st.length - 1 && <div style={{ flex: 1, height: 0, borderTop: x.done && st[i + 1].done ? '2px solid var(--olive)' : '2px dashed var(--line)', margin: '0 8px' }} />}
              </div>
              <div style={{ fontSize: 14, fontWeight: i === current ? 700 : 500, color: x.done || i === current ? 'var(--soot)' : 'var(--muted)', paddingRight: 12 }}>{x.label}</div>
            </li>
          ))}
        </ol>

        {noBackup && cancelled && o.status !== 'cancelled' && (
          <div className="card flash" style={{ padding: '14px 20px', flex: 'none', boxShadow: 'inset 0 0 0 1px rgba(140,43,31,0.35)', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <Medallion size={20} fill="var(--madder)" inner="var(--paper)" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <b>{t(`${cancelled.name} can’t deliver ${rec!.shortfallKg} kg${cause}, and no other farm fits right now.`, `${cancelled.name} ${rec!.shortfallKg} kq çatdıra bilmir${cause} və hazırda başqa uyğun təsərrüfat yoxdur.`)}</b>
                <span className="muted">{t('Choose what happens to your order. Nothing is charged for the missing kilos.', 'Sifarişinizlə nə ediləcəyini seçin. Çatışmayan kiloqramlar üçün pul alınmır.')}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {kept > 0 && <button className="btn btn-primary" onClick={() => void act('acceptPartial', { orderId: o.id })}>{t(`Accept ${kept} kg instead of ${tn.qtyKg} kg`, `${tn.qtyKg} kq əvəzinə ${kept} kq qəbul et`)}</button>}
              <button className="btn btn-ghost" onClick={() => void act('retryRecovery', { orderId: o.id })}>{t('Search for a backup again', 'Ehtiyat fermeri yenidən axtar')}</button>
              <button className="btn btn-ghost" style={{ color: 'var(--madder)', boxShadow: 'inset 0 0 0 1px var(--madder)' }} onClick={() => { if (window.confirm(t(`Cancel order ${o.id} and get a full refund?`, `${o.id} sifarişini ləğv edib tam geri ödəniş almaq istəyirsiniz?`))) void act('cancelOrder', { orderId: o.id }); }}>{t('Cancel order, full refund', 'Sifarişi ləğv et, tam geri ödəniş')}</button>
            </div>
          </div>
        )}

        {repairing && cancelled && (
          <div className="card flash" style={{ padding: '12px 20px', flex: 'none', boxShadow: 'inset 0 0 0 1px rgba(140,43,31,0.35)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Medallion size={20} fill="var(--madder)" inner="var(--paper)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <b>{t(`${cancelled.name} can’t deliver ${rec!.shortfallKg} kg${cause}.`, `${cancelled.name} ${rec!.shortfallKg} kq çatdıra bilmir${cause}.`)}</b>
              <span className="muted">
                {rec!.status === 'searching' ? t('BƏRƏKƏT is checking nearby farms for a replacement.', 'BƏRƏKƏT yaxınlıqdakı təsərrüfatlarda əvəzedici axtarır.')
                  : rec!.status === 'proposed' ? t('A replacement is found and waiting for our operations team.', 'Əvəzedici tapılıb və əməliyyat komandamızın təsdiqini gözləyir.')
                  : t('The replacement farmer has the offer on WhatsApp.', 'Əvəzedici fermerə təklif WhatsApp-da göndərilib.')} {t('Your arrival time is protected.', 'Çatdırılma vaxtınız qorunur.')}
              </span>
            </div>
          </div>
        )}
        {!repairing && o.priceNotice && (
          <div className="card fade-up" style={{ padding: '12px 20px', flex: 'none', boxShadow: 'inset 0 0 0 1px rgba(92,107,52,0.45)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Medallion size={20} fill="var(--olive)" inner="var(--paper)" />
            <span>{loc(o.priceNotice, o.priceNoticeAz)}</span>
          </div>
        )}

        <div className="page-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 400px)' }}>
          <section className="card" style={{ padding: '22px 28px', display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }} aria-label={t('Farmers in this order', 'Bu sifarişdəki fermerlər')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{t('Your supply', 'Təchizatınız')}</h2>
              <span className="muted" style={{ fontSize: 14 }}>{o.costs.routeKm} {t('km pickup loop', 'km götürmə marşrutu')}</span>
            </div>
            <Weave parts={weaveParts(o.allocations, s.farmers, !!repairing)} total={kg} h={26} />
            <div className="fill" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(220px, 1fr)', gap: 24, minHeight: 0 }}>
            <div className="scroll" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {o.allocations.filter((a) => repairing || (a.status !== 'cancelled' && a.status !== 'declined')).map((a, i) => {
                const f = s.farmers.find((x) => x.id === a.farmerId)!;
                const stl = ALLOC[a.status];
                return (
                  <div key={a.id} className="fade-up" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.7fr 1.1fr 1fr', gap: 12, alignItems: 'center', padding: '11px 0', borderTop: i ? '1px solid var(--hair2)' : undefined, opacity: a.status === 'cancelled' ? 0.6 : 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Thread color={f.color} h={30} />
                      <span><b style={{ display: 'block', textDecoration: a.status === 'cancelled' ? 'line-through' : undefined }}>{f.name}</b><span className="muted" style={{ fontSize: 13 }}>{f.village}</span></span>
                    </span>
                    <span className="num">{a.qtyKg} {kgU}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: stl.color, fontSize: 14 }}>
                      <Medallion size={14} fill={a.status === 'accepted' || a.status === 'picked_up' ? stl.color : undefined} stroke={a.status === 'accepted' || a.status === 'picked_up' ? undefined : stl.color} dashed={a.status === 'offered'} />
                      {t(stl.en, stl.az)}
                    </span>
                    <span style={{ justifySelf: 'end' }}>
                      {o.status === 'settled' && a.status === 'picked_up' ? (
                        <Stars value={o.buyerRatings[f.id]} onRate={(n) => void act('rateFarmer', { orderId: o.id, farmerId: f.id, stars: n })} />
                      ) : (
                        <span className="num muted" style={{ fontSize: 14 }}>{(a.qtyKg * a.priceAzn).toFixed(2)} ₼</span>
                      )}
                    </span>
                  </div>
                );
              })}
            {o.status === 'settled' && <div className="note" style={{ fontSize: 15, paddingTop: 10 }}>{t('Rate each farmer. Farmers rate you from WhatsApp too.', 'Hər fermeri qiymətləndirin. Fermerlər də sizi WhatsApp-dan qiymətləndirir.')}</div>}
            </div>
            {/* The pickup loop, beside the farmers. */}
            <div style={{ minHeight: 0, display: 'flex' }}>
              <RegionMap
                farmers={s.farmers}
                route={o.route}
                dest={{ lat: s.buyers[0].lat, lng: s.buyers[0].lng, label: t('Baku', 'Bakı') }}
                cancelled={repairing ? cancelled : undefined}
                caption={t(`Pickup loop · ${o.costs.routeKm} km · one van`, `Götürmə marşrutu · ${o.costs.routeKm} km · bir furqon`)}
              />
            </div>
            </div>
          </section>

          <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <aside className="card" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12, flex: 'none' }} aria-label={t('Payment', 'Ödəniş')}>
            <div className="eyebrow muted" style={{ fontSize: 11 }}>{t('Escrow · simulated, no real money', 'Əmanət hesabı · simulyasiya, real pul deyil')}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="serif num" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }}>{azn(o.escrow.amount)}</span>
              <span className="muted">{o.escrow.status === 'held' ? t('held', 'saxlanılır') : o.escrow.status === 'refunded' ? t('refunded to you', 'sizə geri qaytarıldı') : t('released to farmers', 'fermerlərə ödənildi')}</span>
            </div>
            <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <Row k={t('Produce', 'Məhsul')} v={o.costs.produce} />
              <Row k={t('Transport', 'Daşınma')} v={o.costs.transport} />
              <Row k={t('Platform fee', 'Platforma haqqı')} v={o.costs.fee} />
              <div className="rule" />
              <Row k={t('Per kg delivered', 'Kq üçün, çatdırılma ilə')} v={o.costs.perKg} suffix={` ₼/${kgU}`} bold />
            </div>
            {(o.status === 'offers_sent' || o.status === 'confirmed') && !noBackup && (
              <button className="link muted" style={{ alignSelf: 'flex-start', fontSize: 13 }} onClick={() => { if (window.confirm(t(`Cancel order ${o.id} before pickup? The escrow is refunded and the farmers are told.`, `${o.id} sifarişi götürmədən əvvəl ləğv edilsin? Əmanət hesabındakı məbləğ geri qaytarılacaq və fermerlərə xəbər veriləcək.`))) void act('cancelOrder', { orderId: o.id }); }}>{t('Cancel order before pickup', 'Sifarişi götürmədən əvvəl ləğv et')}</button>
            )}
            {o.status === 'delivered' && (
              <button className="btn btn-primary" style={{ height: 52 }} onClick={() => void act('confirmReceipt', { orderId: o.id })}>{t('Confirm receipt and release payment', 'Qəbulu təsdiq et və ödənişi fermerlərə köçür')}</button>
            )}
          </aside>
          <Updates events={s.events.filter((e) => e.orderId === o.id)} />
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** What happened on this order, newest first, with what the farmers said (translated from WhatsApp). */
function Updates({ events }: { events: LedgerEvent[] }) {
  const { t, loc } = useLang();
  return (
    <section aria-label={t('Updates', 'Yeniliklər')} className="card fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 90 }}>
      <div className="eyebrow muted" style={{ fontSize: 11, padding: '16px 24px 6px', flex: 'none' }}>{t('Updates', 'Yeniliklər')}</div>
      <div className="scroll fill" style={{ padding: '0 24px 12px' }}>
        {events.map((e) => (
          <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '42px 1fr', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--hair2)' }}>
            <span className="num muted" style={{ fontSize: 12, paddingTop: 2 }}>{bakuTime(e.at)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 500, color: e.tone === 'alert' ? 'var(--madder)' : undefined }}>{loc(e.title, e.titleAz)}</span>
              {e.quote && <span className="note" style={{ fontSize: 13.5 }}>“{loc(e.quote, e.quoteAz)}”</span>}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Row({ k, v, suffix = ' ₼', bold }: { k: string; v: number; suffix?: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: bold ? 700 : 400 }}>
      <span className={bold ? undefined : 'muted'}>{k}</span>
      <span>{v.toFixed(2)}{suffix}</span>
    </div>
  );
}
