'use client'
import React, { useState, useRef } from 'react'
import { localToday } from '../../lib/lookahead-dates'
import {
  WEATHER, emptyDailyForm, emptyCrewRow, emptyEquipmentRow, emptyMaterialRow, emptyVisitorRow, emptySubActivityRow,
  filledCrew, filledSubActivity, duplicateReportMessage, uniquePhotoName, thumbPath, isReferencedReportPhoto,
} from '../../lib/daily-report-payload'
import { saveDailyReport, FINALIZE_LABEL, FINALIZE_CONFIRM, DRAFT_BADGE } from '../../lib/daily-report-client'
import JobPhotoPicker from './JobPhotoPicker'

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

// Phone tap targets ≥ 44px (iOS HIG) — buttons, the photo-upload label and checkbox rows.
export const TAP_TARGET_CSS = `@media (max-width: 768px) {
  .nv-drf button, .nv-drf label:has(> input[type="file"]) { min-height: 44px !important; min-width: 44px !important; }
  .nv-drf input[type="checkbox"] { width: 22px; height: 22px; }
  .nv-drf label:has(> input[type="checkbox"]) { min-height: 44px; display: inline-flex; align-items: center; gap: 8px; }
}`
const removeBtn = { background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '18px', padding: 0 }

const rowsOr = (v, make) => (Array.isArray(v) && v.length ? v.map(r => ({ ...make(), ...r })) : null)
const txt = v => (v == null ? '' : String(v))

// Form fields from a saved draft (edit mode).
function formFromReport(r) {
  return {
    ...emptyDailyForm(r.report_date || localToday()),
    weather: txt(r.weather), weather_temp: txt(r.weather_temp), weather_delay: r.weather_delay === true,
    crew_count: txt(r.crew_count), work_performed: txt(r.work_performed), issues: txt(r.issues),
    safety_observations: txt(r.safety_observations), toolbox_talk: txt(r.toolbox_talk),
  }
}

// Daily report from the job page (commercial jobdetail + residentialjobdetail).
// Prompt 85 (Peyton's decision 3): the office uses the SAME Save draft / Finalize flow as
// the field app — "Save draft" keeps it a draft (labeled Draft, hidden from the owner portal
// and weather-day counts); "Finalize – 100% complete" publishes it. initialReport = a draft
// to edit (PATCH), otherwise a new report (POST). All writes go through /api/daily-reports
// (lib/daily-report-client), which enforces job assignment and sets the filer.
// Photos: new files upload to daily-report-photos `{jobId}/{unique}.jpg` (+ thumb) on save;
// "Choose from CompanyCam / job photos" attaches existing job photos BY REFERENCE (no copy).
// × only drops the element from this report — it never deletes a file.
// Each photo element may carry internal_only (prompt73) — "Internal only" stamps uploads;
// picked job photos keep their own internal_only.
export default function DailyReportForm({ jobId, styles, supabase, authFetch, existingDates = [], onSuccess, onCancel, disabled = false, initialReport = null }) {
  const s = { ...DEFAULT_STYLES, ...(styles || {}) }
  const editing = !!initialReport?.id
  const [form, setForm] = useState(() => (editing ? formFromReport(initialReport) : emptyDailyForm(localToday())))
  const [crew, setCrew] = useState(() => (editing && rowsOr(initialReport.crew_log, emptyCrewRow)) || [emptyCrewRow()])
  const [subs, setSubs] = useState(() => (editing && rowsOr(initialReport.subcontractor_activity, emptySubActivityRow)) || [])
  const [equipment, setEquipment] = useState(() => (editing && rowsOr(initialReport.equipment_log, emptyEquipmentRow)) || [])
  const [materials, setMaterials] = useState(() => (editing && rowsOr(initialReport.materials_delivered, emptyMaterialRow)) || [])
  const [visitors, setVisitors] = useState(() => (editing && rowsOr(initialReport.visitors, emptyVisitorRow)) || [])
  // [{ file?, name, internal_only?, path?, job_photo_id?, source? }] — path once uploaded / picked
  const [photos, setPhotos] = useState(() => (editing && Array.isArray(initialReport.photos) ? initialReport.photos.filter(p => p?.path).map(p => ({ ...p })) : []))
  const [photosInternal, setPhotosInternal] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  // L5 (prompt 85): a ref blocks a second tap before React re-renders the disabled button, and
  // once the first save created the report, every later save PATCHes that id (no second draft).
  const savingRef = useRef(false)
  const reportIdRef = useRef(editing ? initialReport.id : null)
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

  // Element stored on daily_reports.photos. Picked job photos keep job_photo_id + source.
  const toElement = p => ({
    path: p.path, caption: p.caption || '', name: p.name,
    ...(typeof p.internal_only === 'boolean' ? { internal_only: p.internal_only } : {}),
    ...(isReferencedReportPhoto(p) ? { job_photo_id: p.job_photo_id, source: 'job_photos' } : {}),
  })

  function attachPicked(elements) {
    setPhotos(prev => {
      const have = new Set(prev.map(p => p.path).filter(Boolean))
      return [...prev, ...elements.filter(el => !have.has(el.path))]
    })
  }

  async function save(finalize) {
    if (saving || savingRef.current || disabled) return
    setError('')
    if (!form.report_date) { setError('Report date is required.'); return }
    if (finalize && !form.work_performed.trim()) { setError('Work performed is required to finalize.'); return }
    // Only FINAL reports on that date count as duplicates (a draft is the one being worked on).
    const dup = duplicateReportMessage(form.report_date, existingDates)
    if (dup && !window.confirm(dup)) return
    if (finalize && !window.confirm(FINALIZE_CONFIRM)) return
    savingRef.current = true
    setSaving(true)
    try {
      let uploaded = photos
      if (photos.some(p => !p.path)) {
        setStatus('Uploading photos…')
        uploaded = await uploadPending(photos)
        setPhotos(uploaded)
      }
      setStatus(finalize ? 'Finalizing…' : 'Saving draft…')
      const payload = {
        job_id: jobId,
        ...form,
        crew_log: crew,
        subcontractor_activity: subs,
        equipment_log: equipment,
        materials_delivered: materials,
        visitors,
        // jsonb elements: { path, caption, name, internal_only?, job_photo_id?, source? } — same as field
        photos: uploaded.map(toElement),
      }
      const { report, warning } = await saveDailyReport(authFetch, { id: reportIdRef.current, payload, finalize })
      if (report?.id) reportIdRef.current = report.id
      if (warning) alert(warning)
      setForm(emptyDailyForm(localToday()))
      setCrew([emptyCrewRow()]); setSubs([]); setEquipment([]); setMaterials([]); setVisitors([]); setPhotos([]); setPhotosInternal(false)
      // The form is now blank for a NEW report (the parent usually closes it) — forget the id.
      reportIdRef.current = editing ? initialReport.id : null
      onSuccess?.(report, { finalized: !!finalize })
    } catch (err) {
      setError(err.message || 'Could not save daily report.')
    } finally {
      savingRef.current = false
      setSaving(false)
      setStatus('')
    }
  }

  function submit(e) {
    if (e?.preventDefault) e.preventDefault()
    // Enter in a field only saves a draft — publishing is always the explicit Finalize button.
    save(false)
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
    <form className="nv-drf" onSubmit={submit} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
      {/* L8 (prompt 85): on phones every button / tap target in this form is at least 44px
          (inline sizes are 32–36px for desktop density, so the overrides need !important). */}
      <style>{TAP_TARGET_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: '700', color: '#111827', marginBottom: '12px' }}>
        {editing ? 'Edit daily report' : 'New daily report'}
        {editing && <span style={DRAFT_BADGE}>Draft</span>}
      </div>

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
        <label style={s.label}>Work performed * <span style={{ fontWeight: 400, color: '#6b7280' }}>(required to finalize)</span></label>
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
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <label style={{ ...s.btnSmall, display: 'inline-flex', alignItems: 'center', minHeight: '36px', cursor: saving ? 'default' : 'pointer' }}>
            Add Photos
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} disabled={saving} onChange={e => { const files = Array.from(e.target.files || []); e.target.value = ''; addFiles(files) }} />
          </label>
          <button type="button" disabled={saving} onClick={() => setShowPicker(true)} style={{ ...s.btnSmall, minHeight: '36px' }}>Choose from CompanyCam / job photos</button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }} title="Internal only photos are hidden from the owner portal">
            <input type="checkbox" checked={photosInternal} onChange={e => setPhotosInternal(e.target.checked)} />
            Internal only (hide from owner)
          </label>
        </div>
        {photos.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {photos.map((p, i) => (
              <div key={p.path || `new-${i}`} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '4px 4px 4px 10px', fontSize: '12px', color: '#4b5563', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {p.name || (p.path || '').split('/').pop()}
                {isReferencedReportPhoto(p) && <span style={{ fontSize: '10px', fontWeight: '800', color: '#1e40af', background: '#dbeafe', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>Job photo</span>}
                {p.internal_only === true && <span style={{ fontSize: '10px', fontWeight: '800', color: '#7c2d12', background: '#ffedd5', padding: '1px 5px', borderRadius: '3px', textTransform: 'uppercase' }}>Internal</span>}
                {/* Unlink only: drops the element from this report; never deletes the file. */}
                <button type="button" aria-label={`Remove ${p.name || 'photo'} from this report`} disabled={saving} onClick={() => setPhotos(l => l.filter((_, j) => j !== i))} style={{ ...removeBtn, fontSize: '16px', minWidth: '32px', minHeight: '32px' }}>×</button>
              </div>
            ))}
          </div>
        )}
        {showPicker && (
          <JobPhotoPicker
            jobId={jobId}
            reportDate={form.report_date}
            authFetch={authFetch}
            attachedPaths={photos.map(p => p.path).filter(Boolean)}
            onAttach={attachPicked}
            onClose={() => setShowPicker(false)}
          />
        )}
      </div>

      {(crewCount > 0 || subCount > 0) && (
        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>
          {crewCount > 0 && `${crewCount} crew`}{crewCount > 0 && subCount > 0 && ' · '}{subCount > 0 && `${subCount} sub co.`}
        </div>
      )}
      {error && <div style={{ color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '8px 12px', fontSize: '13px', marginBottom: '10px' }}>{error}</div>}
      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>Drafts are visible to you and to Owner / PM, labeled Draft. Finalize publishes it (owner portal, weather-day counts).</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => save(false)} disabled={saving || disabled} style={{ ...s.btnGray, opacity: saving || disabled ? 0.6 : 1 }}>Save draft</button>
        <button type="button" onClick={() => save(true)} disabled={saving || disabled} style={{ ...s.btn, opacity: saving || disabled ? 0.6 : 1 }}>{saving ? (status || 'Saving…') : FINALIZE_LABEL}</button>
        {onCancel && <button type="button" onClick={onCancel} disabled={saving} style={s.btnGray}>Cancel</button>}
      </div>
    </form>
  )
}
