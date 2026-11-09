'use client';
// Impact: what the platform did, computed live from real activity (judges' sign-ups included).
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useLang } from '@/components/lang';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { computeImpact, VAN_KG_CO2E_PER_KM } from '@/lib/impact';

export default function ImpactPage() {
  return <Suspense fallback={null}><Impact /></Suspense>;
}

const n0 = (x: number) => Math.round(x).toLocaleString('en-US');

function Impact() {
  const { s } = useLive();
  const { t } = useLang();
  const persp = useSearchParams().get('p') === 'buyer' ? 'buyer' : 'operator';
  if (!s) return <Shell perspective={persp} active="impact">{null}</Shell>;
  const m = computeImpact(s);
  const kg = t('kg', 'kq');

  const groups: { title: string; color: string; tiles: { big: string; label: string; note: string }[] }[] = [
    {
      title: t('Farmers', 'Fermerlər'), color: 'var(--indigo)',
      tiles: [
        { big: n0(m.farmers), label: t('farmers selling from their phone', 'telefonundan satan fermer'), note: t(`${m.signups} joined today from the QR · ${m.languages.az} in Azerbaijani, ${m.languages.en} in English`, `bu gün QR ilə ${m.signups} nəfər qoşulub · ${m.languages.az} azərbaycanca, ${m.languages.en} ingiliscə`) },
        { big: n0(m.voiceListings), label: t('listings made by voice, no forms', 'səslə, formasız yaradılmış elan'), note: m.avgListingSeconds ? t(`${m.avgListingSeconds.toFixed(0)} s on average from voice note to listing`, `səsli mesajdan elana orta hesabla ${m.avgListingSeconds.toFixed(0)} san`) : t('A voice note and a photo become a listing', 'Səsli mesaj və şəkil elana çevrilir') },
        { big: m.farmerShare ? `${Math.round(m.farmerShare * 100)}%` : '–', label: t('of what buyers pay goes to the farmers', 'alıcının ödədiyinin fermerlərə çatan payı'), note: t('The rest is transport and a 3% fee: no middlemen', 'Qalanı daşınma və 3% haqdır: vasitəçi yoxdur') },
        { big: `${n0(m.paidToFarmers)} ₼`, label: t('paid out to farmers', 'fermerlərə ödənilib'), note: t(`${n0(m.escrowHeld)} ₼ held safely for orders on the way (simulated escrow)`, `yolda olan sifarişlər üçün ${n0(m.escrowHeld)} ₼ saxlanılır (simulyasiya)`) },
      ],
    },
    {
      title: t('Buyers and logistics', 'Alıcılar və logistika'), color: 'var(--madder)',
      tiles: [
        { big: `${n0(m.orderedKg)} ${kg}`, label: t(`ordered in ${m.orders} order${m.orders === 1 ? '' : 's'}`, `${m.orders} sifarişdə`), note: m.farmsPerOrder ? t(`${m.farmsPerOrder.toFixed(1)} small farms woven into each order`, `hər sifarişə ${m.farmsPerOrder.toFixed(1)} kiçik təsərrüfat toxunub`) : t('Several small farms per order', 'Hər sifarişdə bir neçə təsərrüfat') },
        { big: n0(m.repairs), label: t('orders repaired when a farm dropped out', 'təsərrüfat çıxanda bərpa olunan sifariş'), note: t(`${n0(m.rescuedKg)} ${kg} replaced by a backup farm, arrival unchanged`, `${n0(m.rescuedKg)} ${kg} əvəzedici təsərrüfatdan, çatma vaxtı dəyişmədi`) },
        { big: `${n0(m.liveKg)} ${kg}`, label: t('on sale right now', 'hazırda satışda'), note: t(`${m.phoneListings} listings sent from phones today`, `bu gün telefonlardan ${m.phoneListings} elan`) },
        { big: n0(m.photosRejected), label: t('photos refused or held', 'rədd edilmiş və ya saxlanılmış şəkil'), note: t('Not produce, screens, spoiled or old produce never reach buyers', 'Məhsul olmayan, ekran, xarab və ya köhnə məhsul alıcıya çatmır') },
      ],
    },
    {
      title: t('Waste and climate', 'İsraf və iqlim'), color: 'var(--olive-ink)',
      tiles: [
        { big: `${n0(m.overripeAvoidedKg)} ${kg}`, label: t('overripe produce not shipped', 'göndərilməyən yetişib-keçmiş məhsul'), note: t('The cheaper option would have arrived too ripe to use; buyers took the one that arrives right', 'Ucuz variant çox yetişmiş çatardı; alıcı vaxtında yetişəni seçdi') },
        { big: `${n0(Math.max(0, m.separateKm - m.pooledKm))} km`, label: t('driving saved by one shared van', 'ortaq furqonla qənaət edilən yol'), note: t(`${n0(m.pooledKm)} km pooled instead of ${n0(m.separateKm)} km if every farm drove to the buyer`, `hər təsərrüfat ayrıca getsəydi ${n0(m.separateKm)} km, birgə ${n0(m.pooledKm)} km`) },
        { big: `${n0(m.co2SavedKg)} kg`, label: t('CO₂e avoided', 'qarşısı alınan CO₂e'), note: t(`${VAN_KG_CO2E_PER_KM} kg CO₂e per van-km (UK DESNZ 2024 conversion factors, average van ≤ 3.5 t)`, `furqon-km üçün ${VAN_KG_CO2E_PER_KM} kq CO₂e (UK DESNZ 2024, orta furqon ≤ 3.5 t)`) },
        { big: `${n0(m.deliveredKg)} ${kg}`, label: t('delivered so far', 'indiyədək çatdırılıb'), note: t('Ripeness checked from photos, again at pickup', 'Yetişmə şəkildən, götürmədə yenidən yoxlanılır') },
      ],
    },
  ];

  return (
    <Shell perspective={persp} active="impact">
      <div className="page">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', flex: 'none' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="eyebrow" style={{ color: 'var(--olive-ink)' }}>{t('Live, from today’s activity', 'Canlı, bugünkü fəaliyyətdən')}</div>
            <h1 className="serif" style={{ fontSize: 38, fontWeight: 600, letterSpacing: '-0.02em' }}>{t('Impact', 'Təsir')}</h1>
          </div>
          <div className="muted" style={{ fontSize: 13.5, maxWidth: 560 }}>
            {t('Every number is counted from what happened on the platform, including your own sign-up. Nothing is estimated except the van emission factor, cited below.',
              'Hər rəqəm platformada baş verənlərdən, sizin qeydiyyatınız da daxil, sayılır. Furqonun emissiya əmsalından başqa heç nə təxmini deyil.')}
          </div>
        </div>
        <div className="fill" style={{ display: 'grid', gridTemplateRows: 'repeat(3, minmax(0, 1fr))', gap: 14, minHeight: 0 }}>
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} style={{ display: 'grid', gridTemplateColumns: '150px repeat(4, minmax(0, 1fr))', gap: 14, minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', borderLeft: `4px solid ${g.color}`, paddingLeft: 14 }}>
                <span className="serif" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>{g.title}</span>
              </div>
              {g.tiles.map((x) => (
                <div key={x.label} className="card fade-up" style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0, overflow: 'hidden' }}>
                  <span className="serif num" style={{ fontSize: 'clamp(26px, 4.2vh, 40px)', fontWeight: 600, letterSpacing: '-0.02em', color: g.color, lineHeight: 1.05 }}>{x.big}</span>
                  <span style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25 }}>{x.label}</span>
                  <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.35, marginTop: 'auto' }}>{x.note}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Shell>
  );
}
