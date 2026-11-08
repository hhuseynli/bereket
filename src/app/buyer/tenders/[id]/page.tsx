'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { azn, bakuDay, bakuTime, Bar, Loom, RipeDot, Thread, Weave } from '@/components/ui';
import { stageInfo } from '@/lib/ripeness';
import type { Proposal, Tender } from '@/lib/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function TenderPage({ params }: { params: { id: string } }) {
  const { s, act } = useLive();
  const router = useRouter();
  const [animating, setAnimating] = useState(false);
  const [sel, setSel] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  const tender = s?.tenders.find((t) => t.id === params.id);

  useEffect(() => {
    if (tender?.status === 'ordered' && tender.orderId && !confirming) router.replace(`/buyer/orders/${tender.orderId}`);
  }, [tender?.status, tender?.orderId, confirming, router]);

  if (!s || !tender) return <Shell perspective="buyer" active="tenders"><div className="muted" style={{ padding: 48 }}>Tender not found.</div></Shell>;

  const proposals = tender.proposalIds.map((id) => s.proposals.find((p) => p.id === id)!).filter(Boolean);
  const checked = (tender as Tender & { checked?: number }).checked ?? s.listings.filter((l) => l.status === 'live').length;
  const selected = proposals.find((p) => p.id === sel) ?? proposals[0];

  const find = async () => {
    setAnimating(true);
    await Promise.all([act('findSupply', { tenderId: tender.id }), sleep(2600)]);
    setSel(undefined);
    setAnimating(false);
  };

  const confirm = async (p: Proposal) => {
    const r = await act('confirmProposal', { proposalId: p.id });
    setConfirming(false);
    if (r.orderId) router.push(`/buyer/orders/${r.orderId}`);
  };

  const live = s.listings.filter((l) => l.status === 'live').length;

  return (
    <Shell perspective="buyer" active="tenders">
      <div style={{ maxWidth: 1240, margin: '0 auto', padding: '40px 48px 48px', display: 'flex', flexDirection: 'column', gap: 30 }}>
        {(tender.status === 'open' || tender.status === 'draft') && !animating && (
          <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="eyebrow" style={{ color: 'var(--madder)' }}>Tender {tender.id} · Open</div>
              <h1 className="serif" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05 }}>{tender.qtyKg} kg of {tender.variety} tomatoes for your kitchen</h1>
            </div>
            <Spec t={tender} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" style={{ height: 52, padding: '0 30px', fontSize: 16 }} onClick={find} disabled={tender.status === 'draft'}>Find supply</button>
              <span className="note" style={{ fontSize: 16 }}>BƏRƏKƏT will check {live} live listings and combine farms where needed.</span>
            </div>
          </div>
        )}

        {(animating || tender.status === 'matching') && (
          <div className="card" style={{ padding: 24 }}>
            <Loom label={`Weaving your order from ${live} live listings…`} />
          </div>
        )}

        {tender.status === 'proposals' && !animating && selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 32, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="eyebrow" style={{ color: 'var(--madder)' }}>Tender {tender.id} · {proposals.length} proposals</div>
                <h1 className="serif" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                  {proposals.length === 1 ? 'One way' : `${['', 'One way', 'Two ways', 'Three ways'][proposals.length]}`} to fill your {tender.qtyKg} kg of tomatoes
                </h1>
                <div className="muted" style={{ fontSize: 15 }}>
                  {tender.variety}, Grade {tender.grade} · {tender.intendedUse} use within {tender.useWithinDays} days · Baku by {bakuDay(tender.deadline)}, {bakuTime(tender.deadline)} · checked {checked} listings
                </div>
              </div>
              <button className="link" onClick={() => setShowSpec((v) => !v)} aria-expanded={showSpec}>{showSpec ? 'Hide tender' : 'View tender'}</button>
            </div>
            {showSpec && <Spec t={tender} />}

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${proposals.length}, minmax(0, 1fr))`, gap: 20 }}>
              {proposals.map((p, i) => {
                const on = p.id === selected.id;
                const noteMark = proposals[0].reasons.findIndex((r) => r.ref === `option-${p.numeral}`);
                return (
                  <button
                    key={p.id}
                    onClick={() => setSel(p.id)}
                    aria-pressed={on}
                    className="fade-up"
                    style={{
                      animationDelay: `${i * 140}ms`, position: 'relative', textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 3, padding: '22px 24px',
                      display: 'flex', flexDirection: 'column', gap: 14, background: on ? 'var(--paper)' : 'transparent',
                      boxShadow: on ? '0 0 0 1.5px var(--soot), 0 16px 30px -24px rgba(60,40,20,0.6)' : '0 0 0 1px var(--line)',
                    }}
                  >
                    {p.recommended && <span className="eyebrow" style={{ position: 'absolute', top: -11, left: 22, background: 'var(--madder)', color: 'var(--paper)', fontSize: 11, padding: '4px 10px', letterSpacing: '0.1em' }}>Recommended</span>}
                    <span className="serif" style={{ fontSize: 20, fontWeight: 600 }}>
                      <i style={{ fontWeight: 400, color: 'var(--madder)' }}>{p.numeral}.</i> {p.title}
                      {noteMark >= 0 && <sup style={{ fontSize: 14, color: 'var(--madder)', fontStyle: 'normal', marginLeft: 4 }}>{noteMark + 1}</sup>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="serif num" style={{ fontSize: 48, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 0.95 }}>{p.costs.perKg.toFixed(2)}</span>
                      <span className="muted" style={{ fontSize: 14 }}>₼/kg delivered</span>
                    </span>
                    <Weave parts={p.allocations.map((a) => ({ key: a.id, kg: a.qtyKg, color: s.farmers.find((f) => f.id === a.farmerId)!.color }))} total={tender.qtyKg} animate />
                    <span style={{ fontSize: 14, fontWeight: p.warning ? 600 : 400, color: p.warning ? 'var(--madder)' : 'var(--ink2)' }}>{p.warning ? `${p.arrivalSummary.replace('Red', 'Fully red')}` : p.arrivalSummary}</span>
                  </button>
                );
              })}
            </div>

            <Detail p={selected} proposals={proposals} tender={tender} onConfirm={() => setConfirming(true)} />
          </>
        )}
      </div>

      {confirming && selected && (
        <div role="dialog" aria-modal="true" aria-label="Confirm order" style={{ position: 'fixed', inset: 0, background: 'rgba(31,27,22,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }} onClick={() => setConfirming(false)}>
          <div className="card fade-up" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '92vw', padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h2 className="serif" style={{ fontSize: 28, fontWeight: 600 }}>Confirm option {selected.numeral}</h2>
            <div style={{ fontSize: 15, color: 'var(--ink2)' }}>
              {selected.allocations.length} farmers get a WhatsApp offer now. Your order is confirmed when all of them accept.
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderTop: '1px solid var(--hair2)', borderBottom: '1px solid var(--hair2)' }}>
              <span>Deposit into escrow</span>
              <span className="serif num" style={{ fontSize: 28, fontWeight: 600 }}>{azn(selected.costs.total)}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>Escrow is simulated in this demo. No real money moves.</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>Back</button>
              <button className="btn btn-primary" onClick={() => confirm(selected)} autoFocus>Confirm and send offers</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Spec({ t }: { t: Tender }) {
  const rows: [string, string][] = [
    ['Product', `${t.variety} tomatoes, Grade ${t.grade}`],
    ['Quantity', `${t.qtyKg} kg in ${t.packaging}`],
    ['Intended use', `${t.intendedUse}, within ${t.useWithinDays} days`],
    ['Ripeness on arrival', `Stage ${t.ripenessMin} to ${t.ripenessMax} (${stageInfo(t.ripenessMin).name} to ${stageInfo(t.ripenessMax).name.toLowerCase()})`],
    ['Deliver to', t.destination],
    ['Deadline', `${bakuDay(t.deadline)}, ${bakuTime(t.deadline)}`],
    ['Max delivered price', `${t.maxPriceAzn.toFixed(2)} ₼/kg`],
    ['Price change tolerance', '2%'],
  ];
  return (
    <section aria-label="Tender specification" className="card fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ padding: '16px 22px', boxShadow: 'inset -1px -1px 0 var(--hair2)' }}>
          <div className="muted" style={{ fontSize: 12 }}>{k}</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{v}</div>
        </div>
      ))}
      <div style={{ gridColumn: '1 / -1', padding: '14px 22px', display: 'flex', gap: 10, alignItems: 'center' }}>
        <RipeDot stage={t.ripenessMax} />
        <span className="note" style={{ fontSize: 15 }}>For kitchen use within {t.useWithinDays} days, BƏRƏKƏT suggests stage {t.ripenessMin} to {t.ripenessMax} on arrival: ripe enough to cook, firm enough to last.</span>
      </div>
    </section>
  );
}

function Detail({ p, proposals, tender, onConfirm }: { p: Proposal; proposals: Proposal[]; tender: Tender; onConfirm: () => void }) {
  const { s } = useLive();
  if (!s) return null;
  const rec = proposals.find((x) => x.recommended) ?? proposals[0];
  const notes = p.recommended ? p.reasons.slice(0, 2) : p.reasons;
  return (
    <section aria-label={`Option ${p.numeral} detail`} className="card" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
      <div style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 600 }}>How option {p.numeral} comes together</h2>
          <div className="muted" style={{ fontSize: 14 }}>{p.allocations.length} farms · 1 van · {p.costs.routeKm} km · {bakuDay(tender.deadline)} {bakuTime(tender.deadline)}</div>
        </div>
        <div role="table" aria-label="Supply allocation" className="num" style={{ display: 'flex', flexDirection: 'column', fontSize: 15 }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 0.8fr 1.2fr', gap: 20, paddingBottom: 10, borderBottom: '1px solid var(--soot)' }} className="eyebrow muted">
            <span role="columnheader" style={{ fontSize: 11 }}>Farmer</span>
            <span role="columnheader" style={{ fontSize: 11 }}>Share of order</span>
            <span role="columnheader" style={{ fontSize: 11 }}>Price/kg</span>
            <span role="columnheader" style={{ fontSize: 11 }}>Today › arrival</span>
          </div>
          {p.allocations.map((a, i) => {
            const f = s.farmers.find((x) => x.id === a.farmerId)!;
            const l = s.listings.find((x) => x.id === a.listingId);
            const mark = p.reasons.findIndex((r) => r.ref === a.id);
            return (
              <div role="row" key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 0.8fr 1.2fr', gap: 20, alignItems: 'center', padding: '15px 0', borderBottom: i < p.allocations.length - 1 ? '1px solid var(--hair2)' : undefined }}>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }} title={`★ ${f.rating} over ${f.deals} deliveries`}>
                  <Thread color={f.color} h={32} />
                  <span>
                    <b style={{ display: 'block' }}>{f.name}{p.recommended && mark >= 0 && <sup className="serif" style={{ color: 'var(--madder)', marginLeft: 3 }}>{mark + 1}</sup>}</b>
                    <span className="muted" style={{ fontSize: 13 }}>{f.village} · ★ {f.rating}</span>
                  </span>
                </span>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Bar color={f.color} pct={(a.qtyKg / tender.qtyKg) * 100} animate />{a.qtyKg} kg</span>
                <span role="cell">{a.priceAzn.toFixed(2)} ₼</span>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {l && <RipeDot stage={l.ripeness} />}<span className="muted">›</span><RipeDot stage={a.arrivalRipeness} />
                  <span style={{ color: a.arrivalRipeness > tender.ripenessMax + 0.5 || a.arrivalRipeness < tender.ripenessMin - 0.5 ? 'var(--madder)' : undefined, fontWeight: 600 }}>Stage {Math.round(a.arrivalRipeness)}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingTop: 20, borderTop: '1px solid var(--hair2)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="muted num" style={{ fontSize: 13 }}>Produce {p.costs.produce.toFixed(2)} · Transport {p.costs.transport.toFixed(2)} · Fee {p.costs.fee.toFixed(2)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="serif num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>{azn(p.costs.total)}</span>
              <span className="muted" style={{ fontSize: 14 }}>total delivered</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ height: 50, padding: '0 28px' }} onClick={onConfirm}>Confirm option {p.numeral}</button>
        </div>
      </div>
      <aside aria-label="Why" style={{ borderLeft: '1px solid var(--hair)', background: 'var(--paper2)', padding: 28, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <h3 className="eyebrow" style={{ fontSize: 11, color: 'var(--madder)' }}>{p.recommended ? `Why we recommend option ${p.numeral}` : `About option ${p.numeral}`}</h3>
        {notes.map((r, i) => (
          <div key={i} className="fade-up" style={{ animationDelay: `${300 + i * 200}ms`, display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, fontSize: 17, lineHeight: 1.45 }}>
            <span className="serif" style={{ fontWeight: 600, color: 'var(--madder)' }}>{i + 1}</span>
            <span className="note">{r.text}</span>
          </div>
        ))}
        {!p.recommended && (
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            Recommended instead: option {rec.numeral} at {rec.costs.perKg.toFixed(2)} ₼/kg
          </div>
        )}
        <div style={{ marginTop: 'auto', fontSize: 12, lineHeight: 1.5 }} className="muted">
          Quality is estimated from farmer photos and checked at pickup. Payment uses simulated escrow; no real money moves in this demo.
        </div>
      </aside>
    </section>
  );
}
