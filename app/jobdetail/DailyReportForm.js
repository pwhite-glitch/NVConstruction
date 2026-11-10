'use client'
import React, { useState } from 'react'
import { localToday } from '../../lib/lookahead-dates'
import {
  WEATHER, emptyDailyForm, emptyCrewRow, emptyEquipmentRow, emptyMaterialRow, emptyVisitorRow, emptySubActivityRow,
  filledCrew, filledSubActivity, duplicateReportMessage, uniquePhotoName, thumbPath,
} from '../../lib/daily-report-payload'

const BUCKET = 'daily-report-photos'

const DEFAULT_STYLES = {
  label: { display: 'block', fontSize: '12px', fontWeight: '500', color: '#374151', marginBottom: '5px' },
  input: { width: '100%', padding: '9px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', color: '#111827', boxSizing: 'border-box', outline: 'none' },
  btn: { padding: '9px 20px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnGray: { padding: '9px 20px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  btnSmall: { padding: '5px 12px', background: '#f9fafb', color: '#374151', border: '1px solid #e5e7eb', borderRadius: '5px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
}

// Same compression as the field app (full 1200px + 400px thumb, JPEG).
function compressImage(file, maxWidth = 1200, quality = 0.82) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        blob => resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })),
        'image/jpeg', quality
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

const removeBtn = { background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '18px', padding: 0 }

// New daily report from the job page (commercial jobdetail + residentialjobdetail).
// Photos upload to daily-report-photos `{jobId}/{unique}.jpg` (+ thumb) on submit, then the
// report is POSTed to /api/daily-reports, which enforces job assignment and sets the filer.
// Each photo element may carry internal_only (prompt73) — "Internal only" stamps it.
export default function DailyReportForm({ jobId, styles, supabase, authFetch, existingDates = [], onSuccess, onCancel, disabled = false }) {
  const s = { ...DEFAULT_STYLES, ...(styles || {}) }
  const [form, setForm] = useState(() => emptyDailyForm(localToday()))
  const [crew, setCrew] = useState([emptyCrewRow()])
  const [subs, setSubs] = useState([])
  const [equipment, setEquipment] = useState([])
  const [materials, setMaterials] = useState([])
  const [visitors, setVisitors] = useState([])
  const [photos, setPhotos] = useState([]) // [{ file, name, internal_only, path? }] — path once uploaded
  const [photosInternal, setPhotosInternal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const rowSetter = setter => (i, k) => e => setter(l => l.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))
  const rowRemover = setter => i => () => setter(l => l.filter((_, j) => j !== i))

  function addFiles(files) {
    if (!files.length) return
    setPhotos(prev => [...prev, ...files.map(file => ({ file, name: file.name, ...(photosInternal ? { internal_only: true } : {}) }))])
  }

  // Uploads photos not yet uploaded (a retry after a failed POST reuses earlier uploads).
  async function uploadPending(list) {
    const ts = Date.now()
    const out = [...list]
    for (const [i, p] of list.entries()) {
      if (p.path) continue
      const path = `${jobId}/${uniquePhotoName(ts, i)}`
      const [full, thumb] = await Promise.all([compressImage(p.file, 1200, 0.82), compressImage(p.file, 400, 0.72)])
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, full)
      if (upErr) { setPhotos(out); throw new Error(`Photo "${p.name}" did not upload: ${upErr.message}`) }
      await supabase.storage.from(BUCKET).upload(thumbPath(path), thumb)
      out[i] = { ...p, path }
    }
    return out
  }

  async function submit(e) {
    if (e?.preventDefault) e.preventDefault()
    if (saving || disabled) return
    setError('')
    if (!form.report_date) { setError('Report date is required.'); return }
    if (!form.work_performed.trim()) { setError('Work performed is required.'); return }
    const dup = duplicateReportMessage(form.report_date, existingDates)
    if (dup && !window.confirm(dup)) return
    setSaving(true)
    try {
      let uploaded = photos
      if (photos.some(p => !p.path)) {
        setStatus('Uploading photos…')
        uploaded = await uploadPending(photos)
        setPhotos(uploaded)
      }
      setStatus('Saving…')
      const res = await authFetch('/api/daily-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: jobId,
          ...form,
          crew_log: crew,
          subcontractor_activity: subs,
          equipment_log: equipment,
          materials_delivered: materials,
          visitors,
          // jsonb elements: { path, caption, name, internal_only? } — same as field
          photos: uploaded.map(p => ({ path: p.path, caption: '', name: p.name, ...(typeof p.internal_only === 'boolean' ? { internal_only: p.internal_only } : {}) })),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || `Could not save daily report (server returned ${res.status}).`)
      if (data.warning) alert(data.warning)
      setForm(emptyDailyForm(localToday()))
      setCrew([emptyCrewRow()]); setSubs([]); setEquipment([]); setMaterials([]); setVisitors([]); setPhotos([]); setPhotosInternal(false)
      onSuccess?.(data.report)
    } catch (err) {
      setError(err.message || 'Could not save daily report.')
    } finally {
      setSaving(false)
      setStatus('')
    }
  }

  const section = (label, onAdd, children) => (
    <div style={{ marginBottom: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
        <label style={{ ...s.label, marginBottom: 0 }}>{label}</label>
        <button type="button" onClick={onAdd} style={s.btnSmall}>+ Add</button>
      </div>
      {children}
    </div>
  )
  const grid = cols => ({ display: 'grid', gridTemplateColumns: cols, gap: '6px', marginBottom: '6px', alignItems: 'center' })

  const setCrewF = rowSetter(setCrew), setSubF = rowSetter(setSubs), setEqF = rowSetter(setEquipment), setMatF = rowSetter(setMaterials), setVisF = rowSetter(setVisitors)
  const crewCount = filledCrew(crew).length
  const subCount = filledSubActivity(subs).length

  return (
    <form onSubmit={submit} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
      <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>New daily report</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        <div><label style={s.label}>Date *</label><input type="date" style={s.input} value={form.report_date} onChange={set('report_date')} required /></div>
        <div>
          <label style={s.label}>Weather</label>
          <select style={s.input} value={form.weather} onChange={set('weather')}>
            <option value="">—</option>
            {WEATHER.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div><label style={s.label}>Temp (°F)</label><input type="text" style={s.input} value={form.weather_temp} onChange={set('weather_temp')} placeholder="75" /></div>
        <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#4b5563' }}>
            <input type="checkbox" checked={form.weather_delay} onChange={set('weather_delay')} style={{ accentColor: '#e8590c' }} />
            Weather delay
          </label>
        </div>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <label style={s.label}>Work performed *</label>
        <textarea rows={4} style={{ ...s.input, resize: 'vertical' }} value={form.work_performed} onChange={set('work_performed')} placeholder="Describe all work completed..." />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        <div><label style={s.label}>Issues / Delays</label><textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={form.issues} onChange={set('issues')} placeholder="Anything that held up work..." /></div>
        <div><label style={s.label}>Safety Observations</label><textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={form.safety_observations} onChange={set('safety_observations')} placeholder="Near misses, hazards, corrective actions..." /></div>
      </div>
      <div style={{ marginBottom: '14px' }}>
        <label style={s.label}>Toolbox Talk / Safety Topic</label>
        <input style={s.input} value={form.toolbox_talk} onChange={set('toolbox_talk')} placeholder="Topic discussed at morning meeting..." />
      </div>

      {section('Crew / Manpower', () => setCrew(l => [...l, emptyCrewRow()]), crew.map((r, i) => (
        <div key={i} style={grid('2fr 2fr 2fr 1fr 28px')}>
          <input style={s.input} placeholder="Name" value={r.name} onChange={setCrewF(i, 'name')} />
          <input style={s.input} placeholder="Company" value={r.company} onChange={setCrewF(i, 'company')} />
          <input style={s.input} placeholder="Trade" value={r.trade} onChange={setCrewF(i, 'trade')} />
          <input style={s.input} placeholder="Hrs" type="number" value={r.hours} onChange={setCrewF(i, 'hours')} />
          <button type="button" onClick={rowRemover(setCrew)(i)} style={removeBtn}>×</button>
        </div>
      )))}

      {section('Subcontractor Activity', () => setSubs(l => [...l, emptySubActivityRow()]), subs.map((r, i) => (
        <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '8px', marginBottom: '6px' }}>
          <div style={grid('2fr 2fr 1fr 28px')}>
            <input style={s.input} placeholder="Company" value={r.company} onChange={setSubF(i, 'company')} />
            <input style={s.input} placeholder="Trade" value={r.trade} onChange={setSubF(i, 'trade')} />
            <input style={s.input} placeholder="# Crew" type="number" value={r.crew_count} onChange={setSubF(i, 'crew_count')} />
            <button type="button" onClick={rowRemover(setSubs)(i)} style={removeBtn}>×</button>
          </div>
          <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} placeholder="Work performed..." value={r.work_performed} onChange={setSubF(i, 'work_performed')} />
        </div>
      )))}

      {section('Equipment On Site', () => setEquipment(l => [...l, emptyEquipmentRow()]), equipment.map((r, i) => (
        <div key={i} style={grid('3fr 1fr 1fr 28px')}>
          <input style={s.input} placeholder="Equipment name" value={r.name} onChange={setEqF(i, 'name')} />
          <input style={s.input} placeholder="Qty" value={r.quantity} onChange={setEqF(i, 'quantity')} />
          <input style={s.input} placeholder="Hrs" type="number" value={r.hours} onChange={setEqF(i, 'hours')} />
          <button type="button" onClick={rowRemover(setEquipment)(i)} style={removeBtn}>×</button>
        </div>
      )))}

      {section('Materials Delivered', () => setMaterials(l => [...l, emptyMaterialRow()]), materials.map((r, i) => (
        <div key={i} style={grid('3fr 1fr 2fr 28px')}>
          <input style={s.input} placeholder="Material" value={r.description} onChange={setMatF(i, 'description')} />
          <input style={s.input} placeholder="Qty" value={r.quantity} onChange={setMatF(i, 'quantity')} />
          <input style={s.input} placeholder="Supplier" value={r.supplier} onChange={setMatF(i, 'supplier')} />
          <button type="button" onClick={rowRemover(setMaterials)(i)} style={removeBtn}>×</button>
        </div>
      )))}

      {section('Visitors / Inspections', () => setVisitors(l => [...l, emptyVisitorRow()]), visitors.map((r, i) => (
        <div key={i} style={grid('2fr 2fr 3fr 28px')}>
          <input style={s.input} placeholder="Name" value={r.name} onChange={setVisF(i, 'name')} />
          <input style={s.input} placeholder="Company" value={r.company} onChange={setVisF(i, 'company')} />
          <input style={s.input} placeholder="Purpose" value={r.purpose} onChange={setVisF(i, 'purpose')} />
          <button type="button" onClick={rowRemover(setVisitors)(i)} style={removeBtn}>×</button>
        </div>
      )))}

      <div style={{ marginBottom: '14px' }}>
        <label style={s.label}>Photos</label>
        <label style={{ ...s.btnSmall, display: 'inline-block', cursor: saving ? 'default' : 'pointer' }}>
          Add Photos
          <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={saving} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; addFiles(files) }} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginLeft: '12px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }} title="Internal only photos are hidden from the owner portal">
          <input type="checkbox" checked={photosInternal} onChange={e => setPhotosInternal(e.target.checked)} />
          Internal only (hide from owner)
        </label>
        {photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {photos.map((p, i) => (
              <div key={i} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {p.name}
                {p.internal_only === true && <span style={{ fontSize: '10px', fontWeight: '800', color: '#7c2d12', background: '#ffedd5', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>Internal</span>}
                <button type="button" disabled={saving} onClick={() => setPhotos(l => l.filter((_, j) => j !== i))} style={{ ...removeBtn, fontSize: '14px' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {(crewCount > 0 || subCount > 0) && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
          {crewCount > 0 && `${crewCount} crew`}{crewCount > 0 && subCount > 0 && ' · '}{subCount > 0 && `${subCount} sub co.`}
        </div>
      )}
      {error && <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', marginBottom: '10px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button type="submit" disabled={saving || disabled} style={{ ...s.btn, opacity: saving || disabled ? 0.6 : 1 }}>{saving ? (status || 'Saving…') : 'Submit daily report'}</button>
        {onCancel && <button type="button" onClick={onCancel} disabled={saving} style={s.btnGray}>Cancel</button>}
      </div>
    </form>
  )
}
