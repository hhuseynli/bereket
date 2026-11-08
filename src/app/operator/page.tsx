'use client';
import { useState } from 'react';
import { useLive } from '@/components/live';
import { RegionMap } from '@/components/RegionMap';
import { Shell } from '@/components/Shell';
import { azn, bakuTime, Loom, Medallion, Thread, Weave, weaveParts } from '@/components/ui';
import type { LedgerEvent, Order } from '@/lib/types';

const TONE: Record<LedgerEvent['tone'], { color: string; label: (e: LedgerEvent) => string }> = {
  alert: { color: 'var(--madder)', label: (e) => (e.type === 'cancel' ? 'Cancelled' : 'Attention') },
  ai: { color: 'var(--indigo)', label: (e) => (e.type === 'recovery' ? 'AI · Recovery' : 'AI') },
  good: { color: 'var(--olive-ink)', label: (e) => (e.type === 'rating' ? 'Rating' : e.type === 'escrow' ? 'Escrow · simulated' : 'Confirmed') },
  neutral: { color: 'var(--ink2)', label: (e) => ({ order: 'Order', offer: 'Offer', escrow: 'Escrow · simulated', delivery: 'Delivery', listing: 'Listing' } as Record<string, string>)[e.type] ?? 'Update' },
};

export default function Live() {
  const { s, act } = useLive();
  const [showOthers, setShowOthers] = useState(false);
  if (!s) return <Shell perspective="operator" active="live">{null}</Shell>;

  const order: Order | undefined = s.orders.find((o) => o.status !== 'settled') ?? s.orders[0];
  const rec = order?.recovery;
  const f = (id?: string) => s.farmers.find((x) => x.id === id);
  const buyer = s.buyers[0];
  const tender = order ? s.tenders.find((t) => t.id === order.tenderId) : undefined;
  const cand = rec && rec.selected !== undefined ? rec.candidates[rec.selected] : undefined;
  const active = rec && ['searching', 'proposed', 'offered'].includes(rec.status);

  // What the map shows
  let route = order?.route ?? [];
  if (rec && (rec.status === 'proposed' || rec.status === 'offered') && cand?.route) route = cand.route;
  if (rec && rec.status === 'searching') route = route.filter((r) => r.farmerId !== rec.cancelledFarmerId);
  const dim = rec ? rec.candidates.filter((c) => !c.accepted).map((c) => f(c.farmerId)!).filter(Boolean) : s.listings.filter((l) => l.status === 'live' && l.product === 'Tomato').map((l) => f(l.farmerId)!).filter((x) => !route.some((r) => r.farmerId === x.id));

  const events = s.events.slice(0, 7);
  const highlight = events.find((e) => e.tone === 'alert' && e.orderId === order?.id && active);

  return (
    <Shell perspective="operator" active="live">
      <div className="live-grid" style={{ height: '100%', minHeight: 640, display: 'grid' }}>
        {/* Ledger */}
        <section aria-label="Live ledger" className="scroll" style={{ borderRight: '1px solid var(--hair)', background: 'var(--paper)', padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>Live ledger</h2>
          {events.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Quiet so far. Events from WhatsApp, buyers and the AI appear here.</div>}
          {events.map((e) => {
            const t = TONE[e.tone];
            const hot = e.id === highlight?.id;
            return (
              <div key={e.id} className={hot ? 'flash fade-up' : 'fade-up'} style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: hot ? 14 : '14px 0', margin: hot ? '0 -8px' : 0, borderRadius: 2, boxShadow: hot ? 'inset 0 0 0 1px rgba(140,43,31,0.3)' : undefined, borderBottom: hot ? undefined : '1px solid var(--hair2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5 }}>
                  <span className="eyebrow" style={{ fontSize: 11, color: t.color }}>{t.label(e)}</span>
                  <span className="num muted">{bakuTime(e.at)}</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: hot ? 600 : 500, lineHeight: 1.35 }}>{e.title}</div>
                {e.quote && <div className="note" style={{ fontSize: 15 }}>“{e.quote}”</div>}
                {e.detail && <div className="muted" style={{ fontSize: 12.5 }}>{e.detail}</div>}
              </div>
            );
          })}
        </section>

        {/* Map */}
        <section aria-label="Pickup map" style={{ background: 'var(--paper2)', padding: 20, minHeight: 0, display: 'flex' }}>
          <RegionMap
            farmers={s.farmers}
            route={route}
            dest={{ lat: buyer.lat, lng: buyer.lng, label: 'Baku' }}
            cancelled={rec ? f(rec.cancelledFarmerId) : undefined}
            candidate={cand && rec && rec.status !== 'no_backup' ? f(cand.farmerId) : undefined}
            candidateConfirmed={rec?.status === 'resolved'}
            dim={dim}
            caption={order ? `Order ${order.id} · ${(rec?.status === 'proposed' || rec?.status === 'offered') && cand?.costs ? cand.costs.routeKm : order.costs.routeKm} km` : 'Northern pickup region'}
          />
        </section>

        {/* Context panel */}
        <section aria-label="Details" className="scroll" style={{ borderLeft: '1px solid var(--hair)', background: 'var(--paper)', padding: '26px 28px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {!order && (
            <>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>Operations</div>
              <h2 className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>No active orders</h2>
              <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 15 }}>
                <Stat k="Live listings" v={String(s.listings.filter((l) => l.status === 'live').length)} />
                <Stat k="Farmers" v={String(s.farmers.length)} />
                <Stat k="Open tenders" v={String(s.tenders.filter((t) => t.status === 'open' || t.status === 'proposals').length)} />
              </div>
            </>
          )}

          {order && rec && rec.status === 'searching' && (
            <>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>AI recovery</div>
              <h2 className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>Fill the {rec.shortfallKg} kg gap</h2>
              <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'offered'), s.farmers)} total={tender!.qtyKg} h={30} />
              <Loom label="Checking nearby farms…" />
            </>
          )}

          {order && rec && (rec.status === 'proposed' || rec.status === 'offered') && cand && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="eyebrow" style={{ color: 'var(--indigo)' }}>AI recovery proposal</div>
                <h2 className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>Fill the {rec.shortfallKg} kg gap</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 12, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 13 }}>Now</span>
                  <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'offered'), s.farmers)} total={tender!.qtyKg} h={30} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>After</span>
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
                    <div className="muted num" style={{ fontSize: 13 }}>{f(cand.farmerId)!.village} · {cand.qtyKg} kg · stage {Math.round(s.listings.find((l) => l.id === cand.listingId)?.ripeness ?? 4)} · {cand.priceAzn.toFixed(2)} ₼/kg · ★ {f(cand.farmerId)!.rating}</div>
                  </div>
                </div>
                <div className="note" style={{ fontSize: 16 }}>{cand.why}</div>
              </div>
              <div className="num" style={{ display: 'flex', flexDirection: 'column', fontSize: 15 }}>
                <Impact k="Coverage" before={`${tender!.qtyKg - rec.shortfallKg}`} after={`${tender!.qtyKg} kg`} bad />
                <Impact k="Delivered cost" before={rec.before.perKg.toFixed(2)} after={`${cand.costs!.perKg.toFixed(2)} ₼/kg`} />
                <Impact k="Arrival" before="" after="Unchanged" last />
              </div>
              <button className="link" style={{ alignSelf: 'flex-start', fontSize: 13, fontWeight: 500 }} onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                {showOthers ? 'Hide' : 'Why not'} the other {rec.candidates.length - 1} farms?
              </button>
              {showOthers && (
                <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
                  {rec.candidates.filter((_, i) => i !== rec.selected).map((c) => (
                    <div key={c.listingId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>{f(c.farmerId)!.name}</span>
                      <span className="note" style={{ textAlign: 'right' }}>{c.accepted ? `Also possible, ${c.costs!.perKg.toFixed(2)} ₼/kg` : c.why}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {rec.status === 'proposed' ? (
                  <button className="btn btn-indigo" style={{ height: 52 }} onClick={() => void act('approveRecovery', { orderId: order.id })}>Approve and send offer</button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '14px 0' }}>
                    <Medallion size={16} stroke="var(--olive)" dashed /> Offer sent to {f(cand.farmerId)!.name.split(' ')[0]} on WhatsApp. Waiting for a reply.
                  </div>
                )}
                {rec.candidates.filter((c) => c.accepted).length > 1 && (
                  <button className="btn btn-ghost" onClick={() => {
                    const ok = rec.candidates.map((c, i) => (c.accepted ? i : -1)).filter((i) => i >= 0);
                    const next = ok[(ok.indexOf(rec.selected!) + 1) % ok.length];
                    void act('approveRecovery', { orderId: order.id, candidate: next });
                  }}>Choose another farmer</button>
                )}
              </div>
            </>
          )}

          {order && rec && rec.status === 'no_backup' && (
            <>
              <div className="eyebrow" style={{ color: 'var(--madder)' }}>No backup found</div>
              <h2 className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>{rec.shortfallKg} kg cannot be replaced in time</h2>
              <div className="muted">The buyer chooses: partial delivery of {tender!.qtyKg - rec.shortfallKg} kg, a later date, or a full refund (simulated).</div>
            </>
          )}

          {order && (!rec || rec.status === 'resolved') && tender && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="eyebrow" style={{ color: rec?.status === 'resolved' ? 'var(--olive-ink)' : 'var(--indigo)' }}>{rec?.status === 'resolved' ? 'Order repaired' : `Order ${order.id}`}</div>
                <h2 className="serif" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.1 }}>
                  {{ offers_sent: 'Offers out to farmers', confirmed: 'Confirmed, pickup today', picked_up: 'On the road', delivered: 'Arrived in Baku', settled: 'Settled' }[order.status]}
                </h2>
                <div className="muted" style={{ fontSize: 14 }}>{buyer.name} · {tender.qtyKg} kg {tender.variety}</div>
              </div>
              <Weave parts={weaveParts(order.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined'), s.farmers)} total={tender.qtyKg} h={30} animate={rec?.status === 'resolved'} />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {order.allocations.filter((a) => a.status !== 'cancelled' && a.status !== 'declined').map((a, i) => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--hair2)' : undefined }}>
                    <Thread color={f(a.farmerId)!.color} h={26} />
                    <span style={{ flex: 1 }}>{f(a.farmerId)!.name}</span>
                    <span className="num muted" style={{ fontSize: 14 }}>{a.qtyKg} kg</span>
                    <Medallion size={14} fill={a.status === 'offered' ? undefined : 'var(--olive)'} stroke={a.status === 'offered' ? 'var(--indigo)' : undefined} dashed={a.status === 'offered'} title={a.status} />
                  </div>
                ))}
              </div>
              <div className="num" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 15 }}>
                <Stat k="Delivered cost" v={`${order.costs.perKg.toFixed(2)} ₼/kg`} />
                <Stat k="Escrow (simulated)" v={`${azn(order.escrow.amount)} ${order.escrow.status}`} />
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
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
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderBottom: last ? undefined : '1px solid var(--hair2)' }}>
      <span className="muted">{k}</span>
      <span>{before && <><span style={{ color: bad ? 'var(--madder)' : undefined }}>{before}</span> → </>}<b>{after}</b></span>
    </div>
  );
}
