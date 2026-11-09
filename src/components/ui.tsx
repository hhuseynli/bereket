'use client';
// The woven-commerce vocabulary: medallion (status, place), thread (one farmer), weave (an order),
// plus the wordmark and the carpet band.
import { STAGES, stageInfo } from '@/lib/ripeness';
import type { Allocation, Farmer } from '@/lib/types';

export const MEDALLION = '10,0 14,0 14,3 17,3 17,6 20,6 20,9 23,9 23,15 20,15 20,18 17,18 17,21 14,21 14,24 10,24 10,21 7,21 7,18 4,18 4,15 1,15 1,9 4,9 4,6 7,6 7,3 10,3';

export function Medallion({ size = 16, fill, stroke, inner, dot, dashed, title }: { size?: number; fill?: string; stroke?: string; inner?: string; dot?: string; dashed?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ flex: 'none' }}>
      <polygon points={MEDALLION} fill={fill ?? 'none'} stroke={stroke} strokeWidth={stroke ? 2 : 0} strokeDasharray={dashed ? '3 2' : undefined} />
      {inner && <polygon points="12,6 18,12 12,18 6,12" fill={inner} />}
      {dot && <circle cx="12" cy="12" r="3" fill={dot} />}
    </svg>
  );
}

export function Wordmark({ size = 21 }: { size?: number }) {
  return (
    <span className="serif" style={{ fontSize: size, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>
      B<span style={{ color: 'var(--madder)' }}>Ə</span>R<span style={{ color: 'var(--madder)' }}>Ə</span>K<span style={{ color: 'var(--madder)' }}>Ə</span>T
    </span>
  );
}

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points={MEDALLION} fill="#8C2B1F" />
      <polygon points="12,5 19,12 12,19 5,12" fill="#FBF8F2" />
      <rect x="10.5" y="10.5" width="3" height="3" fill="#8C2B1F" />
    </svg>
  );
}

export function Band({ height = 10 }: { height?: number }) {
  return (
    <svg width="100%" height={height} aria-hidden="true" style={{ display: 'block', flex: 'none' }}>
      <defs>
        <pattern id="band" width={height * 2} height={height} patternUnits="userSpaceOnUse">
          <rect width={height * 2} height={height} fill="#8C2B1F" />
          <g transform={`translate(${height * 0.6},${height * 0.1}) scale(${(height * 0.8) / 24})`}>
            <polygon points={MEDALLION} fill="#263B6E" />
            <polygon points="12,6 18,12 12,18 6,12" fill="#E8DCC4" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height={height} fill="url(#band)" />
    </svg>
  );
}

const WOVEN = (color: string) =>
  `repeating-linear-gradient(90deg, rgba(251,248,242,0) 0 5px, rgba(251,248,242,0.38) 5px 6px), repeating-linear-gradient(0deg, rgba(31,27,22,0.12) 0 1px, rgba(31,27,22,0) 1px 4px), ${color}`;

export function Thread({ color, w = 6, h = 30 }: { color: string; w?: number; h?: number }) {
  return <span aria-hidden="true" style={{ display: 'inline-block', flex: 'none', width: w, height: h, background: `repeating-linear-gradient(0deg, rgba(251,248,242,0) 0 4px, rgba(251,248,242,0.4) 4px 5px), ${color}` }} />;
}

export function Bar({ color, pct, h = 10, animate }: { color: string; pct: number; h?: number; animate?: boolean }) {
  return <span className={animate ? 'weave-in' : undefined} style={{ display: 'block', flex: 'none', width: `${pct}%`, height: h, background: WOVEN(color) }} />;
}

/** An order as a weave: one band per farmer, widths = real quantities. Gaps (cancelled, not yet refilled) are hatched. */
export function Weave({ parts, total, h = 12, animate }: { parts: { color: string; kg: number; gap?: boolean; key: string }[]; total: number; h?: number; animate?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 2, height: h, width: '100%' }} role="img" aria-label={parts.map((p) => `${p.kg} kg${p.gap ? ' missing' : ''}`).join(', ')}>
      {parts.map((p, i) => (
        <div
          key={p.key}
          className={animate ? 'weave-in' : undefined}
          style={{
            width: `${(p.kg / total) * 100}%`,
            animationDelay: animate ? `${i * 120}ms` : undefined,
            background: p.gap ? 'repeating-linear-gradient(135deg, rgba(140,43,31,0.32) 0 1px, rgba(140,43,31,0) 1px 6px)' : WOVEN(p.color),
            boxShadow: p.gap ? 'inset 0 0 0 1.5px var(--madder)' : undefined,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--madder)',
          }}
        >
          {p.gap && h >= 24 ? `−${p.kg}` : null}
        </div>
      ))}
    </div>
  );
}

export function weaveParts(allocs: Allocation[], farmers: Farmer[], showGaps = true) {
  return allocs
    .filter((a) => showGaps || (a.status !== 'cancelled' && a.status !== 'declined'))
    .map((a) => ({ key: a.id, kg: a.qtyKg, color: farmers.find((f) => f.id === a.farmerId)?.color ?? '#999', gap: a.status === 'cancelled' || a.status === 'declined' }));
}

export function RipeDot({ stage, size = 16 }: { stage: number; size?: number }) {
  const s = stageInfo(stage);
  return <Medallion size={size} fill={s.color} title={`Stage ${s.n}, ${s.name}`} />;
}

export function RipenessScale({ stage, wanted }: { stage: number; wanted?: [number, number] }) {
  const cur = Math.round(stage);
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      {STAGES.map((st) => {
        const on = st.n === cur;
        const inWant = wanted && st.n >= wanted[0] && st.n <= wanted[1];
        return (
          <div key={st.n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: on ? 1 : 0.38 }}>
            <Medallion size={on ? 30 : 22} fill={st.color} />
            <span style={{ fontSize: 11, fontWeight: on ? 700 : 500, borderBottom: inWant ? '2px solid var(--soot)' : '2px solid transparent', whiteSpace: 'nowrap' }}>
              {st.n} {st.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export const azn = (n: number) => `${n.toFixed(2)} ₼`;
export const firstName = (f?: Farmer) => (f ? f.name.split(' ')[0] : '');
export const bakuTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Baku' });
export const bakuDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Baku' });

export function Stars({ value, onRate, size = 22 }: { value?: number; onRate?: (n: number) => void; size?: number }) {
  return (
    <div style={{ display: 'flex', gap: 2 }} role={onRate ? 'group' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => {
        const on = (value ?? 0) >= n;
        const icon = (
          <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <polygon points="12,2 15,9 22,9.5 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9.5 9,9" fill={on ? 'var(--saffron)' : 'none'} stroke={on ? 'var(--saffron)' : 'var(--line)'} strokeWidth="1.5" />
          </svg>
        );
        return onRate ? (
          <button key={n} onClick={() => onRate(n)} aria-label={`${n} stars`} style={{ background: 'none', border: 0, padding: 2, cursor: 'pointer', minWidth: 32, minHeight: 32 }}>{icon}</button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}

export function Loom({ label }: { label: string }) {
  const colors = ['#263B6E', '#8C2B1F', '#C08A2A', '#5C6B34', '#7A5638', '#4F6D8A'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, alignItems: 'center', padding: '48px 0' }}>
      <div style={{ width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }} aria-hidden="true">
        {colors.map((c, i) => (
          <div key={c} style={{ height: 10, background: WOVEN(c), animation: `threadSlide 1.6s ${i * 0.12}s cubic-bezier(.2,.7,.2,1) infinite alternate` }} />
        ))}
      </div>
      <div className="note" style={{ fontSize: 18 }}>{label}</div>
    </div>
  );
}

// ---------- Produce names ----------

/** Products a buyer can ask for (the farmers' assistant knows the same list in Azerbaijani). */
export const PRODUCTS = ['Tomato', 'Cucumber', 'Potato', 'Apple', 'Pear', 'Pepper', 'Onion', 'Cabbage', 'Carrot', 'Eggplant', 'Beans', 'Quince', 'Persimmon', 'Hazelnut', 'Walnut'];
const PLURAL: Record<string, string> = { Tomato: 'tomatoes', Potato: 'potatoes', Cabbage: 'cabbage', Beans: 'green beans' };

/** "tomatoes", "cucumbers" */
export const produceName = (product: string) => PLURAL[product] ?? (/s$/i.test(product) ? product.toLowerCase() : `${product.toLowerCase()}s`);

/** "Roma tomatoes", or "tomatoes" for any variety */
export const tenderGoods = (t: { product: string; variety: string }) => `${/^any$/i.test(t.variety) ? '' : `${t.variety} `}${produceName(t.product)}`;

/** The app's clock (the demo can move it), as the server keeps it. */
export const appNow = (clock: { base: string; startedAtMs: number }) => new Date(new Date(clock.base).getTime() + (Date.now() - clock.startedAtMs));

// ---------- Language-aware names (see components/lang.tsx) ----------

const PRODUCT_AZ: Record<string, [string, string]> = {
  Tomato: ['pomidor', 'pomidor'], Cucumber: ['xiyar', 'xiyar'], Potato: ['kartof', 'kartof'], Apple: ['alma', 'alma'], Pear: ['armud', 'armud'],
  Pepper: ['bibər', 'bibər'], Onion: ['soğan', 'soğan'], Cabbage: ['kələm', 'kələm'], Carrot: ['yerkökü', 'yerkökü'], Eggplant: ['badımcan', 'badımcan'],
  Beans: ['lobya', 'lobya'], Quince: ['heyva', 'heyva'], Persimmon: ['xurma', 'xurma'], Hazelnut: ['fındıq', 'fındıq'], Walnut: ['qoz', 'qoz'],
};

/** "tomatoes" / "pomidor" (Azerbaijani uses the singular for produce in bulk) */
export const produceNameL = (product: string, lang: 'en' | 'az') => (lang === 'az' ? PRODUCT_AZ[product]?.[1] ?? product.toLowerCase() : produceName(product));

/** The product name itself: "Tomato" / "Pomidor" */
export const productL = (product: string, lang: 'en' | 'az') => (lang === 'az' ? (PRODUCT_AZ[product]?.[0] ?? product).replace(/^./, (c) => c.toLocaleUpperCase('az')) : product);

/** "Roma tomatoes" / "Roma pomidor" */
export const tenderGoodsL = (t: { product: string; variety: string }, lang: 'en' | 'az') =>
  `${/^any$/i.test(t.variety) ? '' : `${lang === 'az' && t.variety === 'Local' ? 'yerli' : t.variety} `}${produceNameL(t.product, lang)}`;

const AZ_WEEKDAY = ['B.', 'B.e.', 'Ç.a.', 'Ç.', 'C.a.', 'C.', 'Ş.'];
const AZ_MONTH = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avq', 'sen', 'okt', 'noy', 'dek'];
/** "Tue 10 Nov" / "Ç.a. 10 noy" (Baku time) */
export const bakuDayL = (iso: string, lang: 'en' | 'az') => {
  if (lang !== 'az') return bakuDay(iso);
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Baku' }));
  return `${AZ_WEEKDAY[d.getDay()]} ${d.getDate()} ${AZ_MONTH[d.getMonth()]}`;
};

/** Ripeness stage name: "Light red" / "açıq qırmızı" */
export const stageNameL = (stage: number, lang: 'en' | 'az') => { const s = stageInfo(stage); return lang === 'az' ? s.az : s.name; };
