'use client';
import Link from 'next/link';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { bakuDay, bakuTime, Medallion } from '@/components/ui';

const STATUS: Record<string, { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'var(--muted)' },
  open: { label: 'Open', color: 'var(--indigo)' },
  matching: { label: 'Matching', color: 'var(--indigo)' },
  proposals: { label: 'Proposals ready', color: 'var(--madder)' },
  ordered: { label: 'Ordered', color: 'var(--olive-ink)' },
};

export default function Tenders() {
  const { s } = useLive();
  return (
    <Shell perspective="buyer" active="tenders">
      {s && (
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '44px 48px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="eyebrow" style={{ color: 'var(--madder)' }}>Nərgiz Kitchen Group</div>
              <h1 className="serif" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em' }}>Tenders</h1>
            </div>
            <button className="btn btn-ghost" disabled title="Tender builder comes after the demo">New tender</button>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            {s.tenders.map((t, i) => {
              const st = STATUS[t.status];
              const href = t.orderId ? `/buyer/orders/${t.orderId}` : `/buyer/tenders/${t.id}`;
              return (
                <Link key={t.id} href={href} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 160px 170px 24px', gap: 20, alignItems: 'center', padding: '22px 26px', borderTop: i ? '1px solid var(--hair2)' : undefined }}>
                  <span className="num muted" style={{ fontSize: 14 }}>{t.id}</span>
                  <span>
                    <span className="serif" style={{ fontSize: 21, fontWeight: 600, display: 'block' }}>{t.product === 'Tomato' ? 'Tomatoes' : `${t.product}s`}, {t.qtyKg} kg</span>
                    <span className="muted" style={{ fontSize: 14 }}>{t.variety}, Grade {t.grade} · {t.intendedUse}, within {t.useWithinDays} days · {t.destination}</span>
                  </span>
                  <span className="num" style={{ fontSize: 14 }}>{bakuDay(t.deadline)}, {bakuTime(t.deadline)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: st.color }}>
                    <Medallion size={14} stroke={st.color} inner={t.status === 'draft' ? undefined : st.color} />
                    {st.label}
                  </span>
                  <span aria-hidden="true" className="muted">›</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </Shell>
  );
}
