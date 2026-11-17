'use client'
// Dashboard "Super Test" tab (prompt 88). Principal / admin only (SUPER_TEST_ADMIN_ROLES);
// the APIs enforce it server-side. Loads its data only when mounted (tab opened).
// Plain tables inside .rx-scroll-x; no charts.
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { fetchJson, jsonInit } from '../../lib/fetch-json'
import { CATEGORY_LABELS, QUESTION_RULES, weekLabel } from '../../lib/super-test'

const WEEK_OPTIONS = [4, 8, 12, 26]
const EMPTY_FORM = { id: null, category: 'braums', topic: '', store: '', question: '', choices: ['', '', '', ''], correct_index: null, explanation: '', source: '' }

const st = {
  section: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '1rem', marginBottom: '1.25rem', minWidth: 0 },
  h3: { fontSize: '15px', fontWeight: 800, color: '#111827', margin: '0 0 0.6rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontWeight: 700, whiteSpace: 'nowrap', fontSize: '12px' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f3f4f6', color: '#111827', verticalAlign: 'top' },
  input: { width: '100%', padding: '9px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: '12px', fontWeight: 700, color: '#4b5563', margin: '10px 0 4px' },
  btn: { minHeight: '44px', padding: '0 16px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' },
  ghost: { minHeight: '44px', padding: '0 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  muted: { fontSize: '13px', color: '#6b7280' },
}

const statusText = r => (r.status === 'submitted' ? `Submitted ${r.score}/${r.total}` : r.status === 'opened' ? 'Opened, not submitted' : 'Not started')
const showForm = () => setTimeout(() => { try { document.getElementById('super-test-form')?.scrollIntoView({ block: 'start' }) } catch { /* ignore */ } }, 0)
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—')
const truncate = (t, n = 90) => (t && t.length > n ? t.slice(0, n - 1) + '…' : t || '')

function QuestionForm({ initial, onCancel, onSaved }) {
  const [f, setF] = useState(initial)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))

  async function save(e) {
    e.preventDefault()
    setErr('')
    setSaving(true)
    const body = { category: f.category, topic: f.topic, store: f.store, question: f.question, choices: f.choices, correct_index: f.correct_index, explanation: f.explanation, source: f.source }
    const r = await fetchJson(authFetch, '/api/super-test/admin/questions', jsonInit(f.id ? 'PATCH' : 'POST', f.id ? { id: f.id, ...body } : body))
    setSaving(false)
    if (!r.ok) { setErr(r.error || 'Could not save.'); return }
    onSaved()
  }

  return (
    <form id="super-test-form" onSubmit={save} style={{ ...st.section, borderColor: '#fdba74', scrollMarginTop: '80px' }}>
      <h3 style={st.h3}>{f.id ? `Edit ${f.id}` : 'Add question'}</h3>
      <div style={{ ...st.muted, background: '#fff7ed', borderRadius: '6px', padding: '8px 10px' }}>{QUESTION_RULES}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
        <div>
          <label style={st.label} htmlFor="stq-cat">Category</label>
          <select id="stq-cat" style={st.input} value={f.category} onChange={e => set('category', e.target.value)}>
            <option value="braums">Braum&apos;s</option>
            <option value="general">General</option>
          </select>
        </div>
        <div>
          <label style={st.label} htmlFor="stq-topic">Topic (like fall-protection)</label>
          <input id="stq-topic" style={st.input} value={f.topic} onChange={e => set('topic', e.target.value)} />
        </div>
        <div>
          <label style={st.label} htmlFor="stq-store">Store (optional)</label>
          <input id="stq-store" style={st.input} value={f.store || ''} onChange={e => set('store', e.target.value)} />
        </div>
      </div>
      <label style={st.label} htmlFor="stq-q">Question</label>
      <textarea id="stq-q" rows={3} style={{ ...st.input, resize: 'vertical' }} value={f.question} onChange={e => set('question', e.target.value)} />
      <div style={st.label}>Choices — pick the correct one</div>
      {f.choices.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: '44px', minHeight: '44px', cursor: 'pointer' }}>
            <input type="radio" name="stq-correct" checked={f.correct_index === i} onChange={() => set('correct_index', i)} aria-label={`Choice ${i + 1} is correct`} style={{ width: '20px', height: '20px', accentColor: '#16a34a' }} />
          </label>
          <input style={st.input} value={c} placeholder={`Choice ${i + 1}`} onChange={e => set('choices', f.choices.map((x, j) => (j === i ? e.target.value : x)))} />
        </div>
      ))}
      <label style={st.label} htmlFor="stq-exp">Explanation (shown after submitting)</label>
      <textarea id="stq-exp" rows={2} style={{ ...st.input, resize: 'vertical' }} value={f.explanation} onChange={e => set('explanation', e.target.value)} />
      <label style={st.label} htmlFor="stq-src">Source (optional)</label>
      <input id="stq-src" style={st.input} value={f.source || ''} onChange={e => set('source', e.target.value)} />
      {err && <div role="alert" style={{ color: '#b91c1c', fontSize: '13px', fontWeight: 600, marginTop: '10px' }}>{err}</div>}
      <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
        <button type="submit" style={st.btn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" style={{ ...st.ghost, minHeight: '44px' }} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function SuperTestAdmin() {
  const [weeksN, setWeeksN] = useState(8)
  const [stats, setStats] = useState(null)
  const [questions, setQuestions] = useState(null)
  const [error, setError] = useState('')
  const [setup, setSetup] = useState(false)
  const [catFilter, setCatFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const loadStats = useCallback(async () => {
    setError('')
    const r = await fetchJson(authFetch, `/api/super-test/admin/stats?weeks=${weeksN}`)
    if (!r.ok) { setError(r.error || 'Could not load test stats.'); return }
    if (r.data?.migration_required) { setSetup(true); return }
    setStats(r.data)
  }, [weeksN])

  const loadQuestions = useCallback(async () => {
    setError('')
    const r = await fetchJson(authFetch, '/api/super-test/admin/questions')
    if (!r.ok) { setError(r.error || 'Could not load questions.'); return }
    if (r.data?.migration_required) { setSetup(true); return }
    setQuestions(r.data.questions || [])
  }, [])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadQuestions() }, [loadQuestions])

  async function toggleActive(q) {
    setBusyId(q.id)
    const r = await fetchJson(authFetch, '/api/super-test/admin/questions', jsonInit('PATCH', { id: q.id, active: !q.active }))
    setBusyId(null)
    if (!r.ok) { window.alert(r.error || 'Could not update.'); return }
    loadQuestions()
  }

  if (setup) return <div style={st.section}>Weekly test isn&apos;t set up yet (database migration 077 has not been applied).</div>

  const scoreAt = new Map((stats?.scores || []).map(x => [`${x.super_id}|${x.week_start}`, x]))
  const taken = (stats?.this_week || []).filter(r => r.status === 'submitted').length
  const q = search.trim().toLowerCase()
  const shown = (questions || []).filter(x =>
    (catFilter === 'all' || x.category === catFilter) &&
    (activeFilter === 'all' || (activeFilter === 'active') === !!x.active) &&
    (!q || [x.id, x.topic, x.store, x.question, ...(x.choices || [])].some(t => String(t || '').toLowerCase().includes(q))))

  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#111827', margin: 0 }}>Super Test</h2>
        <p style={{ ...st.muted, margin: '4px 0 0' }}>Weekly 10-question test for supers (7 Braum&apos;s, 3 general). Supers only ever see their own scores.</p>
      </div>
      {error && <div role="alert" style={{ ...st.section, color: '#b91c1c' }}>{error}</div>}

      {/* 1. This week */}
      <div style={st.section}>
        <h3 style={st.h3}>This week{stats ? ` — ${weekLabel(stats.current_week)}` : ''}</h3>
        {!stats ? <div style={st.muted}>Loading…</div> : (
          <>
            <div style={{ fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>{taken} of {stats.this_week.length} supers have taken this week&apos;s test.</div>
            <div className="rx-scroll-x">
              <table style={st.table}>
                <thead><tr><th style={st.th}>Super</th><th style={st.th}>Status</th></tr></thead>
                <tbody>
                  {stats.this_week.map(r => (
                    <tr key={r.super_id}>
                      <td style={st.td}>{r.full_name}</td>
                      <td style={{ ...st.td, color: r.status === 'submitted' ? '#15803d' : r.status === 'opened' ? '#b45309' : '#6b7280', fontWeight: 600, whiteSpace: 'nowrap' }}>{statusText(r)}</td>
                    </tr>
                  ))}
                  {!stats.this_week.length && <tr><td style={st.td} colSpan={2}>No supers yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* 2. Scores */}
      <div style={st.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h3 style={{ ...st.h3, margin: 0 }}>Scores</h3>
          <label style={{ ...st.muted, display: 'flex', alignItems: 'center', gap: '6px' }}>
            Weeks
            <select value={weeksN} onChange={e => setWeeksN(Number(e.target.value))} style={{ ...st.input, width: 'auto', padding: '6px 10px' }}>
              {WEEK_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {!stats ? <div style={st.muted}>Loading…</div> : (
          <div className="rx-scroll-x">
            <table style={st.table}>
              <thead>
                <tr>
                  <th style={st.th}>Super</th>
                  {stats.weeks.map(w => <th key={w} style={st.th}>{w.slice(5).replace('-', '/')}</th>)}
                </tr>
              </thead>
              <tbody>
                {stats.supers.map(sp => (
                  <tr key={sp.id}>
                    <td style={{ ...st.td, whiteSpace: 'nowrap' }}>{sp.full_name}</td>
                    {stats.weeks.map(w => {
                      const x = scoreAt.get(`${sp.id}|${w}`)
                      return <td key={w} style={{ ...st.td, whiteSpace: 'nowrap', color: x ? '#111827' : '#9ca3af' }}>{x ? `${x.score}/${x.total}` : '—'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 3. Most-missed topics */}
      <div style={st.section}>
        <h3 style={st.h3}>Most-missed topics (last {weeksN} weeks)</h3>
        {!stats ? <div style={st.muted}>Loading…</div> : !stats.topics.length ? <div style={st.muted}>No submitted tests in this window.</div> : (
          <div className="rx-scroll-x">
            <table style={st.table}>
              <thead><tr><th style={st.th}>Topic</th><th style={st.th}>Missed</th><th style={st.th}>Answered</th><th style={st.th}>Miss %</th></tr></thead>
              <tbody>
                {stats.topics.slice(0, 10).map(t => (
                  <tr key={t.topic}>
                    <td style={st.td}>{t.topic}</td>
                    <td style={st.td}>{t.missed}</td>
                    <td style={st.td}>{t.answered}</td>
                    <td style={st.td}>{pct(t.missed, t.answered)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Questions */}
      {form && <QuestionForm key={form.id || 'new'} initial={form} onCancel={() => setForm(null)} onSaved={() => { setForm(null); loadQuestions() }} />}
      <div style={st.section}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h3 style={{ ...st.h3, margin: 0 }}>Questions{questions ? ` (${shown.length})` : ''}</h3>
          <button type="button" style={st.btn} onClick={() => { setForm({ ...EMPTY_FORM, choices: ['', '', '', ''] }); showForm() }}>Add question</button>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
          <select aria-label="Category" value={catFilter} onChange={e => setCatFilter(e.target.value)} style={{ ...st.input, width: 'auto' }}>
            <option value="all">All</option>
            <option value="braums">Braum&apos;s</option>
            <option value="general">General</option>
          </select>
          <select aria-label="Active" value={activeFilter} onChange={e => setActiveFilter(e.target.value)} style={{ ...st.input, width: 'auto' }}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">Active + inactive</option>
          </select>
          <input type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...st.input, flex: '1 1 160px', width: 'auto', minWidth: 0 }} />
        </div>
        {!questions ? <div style={st.muted}>Loading…</div> : (
          <div className="rx-scroll-x">
            <table style={{ ...st.table, minWidth: '900px' }}>
              <thead>
                <tr>
                  {['ID', 'Category', 'Topic', 'Store', 'Question', 'Correct choice', 'Answered', 'Miss %', '', ''].map((h, i) => <th key={i} style={st.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map(x => (
                  <tr key={x.id} style={{ opacity: x.active ? 1 : 0.6 }}>
                    <td style={{ ...st.td, whiteSpace: 'nowrap' }}>{x.id}</td>
                    <td style={st.td}>{CATEGORY_LABELS[x.category] || x.category}</td>
                    <td style={st.td}>{x.topic}</td>
                    <td style={st.td}>{x.store || ''}</td>
                    <td style={{ ...st.td, minWidth: '220px' }} title={x.question}>{truncate(x.question)}</td>
                    <td style={{ ...st.td, minWidth: '140px' }}>{x.correct_index != null ? truncate(x.choices?.[x.correct_index], 50) : '—'}</td>
                    <td style={st.td}>{x.answered}</td>
                    <td style={st.td}>{pct(x.missed, x.answered)}</td>
                    <td style={st.td}><button type="button" style={st.ghost} disabled={busyId === x.id} onClick={() => toggleActive(x)}>{x.active ? 'Deactivate' : 'Reactivate'}</button></td>
                    <td style={st.td}><button type="button" style={st.ghost} onClick={() => { setForm({ ...EMPTY_FORM, ...x, store: x.store || '', source: x.source || '', choices: [...(x.choices || ['', '', '', ''])] }); showForm() }}>Edit</button></td>
                  </tr>
                ))}
                {!shown.length && <tr><td style={st.td} colSpan={10}>No questions match.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
