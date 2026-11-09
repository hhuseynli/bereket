'use client';
import { useState } from 'react';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { useLang } from '@/components/lang';
import { bakuTime, Medallion, produceNameL, RipenessScale, Thread } from '@/components/ui';
import { tracksRipeness } from '@/lib/ripeness';
import type { AiRun, AiStep } from '@/lib/types';

const FIELD_LABEL: Record<string, [string, string]> = {
  product: ['Product', 'Məhsul'], variety: ['Variety', 'Növ'], qtyKg: ['Quantity (kg)', 'Miqdar (kq)'], priceAzn: ['Price (₼/kg)', 'Qiymət (₼/kq)'],
  grade: ['Grade', 'Sort'], harvest: ['Harvest', 'Yığım'], notes: ['Notes', 'Qeydlər'], photo: ['Photo', 'Foto'],
};
const MODE: Record<AiRun['mode'], [string, string]> = {
  live: ['Live AI', 'Canlı Sİ'],
  cached: ['Cached AI result (verified earlier)', 'Keşlənmiş Sİ nəticəsi (əvvəlcədən yoxlanılıb)'],
  simulated: ['Simulated (scripted)', 'Simulyasiya (ssenari üzrə)'],
  mixed: ['Mixed: live, cached or simulated per step', 'Qarışıq: hər addımda canlı, keş və ya simulyasiya'],
};
const STEP_MODE: Record<NonNullable<AiStep['mode']>, { label: [string, string]; color: string }> = {
  live: { label: ['LIVE', 'CANLI'], color: 'var(--olive-ink)' },
  cached: { label: ['CACHED', 'KEŞ'], color: 'var(--indigo)' },
  simulated: { label: ['SIMULATED', 'SİMULYASİYA'], color: 'var(--saffron)' },
};

export default function Intake() {
  const { s, act } = useLive();
  const { lang, t, loc } = useLang();
  const fl = (k: string) => (FIELD_LABEL[k] ? t(...FIELD_LABEL[k]) : k);
  const [sel, setSel] = useState<string | undefined>();
  if (!s) return <Shell perspective="operator" active="intake">{null}</Shell>;
  const runs = s.aiRuns;
  const run = runs.find((r) => r.id === sel) ?? runs[0];
  const f = run ? s.farmers.find((x) => x.id === run.farmerId) : undefined;
  const listing = run?.listingId ? s.listings.find((l) => l.id === run.listingId) : undefined;
  // The label follows the steps that have run so far, so it is right while the run is still going.
  const stepModes = run ? Array.from(new Set(run.steps.map((x) => x.mode).filter(Boolean))) : [];
  const modeLabel = !run ? '' : stepModes.length === 0 ? t('In progress', 'Davam edir') : t(...(stepModes.length === 1 ? MODE[stepModes[0]!] : MODE.mixed));

  return (
    <Shell perspective="operator" active="intake">
      <div style={{ height: '100%', minHeight: 640, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)' }}>
        <section aria-label={t('Incoming', 'Daxil olanlar')} style={{ borderRight: '1px solid var(--hair)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="scroll" style={{ flex: 1, minHeight: 0, padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>{t('Incoming', 'Daxil olanlar')}</h2>
          {runs.length === 0 && <div className="muted" style={{ fontSize: 14 }}>{t('Voice notes and photos from farmers appear here as the AI turns them into listings.', 'Fermerlərin səsli mesajları və fotoları Sİ onları elana çevirdikcə burada görünür.')}</div>}
          {runs.map((r) => {
            const rf = s.farmers.find((x) => x.id === r.farmerId)!;
            const on = r.id === run?.id;
            return (
              <button key={r.id} onClick={() => setSel(r.id)} aria-pressed={on} style={{ textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 2, padding: '12px 12px', margin: '0 -12px', background: on ? 'var(--paper2)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--hair)' : undefined, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Thread color={rf.color} h={30} />
                <span style={{ flex: 1 }}>
                  <b style={{ display: 'block' }}>{rf.name}</b>
                  <span className="muted num" style={{ fontSize: 13 }}>{bakuTime(r.startedAt)} · {r.status === 'running' ? t('Working…', 'İşlənir…') : r.status === 'needs_review' ? t('Needs review', 'Yoxlama tələb edir') : r.status === 'failed' ? t('Failed', 'Uğursuz oldu') : t('Listed', 'Elan edildi')}</span>
                </span>
                <Medallion size={14} fill={r.status === 'done' ? 'var(--olive)' : r.status === 'needs_review' ? 'var(--saffron)' : undefined} stroke={r.status === 'running' ? 'var(--indigo)' : r.status === 'failed' ? 'var(--madder)' : undefined} dashed={r.status === 'running'} />
              </button>
            );
          })}
          </div>
          <div className="num" style={{ flex: 'none', borderTop: '1px solid var(--hair)', padding: '12px 22px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {([[t('Needs review', 'Yoxlama tələb edir'), runs.filter((r) => r.status === 'needs_review').length], [t('Drafts', 'Qaralamalar'), s.listings.filter((l) => l.status === 'draft').length], [t('Live listings', 'Aktiv elanlar'), s.listings.filter((l) => l.status === 'live').length]] as const).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', flexDirection: 'column' }}><b style={{ fontSize: 18 }}>{v}</b><span className="muted" style={{ fontSize: 11.5 }}>{k}</span></div>
            ))}
          </div>
        </section>

        <section aria-label={t('AI listing pipeline', 'Sİ elan axını')} className="scroll" style={{ padding: '20px 34px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!run || !f ? (
            <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{t('AI intake', 'Sİ elan qəbulu')}</div>
              <h1 className="serif" style={{ fontSize: 36, fontWeight: 600 }}>{t('Waiting for a farmer', 'Fermer gözlənilir')}</h1>
              <div className="muted">{t('When a farmer sends a voice note and a photo on WhatsApp, you will see each step here: transcript, extracted fields, photo inspection, price check and the drafted listing.', 'Fermer WhatsApp-da səsli mesaj və foto göndərəndə hər addımı burada görəcəksiniz: transkript, çıxarılan sahələr, fotonun yoxlanması, qiymət yoxlaması və hazırlanmış elan.')}</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="eyebrow" style={{ color: 'var(--indigo)' }}>{t('AI intake', 'Sİ elan qəbulu')} · {modeLabel}</div>
                  <h1 className="serif" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.015em' }}>{f.name}, {f.village}</h1>
                  {listing && (
                    <div className="muted" style={{ fontSize: 14 }}>
                      {listing.qtyKg} {t('kg', 'kq')} {lang === 'az' ? produceNameL(listing.product, lang) : listing.product.toLowerCase()} · {lang === 'az'
                        ? `elan ${listing.status === 'live' ? 'alıcılar üçün aktivdir' : listing.status === 'draft' ? `WhatsApp-da təsdiq üçün ${f.name.split(' ')[0]} adlı fermerə göndərildi` : listing.status === 'reserved' ? 'sifariş üçün rezerv edilib' : ({ needs_review: 'yoxlama tələb edir', sold: 'satılıb', withdrawn: 'geri götürülüb', rejected: 'rədd edilib' } as Record<string, string>)[listing.status] ?? listing.status}`
                        : `listing ${listing.status === 'live' ? 'is live for buyers' : listing.status === 'draft' ? `sent to ${f.name.split(' ')[0]} to confirm on WhatsApp` : listing.status === 'reserved' ? 'reserved for an order' : listing.status}`}
                    </div>
                  )}
                </div>
                {run.status === 'needs_review' && listing && (listing.status === 'draft' || listing.status === 'needs_review') && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => void act('rejectListing', { listingId: listing.id })}>{t('Reject', 'Rədd et')}</button>
                    <button className="btn btn-indigo btn-sm" onClick={() => void act('approveListing', { listingId: listing.id })}>{t('Approve listing', 'Elanı təsdiqlə')}</button>
                  </div>
                )}
              </div>
              {run.note && <div className="card" style={{ padding: '14px 18px', boxShadow: 'inset 0 0 0 1px var(--saffron)' }}>{loc(run.note, run.noteAz)}</div>}
              {run.waitingFor && run.status !== 'failed' && (
                <div className="fade-up" data-waiting style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink2)' }}>
                  <span className="blink" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--indigo)', flex: 'none' }} />
                  {t(`Waiting for ${f.name.split(' ')[0]}`, `${f.name.split(' ')[0]} gözlənilir`)}: {loc(run.waitingFor, run.waitingForAz)}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 22, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                  <ol aria-label={t('Steps', 'Addımlar')} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                    {run.steps.map((st, i) => <Step key={st.key} st={st} last={i === run.steps.length - 1} />)}
                  </ol>
                  {/* What the farmer said, under the steps: the two columns stay about the same height. */}
                  {run.transcriptAz && (
                    <div className="card fade-up" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="eyebrow muted" style={{ fontSize: 11 }}>{t(`What ${f.name.split(' ')[0]} said · voice note`, `${f.name.split(' ')[0]} nə dedi · səsli mesaj`)}</div>
                      <div style={{ fontSize: 16 }}>“{run.transcriptAz}”</div>
                      {run.transcriptEn && lang === 'en' && <div className="note" style={{ fontSize: 15, color: 'var(--muted)' }}>{run.transcriptEn}</div>}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {run.photoUrl && (
                    <div className="card fade-up" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={run.photoUrl} alt={t("Farmer's produce photo", 'Fermerin məhsul fotosu')} style={{ width: '100%', height: 'clamp(100px, 19vh, 260px)', objectFit: 'cover', borderRadius: 2 }} />
                      {run.ripeness !== undefined && (
                        <>
                          {/* Ripeness stages are a tomato scale; other produce shows how fresh it looks. */}
                          {tracksRipeness(listing?.product ?? run.fields?.product?.value ?? 'Tomato') ? <RipenessScale stage={run.ripeness} /> : (
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                              <span className="chip" style={{ color: run.freshness === 'fresh' || !run.freshness ? 'var(--olive-ink)' : 'var(--madder)', boxShadow: `inset 0 0 0 1px ${run.freshness === 'fresh' || !run.freshness ? 'var(--olive)' : 'var(--madder)'}` }}>
                                {run.freshness === 'aging' ? t('Starting to age', 'Təzəliyini itirməyə başlayıb') : run.freshness === 'old' ? t('Looks old', 'Köhnə görünür') : t('Fresh', 'Təzə')}
                              </span>
                              {listing && <span className="muted">{t('Grade', 'Sort')} {listing.grade} {t('from the photo', 'fotoya görə')}</span>}
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: 13 }}>
                            {t(`Visual estimate from the photo, ${Math.round((run.ripenessConfidence ?? 0) * 100)}% confidence`, `Fotoya əsasən vizual qiymətləndirmə, ${Math.round((run.ripenessConfidence ?? 0) * 100)}% əminlik`)}
                            {run.defects?.length ? ` · ${run.defects.join(', ')}` : t(' · no visible defects', ' · görünən qüsur yoxdur')}
                            {t('. Not a food-safety certification; checked again by the driver at pickup.', '. Bu, qida təhlükəsizliyi sertifikatı deyil; götürmə zamanı sürücü yenidən yoxlayır.')}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {run.fields && Object.keys(run.fields).length > 0 && (
                    <div className="card fade-up" style={{ padding: '10px 20px' }}>
                      {Object.entries(run.fields).map(([k, v]) => (
                        <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px', gap: 12, alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--hair2)' }}>
                          <span className="muted" style={{ fontSize: 13 }}>{fl(k)}</span>
                          <b className="num">{v.value}</b>
                          <span title={t(`${Math.round(v.confidence * 100)}% confidence`, `${Math.round(v.confidence * 100)}% əminlik`)} style={{ height: 6, background: 'var(--hair2)', position: 'relative' }}>
                            <span style={{ position: 'absolute', inset: 0, width: `${v.confidence * 100}%`, background: v.confidence < 0.6 ? 'var(--saffron)' : 'var(--indigo)' }} />
                          </span>
                        </div>
                      ))}
                      {listing?.notes && (
                        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--hair2)' }}>
                          <span className="muted" style={{ fontSize: 13 }}>{t('Notes', 'Qeydlər')}</span>
                          <span style={{ fontSize: 14 }}>{listing.notes}</span>
                        </div>
                      )}
                      {run.priceNote && <div className="note" style={{ fontSize: 14, paddingTop: 10 }}>{loc(run.priceNote, run.priceNoteAz).replace(/\.?$/, '.')}</div>}
                      {run.edits && run.edits.length > 0 && (
                        <div aria-label={t('Corrections', 'Düzəlişlər')} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12 }}>
                          <div className="eyebrow muted" style={{ fontSize: 10.5 }}>{t('Corrected in the chat', 'Söhbətdə düzəldildi')}</div>
                          {run.edits.slice(-5).map((e, i) => (
                            <div key={i} style={{ fontSize: 13.5 }}>
                              <b>{fl(e.field)}</b> {e.from ? <><span className="muted" style={{ textDecoration: 'line-through' }}>{e.from}</span> → </> : ''}<b className="num">{e.to}</b>
                              <span className="muted"> · {e.by === 'farmer' ? t(`by ${f.name.split(' ')[0]}`, `düzəldən: ${f.name.split(' ')[0]}`) : t('by operator', 'düzəldən: operator')}</span>
                              {e.quote && <span className="note" style={{ display: 'block', fontSize: 13 }}>“{e.quote}”</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Step({ st, last }: { st: AiStep; last: boolean }) {
  const { t, loc } = useLang();
  const output = st.output ? loc(st.output, st.outputAz) : undefined;
  const color = st.status === 'done' ? 'var(--olive)' : st.status === 'running' ? 'var(--indigo)' : st.status === 'failed' ? 'var(--madder)' : 'var(--line)';
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span className={st.status === 'running' ? 'blink' : undefined} style={{ display: 'flex' }}>
          <Medallion size={24} fill={st.status === 'done' ? color : undefined} stroke={st.status === 'done' ? undefined : color} inner={st.status === 'done' ? 'var(--bone)' : undefined} dot={st.status === 'running' ? color : undefined} dashed={st.status === 'pending' || st.status === 'skipped'} />
        </span>
        {!last && <span style={{ flex: 1, width: 0, borderLeft: st.status === 'done' ? '2px solid var(--olive)' : '2px dashed var(--line)', minHeight: 26 }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 11, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: st.status === 'pending' ? 'var(--muted)' : 'var(--soot)' }}>{loc(st.label, st.labelAz)}</span>
          {st.mode && (
            <span className="chip" data-step-mode={st.mode} title={st.note ?? undefined} style={{ height: 20, fontSize: 10.5, color: STEP_MODE[st.mode].color, boxShadow: `inset 0 0 0 1px ${STEP_MODE[st.mode].color}` }}>
              {t(...STEP_MODE[st.mode].label)}
            </span>
          )}
        </div>
        {output && <div className={st.key === 'transcribe' ? 'note' : 'muted'} style={{ fontSize: 14 }}>{st.key === 'transcribe' && output.length > 90 ? `${output.slice(0, 90)}…` : output}</div>}
        {st.note && st.mode !== 'live' && <div className="muted" style={{ fontSize: 12 }}>{t('Fallback', 'Ehtiyat rejim')}: {st.note}</div>}
        {st.status === 'running' && <div className="muted" style={{ fontSize: 13 }}>{t('Working…', 'İşlənir…')}</div>}
        {st.status === 'skipped' && !st.output && <div className="muted" style={{ fontSize: 13 }}>{t('Skipped', 'Ötürüldü')}</div>}
      </div>
    </li>
  );
}
