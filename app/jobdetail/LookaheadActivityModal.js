'use client'
import React, { useState } from 'react'
import { uniqueSubOptions, subName, activityProblem, PRECEDING_WORK_HELP, COMMITTED_HELP } from '../../lib/lookahead-fields'
import { rangeLabel } from '../../lib/lookahead-dates'
import { ActivityDateFields, FormHint } from '../components/lookahead/LookaheadShared'

// Add/Edit Activity form for the job page Lookahead tab. The form state lives here,
// not in the job page, so typing re-renders only this modal.
// onSave(form) resolves to { error } on failure (the form stays open with the input kept).
export default function LookaheadActivityModal({ s, initialForm, editing, contracts, companyEquipment, onSave, onDelete, onDuplicate, onClose }) {
  const [activityForm, setActivityForm] = useState(initialForm)
  const [newCoName, setNewCoName] = useState('')
  const [newCoManpower, setNewCoManpower] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const subOptions = uniqueSubOptions(contracts, activityForm.sub_id)
  const problem = activityProblem(activityForm)
  const help = { fontSize: '11px', color: '#6b7280', margin: '2px 0 0 24px', lineHeight: 1.4 }
  const checkRow = { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: '#374151', cursor: 'pointer' }

  function addCompany() {
    if (!newCoName.trim()) return
    setActivityForm(f => ({ ...f, additional_companies: [...(f.additional_companies || []), { name: newCoName.trim(), manpower: parseInt(newCoManpower) || 0 }] }))
    setNewCoName('')
    setNewCoManpower('')
  }

  async function save() {
    if (problem) return
    setSaving(true)
    setError('')
    const result = await onSave(activityForm)
    setSaving(false)
    if (result?.error) setError(result.error)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#111827' }}>{editing ? 'Edit Activity' : 'Add Activity'} — {(activityForm.planned_date && rangeLabel(activityForm)) || new Date((activityForm.planned_date || '') + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '22px', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={s.label}>Description *</label>
            <input style={s.input} value={activityForm.description || ''} onChange={e => setActivityForm(f => ({ ...f, description: e.target.value }))} placeholder="Pour slab, set steel, frame walls..." />
          </div>
          <ActivityDateFields form={activityForm} setForm={setActivityForm} labelStyle={s.label} inputStyle={s.input} />
          <div>
            <label style={s.label}>Location on Site</label>
            <input style={s.input} value={activityForm.location || ''} onChange={e => setActivityForm(f => ({ ...f, location: e.target.value }))} placeholder="Level 2 west, Grid B–D..." />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={s.label}>Responsible</label>
              <select style={{ ...s.input, padding: '8px 10px' }} value={activityForm.responsible_type || 'own_crew'} onChange={e => setActivityForm(f => ({ ...f, responsible_type: e.target.value, sub_id: '', other_company_name: '' }))}>
                <option value="own_crew">Own Crew</option>
                <option value="sub">Subcontractor</option>
                <option value="other">Other Company</option>
              </select>
            </div>
            <div>
              {activityForm.responsible_type === 'sub' ? (
                <>
                  <label style={s.label}>Subcontractor *</label>
                  <select style={{ ...s.input, padding: '8px 10px' }} value={activityForm.sub_id || ''} onChange={e => setActivityForm(f => ({ ...f, sub_id: e.target.value }))}>
                    <option value="">— Select —</option>
                    {subOptions.map(c => <option key={c.id} value={c.id}>{subName(c)}</option>)}
                  </select>
                </>
              ) : activityForm.responsible_type === 'other' ? (
                <>
                  <label style={s.label}>Company Name</label>
                  <input style={s.input} value={activityForm.other_company_name || ''} onChange={e => setActivityForm(f => ({ ...f, other_company_name: e.target.value }))} placeholder="Xcel Energy, AT&T, City Inspector..." />
                </>
              ) : (
                <>
                  <label style={s.label}>Manpower (# people)</label>
                  <input style={s.input} type="number" min="0" value={activityForm.manpower || ''} onChange={e => setActivityForm(f => ({ ...f, manpower: parseInt(e.target.value) || 0 }))} placeholder="4" />
                </>
              )}
            </div>
          </div>
          {(activityForm.responsible_type === 'sub' || activityForm.responsible_type === 'other') && (
            <div>
              <label style={s.label}>Manpower (# people)</label>
              <input style={s.input} type="number" min="0" value={activityForm.manpower || ''} onChange={e => setActivityForm(f => ({ ...f, manpower: parseInt(e.target.value) || 0 }))} placeholder="4" />
            </div>
          )}
          <div>
            <label style={s.label}>Rented / External Equipment</label>
            <input style={s.input} value={activityForm.equipment || ''} onChange={e => setActivityForm(f => ({ ...f, equipment: e.target.value }))} placeholder="Concrete pump, scissor lift, forklift..." />
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ ...s.label, margin: 0 }}>Additional Companies on Site</label>
              <button
                type="button"
                onClick={addCompany}
                style={{ background: '#1a2e4a', border: '1px solid #2d4a6a', color: '#2563eb', borderRadius: '6px', fontSize: '11px', padding: '4px 10px', cursor: 'pointer', fontWeight: 600 }}>
                + Add Company
              </button>
            </div>
            {(activityForm.additional_companies || []).map((co, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f0f0f0', border: '1px solid #d1d5db', borderRadius: '6px', padding: '6px 10px', marginBottom: '6px', fontSize: '13px', color: '#374151' }}>
                <span>{co.name}{co.manpower > 0 ? <span style={{ color: '#4b5563', marginLeft: '6px' }}>👷{co.manpower}</span> : null}</span>
                <button type="button" onClick={() => setActivityForm(f => ({ ...f, additional_companies: (f.additional_companies || []).filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '16px', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>×</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <input style={{ ...s.input, flex: 1 }} value={newCoName} onChange={e => setNewCoName(e.target.value)} placeholder="Company name (Xcel Energy, AT&T...)" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCompany() } }} />
              <input style={{ ...s.input, width: '160px', flexShrink: 0 }} type="number" min="0" value={newCoManpower} onChange={e => setNewCoManpower(e.target.value)} placeholder="Manpower (# people)" />
            </div>
          </div>
          <div>
            <label style={s.label}>Company Equipment Needed</label>
            {companyEquipment.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#6b7280', padding: '8px 0' }}>No company equipment added yet — use the ⚙ Equipment button in the header to add your fleet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                {companyEquipment.map(eq => (
                  <label key={eq.id} style={checkRow}>
                    <input type="checkbox"
                      checked={(activityForm.company_equipment_ids || []).includes(eq.id)}
                      onChange={e => {
                        const checked = e.target.checked
                        setActivityForm(f => {
                          const ids = f.company_equipment_ids || []
                          return { ...f, company_equipment_ids: checked ? [...ids, eq.id] : ids.filter(i => i !== eq.id) }
                        })
                      }}
                    />
                    <span>{eq.name}</span>
                    {eq.category && <span style={{ fontSize: '11px', color: '#6b7280' }}>({eq.category})</span>}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div>
            <label style={s.label}>Materials Status</label>
            <select style={{ ...s.input, padding: '8px 10px' }} value={activityForm.materials_status || 'needed'} onChange={e => setActivityForm(f => ({ ...f, materials_status: e.target.value }))}>
              <option value="needed">Need to Order</option>
              <option value="ordered">Ordered</option>
              <option value="on_site">On Site</option>
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <label style={checkRow}>
              <input type="checkbox" checked={!!activityForm.inspection_required} onChange={e => setActivityForm(f => ({ ...f, inspection_required: e.target.checked }))} />
              Inspection Required
            </label>
            {activityForm.inspection_required && (
              <label style={{ ...checkRow, paddingLeft: '20px' }}>
                <input type="checkbox" checked={!!activityForm.inspection_scheduled} onChange={e => setActivityForm(f => ({ ...f, inspection_scheduled: e.target.checked }))} />
                Inspection Scheduled
              </label>
            )}
            <div>
              <label style={checkRow}>
                <input type="checkbox" checked={!!activityForm.preceding_work_complete} onChange={e => setActivityForm(f => ({ ...f, preceding_work_complete: e.target.checked }))} />
                Preceding Work Complete
              </label>
              <div style={help}>{PRECEDING_WORK_HELP}</div>
            </div>
            <div>
              <label style={checkRow}>
                <input type="checkbox" checked={!!activityForm.committed} onChange={e => setActivityForm(f => ({ ...f, committed: e.target.checked }))} />
                Committed
              </label>
              <div style={help}>{COMMITTED_HELP}</div>
            </div>
          </div>
          <div>
            <label style={s.label}>Constraints</label>
            <textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={activityForm.constraints || ''} onChange={e => setActivityForm(f => ({ ...f, constraints: e.target.value }))} placeholder="Missing approvals, material delays, weather concerns..." />
          </div>
          <div>
            <label style={s.label}>Notes</label>
            <textarea style={{ ...s.input, minHeight: '60px', resize: 'vertical' }} value={activityForm.constraints_notes || ''} onChange={e => setActivityForm(f => ({ ...f, constraints_notes: e.target.value }))} placeholder="Anything else the crew should know" />
          </div>
        </div>
        {error && (
          <div style={{ marginTop: '16px', padding: '10px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#b91c1c', fontSize: '13px' }}>
            Could not save: {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {editing && (
              <button onClick={() => { onDelete(editing.id); onClose() }}
                style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#4b5563', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>Delete</button>
            )}
            {editing && onDuplicate && (
              <button onClick={() => { onDuplicate(editing); onClose() }}
                style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#4b5563', padding: '8px 14px', cursor: 'pointer', fontSize: '13px' }}>Duplicate</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', color: '#6b7280', padding: '8px 16px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            <button onClick={save} disabled={saving || !!problem} style={{ ...s.btn, opacity: problem ? 0.5 : 1 }}>
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Activity'}
            </button>
          </div>
        </div>
        <FormHint problem={problem} />
      </div>
    </div>
  )
}
