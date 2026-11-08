'use client';
import { useState } from 'react';
import { useLive } from '@/components/live';
import { Shell } from '@/components/Shell';
import { bakuTime, Medallion, RipenessScale, Thread } from '@/components/ui';
import type { AiRun, AiStep } from '@/lib/types';

const FIELD_LABEL: Record<string, string> = { product: 'Product', variety: 'Variety', qtyKg: 'Quantity (kg)', priceAzn: 'Price (₼/kg)', grade: 'Grade', harvest: 'Harvest', notes: 'Notes', photo: 'Photo' };
const MODE: Record<AiRun['mode'], string> = { live: 'Live AI', cached: 'Cached AI result (verified earlier)', simulated: 'Simulated (scripted)', mixed: 'Mixed: live, cached or simulated per step' };
const STEP_MODE: Record<NonNullable<AiStep['mode']>, { label: string; color: string }> = {
  live: { label: 'LIVE', color: 'var(--olive-ink)' },
  cached: { label: 'CACHED', color: 'var(--indigo)' },
  simulated: { label: 'SIMULATED', color: 'var(--saffron)' },
};

export default function Intake() {
  const { s, act } = useLive();
  const [sel, setSel] = useState<string | undefined>();
  if (!s) return <Shell perspective="operator" active="intake">{null}</Shell>;
  const runs = s.aiRuns;
  const run = runs.find((r) => r.id === sel) ?? runs[0];
  const f = run ? s.farmers.find((x) => x.id === run.farmerId) : undefined;
  const listing = run?.listingId ? s.listings.find((l) => l.id === run.listingId) : undefined;
  // The label follows the steps that have run so far, so it is right while the run is still going.
  const stepModes = run ? Array.from(new Set(run.steps.map((x) => x.mode).filter(Boolean))) : [];
  const modeLabel = !run ? '' : stepModes.length === 0 ? 'In progress' : stepModes.length === 1 ? MODE[stepModes[0]!] : MODE.mixed;

  return (
    <Shell perspective="operator" active="intake">
      <div style={{ height: '100%', minHeight: 640, display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)' }}>
        <section aria-label="Incoming" className="scroll" style={{ borderRight: '1px solid var(--hair)', background: 'var(--paper)', padding: '26px 22px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="serif" style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>Incoming</h2>
          {runs.length === 0 && <div className="muted" style={{ fontSize: 14 }}>Voice notes and photos from farmers appear here as the AI turns them into listings.</div>}
          {runs.map((r) => {
            const rf = s.farmers.find((x) => x.id === r.farmerId)!;
            const on = r.id === run?.id;
            return (
              <button key={r.id} onClick={() => setSel(r.id)} aria-pressed={on} style={{ textAlign: 'left', border: 0, cursor: 'pointer', borderRadius: 2, padding: '12px 12px', margin: '0 -12px', background: on ? 'var(--paper2)' : 'transparent', boxShadow: on ? 'inset 0 0 0 1px var(--hair)' : undefined, display: 'flex', gap: 10, alignItems: 'center' }}>
                <Thread color={rf.color} h={30} />
                <span style={{ flex: 1 }}>
                  <b style={{ display: 'block' }}>{rf.name}</b>
                  <span className="muted num" style={{ fontSize: 13 }}>{bakuTime(r.startedAt)} · {r.status === 'running' ? 'Working…' : r.status === 'needs_review' ? 'Needs review' : r.status === 'failed' ? 'Failed' : 'Listed'}</span>
                </span>
                <Medallion size={14} fill={r.status === 'done' ? 'var(--olive)' : r.status === 'needs_review' ? 'var(--saffron)' : undefined} stroke={r.status === 'running' ? 'var(--indigo)' : r.status === 'failed' ? 'var(--madder)' : undefined} dashed={r.status === 'running'} />
              </button>
            );
          })}
        </section>

        <section aria-label="AI listing pipeline" className="scroll" style={{ padding: '30px 40px 40px', display: 'flex', flexDirection: 'column', gap: 26 }}>
          {!run || !f ? (
            <div style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="eyebrow" style={{ color: 'var(--indigo)' }}>AI intake</div>
              <h1 className="serif" style={{ fontSize: 36, fontWeight: 600 }}>Waiting for a farmer</h1>
              <div className="muted">When a farmer sends a voice note and a photo on WhatsApp, you will see each step here: transcript, extracted fields, photo inspection, price check and the drafted listing.</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="eyebrow" style={{ color: 'var(--indigo)' }}>AI intake · {modeLabel}</div>
                  <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.015em' }}>{f.name}, {f.village}</h1>
                </div>
                {run.status === 'needs_review' && listing && (listing.status === 'draft' || listing.status === 'needs_review') && (
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => void act('rejectListing', { listingId: listing.id })}>Reject</button>
                    <button className="btn btn-indigo btn-sm" onClick={() => void act('approveListing', { listingId: listing.id })}>Approve listing</button>
                  </div>
                )}
              </div>
              {run.note && <div className="card" style={{ padding: '14px 18px', boxShadow: 'inset 0 0 0 1px var(--saffron)' }}>{run.note}</div>}
              {run.waitingFor && run.status !== 'failed' && (
                <div className="fade-up" data-waiting style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink2)' }}>
                  <span className="blink" style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--indigo)', flex: 'none' }} />
                  Waiting for {f.name.split(' ')[0]}: {run.waitingFor}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }}>
                <ol aria-label="Steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
                  {run.steps.map((st, i) => <Step key={st.key} st={st} last={i === run.steps.length - 1} />)}
                </ol>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {run.transcriptAz && (
                    <div className="card fade-up" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div className="eyebrow muted" style={{ fontSize: 11 }}>Voice note · Azerbaijani</div>
                      <div style={{ fontSize: 16 }}>“{run.transcriptAz}”</div>
                      {run.transcriptEn && <div className="note" style={{ fontSize: 15, color: 'var(--muted)' }}>{run.transcriptEn}</div>}
                    </div>
                  )}
                  {run.photoUrl && (
                    <div className="card fade-up" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={run.photoUrl} alt="Farmer's produce photo" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 2 }} />
                      {run.ripeness !== undefined && (
                        <>
                          <RipenessScale stage={run.ripeness} />
                          <div className="muted" style={{ fontSize: 13 }}>
                            Visual estimate from the photo, {Math.round((run.ripenessConfidence ?? 0) * 100)}% confidence{run.defects?.length ? ` · ${run.defects.join(', ')}` : ' · no visible defects'}. Not a food-safety certification; checked again by the driver at pickup.
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {run.fields && Object.keys(run.fields).length > 0 && (
                    <div className="card fade-up" style={{ padding: '14px 20px' }}>
                      {Object.entries(run.fields).map(([k, v]) => (
                        <div key={k} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 80px', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--hair2)' }}>
                          <span className="muted" style={{ fontSize: 13 }}>{FIELD_LABEL[k] ?? k}</span>
                          <b className="num">{v.value}</b>
                          <span title={`${Math.round(v.confidence * 100)}% confidence`} style={{ height: 6, background: 'var(--hair2)', position: 'relative' }}>
                            <span style={{ position: 'absolute', inset: 0, width: `${v.confidence * 100}%`, background: v.confidence < 0.6 ? 'var(--saffron)' : 'var(--indigo)' }} />
                          </span>
                        </div>
                      ))}
                      {listing?.notes && (
                        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--hair2)' }}>
                          <span className="muted" style={{ fontSize: 13 }}>Notes</span>
                          <span style={{ fontSize: 14 }}>{listing.notes}</span>
                        </div>
                      )}
                      {run.priceNote && <div className="note" style={{ fontSize: 14, paddingTop: 10 }}>{run.priceNote}.</div>}
                      {run.edits && run.edits.length > 0 && (
                        <div aria-label="Corrections" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 12 }}>
                          <div className="eyebrow muted" style={{ fontSize: 10.5 }}>Corrected in the chat</div>
                          {run.edits.slice(-5).map((e, i) => (
                            <div key={i} style={{ fontSize: 13.5 }}>
                              <b>{FIELD_LABEL[e.field] ?? e.field}</b> {e.from ? <><span className="muted" style={{ textDecoration: 'line-through' }}>{e.from}</span> → </> : ''}<b className="num">{e.to}</b>
                              <span className="muted"> · by {e.by === 'farmer' ? f.name.split(' ')[0] : 'operator'}</span>
                              {e.quote && <span className="note" style={{ display: 'block', fontSize: 13 }}>“{e.quote}”</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {listing && (
                    <div className="muted" style={{ fontSize: 14 }}>
                      Listing {listing.status === 'live' ? 'is live for buyers' : listing.status === 'draft' ? `sent to ${f.name.split(' ')[0]} to confirm on WhatsApp` : listing.status}.
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
  const color = st.status === 'done' ? 'var(--olive)' : st.status === 'running' ? 'var(--indigo)' : st.status === 'failed' ? 'var(--madder)' : 'var(--line)';
  return (
    <li style={{ display: 'grid', gridTemplateColumns: '28px 1fr', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span className={st.status === 'running' ? 'blink' : undefined} style={{ display: 'flex' }}>
          <Medallion size={24} fill={st.status === 'done' ? color : undefined} stroke={st.status === 'done' ? undefined : color} inner={st.status === 'done' ? 'var(--bone)' : undefined} dot={st.status === 'running' ? color : undefined} dashed={st.status === 'pending' || st.status === 'skipped'} />
        </span>
        {!last && <span style={{ flex: 1, width: 0, borderLeft: st.status === 'done' ? '2px solid var(--olive)' : '2px dashed var(--line)', minHeight: 26 }} />}
      </div>
      <div style={{ paddingBottom: last ? 0 : 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: st.status === 'pending' ? 'var(--muted)' : 'var(--soot)' }}>{st.label}</span>
          {st.mode && (
            <span className="chip" data-step-mode={st.mode} title={st.note ?? undefined} style={{ height: 20, fontSize: 10.5, color: STEP_MODE[st.mode].color, boxShadow: `inset 0 0 0 1px ${STEP_MODE[st.mode].color}` }}>
              {STEP_MODE[st.mode].label}
            </span>
          )}
        </div>
        {st.output && <div className={st.key === 'transcribe' ? 'note' : 'muted'} style={{ fontSize: 14 }}>{st.key === 'transcribe' && st.output.length > 90 ? `${st.output.slice(0, 90)}…` : st.output}</div>}
        {st.note && st.mode !== 'live' && <div className="muted" style={{ fontSize: 12 }}>Fallback: {st.note}</div>}
        {st.status === 'running' && <div className="muted" style={{ fontSize: 13 }}>Working…</div>}
        {st.status === 'skipped' && !st.output && <div className="muted" style={{ fontSize: 13 }}>Skipped</div>}
      </div>
    </li>
  );
}
