'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLang, type Lang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { azn, bakuDayL, bakuTime, Bar, Loom, RipeDot, stageNameL, tenderGoodsL, Thread, Weave } from '@/components/ui';
import { stageInfo, tracksRipeness } from '@/lib/ripeness';
import type { Proposal, Tender } from '@/lib/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const USE_AZ: Record<string, string> = { Kitchen: 'Mətbəx', 'Retail shelf': 'Pərakəndə rəf', Processing: 'Emal', Export: 'İxrac' };
/** "Kitchen" / "Mətbəx" */
const intendedUseL = (use: string, lang: Lang) => (lang === 'az' ? USE_AZ[use] ?? use : use);
/** "10 kg crates" / "10 kq-lıq yeşiklər" */
const packL = (p: string, lang: Lang) => (lang === 'az' ? p.replace(/^(\d+)\s*kg crates$/i, '$1 kq-lıq yeşiklər').replace(/\bkg\b/g, 'kq') : p);
const COUNT_AZ = ['', 'bir', 'iki', 'üç'];

export default function TenderPage({ params }: { params: { id: string } }) {
  const { s, act } = useLive();
  const { lang, t, loc } = useLang();
  const router = useRouter();
  const [animating, setAnimating] = useState(false);
  const [sel, setSel] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  const tender = s?.tenders.find((x) => x.id === params.id);

  useEffect(() => {
    if (tender?.status === 'ordered' && tender.orderId && !confirming) router.replace(`/buyer/orders/${tender.orderId}`);
  }, [tender?.status, tender?.orderId, confirming, router]);

  if (!s || !tender) return <Shell perspective="buyer" active="tenders"><div className="muted" style={{ padding: 48 }}>{t('Tender not found.', 'Tender tapılmadı.')}</div></Shell>;

  const proposals = tender.proposalIds.map((id) => s.proposals.find((p) => p.id === id)!).filter(Boolean);
  const checked = (tender as Tender & { checked?: number }).checked ?? s.listings.filter((l) => l.status === 'live').length;
  const selected = proposals.find((p) => p.id === sel) ?? proposals[0];
  const goods = tenderGoodsL(tender, lang);
  const use = intendedUseL(tender.intendedUse, lang);

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
  const variety = /^any$/i.test(tender.variety) ? t('Any variety', 'İstənilən növ') : tender.variety;

  return (
    <Shell perspective="buyer" active="tenders">
      <div className="page">
        {tender.status === 'cancelled' && (
          <div className="card" style={{ padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="eyebrow muted">Tender {tender.id} · {t('Cancelled', 'Ləğv edildi')}</div>
            <h1 className="serif" style={{ fontSize: 34, fontWeight: 600 }}>{t(`${tender.qtyKg} kg of ${goods}`, `${tender.qtyKg} kq ${goods}`)}</h1>
            <div className="muted">{t('This tender was cancelled. Post a new one from Tenders.', 'Bu tender ləğv edildi. «Tenderlər» bölməsindən yenisini dərc edin.')}</div>
          </div>
        )}

        {(tender.status === 'open' || tender.status === 'draft') && !animating && (
          <div className="fade-up fill" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="eyebrow" style={{ color: 'var(--madder)' }}>Tender {tender.id} · {tender.status === 'draft' ? t('Draft', 'Qaralama') : t('Open', 'Açıq')}</div>
              <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                {t(`${tender.qtyKg} kg of ${goods} for your ${use.toLowerCase()}`, `${tender.qtyKg} kq ${goods}, ${use.toLocaleLowerCase('az')} üçün`)}
              </h1>
            </div>
            <Spec t={tender} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" style={{ height: 50, padding: '0 30px', fontSize: 16 }} onClick={find}>{t('Find supply', 'Təchizat tap')}</button>
              <span className="note" style={{ fontSize: 16 }}>{t(`BƏRƏKƏT will check ${live} live listings and combine farms where needed.`, `BƏRƏKƏT ${live} aktiv elanı yoxlayacaq və lazım olduqda təsərrüfatları birləşdirəcək.`)}</span>
              <button className="link muted" style={{ marginLeft: 'auto', fontSize: 14 }} onClick={() => { if (window.confirm(t(`Cancel tender ${tender.id}?`, `${tender.id} tenderi ləğv edilsin?`))) void act('cancelTender', { tenderId: tender.id }); }}>{t('Cancel tender', 'Tenderi ləğv et')}</button>
            </div>
            <Lots tender={tender} s={s} title={t('Lots on the market that fit this tender', 'Bazarda bu tenderə uyğun partiyalar')} />
          </div>
        )}

        {(animating || tender.status === 'matching') && (
          <div className="card" style={{ padding: 24 }}>
            <Loom label={t(`Weaving your order from ${live} live listings…`, `Sifarişiniz ${live} aktiv elandan toxunur…`)} />
          </div>
        )}

        {tender.status === 'proposals' && !animating && !selected && (
          <NoSupply tender={tender} s={s} onRetry={find} />
        )}

        {tender.status === 'proposals' && !animating && selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flex: 'none' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div className="eyebrow" style={{ color: 'var(--madder)' }}>Tender {tender.id} · {t(`${proposals.length} proposal${proposals.length === 1 ? '' : 's'}`, `${proposals.length} variant`)}</div>
                <h1 className="serif" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
                  {t(`${['', 'One way', 'Two ways', 'Three ways'][proposals.length] ?? `${proposals.length} ways`} to fill your ${tender.qtyKg} kg of ${goods}`,
                    `${tender.qtyKg} kq ${goods} üçün ${COUNT_AZ[proposals.length] ?? proposals.length} variant`)}
                </h1>
                <div className="muted" style={{ fontSize: 14 }}>
                  {t(`${variety}, Grade ${tender.grade} · ${use} use within ${tender.useWithinDays} days · ${tender.destination} by ${bakuDayL(tender.deadline, lang)}, ${bakuTime(tender.deadline)} · checked ${checked} listings`,
                    `${variety}, Sort ${tender.grade} · ${use}, ${tender.useWithinDays} gün ərzində istifadə · ${tender.destination}, son tarix ${bakuDayL(tender.deadline, lang)}, ${bakuTime(tender.deadline)} · ${checked} elan yoxlanıldı`)}
                </div>
              </div>
              <span style={{ display: 'flex', gap: 18, flex: 'none', paddingBottom: 2 }}>
                <button className="link" onClick={find}>{t('Search again', 'Yenidən axtar')}</button>
                <button className="link" onClick={() => setShowSpec((v) => !v)} aria-expanded={showSpec}>{showSpec ? t('Hide tender', 'Tenderi gizlət') : t('View tender', 'Tenderə bax')}</button>
              </span>
            </div>
            {showSpec && <Spec t={tender} />}

            <div className="page-cols" style={{ gridTemplateColumns: 'minmax(250px, 300px) minmax(0, 1fr)' }}>
            <div role="list" aria-label={t('Options', 'Variantlar')} style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 10, minHeight: 0 }}>
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
                      animationDelay: `${i * 140}ms`, position: 'relative', textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 3, padding: '18px 20px 16px',
                      display: 'flex', flexDirection: 'column', gap: 9, flex: proposals.length > 1 ? '1 1 0' : undefined, justifyContent: 'center', background: on ? 'var(--paper)' : 'transparent',
                      boxShadow: on ? '0 0 0 1.5px var(--soot), 0 16px 30px -24px rgba(60,40,20,0.6)' : '0 0 0 1px var(--line)',
                    }}
                  >
                    {p.recommended && <span className="eyebrow" style={{ position: 'absolute', top: -11, left: 22, background: 'var(--madder)', color: 'var(--paper)', fontSize: 11, padding: '4px 10px', letterSpacing: '0.1em' }}>{t('Recommended', 'Tövsiyə olunur')}</span>}
                    <span className="serif" style={{ fontSize: 19, fontWeight: 600 }}>
                      <i style={{ fontWeight: 400, color: 'var(--madder)' }}>{p.numeral}.</i> {loc(p.title, p.titleAz)}
                      {noteMark >= 0 && <sup style={{ fontSize: 14, color: 'var(--madder)', fontStyle: 'normal', marginLeft: 4 }}>{noteMark + 1}</sup>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="serif num" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 0.95 }}>{p.costs.perKg.toFixed(2)}</span>
                      <span className="muted" style={{ fontSize: 14 }}>{t('₼/kg delivered', '₼/kq, çatdırılma ilə')}</span>
                    </span>
                    <Weave parts={p.allocations.map((a) => ({ key: a.id, kg: a.qtyKg, color: s.farmers.find((f) => f.id === a.farmerId)!.color }))} total={tender.qtyKg} animate />
                    <span style={{ fontSize: 14, fontWeight: p.warning ? 600 : 400, color: p.warning ? 'var(--madder)' : 'var(--ink2)' }}>{p.warning ? loc(p.arrivalSummary.replace('Red', 'Fully red'), p.arrivalSummaryAz) : loc(p.arrivalSummary, p.arrivalSummaryAz)}</span>
                  </button>
                );
              })}
            </div>
            <Detail p={selected} proposals={proposals} tender={tender} onConfirm={() => setConfirming(true)} />
            </div>
          </>
        )}
      </div>

      {confirming && selected && (
        <div role="dialog" aria-modal="true" aria-label={t('Confirm order', 'Sifarişi təsdiq et')} style={{ position: 'fixed', inset: 0, background: 'rgba(31,27,22,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }} onClick={() => setConfirming(false)}>
          <div className="card fade-up" onClick={(e) => e.stopPropagation()} style={{ width: 520, maxWidth: '92vw', padding: 32, display: 'flex', flexDirection: 'column', gap: 18 }}>
            <h2 className="serif" style={{ fontSize: 28, fontWeight: 600 }}>{t(`Confirm option ${selected.numeral}`, `${selected.numeral} variantını təsdiq edin`)}</h2>
            <div style={{ fontSize: 15, color: 'var(--ink2)' }}>
              {t(`${selected.allocations.length} farmers get a WhatsApp offer now. Your order is confirmed when all of them accept.`,
                `${selected.allocations.length} fermer indi WhatsApp-da təklif alır. Hamısı qəbul etdikdə sifarişiniz təsdiqlənir.`)}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '14px 0', borderTop: '1px solid var(--hair2)', borderBottom: '1px solid var(--hair2)' }}>
              <span>{t('Deposit into escrow', 'Əmanət hesabına depozit')}</span>
              <span className="serif num" style={{ fontSize: 28, fontWeight: 600 }}>{azn(selected.costs.total)}</span>
            </div>
            <div className="muted" style={{ fontSize: 13 }}>{t('Escrow is simulated in this demo. No real money moves.', 'Bu demoda əmanət hesabı simulyasiyadır. Real pul köçürülmür.')}</div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirming(false)}>{t('Back', 'Geri')}</button>
              <button className="btn btn-primary" onClick={() => confirm(selected)} autoFocus>{t('Confirm and send offers', 'Təsdiq et və təklifləri göndər')}</button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Spec({ t: tn }: { t: Tender }) {
  const { lang, t } = useLang();
  const kgU = t('kg', 'kq');
  const goods = tenderGoodsL(tn, lang);
  const goodsCap = lang === 'az' ? goods.replace(/^./, (c) => c.toLocaleUpperCase('az')) : goods.replace(/^./, (c) => c.toUpperCase());
  const use = intendedUseL(tn.intendedUse, lang);
  const rows: [string, string][] = [
    [t('Product', 'Məhsul'), `${goodsCap}, ${t('Grade', 'Sort')} ${tn.grade}${tn.grade > 1 ? t(' or better', ' və ya daha yaxşı') : ''}`],
    [t('Quantity', 'Miqdar'), t(`${tn.qtyKg} kg in ${tn.packaging}`, `${tn.qtyKg} kq, ${packL(tn.packaging, lang)}`)],
    [t('Intended use', 'İstifadə məqsədi'), t(`${use}, within ${tn.useWithinDays} days`, `${use}, ${tn.useWithinDays} gün ərzində`)],
    ...(tracksRipeness(tn.product) ? [[t('Ripeness on arrival', 'Çatanda yetişmə'), t(
      `Stage ${tn.ripenessMin} to ${tn.ripenessMax} (${stageInfo(tn.ripenessMin).name} to ${stageInfo(tn.ripenessMax).name.toLowerCase()})`,
      `Mərhələ ${tn.ripenessMin}–${tn.ripenessMax} (${stageNameL(tn.ripenessMin, 'az')} – ${stageNameL(tn.ripenessMax, 'az')})`,
    )] as [string, string]] : []),
    [t('Deliver to', 'Çatdırılma ünvanı'), tn.destination],
    [t('Deadline', 'Çatdırılma vaxtı'), `${bakuDayL(tn.deadline, lang)}, ${bakuTime(tn.deadline)}`],
    [t('Max delivered price', 'Çatdırılma ilə maksimum qiymət'), `${tn.maxPriceAzn.toFixed(2)} ₼/${kgU}`],
    [t('Price change tolerance', 'Qiymət dəyişikliyinə dözümlülük'), `${tn.priceTolerancePct ?? 2}%`],
  ];
  return (
    <section aria-label={t('Tender specification', 'Tender şərtləri')} className="card fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ padding: '16px 22px', boxShadow: 'inset -1px -1px 0 var(--hair2)' }}>
          <div className="muted" style={{ fontSize: 12 }}>{k}</div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{v}</div>
        </div>
      ))}
      {tracksRipeness(tn.product) && (
        <div style={{ gridColumn: '1 / -1', padding: '14px 22px', display: 'flex', gap: 10, alignItems: 'center' }}>
          <RipeDot stage={tn.ripenessMax} />
          <span className="note" style={{ fontSize: 15 }}>
            {t(`For ${use.toLowerCase()} use within ${tn.useWithinDays} days: stage ${tn.ripenessMin} to ${tn.ripenessMax} on arrival, ripe enough to use, firm enough to last.`,
              `${tn.useWithinDays} gün ərzində ${use.toLocaleLowerCase('az')} istifadəsi üçün: çatanda mərhələ ${tn.ripenessMin}–${tn.ripenessMax}, istifadəyə hazır, amma dayanacaq qədər bərk.`)}
          </span>
        </div>
      )}
    </section>
  );
}

function Detail({ p, proposals, tender, onConfirm }: { p: Proposal; proposals: Proposal[]; tender: Tender; onConfirm: () => void }) {
  const { s } = useLive();
  const { lang, t, loc } = useLang();
  const kgU = t('kg', 'kq');
  if (!s) return null;
  const rec = proposals.find((x) => x.recommended) ?? proposals[0];
  const notes = p.recommended ? p.reasons.slice(0, 2) : p.reasons;
  return (
    <section aria-label={t(`Option ${p.numeral} detail`, `${p.numeral} variantının təfərrüatı`)} className="card" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 330px)', minHeight: 0 }}>
      <div className="scroll" style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 600 }}>{t(`How option ${p.numeral} comes together`, `${p.numeral} variantı necə qurulur`)}</h2>
          <div className="muted" style={{ fontSize: 14 }}>
            {t(`${p.allocations.length} farm${p.allocations.length === 1 ? '' : 's'} · 1 van`, `${p.allocations.length} təsərrüfat · 1 furqon`)} · {p.costs.routeKm} km · {bakuDayL(tender.deadline, lang)} {bakuTime(tender.deadline)}
          </div>
        </div>
        <div role="table" aria-label={t('Supply allocation', 'Təchizat bölgüsü')} className="num" style={{ display: 'flex', flexDirection: 'column', fontSize: 15 }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 0.8fr 1.2fr', gap: 20, paddingBottom: 10, borderBottom: '1px solid var(--soot)' }} className="eyebrow muted">
            <span role="columnheader" style={{ fontSize: 11 }}>{t('Farmer', 'Fermer')}</span>
            <span role="columnheader" style={{ fontSize: 11 }}>{t('Share of order', 'Sifarişdəki payı')}</span>
            <span role="columnheader" style={{ fontSize: 11 }}>{t('Price/kg', 'Qiymət/kq')}</span>
            <span role="columnheader" style={{ fontSize: 11 }}>{tracksRipeness(tender.product) ? t('Today › arrival', 'Bu gün › çatanda') : t('Quality', 'Keyfiyyət')}</span>
          </div>
          {p.allocations.map((a, i) => {
            const f = s.farmers.find((x) => x.id === a.farmerId)!;
            const l = s.listings.find((x) => x.id === a.listingId);
            const mark = p.reasons.findIndex((r) => r.ref === a.id);
            return (
              <div role="row" key={a.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 2fr 0.8fr 1.2fr', gap: 20, alignItems: 'center', padding: '11px 0', borderBottom: i < p.allocations.length - 1 ? '1px solid var(--hair2)' : undefined }}>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }} title={t(`★ ${f.rating} over ${f.deals} deliveries`, `★ ${f.rating}, ${f.deals} çatdırılma üzrə`)}>
                  <Thread color={f.color} h={32} />
                  <span>
                    <b style={{ display: 'block' }}>{f.name}{p.recommended && mark >= 0 && <sup className="serif" style={{ color: 'var(--madder)', marginLeft: 3 }}>{mark + 1}</sup>}</b>
                    <span className="muted" style={{ fontSize: 13 }}>{f.village} · ★ {f.rating}</span>
                  </span>
                </span>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ flex: 1, minWidth: 0, display: 'flex' }}><Bar color={f.color} pct={(a.qtyKg / tender.qtyKg) * 100} animate /></span><span style={{ whiteSpace: 'nowrap' }}>{a.qtyKg} {kgU}</span></span>
                <span role="cell">{a.priceAzn.toFixed(2)} ₼</span>
                <span role="cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {!tracksRipeness(tender.product) ? <span className="muted">{t('Grade', 'Sort')} {l?.grade ?? '–'}{l?.photoUrl ? t(', photo checked', ', şəkil yoxlanılıb') : ''}</span> : <>
                  {l && <RipeDot stage={l.ripeness} />}<span className="muted">›</span><RipeDot stage={a.arrivalRipeness} />
                  <span style={{ color: a.arrivalRipeness > tender.ripenessMax + 0.5 || a.arrivalRipeness < tender.ripenessMin - 0.5 ? 'var(--madder)' : undefined, fontWeight: 600 }}>{t('Stage', 'Mərhələ')} {Math.round(a.arrivalRipeness)}</span></>}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, paddingTop: 20, borderTop: '1px solid var(--hair2)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="muted num" style={{ fontSize: 13 }}>{t('Produce', 'Məhsul')} {p.costs.produce.toFixed(2)} · {t('Transport', 'Daşınma')} {p.costs.transport.toFixed(2)} · {t('Fee', 'Haqq')} {p.costs.fee.toFixed(2)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span className="serif num" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>{azn(p.costs.total)}</span>
              <span className="muted" style={{ fontSize: 14 }}>{t('total delivered', 'cəmi, çatdırılma ilə')}</span>
            </div>
          </div>
          <button className="btn btn-primary" style={{ height: 50, padding: '0 28px' }} onClick={onConfirm}>{t(`Confirm option ${p.numeral}`, `${p.numeral} variantını təsdiq et`)}</button>
        </div>
      </div>
      <aside aria-label={t('Why', 'Niyə')} className="scroll" style={{ borderLeft: '1px solid var(--hair)', background: 'var(--paper2)', padding: '24px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <h3 className="eyebrow" style={{ fontSize: 11, color: 'var(--madder)' }}>{p.recommended ? t(`Why we recommend option ${p.numeral}`, `Niyə ${p.numeral} variantını tövsiyə edirik`) : t(`About option ${p.numeral}`, `${p.numeral} variantı haqqında`)}</h3>
        {notes.map((r, i) => (
          <div key={i} className="fade-up" style={{ animationDelay: `${300 + i * 200}ms`, display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, fontSize: 16, lineHeight: 1.42 }}>
            <span className="serif" style={{ fontWeight: 600, color: 'var(--madder)' }}>{i + 1}</span>
            <span className="note">{loc(r.text, r.textAz)}</span>
          </div>
        ))}
        {!p.recommended && (
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {t(`Recommended instead: option ${rec.numeral} at ${rec.costs.perKg.toFixed(2)} ₼/kg`, `Əvəzinə tövsiyə olunur: ${rec.numeral} variantı, ${rec.costs.perKg.toFixed(2)} ₼/kq`)}
          </div>
        )}
        <div style={{ marginTop: 'auto', fontSize: 12, lineHeight: 1.5 }} className="muted">
          {t('Quality is estimated from farmer photos and checked at pickup. Payment uses simulated escrow; no real money moves in this demo.',
            'Keyfiyyət fermerlərin şəkillərinə əsasən qiymətləndirilir və götürmə zamanı yoxlanılır. Ödəniş simulyasiya edilmiş əmanət hesabı ilə aparılır; bu demoda real pul köçürülmür.')}
        </div>
      </aside>
    </section>
  );
}

/** No combination fills the tender yet (usually: demo data off and the phones have not listed enough). */
function NoSupply({ tender, s, onRetry }: { tender: Tender; s: LiveS; onRetry: () => void }) {
  const { lang, t } = useLang();
  const total = fitting(tender, s).reduce((n, l) => n + l.qtyKg, 0);
  const goods = tenderGoodsL(tender, lang);
  const ripe = tracksRipeness(tender.product);
  const demoOff = s.settings.demoData === false;
  return (
    <div className="fade-up fill" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="eyebrow" style={{ color: 'var(--saffron)' }}>Tender {tender.id} · {total < tender.qtyKg ? t('Not enough supply yet', 'Hələ kifayət qədər təchizat yoxdur') : t('No combination fits yet', 'Hələ uyğun birləşmə yoxdur')}</div>
          <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, lineHeight: 1.1 }}>
            {total < tender.qtyKg
              ? t(`${total} of ${tender.qtyKg} kg of ${goods} ${total === 1 ? 'is' : 'are'} listed right now`, `Hazırda ${tender.qtyKg} kq ${goods} lazımdır, yalnız ${total} kq elan olunub`)
              : t(`${total} kg of ${goods} are listed, but no mix of up to 4 farms fits ${tender.qtyKg} kg`, `${total} kq ${goods} elan olunub, amma 4-ə qədər təsərrüfatın heç bir birləşməsi ${tender.qtyKg} kq tələbinə uyğun gəlmir`)}
          </h1>
        </div>
        <button className="btn btn-primary" onClick={onRetry}>{t('Search again', 'Yenidən axtar')}</button>
      </div>
      <div className="muted" style={{ fontSize: 14 }}>
        {t('Farmers list by sending a voice note and a photo on WhatsApp.', 'Fermerlər WhatsApp-da səsli mesaj və şəkil göndərərək elan verirlər.')}
        {ripe ? t(` Each lot needs a photo (ripeness) and must arrive at stage ${tender.ripenessMin}–${tender.ripenessMax}.`, ` Hər partiyanın şəkli olmalıdır (yetişmə üçün) və çatanda mərhələ ${tender.ripenessMin}–${tender.ripenessMax} aralığında olmalıdır.`) : ''}
        {t(' A farm sells at least 60% of a lot or all of it.', ' Təsərrüfat partiyanın ən azı 60%-ni və ya hamısını satır.')}
        {demoOff ? t(' Demo data is off: only listings from real phones count (D turns the seeded farms back on).', ' Demo məlumatlar söndürülüb: yalnız real telefonlardan gələn elanlar nəzərə alınır (D düyməsi nümunə təsərrüfatları yenidən açır).') : ''}
      </div>
      <Lots tender={tender} s={s} title={t('What is listed now', 'Hazırda elan olunanlar')} />
    </div>
  );
}

type LiveS = NonNullable<ReturnType<typeof useLive>['s']>;
const fitting = (tender: Tender, s: LiveS) =>
  s.listings.filter((l) => l.status === 'live' && l.product === tender.product && (/^any$/i.test(tender.variety) || l.variety.toLowerCase() === tender.variety.toLowerCase()) && l.grade <= tender.grade)
    .sort((a, b) => a.priceAzn - b.priceAzn);

/** The live lots a tender can draw on, filling the rest of the screen (scrolls inside when long). */
function Lots({ tender, s, title }: { tender: Tender; s: LiveS; title: string }) {
  const { lang, t } = useLang();
  const kgU = t('kg', 'kq');
  const lots = fitting(tender, s);
  const ripe = tracksRipeness(tender.product);
  const kg = lots.reduce((n, l) => n + l.qtyKg, 0);
  const farms = new Set(lots.map((l) => l.farmerId)).size;
  const better = tender.grade > 1 ? t(' or better', ' və ya daha yaxşı') : '';
  return (
    <section aria-label={title} className="card fill" style={{ display: 'flex', flexDirection: 'column', minHeight: 140 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 22px 8px', flex: 'none' }}>
        <span className="eyebrow" style={{ color: 'var(--olive-ink)', fontSize: 11 }}>{title}</span>
        <span className="muted num" style={{ fontSize: 13 }}>
          {t(`${lots.length} lots · ${kg.toLocaleString('en-US')} kg from ${farms} farms`, `${lots.length} partiya · ${farms} təsərrüfatdan ${kg.toLocaleString('en-US')} kq`)}
        </span>
      </div>
      <div className="scroll fill" style={{ padding: '0 22px 10px' }}>
        {lots.length === 0 && <div className="muted" style={{ fontSize: 14, padding: '6px 0' }}>
          {t(`No farmer has listed ${tenderGoodsL(tender, 'en')} at grade ${tender.grade}${better} yet.`, `Hələ heç bir fermer sort ${tender.grade}${better} ${tenderGoodsL(tender, 'az')} elan etməyib.`)}
        </div>}
        {lots.map((l) => {
          const f = s.farmers.find((x) => x.id === l.farmerId);
          return (
            <div key={l.id} className="num" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) 1fr 0.8fr 0.9fr 1.4fr', gap: 14, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--hair2)', fontSize: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{f && <Thread color={f.color} h={22} />}<b>{f?.name ?? l.farmerId}</b></span>
              <span className="muted">{f?.village}</span>
              <span>{l.qtyKg} {kgU}</span>
              <span>{l.priceAzn.toFixed(2)} ₼/{kgU}</span>
              <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {ripe && l.ripenessConfidence ? <><RipeDot stage={l.ripeness} /> {t('stage', 'mərhələ')} {l.ripeness}</> : ripe ? t('no photo yet: not matched', 'hələ şəkil yoxdur: uyğunlaşdırılmır') : null}
                {!ripe && `${l.variety}, ${t('grade', 'sort')} ${l.grade}`}
                {l.source === 'whatsapp' && <span className="chip" style={{ height: 20, fontSize: 10.5, marginLeft: 4 }}>{t('today', 'bu gün')}</span>}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
