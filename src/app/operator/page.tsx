'use client';
import { useEffect, useState } from 'react';
import { useLive } from '@/components/live';
import { RegionMap } from '@/components/RegionMap';
import { Shell } from '@/components/Shell';
import { useLang } from '@/components/lang';
import { appNow, azn, bakuDayL, bakuTime, Loom, Medallion, tenderGoodsL, Thread, Weave, weaveParts } from '@/components/ui';
import { tracksRipeness } from '@/lib/ripeness';
import type { LedgerEvent, Order } from '@/lib/types';

type T = (en: string, az: string) => string;
const TONE: Record<LedgerEvent['tone'], { color: string; label: (e: LedgerEvent, t: T) => string }> = {
  alert: { color: 'var(--madder)', label: (e, t) => (e.type === 'cancel' ? t('Cancelled', 'Ləğv edildi') : t('Attention', 'Diqqət')) },
  ai: { color: 'var(--indigo)', label: (e, t) => (e.type === 'recovery' ? t('AI · Recovery', 'Sİ · Bərpa') : t('AI', 'Sİ')) },
  good: { color: 'var(--olive-ink)', label: (e, t) => (e.type === 'rating' ? t('Rating', 'Reytinq') : e.type === 'escrow' ? t('Escrow · simulated', 'Əmanət hesabı · simulyasiya') : t('Confirmed', 'Təsdiqləndi')) },
  neutral: {
    color: 'var(--ink2)',
    label: (e, t) => {
      const m: Record<string, [string, string]> = { order: ['Order', 'Sifariş'], offer: ['Offer', 'Təklif'], escrow: ['Escrow · simulated', 'Əmanət hesabı · simulyasiya'], delivery: ['Delivery', 'Çatdırılma'], listing: ['Listing', 'Elan'] };
      const x = m[e.type];
      return x ? t(x[0], x[1]) : t('Update', 'Yenilənmə');
    },
  },
};

type Filter = 'active' | 'attention' | 'waiting' | 'ready' | 'road' | 'arrived' | 'settled' | 'cancelled' | 'all';
const FILTERS: { key: Filter; label: [string, string] }[] = [
  { key: 'active', label: ['Active', 'Aktiv'] },
  { key: 'attention', label: ['Needs attention', 'Diqqət tələb edir'] },
  { key: 'waiting', label: ['Waiting for farmers', 'Fermerlər gözlənilir'] },
  { key: 'ready', label: ['Ready for pickup', 'Götürməyə hazırdır'] },
  { key: 'road', label: ['On the road', 'Yoldadır'] },
  { key: 'arrived', label: ['Arrived', 'Çatdı'] },
  { key: 'settled', label: ['Settled', 'Bağlandı'] },
  { key: 'cancelled', label: ['Cancelled', 'Ləğv edildi'] },
  { key: 'all', label: ['All', 'Hamısı'] },
];
const needsAttention = (o: Order) => !!o.recovery && ['searching', 'proposed', 'offered', 'no_backup'].includes(o.recovery.status) && o.status !== 'cancelled';
function bucket(o: Order): Exclude<Filter, 'active' | 'all'> {
  if (needsAttention(o)) return 'attention';
  return ({ offers_sent: 'waiting', confirmed: 'ready', picked_up: 'road', delivered: 'arrived', settled: 'settled', cancelled: 'cancelled' } as const)[o.status];
}
const matches = (o: Order, f: Filter) => f === 'all' || (f === 'active' ? !['settled', 'cancelled'].includes(o.status) : bucket(o) === f);
const BUCKET: Record<ReturnType<typeof bucket>, { label: [string, string]; color: string }> = {
  attention: { label: ['Needs attention', 'Diqqət tələb edir'], color: 'var(--madder)' },
  waiting: { label: ['Waiting for farmers', 'Fermerlər gözlənilir'], color: 'var(--indigo)' },
  ready: { label: ['Ready for pickup', 'Götürməyə hazırdır'], color: 'var(--olive-ink)' },
  road: { label: ['On the road', 'Yoldadır'], color: 'var(--olive-ink)' },
  arrived: { label: ['Arrived', 'Çatdı'], color: 'var(--olive-ink)' },
  settled: { label: ['Settled', 'Bağlandı'], color: 'var(--muted)' },
  cancelled: { label: ['Cancelled', 'Ləğv edildi'], color: 'var(--muted)' },
};

export default function Logistics() {
  const { s, act } = useLive();
  const { lang, t: tr, loc } = useLang();
  const [showOthers, setShowOthers] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  // A new problem (a farmer drops out) takes the operator straight to that order.
  const alertId = s?.orders.find((o) => needsAttention(o) && o.recovery?.status === 'searching')?.id;
  useEffect(() => { if (alertId) { setPicked(alertId); setFilter('active'); } }, [alertId]);
  if (!s) return <Shell perspective="operator" active="logistics">{null}</Shell>;

  const f = (id?: string) => s.farmers.find((x) => x.id === id);
  const tenderOf = (o: Order) => s.tenders.find((t) => t.id === o.tenderId);
  const text = (o: Order) => {
    const t = tenderOf(o);
    return [o.id, t?.product, t?.variety, t?.destination, ...o.allocations.map((a) => f(a.farmerId)?.name)].join(' ').toLowerCase();
  };
  const listed = s.orders.filter((o) => matches(o, filter) && (!q.trim() || text(o).includes(q.trim().toLowerCase())));
  const count = (k: Filter) => s.orders.filter((o) => matches(o, k)).length;
  const order: Order | undefined = s.orders.find((o) => o.id === picked) ?? listed.find(needsAttention) ?? listed[0];
  const rec = order?.recovery;
  const buyer = s.buyers[0];
  const tender = order ? tenderOf(order) : undefined;
  const cand = rec && rec.selected !== undefined ? rec.candidates[rec.selected] : undefined;
  const active = rec && ['searching', 'proposed', 'offered'].includes(rec.status);

  // What the map shows
  let route = order?.route ?? [];
  if (rec && (rec.status === 'proposed' || rec.status === 'offered') && cand?.route) route = cand.route;
  if (rec && rec.status === 'searching') route = route.filter((r) => r.farmerId !== rec.cancelledFarmerId);
  const dim = rec ? rec.candidates.filter((c) => !c.accepted).map((c) => f(c.farmerId)!).filter(Boolean) : s.listings.filter((l) => l.status === 'live' && l.product === (tender?.product ?? 'Tomato')).map((l) => f(l.farmerId)!).filter((x) => !route.some((r) => r.farmerId === x.id));

  // Activity of the selected order (or everything, when there is no order yet)
  const events = order ? s.events.filter((e) => e.orderId === order.id || e.type === 'system') : s.events.slice(0, 12);
  const highlight = events.find((e) => e.tone === 'alert' && active);

  return (
    <Shell perspective="operator" active="logistics">
      <div className="logistics-grid" style={{ height: '100%', minHeight: 600, display: 'grid' }}>
        {/* Orders */}
        <section aria-label={tr('Orders', 'Sifarişlər')} style={{ borderRight: '1px solid var(--hair)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '22px 20px 12px', display: 'flex', flexDirection: 'column', gap: 12, flex: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <h2 className="serif" style={{ fontSize: 22, fontWeight: 600 }}>{tr('Orders', 'Sifarişlər')}</h2>
              <span className="muted num" style={{ fontSize: 13 }}>{s.orders.length} {tr('total', 'cəmi')}</span>
            </div>
            <input aria-label={tr('Search orders', 'Sifarişlərdə axtar')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search: order, farmer, product', 'Axtar: sifariş, fermer, məhsul')}
              style={{ height: 36, padding: '0 10px', border: 0, borderRadius: 2, background: '#fff', boxShadow: 'inset 0 0 0 1px var(--line)', font: 'inherit', fontSize: 14 }} />
            <div role="tablist" aria-label={tr('Filter orders', 'Sifarişləri süz')} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {FILTERS.map((x) => {
                const n = count(x.key);
                const on = filter === x.key;
                if (!n && !on && x.key !== 'active' && x.key !== 'all') return null;
                return (
                  <button key={x.key} role="tab" aria-selected={on} className="chip" onClick={() => setFilter(x.key)}
                    style={{ border: 0, cursor: 'pointer', height: 26, background: on ? 'var(--soot)' : 'transparent', color: on ? 'var(--paper)' : x.key === 'attention' ? 'var(--madder)' : 'var(--ink2)', boxShadow: on ? undefined : `inset 0 0 0 1px ${x.key === 'attention' ? 'var(--madder)' : 'var(--line)'}` }}>
                    {tr(x.label[0], x.label[1])} <span className="num" style={{ opacity: 0.75 }}>{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="scroll" style={{ flex: '0 1 auto', minHeight: 0, padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {listed.length === 0 && (
              <div className="muted" style={{ fontSize: 14, padding: '8px 8px' }}>
                {s.orders.length === 0 ? tr('No orders yet. They appear here when a buyer confirms a proposal.', 'Hələ sifariş yoxdur. Alıcı təklifi təsdiqləyəndə burada görünəcək.') : tr('No orders match this filter.', 'Bu süzgəcə uyğun sifariş yoxdur.')}
              </div>
            )}
            {listed.map((o) => {
              const t = tenderOf(o);
              const b = BUCKET[bucket(o)];
              const on = o.id === order?.id;
              const alert = needsAttention(o) && o.recovery ? tr(`${f(o.recovery.cancelledFarmerId)?.name.split(' ')[0]} dropped ${o.recovery.shortfallKg} kg`, `${f(o.recovery.cancelledFarmerId)?.name.split(' ')[0]} ${o.recovery.shortfallKg} kq-dan imtina etdi`) : undefined;
              return (
                <button key={o.id} onClick={() => setPicked(o.id)} aria-pressed={on}
                  style={{ textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 2, padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 7, background: on ? 'var(--paper2)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--hair), inset 3px 0 0 var(--indigo)' : 'inset 0 -1px 0 var(--hair2)' }}>
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <b className="num">{o.id}</b>
                    <span style={{ fontSize: 12, fontWeight: 700, color: b.color }}>{tr(b.label[0], b.label[1])}</span>
                  </span>
                  <span style={{ fontSize: 14 }}>{o.partialKg ?? t?.qtyKg} {tr('kg', 'kq')} {t ? tenderGoodsL(t, lang) : ''}</span>
                  <Weave parts={weaveParts(o.allocations, s.farmers, needsAttention(o))} total={o.partialKg ?? t?.qtyKg ?? 1} h={8} />
                  <span className="muted num" style={{ fontSize: 12.5, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{o.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined').length} {tr('farms', 'təsərrüfat')} · {o.costs.perKg.toFixed(2)} ₼/{tr('kg', 'kq')}</span>
                    {t && <span>{tr('due', 'son tarix')} {bakuDayL(t.deadline, lang)} {bakuTime(t.deadline)}</span>}
                  </span>
                  {alert && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--madder)' }}>{alert}</span>}
                </button>
              );
            })}
          </div>
          <Schedule s={s} onPick={setPicked} />
          <div style={{ flex: 'none', borderTop: '1px solid var(--hair)', padding: '12px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }} className="num">
            <Mini k={tr('Live listings', 'Aktiv elanlar')} v={s.listings.filter((l) => l.status === 'live').length} />
            <Mini k={tr('Open tenders', 'Açıq tenderlər')} v={s.tenders.filter((t) => ['open', 'proposals', 'draft'].includes(t.status)).length} />
            <Mini k={tr('Farmers', 'Fermerlər')} v={new Set(s.listings.filter((l) => l.status === 'live').map((l) => l.farmerId)).size} />
          </div>
        </section>

        {/* Map */}
        <section aria-label={tr('Pickup map', 'Götürmə xəritəsi')} style={{ background: 'var(--paper2)', padding: 20, minHeight: 0, display: 'flex' }}>
          <RegionMap
            farmers={s.farmers}
            route={route}
            dest={{ lat: buyer.lat, lng: buyer.lng, label: tr('Baku', 'Bakı') }}
            cancelled={rec ? f(rec.cancelledFarmerId) : undefined}
            candidate={cand && rec && rec.status !== 'no_backup' ? f(cand.farmerId) : undefined}
            candidateConfirmed={rec?.status === 'resolved'}
            dim={dim}
            caption={order ? `${tr('Order', 'Sifariş')} ${order.id} · ${(rec?.status === 'proposed' || rec?.status === 'offered') && cand?.costs ? cand.costs.routeKm : order.costs.routeKm} km` : tr('Farms with live listings', 'Aktiv elanı olan təsərrüfatlar')}
          />
        </section>

        {/* Context panel */}
        <section aria-label={tr('Details', 'Təfərrüatlar')} className="scroll" style={{ borderLeft: '1px solid var(--hair)', background: 'var(--paper)', padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!order && (
            <>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{tr('Logistics', 'Logistika')}</div>
              <h2 className="serif" style={{ fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>{s.orders.length ? tr('No order selected', 'Sifariş seçilməyib') : tr('No orders yet', 'Hələ sifariş yoxdur')}</h2>
              <div className="muted" style={{ fontSize: 14 }}>{tr('Pickups, deliveries and repairs for every order. When a buyer confirms a proposal, the farmers get offers on WhatsApp and the order shows up on the left.', 'Hər sifariş üçün götürmə, çatdırılma və bərpa. Alıcı təklifi təsdiqləyəndə fermerlər WhatsApp-da təklif alır və sifariş solda görünür.')}</div>
            </>
          )}

          {order && rec && rec.status === 'searching' && (
            <>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{tr('AI recovery', 'Sİ bərpası')}</div>
              <h2 className="serif" style={{ fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>{tr(`Fill the ${rec.shortfallKg} kg gap`, `${rec.shortfallKg} kq boşluğu doldurun`)}</h2>
              <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'offered'), s.farmers)} total={tender!.qtyKg} h={30} />
              <Loom label={tr('Checking nearby farms…', 'Yaxınlıqdakı təsərrüfatlar yoxlanılır…')} />
            </>
          )}

          {order && rec && (rec.status === 'proposed' || rec.status === 'offered') && cand && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{tr('AI recovery proposal', 'Sİ bərpa təklifi')}</div>
                <h2 className="serif" style={{ fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>{tr(`Fill the ${rec.shortfallKg} kg gap`, `${rec.shortfallKg} kq boşluğu doldurun`)}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 12, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 13 }}>{tr('Now', 'İndi')}</span>
                  <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'offered'), s.farmers)} total={tender!.qtyKg} h={30} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{tr('After', 'Sonra')}</span>
                  <Weave
                    parts={[...weaveParts(order.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined' && a.status !== 'offered'), s.farmers), { key: 'new', kg: cand.qtyKg, color: f(cand.farmerId)!.color }]}
                    total={tender!.qtyKg} h={30} animate
                  />
                </div>
              </div>
              <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 18px', background: '#fff', borderRadius: 2, boxShadow: '0 0 0 1.5px var(--olive)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Thread color={f(cand.farmerId)!.color} h={34} />
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{f(cand.farmerId)!.name}</div>
                    <div className="muted num" style={{ fontSize: 13 }}>{f(cand.farmerId)!.village} · {cand.qtyKg} {tr('kg', 'kq')} · {tracksRipeness(tender?.product ?? 'Tomato') ? <>{tr('stage', 'mərhələ')} {Math.round(s.listings.find((l) => l.id === cand.listingId)?.ripeness ?? 4)} · </> : null}{cand.priceAzn.toFixed(2)} ₼/{tr('kg', 'kq')} · ★ {f(cand.farmerId)!.rating}</div>
                  </div>
                </div>
                <div className="note" style={{ fontSize: 16 }}>{loc(cand.why, cand.whyAz)}</div>
              </div>
              <div className="num" style={{ display: 'flex', flexDirection: 'column', fontSize: 15 }}>
                <Impact k={tr('Coverage', 'Əhatə')} before={`${tender!.qtyKg - rec.shortfallKg}`} after={`${tender!.qtyKg} ${tr('kg', 'kq')}`} bad />
                <Impact k={tr('Delivered cost', 'Çatdırılma ilə qiymət')} before={rec.before.perKg.toFixed(2)} after={`${cand.costs!.perKg.toFixed(2)} ₼/${tr('kg', 'kq')}`} />
                <Impact k={tr('Arrival', 'Çatma')} before="" after={tr('Unchanged', 'Dəyişməyib')} last />
              </div>
              <button className="link" style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 500 }} onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                {showOthers
                  ? tr(`Hide the other ${rec.candidates.length - 1} farms`, `Digər ${rec.candidates.length - 1} təsərrüfatı gizlət`)
                  : tr(`Why not the other ${rec.candidates.length - 1} farms?`, `Niyə digər ${rec.candidates.length - 1} təsərrüfat yox?`)}
              </button>
              {showOthers && (
                <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                  {rec.candidates.filter((_, i) => i !== rec.selected).map((c) => (
                    <div key={c.listingId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{f(c.farmerId)!.name}</span>
                      <span className="note" style={{ textAlign: 'right' }}>{c.accepted ? tr(`Also possible, ${c.costs!.perKg.toFixed(2)} ₼/kg`, `Bu da mümkündür, ${c.costs!.perKg.toFixed(2)} ₼/kq`) : loc(c.why, c.whyAz)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rec.status === 'proposed' ? (
                  <button className="btn btn-indigo" style={{ height: 52 }} onClick={() => void act('approveRecovery', { orderId: order.id })}>{tr('Approve and send offer', 'Təsdiqlə və təklif göndər')}</button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '14px 0' }}>
                    <Medallion size={16} stroke="var(--olive)" dashed /> {tr(`Offer sent to ${f(cand.farmerId)!.name.split(' ')[0]} on WhatsApp. Waiting for a reply.`, `Təklif WhatsApp-da ${f(cand.farmerId)!.name.split(' ')[0]} adlı fermerə göndərildi. Cavab gözlənilir.`)}
                  </div>
                )}
                {rec.candidates.filter((c) => c.accepted).length > 1 && (
                  <button className="btn btn-ghost" onClick={() => {
                    const ok = rec.candidates.map((c, i) => (c.accepted ? i : -1)).filter((i) => i >= 0);
                    const next = ok[(ok.indexOf(rec.selected!) + 1) % ok.length];
                    void act('approveRecovery', { orderId: order.id, candidate: next });
                  }}>{tr('Choose another farmer', 'Başqa fermer seç')}</button>
                )}
              </div>
            </>
          )}

          {order && rec && rec.status === 'no_backup' && (
            <>
              <div className="eyebrow" style={{ color: 'var(--madder)' }}>{tr('No backup found', 'Ehtiyat tapılmadı')}</div>
              <h2 className="serif" style={{ fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>{tr(`${rec.shortfallKg} kg cannot be replaced in time`, `${rec.shortfallKg} kq vaxtında əvəz edilə bilmir`)}</h2>
              <div className="muted">{tr(`The buyer chooses on their order page: partial delivery of ${tender!.qtyKg - rec.shortfallKg} kg, or a full refund (simulated). New listings may fit later.`, `Alıcı sifariş səhifəsində seçir: ${tender!.qtyKg - rec.shortfallKg} kq qismən çatdırılma və ya tam geri ödəniş (simulyasiya). Yeni elanlar sonra uyğun gələ bilər.`)}</div>
              <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => void act('retryRecovery', { orderId: order.id })}>{tr('Search for a backup again', 'Ehtiyatı yenidən axtar')}</button>
            </>
          )}

          {order && (!rec || rec.status === 'resolved') && tender && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="eyebrow" style={{ color: rec?.status === 'resolved' ? 'var(--olive-ink)' : 'var(--indigo)' }}>{rec?.status === 'resolved' ? tr('Order repaired', 'Sifariş bərpa edildi') : `${tr('Order', 'Sifariş')} ${order.id}`}</div>
                <h2 className="serif" style={{ fontSize: 27, fontWeight: 600, lineHeight: 1.1 }}>
                  {(lang === 'az'
                    ? { offers_sent: 'Fermerlərə təkliflər göndərildi', confirmed: 'Təsdiqləndi, götürməyə hazırdır', picked_up: 'Yoldadır', delivered: 'Çatdı', settled: 'Bağlandı', cancelled: 'Alıcı tərəfindən ləğv edildi' }
                    : { offers_sent: 'Offers out to farmers', confirmed: 'Confirmed, ready for pickup', picked_up: 'On the road', delivered: 'Arrived', settled: 'Settled', cancelled: 'Cancelled by the buyer' })[order.status]}
                </h2>
                <div className="muted" style={{ fontSize: 14 }}>{buyer.name} · {order.partialKg ?? tender.qtyKg} {tr('kg', 'kq')} {tenderGoodsL(tender, lang)} · {tr('due', 'son tarix')} {bakuDayL(tender.deadline, lang)} {bakuTime(tender.deadline)}</div>
              </div>
              <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined'), s.farmers)} total={order.partialKg ?? tender.qtyKg} h={30} animate={rec?.status === 'resolved'} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {order.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined').map((a, i) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--hair2)' : undefined }}>
                    <Thread color={f(a.farmerId)!.color} h={26} />
                    <span style={{ flex: 1 }}>{f(a.farmerId)!.name}</span>
                    <span className="num muted" style={{ fontSize: 14 }}>{a.qtyKg} {tr('kg', 'kq')}</span>
                    <Medallion size={14} fill={a.status === 'offered' ? undefined : 'var(--olive)'} stroke={a.status === 'offered' ? 'var(--indigo)' : undefined} dashed={a.status === 'offered'} title={a.status === 'offered' ? tr('offered', 'təklif edilib') : a.status === 'accepted' ? tr('accepted', 'qəbul edilib') : a.status === 'picked_up' ? tr('picked up', 'götürülüb') : a.status} />
                  </div>
                ))}
              </div>
              <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15 }}>
                <Stat k={tr('Delivered cost', 'Çatdırılma ilə qiymət')} v={`${order.costs.perKg.toFixed(2)} ₼/${tr('kg', 'kq')}`} />
                <Stat k={tr('Escrow (simulated)', 'Əmanət hesabı (simulyasiya)')} v={`${azn(order.escrow.amount)} ${lang === 'az' ? ({ held: 'saxlanılır', released: 'ödənildi', refunded: 'geri qaytarıldı' } as const)[order.escrow.status] : order.escrow.status}`} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {order.status === 'confirmed' && (
                  <button className="btn btn-indigo" style={{ height: 52 }} onClick={() => void act('markPickedUp', { orderId: order.id })}>{tr('Driver picked up all lots', 'Sürücü bütün partiyaları götürdü')}</button>
                )}
                {order.status === 'offers_sent' && order.allocations.some((a) => a.status === 'accepted') && (
                  <button className="btn btn-ghost" onClick={() => { if (window.confirm(tr('Pick up only the farmers who accepted? Unanswered offers lapse.', 'Yalnız qəbul edən fermerlərdən götürülsün? Cavabsız təkliflər qüvvədən düşür.'))) void act('markPickedUp', { orderId: order.id }); }}>{tr('Pick up accepted lots only', 'Yalnız qəbul edilmiş partiyaları götür')}</button>
                )}
                {order.status === 'picked_up' && (
                  <button className="btn btn-indigo" style={{ height: 52 }} onClick={() => void act('markDelivered', { orderId: order.id })}>{tr(`Arrived at ${tender.destination}`, `${tender.destination} ünvanına çatdı`)}</button>
                )}
                {order.status === 'delivered' && <div className="muted" style={{ fontSize: 14 }}>{tr('Waiting for the buyer to confirm receipt and release payment.', 'Alıcının qəbulu təsdiqləməsi və ödənişi buraxması gözlənilir.')}</div>}
              </div>
            </>
          )}
          <Activity events={events} highlight={highlight?.id} title={order ? tr(`Activity on ${order.id}`, `${order.id} üzrə fəaliyyət`) : tr('Recent activity', 'Son fəaliyyət')} />
        </section>
      </div>
    </Shell>
  );
}

function Activity({ events, highlight, title }: { events: LedgerEvent[]; highlight?: string; title: string }) {
  const { t: tr, loc } = useLang();
  if (!events.length) return null;
  return (
    <div aria-label={tr('Activity', 'Fəaliyyət')} style={{ flex: '1 1 0', minHeight: 96, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
      <h3 className="eyebrow muted" style={{ fontSize: 11, marginBottom: 6, flex: 'none' }}>{title}</h3>
      <div className="scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {events.map((e) => {
        const t = TONE[e.tone];
        const hot = e.id === highlight;
        return (
          <div key={e.id} className={hot ? 'flash fade-up' : 'fade-up'} style={{ display: 'grid', gridTemplateColumns: '44px 1fr', gap: 10, padding: hot ? '10px 8px' : '7px 0', margin: hot ? '2px -8px' : 0, borderRadius: 2, boxShadow: hot ? 'inset 0 0 0 1px rgba(140,43,31,0.3)' : undefined }}>
            <span className="num muted" style={{ fontSize: 12, paddingTop: 2 }}>{bakuTime(e.at)}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: hot ? 600 : 500, lineHeight: 1.35 }}><span style={{ color: t.color, fontSize: 10, marginRight: 6 }} title={t.label(e, tr)}>●</span>{loc(e.title, e.titleAz)}</span>
              {e.quote && <span className="note" style={{ fontSize: 14 }}>“{loc(e.quote, e.quoteAz)}”</span>}
              {e.detail && <span className="muted" style={{ fontSize: 12 }}>{loc(e.detail, e.detailAz)}</span>}
            </span>
          </div>
        );
      })}
      </div>
    </div>
  );
}

/** Upcoming pickups and deliveries for every running order, soonest first. */
function Schedule({ s, onPick }: { s: NonNullable<ReturnType<typeof useLive>['s']>; onPick: (id: string) => void }) {
  const { lang, t: tr } = useLang();
  const now = appNow(s.clock).getTime();
  const items: { at: number; order: string; what: string; detail: string }[] = [];
  for (const o of s.orders) {
    const t = s.tenders.find((x) => x.id === o.tenderId);
    if (!t || ['delivered', 'settled', 'cancelled'].includes(o.status)) continue;
    const farms = o.allocations.filter((a) => a.status === 'accepted' || a.status === 'offered');
    if (o.status !== 'picked_up') {
      const at = Math.max(new Date(t.deadline).getTime() - 15 * 3600_000, now);
      const villages = farms.map((a) => s.farmers.find((f) => f.id === a.farmerId)?.village).join(', ');
      items.push({ at, order: o.id, what: tr('Pickup', 'Götürmə'), detail: tr(`${farms.length} farm${farms.length === 1 ? '' : 's'}: ${villages}`, `${farms.length} təsərrüfat: ${villages}`) });
    }
    items.push({ at: new Date(t.deadline).getTime(), order: o.id, what: tr('Delivery', 'Çatdırılma'), detail: tr(`${o.partialKg ?? t.qtyKg} kg to ${t.destination}`, `${o.partialKg ?? t.qtyKg} kq → ${t.destination}`) });
  }
  items.sort((a, b) => a.at - b.at);
  return (
    <div aria-label={tr('Schedule', 'Cədvəl')} style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--hair)', padding: '14px 20px 8px' }}>
      <h3 className="eyebrow muted" style={{ fontSize: 11, marginBottom: 6, flex: 'none' }}>{tr('Schedule', 'Cədvəl')}</h3>
      <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
        {items.length === 0 && <div className="muted" style={{ fontSize: 13 }}>{tr('No pickups or deliveries planned.', 'Planlaşdırılmış götürmə və ya çatdırılma yoxdur.')}</div>}
        {items.map((x, i) => {
          const iso = new Date(x.at).toISOString();
          return (
            <button key={i} onClick={() => onPick(x.order)} style={{ width: '100%', textAlign: 'left', border: 0, background: 'none', cursor: 'pointer', display: 'grid', gridTemplateColumns: '62px 1fr', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--hair2)' }}>
              <span className="num" style={{ fontSize: 12.5, lineHeight: 1.3 }}><b style={{ display: 'block' }}>{bakuTime(iso)}</b><span className="muted">{bakuDayL(iso, lang).split(' ')[0]}</span></span>
              <span style={{ fontSize: 13.5, lineHeight: 1.3 }}><b>{x.what}</b> · {x.order}<span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{x.detail}</span></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <b style={{ fontSize: 18 }}>{v}</b>
      <span className="muted" style={{ fontSize: 11.5 }}>{k}</span>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--hair2)' }}>
      <span className="muted">{k}</span><b>{v}</b>
    </div>
  );
}

function Impact({ k, before, after, bad, last }: { k: string; before: string; after: string; bad?: boolean; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: last ? undefined : '1px solid var(--hair2)' }}>
      <span className="muted">{k}</span>
      <span>{before && <><span style={{ color: bad ? 'var(--madder)' : undefined }}>{before}</span> → </>}<b>{after}</b></span>
    </div>
  );
}
