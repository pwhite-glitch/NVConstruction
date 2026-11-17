'use client'
// Weekly Test view for supers in /field (prompt 88). Not tied to a job.
// All data comes from /api/super-test/current and /submit (service role on the server).
// Before submitting, the browser never receives correct answers or explanations.
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { fetchJson, jsonInit } from '../../lib/fetch-json'
import { CATEGORY_LABELS, weekLabel } from '../../lib/super-test'

const storageKey = (userId, week) => `nvc_supertest_${userId}_${week}`
const readPicks = key => { try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} } }
const writePicks = (key, picks) => { try { localStorage.setItem(key, JSON.stringify(picks)) } catch { /* private mode */ } }
const clearPicks = key => { try { localStorage.removeItem(key) } catch { /* ignore */ } }

const st = {
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '1rem', marginBottom: '0.9rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', minWidth: 0 },
  note: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '1.25rem', color: '#4b5563', fontSize: '15px', lineHeight: 1.5 },
  pill: cat => ({ display: 'inline-block', padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: cat === 'braums' ? '#fff7ed' : '#eff6ff', color: cat === 'braums' ? '#c2410c' : '#1d4ed8', border: `1px solid ${cat === 'braums' ? '#fed7aa' : '#bfdbfe'}` }),
  qText: { fontSize: '16px', fontWeight: 600, color: '#111827', lineHeight: 1.45, margin: '8px 0 12px', overflowWrap: 'anywhere' },
  choice: on => ({ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%', minHeight: '44px', padding: '10px 12px', marginBottom: '8px', textAlign: 'left', fontSize: '16px', lineHeight: 1.4, whiteSpace: 'normal', overflowWrap: 'anywhere', background: on ? '#fff7ed' : '#fff', color: '#111827', border: `2px solid ${on ? '#e8590c' : '#d1d5db'}`, borderRadius: '10px', cursor: 'pointer', boxSizing: 'border-box' }),
  mark: on => ({ flex: '0 0 22px', width: '22px', height: '22px', borderRadius: '50%', border: `2px solid ${on ? '#e8590c' : '#9ca3af'}`, background: on ? '#e8590c' : '#fff', color: '#fff', fontSize: '14px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '1px' }),
  bar: { position: 'sticky', bottom: 0, zIndex: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: '#fff', borderTop: '1px solid #e5e7eb', padding: '10px 1.5rem', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', margin: '0 -1.5rem', boxShadow: '0 -4px 12px rgba(0,0,0,0.05)' },
  btn: dis => ({ minHeight: '44px', padding: '0 20px', background: dis ? '#d1d5db' : '#e8590c', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 700, cursor: dis ? 'not-allowed' : 'pointer', flexShrink: 0 }),
  link: { minHeight: '44px', padding: '0 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '8px', color: '#374151', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
}

function Result({ result }) {
  return (
    <>
      <div style={{ ...st.card, textAlign: 'center', background: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '1px' }}>Your score</div>
        <div style={{ fontSize: '34px', fontWeight: 800, color: '#111827' }}>{result.score} / {result.total}</div>
      </div>
      {(result.items || []).map((it, i) => (
        <div key={it.question_id || i} style={st.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#6b7280' }}>{i + 1}.</span>
            <span style={st.pill(it.category)}>{CATEGORY_LABELS[it.category] || it.category}</span>
            <span style={{ fontSize: '13px', fontWeight: 800, color: it.is_correct ? '#15803d' : '#b91c1c' }}>{it.is_correct ? '✓ Correct' : '✗ Missed'}</span>
          </div>
          <div style={st.qText}>{it.question}</div>
          {(it.choices || []).map((c, ci) => {
            const mine = ci === it.chosen_index
            const right = ci === it.correct_index
            const tone = right ? { bg: '#f0fdf4', bd: '#16a34a', fg: '#15803d' } : mine ? { bg: '#fef2f2', bd: '#dc2626', fg: '#b91c1c' } : { bg: '#fff', bd: '#e5e7eb', fg: '#6b7280' }
            return (
              <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', marginBottom: '8px', fontSize: '16px', lineHeight: 1.4, overflowWrap: 'anywhere', background: tone.bg, border: `2px solid ${tone.bd}`, borderRadius: '10px' }}>
                <span aria-hidden="true" style={{ flex: '0 0 18px', fontWeight: 800, color: tone.fg }}>{right ? '✓' : mine ? '✗' : ''}</span>
                <span style={{ flex: 1, minWidth: 0, color: '#111827' }}>
                  {c}
                  {(mine || right) && (
                    <span style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: tone.fg, marginTop: '2px' }}>
                      {[mine && 'Your answer', right && 'Correct answer'].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
              </div>
            )
          })}
          {it.explanation && <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.5, background: '#f9fafb', borderRadius: '8px', padding: '10px 12px', overflowWrap: 'anywhere' }}><strong>Why: </strong>{it.explanation}</div>}
        </div>
      ))}
    </>
  )
}

function History({ history, currentWeek, onOpen }) {
  const rows = (history || []).filter(h => h.week_start !== currentWeek)
  if (!rows.length) return null
  return (
    <div style={{ ...st.card, marginTop: '1.25rem' }}>
      <div style={{ fontSize: '14px', fontWeight: 800, color: '#111827', marginBottom: '8px' }}>Past weeks</div>
      {rows.map(h => (
        <button key={h.week_start} type="button" onClick={() => onOpen(h.week_start)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', minHeight: '44px', padding: '0 4px', background: 'none', border: 'none', borderTop: '1px solid #f3f4f6', fontSize: '15px', color: '#111827', cursor: 'pointer', textAlign: 'left' }}>
          <span>{weekLabel(h.week_start)}</span>
          <span style={{ fontWeight: 700 }}>{h.score}/{h.total} ›</span>
        </button>
      ))}
    </div>
  )
}

// onSummary({ status, score, total }) keeps the /field tile badge in step.
export default function SuperWeeklyTest({ userId, onSummary }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [picks, setPicks] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [review, setReview] = useState(null) // past week { week_start, result }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const r = await fetchJson(authFetch, '/api/super-test/current')
    setLoading(false)
    if (r.status === 403) { setData({ forbidden: true }); return }
    if (!r.ok) { setError(r.error || 'Could not load the weekly test.'); return }
    const d = r.data || {}
    setData(d)
    if (d.status === 'in_progress' && userId) {
      const saved = readPicks(storageKey(userId, d.week_start))
      const ids = new Set((d.questions || []).map(q => q.id))
      setPicks(Object.fromEntries(Object.entries(saved).filter(([k, v]) => ids.has(k) && Number.isInteger(v) && v >= 0 && v <= 3)))
    }
    if (d.status === 'submitted') onSummary?.({ status: 'submitted', score: d.result?.score, total: d.result?.total })
    else if (d.status === 'in_progress') onSummary?.({ status: 'in_progress' })
    else if (d.status === 'no_questions') onSummary?.({ status: 'no_questions' })
  }, [userId, onSummary])

  useEffect(() => { load() }, [load])

  function choose(qid, idx) {
    setPicks(p => {
      const next = { ...p, [qid]: idx }
      if (userId && data?.week_start) writePicks(storageKey(userId, data.week_start), next)
      return next
    })
  }

  async function openWeek(week) {
    setNotice('')
    const r = await fetchJson(authFetch, `/api/super-test/current?week=${encodeURIComponent(week)}`)
    if (!r.ok) { setNotice(r.error || 'Could not open that week.'); return }
    setReview(r.data)
    if (typeof window !== 'undefined') window.scrollTo(0, 0)
  }

  async function doSubmit() {
    if (!data?.questions) return
    if (!window.confirm('Submit? You can only submit once this week.')) return
    setSubmitting(true)
    setNotice('')
    const r = await fetchJson(authFetch, '/api/super-test/submit', jsonInit('POST', { week_start: data.week_start, answers: picks }))
    setSubmitting(false)
    if (r.ok) {
      if (userId) clearPicks(storageKey(userId, data.week_start))
      setPicks({})
      if (typeof window !== 'undefined') window.scrollTo(0, 0)
      await load()
      return
    }
    setNotice(r.error || 'Could not submit. Please try again.')
    if (r.status === 409) {
      if (userId) clearPicks(storageKey(userId, data.week_start))
      await load()
    }
  }

  if (loading && !data) return <div style={st.note}>Loading the weekly test…</div>
  if (error) return <div style={st.note}>{error} <button type="button" style={{ ...st.link, marginLeft: '8px' }} onClick={load}>Retry</button></div>
  if (!data) return null
  if (data.forbidden) return <div style={st.note}>Weekly test is for supers.</div>
  if (data.migration_required) return <div style={st.note}>Weekly test isn&apos;t set up yet.</div>

  if (review) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
          <div style={{ fontSize: '15px', fontWeight: 800, color: '#111827' }}>{review.week_label}</div>
          <button type="button" style={st.link} onClick={() => setReview(null)}>← This week</button>
        </div>
        <Result result={review.result} />
      </div>
    )
  }

  const header = data.week_label || weekLabel(data.week_start)
  const banner = notice && <div role="alert" style={{ ...st.note, background: '#fff7ed', borderColor: '#fed7aa', color: '#9a3412', marginBottom: '0.9rem' }}>{notice}</div>

  if (data.status === 'no_questions') {
    return <div>{banner}<div style={st.note}>No questions this week. Check back next week.</div><History history={data.history} currentWeek={data.week_start} onOpen={openWeek} /></div>
  }

  if (data.status === 'submitted') {
    return (
      <div>
        {banner}
        <div style={{ fontSize: '14px', fontWeight: 700, color: '#4b5563', marginBottom: '0.75rem' }}>{header} · submitted</div>
        <Result result={data.result} />
        <History history={data.history} currentWeek={data.week_start} onOpen={openWeek} />
      </div>
    )
  }

  const questions = data.questions || []
  const answered = questions.filter(q => Number.isInteger(picks[q.id])).length
  const ready = questions.length > 0 && answered === questions.length
  return (
    <div>
      {banner}
      <div style={{ fontSize: '14px', fontWeight: 700, color: '#4b5563', marginBottom: '0.75rem' }}>{header} · {questions.length} questions · one submission</div>
      {questions.map((q, i) => (
        <div key={q.id} style={st.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#6b7280' }}>{i + 1}.</span>
            <span style={st.pill(q.category)}>{CATEGORY_LABELS[q.category] || q.category}</span>
            {q.store && <span style={{ fontSize: '12px', color: '#6b7280' }}>{q.store}</span>}
          </div>
          <div id={`stq-${q.id}`} style={st.qText}>{q.question}</div>
          <div role="radiogroup" aria-labelledby={`stq-${q.id}`}>
            {(q.choices || []).map((c, ci) => {
              const on = picks[q.id] === ci
              return (
                <button key={ci} type="button" role="radio" aria-checked={on} onClick={() => choose(q.id, ci)} style={st.choice(on)}>
                  <span aria-hidden="true" style={st.mark(on)}>{on ? '✓' : ''}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{c}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <History history={data.history} currentWeek={data.week_start} onOpen={openWeek} />
      <div className="rx-bleed" style={st.bar}>
        <span style={{ fontSize: '15px', fontWeight: 700, color: '#374151' }}>{answered} of {questions.length} answered</span>
        <button type="button" disabled={!ready || submitting} onClick={doSubmit} style={st.btn(!ready || submitting)}>{submitting ? 'Submitting…' : 'Submit'}</button>
      </div>
    </div>
  )
}
