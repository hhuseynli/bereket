'use client';
// Buyer: describe what the kitchen needs; BƏRƏKƏT then finds and combines farms for it.
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { useLang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { appNow, produceName, produceNameL, PRODUCTS, productL, RipeDot } from '@/components/ui';
import { STAGES, tracksRipeness } from '@/lib/ripeness';

const USES: { value: string; az: string }[] = [
  { value: 'Kitchen', az: 'Mətbəx' },
  { value: 'Retail shelf', az: 'Pərakəndə rəf' },
  { value: 'Processing', az: 'Emal' },
  { value: 'Export', az: 'İxrac' },
];
const DEFAULT_PACKAGING = '10 kg crates';
const DEFAULT_PACKAGING_AZ = '10 kq-lıq yeşiklər';

/** Arrival stage the buyer probably wants, from how soon they use the tomatoes. */
function suggestRipeness(days: number): [number, number] {
  if (days <= 1) return [5, 6];
  if (days <= 3) return [4, 5];
  if (days <= 5) return [3, 4];
  return [2, 3];
}

/** datetime-local value in Baku time */
function bakuLocal(d: Date) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baku', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export default function NewTenderPage() {
  return <Suspense fallback={null}><NewTender /></Suspense>;
}

function NewTender() {
  const { s, act } = useLive();
  const { lang, t } = useLang();
  const kgU = t('kg', 'kq');
  const router = useRouter();
  const preset = useSearchParams().get('product');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [f, setF] = useState(() => ({
    product: preset || 'Tomato', variety: '', grade: '1', qtyKg: '', packaging: DEFAULT_PACKAGING, intendedUse: 'Kitchen', useWithinDays: '3',
    ripenessMin: '4', ripenessMax: '5', maxPriceAzn: '', deadline: '', destination: '', priceTolerancePct: '2',
  }));
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const defaults = useMemo(() => {
    if (!s) return undefined;
    const now = appNow(s.clock);
    const next = new Date(now.getTime() + 86_400_000);
    const at9 = new Date(`${bakuLocal(next).slice(0, 10)}T09:00:00+04:00`);
    return { deadline: bakuLocal(at9), destination: s.buyers[0]?.address ?? '' };
  }, [s]);

  // What farmers list now for this product: varieties to choose from, a price hint and the supply on offer.
  const market = useMemo(() => {
    const lots = (s?.listings ?? []).filter((l) => l.status === 'live' && l.product === f.product);
    const varieties = [...new Set(lots.map((l) => l.variety))].sort();
    const fit = lots.filter((l) => (!f.variety || l.variety.toLowerCase() === f.variety.toLowerCase()) && l.grade <= Number(f.grade)).sort((a, b) => a.priceAzn - b.priceAzn);
    const prices = fit.map((l) => l.priceAzn);
    return { fit, varieties, kg: fit.reduce((n, l) => n + l.qtyKg, 0), farms: new Set(fit.map((l) => l.farmerId)).size, low: prices.length ? Math.min(...prices) : undefined, high: prices.length ? Math.max(...prices) : undefined };
  }, [s, f.product, f.variety, f.grade]);

  if (!s || !defaults) return <Shell perspective="buyer" active="tenders">{null}</Shell>;
  const ripe = tracksRipeness(f.product);
  const products = [...new Set([...PRODUCTS, ...s.listings.map((l) => l.product)])];
  // The default packaging is shown in the viewer's language; anything the buyer types is kept as typed.
  const packagingShown = lang === 'az' && f.packaging === DEFAULT_PACKAGING ? DEFAULT_PACKAGING_AZ : f.packaging;
  const goods = `${f.variety ? `${f.variety} ` : ''}${produceNameL(f.product, lang)}`;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const deadline = new Date(`${f.deadline || defaults.deadline}:00+04:00`).toISOString();
    const r = await act('createTender', { tender: { ...f, variety: f.variety || 'Any', deadline, destination: f.destination || defaults.destination } });
    setBusy(false);
    if (r.tenderId) router.push(`/buyer/tenders/${r.tenderId}`);
    else setError(String(r.error ?? t('Could not create the tender', 'Tender yaradıla bilmədi')));
  };

  return (
    <Shell perspective="buyer" active="tenders">
      <form onSubmit={submit} className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flex: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="eyebrow" style={{ color: 'var(--madder)' }}>{s.buyers[0]?.name} · {t('New tender', 'Yeni tender')}</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.08 }}>
            {f.qtyKg ? t(`${f.qtyKg} kg of `, `${f.qtyKg} kq `) : t('New tender: ', 'Yeni tender: ')}{goods}
          </h1>
        </div>
          <div style={{ display: 'flex', gap: 12, flex: 'none' }}>
            <button type="button" className="btn btn-ghost" onClick={() => router.push('/buyer')}>{t('Cancel', 'Ləğv et')}</button>
            <button className="btn btn-primary" style={{ padding: '0 30px' }} disabled={busy}>{busy ? t('Posting…', 'Dərc edilir…') : t('Post tender', 'Tenderi dərc et')}</button>
          </div>
        </div>

        <div className="page-cols" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 380px)' }}>
        <div className="scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
        <section className="card" style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
          <label className="field"><span>{t('Product', 'Məhsul')}</span>
            <select value={f.product} onChange={(e) => { set('product', e.target.value); set('variety', ''); }}>
              {products.map((p) => <option key={p} value={p}>{productL(p, lang)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('Variety', 'Növ')}</span>
            <input list="varieties" value={f.variety} placeholder={t('Any variety', 'İstənilən növ')} onChange={(e) => set('variety', e.target.value)} />
            <datalist id="varieties">{market.varieties.map((v) => <option key={v} value={v} />)}</datalist>
          </label>
          <label className="field"><span>{t('Grade (at least)', 'Sort (ən azı)')}</span>
            <select value={f.grade} onChange={(e) => set('grade', e.target.value)}>
              <option value="1">{t('Grade 1 (best)', 'Sort 1 (ən yaxşı)')}</option>
              <option value="2">{t('Grade 2 or better', 'Sort 2 və ya daha yaxşı')}</option>
              <option value="3">{t('Any grade', 'İstənilən sort')}</option>
            </select>
          </label>
          <label className="field"><span>{t('Quantity (kg)', 'Miqdar (kq)')}</span>
            <input type="number" min={1} step={1} required value={f.qtyKg} placeholder={t('e.g. 400', 'məs. 400')} onChange={(e) => set('qtyKg', e.target.value)} />
          </label>
          <label className="field"><span>{t('Packaging', 'Qablaşdırma')}</span>
            <input value={packagingShown} onChange={(e) => set('packaging', e.target.value)} />
          </label>
          <label className="field"><span>{t('Intended use', 'İstifadə məqsədi')}</span>
            <select value={f.intendedUse} onChange={(e) => set('intendedUse', e.target.value)}>{USES.map((u) => <option key={u.value} value={u.value}>{t(u.value, u.az)}</option>)}</select>
          </label>
          <label className="field"><span>{t('Used within (days)', 'İstifadə müddəti (gün)')}</span>
            <input type="number" min={1} max={30} value={f.useWithinDays} onChange={(e) => {
              set('useWithinDays', e.target.value);
              const [a, b] = suggestRipeness(Number(e.target.value) || 3);
              set('ripenessMin', String(a)); set('ripenessMax', String(b));
            }} />
          </label>
          {ripe && (
            <label className="field"><span>{t('Ripeness on arrival', 'Çatanda yetişmə')}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <select style={{ flex: 1, minWidth: 0 }} value={f.ripenessMin} onChange={(e) => set('ripenessMin', e.target.value)}>{STAGES.map((x) => <option key={x.n} value={x.n}>{x.n} {t(x.name, x.az)}</option>)}</select>
                <span>{t('to', '–')}</span>
                <select style={{ flex: 1, minWidth: 0 }} value={f.ripenessMax} onChange={(e) => set('ripenessMax', e.target.value)}>{STAGES.filter((x) => x.n >= Number(f.ripenessMin)).map((x) => <option key={x.n} value={x.n}>{x.n} {t(x.name, x.az)}</option>)}</select>
              </div>
              <small style={{ display: 'flex', gap: 6, alignItems: 'center' }}><RipeDot stage={Number(f.ripenessMax)} /> {t('Suggested from how soon you use them.', 'Nə qədər tez istifadə edəcəyinizə görə təklif olunur.')}</small>
            </label>
          )}
          <label className="field"><span>{t('Max delivered price (₼/kg)', 'Çatdırılma ilə maksimum qiymət (₼/kq)')}</span>
            <input type="number" min={0.01} step={0.01} required value={f.maxPriceAzn} placeholder={market.high ? (market.high * 1.25).toFixed(2) : t('e.g. 1.50', 'məs. 1.50')} onChange={(e) => set('maxPriceAzn', e.target.value)} />
            <small>
              {market.low !== undefined
                ? t(`Farm prices now ${market.low.toFixed(2)}–${market.high!.toFixed(2)} ₼/kg, before transport and fee`, `Hazırda təsərrüfat qiymətləri ${market.low.toFixed(2)}–${market.high!.toFixed(2)} ₼/kq, daşınma və haqq xaric`)
                : t('No live listings for this yet', 'Bunun üçün hələ aktiv elan yoxdur')}
            </small>
          </label>
          <label className="field"><span>{t('Price change tolerance (%)', 'Qiymət dəyişikliyinə dözümlülük (%)')}</span>
            <input type="number" min={0} max={20} step={0.5} value={f.priceTolerancePct} onChange={(e) => set('priceTolerancePct', e.target.value)} />
            <small>{t('How much a repaired order may cost more without asking you.', 'Bərpa olunmuş sifariş sizdən soruşmadan nə qədər baha ola bilər.')}</small>
          </label>
          <label className="field"><span>{t('Deliver by (Baku time)', 'Çatdırılma vaxtı (Bakı vaxtı)')}</span>
            <input type="datetime-local" required value={f.deadline || defaults.deadline} onChange={(e) => set('deadline', e.target.value)} />
          </label>
          <label className="field"><span>{t('Deliver to', 'Çatdırılma ünvanı')}</span>
            <input value={f.destination || defaults.destination} onChange={(e) => set('destination', e.target.value)} />
          </label>
        </section>

        {error && <div className="card" style={{ padding: '12px 16px', boxShadow: 'inset 0 0 0 1px var(--madder)', color: 'var(--madder)' }}>{error}</div>}
        <Estimate qty={Number(f.qtyKg) || 0} max={Number(f.maxPriceAzn) || 0} lots={market.fit} />
        </div>

        <aside aria-label={t('Matching lots', 'Uyğun partiyalar')} className="card" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '18px 20px 8px', flex: 'none' }}>
            <div className="eyebrow" style={{ color: 'var(--olive-ink)', fontSize: 11 }}>{t('Lots that fit, cheapest first', 'Uyğun partiyalar, ən ucuzdan başlayaraq')}</div>
            <div className="muted num" style={{ fontSize: 13, marginTop: 4 }}>
              {market.fit.length} {t('lots', 'partiya')} · {market.kg.toLocaleString('en-US')} {kgU}
              {f.qtyKg ? (() => { const pct = Math.min(100, Math.round((market.kg / Number(f.qtyKg)) * 100)); return t(` · ${pct}% of what you need`, ` · ehtiyacınızın ${pct}%-i`); })() : ''}
            </div>
          </div>
          <div className="scroll fill" style={{ padding: '0 20px 14px' }}>
            {market.fit.length === 0 && <div className="muted" style={{ fontSize: 14, paddingTop: 8 }}>
              {t(`Nothing yet for ${produceName(f.product)} at this grade. Post the tender anyway: you can search again when farmers list.`,
                `Bu sortda ${produceNameL(f.product, 'az')} üçün hələ heç nə yoxdur. Tenderi yenə də dərc edin: fermerlər elan verdikdə yenidən axtara bilərsiniz.`)}
            </div>}
            {market.fit.map((l) => {
              const fm = s.farmers.find((x) => x.id === l.farmerId);
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1px 10px', padding: '9px 0', borderBottom: '1px solid var(--hair2)', fontSize: 14 }}>
                  <b>{fm?.name ?? l.farmerId}</b>
                  <span className="num" style={{ fontWeight: 600 }}>{l.priceAzn.toFixed(2)} ₼/{kgU}</span>
                  <span className="muted" style={{ fontSize: 12.5 }}>{fm?.village} · {l.variety}, {t('grade', 'sort')} {l.grade}{ripe ? (l.ripenessConfidence ? ` · ${t('stage', 'mərhələ')} ${l.ripeness}` : t(' · no photo yet', ' · hələ şəkil yoxdur')) : ''}</span>
                  <span className="muted num" style={{ fontSize: 12.5 }}>{l.qtyKg} {kgU}</span>
                </div>
              );
            })}
          </div>
        </aside>
        </div>
      </form>
    </Shell>
  );
}

/** A rough delivered price from the cheapest lots on the market now, and what happens after posting. */
function Estimate({ qty, max, lots }: { qty: number; max: number; lots: { qtyKg: number; priceAzn: number; farmerId: string }[] }) {
  const { t } = useLang();
  let left = qty;
  let produce = 0;
  const farms = new Set<string>();
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(l.qtyKg, left);
    produce += take * l.priceAzn;
    left -= take;
    farms.add(l.farmerId);
  }
  const covered = qty > 0 && left <= 0;
  // Transport for a one-van loop in the region is about 0.10–0.20 ₼/kg; the platform fee is 3% of produce.
  const perKg = covered ? (produce * 1.03) / qty + 0.14 : undefined;
  return (
    <section aria-label={t('Estimate and next steps', 'Təxmini qiymət və növbəti addımlar')} className="card fill" style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)', gap: 28, minHeight: 150, alignContent: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="eyebrow muted" style={{ fontSize: 11 }}>{t('Estimate from today’s market', 'Bugünkü bazara görə təxmini')}</div>
        {perKg ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="serif num" style={{ fontSize: 34, fontWeight: 600 }}>≈ {perKg.toFixed(2)}</span>
              <span className="muted" style={{ fontSize: 14 }}>{t('₼/kg delivered', '₼/kq, çatdırılma ilə')}</span>
            </div>
            <div className="muted num" style={{ fontSize: 13.5 }}>
              {t(`≈ ${(perKg * qty).toFixed(0)} ₼ for ${qty} kg from about ${farms.size} farm${farms.size === 1 ? '' : 's'}.`,
                `≈ ${(perKg * qty).toFixed(0)} ₼, ${qty} kq üçün, təxminən ${farms.size} təsərrüfatdan.`)}
            </div>
            {max > 0 && <div style={{ fontSize: 13.5, fontWeight: 600, color: perKg > max ? 'var(--madder)' : 'var(--olive-ink)' }}>
              {perKg > max
                ? t(`Above your maximum of ${max.toFixed(2)} ₼/kg: few options will fit.`, `Maksimumunuz olan ${max.toFixed(2)} ₼/kq-dan yuxarıdır: az variant uyğun gələcək.`)
                : t(`Within your maximum of ${max.toFixed(2)} ₼/kg.`, `Maksimumunuz olan ${max.toFixed(2)} ₼/kq daxilindədir.`)}
            </div>}
          </>
        ) : (
          <div className="muted" style={{ fontSize: 14 }}>
            {qty > 0
              ? t(`Today's lots cover ${qty - Math.max(0, left)} of ${qty} kg. More farmers may list before your deadline.`, `Bugünkü partiyalar ${qty} kq-dan yalnız ${qty - Math.max(0, left)} kq-nı qarşılayır. Son tarixdən əvvəl daha çox fermer elan verə bilər.`)
              : t('Enter a quantity to see an estimated delivered price.', 'Çatdırılma ilə təxmini qiyməti görmək üçün miqdarı daxil edin.')}
          </div>
        )}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14, color: 'var(--ink2)' }}>
        <li><b>{t('Find supply', 'Təchizat tap')}</b>: {t('BƏRƏKƏT combines up to 4 farms, checks ripeness from their photos and plans one pickup loop.', 'BƏRƏKƏT 4-ə qədər təsərrüfatı birləşdirir, şəkillərinə görə yetişməni yoxlayır və bir götürmə marşrutu planlaşdırır.')}</li>
        <li><b>{t('You confirm an option', 'Variantı təsdiq edirsiniz')}</b>: {t('your deposit is held in escrow and the farmers get offers on WhatsApp.', 'depozitiniz əmanət hesabında saxlanılır, fermerlər isə WhatsApp-da təklif alır.')}</li>
        <li><b>{t('Pickup and delivery', 'Götürmə və çatdırılma')}</b>: {t('if a farmer drops out, a backup is found within your price tolerance.', 'fermer çıxarsa, qiymət dözümlülüyünüz daxilində ehtiyat fermer tapılır.')}</li>
        <li><b>{t('Confirm receipt', 'Qəbulu təsdiq edin')}</b>: {t('payment goes to the farmers; you rate each other.', 'ödəniş fermerlərə keçir; bir-birinizi qiymətləndirirsiniz.')}</li>
      </ol>
    </section>
  );
}
