'use client'
// PM-side panels for a subcontractor company with several people.
//
// CompanyPeoplePanel — everyone at the company (portal users, contacts,
//   directory contacts) with per-person job access and billing permission.
//   With jobId it also walks the four assignment stages for that job:
//   1 company on job → 2 who can see it → 3 billing on/off → 4 notify.
//   Stages 1–3 never send email.
// CompanyEmailPanel — checkbox recipient picker for every email we send a sub
//   company (custom message, "billing is open", portal invite).
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '../../lib/client-fetch'
import { sendEmail, billingOpenEmail } from '../../lib/email'

const c = {
  text: '#111827', muted: '#6b7280', border: '#e5e7eb', soft: '#f9fafb',
  orange: '#e8590c', green: '#16a34a', blue: '#1d4ed8', red: '#dc2626',
}
const st = {
  btn: { padding: '6px 12px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', cursor: 'pointer', border: `1px solid ${c.border}`, background: '#fff', color: c.text, minHeight: '32px' },
  btnOrange: { padding: '6px 12px', fontSize: '12px', fontWeight: 700, borderRadius: '6px', cursor: 'pointer', border: `1px solid ${c.orange}`, background: c.orange, color: '#fff', minHeight: '32px' },
  input: { width: '100%', padding: '8px 10px', fontSize: '16px', border: `1px solid #d1d5db`, borderRadius: '6px', boxSizing: 'border-box', background: '#fff', color: c.text },
  label: { display: 'block', fontSize: '11px', fontWeight: 600, color: c.muted, marginBottom: '4px', letterSpacing: '0.5px', textTransform: 'uppercase' },
  badge: (bg, fg, bd) => ({ display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '1px 7px', borderRadius: '99px', background: bg, color: fg, border: `1px solid ${bd}`, whiteSpace: 'nowrap' }),
  note: { fontSize: '12px', color: c.muted, margin: '4px 0 0', lineHeight: 1.5 },
}

const displayName = p => p.name || p.email || 'Unnamed'
const fmtMoney = n => Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function SourceBadges({ p }) {
  return (
    <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap' }}>
      {p.has_login
        ? (p.last_sign_in_at
          ? <span style={st.badge('#dcfce7', c.green, '#bbf7d0')}>Portal login</span>
          : <span style={st.badge('#fff7ed', c.orange, '#fed7aa')}>Invited, not logged in</span>)
        : <span style={st.badge('#f3f4f6', c.muted, c.border)}>No portal login</span>}
      {p.sources.includes('contact') && <span style={st.badge('#eff6ff', c.blue, '#bfdbfe')}>Contact</span>}
      {p.sources.includes('directory') && <span style={st.badge('#eff6ff', c.blue, '#bfdbfe')}>Directory contact</span>}
      {p.has_login && p.linked_to_company === false && <span style={st.badge('#fef2f2', c.red, '#fecaca')}>Not linked to company</span>}
    </span>
  )
}

export function CompanyPeoplePanel({ companyId, companyName, contactEmail = null, jobId = null, jobLabel = '', onChanged }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ full_name: '', email: '', phone: '', title: '' })
  const [addInvite, setAddInvite] = useState(false)
  const [emailKind, setEmailKind] = useState(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (companyId) params.set('company_id', companyId)
    else if (companyName) params.set('company_name', companyName)
    if (contactEmail) params.set('email', contactEmail)
    if (jobId) params.set('job_id', jobId)
    const res = await authFetch(`/api/company-people?${params}`)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error || 'Could not load people'); return }
    setErr('')
    setData(json)
  }, [companyId, companyName, contactEmail, jobId])

  useEffect(() => { load() }, [load])

  function flash(text) { setMsg(text); setTimeout(() => setMsg(m => (m === text ? '' : m)), 5000) }

  async function call(key, url, method, body, okText) {
    setBusy(key)
    const res = await authFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { setErr(json.error || 'Save failed'); return false }
    setErr('')
    if (okText) flash(okText)
    await load()
    onChanged?.()
    return true
  }

  async function addPerson() {
    const ok = await call('add', '/api/company-people', 'POST', { company_id: data.company.id, ...addForm }, addInvite ? null : 'Person added. No email sent.')
    if (!ok) return
    if (addInvite && addForm.email.trim()) {
      setBusy('add')
      const res = await authFetch('/api/invite-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: addForm.email.trim(), company_id: data.company.id, company_name: data.company.name, full_name: addForm.full_name.trim() || undefined }) })
      setBusy(null)
      if (res.ok) flash(`Added, and portal invite sent to ${addForm.email.trim()}.`)
      else setErr(`Added as a contact, but the invite failed: ${(await res.json().catch(() => ({}))).error || res.status}`)
      await load()
      onChanged?.()
    }
    setShowAdd(false); setAddInvite(false); setAddForm({ full_name: '', email: '', phone: '', title: '' })
  }

  const jobAction = (action, extra, okText) => call(action + (extra?.user_id || ''), '/api/company-job-access', 'POST', { job_id: jobId, company_id: data.company.id, action, ...extra }, okText)

  if (err && !data) return <p style={{ fontSize: '13px', color: c.red }}>{err}</p>
  if (!data) return <p style={{ fontSize: '13px', color: c.muted }}>Loading people…</p>

  const company = data.company
  const people = data.people || []
  const job = data.job
  const canEdit = !!company?.id
  const portalUsers = people.filter(p => p.has_login)
  const seeing = job ? portalUsers.filter(p => p.job?.sees_job) : []
  const billers = job ? portalUsers.filter(p => p.job?.can_bill_job) : []
  const names = list => list.map(displayName).join(', ')

  return (
    <div>
      {!canEdit && (
        <p style={{ fontSize: '12px', color: c.red, margin: '0 0 10px' }}>
          No company record matches “{companyName}”, so people and access can't be managed here yet. Use Directory → Fix Company Links to create or link it.
        </p>
      )}
      {err && <p style={{ fontSize: '12px', color: c.red, margin: '0 0 8px' }}>{err}</p>}
      {msg && <p style={{ fontSize: '12px', color: c.green, margin: '0 0 8px', fontWeight: 600 }}>{msg}</p>}

      {job && canEdit && (
        <ol style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: '6px' }}>
          <Stage n={1} title="Company on this job" done={job.on_job} detail={job.on_job ? 'On the job. No email was sent.' : 'Not on this job yet.'}>
            {!job.on_job && <button style={st.btnOrange} disabled={busy === 'add_company'} onClick={() => jobAction('add_company', {}, `${company.name} added to the job. No email sent.`)}>Add company to job</button>}
            {job.on_job && <button style={{ ...st.btn, color: c.red }} disabled={busy === 'remove_company'}
              onClick={() => window.confirm(`Remove ${company.name} and everyone at it from this job?\n\nNo email is sent. An active subcontract on the job still gives them access until it's moved back to draft.`) && jobAction('remove_company', {}, `${company.name} removed from the job. No email sent.`)}>Remove from job</button>}
          </Stage>
          <Stage n={2} title="Who can see this job" done={seeing.length > 0}
            detail={seeing.length ? `${names(seeing)}` : 'No portal user can see it yet. Set people below.'}
            sub="Set per person in the table: “All company jobs” or “Only assigned jobs” + tick this job. No email is sent." />
          <Stage n={3} title="Billing on this job" done={job.billing_on}
            detail={job.billing_on
              ? (billers.length ? `On. Can submit billing: ${names(billers)}` : 'On, but nobody with access is allowed to bill yet.')
              : 'Off. They can view the job but not submit billing.'}
            sub={`No email is sent when you change this.${job.contract_total ? ` Active subcontracts: ${fmtMoney(job.contract_total)}.` : ' No active subcontract yet; they will see “No subcontract on file” until one is activated.'}`}>
            {job.on_job && (job.billing_on
              ? <button style={st.btn} disabled={busy === 'billing'} onClick={() => window.confirm(`Turn billing off for ${company.name} on this job?\n\nThey keep access but can't submit billing. No email is sent.`) && jobAction('billing', { enabled: false }, 'Billing turned off. No email sent.')}>Turn billing off</button>
              : <button style={st.btnOrange} disabled={busy === 'billing'} onClick={() => jobAction('billing', { enabled: true }, 'Billing turned on. No email sent. Use step 4 to tell them.')}>Turn billing on</button>)}
          </Stage>
          <Stage n={4} title="Notify" done={false} detail="Pick exactly who gets an email. Nothing is sent until you press Send.">
            <button style={st.btn} onClick={() => setEmailKind(job.billing_on ? 'billing_open' : 'message')}>Email people at {company.name}…</button>
          </Stage>
        </ol>
      )}

      {emailKind && (
        <CompanyEmailPanel
          companyId={company?.id} companyName={company?.name || companyName} people={people}
          job={job ? { id: jobId, project_name: jobLabel, contract_total: job.contract_total, billing_on: job.billing_on } : null}
          initialKind={emailKind}
          onClose={() => setEmailKind(null)}
          onSent={text => { setEmailKind(null); flash(text); load() }}
        />
      )}

      <div style={{ border: `1px solid ${c.border}`, borderRadius: '8px', overflow: 'hidden' }}>
        {people.length === 0 && <p style={{ fontSize: '13px', color: c.muted, padding: '12px', margin: 0 }}>No people on file for this company yet.</p>}
        {people.map(p => (
          <div key={p.key} style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', padding: '10px 12px', borderTop: `1px solid ${c.border}`, background: '#fff' }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: c.text }}>{displayName(p)}{p.title ? <span style={{ fontWeight: 400, color: c.muted }}> · {p.title}</span> : null}</div>
              <div style={{ fontSize: '12px', color: c.muted, overflowWrap: 'anywhere' }}>{[p.name && p.email, p.phone].filter(Boolean).join(' · ')}</div>
              <div style={{ marginTop: '4px' }}><SourceBadges p={p} /></div>
            </div>

            {p.has_login ? (
              <>
                <label style={{ fontSize: '12px', color: c.text, display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 0 auto' }}>
                  <span style={{ ...st.label, marginBottom: 0 }}>Jobs they see (all jobs)</span>
                  <select style={{ ...st.input, width: 'auto', padding: '6px 8px' }} value={p.job_access} disabled={!canEdit || busy === 'ja' + p.user_id}
                    onChange={e => call('ja' + p.user_id, '/api/company-people', 'PATCH', { user_id: p.user_id, job_access: e.target.value },
                      e.target.value === 'company' ? `${displayName(p)} now sees all ${company.name} jobs.` : `${displayName(p)} now sees only jobs they're assigned to by name.`)}>
                    <option value="company">All company jobs</option>
                    <option value="assigned">Only assigned jobs</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: c.text, cursor: 'pointer' }} title="Applies to every job this person can see">
                  <input type="checkbox" checked={p.can_bill} disabled={!canEdit || busy === 'cb' + p.user_id}
                    onChange={e => call('cb' + p.user_id, '/api/company-people', 'PATCH', { user_id: p.user_id, can_bill: e.target.checked },
                      e.target.checked ? `${displayName(p)} can submit billing.` : `${displayName(p)} is now view-only for billing.`)} />
                  Can submit billing
                </label>
                {job && (
                  <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                    {p.job_access === 'assigned' ? (
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={p.job.assigned_by_name} disabled={!canEdit || !job.on_job || busy?.endsWith(p.user_id)}
                          onChange={e => jobAction(e.target.checked ? 'grant_person' : 'revoke_person', { user_id: p.user_id },
                            e.target.checked ? `${displayName(p)} can now see this job. No email sent.` : `${displayName(p)} no longer sees this job. No email sent.`)} />
                        Assigned to this job
                      </label>
                    ) : (
                      <span style={{ fontSize: '12px', color: c.muted }}>{p.job.sees_job ? 'Sees this job (all company jobs)' : job.on_job ? '—' : 'Company not on job'}</span>
                    )}
                    <span style={p.job.can_bill_job ? st.badge('#dcfce7', c.green, '#bbf7d0') : p.job.sees_job ? st.badge('#eff6ff', c.blue, '#bfdbfe') : st.badge('#f3f4f6', c.muted, c.border)}>
                      {p.job.can_bill_job ? 'Can bill this job' : p.job.sees_job ? 'View only on this job' : 'No access to this job'}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <span style={{ fontSize: '12px', color: c.muted, flex: '0 1 220px' }}>No login: gets emails only. To give them a login{job ? ' and access to this job' : ''}, use Email → Portal invite.</span>
            )}

            {p.contact_id && canEdit && (
              <button style={{ ...st.btn, color: c.red }} disabled={busy === 'rm' + p.contact_id}
                onClick={() => window.confirm(`Remove ${displayName(p)} from ${company.name}'s contacts? Their portal login (if any) is not affected.`) && call('rm' + p.contact_id, '/api/company-people', 'DELETE', { contact_id: p.contact_id }, 'Contact removed.')}>
                Remove contact
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {canEdit && !showAdd && <button style={st.btn} onClick={() => setShowAdd(true)}>+ Add person</button>}
        {!job && people.length > 0 && <button style={st.btn} onClick={() => setEmailKind('message')}>Email people at {company?.name || companyName}…</button>}
      </div>
      {showAdd && canEdit && (
        <div style={{ marginTop: '10px', border: `1px solid ${c.border}`, borderRadius: '8px', padding: '12px', background: c.soft }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
            {[['full_name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['title', 'Title (e.g. Field PM)']].map(([k, l]) => (
              <div key={k}><label style={st.label}>{l}</label><input style={st.input} type={k === 'email' ? 'email' : 'text'} value={addForm[k]} onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button style={st.btnOrange} disabled={busy === 'add' || (!addForm.full_name.trim() && !addForm.email.trim()) || (addInvite && !addForm.email.trim())}
              onClick={addPerson}>
              {addInvite ? 'Save and send portal invite' : 'Save (no email)'}
            </button>
            <button style={st.btn} onClick={() => { setShowAdd(false); setAddInvite(false) }}>Cancel</button>
          </div>
          <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '13px', color: c.text, marginTop: '10px', cursor: 'pointer' }}>
            <input type="checkbox" checked={addInvite} onChange={e => setAddInvite(e.target.checked)} style={{ marginTop: '3px' }} />
            <span>Also give them a portal login now (emails {addForm.email.trim() || 'them'} a link to set a password; they'll be linked to {company.name})</span>
          </label>
          <p style={{ ...st.note, fontWeight: 600, color: addInvite && addForm.email.trim() ? '#c2410c' : c.green }}>
            {addInvite && addForm.email.trim() ? `An email WILL be sent to ${addForm.email.trim()}.` : 'No email will be sent. They will appear as a recipient in every “Email people” list for this company.'}
          </p>
        </div>
      )}
    </div>
  )
}

function Stage({ n, title, done, detail, sub, children }) {
  return (
    <li style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', flexWrap: 'wrap', padding: '10px 12px', border: `1px solid ${done ? '#bbf7d0' : c.border}`, borderRadius: '8px', background: done ? '#f0fdf4' : c.soft }}>
      <span style={{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, background: done ? c.green : '#fff', color: done ? '#fff' : c.muted, border: `1px solid ${done ? c.green : '#d1d5db'}` }}>{done ? '✓' : n}</span>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: c.text }}>{title}</div>
        <div style={{ fontSize: '12px', color: c.text, marginTop: '2px', overflowWrap: 'anywhere' }}>{detail}</div>
        {sub && <div style={{ fontSize: '11px', color: c.muted, marginTop: '2px' }}>{sub}</div>}
      </div>
      {children && <div style={{ flexShrink: 0 }}>{children}</div>}
    </li>
  )
}

const KINDS = {
  message: { label: 'Custom message', help: 'Your subject and message.' },
  billing_open: { label: 'Billing is open', help: 'Tells them billing is open on this job and to set up their Schedule of Values.' },
  portal_invite: { label: 'Portal invite', help: 'Email with a link to set a password. Creates a login linked to this company (or a reset link if they already have one).' },
}

function defaultsFor(kind, people, job) {
  const withEmail = people.filter(p => p.email)
  let pick = []
  if (kind === 'billing_open') {
    pick = withEmail.filter(p => p.job?.can_bill_job)
    if (!pick.length) pick = withEmail.filter(p => p.has_login)
  } else if (kind === 'portal_invite') {
    pick = withEmail.filter(p => !p.has_login)
  } else {
    pick = job ? withEmail.filter(p => p.job?.sees_job || !p.has_login) : withEmail
  }
  if (!pick.length && kind !== 'portal_invite') pick = withEmail
  return new Set(pick.map(p => p.email))
}

export function CompanyEmailPanel({ companyId, companyName, people, job = null, initialKind = 'message', onClose, onSent }) {
  const [kind, setKind] = useState(initialKind)
  const [selected, setSelected] = useState(() => defaultsFor(initialKind, people, job))
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  const withEmail = people.filter(p => p.email)
  const noEmail = people.filter(p => !p.email)
  const chosen = withEmail.filter(p => selected.has(p.email))
  const kinds = Object.keys(KINDS).filter(k => k !== 'billing_open' || job)
  const ready = chosen.length > 0 && (kind !== 'message' || (subject.trim() && message.trim()))

  function switchKind(k) { setKind(k); setSelected(defaultsFor(k, people, job)); setErr('') }
  function toggle(email) { setSelected(prev => { const n = new Set(prev); n.has(email) ? n.delete(email) : n.add(email); return n }) }

  async function send() {
    setSending(true)
    setErr('')
    const sent = []
    const failed = []
    if (kind === 'message') {
      const res = await authFetch('/api/notify-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipients: chosen.map(p => ({ email: p.email, name: p.name })), company_name: companyName, subject, message }) })
      const json = await res.json().catch(() => ({}))
      if (res.ok) { sent.push(...(json.sent || [])); failed.push(...(json.failed || []).map(f => f.email)) } else failed.push(...chosen.map(p => p.email))
    } else if (kind === 'billing_open') {
      for (const p of chosen) {
        const { subject: subj, html } = billingOpenEmail({ firstName: p.name?.split(' ')[0], projectName: job?.project_name, contractAmt: job?.contract_total ? fmtMoney(job.contract_total) : null })
        await sendEmail(p.email, subj, html)
        sent.push(p.email)
      }
    } else {
      for (const p of chosen) {
        const res = await authFetch('/api/invite-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: p.email, company_id: companyId || undefined, company_name: companyName, full_name: p.name || undefined }) })
        if (res.ok) sent.push(p.email); else failed.push(p.email)
      }
    }
    setSending(false)
    if (!sent.length) { setErr(`Nothing was sent${failed.length ? ` (failed: ${failed.join(', ')})` : ''}.`); return }
    onSent?.(`${KINDS[kind].label} email sent to ${sent.join(', ')}.${failed.length ? ` Failed: ${failed.join(', ')}.` : ''}`)
  }

  return (
    <div style={{ border: '1px solid #bfdbfe', background: '#eff6ff', borderRadius: '8px', padding: '12px', margin: '0 0 12px' }}>
      <p style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: '#2563eb', letterSpacing: '1px', textTransform: 'uppercase' }}>
        Email people at {companyName}{job?.project_name ? ` · ${job.project_name}` : ''}
      </p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {kinds.map(k => (
          <button key={k} type="button" onClick={() => switchKind(k)}
            style={{ ...st.btn, background: kind === k ? '#1d4ed8' : '#fff', color: kind === k ? '#fff' : c.text, borderColor: kind === k ? '#1d4ed8' : c.border }}>
            {KINDS[k].label}
          </button>
        ))}
      </div>
      <p style={{ ...st.note, margin: '0 0 8px' }}>{KINDS[kind].help}</p>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', margin: '0 0 6px' }}>
        <span style={st.label}>Recipients</span>
        <button type="button" style={{ ...st.btn, minHeight: 0, padding: '2px 8px' }} onClick={() => setSelected(new Set(withEmail.map(p => p.email)))}>All</button>
        <button type="button" style={{ ...st.btn, minHeight: 0, padding: '2px 8px' }} onClick={() => setSelected(new Set())}>None</button>
      </div>
      <div style={{ background: '#fff', border: `1px solid ${c.border}`, borderRadius: '6px', maxHeight: '260px', overflowY: 'auto' }}>
        {withEmail.map(p => (
          <label key={p.email} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', borderTop: `1px solid ${c.border}`, cursor: 'pointer' }}>
            <input type="checkbox" checked={selected.has(p.email)} onChange={() => toggle(p.email)} style={{ marginTop: '3px' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: c.text }}>{p.name || p.email}</span>
              {p.name && <span style={{ fontSize: '12px', color: c.muted, overflowWrap: 'anywhere' }}> &lt;{p.email}&gt;</span>}
              <span style={{ display: 'block', marginTop: '2px' }}>
                <SourceBadges p={p} />
                {p.job?.can_bill_job && <span style={{ ...st.badge('#dcfce7', c.green, '#bbf7d0'), marginLeft: '4px' }}>Can bill this job</span>}
              </span>
            </span>
          </label>
        ))}
        {withEmail.length === 0 && <p style={{ fontSize: '13px', color: c.muted, padding: '10px', margin: 0 }}>Nobody at this company has an email on file.</p>}
      </div>
      {noEmail.length > 0 && <p style={st.note}>No email on file (can't be selected): {noEmail.map(displayName).join(', ')}</p>}

      {kind === 'message' && (
        <div style={{ marginTop: '10px' }}>
          <label style={st.label}>Subject</label>
          <input style={st.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. COI renewal needed" />
          <label style={{ ...st.label, marginTop: '8px' }}>Message</label>
          <textarea style={{ ...st.input, minHeight: '80px', resize: 'vertical' }} value={message} onChange={e => setMessage(e.target.value)} />
        </div>
      )}

      <p style={{ fontSize: '12px', margin: '10px 0', fontWeight: 600, color: chosen.length ? '#c2410c' : c.muted, overflowWrap: 'anywhere' }}>
        {chosen.length
          ? `An email WILL be sent to ${chosen.length} ${chosen.length === 1 ? 'person' : 'people'}: ${chosen.map(p => p.name ? `${p.name} <${p.email}>` : p.email).join(', ')}`
          : 'No one selected. No email will be sent.'}
      </p>
      {err && <p style={{ fontSize: '12px', color: c.red, margin: '0 0 8px' }}>{err}</p>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="button" style={{ ...st.btnOrange, opacity: ready && !sending ? 1 : 0.5 }} disabled={!ready || sending} onClick={send}>
          {sending ? 'Sending…' : `Send to ${chosen.length}`}
        </button>
        <button type="button" style={st.btn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}
