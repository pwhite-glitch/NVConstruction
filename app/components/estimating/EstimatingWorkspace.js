'use client'

import { useState, useEffect } from 'react'
import './estimating.css'

export const BID_STEPS = [
  ['plans', 'Plans', 'Current drawings, specifications, and addenda'],
  ['scope', 'Scope', 'Build and review what each trade must include'],
  ['quotes', 'Sub quotes', 'Invite subcontractors and collect their proposals'],
  ['compare', 'Compare & price', 'Compare inclusions, exclusions, and amounts'],
  ['proposal', 'Proposal & handoff', 'Review the package and prepare the next step'],
]

export function EstimatingHeader({ active, onChange, estimates, packages }) {
  const archived = estimates.filter(e => ['won', 'lost', 'accepted', 'declined'].includes(e.status)).length
  const tabs = [['estimates', 'Quick estimates', estimates.length - archived], ['bids', 'Bid packages', packages.length], ['overview', 'Pipeline'], ['archive', 'Archive', archived]]
  return <header className="est-header">
    <span className="est-eyebrow">NV Construction / Preconstruction</span>
    <h1>Estimating</h1>
    <p>Quick proposals for small work. A dedicated workspace for every major bid.</p>
    <nav className="est-tabs" aria-label="Estimating">
      {tabs.map(([key, label, count]) => <button type="button" key={key} aria-current={active === key ? 'page' : undefined} onClick={() => onChange(key)}>{label}{count !== undefined && <span>{count}</span>}</button>)}
    </nav>
  </header>
}

export function BidWorkspaceNav({ step, onChange, onBack, pkg, plans, items, submissions, loading, error, onRetry }) {
  const accepted = items.filter(i => i.scope_review?.status === 'accepted').length
  const questions = items.filter(i => i.scope_review?.status === 'question').length
  return <div className="est-workspace-header">
    <button type="button" className="est-back" onClick={onBack}>← All bid packages</button>
    <div className="est-title-row"><div><h2>{pkg.title}</h2><p>{pkg.owner_name || 'Owner not specified'}{pkg.due_date ? ` · Due ${new Date(pkg.due_date + 'T00:00:00').toLocaleDateString()}` : ' · No due date set'}</p></div><span className="est-status">{pkg.status}</span></div>
    <nav className="est-steps" aria-label="Bid workspace">
      {BID_STEPS.map(([key, title], index) => <button type="button" key={key} disabled={loading || !!error} aria-current={step === key ? 'step' : undefined} onClick={() => onChange(key)}><span>{index + 1}</span>{title}</button>)}
    </nav>
    <p className="est-step-description">{BID_STEPS.find(s => s[0] === step)?.[2]}</p>
    <div className="est-readiness" aria-live="polite">{loading ? 'Loading package…' : error ? <><span role="alert">{error}</span><button type="button" onClick={onRetry}>Try again</button></> : <><span>{plans.length} documents</span><span>{accepted} of {items.length} scope items reviewed</span><span>{questions} open questions</span><span>{submissions.length} quotes received</span></>}</div>
  </div>
}

export function LocalAiNotice() {
  return <aside className="est-ai-notice" aria-label="Local AI status"><div><strong>Drawing-to-scope assistant</strong><span className="est-status">Not connected</span></div><p>Connect the Mac mini in the next phase to draft scope from your drawings. You can build, source, and review scope manually now.</p><button type="button" disabled>Draft scope from drawings</button><small>No drawings are sent to an AI provider. No paid fallback.</small></aside>
}

function ScopeItemEditor({ item, plans, onSave, onDelete, openPlan, onDirty }) {
  const review = item.scope_review || {}
  const [description, setDescription] = useState(item.description || '')
  const [notes, setNotes] = useState(review.notes || '')
  const [planId, setPlanId] = useState(review.source_plan_id || '')
  const [page, setPage] = useState(review.page || '')
  const [revision, setRevision] = useState(review.revision || '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const source = plans.find(p => p.id === planId)
  async function save(status) {
    if (!description.trim()) { setError('Enter the scope wording first.'); return }
    if (planId && !source) { setError('Select a replacement source document or choose manual scope before saving.'); return }
    if (status === 'question' && !notes.trim()) { setError('Describe the question so someone can resolve it.'); return }
    if (page && (!/^\d+$/.test(String(page)) || Number(page) < 1)) { setError('Use a positive page number.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await onSave(item.id, { description: description.trim(), scope_review: { status, notes: notes.trim(), source_plan_id: source?.id || null, source_name: source?.file_name || null, page: source ? String(page) : '', revision: source ? revision.trim() : '', reviewed_at: status === 'accepted' ? new Date().toISOString() : null } })
      onDirty(false)
      setMessage(status === 'accepted' ? 'Scope accepted and saved.' : status === 'question' ? 'Question saved.' : 'Draft saved.')
    } catch (e) { setError(e.message || 'Could not save scope. Your edits are still here.') }
    finally { setBusy(false) }
  }
  return <div className="est-scope-editor" onChange={() => onDirty(true)}>
    <div className="est-title-row"><h3>{item.trade || 'General scope'}</h3><span className="est-status">{review.status === 'accepted' ? 'Reviewed' : review.status === 'question' ? 'Question open' : 'Needs review'}</span></div>
    <div className="est-review-grid"><div>
      <label htmlFor={`scope-${item.id}`}>Scope wording</label><textarea id={`scope-${item.id}`} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
      <label htmlFor={`notes-${item.id}`}>Assumptions, exclusions, or questions</label><textarea id={`notes-${item.id}`} value={notes} onChange={e => setNotes(e.target.value)} disabled={busy} placeholder="Keep unconfirmed details separate from the agreed scope." />
      <div className="est-actions"><button type="button" disabled={busy} onClick={() => save('draft')}>Save draft</button><button className="est-primary" type="button" disabled={busy} onClick={() => save('accepted')}>Accept scope</button><button type="button" disabled={busy} onClick={() => save('question')}>Flag question</button></div>
      <p role="status">{busy ? 'Saving…' : message}</p>{error && <p role="alert" className="est-error">{error}</p>}
    </div><aside className="est-evidence">
      <h3>Drawing evidence</h3><label htmlFor={`source-${item.id}`}>Source document</label>
      <select id={`source-${item.id}`} value={planId} disabled={busy} onChange={e => { setPlanId(e.target.value); setPage(''); setRevision('') }}><option value="">Manual scope / no source linked</option>{plans.map(p => <option key={p.id} value={p.id}>{p.file_name}</option>)}</select>
      {planId && !source && <p className="est-error">The linked document is no longer in this package. Select its replacement before saving.</p>}
      {source && <><div className="est-source-fields"><div><label htmlFor={`page-${item.id}`}>PDF page</label><input id={`page-${item.id}`} type="number" min="1" step="1" value={page} disabled={busy} onChange={e => setPage(e.target.value)} /></div><div><label htmlFor={`rev-${item.id}`}>Sheet / revision</label><input id={`rev-${item.id}`} value={revision} disabled={busy} onChange={e => setRevision(e.target.value)} placeholder="A-101 / Rev 2" /></div></div><button type="button" onClick={() => openPlan(source.storage_path)}>Open source document &#x2197;</button></>}
      <p>Verify the current drawing revision before accepting. Linking a document does not verify its contents.</p>
      <button type="button" className="est-delete" disabled={busy} onClick={async () => { if (!window.confirm('Remove this scope item? Existing comparison entries may be affected.')) return; setBusy(true); try { await onDelete(item.id) } catch(e) { setError(e.message); setBusy(false) } }}>Remove scope item</button>
    </aside></div>
  </div>
}

export function ScopeReview({ items, plans, onSave, onDelete, openPlan, onDirtyChange }) {
  const [selectedId, setSelectedId] = useState(null)
  const [filter, setFilter] = useState('all')
  const [dirty, setDirty] = useState(false)
  function markDirty(value) { setDirty(value); onDirtyChange?.(value) }
  function mayNavigate() { if (dirty && !window.confirm('Discard unsaved scope changes?')) return false; markDirty(false); return true }
  useEffect(() => {
    if (!dirty) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  const visible = items.filter(i => filter === 'all' || (i.scope_review?.status || 'draft') === filter)
  const selected = visible.find(i => i.id === selectedId) || visible[0]
  return <div className="est-scope-review"><LocalAiNotice />
    {items.length > 0 ? <>
      <div className="est-review-filter"><label htmlFor="scope-review-filter">Review status</label><select id="scope-review-filter" value={filter} onChange={e => { if (mayNavigate()) setFilter(e.target.value) }}><option value="all">All scope items</option><option value="draft">Needs review</option><option value="question">Questions</option><option value="accepted">Reviewed</option></select></div>
      <div className="est-scope-list" aria-label="Scope items">{visible.map(item => <button type="button" key={item.id} aria-pressed={selected?.id === item.id} onClick={() => { if (selected?.id !== item.id && mayNavigate()) setSelectedId(item.id) }}><span>{item.trade || 'General'}</span>{item.description}</button>)}</div>
      {selected ? <ScopeItemEditor key={selected.id} item={selected} plans={plans} onSave={onSave} onDelete={async id => { await onDelete(id); markDirty(false) }} openPlan={openPlan} onDirty={markDirty} /> : <p className="est-empty">No scope items match this status.</p>}
    </> : <p className="est-empty">Start with a scope template or add your first item above. Each item can be linked to a drawing and reviewed here.</p>}
  </div>
}

export function QuickEstimateIntro() {
  return <div className="est-quick-intro"><h2>Quick estimates</h2><p>A short route from scope and costs to a customer proposal.</p><ol><li>Customer &amp; project</li><li>Scope &amp; pricing</li><li>Preview &amp; proposal</li></ol></div>
}
