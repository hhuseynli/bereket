'use client';
import Link from 'next/link';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { azn, Weave, weaveParts } from '@/components/ui';

const LABEL: Record<string, string> = { offers_sent: 'Waiting for farmers', confirmed: 'Confirmed', picked_up: 'Picked up', delivered: 'Arrived', settled: 'Settled' };

export default function Orders() {
  const { s } = useLive();
  return (
    <Shell perspective="buyer" active="orders">
      {s && (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <h1 className="serif" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em' }}>Orders</h1>
          {s.orders.length === 0 && <div className="card muted" style={{ padding: 32 }}>No orders yet. Confirm a proposal on a tender to create one.</div>}
          {s.orders.map((o) => {
            const t = s.tenders.find((x) => x.id === o.tenderId)!;
            return (
              <Link key={o.id} href={`/buyer/orders/${o.id}`} className="card" style={{ padding: '22px 26px', display: 'grid', gridTemplateColumns: '1fr 280px 140px', gap: 24, alignItems: 'center' }}>
                <span>
                  <span className="serif" style={{ fontSize: 21, fontWeight: 600, display: 'block' }}>{o.id} · {t.qtyKg} kg {t.variety}</span>
                  <span className="muted" style={{ fontSize: 14 }}>{LABEL[o.status]} · {azn(o.costs.total)} delivered</span>
                </span>
                <Weave parts={weaveParts(o.allocations, s.farmers)} total={t.qtyKg} />
                <span className="num" style={{ textAlign: 'right', fontWeight: 600 }}>{o.costs.perKg.toFixed(2)} ₼/kg</span>
              </Link>
            );
          })}
        </div>
      )}
    </Shell>
  );
}
