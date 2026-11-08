'use client';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { azn, bakuDay, bakuTime, Medallion, Stars, Thread, Weave, weaveParts } from '@/components/ui';
import type { Allocation, Order } from '@/lib/types';

const ALLOC: Record<Allocation['status'], { label: string; color: string }> = {
  proposed: { label: 'Proposed', color: 'var(--muted)' },
  offered: { label: 'Offer sent', color: 'var(--indigo)' },
  accepted: { label: 'Accepted', color: 'var(--olive-ink)' },
  declined: { label: 'Declined', color: 'var(--madder)' },
  cancelled: { label: 'Dropped out', color: 'var(--madder)' },
  picked_up: { label: 'Picked up', color: 'var(--olive-ink)' },
};

function steps(o: Order) {
  const live = o.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined');
  const ok = live.filter((a) => a.status === 'accepted' || a.status === 'picked_up').length;
  const order = ['offers_sent', 'confirmed', 'picked_up', 'delivered', 'settled'];
  const idx = order.indexOf(o.status === 'delivered' ? 'delivered' : o.status);
  return [
    { label: 'Offers sent', done: true },
    { label: `Farmers confirmed ${ok}/${live.length}`, done: idx >= 1 },
    { label: 'Picked up', done: idx >= 3 },
    { label: 'Arrived in Baku', done: idx >= 3 },
    { label: 'Paid out (simulated)', done: idx >= 4 },
  ];
}

export default function OrderPage({ params }: { params: { id: string } }) {
  const { s, act } = useLive();
  const o = s?.orders.find((x) => x.id === params.id);
  if (!s || !o) return <Shell perspective="buyer" active="orders"><div className="muted" style={{ padding: 48 }}>Order not found.</div></Shell>;
  const t = s.tenders.find((x) => x.id === o.tenderId)!;
  const rec = o.recovery;
  const repairing = rec && ['searching', 'proposed', 'offered'].includes(rec.status);
  const offered = o.allocations.filter((a) => a.status === 'offered').length;
  const title = repairing
    ? 'A farmer dropped out. We are repairing your order.'
    : o.status === 'offers_sent' ? `Waiting for ${offered} farmer${offered === 1 ? '' : 's'} to accept`
    : o.status === 'confirmed' ? 'Your order is confirmed'
    : o.status === 'delivered' ? 'Your tomatoes have arrived'
    : 'Delivered and paid';
  const st = steps(o);
  const current = st.findIndex((x) => !x.done);
  const cancelled = rec ? s.farmers.find((f) => f.id === rec.cancelledFarmerId) : undefined;

  return (
    <Shell perspective="buyer" active="orders">
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 48px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="eyebrow" style={{ color: 'var(--madder)' }}>Order {o.id} · Tender {t.id}</div>
          <h1 className="serif" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.08 }}>{title}</h1>
          <div className="muted" style={{ fontSize: 15 }}>{t.qtyKg} kg {t.variety} tomatoes · arriving {bakuDay(t.deadline)}, {bakuTime(t.deadline)} · {t.destination}</div>
        </div>

        <ol aria-label="Order progress" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 0 }}>
          {st.map((x, i) => (
            <li key={x.label} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Medallion size={26} fill={x.done ? 'var(--olive)' : undefined} stroke={x.done ? undefined : i === current ? 'var(--soot)' : 'var(--line)'} inner={x.done ? 'var(--paper)' : undefined} dot={!x.done && i === current ? 'var(--soot)' : undefined} />
                {i < st.length - 1 && <div style={{ flex: 1, height: 0, borderTop: x.done && st[i + 1].done ? '2px solid var(--olive)' : '2px dashed var(--line)', margin: '0 8px' }} />}
              </div>
              <div style={{ fontSize: 14, fontWeight: i === current ? 700 : 500, color: x.done || i === current ? 'var(--soot)' : 'var(--muted)', paddingRight: 12 }}>{x.label}</div>
            </li>
          ))}
        </ol>

        {repairing && cancelled && (
          <div className="card flash" style={{ padding: '18px 22px', boxShadow: 'inset 0 0 0 1px rgba(140,43,31,0.35)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Medallion size={20} fill="var(--madder)" inner="var(--paper)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <b>{cancelled.name} can't deliver {rec!.shortfallKg} kg{rec!.cause ? ` (${rec!.cause.toLowerCase()})` : ''}.</b>
              <span className="muted">
                {rec!.status === 'searching' ? 'BƏRƏKƏT is checking nearby farms for a replacement.' : rec!.status === 'proposed' ? 'A replacement is found and waiting for our operations team.' : 'The replacement farmer has the offer on WhatsApp.'} Your arrival time is protected.
              </span>
            </div>
          </div>
        )}
        {!repairing && o.priceNotice && (
          <div className="card fade-up" style={{ padding: '18px 22px', boxShadow: 'inset 0 0 0 1px rgba(92,107,52,0.45)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <Medallion size={20} fill="var(--olive)" inner="var(--paper)" />
            <span>{o.priceNotice}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24, alignItems: 'start' }}>
          <section className="card" style={{ padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: 20 }} aria-label="Farmers in this order">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2 className="serif" style={{ fontSize: 22, fontWeight: 600 }}>Your supply</h2>
              <span className="muted" style={{ fontSize: 14 }}>{o.costs.routeKm} km pickup loop</span>
            </div>
            <Weave parts={weaveParts(o.allocations, s.farmers, !!repairing)} total={t.qtyKg} h={26} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {o.allocations.filter((a) => repairing || (a.status !== 'cancelled' && a.status !== 'declined')).map((a, i) => {
                const f = s.farmers.find((x) => x.id === a.farmerId)!;
                const stl = ALLOC[a.status];
                return (
                  <div key={a.id} className="fade-up" style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.8fr 1fr 1.2fr', gap: 16, alignItems: 'center', padding: '14px 0', borderTop: i ? '1px solid var(--hair2)' : undefined, opacity: a.status === 'cancelled' ? 0.6 : 1 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Thread color={f.color} h={30} />
                      <span><b style={{ display: 'block', textDecoration: a.status === 'cancelled' ? 'line-through' : undefined }}>{f.name}</b><span className="muted" style={{ fontSize: 13 }}>{f.village}</span></span>
                    </span>
                    <span className="num">{a.qtyKg} kg</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, color: stl.color, fontSize: 14 }}>
                      <Medallion size={14} fill={a.status === 'accepted' || a.status === 'picked_up' ? stl.color : undefined} stroke={a.status === 'accepted' || a.status === 'picked_up' ? undefined : stl.color} dashed={a.status === 'offered'} />
                      {stl.label}
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
            </div>
            {o.status === 'settled' && <div className="note" style={{ fontSize: 15 }}>Rate each farmer. Farmers rate you from WhatsApp too.</div>}
          </section>

          <aside className="card" style={{ padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 16 }} aria-label="Payment">
            <div className="eyebrow muted" style={{ fontSize: 11 }}>Escrow · simulated</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="serif num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>{azn(o.escrow.amount)}</span>
              <span className="muted">{o.escrow.status === 'held' ? 'held' : 'released to farmers'}</span>
            </div>
            <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
              <Row k="Produce" v={o.costs.produce} />
              <Row k="Transport" v={o.costs.transport} />
              <Row k="Platform fee" v={o.costs.fee} />
              <div className="rule" />
              <Row k="Per kg delivered" v={o.costs.perKg} suffix=" ₼/kg" bold />
            </div>
            {o.status === 'delivered' && (
              <button className="btn btn-primary" style={{ height: 52 }} onClick={() => void act('confirmReceipt', { orderId: o.id })}>Confirm receipt and release payment</button>
            )}
            <div className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>Demo funds only. No real money moves.</div>
          </aside>
        </div>
      </div>
    </Shell>
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
