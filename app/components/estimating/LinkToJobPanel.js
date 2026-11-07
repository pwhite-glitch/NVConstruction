'use client'
import { useEffect, useState } from 'react'
import { REFERENCE_LABELS } from '../../../lib/estimate-to-job'
import { sameUpdatedAt } from '../../../lib/estimate-save'

// "Link to existing job": pick a job, review what happens to its budget and
// contract value, then link. All writes happen server-side in one transaction
// (/api/estimates/to-job -> link_estimate_to_job).

function fmt$(n, d = 2) {
  const v = parseFloat(n)
  if (isNaN(v)) return '—'
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

const st = {
  lbl:   { display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', margin: '0 0 6px' },
  note:  { fontSize: '12px', color: '#6b7280', margin: '4px 0 0' },
  warn:  { background: '#fffbeb', border: '1px solid #fcd34d', color: '#92400e', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', margin: '0 0 12px' },
  err:   { background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', margin: '8px 0' },
  list:  { border: '1px solid #e5e7eb', borderRadius: '6px', maxHeight: '240px', overflowY: 'auto' },
  row:   sel => ({ display: 'grid', gridTemplateColumns: '90px 1fr 110px 60px', gap: '8px', padding: '7px 10px', fontSize: '12px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', background: sel ? '#fff7ed' : '#fff', color: '#111827', width: '100%', textAlign: 'left', border: 'none' }),
  hdr:   { display: 'grid', gridTemplateColumns: '90px 1fr 110px 60px', gap: '8px', padding: '6px 10px', fontSize: '10px', fontWeight: '700', color: '#6b7280', letterSpacing: '0.6px', textTransform: 'uppercase', background: '#f9fafb', borderBottom: '1px solid #e5e7eb' },
  sec:   { borderTop: '1px solid #f3f4f6', paddingTop: '12px', marginTop: '12px' },
  radio: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', margin: '4px 0', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
  td:    { padding: '5px 6px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' },
  btn:   { padding: '8px 18px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGr: { padding: '8px 18px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnSm: { padding: '3px 10px', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' },
}

const lineLabel = l => `${l.cost_code ? l.cost_code + ' · ' : ''}${l.description || '(no description)'}`

export default function LinkToJobPanel({ estimateId, getBase, dirty, postToJob, onConflict, onLinked, onCancel }) {
  const [jobs,        setJobs]        = useState(null)
  const [jobId,       setJobId]       = useState('')
  const [preview,     setPreview]     = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [err,         setErr]         = useState('')
  const [mode,        setMode]        = useState('')
  const [dupActions,  setDupActions]  = useState({})
  const [contract,    setContract]    = useState('')
  const [linking,     setLinking]     = useState(false)

  useEffect(() => { loadJobs() }, [])

  async function loadJobs() {
    setErr('')
    try {
      const { res, result } = await postToJob({ action: 'list_jobs' })
      if (!res.ok) { setErr(result?.error || `Could not load jobs (${res.status})`); setJobs([]); return }
      setJobs(result?.jobs || [])
    } catch (e) {
      setErr(e?.message || 'Could not load jobs — check connection')
      setJobs([])
    }
  }

  async function pickJob(id) {
    setJobId(id)
    setPreview(null)
    setMode('')
    setDupActions({})
    setContract('')
    setErr('')
    if (!id) return
    setLoading(true)
    try {
      const { res, result } = await postToJob({ action: 'preview_link', id: estimateId, job_id: id })
      if (!res.ok) { setErr(result?.error || `Could not load job (${res.status})`); return }
      setPreview(result)
    } catch (e) {
      setErr(e?.message || 'Could not load job — check connection')
    } finally {
      setLoading(false)
    }
  }

  const p = preview
  const hasLines = !!p && p.job_lines.length > 0
  const effMode = hasLines ? mode : 'add'
  const dups = p && effMode === 'add' ? p.duplicates : []
  const newBySort = Object.fromEntries((p?.new_lines || []).map(l => [l.sort_order, l]))
  const existingById = Object.fromEntries((p?.job_lines || []).map(l => [l.id, l]))
  const contractEmpty = !!p && (p.job.contract_value == null || Number(p.job.contract_value) === 0)
  const replaceBlocked = !!p && p.references.length > 0
  const staleEstimate = !!p && !sameUpdatedAt(p.estimate_updated_at, getBase())

  const missing = []
  if (p) {
    if (hasLines && !mode) missing.push('choose Add to existing or Replace')
    if (hasLines && mode === 'replace' && replaceBlocked) missing.push('Replace is not allowed for this job')
    if (dups.some(d => !dupActions[d.sort_order])) missing.push('choose Merge or Keep both for each duplicate')
    if (!contract) missing.push('choose what to do with the contract value')
  }
  const ready = !!p && missing.length === 0 && !linking && !dirty && !staleEstimate

  async function link() {
    if (!ready) return
    if (effMode === 'replace' && !window.confirm(
      `Delete ${p.job_lines.length} budget line(s) from job ${p.job.job_number} and replace them with this estimate's ${p.new_lines.length} line(s)?`)) return
    setLinking(true)
    setErr('')
    try {
      const { res, result } = await postToJob({
        action: 'link',
        id: estimateId,
        job_id: p.job.id,
        expected_updated_at: getBase() ?? null,
        expected_job_lines: p.job_snapshot,
        expected_contract_value: p.job.contract_value ?? null,
        mode: hasLines ? mode : 'add',
        duplicate_actions: dupActions,
        contract_action: contract,
      })
      if (!res.ok) {
        if (result?.code === 'stale') onConflict()
        setErr(result?.error || `Link failed (${res.status})`)
        if (result?.code === 'job_changed') {
          // Reload what the job looks like now; the user re-chooses.
          const keep = result.error
          await pickJob(p.job.id)
          setErr(keep)
        }
        setLinking(false)
        return
      }
      onLinked(p.job.id)
    } catch (e) {
      setErr(e?.message || 'Link failed — check connection')
      setLinking(false)
    }
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={st.warn}>
        Linking copies this estimate&apos;s lines into the job&apos;s budget once, and marks the estimate Won.
        Later edits to this estimate will <b>not</b> flow to the job.
      </div>

      <p style={st.lbl}>Job</p>
      {jobs === null && <p style={st.note}>Loading jobs…</p>}
      {jobs && jobs.length === 0 && !err && <p style={st.note}>No active jobs without a linked estimate.</p>}
      {jobs && jobs.length > 0 && (
        <div style={st.list} role="listbox" aria-label="Jobs">
          <div style={st.hdr}><div>Job #</div><div>Name</div><div style={{ textAlign: 'right' }}>Budget</div><div style={{ textAlign: 'right' }}>Lines</div></div>
          {jobs.map(j => (
            <button key={j.id} role="option" aria-selected={j.id === jobId} style={st.row(j.id === jobId)} onClick={() => pickJob(j.id)} disabled={loading || linking}>
              <div style={{ fontWeight: '600' }}>{j.job_number}</div>
              <div>{j.project_name}</div>
              <div style={{ textAlign: 'right' }}>{fmt$(j.budget_total, 0)}</div>
              <div style={{ textAlign: 'right' }}>{j.line_count}</div>
            </button>
          ))}
        </div>
      )}

      {loading && <p style={st.note}>Loading job…</p>}

      {p && (
        <>
          {staleEstimate && <div style={st.err}>This estimate was changed elsewhere. Reload before linking.</div>}

          {/* Budget lines already on the job */}
          {hasLines && (
            <div style={st.sec}>
              <p style={st.lbl}>Job {p.job.job_number} already has {p.job_lines.length} budget line(s) ({fmt$(p.job_lines.reduce((a, l) => a + Number(l.budget_amount || 0), 0))})</p>
              <label style={st.radio}><input type="radio" name="link-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add to existing lines</label>
              <label style={{ ...st.radio, opacity: replaceBlocked ? 0.5 : 1 }}>
                <input type="radio" name="link-mode" checked={mode === 'replace'} disabled={replaceBlocked} onChange={() => setMode('replace')} /> Replace existing lines
              </label>
              {replaceBlocked && (
                <div style={st.err}>
                  Replace is not allowed. These records use this job&apos;s budget lines:
                  <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                    {p.references.map(r => <li key={r.source_table + r.source_column}>{REFERENCE_LABELS[r.source_table] || r.source_table}: {r.ref_count}</li>)}
                  </ul>
                </div>
              )}
              {p.references_error && <div style={st.warn}>Couldn&apos;t check what uses these lines ({p.references_error}). The server checks again before any Replace.</div>}
              {mode === 'replace' && !replaceBlocked && (
                <div style={st.err}>
                  These {p.job_lines.length} line(s) will be deleted:
                  <table style={{ ...st.table, marginTop: '4px' }}><tbody>
                    {p.job_lines.map(l => (
                      <tr key={l.id}><td style={st.td}>{lineLabel(l)}</td><td style={{ ...st.td, textAlign: 'right' }}>{fmt$(l.budget_amount)}</td></tr>
                    ))}
                  </tbody></table>
                </div>
              )}
            </div>
          )}

          {/* Duplicates */}
          {dups.length > 0 && (
            <div style={st.sec}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <p style={{ ...st.lbl, margin: 0, flex: 1 }}>{dups.length} estimate line(s) match an existing line by description or cost code</p>
                <button style={st.btnSm} onClick={() => setDupActions(Object.fromEntries(dups.map(d => [d.sort_order, 'merge'])))}>Merge all</button>
                <button style={st.btnSm} onClick={() => setDupActions(Object.fromEntries(dups.map(d => [d.sort_order, 'keep_both'])))}>Keep all</button>
              </div>
              <table style={st.table}>
                <thead><tr style={{ color: '#6b7280', textAlign: 'left' }}><th style={st.td}>Estimate line</th><th style={st.td}>Existing line</th><th style={st.td}>Action</th></tr></thead>
                <tbody>
                  {dups.map(d => {
                    const n = newBySort[d.sort_order]
                    const e = existingById[d.existing_id]
                    return (
                      <tr key={d.sort_order}>
                        <td style={st.td}>{lineLabel(n)}<br /><span style={{ color: '#6b7280' }}>{fmt$(n.budget_amount)} cost · {fmt$(n.owner_amount)} price</span></td>
                        <td style={st.td}>{lineLabel(e)}<br /><span style={{ color: '#6b7280' }}>{fmt$(e.budget_amount)} · same {d.match === 'description' ? 'description' : 'cost code'}</span></td>
                        <td style={st.td}>
                          <select value={dupActions[d.sort_order] || ''} onChange={ev => setDupActions(a => ({ ...a, [d.sort_order]: ev.target.value }))} style={{ fontSize: '12px', padding: '3px' }}>
                            <option value="">— Choose —</option>
                            <option value="merge">Merge (add amounts)</option>
                            <option value="keep_both">Keep both</option>
                          </select>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* What gets copied */}
          <div style={st.sec}>
            <p style={st.lbl}>From this estimate</p>
            <p style={st.note}>
              {p.new_lines.length} line(s): {fmt$(p.new_lines.reduce((a, l) => a + l.budget_amount, 0))} cost (budget),{' '}
              {fmt$(p.new_lines.reduce((a, l) => a + l.owner_amount, 0))} price (owner amount). Estimate total {fmt$(p.estimate_total)}.
              {p.new_lines.some(l => /^Sales tax \(/.test(l.description)) && ' Includes one sales-tax line (tax on raw cost, at cost, not marked up).'}
            </p>
          </div>

          {/* Contract value */}
          <div style={st.sec}>
            {contractEmpty ? (
              <>
                <p style={st.lbl}>Job contract value is empty</p>
                <label style={st.radio}><input type="radio" name="link-contract" checked={contract === 'set'} onChange={() => setContract('set')} /> Set it to the estimate total ({fmt$(p.estimate_total)})</label>
                <label style={st.radio}><input type="radio" name="link-contract" checked={contract === 'keep'} onChange={() => setContract('keep')} /> Leave it empty</label>
              </>
            ) : (
              <>
                <p style={st.lbl}>Contract value: job {fmt$(p.job.contract_value)} · estimate {fmt$(p.estimate_total)}</p>
                <label style={st.radio}><input type="radio" name="link-contract" checked={contract === 'keep'} onChange={() => setContract('keep')} /> Keep job value ({fmt$(p.job.contract_value)})</label>
                <label style={st.radio}><input type="radio" name="link-contract" checked={contract === 'replace'} onChange={() => setContract('replace')} /> Replace with estimate total ({fmt$(p.estimate_total)})</label>
              </>
            )}
          </div>
        </>
      )}

      {err && <div role="alert" style={st.err}>{err}</div>}
      {dirty && <div style={st.warn}>Save your changes first. Linking uses the saved estimate.</div>}
      {p && missing.length > 0 && <p style={st.note}>To link: {missing.join('; ')}.</p>}

      <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
        <button style={{ ...st.btn, opacity: ready ? 1 : 0.6 }} disabled={!ready} onClick={link}>{linking ? 'Linking…' : 'Link estimate to job'}</button>
        <button style={st.btnGr} onClick={onCancel} disabled={linking}>Cancel</button>
      </div>
    </div>
  )
}
