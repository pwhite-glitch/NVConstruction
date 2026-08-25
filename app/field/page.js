'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const WEATHER = ['Clear', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Heavy Rain', 'Thunderstorm', 'Snow', 'Windy', 'Extreme Heat', 'Fog']

const PHOTO_TAGS = [
  'Framing',
  'Concrete',
  'Foundation',
  'Structural Steel',
  'Roofing',
  'Plumbing',
  'Electrical',
  'Mechanical',
  'HVAC',
  'Cooler Box',
  'Drywall',
  'Site Work',
  'Permitting / Inspections',
  'General Progress',
]

const IC = {
  daily:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6"/></svg>,
  rfi:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>,
  deliveries:<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/></svg>,
  schedule:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  subs:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  costs:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  docs:      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>,
  punch:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  photos:    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  camera:    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
  lookahead: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>,
}

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem' },
  headerInner: { maxWidth: '760px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  signOut: { padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' },
  main: { maxWidth: '760px', margin: '0 auto', padding: '2rem 1.5rem' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.75rem', marginBottom: '1.5rem' },
  cardTitle: { fontSize: '16px', fontWeight: '700', color: '#f1f1f1', marginTop: 0, marginBottom: '1.5rem' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  btn: { padding: '11px 28px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSm: (c) => ({ padding: '7px 16px', background: c === 'red' ? '#2a0a0a' : c === 'green' ? '#0a1a0a' : c === 'orange' ? '#2a1200' : '#1a1a1a', color: c === 'red' ? '#ff6b6b' : c === 'green' ? '#4ade80' : c === 'orange' ? '#e8590c' : '#888', border: `1px solid ${c === 'red' ? '#5a1a1a' : c === 'green' ? '#1a4a1a' : c === 'orange' ? '#4a2200' : '#2a2a2a'}`, borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }),
  success: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '14px 16px', borderRadius: '8px', fontSize: '14px', marginBottom: '1.5rem' },
  empty: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#555', fontSize: '14px' },
  badge: (st) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: st === 'received' || st === 'complete' || st === 'answered' || st === 'approved' ? '#0a2a0a' : st === 'delayed' || st === 'rejected' ? '#2a0a0a' : st === 'partial' ? '#2a1a00' : '#1a1200',
    color: st === 'received' || st === 'complete' || st === 'answered' || st === 'approved' ? '#4ade80' : st === 'delayed' || st === 'rejected' ? '#ff6b6b' : st === 'partial' ? '#facc15' : '#e8590c',
    border: `1px solid ${st === 'received' || st === 'complete' || st === 'answered' || st === 'approved' ? '#1a4a1a' : st === 'delayed' || st === 'rejected' ? '#5a1a1a' : st === 'partial' ? '#4a4a00' : '#4a2200'}`
  }),
  tabRow: { display: 'flex', marginBottom: '1.5rem', borderBottom: '1px solid #222', overflowX: 'auto' },
  tab: (active) => ({ padding: '10px 18px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none', color: active ? '#f1f1f1' : '#555', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent', letterSpacing: '0.5px', marginBottom: '-1px', whiteSpace: 'nowrap' }),
  row: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  rowHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f', cursor: 'pointer' },
  rowBody: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
}

export default function Field() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [assignedJobs, setAssignedJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [activeTab, setActiveTab] = useState('')

  const [dailyReports, setDailyReports] = useState([])
  const [dailyForm, setDailyForm] = useState({ report_date: new Date().toISOString().split('T')[0], weather: '', weather_temp: '', weather_delay: false, crew_count: '', work_performed: '', issues: '', safety_observations: '', toolbox_talk: '' })
  const [crewLog, setCrewLog] = useState([{ name: '', company: '', trade: '', hours: '' }])
  const [equipmentLog, setEquipmentLog] = useState([])
  const [materialsLog, setMaterialsLog] = useState([])
  const [visitorsLog, setVisitorsLog] = useState([])
  const [subActivityLog, setSubActivityLog] = useState([])
  const [reportPhotos, setReportPhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [submittingDaily, setSubmittingDaily] = useState(false)
  const [dailySuccess, setDailySuccess] = useState(false)
  const [expandedReport, setExpandedReport] = useState(null)

  const [rfis, setRfis] = useState([])
  const [rfiForm, setRfiForm] = useState({ title: '', description: '' })
  const [submittingRfi, setSubmittingRfi] = useState(false)
  const [rfiSuccess, setRfiSuccess] = useState(false)
  const [expandedRfi, setExpandedRfi] = useState(null)

  const [deliveries, setDeliveries] = useState([])
  const [deliveryForm, setDeliveryForm] = useState({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
  const [submittingDelivery, setSubmittingDelivery] = useState(false)
  const [deliverySuccess, setDeliverySuccess] = useState(false)
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)
  const [updatingDelivery, setUpdatingDelivery] = useState(null)
  const [deliverySubTab, setDeliverySubTab] = useState('mine')

  const [milestones, setMilestones] = useState([])
  const [completingMilestone, setCompletingMilestone] = useState(null)

  const [subContacts, setSubContacts] = useState([])
  const [jobContacts, setJobContacts] = useState([])
  const [contactForm, setContactForm] = useState({ name: '', company: '', role: '', phone: '', email: '', notes: '' })
  const [showContactForm, setShowContactForm] = useState(false)
  const [submittingContact, setSubmittingContact] = useState(false)
  const [contactSuccess, setContactSuccess] = useState(false)

  const [directCosts, setDirectCosts] = useState([])
  const [dcForm, setDcForm] = useState({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', reason: '', notes: '' })
  const [dcFile, setDcFile] = useState(null)
  const [submittingDc, setSubmittingDc] = useState(false)
  const [dcSuccess, setDcSuccess] = useState(false)
  const [dcError, setDcError] = useState('')
  const [showDcForm, setShowDcForm] = useState(false)

  // Vehicle log state
  const [assignedVehicles, setAssignedVehicles] = useState([])
  const [vehicleLogs, setVehicleLogs] = useState({})
  const [expandedVehicleId, setExpandedVehicleId] = useState(null)
  const [showVehicleLogForm, setShowVehicleLogForm] = useState(null)
  const [vehicleLogForm, setVehicleLogForm] = useState({ log_type: 'Mileage Update', log_date: new Date().toISOString().split('T')[0], mileage: '', notes: '', fuel_gallons: '', fuel_cost: '' })
  const [vehicleLogFile, setVehicleLogFile] = useState(null)
  const [submittingVehicleLog, setSubmittingVehicleLog] = useState(false)
  const [vehicleLogMsg, setVehicleLogMsg] = useState('')
  const [vehicleLogError, setVehicleLogError] = useState('')

  // Tool state
  const [myTools, setMyTools] = useState([])
  const [toolLogsField, setToolLogsField] = useState({})
  const [expandedToolFieldId, setExpandedToolFieldId] = useState(null)
  const [showToolLogForm, setShowToolLogForm] = useState(null)
  const [toolLogForm, setToolLogForm] = useState({ log_type: 'checkin', log_date: new Date().toISOString().split('T')[0], notes: '' })
  const [submittingToolLog, setSubmittingToolLog] = useState(false)
  const [toolLogMsg, setToolLogMsg] = useState('')
  const [toolLogError, setToolLogError] = useState('')
  const [showPurchaseToolForm, setShowPurchaseToolForm] = useState(false)
  const [purchaseToolForm, setPurchaseToolForm] = useState({ name: '', category: 'Power Tools', brand: '', purchase_cost: '', purchase_date: new Date().toISOString().split('T')[0], notes: '' })
  const [purchaseToolFile, setPurchaseToolFile] = useState(null)
  const [purchasingTool, setPurchasingTool] = useState(false)
  const [purchaseToolMsg, setPurchaseToolMsg] = useState('')

  const [jobDocs, setJobDocs] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docCategory, setDocCategory] = useState('plans')
  const [filterDocCategory, setFilterDocCategory] = useState('all')

  const [punchItems, setPunchItems] = useState([])
  const [punchForm, setPunchForm] = useState({ title: '', description: '', due_date: '' })
  const [showPunchForm, setShowPunchForm] = useState(false)
  const [submittingPunch, setSubmittingPunch] = useState(false)
  const [updatingPunch, setUpdatingPunch] = useState(null)

  // Photo gallery & lightbox
  const [photoUrls, setPhotoUrls] = useState({})
  const [lightbox, setLightbox] = useState(null)
  const [standalonePhotos, setStandalonePhotos] = useState([])
  const [captionDraft, setCaptionDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [fabTag, setFabTag] = useState('')
  const [photoTagFilter, setPhotoTagFilter] = useState('all')
  const [uploadingGalleryPhoto, setUploadingGalleryPhoto] = useState(false)
  const [migration, setMigration] = useState(null)
  const [deletingPhoto, setDeletingPhoto] = useState(null)

  // Wizard + status + FAB + crew presets
  const [wizardStep, setWizardStep] = useState(1)
  const [todayReportStatus, setTodayReportStatus] = useState(null) // null | 'submitted' | 'none'
  const [fabOpen, setFabOpen] = useState(false)
  const [fabCaption, setFabCaption] = useState('')
  const [fabCount, setFabCount] = useState(0)
  const fabInputRef = useRef(null)
  const [crewPresets, setCrewPresets] = useState([])
  const [showSavePreset, setShowSavePreset] = useState(false)
  const [presetNameDraft, setPresetNameDraft] = useState('')

  const [lookahead, setLookahead] = useState(null)
  const [lookaheadActivities, setLookaheadActivities] = useState([])
  const [lookaheadContracts, setLookaheadContracts] = useState([])
  const [lookaheadWeekStart, setLookaheadWeekStart] = useState(() => {
    const d = new Date()
    const day = d.getDay()
    const daysToMon = day === 0 ? 1 : day === 1 ? 0 : 8 - day
    const mon = new Date(d); mon.setDate(d.getDate() + daysToMon)
    return mon.toISOString().split('T')[0]
  })
  const [showLAModal, setShowLAModal] = useState(false)
  const [editingLAActivity, setEditingLAActivity] = useState(null)
  const [laForm, setLaForm] = useState({})
  const [savingLA, setSavingLA] = useState(false)
  const [submittingLA, setSubmittingLA] = useState(false)
  const [newLACoName, setNewLACoName] = useState('')
  const [newLACoManpower, setNewLACoManpower] = useState('')

  useEffect(() => {
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      setUser(session.user)
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      const devRole = localStorage.getItem('nvc_dev_role')
      const devIsSuperOverride = devRole === 'super' && (prof?.role === 'pm' || prof?.role === 'apm')
      if (!devIsSuperOverride && (!prof || prof.role !== 'super')) { router.push('/login'); return }
      setProfile(devIsSuperOverride ? { ...prof, role: 'super' } : prof)
      const { data: assigns } = await supabase.from('pm_job_assignments').select('job_id, jobs(*)').eq('user_id', session.user.id)
      const jobs = (assigns || []).map(a => a.jobs).filter(Boolean)
      setAssignedJobs(jobs)
      if (jobs.length === 1) setSelectedJobId(jobs[0].id)
      loadAssignedVehicles(session.user.id)
      loadMyTools(session.user.id)
    }
    load()
  }, [router])

  useEffect(() => {
    try { const s = localStorage.getItem('nv_crew_presets'); if (s) setCrewPresets(JSON.parse(s)) } catch {}
  }, [])

  useEffect(() => { if (selectedJobId) checkTodayReport() }, [selectedJobId])

  useEffect(() => { if (activeTab === 'daily') setWizardStep(1) }, [activeTab])

  useEffect(() => {
    if (!selectedJobId) return
    if (activeTab === 'daily') { loadDailyReports(); loadSubContacts() }
    else if (activeTab === 'rfi') loadRfis()
    else if (activeTab === 'deliveries') loadDeliveries()
    else if (activeTab === 'schedule') loadMilestones()
    else if (activeTab === 'subs') { loadSubContacts(); loadJobContacts() }
    else if (activeTab === 'costs') loadDirectCosts()
    else if (activeTab === 'docs') loadJobDocs()
    else if (activeTab === 'punch') loadPunchItems()
    else if (activeTab === 'photos') loadPhotoGallery()
    else if (activeTab === 'lookahead') { loadLookaheadData(); loadLookaheadContracts() }
  }, [selectedJobId, activeTab])

  async function checkTodayReport() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('daily_reports').select('id').eq('job_id', selectedJobId).eq('report_date', today).maybeSingle()
    setTodayReportStatus(data ? 'submitted' : 'none')
  }

  async function loadDailyReports() {
    const { data } = await supabase.from('daily_reports').select('*').eq('job_id', selectedJobId).order('report_date', { ascending: false })
    setDailyReports(data || [])
  }
  async function loadRfis() {
    const { data } = await supabase.from('rfis').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: false })
    setRfis(data || [])
  }
  async function loadDeliveries() {
    const { data } = await supabase.from('deliveries').select('*').eq('job_id', selectedJobId).order('expected_date', { ascending: true })
    setDeliveries(data || [])
  }
  async function loadMilestones() {
    const { data } = await supabase.from('milestones').select('*').eq('job_id', selectedJobId).order('due_date', { ascending: true })
    setMilestones(data || [])
  }
  async function loadSubContacts() {
    const { data: assigns } = await supabase.from('job_assignments').select('sub_email').eq('job_id', selectedJobId)
    const emails = (assigns || []).map(a => a.sub_email).filter(Boolean)
    if (emails.length === 0) { setSubContacts([]); return }
    const { data } = await supabase.from('sub_directory').select('*').in('email', emails)
    setSubContacts(data || [])
  }

  async function loadJobContacts() {
    const { data } = await supabase.from('job_contacts').select('*').eq('job_id', selectedJobId).order('created_at', { ascending: true })
    setJobContacts(data || [])
  }

  async function submitJobContact(e) {
    e.preventDefault()
    if (!contactForm.name.trim()) { alert('Name is required.'); return }
    setSubmittingContact(true)
    const { error } = await supabase.from('job_contacts').insert({
      job_id: selectedJobId,
      name: contactForm.name.trim(),
      company: contactForm.company || null,
      role: contactForm.role || null,
      phone: contactForm.phone || null,
      email: contactForm.email || null,
      notes: contactForm.notes || null,
    })
    if (!error) {
      setContactSuccess(true)
      setContactForm({ name: '', company: '', role: '', phone: '', email: '', notes: '' })
      setShowContactForm(false)
      await loadJobContacts()
      setTimeout(() => setContactSuccess(false), 3000)
    } else {
      alert('Error adding contact: ' + error.message)
    }
    setSubmittingContact(false)
  }

  async function loadDirectCosts() {
    const { data } = await supabase.from('direct_costs').select('*').eq('job_id', selectedJobId).order('cost_date', { ascending: false })
    setDirectCosts(data || [])
  }

  async function loadJobDocs() {
    const { data } = await supabase.from('job_documents').select('*').eq('job_id', selectedJobId).order('uploaded_at', { ascending: false })
    setJobDocs(data || [])
  }

  async function loadPunchItems() {
    const res = await fetch(`/api/punch-list?job_id=${selectedJobId}`)
    const { items } = await res.json()
    setPunchItems(items || [])
  }

  async function compressImage(file, maxWidth = 1200, quality = 0.82) {
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

  function tp(path) { return path?.replace(/\.jpg$/i, '_thumb.jpg') ?? null }

  async function fetchPhotoUrls(paths) {
    const clean = [...new Set(paths.filter(Boolean))]
    if (!clean.length) return
    // Sign full paths + thumb variants in one batch call
    const toSign = [...new Set([...clean, ...clean.map(tp).filter(Boolean)])]
    const { data } = await supabase.storage.from('daily-report-photos').createSignedUrls(toSign, 7200)
    if (data) setPhotoUrls(prev => { const u = { ...prev }; data.forEach(d => { if (d.signedUrl) u[d.path] = d.signedUrl }); return u })
  }

  function openLightbox(photos, index = 0) {
    setLightbox({ photos, index })
    fetchPhotoUrls(photos.map(p => p.path).filter(Boolean))
  }

  async function loadPhotoGallery() {
    const { data, error: photoErr } = await supabase.from('job_photos').select('*').eq('job_id', selectedJobId).order('taken_at', { ascending: false })
    if (photoErr) console.error('job_photos query error:', photoErr.message)
    setStandalonePhotos(data || [])
    let reports = dailyReports
    if (reports.length === 0) {
      const { data: rpts } = await supabase.from('daily_reports').select('*').eq('job_id', selectedJobId).order('report_date', { ascending: false })
      setDailyReports(rpts || [])
      reports = rpts || []
    }
    // Batch-sign all URLs in one API call; loading="lazy" on <img> prevents browser from downloading off-screen images
    const allPaths = [
      ...(data || []).map(p => p.storage_path),
      ...reports.flatMap(r => (r.photos || []).map(p => p.path)),
    ]
    if (allPaths.length) fetchPhotoUrls(allPaths)
  }

  async function deletePhoto(photo) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setDeletingPhoto(photo.path)
    try {
      await supabase.storage.from('daily-report-photos').remove([photo.path, tp(photo.path)].filter(Boolean))
      if (photo.fromReport) {
        const report = dailyReports.find(r => r.id === photo.reportId)
        if (report) {
          const updated = (report.photos || []).filter(p => p.path !== photo.path)
          await supabase.from('daily_reports').update({ photos: updated.length ? updated : null }).eq('id', report.id)
        }
      } else {
        await supabase.from('job_photos').delete().eq('storage_path', photo.path)
      }
      await loadPhotoGallery()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    } finally {
      setDeletingPhoto(null)
    }
  }

  async function uploadGalleryPhoto(file, captionOverride, tagOverride) {
    setUploadingGalleryPhoto(true)
    const ts = Date.now()
    const path = `${selectedJobId}/gallery/${ts}.jpg`
    const [compressed, thumb] = await Promise.all([compressImage(file, 1200, 0.82), compressImage(file, 400, 0.72)])
    const { error } = await supabase.storage.from('daily-report-photos').upload(path, compressed)
    if (error) { alert('Upload failed: ' + error.message); setUploadingGalleryPhoto(false); return }
    await supabase.storage.from('daily-report-photos').upload(tp(path), thumb)
    const usedCaption = captionOverride !== undefined ? captionOverride : captionDraft
    const usedTag = tagOverride !== undefined ? tagOverride : tagDraft
    const { error: dbErr } = await supabase.from('job_photos').insert({ job_id: selectedJobId, super_id: user.id, storage_path: path, file_name: file.name, caption: usedCaption || null, tag: usedTag || null, taken_at: new Date().toISOString() })
    if (dbErr) { alert('Photo saved to storage but could not save to gallery: ' + dbErr.message); setUploadingGalleryPhoto(false); return }
    if (captionOverride === undefined) setCaptionDraft('')
    if (tagOverride === undefined) setTagDraft('')
    await loadPhotoGallery()
    setUploadingGalleryPhoto(false)
  }

  async function migratePhotos() {
    const allPaths = [
      ...standalonePhotos.map(p => p.storage_path),
      ...dailyReports.flatMap(r => (r.photos || []).map(p => p.path)),
    ].filter(Boolean)
    if (!allPaths.length) return
    setMigration({ processed: 0, total: allPaths.length, done: false })
    for (let i = 0; i < allPaths.length; i++) {
      const path = allPaths[i]
      try {
        const { data: blob, error } = await supabase.storage.from('daily-report-photos').download(path)
        if (!error && blob) {
          const file = new File([blob], path.split('/').pop(), { type: 'image/jpeg' })
          const [compressed, thumb] = await Promise.all([compressImage(file, 1200, 0.82), compressImage(file, 400, 0.72)])
          if (compressed.size < file.size * 0.9) {
            await supabase.storage.from('daily-report-photos').upload(path, compressed, { upsert: true })
          }
          await supabase.storage.from('daily-report-photos').upload(tp(path), thumb, { upsert: true })
        }
      } catch {}
      setMigration(m => ({ ...m, processed: m.processed + 1 }))
    }
    setMigration(m => ({ ...m, done: true }))
    setPhotoUrls({})
    await loadPhotoGallery()
  }

  async function uploadJobDoc(file) {
    setUploadingDoc(true)
    const path = `${selectedJobId}/${docCategory}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('job-documents').upload(path, file)
    if (error) { alert('Upload error: ' + error.message); setUploadingDoc(false); return }
    await supabase.from('job_documents').insert({ job_id: selectedJobId, file_name: file.name, storage_path: path, category: docCategory, uploaded_by: user.id })
    await loadJobDocs()
    setUploadingDoc(false)
  }

  async function openJobDoc(storagePath) {
    const { data } = await supabase.storage.from('job-documents').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function submitDirectCost(e) {
    e.preventDefault()
    setSubmittingDc(true)
    setDcError('')
    const rowData = {
      job_id: selectedJobId, submitted_by: user.id,
      cost_date: dcForm.cost_date, description: dcForm.description,
      category: dcForm.category, amount: parseFloat(dcForm.amount),
      reason: dcForm.reason || null,
      notes: dcForm.notes || null,
      assigned_to: profile?.full_name || null,
      status: 'pending',
    }
    let res, json
    if (dcFile) {
      const fd = new FormData()
      fd.append('file', dcFile)
      fd.append('data', JSON.stringify(rowData))
      res = await fetch('/api/direct-costs', { method: 'POST', body: fd })
    } else {
      res = await fetch('/api/direct-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    }
    json = await res.json()
    if (json.error) {
      setDcError('Failed to save cost: ' + json.error)
      setSubmittingDc(false)
      return
    }
    setDcSuccess(true)
    setDcForm({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', reason: '', notes: '' })
    setDcFile(null)
    setShowDcForm(false)
    await loadDirectCosts()
    setTimeout(() => setDcSuccess(false), 3000)
    setSubmittingDc(false)
  }

  async function openReceiptUrl(path) {
    const res = await fetch(`/api/direct-costs?receipt_path=${encodeURIComponent(path)}`)
    const json = await res.json()
    if (json.url) window.open(json.url, '_blank')
    else alert('Could not open receipt: ' + (json.error || 'unknown error'))
  }

  async function loadAssignedVehicles(userId) {
    const res = await fetch('/api/vehicles')
    const json = await res.json()
    const mine = (json.data || []).filter(v => v.assigned_to === userId)
    setAssignedVehicles(mine)
  }

  async function loadMyTools(userId) {
    const res = await fetch('/api/tools')
    const json = await res.json()
    const mine = (json.data || []).filter(t => t.assigned_to === userId)
    setMyTools(mine)
  }

  async function loadLookaheadData(weekOverride) {
    const wk = weekOverride || lookaheadWeekStart
    const res = await fetch(`/api/lookaheads?job_id=${selectedJobId}&week_start=${wk}`)
    const { data } = await res.json()
    if (data && data.length > 0) {
      setLookahead(data[0])
      setLookaheadActivities(data[0].lookahead_activities || [])
    } else {
      setLookahead(null)
      setLookaheadActivities([])
    }
  }

  async function loadLookaheadContracts() {
    const { data } = await supabase.from('subcontracts').select('id, vendor_name').eq('job_id', selectedJobId).order('vendor_name')
    setLookaheadContracts(data || [])
  }

  async function createLookahead() {
    const res = await fetch('/api/lookaheads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: selectedJobId, week_start_date: lookaheadWeekStart, submitted_by: user?.id }),
    })
    const { data, error } = await res.json()
    if (error) { alert(error); return }
    setLookahead(data)
    setLookaheadActivities([])
  }

  function openAddLAActivity(date) {
    setEditingLAActivity(null)
    setLaForm({
      planned_date: date, description: '', location: '',
      responsible_type: 'own_crew', sub_id: '', other_company_name: '',
      manpower: '', equipment: '', additional_companies: [],
      materials_status: 'needed', inspection_required: false,
      inspection_scheduled: false, preceding_work_complete: false,
      committed: false, constraints_notes: '',
    })
    setNewLACoName('')
    setNewLACoManpower('')
    setShowLAModal(true)
  }

  function openEditLAActivity(act) {
    setEditingLAActivity(act)
    setLaForm({ ...act, additional_companies: act.additional_companies || [] })
    setNewLACoName('')
    setNewLACoManpower('')
    setShowLAModal(true)
  }

  async function saveLAActivity() {
    if (!laForm.description) return
    setSavingLA(true)
    if (editingLAActivity) {
      const res = await fetch('/api/lookahead-activities', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingLAActivity.id, ...laForm }),
      })
      const { data } = await res.json()
      if (data) setLookaheadActivities(prev => prev.map(a => a.id === data.id ? data : a))
    } else {
      const res = await fetch('/api/lookahead-activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookahead_id: lookahead.id, ...laForm }),
      })
      const { data } = await res.json()
      if (data) setLookaheadActivities(prev => [...prev, data])
    }
    setSavingLA(false)
    setShowLAModal(false)
  }

  async function deleteLAActivity(actId) {
    if (!confirm('Delete this activity?')) return
    await fetch('/api/lookahead-activities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: actId }),
    })
    setLookaheadActivities(prev => prev.filter(a => a.id !== actId))
  }

  async function submitLookaheadFromField() {
    if (!lookahead) return
    setSubmittingLA(true)
    const res = await fetch('/api/lookaheads', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lookahead.id, status: 'submitted' }),
    })
    const { data } = await res.json()
    if (data) setLookahead(prev => ({ ...prev, ...data }))
    setSubmittingLA(false)
  }

  function shiftLookaheadWeek(delta) {
    const d = new Date(lookaheadWeekStart + 'T12:00:00Z')
    d.setDate(d.getDate() + delta * 7)
    const newStart = d.toISOString().split('T')[0]
    setLookaheadWeekStart(newStart)
    setLookahead(null)
    setLookaheadActivities([])
    loadLookaheadData(newStart)
  }

  async function loadToolLogsForTool(toolId) {
    const res = await fetch(`/api/tool-logs?tool_id=${toolId}`)
    const json = await res.json()
    setToolLogsField(prev => ({ ...prev, [toolId]: json.data || [] }))
  }

  async function submitToolLog(e, tool) {
    e.preventDefault()
    setSubmittingToolLog(true)
    setToolLogError('')
    const rowData = {
      tool_id: tool.id,
      logged_by: user?.id,
      assigned_to: tool.assigned_to || null,
      log_type: toolLogForm.log_type,
      log_date: toolLogForm.log_date,
      notes: toolLogForm.notes || null,
    }
    const res = await fetch('/api/tool-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    const json = await res.json()
    if (json.error) { setToolLogError(json.error); setSubmittingToolLog(false); return }
    setToolLogsField(prev => ({ ...prev, [tool.id]: [json.data, ...(prev[tool.id] || [])] }))
    if (toolLogForm.log_type === 'checkin') {
      setMyTools(prev => prev.filter(t => t.id !== tool.id))
    }
    setToolLogForm({ log_type: 'checkin', log_date: new Date().toISOString().split('T')[0], notes: '' })
    setShowToolLogForm(null)
    setToolLogMsg('Saved.')
    setTimeout(() => setToolLogMsg(''), 3000)
    setSubmittingToolLog(false)
  }

  async function loadVehicleLogsForVehicle(vehicleId) {
    const res = await fetch(`/api/vehicle-logs?vehicle_id=${vehicleId}`)
    const json = await res.json()
    setVehicleLogs(prev => ({ ...prev, [vehicleId]: json.data || [] }))
  }

  async function submitVehicleLog(e, vehicleId) {
    e.preventDefault()
    setSubmittingVehicleLog(true)
    setVehicleLogError('')
    const rowData = {
      vehicle_id: vehicleId,
      logged_by: user?.id,
      log_type: vehicleLogForm.log_type,
      log_date: vehicleLogForm.log_date,
      mileage: vehicleLogForm.mileage ? parseInt(vehicleLogForm.mileage) : null,
      notes: vehicleLogForm.notes || null,
      fuel_gallons: vehicleLogForm.fuel_gallons ? parseFloat(vehicleLogForm.fuel_gallons) : null,
      fuel_cost: vehicleLogForm.fuel_cost ? parseFloat(vehicleLogForm.fuel_cost) : null,
    }
    let res, json
    if (vehicleLogFile) {
      const fd = new FormData()
      fd.append('file', vehicleLogFile)
      fd.append('data', JSON.stringify(rowData))
      res = await fetch('/api/vehicle-logs', { method: 'POST', body: fd })
    } else {
      res = await fetch('/api/vehicle-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    }
    json = await res.json()
    if (json.error) { setVehicleLogError(json.error); setSubmittingVehicleLog(false); return }
    setVehicleLogs(prev => ({ ...prev, [vehicleId]: [json.data, ...(prev[vehicleId] || [])] }))
    setVehicleLogForm({ log_type: 'Mileage Update', log_date: new Date().toISOString().split('T')[0], mileage: '', notes: '', fuel_gallons: '', fuel_cost: '' })
    setVehicleLogFile(null)
    setShowVehicleLogForm(null)
    setVehicleLogMsg('Log saved.')
    setTimeout(() => setVehicleLogMsg(''), 3000)
    setSubmittingVehicleLog(false)
  }

  function openVehiclePhoto(path) {
    if (!path) return
    window.open(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/vehicle-photos/${path}`, '_blank')
  }

  async function uploadReportPhoto(file) {
    setUploadingPhoto(true)
    const ts = Date.now()
    const path = `${selectedJobId}/${ts}.jpg`
    const [compressed, thumb] = await Promise.all([compressImage(file, 1200, 0.82), compressImage(file, 400, 0.72)])
    const { error } = await supabase.storage.from('daily-report-photos').upload(path, compressed)
    if (!error) {
      await supabase.storage.from('daily-report-photos').upload(tp(path), thumb)
      setReportPhotos(prev => [...prev, { path, caption: '', name: file.name }])
    } else alert('Photo upload failed: ' + error.message)
    setUploadingPhoto(false)
  }

  async function openReportPhoto(path) {
    const { data } = await supabase.storage.from('daily-report-photos').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function submitDailyReport(e) {
    if (e?.preventDefault) e.preventDefault()
    if (!dailyForm.work_performed.trim()) { alert('Work performed is required.'); return }
    setSubmittingDaily(true)
    const filledCrew = crewLog.filter(r => r.name || r.company)
    const { error } = await supabase.from('daily_reports').insert({
      job_id: selectedJobId, super_id: user.id,
      report_date: dailyForm.report_date,
      weather: dailyForm.weather || null,
      weather_temp: dailyForm.weather_temp || null,
      weather_delay: dailyForm.weather_delay || false,
      crew_count: dailyForm.crew_count ? parseInt(dailyForm.crew_count) : filledCrew.length || null,
      work_performed: dailyForm.work_performed,
      issues: dailyForm.issues || null,
      safety_observations: dailyForm.safety_observations || null,
      toolbox_talk: dailyForm.toolbox_talk || null,
      crew_log: filledCrew.length ? filledCrew : null,
      equipment_log: equipmentLog.filter(r => r.name).length ? equipmentLog.filter(r => r.name) : null,
      materials_delivered: materialsLog.filter(r => r.description).length ? materialsLog.filter(r => r.description) : null,
      visitors: visitorsLog.filter(r => r.name).length ? visitorsLog.filter(r => r.name) : null,
      subcontractor_activity: subActivityLog.filter(r => r.company).length ? subActivityLog.filter(r => r.company) : null,
      photos: reportPhotos.length ? reportPhotos : null,
    })
    if (!error) {
      // Auto-create delivery records for any materials logged
      const filledMaterials = materialsLog.filter(r => r.description)
      if (filledMaterials.length > 0) {
        await supabase.from('deliveries').insert(
          filledMaterials.map(m => ({
            job_id: selectedJobId,
            super_id: user.id,
            material: m.description,
            vendor: m.supplier || null,
            quantity: m.quantity || null,
            status: 'received',
            received_date: dailyForm.report_date,
            source: 'daily_report',
          }))
        )
      }
      setDailySuccess(true)
      setDailyForm({ report_date: new Date().toISOString().split('T')[0], weather: '', weather_temp: '', weather_delay: false, crew_count: '', work_performed: '', issues: '', safety_observations: '', toolbox_talk: '' })
      setCrewLog([{ name: '', company: '', trade: '', hours: '' }])
      setEquipmentLog([])
      setMaterialsLog([])
      setVisitorsLog([])
      setSubActivityLog([])
      setReportPhotos([])
      setWizardStep(1)
      await loadDailyReports()
      checkTodayReport()
      setTimeout(() => setDailySuccess(false), 3000)
    }
    setSubmittingDaily(false)
  }

  async function submitRfi(e) {
    e.preventDefault()
    setSubmittingRfi(true)
    const title = rfiForm.title
    const description = rfiForm.description
    const { error } = await supabase.from('rfis').insert({
      job_id: selectedJobId, super_id: user.id,
      title, description: description || null,
    })
    if (!error) {
      setRfiSuccess(true)
      setRfiForm({ title: '', description: '' })
      await loadRfis()
      setTimeout(() => setRfiSuccess(false), 3000)
      fetch('/api/rfi-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submitted', job_id: selectedJobId, title, description, super_name: profile?.full_name || profile?.email || 'Superintendent' }) })
    }
    setSubmittingRfi(false)
  }

  async function submitDelivery(e) {
    e.preventDefault()
    setSubmittingDelivery(true)
    const { error } = await supabase.from('deliveries').insert({
      job_id: selectedJobId, super_id: user.id,
      material: deliveryForm.material,
      vendor: deliveryForm.vendor || null,
      expected_date: deliveryForm.expected_date || null,
      quantity: deliveryForm.quantity || null,
      notes: deliveryForm.notes || null,
      status: 'pending',
    })
    if (!error) {
      setDeliverySuccess(true)
      setDeliveryForm({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
      setShowDeliveryForm(false)
      await loadDeliveries()
      setTimeout(() => setDeliverySuccess(false), 3000)
    }
    setSubmittingDelivery(false)
  }

  async function markDeliveryReceived(id) {
    setUpdatingDelivery(id)
    await supabase.from('deliveries').update({ status: 'received', received_date: new Date().toISOString().split('T')[0] }).eq('id', id)
    await loadDeliveries()
    setUpdatingDelivery(null)
  }

  async function completeMilestone(id) {
    setCompletingMilestone(id)
    await supabase.from('milestones').update({ status: 'complete', completed_date: new Date().toISOString().split('T')[0] }).eq('id', id)
    await loadMilestones()
    setCompletingMilestone(null)
  }

  useEffect(() => {
    if (!lightbox) return
    const onKey = e => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  const selectedJob = assignedJobs.find(j => j.id === selectedJobId)
  const answeredRfis = rfis.filter(r => r.status === 'answered').length
  const totalGalleryPhotos = standalonePhotos.length + dailyReports.reduce((a, r) => a + (r.photos?.length || 0), 0)

  if (!profile) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>{profile?.full_name || 'Field Portal'}</div>
            </div>
          </div>
          <button style={s.signOut} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>

      <main style={s.main} className="rx-main">
        {assignedJobs.length === 0 ? (
          <div style={s.empty}>You have not been assigned to any jobs yet.<br />Contact NV Construction to get started.</div>
        ) : (
          <>
            {assignedJobs.length > 1 && (
              <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <label style={{ ...s.label, margin: 0, whiteSpace: 'nowrap' }}>Active job</label>
                <select value={selectedJobId} onChange={e => setSelectedJobId(e.target.value)} style={s.input}>
                  <option value="">Select a job...</option>
                  {assignedJobs.map(j => <option key={j.id} value={j.id}>#{j.job_number} — {j.project_name}</option>)}
                </select>
              </div>
            )}

            {selectedJob && assignedJobs.length === 1 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <h2 style={{ color: '#f1f1f1', margin: '0 0 4px', fontSize: '20px', fontWeight: '800' }}>#{selectedJob.job_number} — {selectedJob.project_name}</h2>
                {selectedJob.location && <p style={{ margin: 0, color: '#555', fontSize: '13px' }}>{selectedJob.location}</p>}
              </div>
            )}

            {!selectedJobId && <div style={s.empty}>Select a job above to get started.</div>}

            {selectedJobId && (
              <>
                {!activeTab && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '0.5rem' }}>
                    {[
                      { key: 'daily', icon: IC.daily, label: 'Daily Reports', count: dailyReports.length || null, alert: todayReportStatus === 'none', alertLabel: 'No report today', successLabel: todayReportStatus === 'submitted' ? '✓ Filed today' : null },
                      { key: 'rfi', icon: IC.rfi, label: 'RFIs', count: rfis.length || null, alert: answeredRfis > 0, alertLabel: `${answeredRfis} answered` },
                      { key: 'deliveries', icon: IC.deliveries, label: 'Deliveries', count: deliveries.length || null },
                      { key: 'schedule', icon: IC.schedule, label: 'Schedule', count: milestones.filter(m => m.status !== 'complete').length || null, alertLabel: milestones.filter(m => m.status === 'delayed').length > 0 ? `${milestones.filter(m => m.status === 'delayed').length} delayed` : null, alert: milestones.filter(m => m.status === 'delayed').length > 0 },
                      { key: 'subs', icon: IC.subs, label: 'Contacts', count: (jobContacts.length + subContacts.length) || null },
                      { key: 'costs', icon: IC.costs, label: 'Direct Costs', count: directCosts.length || null },
                      { key: 'docs', icon: IC.docs, label: 'Documents', count: jobDocs.length || null },
                      { key: 'punch', icon: IC.punch, label: 'Punch List', count: punchItems.filter(p => p.status === 'open').length || null, alert: punchItems.filter(p => p.status === 'open').length > 0, alertLabel: `${punchItems.filter(p => p.status === 'open').length} open` },
                      { key: 'photos', icon: IC.photos, label: 'Site Photos', count: totalGalleryPhotos || null },
                      { key: 'vehicles', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>, label: 'My Vehicle', count: assignedVehicles.length || null },
                      { key: 'tools', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, label: 'My Tools', count: myTools.length || null },
                      { key: 'lookahead', icon: IC.lookahead, label: '2-Week Lookahead', count: lookaheadActivities.length || null },
                    ].map(item => (
                      <button key={item.key} onClick={() => setActiveTab(item.key)} style={{ background: '#141414', border: `1px solid ${item.alert ? '#4a2200' : '#222'}`, borderRadius: '12px', padding: '1.25rem', textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <span style={{ color: item.alert ? '#e8590c' : '#555', display: 'flex', lineHeight: 1 }}>{item.icon}</span>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1', lineHeight: '1.3' }}>{item.label}</span>
                        {item.successLabel ? (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>{item.successLabel}</span>
                        ) : (item.count || item.alert) ? (
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: item.alert ? '#2a1200' : '#1a1a1a', color: item.alert ? '#e8590c' : '#555', border: `1px solid ${item.alert ? '#4a2200' : '#2a2a2a'}` }}>
                            {item.alert && item.alertLabel ? item.alertLabel : item.count}
                          </span>
                        ) : <span style={{ fontSize: '11px', color: '#333' }}>Tap to open</span>}
                      </button>
                    ))}
                  </div>
                )}

                {!activeTab && selectedJob && (
                  <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', padding: '0.75rem 1rem', background: '#111', border: '1px solid #1e1e1e', borderRadius: '10px', marginBottom: '1rem' }}>
                    {selectedJob.location && (
                      <div>
                        <div style={{ fontSize: '9px', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '2px' }}>Location</div>
                        <div style={{ fontSize: '12px', color: '#888' }}>{selectedJob.location}</div>
                      </div>
                    )}
                    {selectedJob.start_date && (
                      <div>
                        <div style={{ fontSize: '9px', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '2px' }}>Day on Project</div>
                        <div style={{ fontSize: '12px', color: '#888' }}>Day {Math.max(1, Math.floor((Date.now() - new Date(selectedJob.start_date)) / 86400000) + 1)}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: '9px', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '2px' }}>Status</div>
                      <div style={{ fontSize: '12px', color: selectedJob.status === 'active' ? '#4ade80' : '#888', textTransform: 'capitalize' }}>{selectedJob.status || 'Active'}</div>
                    </div>
                  </div>
                )}

                {activeTab && (
                  <div style={{ position: 'sticky', top: '64px', zIndex: 9, background: '#0a0a0a', borderBottom: '1px solid #1a1a1a', margin: '0 -1.5rem', padding: '0 1.5rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '14px', height: '52px' }}>
                    <button style={{ padding: '7px 14px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#aaa', fontSize: '13px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }} onClick={() => setActiveTab('')}>← Back</button>
                    <span style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {{ daily: 'Daily Reports', rfi: 'RFIs', deliveries: 'Deliveries', schedule: 'Schedule', subs: 'Contacts', costs: 'Direct Costs', docs: 'Documents', punch: 'Punch List', photos: 'Site Photos', vehicles: 'My Vehicle', tools: 'My Tools', lookahead: '2-Week Lookahead' }[activeTab]}
                    </span>
                  </div>
                )}

                {/* ── DAILY REPORTS ── */}
                {activeTab === 'daily' && (
                  <>
                    {dailySuccess && <div style={s.success}>Daily report submitted successfully.</div>}

                    {/* Wizard card */}
                    <div style={s.card}>
                      {/* Progress bar */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1.25rem' }}>
                        {['Date & Weather', 'Work Summary', 'Crew & Activity', 'Photos & Submit'].map((label, i) => (
                          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: i < wizardStep ? 'pointer' : 'default' }} onClick={() => { if (i < wizardStep) setWizardStep(i + 1) }}>
                            <div style={{ height: '3px', width: '100%', borderRadius: '2px', background: i < wizardStep ? '#e8590c' : i === wizardStep - 1 ? '#e8590c' : '#2a2a2a', opacity: i < wizardStep ? 1 : i === wizardStep - 1 ? 1 : 0.4 }} />
                            <span style={{ fontSize: '9px', color: i === wizardStep - 1 ? '#e8590c' : i < wizardStep ? '#555' : '#333', fontWeight: '700', letterSpacing: '0.5px', textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
                          </div>
                        ))}
                      </div>

                      {/* Step 1: Date & Weather */}
                      {wizardStep === 1 && (
                        <div className="wizard-step">
                          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                            <div><label style={s.label}>Date *</label><input type="date" style={s.input} value={dailyForm.report_date} onChange={e => setDailyForm(f => ({ ...f, report_date: e.target.value }))} /></div>
                            <div>
                              <label style={s.label}>Weather</label>
                              <select style={s.input} value={dailyForm.weather} onChange={e => setDailyForm(f => ({ ...f, weather: e.target.value }))}>
                                <option value="">—</option>
                                {WEATHER.map(w => <option key={w} value={w}>{w}</option>)}
                              </select>
                            </div>
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '1.25rem' }}>
                            <div><label style={s.label}>Temp (°F)</label><input type="text" style={s.input} value={dailyForm.weather_temp} onChange={e => setDailyForm(f => ({ ...f, weather_temp: e.target.value }))} placeholder="75" /></div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={dailyForm.weather_delay} onChange={e => setDailyForm(f => ({ ...f, weather_delay: e.target.checked }))} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#e8590c' }} />
                                <span style={{ fontSize: '13px', color: '#aaa' }}>Weather delay today</span>
                              </label>
                            </div>
                          </div>
                          <button onClick={() => setWizardStep(2)} style={{ ...s.btn, width: '100%' }}>Continue →</button>
                        </div>
                      )}

                      {/* Step 2: Work Summary */}
                      {wizardStep === 2 && (
                        <div className="wizard-step">
                          <div style={{ marginBottom: '1.25rem' }}>
                            <label style={s.label}>Work performed today *</label>
                            <textarea rows={5} style={{ ...s.input, resize: 'vertical' }} value={dailyForm.work_performed} onChange={e => setDailyForm(f => ({ ...f, work_performed: e.target.value }))} placeholder="Describe all work completed today..." autoFocus />
                          </div>
                          <div style={{ marginBottom: '1.25rem' }}>
                            <label style={s.label}>Issues / Delays</label>
                            <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={dailyForm.issues} onChange={e => setDailyForm(f => ({ ...f, issues: e.target.value }))} placeholder="Anything that held up work today..." />
                          </div>
                          <div style={{ marginBottom: '1.25rem' }}>
                            <label style={s.label}>Toolbox Talk / Safety Topic</label>
                            <input style={s.input} value={dailyForm.toolbox_talk} onChange={e => setDailyForm(f => ({ ...f, toolbox_talk: e.target.value }))} placeholder="Topic discussed at morning meeting..." />
                          </div>
                          <div style={{ marginBottom: '1.5rem' }}>
                            <label style={s.label}>Safety Observations</label>
                            <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={dailyForm.safety_observations} onChange={e => setDailyForm(f => ({ ...f, safety_observations: e.target.value }))} placeholder="Near misses, hazards, corrective actions..." />
                          </div>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setWizardStep(1)} style={{ ...s.btnSm(), padding: '11px 20px' }}>← Back</button>
                            <button onClick={() => { if (!dailyForm.work_performed.trim()) { alert('Please describe the work performed.'); return }; setWizardStep(3) }} style={{ ...s.btn, flex: 1 }}>Continue →</button>
                          </div>
                        </div>
                      )}

                      {/* Step 3: Crew & Activity */}
                      {wizardStep === 3 && (
                        <div className="wizard-step">
                          {/* Crew Presets */}
                          {crewPresets.length > 0 && (
                            <div style={{ marginBottom: '1rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              {crewPresets.map((p, i) => (
                                <button key={i} type="button" onClick={() => setCrewLog(p.crew.map(r => ({ ...r })))} style={{ ...s.btnSm('orange'), fontSize: '11px' }}>
                                  Load: {p.name}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Crew Log */}
                          <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={s.label}>Crew / Manpower</label>
                              <button type="button" onClick={() => setCrewLog(l => [...l, { name: '', company: '', trade: '', hours: '' }])} style={s.btnSm('orange')}>+ Add</button>
                            </div>
                            {crewLog.map((row, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }} className="rx-form-row">
                                <input style={s.input} placeholder="Name" value={row.name} onChange={e => setCrewLog(l => l.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                                <input style={s.input} placeholder="Company" value={row.company} onChange={e => setCrewLog(l => l.map((r, j) => j === i ? { ...r, company: e.target.value } : r))} />
                                <input style={s.input} placeholder="Trade" value={row.trade} onChange={e => setCrewLog(l => l.map((r, j) => j === i ? { ...r, trade: e.target.value } : r))} />
                                <input style={s.input} placeholder="Hrs" type="number" value={row.hours} onChange={e => setCrewLog(l => l.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))} />
                                <button type="button" onClick={() => setCrewLog(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
                              </div>
                            ))}
                            {/* Save preset */}
                            {crewLog.filter(r => r.name || r.company).length > 0 && !showSavePreset && (
                              <button type="button" onClick={() => setShowSavePreset(true)} style={{ ...s.btnSm(), marginTop: '6px', fontSize: '11px' }}>Save as preset</button>
                            )}
                            {showSavePreset && (
                              <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                                <input style={{ ...s.input, flex: 1 }} placeholder="Preset name (e.g. Framing crew)" value={presetNameDraft} onChange={e => setPresetNameDraft(e.target.value)} autoFocus />
                                <button type="button" onClick={() => {
                                  if (!presetNameDraft.trim()) return
                                  const preset = { name: presetNameDraft.trim(), crew: crewLog.filter(r => r.name || r.company).map(r => ({ ...r })) }
                                  const updated = [...crewPresets, preset]
                                  setCrewPresets(updated)
                                  try { localStorage.setItem('nv_crew_presets', JSON.stringify(updated)) } catch {}
                                  setPresetNameDraft(''); setShowSavePreset(false)
                                }} style={s.btnSm('green')}>Save</button>
                                <button type="button" onClick={() => { setShowSavePreset(false); setPresetNameDraft('') }} style={s.btnSm('red')}>✕</button>
                              </div>
                            )}
                          </div>

                          {/* Subcontractor Activity */}
                          <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={s.label}>Subcontractor Activity</label>
                              <button type="button" onClick={() => setSubActivityLog(l => [...l, { subId: '', company: '', trade: '', crew_count: '', work_performed: '' }])} style={s.btnSm('orange')}>+ Add</button>
                            </div>
                            {subActivityLog.map((row, i) => (
                              <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }} className="rx-form-row">
                                  {subContacts.length > 0 ? (
                                    row.subId === 'other' ? (
                                      <input style={s.input} placeholder="Company name" value={row.company} onChange={e => setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, company: e.target.value } : r))} />
                                    ) : (
                                      <select style={s.input} value={row.subId} onChange={e => {
                                        const chosen = subContacts.find(sc => sc.id === e.target.value)
                                        setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, subId: e.target.value, company: chosen ? chosen.company_name : '', trade: chosen ? (chosen.trade || r.trade) : r.trade } : r))
                                      }}>
                                        <option value="">Select sub...</option>
                                        {subContacts.map(sc => <option key={sc.id} value={sc.id}>{sc.company_name}</option>)}
                                        <option value="other">Other / Manual</option>
                                      </select>
                                    )
                                  ) : (
                                    <input style={s.input} placeholder="Company" value={row.company} onChange={e => setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, company: e.target.value } : r))} />
                                  )}
                                  <input style={s.input} placeholder="Trade" value={row.trade} onChange={e => setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, trade: e.target.value } : r))} />
                                  <input style={s.input} placeholder="# Crew" type="number" value={row.crew_count} onChange={e => setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, crew_count: e.target.value } : r))} />
                                  <button type="button" onClick={() => setSubActivityLog(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
                                </div>
                                <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} placeholder="Work performed..." value={row.work_performed} onChange={e => setSubActivityLog(l => l.map((r, j) => j === i ? { ...r, work_performed: e.target.value } : r))} />
                              </div>
                            ))}
                          </div>

                          {/* Equipment */}
                          <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={s.label}>Equipment On Site</label>
                              <button type="button" onClick={() => setEquipmentLog(l => [...l, { name: '', quantity: '', hours: '' }])} style={s.btnSm('orange')}>+ Add</button>
                            </div>
                            {equipmentLog.map((row, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }} className="rx-form-row">
                                <input style={s.input} placeholder="Equipment name" value={row.name} onChange={e => setEquipmentLog(l => l.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                                <input style={s.input} placeholder="Qty" value={row.quantity} onChange={e => setEquipmentLog(l => l.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r))} />
                                <input style={s.input} placeholder="Hrs" type="number" value={row.hours} onChange={e => setEquipmentLog(l => l.map((r, j) => j === i ? { ...r, hours: e.target.value } : r))} />
                                <button type="button" onClick={() => setEquipmentLog(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
                              </div>
                            ))}
                          </div>

                          {/* Materials */}
                          <div style={{ marginBottom: '1.25rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={s.label}>Materials Delivered</label>
                              <button type="button" onClick={() => setMaterialsLog(l => [...l, { description: '', quantity: '', supplier: '' }])} style={s.btnSm('orange')}>+ Add</button>
                            </div>
                            {materialsLog.map((row, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 2fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }} className="rx-form-row">
                                <input style={s.input} placeholder="Material" value={row.description} onChange={e => setMaterialsLog(l => l.map((r, j) => j === i ? { ...r, description: e.target.value } : r))} />
                                <input style={s.input} placeholder="Qty" value={row.quantity} onChange={e => setMaterialsLog(l => l.map((r, j) => j === i ? { ...r, quantity: e.target.value } : r))} />
                                <input style={s.input} placeholder="Supplier" value={row.supplier} onChange={e => setMaterialsLog(l => l.map((r, j) => j === i ? { ...r, supplier: e.target.value } : r))} />
                                <button type="button" onClick={() => setMaterialsLog(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
                              </div>
                            ))}
                          </div>

                          {/* Visitors */}
                          <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <label style={s.label}>Visitors / Inspections</label>
                              <button type="button" onClick={() => setVisitorsLog(l => [...l, { name: '', company: '', purpose: '' }])} style={s.btnSm('orange')}>+ Add</button>
                            </div>
                            {visitorsLog.map((row, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 3fr 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }} className="rx-form-row">
                                <input style={s.input} placeholder="Name" value={row.name} onChange={e => setVisitorsLog(l => l.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                                <input style={s.input} placeholder="Company" value={row.company} onChange={e => setVisitorsLog(l => l.map((r, j) => j === i ? { ...r, company: e.target.value } : r))} />
                                <input style={s.input} placeholder="Purpose" value={row.purpose} onChange={e => setVisitorsLog(l => l.map((r, j) => j === i ? { ...r, purpose: e.target.value } : r))} />
                                <button type="button" onClick={() => setVisitorsLog(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '18px', padding: 0 }}>×</button>
                              </div>
                            ))}
                          </div>

                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setWizardStep(2)} style={{ ...s.btnSm(), padding: '11px 20px' }}>← Back</button>
                            <button onClick={() => setWizardStep(4)} style={{ ...s.btn, flex: 1 }}>Continue →</button>
                          </div>
                        </div>
                      )}

                      {/* Step 4: Photos & Submit */}
                      {wizardStep === 4 && (
                        <div className="wizard-step">
                          {/* Quick summary */}
                          <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px 14px', marginBottom: '1.25rem', fontSize: '13px', color: '#888', lineHeight: '1.8' }}>
                            <span style={{ color: '#f1f1f1', fontWeight: '700' }}>{new Date(dailyForm.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</span>
                            {dailyForm.weather && <span> · {dailyForm.weather}{dailyForm.weather_temp ? ` ${dailyForm.weather_temp}°` : ''}</span>}
                            {dailyForm.weather_delay && <span style={{ color: '#ff6b6b' }}> · Weather delay</span>}
                            <br />
                            {crewLog.filter(r => r.name || r.company).length > 0 && <span>{crewLog.filter(r => r.name || r.company).length} crew · </span>}
                            {subActivityLog.filter(r => r.company).length > 0 && <span>{subActivityLog.filter(r => r.company).length} sub co. · </span>}
                            {dailyForm.work_performed && <span style={{ color: '#aaa' }}>{dailyForm.work_performed.substring(0, 80)}{dailyForm.work_performed.length > 80 ? '...' : ''}</span>}
                          </div>

                          <div style={{ marginBottom: '1.5rem' }}>
                            <label style={s.label}>Attach photos</label>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 18px', background: uploadingPhoto ? '#111' : '#1a1a1a', color: uploadingPhoto ? '#555' : '#aaa', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: uploadingPhoto ? 'not-allowed' : 'pointer', letterSpacing: '1px', textTransform: 'uppercase' }}>
                              {uploadingPhoto ? 'Uploading...' : 'Add Photos'}
                              <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} disabled={uploadingPhoto} onChange={e => { Array.from(e.target.files || []).forEach(f => uploadReportPhoto(f)); e.target.value = '' }} />
                            </label>
                            {reportPhotos.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
                                {reportPhotos.map((p, i) => (
                                  <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', color: '#aaa', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    {p.name}
                                    <button type="button" onClick={() => setReportPhotos(l => l.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '14px', padding: 0 }}>×</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => setWizardStep(3)} style={{ ...s.btnSm(), padding: '11px 20px' }}>← Back</button>
                            <button onClick={submitDailyReport} disabled={submittingDaily} style={{ ...s.btn, flex: 1, opacity: submittingDaily ? 0.6 : 1 }}>
                              {submittingDaily ? 'Submitting...' : 'Submit Report ✓'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {dailyReports.length > 0 && (
                      <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>Past reports ({dailyReports.length})</p>
                        {dailyReports.map(r => {
                          const accent = r.weather_delay ? '#ff6b6b' : r.issues ? '#e8590c' : '#4ade80'
                          const crewCount = r.crew_count ?? r.crew_log?.filter(c => c.name || c.company).length ?? 0
                          const photoCount = r.photos?.length ?? 0
                          return (
                          <div key={r.id} style={{ ...s.row, borderLeft: `3px solid ${accent}` }}>
                            <div style={s.rowHead} onClick={() => { const opening = expandedReport !== r.id; setExpandedReport(opening ? r.id : null); if (opening && r.photos?.length) fetchPhotoUrls(r.photos.map(p => p.path)) }}>
                              <div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{new Date(r.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                  {r.weather_delay && <span style={{ fontSize: '10px', color: '#ff6b6b', fontWeight: '700', letterSpacing: '0.5px' }}>DELAY</span>}
                                </div>
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                                  {r.weather && <span style={{ fontSize: '11px', color: '#555' }}>{r.weather}{r.weather_temp ? ` ${r.weather_temp}°` : ''}</span>}
                                  {crewCount > 0 && <span style={{ fontSize: '11px', color: '#555' }}>{crewCount} crew</span>}
                                  {photoCount > 0 && <span style={{ fontSize: '11px', color: '#555' }}>{photoCount} photos</span>}
                                </div>
                              </div>
                              <span style={{ color: '#333', fontSize: '14px', flexShrink: 0 }}>{expandedReport === r.id ? '▲' : '▼'}</span>
                            </div>
                            {expandedReport === r.id && (
                              <div style={s.rowBody}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Work performed</p>
                                <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{r.work_performed}</p>
                                {r.crew_log?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Crew</p>
                                  {r.crew_log.map((c, i) => <p key={i} style={{ fontSize: '12px', color: '#aaa', margin: '0 0 3px' }}>{c.name}{c.company ? ` — ${c.company}` : ''}{c.trade ? ` (${c.trade})` : ''}{c.hours ? ` · ${c.hours}hrs` : ''}</p>)}
                                  <div style={{ marginBottom: '1rem' }} />
                                </>)}
                                {r.subcontractor_activity?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Subcontractor Activity</p>
                                  {r.subcontractor_activity.map((c, i) => <div key={i} style={{ marginBottom: '6px' }}><p style={{ fontSize: '12px', color: '#aaa', margin: '0 0 2px', fontWeight: '600' }}>{c.company}{c.trade ? ` — ${c.trade}` : ''}{c.crew_count ? ` (${c.crew_count} crew)` : ''}</p>{c.work_performed && <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>{c.work_performed}</p>}</div>)}
                                  <div style={{ marginBottom: '1rem' }} />
                                </>)}
                                {r.equipment_log?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Equipment</p>
                                  {r.equipment_log.map((e, i) => <p key={i} style={{ fontSize: '12px', color: '#aaa', margin: '0 0 3px' }}>{e.name}{e.quantity ? ` × ${e.quantity}` : ''}{e.hours ? ` · ${e.hours}hrs` : ''}</p>)}
                                  <div style={{ marginBottom: '1rem' }} />
                                </>)}
                                {r.materials_delivered?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Materials Delivered</p>
                                  {r.materials_delivered.map((m, i) => <p key={i} style={{ fontSize: '12px', color: '#aaa', margin: '0 0 3px' }}>{m.description}{m.quantity ? ` · ${m.quantity}` : ''}{m.supplier ? ` — ${m.supplier}` : ''}</p>)}
                                  <div style={{ marginBottom: '1rem' }} />
                                </>)}
                                {r.visitors?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Visitors</p>
                                  {r.visitors.map((v, i) => <p key={i} style={{ fontSize: '12px', color: '#aaa', margin: '0 0 3px' }}>{v.name}{v.company ? ` — ${v.company}` : ''}{v.purpose ? ` · ${v.purpose}` : ''}</p>)}
                                  <div style={{ marginBottom: '1rem' }} />
                                </>)}
                                {r.toolbox_talk && (<><p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Toolbox Talk</p><p style={{ fontSize: '13px', color: '#ccc', margin: '0 0 1rem' }}>{r.toolbox_talk}</p></>)}
                                {r.safety_observations && (<><p style={{ fontSize: '11px', fontWeight: '700', color: '#facc15', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Safety</p><p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{r.safety_observations}</p></>)}
                                {r.issues && (<><p style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Issues / Delays</p><p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{r.issues}</p></>)}
                                {r.photos?.length > 0 && (<>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Photos ({r.photos.length})</p>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '1rem' }}>
                                    {r.photos.map((p, i) => (
                                      <button key={i} type="button" onClick={() => openLightbox(r.photos, i)} style={{ aspectRatio: '1', background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', padding: 0 }}>
                                        {(photoUrls[tp(p.path)] || photoUrls[p.path])
                                          ? <img src={photoUrls[tp(p.path)] || photoUrls[p.path]} loading="lazy" decoding="async" onError={e => { const full = photoUrls[p.path]; if (full && e.target.src !== full) e.target.src = full }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={p.name} />
                                          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '10px', padding: '4px', textAlign: 'center' }}>{p.name || `#${i+1}`}</div>
                                        }
                                      </button>
                                    ))}
                                  </div>
                                </>)}
                              </div>
                            )}
                          </div>
                        )})}
                      </>
                    )}
                  </>
                )}

                {/* ── RFIs ── */}
                {activeTab === 'rfi' && (
                  <>
                    {rfiSuccess && <div style={s.success}>RFI submitted. The PM will respond shortly.</div>}
                    <div style={s.card}>
                      <h2 style={s.cardTitle}>Submit RFI</h2>
                      <form onSubmit={submitRfi}>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Subject *</label>
                          <input style={s.input} required value={rfiForm.title} onChange={e => setRfiForm(f => ({ ...f, title: e.target.value }))} placeholder="Question about electrical panel location..." />
                        </div>
                        <div style={{ marginBottom: '1.5rem' }}>
                          <label style={s.label}>Details</label>
                          <textarea rows={4} style={{ ...s.input, resize: 'vertical' }} value={rfiForm.description} onChange={e => setRfiForm(f => ({ ...f, description: e.target.value }))} placeholder="Provide details, reference drawings, etc..." />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="submit" disabled={submittingRfi} style={{ ...s.btn, opacity: submittingRfi ? 0.6 : 1 }}>{submittingRfi ? 'Submitting...' : 'Submit RFI'}</button>
                        </div>
                      </form>
                    </div>
                    {rfis.length > 0 && (
                      <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 0.75rem' }}>My RFIs ({rfis.length})</p>
                        {rfis.map(rfi => (
                          <div key={rfi.id} style={s.row}>
                            <div style={s.rowHead} onClick={() => setExpandedRfi(expandedRfi === rfi.id ? null : rfi.id)}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{rfi.title}</span>
                                  <span style={s.badge(rfi.status)}>{rfi.status}</span>
                                </div>
                                <span style={{ fontSize: '12px', color: '#555' }}>{new Date(rfi.created_at).toLocaleDateString()}</span>
                              </div>
                              <span style={{ color: '#555' }}>{expandedRfi === rfi.id ? '▲' : '▼'}</span>
                            </div>
                            {expandedRfi === rfi.id && (
                              <div style={s.rowBody}>
                                {rfi.description && <>
                                  <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Details</p>
                                  <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{rfi.description}</p>
                                </>}
                                {rfi.response ? (
                                  <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem' }}>
                                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>PM Response</p>
                                    <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{rfi.response}</p>
                                    {rfi.responded_at && <p style={{ fontSize: '11px', color: '#1a4a1a', margin: '6px 0 0' }}>{new Date(rfi.responded_at).toLocaleDateString()}</p>}
                                  </div>
                                ) : (
                                  <p style={{ fontSize: '13px', color: '#555', fontStyle: 'italic' }}>Awaiting response from PM.</p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* ── DELIVERIES ── */}
                {activeTab === 'deliveries' && (
                  <>
                    {deliverySuccess && <div style={s.success}>Delivery logged.</div>}

                    {/* Sub-tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid #222', marginBottom: '1rem' }}>
                      {[{ key: 'mine', label: 'My Log' }, { key: 'expected', label: 'Expected (PM)' }].map(t => (
                        <button key={t.key} onClick={() => setDeliverySubTab(t.key)} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none', color: deliverySubTab === t.key ? '#f1f1f1' : '#555', borderBottom: deliverySubTab === t.key ? '2px solid #e8590c' : '2px solid transparent', letterSpacing: '0.5px', marginBottom: '-1px', whiteSpace: 'nowrap' }}>{t.label}</button>
                      ))}
                    </div>

                    {/* My Log sub-tab */}
                    {deliverySubTab === 'mine' && (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                          <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{deliveries.filter(d => d.source !== 'pm').length} entr{deliveries.filter(d => d.source !== 'pm').length !== 1 ? 'ies' : 'y'}</p>
                          <button style={s.btnSm('orange')} onClick={() => setShowDeliveryForm(v => !v)}>{showDeliveryForm ? 'Cancel' : '+ Log delivery'}</button>
                        </div>
                        {showDeliveryForm && (
                          <div style={s.card}>
                            <h2 style={s.cardTitle}>Log delivery</h2>
                            <form onSubmit={submitDelivery}>
                              <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                                <div><label style={s.label}>Material *</label><input style={s.input} required value={deliveryForm.material} onChange={e => setDeliveryForm(f => ({ ...f, material: e.target.value }))} placeholder="Lumber, rebar, concrete..." /></div>
                                <div><label style={s.label}>Vendor</label><input style={s.input} value={deliveryForm.vendor} onChange={e => setDeliveryForm(f => ({ ...f, vendor: e.target.value }))} placeholder="ABC Supply" /></div>
                              </div>
                              <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                                <div><label style={s.label}>Expected date</label><input type="date" style={s.input} value={deliveryForm.expected_date} onChange={e => setDeliveryForm(f => ({ ...f, expected_date: e.target.value }))} /></div>
                                <div><label style={s.label}>Quantity</label><input style={s.input} value={deliveryForm.quantity} onChange={e => setDeliveryForm(f => ({ ...f, quantity: e.target.value }))} placeholder="100 sheets, 5 tons..." /></div>
                              </div>
                              <div style={{ marginBottom: '1.5rem' }}>
                                <label style={s.label}>Notes</label>
                                <input style={s.input} value={deliveryForm.notes} onChange={e => setDeliveryForm(f => ({ ...f, notes: e.target.value }))} placeholder="Special instructions..." />
                              </div>
                              <button type="submit" disabled={submittingDelivery} style={{ ...s.btn, opacity: submittingDelivery ? 0.6 : 1 }}>{submittingDelivery ? 'Saving...' : 'Log delivery'}</button>
                            </form>
                          </div>
                        )}
                        {deliveries.filter(d => d.source !== 'pm').length === 0 && !showDeliveryForm && <div style={s.empty}>No deliveries logged yet.</div>}
                        {deliveries.filter(d => d.source !== 'pm').map(d => (
                          <div key={d.id} style={{ ...s.row, border: `1px solid ${d.status === 'received' ? '#1a4a1a' : '#1e1e1e'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' }}>
                              <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                  <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{d.material}</span>
                                  <span style={s.badge(d.status)}>{d.status}</span>
                                  {d.source === 'daily_report' && <span style={{ fontSize: '10px', color: '#666', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '1px 6px', fontWeight: '700' }}>DAILY RPT</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: '#555' }}>
                                  {d.vendor && `${d.vendor} · `}{d.quantity && `${d.quantity} · `}
                                  {d.expected_date && `Expected ${new Date(d.expected_date + 'T12:00:00').toLocaleDateString()}`}
                                  {d.received_date && ` · Received ${new Date(d.received_date + 'T12:00:00').toLocaleDateString()}`}
                                </div>
                                {d.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{d.notes}</div>}
                              </div>
                              {d.status === 'pending' && (
                                <button style={{ ...s.btnSm('green'), opacity: updatingDelivery === d.id ? 0.6 : 1 }} disabled={updatingDelivery === d.id} onClick={() => markDeliveryReceived(d.id)}>
                                  {updatingDelivery === d.id ? '...' : 'Mark received'}
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {/* Expected (PM) sub-tab */}
                    {deliverySubTab === 'expected' && (
                      <>
                        {deliveries.filter(d => d.source === 'pm').length === 0
                          ? <div style={s.empty}>No deliveries have been scheduled by the PM yet.</div>
                          : deliveries.filter(d => d.source === 'pm').map(d => (
                            <div key={d.id} style={{ ...s.row, border: `1px solid ${d.status === 'received' ? '#1a4a1a' : '#4a2200'}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' }}>
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{d.material}</span>
                                    <span style={s.badge(d.status)}>{d.status}</span>
                                  </div>
                                  <div style={{ fontSize: '12px', color: '#555' }}>
                                    {d.vendor && `${d.vendor} · `}{d.quantity && `${d.quantity} · `}
                                    {d.expected_date && <span style={{ color: '#e8590c', fontWeight: '600' }}>Expected {new Date(d.expected_date + 'T12:00:00').toLocaleDateString()}</span>}
                                    {d.received_date && <span> · Received {new Date(d.received_date + 'T12:00:00').toLocaleDateString()}</span>}
                                  </div>
                                  {d.notes && <div style={{ fontSize: '12px', color: '#aaa', marginTop: '4px' }}>{d.notes}</div>}
                                </div>
                                {d.status === 'pending' && (
                                  <button style={{ ...s.btnSm('green'), opacity: updatingDelivery === d.id ? 0.6 : 1 }} disabled={updatingDelivery === d.id} onClick={() => markDeliveryReceived(d.id)}>
                                    {updatingDelivery === d.id ? '...' : 'Mark received'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        }
                      </>
                    )}
                  </>
                )}

                {/* ── SCHEDULE ── */}
                {activeTab === 'schedule' && (
                  milestones.length === 0 ? (
                    <div style={s.empty}>No milestones set yet.<br />The PM will add schedule milestones here.</div>
                  ) : milestones.map(m => (
                    <div key={m.id} style={{ ...s.row, border: `1px solid ${m.status === 'complete' ? '#1a4a1a' : m.status === 'delayed' ? '#5a1a1a' : '#1e1e1e'}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: m.status === 'complete' ? '#4ade80' : '#f1f1f1' }}>{m.title}</span>
                            <span style={s.badge(m.status)}>{m.status}</span>
                          </div>
                          <div style={{ fontSize: '12px', color: '#555' }}>
                            {m.due_date && `Due ${new Date(m.due_date + 'T12:00:00').toLocaleDateString()}`}
                            {m.completed_date && ` · Completed ${new Date(m.completed_date + 'T12:00:00').toLocaleDateString()}`}
                          </div>
                          {m.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{m.notes}</div>}
                        </div>
                        {m.status !== 'complete' && (
                          <button style={{ ...s.btnSm('green'), opacity: completingMilestone === m.id ? 0.6 : 1 }} disabled={completingMilestone === m.id} onClick={() => completeMilestone(m.id)}>
                            {completingMilestone === m.id ? '...' : 'Mark complete'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {/* ── DIRECT COSTS ── */}
                {activeTab === 'costs' && (
                  <>
                    {dcSuccess && <div style={s.success}>Cost logged successfully.</div>}
                    {dcError && <div style={{ background: '#1a0000', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem', fontSize: '13px', color: '#ff6b6b', lineHeight: '1.5' }}>{dcError}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{directCosts.length} entr{directCosts.length !== 1 ? 'ies' : 'y'} · Total ${directCosts.reduce((a, c) => a + Number(c.amount || 0), 0).toLocaleString()}</p>
                      <button style={s.btnSm('orange')} onClick={() => setShowDcForm(v => !v)}>{showDcForm ? 'Cancel' : '+ Log cost'}</button>
                    </div>
                    {showDcForm && (
                      <div style={s.card}>
                        <h2 style={s.cardTitle}>Log direct cost</h2>
                        <form onSubmit={submitDirectCost}>
                          <div style={{ ...s.grid3, marginBottom: '1rem' }} className="rx-grid-3">
                            <div>
                              <label style={s.label}>Date *</label>
                              <input type="date" style={s.input} required value={dcForm.cost_date} onChange={e => setDcForm(f => ({ ...f, cost_date: e.target.value }))} />
                            </div>
                            <div>
                              <label style={s.label}>Category *</label>
                              <select style={s.input} required value={dcForm.category} onChange={e => setDcForm(f => ({ ...f, category: e.target.value }))}>
                                {['Materials', 'Tools', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Meals/Entertainment', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            </div>
                            <div>
                              <label style={s.label}>Amount ($) *</label>
                              <input type="number" step="0.01" min="0" style={s.input} required value={dcForm.amount} onChange={e => setDcForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                            </div>
                          </div>
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={s.label}>Description *</label>
                            <input style={s.input} required value={dcForm.description} onChange={e => setDcForm(f => ({ ...f, description: e.target.value }))} placeholder="Lumber for framing, concrete delivery..." />
                          </div>
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={s.label}>Reason *</label>
                            <input style={s.input} required value={dcForm.reason} onChange={e => setDcForm(f => ({ ...f, reason: e.target.value }))} placeholder="Why was this purchase made?" />
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                            <div>
                              <label style={s.label}>Notes</label>
                              <input style={s.input} value={dcForm.notes} onChange={e => setDcForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                            </div>
                            <div>
                              <label style={s.label}>Receipt (photo / PDF)</label>
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, padding: '8px 14px' }} onChange={e => setDcFile(e.target.files[0])} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="submit" disabled={submittingDc} style={{ ...s.btn, opacity: submittingDc ? 0.6 : 1 }}>{submittingDc ? 'Saving...' : 'Log cost'}</button>
                          </div>
                        </form>
                      </div>
                    )}
                    {directCosts.length === 0 && !showDcForm && <div style={s.empty}>No direct costs logged yet.</div>}
                    {directCosts.map(c => (
                      <div key={c.id} style={{ ...s.row, border: `1px solid ${c.status === 'approved' ? '#1a4a1a' : c.status === 'rejected' ? '#5a1a1a' : '#1e1e1e'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{c.description}</span>
                              <span style={s.badge(c.category.toLowerCase())}>{c.category}</span>
                              <span style={s.badge(c.status)}>{c.status}</span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#555' }}>
                              {new Date(c.cost_date + 'T12:00:00').toLocaleDateString()}
                              {c.reason && ` · ${c.reason}`}
                              {c.status !== 'rejected' && c.notes && ` · ${c.notes}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '15px', fontWeight: '800', color: '#f1f1f1' }}>${Number(c.amount).toLocaleString()}</span>
                            {c.receipt_url && (
                              <button style={s.btnSm('orange')} onClick={() => openReceiptUrl(c.receipt_url)}>View receipt</button>
                            )}
                          </div>
                        </div>
                        {c.status === 'rejected' && c.notes && (
                          <div style={{ background: '#1a0a0a', borderTop: '1px solid #3a1a1a', padding: '10px 16px' }}>
                            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: '700' }}>Rejection reason</p>
                            <p style={{ margin: 0, fontSize: '13px', color: '#ff6b6b', lineHeight: '1.5' }}>{c.notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* ── CONTACTS ── */}
                {activeTab === 'subs' && (
                  <>
                    {contactSuccess && <div style={s.success}>Contact added successfully.</div>}

                    {/* Add contact button / form */}
                    <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowContactForm(f => !f)} style={s.btnSm('orange')}>
                        {showContactForm ? '✕ Cancel' : '+ Add Contact'}
                      </button>
                    </div>

                    {showContactForm && (
                      <div style={{ ...s.card, marginBottom: '1.5rem' }}>
                        <p style={s.cardTitle}>Add Contact</p>
                        <form onSubmit={submitJobContact}>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                            <div><label style={s.label}>Name *</label><input style={s.input} required value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} placeholder="John Smith" autoFocus /></div>
                            <div><label style={s.label}>Company</label><input style={s.input} value={contactForm.company} onChange={e => setContactForm(f => ({ ...f, company: e.target.value }))} placeholder="ABC Engineering" /></div>
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                            <div><label style={s.label}>Role</label><input style={s.input} value={contactForm.role} onChange={e => setContactForm(f => ({ ...f, role: e.target.value }))} placeholder="Inspector, Engineer..." /></div>
                            <div><label style={s.label}>Phone</label><input type="tel" style={s.input} value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} placeholder="(555) 000-0000" /></div>
                          </div>
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={s.label}>Email</label>
                            <input type="email" style={s.input} value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
                          </div>
                          <div style={{ marginBottom: '1.5rem' }}>
                            <label style={s.label}>Notes</label>
                            <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={contactForm.notes} onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))} placeholder="Available Mon-Fri, call before noon..." />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="submit" disabled={submittingContact} style={{ ...s.btn, opacity: submittingContact ? 0.6 : 1 }}>
                              {submittingContact ? 'Saving...' : 'Save Contact'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {jobContacts.length > 0 && (
                      <>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '10px', paddingLeft: '2px' }}>Project Contacts</div>
                        {jobContacts.map(c => (
                          <div key={c.id} style={s.card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                              <div>
                                <p style={{ margin: '0 0 2px', fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{c.name}</p>
                                {c.company && <p style={{ margin: 0, fontSize: '13px', color: '#888' }}>{c.company}</p>}
                              </div>
                              {c.role && (
                                <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: '#0a1a2a', color: '#60a5fa', border: '1px solid #1a3a5a', whiteSpace: 'nowrap' }}>
                                  {c.role}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                              {c.phone && (
                                <div>
                                  <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Phone</div>
                                  <a href={`tel:${c.phone}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{c.phone}</a>
                                </div>
                              )}
                              {c.email && (
                                <div>
                                  <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Email</div>
                                  <a href={`mailto:${c.email}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{c.email}</a>
                                </div>
                              )}
                            </div>
                            {c.notes && <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#666', lineHeight: '1.5' }}>{c.notes}</p>}
                          </div>
                        ))}
                      </>
                    )}

                    {subContacts.length > 0 && (
                      <>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: `${jobContacts.length > 0 ? '20px' : '0'} 0 10px`, paddingLeft: '2px' }}>Subcontractors</div>
                        {subContacts.map(sub => (
                          <div key={sub.id} style={s.card}>
                            <p style={{ margin: '0 0 3px', fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{sub.company_name}</p>
                            {sub.contact_name && <p style={{ margin: '0 0 3px', fontSize: '13px', color: '#888' }}>{sub.contact_name}</p>}
                            {sub.trade && <p style={{ margin: '0 0 12px', fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>{sub.trade}</p>}
                            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                              {sub.phone && (
                                <div>
                                  <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Phone</div>
                                  <a href={`tel:${sub.phone}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{sub.phone}</a>
                                </div>
                              )}
                              {sub.email && (
                                <div>
                                  <div style={{ fontSize: '11px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '3px' }}>Email</div>
                                  <a href={`mailto:${sub.email}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{sub.email}</a>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {jobContacts.length === 0 && subContacts.length === 0 && !showContactForm && (
                      <div style={s.empty}>No contacts yet.<br />Tap "+ Add Contact" to save inspectors, engineers, and other project contacts.</div>
                    )}
                  </>
                )}
              </>
            )}

                {/* ── DOCUMENTS ── */}
                {activeTab === 'docs' && (
                  <>
                    <div style={s.card}>
                      <p style={s.cardTitle}>Project Documents</p>
                      <p style={{ fontSize: '13px', color: '#666', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                        View and upload plans, geotech reports, permits, and other project documents.
                      </p>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <select
                          value={docCategory}
                          onChange={e => setDocCategory(e.target.value)}
                          style={{ padding: '9px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '13px', color: '#f1f1f1', outline: 'none' }}
                        >
                          <option value="plans">Plans</option>
                          <option value="geotech">Geotech / Soil Reports</option>
                          <option value="permits">Permits</option>
                          <option value="specs">Specifications</option>
                          <option value="other">Other</option>
                        </select>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: uploadingDoc ? '#111' : '#2a1200', color: uploadingDoc ? '#555' : '#e8590c', border: '1px solid #4a2200', borderRadius: '8px', fontSize: '12px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', cursor: uploadingDoc ? 'not-allowed' : 'pointer' }}>
                          {uploadingDoc ? 'Uploading...' : '+ Upload Document'}
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.dwg,.zip" style={{ display: 'none' }} disabled={uploadingDoc}
                            onChange={e => { if (e.target.files?.[0]) uploadJobDoc(e.target.files[0]); e.target.value = '' }} />
                        </label>
                      </div>
                    </div>

                    {jobDocs.length > 0 && (
                      <div style={s.card}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                          <p style={{ ...s.cardTitle, marginBottom: 0 }}>Uploaded Documents ({jobDocs.length})</p>
                          <select
                            value={filterDocCategory}
                            onChange={e => setFilterDocCategory(e.target.value)}
                            style={{ padding: '7px 12px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', color: '#aaa', outline: 'none' }}
                          >
                            <option value="all">All categories</option>
                            <option value="plans">Plans</option>
                            <option value="geotech">Geotech / Soil Reports</option>
                            <option value="permits">Permits</option>
                            <option value="specs">Specifications</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        {jobDocs.filter(d => filterDocCategory === 'all' || d.category === filterDocCategory).map(d => (
                          <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                            <div>
                              <span style={{ fontSize: '14px', color: '#f1f1f1' }}>{d.file_name}</span>
                              <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                                <span style={{ padding: '2px 8px', background: '#1a1200', color: '#e8590c', border: '1px solid #3a2200', borderRadius: '4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                                  {d.category === 'geotech' ? 'Geotech' : d.category === 'plans' ? 'Plans' : d.category === 'permits' ? 'Permits' : d.category === 'specs' ? 'Specs' : 'Other'}
                                </span>
                                <span style={{ fontSize: '12px', color: '#555' }}>{new Date(d.uploaded_at).toLocaleDateString()}</span>
                              </div>
                            </div>
                            <button style={s.btnSm('orange')} onClick={() => openJobDoc(d.storage_path)}>Open</button>
                          </div>
                        ))}
                        {jobDocs.filter(d => filterDocCategory === 'all' || d.category === filterDocCategory).length === 0 && (
                          <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>No documents in this category.</p>
                        )}
                      </div>
                    )}

                    {jobDocs.length === 0 && (
                      <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                        <p style={{ color: '#555', margin: 0 }}>No documents uploaded yet for this job.</p>
                      </div>
                    )}
                  </>
                )}

                {/* ── PUNCH LIST ── */}
                {activeTab === 'punch' && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>
                        {punchItems.length} item{punchItems.length !== 1 ? 's' : ''}{punchItems.filter(p => p.status === 'open').length > 0 ? ` · ${punchItems.filter(p => p.status === 'open').length} open` : ''}
                      </p>
                      <button style={s.btnSm('orange')} onClick={() => setShowPunchForm(v => !v)}>
                        {showPunchForm ? 'Cancel' : '+ Add item'}
                      </button>
                    </div>

                    {showPunchForm && (
                      <div style={s.card}>
                        <h2 style={s.cardTitle}>Add punch list item</h2>
                        <form onSubmit={async e => {
                          e.preventDefault()
                          setSubmittingPunch(true)
                          await fetch('/api/punch-list', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ job_id: selectedJobId, title: punchForm.title, description: punchForm.description || null, due_date: punchForm.due_date || null, created_by: user.id })
                          })
                          setPunchForm({ title: '', description: '', due_date: '' })
                          setShowPunchForm(false)
                          await loadPunchItems()
                          setSubmittingPunch(false)
                        }}>
                          <div style={{ marginBottom: '1rem' }}>
                            <label style={s.label}>Item *</label>
                            <input style={s.input} required value={punchForm.title} onChange={e => setPunchForm(f => ({ ...f, title: e.target.value }))} placeholder="Fix cracked drywall in room 204..." />
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                            <div>
                              <label style={s.label}>Description</label>
                              <input style={s.input} value={punchForm.description} onChange={e => setPunchForm(f => ({ ...f, description: e.target.value }))} placeholder="Additional details..." />
                            </div>
                            <div>
                              <label style={s.label}>Due date</label>
                              <input type="date" style={s.input} value={punchForm.due_date} onChange={e => setPunchForm(f => ({ ...f, due_date: e.target.value }))} />
                            </div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="submit" disabled={submittingPunch} style={{ ...s.btn, opacity: submittingPunch ? 0.6 : 1 }}>
                              {submittingPunch ? 'Adding...' : 'Add item'}
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    {punchItems.length === 0 && !showPunchForm && (
                      <div style={s.empty}>No punch list items yet.<br />Add items as you walk the site.</div>
                    )}

                    {punchItems.map(item => (
                      <div key={item.id} style={{ ...s.row, border: `1px solid ${item.status === 'approved' ? '#1a4a1a' : item.status === 'sub_complete' ? '#1a2a3a' : item.status === 'rejected' ? '#5a1a1a' : '#1e1e1e'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f', flexWrap: 'wrap', gap: '8px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '14px', fontWeight: '700', color: item.status === 'approved' ? '#4ade80' : '#f1f1f1' }}>{item.title}</span>
                              <span style={s.badge(item.status === 'sub_complete' ? 'partial' : item.status)}>
                                {item.status === 'sub_complete' ? 'ready to inspect' : item.status}
                              </span>
                            </div>
                            <div style={{ fontSize: '12px', color: '#555' }}>
                              {item.assigned_company && `${item.assigned_company} · `}
                              {item.due_date && `Due ${new Date(item.due_date + 'T12:00:00').toLocaleDateString()}`}
                              {item.completed_at && ` · Completed ${new Date(item.completed_at).toLocaleDateString()}`}
                            </div>
                            {item.description && <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{item.description}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {item.status === 'open' && (
                              <button
                                style={{ ...s.btnSm('green'), opacity: updatingPunch === item.id ? 0.6 : 1 }}
                                disabled={updatingPunch === item.id}
                                onClick={async () => {
                                  setUpdatingPunch(item.id)
                                  await fetch('/api/punch-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: 'sub_complete' }) })
                                  await loadPunchItems()
                                  setUpdatingPunch(null)
                                }}
                              >
                                {updatingPunch === item.id ? '...' : 'Mark done'}
                              </button>
                            )}
                            {item.status === 'sub_complete' && (
                              <button
                                style={{ ...s.btnSm(''), opacity: updatingPunch === item.id ? 0.6 : 1 }}
                                disabled={updatingPunch === item.id}
                                onClick={async () => {
                                  setUpdatingPunch(item.id)
                                  await fetch('/api/punch-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, status: 'open' }) })
                                  await loadPunchItems()
                                  setUpdatingPunch(null)
                                }}
                              >
                                {updatingPunch === item.id ? '...' : 'Reopen'}
                              </button>
                            )}
                          </div>
                        </div>
                        {item.pm_notes && (
                          <div style={{ background: '#0a1a2a', borderTop: '1px solid #1a3a5a', padding: '10px 16px' }}>
                            <p style={{ margin: '0 0 4px', fontSize: '11px', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: '700' }}>PM Notes</p>
                            <p style={{ margin: 0, fontSize: '13px', color: '#aaa', lineHeight: '1.5' }}>{item.pm_notes}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {/* ── SITE PHOTOS ── */}
                {activeTab === 'photos' && (() => {
                  const allPhotos = [
                    ...standalonePhotos.map(p => ({ path: p.storage_path, name: p.file_name, caption: p.caption, tag: p.tag || null, date: p.taken_at?.split('T')[0] })),
                    ...dailyReports.flatMap(r => (r.photos || []).map(p => ({ path: p.path, name: p.name, caption: p.caption || null, tag: p.tag || null, date: r.report_date, fromReport: true, reportId: r.id }))),
                  ].sort((a, b) => new Date(b.date) - new Date(a.date))
                  const usedTags = [...new Set(allPhotos.filter(p => p.tag).map(p => p.tag))].sort()
                  const filtered = photoTagFilter === 'all' ? allPhotos : allPhotos.filter(p => p.tag === photoTagFilter)
                  const byDate = filtered.reduce((acc, p) => { const d = p.date || 'Unknown'; (acc[d] = acc[d] || []).push(p); return acc }, {})
                  const dates = Object.keys(byDate).sort((a, b) => new Date(b) - new Date(a))

                  return (
                    <>
                      {/* Upload strip */}
                      <div style={s.card}>
                        <label style={{ ...s.label, marginBottom: '8px' }}>Tag</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                          {PHOTO_TAGS.map(t => (
                            <button key={t} type="button" onClick={() => setTagDraft(prev => prev === t ? '' : t)}
                              style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${tagDraft === t ? '#e8590c' : '#2a2a2a'}`, background: tagDraft === t ? '#2a1200' : '#0a0a0a', color: tagDraft === t ? '#e8590c' : '#555', transition: 'all 0.1s' }}>
                              {t}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: '180px' }}>
                            <label style={s.label}>Caption (optional)</label>
                            <input style={s.input} value={captionDraft} onChange={e => setCaptionDraft(e.target.value)} placeholder="Notes about this photo..." />
                          </div>
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '11px 20px', background: uploadingGalleryPhoto ? '#111' : '#e8590c', color: '#fff', borderRadius: '8px', fontSize: '13px', fontWeight: '700', cursor: uploadingGalleryPhoto ? 'not-allowed' : 'pointer', letterSpacing: '1px', textTransform: 'uppercase', flexShrink: 0 }}>
                            {uploadingGalleryPhoto ? 'Uploading...' : '+ Add Photo'}
                            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} disabled={uploadingGalleryPhoto} multiple onChange={async e => { for (const f of Array.from(e.target.files || [])) await uploadGalleryPhoto(f, undefined, undefined); e.target.value = '' }} />
                          </label>
                        </div>
                      </div>

                      {/* Migration banner / button */}
                      {migration ? (
                        <div style={{ background: migration.done ? '#0a1a0a' : '#141414', border: `1px solid ${migration.done ? '#1a4a1a' : '#2a2a2a'}`, borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          {migration.done ? (
                            <>
                              <span style={{ color: '#4ade80', fontSize: '13px', fontWeight: '700', flex: 1 }}>All photos optimized — load times are now faster.</span>
                              <button onClick={() => setMigration(null)} style={s.btnSm()}>Dismiss</button>
                            </>
                          ) : (
                            <>
                              <span style={{ color: '#aaa', fontSize: '13px', flex: 1 }}>Optimizing {migration.processed} / {migration.total} photos...</span>
                              <div style={{ width: '100px', height: '4px', background: '#222', borderRadius: '2px', overflow: 'hidden', flexShrink: 0 }}>
                                <div style={{ height: '100%', background: '#e8590c', width: `${migration.total ? (migration.processed / migration.total) * 100 : 0}%`, transition: 'width 0.3s ease' }} />
                              </div>
                            </>
                          )}
                        </div>
                      ) : totalGalleryPhotos > 0 && (
                        <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                          <button onClick={migratePhotos} style={s.btnSm()}>Optimize {totalGalleryPhotos} existing photos</button>
                        </div>
                      )}

                      {/* Tag filter pills */}
                      {usedTags.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '1.25rem' }}>
                          <button onClick={() => setPhotoTagFilter('all')} style={{ padding: '5px 12px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${photoTagFilter === 'all' ? '#e8590c' : '#2a2a2a'}`, background: photoTagFilter === 'all' ? '#2a1200' : '#141414', color: photoTagFilter === 'all' ? '#e8590c' : '#555' }}>
                            All ({allPhotos.length})
                          </button>
                          {usedTags.map(t => (
                            <button key={t} onClick={() => setPhotoTagFilter(prev => prev === t ? 'all' : t)} style={{ padding: '5px 12px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${photoTagFilter === t ? '#e8590c' : '#2a2a2a'}`, background: photoTagFilter === t ? '#2a1200' : '#141414', color: photoTagFilter === t ? '#e8590c' : '#555' }}>
                              {t} ({allPhotos.filter(p => p.tag === t).length})
                            </button>
                          ))}
                        </div>
                      )}

                      {allPhotos.length === 0 && (
                        <div style={s.empty}>No photos yet.<br />Add photos directly or they'll appear here from daily reports.</div>
                      )}
                      {allPhotos.length > 0 && filtered.length === 0 && (
                        <div style={s.empty}>No photos tagged "{photoTagFilter}".</div>
                      )}

                      {dates.map(date => (
                        <div key={date} style={{ marginBottom: '1.5rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 10px' }}>
                            {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                            <span style={{ color: '#333', marginLeft: '8px' }}>{byDate[date].length} photo{byDate[date].length !== 1 ? 's' : ''}</span>
                          </p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                            {byDate[date].map((p, i) => (
                              <div key={i} style={{ aspectRatio: '1', background: '#0f0f0f', overflow: 'hidden', borderRadius: '4px', position: 'relative', cursor: 'pointer' }} onClick={() => openLightbox(filtered, filtered.indexOf(p))}>
                                {(photoUrls[tp(p.path)] || photoUrls[p.path])
                                  ? <img src={photoUrls[tp(p.path)] || photoUrls[p.path]} loading="lazy" decoding="async" onError={e => { const full = photoUrls[p.path]; if (full && e.target.src !== full) e.target.src = full }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={p.name} />
                                  : <div style={{ width: '100%', height: '100%', background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '10px' }}>...</div>
                                }
                                {/* Tag badge */}
                                {p.tag && (
                                  <div style={{ position: 'absolute', top: '4px', left: '4px', background: 'rgba(232,89,12,0.85)', color: '#fff', fontSize: '8px', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase', padding: '2px 5px', borderRadius: '3px', lineHeight: '1.3', maxWidth: '65%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', backdropFilter: 'blur(2px)' }}>
                                    {p.tag}
                                  </div>
                                )}
                                {p.caption && (
                                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '16px 6px 4px', fontSize: '9px', color: '#ddd', lineHeight: '1.3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {p.caption}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); deletePhoto(p) }}
                                  style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', background: 'rgba(0,0,0,0.75)', border: 'none', borderRadius: '50%', color: deletingPhoto === p.path ? '#888' : '#ff6b6b', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}
                                >
                                  {deletingPhoto === p.path ? '…' : '✕'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </>
                  )
                })()}

                {/* ── VEHICLES ── */}
                {activeTab === 'vehicles' && (() => {
                  const LOG_TYPES = ['Weekly Miles', 'Mileage Update', 'Monthly Photo', 'Oil Change', 'Fuel Fill-up', 'Tire Rotation', 'Inspection', 'Damage Report', 'Other']
                  const needsPhoto = ['Monthly Photo', 'Damage Report'].includes(vehicleLogForm.log_type)
                  const needsFuel = vehicleLogForm.log_type === 'Fuel Fill-up'
                  return (
                    <>
                      {vehicleLogMsg && <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem', fontSize: '13px', color: '#4ade80' }}>{vehicleLogMsg}</div>}
                      {vehicleLogError && <div style={{ background: '#1a0000', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem', fontSize: '13px', color: '#ff6b6b' }}>{vehicleLogError}</div>}

                      {assignedVehicles.length === 0 && (
                        <div style={s.empty}>No vehicles assigned to you yet. Contact your PM.</div>
                      )}

                      {assignedVehicles.map(v => {
                        const logs = vehicleLogs[v.id] || []
                        const isExpanded = expandedVehicleId === v.id
                        const showForm = showVehicleLogForm === v.id
                        const lastMileage = logs.find(l => l.mileage)?.mileage
                        const lastOilChange = logs.find(l => l.log_type === 'Oil Change')
                        const logTypeBadgeColor = t => t === 'Oil Change' ? '#f59e0b' : t === 'Damage Report' ? '#ef4444' : t === 'Monthly Photo' ? '#3b82f6' : t === 'Fuel Fill-up' ? '#22c55e' : t === 'Inspection' ? '#a78bfa' : '#888'
                        return (
                          <div key={v.id} style={s.card}>
                            {/* Vehicle header */}
                            <div style={{ marginBottom: '1rem' }}>
                              <h2 style={{ ...s.cardTitle, marginBottom: '4px' }}>{v.name}</h2>
                              <p style={{ margin: 0, fontSize: '12px', color: '#555' }}>
                                {[v.year, v.make, v.model].filter(Boolean).join(' ')}
                                {v.color && ` · ${v.color}`}
                                {v.license_plate && ` · ${v.license_plate}`}
                              </p>
                              {(lastMileage || lastOilChange) && (
                                <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#555' }}>
                                  {lastMileage && <span>{Number(lastMileage).toLocaleString()} mi last logged</span>}
                                  {lastMileage && lastOilChange && ' · '}
                                  {lastOilChange && <span>Last oil change {new Date(lastOilChange.log_date + 'T12:00:00').toLocaleDateString()}</span>}
                                </p>
                              )}
                            </div>

                            {/* Log form */}
                            {showForm ? (
                              <form onSubmit={e => submitVehicleLog(e, v.id)} style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                                <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                  <div>
                                    <label style={s.label}>Log Type *</label>
                                    <select style={s.input} required value={vehicleLogForm.log_type} onChange={e => setVehicleLogForm(f => ({ ...f, log_type: e.target.value }))}>
                                      {LOG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label style={s.label}>Date *</label>
                                    <input type="date" style={s.input} required value={vehicleLogForm.log_date} onChange={e => setVehicleLogForm(f => ({ ...f, log_date: e.target.value }))} />
                                  </div>
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                  <label style={s.label}>Odometer Reading (miles){vehicleLogForm.log_type === 'Weekly Miles' ? ' *' : ''}</label>
                                  <input type="number" style={s.input} required={vehicleLogForm.log_type === 'Weekly Miles'} value={vehicleLogForm.mileage} onChange={e => setVehicleLogForm(f => ({ ...f, mileage: e.target.value }))} placeholder="e.g. 54200" />
                                </div>
                                {needsFuel && (
                                  <div style={{ ...s.grid2, marginBottom: '12px' }}>
                                    <div>
                                      <label style={s.label}>Gallons</label>
                                      <input type="number" step="0.01" style={s.input} value={vehicleLogForm.fuel_gallons} onChange={e => setVehicleLogForm(f => ({ ...f, fuel_gallons: e.target.value }))} placeholder="0.00" />
                                    </div>
                                    <div>
                                      <label style={s.label}>Total Cost ($)</label>
                                      <input type="number" step="0.01" style={s.input} value={vehicleLogForm.fuel_cost} onChange={e => setVehicleLogForm(f => ({ ...f, fuel_cost: e.target.value }))} placeholder="0.00" />
                                    </div>
                                  </div>
                                )}
                                <div style={{ marginBottom: '12px' }}>
                                  <label style={s.label}>Notes {vehicleLogForm.log_type === 'Inspection' ? '(condition, anything to flag)' : ''}</label>
                                  <input style={s.input} value={vehicleLogForm.notes} onChange={e => setVehicleLogForm(f => ({ ...f, notes: e.target.value }))} placeholder={vehicleLogForm.log_type === 'Damage Report' ? 'Describe the damage...' : 'Optional notes...'} />
                                </div>
                                {(needsPhoto || vehicleLogForm.log_type === 'Damage Report') && (
                                  <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>Photo {needsPhoto ? '*' : ''}</label>
                                    <input type="file" accept="image/*" capture="environment" style={{ ...s.input, padding: '8px 14px' }} onChange={e => setVehicleLogFile(e.target.files[0])} required={needsPhoto} />
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button type="submit" disabled={submittingVehicleLog} style={{ ...s.btn, opacity: submittingVehicleLog ? 0.6 : 1 }}>{submittingVehicleLog ? 'Saving...' : 'Save Log'}</button>
                                  <button type="button" style={s.btnSm('gray')} onClick={() => setShowVehicleLogForm(null)}>Cancel</button>
                                </div>
                              </form>
                            ) : (
                              <button style={{ ...s.btn, marginBottom: '1rem' }} onClick={() => { setShowVehicleLogForm(v.id); if (!vehicleLogs[v.id]) loadVehicleLogsForVehicle(v.id) }}>+ Log Entry</button>
                            )}

                            {/* Log history toggle */}
                            <button style={{ ...s.btnSm('gray'), marginBottom: '0.75rem' }} onClick={() => { setExpandedVehicleId(x => x === v.id ? null : v.id); if (!vehicleLogs[v.id]) loadVehicleLogsForVehicle(v.id) }}>
                              {isExpanded ? 'Hide History' : `View History (${logs.length})`}
                            </button>

                            {isExpanded && (
                              <div>
                                {logs.length === 0 && <p style={{ fontSize: '13px', color: '#444', margin: 0 }}>No logs yet.</p>}
                                {logs.map(l => (
                                  <div key={l.id} style={{ padding: '10px 0', borderTop: '1px solid #1a1a1a' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                                      <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#1a1a1a', color: logTypeBadgeColor(l.log_type), border: '1px solid #2a2a2a' }}>{l.log_type}</span>
                                      <span style={{ fontSize: '12px', color: '#555' }}>{new Date(l.log_date + 'T12:00:00').toLocaleDateString()}</span>
                                      {l.mileage && <span style={{ fontSize: '12px', color: '#888' }}>{Number(l.mileage).toLocaleString()} mi</span>}
                                      {l.fuel_gallons && <span style={{ fontSize: '12px', color: '#888' }}>{l.fuel_gallons} gal · ${Number(l.fuel_cost || 0).toFixed(2)}</span>}
                                    </div>
                                    {l.notes && <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#777' }}>{l.notes}</p>}
                                    {l.photo_url && <button style={{ ...s.btnSm('gray'), marginTop: '6px' }} onClick={() => openVehiclePhoto(l.photo_url)}>View Photo</button>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )
                })()}

                {/* ── TOOLS ── */}
                {activeTab === 'tools' && (() => {
                  const LOG_TYPE_LABELS = { checkin: 'Check In', checkout: 'Checked Out', damage: 'Damage Report', lost: 'Report Lost', maintenance: 'Needs Maintenance' }
                  return (
                    <>
                      {toolLogMsg && <div style={{ padding: '12px 16px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>{toolLogMsg}</div>}
                      {toolLogError && <div style={{ padding: '12px 16px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a' }}>{toolLogError}</div>}
                      {purchaseToolMsg && <div style={{ padding: '12px 16px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>{purchaseToolMsg}</div>}

                      {/* Purchase tool */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <p style={{ margin: 0, fontSize: '13px', color: '#555' }}>{myTools.length} tool{myTools.length !== 1 ? 's' : ''} assigned to you</p>
                        <button style={s.btnSm('orange')} onClick={() => setShowPurchaseToolForm(v => !v)}>{showPurchaseToolForm ? 'Cancel' : '+ Log Tool Purchase'}</button>
                      </div>

                      {showPurchaseToolForm && (
                        <div style={s.card}>
                          <h2 style={s.cardTitle}>Log Tool Purchase</h2>
                          <form onSubmit={async e => {
                            e.preventDefault()
                            if (!purchaseToolForm.name) return
                            setPurchasingTool(true)
                            try {
                              const userId = (await supabase.auth.getSession()).data.session?.user.id
                              // Add to tool inventory
                              await fetch('/api/tools', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: purchaseToolForm.name, brand: purchaseToolForm.brand || null, category: purchaseToolForm.category, purchase_date: purchaseToolForm.purchase_date, purchase_cost: purchaseToolForm.purchase_cost ? parseFloat(purchaseToolForm.purchase_cost) : null, condition: 'good', assigned_to: userId, notes: purchaseToolForm.notes || null })
                              })
                              // Log as job expense if cost entered and job selected
                              if (purchaseToolForm.purchase_cost && selectedJobId) {
                                const fd = new FormData()
                                fd.append('data', JSON.stringify({ job_id: selectedJobId, cost_date: purchaseToolForm.purchase_date, description: `Tool purchase: ${purchaseToolForm.name}${purchaseToolForm.brand ? ' (' + purchaseToolForm.brand + ')' : ''}`, category: 'Tools', amount: parseFloat(purchaseToolForm.purchase_cost), status: 'approved' }))
                                if (purchaseToolFile) fd.append('file', purchaseToolFile)
                                await fetch('/api/direct-costs', { method: 'POST', body: fd })
                              }
                              setPurchaseToolMsg(`${purchaseToolForm.name} logged.${purchaseToolForm.purchase_cost && selectedJobId ? ' Cost posted to job.' : ''}`)
                              setPurchaseToolForm({ name: '', category: 'Power Tools', brand: '', purchase_cost: '', purchase_date: new Date().toISOString().split('T')[0], notes: '' })
                              setPurchaseToolFile(null)
                              setShowPurchaseToolForm(false)
                              setTimeout(() => setPurchaseToolMsg(''), 4000)
                            } catch { }
                            setPurchasingTool(false)
                          }}>
                            <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                              <div>
                                <label style={s.label}>Tool Name *</label>
                                <input style={s.input} required value={purchaseToolForm.name} onChange={e => setPurchaseToolForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Dewalt Drill" />
                              </div>
                              <div>
                                <label style={s.label}>Category</label>
                                <select style={s.input} value={purchaseToolForm.category} onChange={e => setPurchaseToolForm(f => ({ ...f, category: e.target.value }))}>
                                  {['Power Tools', 'Hand Tools', 'Measuring & Layout', 'Safety Equipment', 'Fasteners & Hardware', 'Electrical', 'Plumbing', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            </div>
                            <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                              <div>
                                <label style={s.label}>Brand / Model</label>
                                <input style={s.input} value={purchaseToolForm.brand} onChange={e => setPurchaseToolForm(f => ({ ...f, brand: e.target.value }))} placeholder="e.g. Dewalt DCD777" />
                              </div>
                              <div>
                                <label style={s.label}>Purchase Date *</label>
                                <input type="date" style={s.input} required value={purchaseToolForm.purchase_date} onChange={e => setPurchaseToolForm(f => ({ ...f, purchase_date: e.target.value }))} />
                              </div>
                            </div>
                            <div style={{ ...s.grid2, marginBottom: '1rem' }}>
                              <div>
                                <label style={s.label}>Cost ($){selectedJobId ? ' — will post to job' : ''}</label>
                                <input type="number" step="0.01" min="0" style={s.input} value={purchaseToolForm.purchase_cost} onChange={e => setPurchaseToolForm(f => ({ ...f, purchase_cost: e.target.value }))} placeholder="0.00" />
                              </div>
                              <div>
                                <label style={s.label}>Receipt (optional)</label>
                                <input type="file" accept="image/*,application/pdf" style={{ ...s.input, padding: '8px 14px' }} onChange={e => setPurchaseToolFile(e.target.files[0])} />
                              </div>
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                              <label style={s.label}>Notes</label>
                              <input style={s.input} value={purchaseToolForm.notes} onChange={e => setPurchaseToolForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button type="submit" disabled={purchasingTool} style={{ ...s.btn, opacity: purchasingTool ? 0.6 : 1 }}>{purchasingTool ? 'Saving...' : 'Save Purchase'}</button>
                              <button type="button" style={s.btnSm('gray')} onClick={() => setShowPurchaseToolForm(false)}>Cancel</button>
                            </div>
                          </form>
                        </div>
                      )}

                      {myTools.length === 0 && !showPurchaseToolForm && (
                        <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#555', fontSize: '14px' }}>
                          No tools checked out to you. Use the button above to log a tool you purchased.
                        </div>
                      )}

                      {myTools.map(tool => {
                        const isExpanded = expandedToolFieldId === tool.id
                        const logs = toolLogsField[tool.id] || []
                        const isLogging = showToolLogForm === tool.id
                        return (
                          <div key={tool.id} style={{ background: '#141414', border: '1px solid #1e1e1e', borderRadius: '12px', marginBottom: '10px', overflow: 'hidden' }}>
                            <div style={{ padding: '14px 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <div>
                                <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{tool.name}</p>
                                <p style={{ margin: 0, fontSize: '12px', color: '#555' }}>
                                  {[tool.brand, tool.model].filter(Boolean).join(' ')}
                                  {tool.serial_number && ` · SN: ${tool.serial_number}`}
                                  {tool.job_site && ` · ${tool.job_site}`}
                                </p>
                                <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#888' }}>{tool.category} · Condition: <span style={{ color: tool.condition === 'good' ? '#4ade80' : tool.condition === 'fair' ? '#f59e0b' : '#ef4444' }}>{tool.condition}</span></p>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                                <button style={s.btnSm('orange')} onClick={() => { setShowToolLogForm(isLogging ? null : tool.id); setExpandedToolFieldId(null) }}>Log</button>
                                <button style={s.btnSm('gray')} onClick={() => { setExpandedToolFieldId(isExpanded ? null : tool.id); if (!toolLogsField[tool.id]) loadToolLogsForTool(tool.id); setShowToolLogForm(null) }}>{isExpanded ? 'Hide' : 'History'}</button>
                              </div>
                            </div>

                            {isLogging && (
                              <div style={{ borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#0f0f0f' }}>
                                <form onSubmit={e => submitToolLog(e, tool)}>
                                  <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>Action</label>
                                    <select style={s.input} value={toolLogForm.log_type} onChange={e => setToolLogForm(f => ({ ...f, log_type: e.target.value }))}>
                                      <option value="checkin">Check In (returning tool)</option>
                                      <option value="damage">Damage Report</option>
                                      <option value="lost">Report Lost</option>
                                      <option value="maintenance">Needs Maintenance</option>
                                    </select>
                                  </div>
                                  <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>Date</label>
                                    <input type="date" style={s.input} value={toolLogForm.log_date} onChange={e => setToolLogForm(f => ({ ...f, log_date: e.target.value }))} />
                                  </div>
                                  <div style={{ marginBottom: '12px' }}>
                                    <label style={s.label}>{toolLogForm.log_type === 'checkin' ? 'Notes (optional)' : 'Description *'}</label>
                                    <textarea required={toolLogForm.log_type !== 'checkin'} style={{ ...s.input, height: '80px', resize: 'vertical' }} value={toolLogForm.notes} onChange={e => setToolLogForm(f => ({ ...f, notes: e.target.value }))} placeholder={toolLogForm.log_type === 'damage' ? 'Describe the damage...' : toolLogForm.log_type === 'lost' ? 'Where/when was it last seen...' : ''} />
                                  </div>
                                  <div style={{ display: 'flex', gap: '8px' }}>
                                    <button type="submit" style={{ ...s.btn, opacity: submittingToolLog ? 0.6 : 1 }} disabled={submittingToolLog}>{submittingToolLog ? 'Saving...' : 'Submit'}</button>
                                    <button type="button" style={s.btnSm('gray')} onClick={() => setShowToolLogForm(null)}>Cancel</button>
                                  </div>
                                </form>
                              </div>
                            )}

                            {isExpanded && (
                              <div style={{ borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#0f0f0f' }}>
                                {logs.length === 0 ? <p style={{ color: '#444', fontSize: '13px', margin: 0 }}>No history yet.</p> : logs.map(l => (
                                  <div key={l.id} style={{ padding: '8px 0', borderBottom: '1px solid #1a1a1a' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                      <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#1a1a1a', color: l.log_type === 'checkin' ? '#4ade80' : l.log_type === 'checkout' ? '#f59e0b' : l.log_type === 'lost' ? '#ef4444' : '#888', border: '1px solid #2a2a2a' }}>{LOG_TYPE_LABELS[l.log_type] || l.log_type}</span>
                                      <span style={{ fontSize: '12px', color: '#555' }}>{new Date(l.log_date + 'T12:00:00').toLocaleDateString()}</span>
                                      {l.notes && <span style={{ fontSize: '12px', color: '#777' }}>· {l.notes}</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </>
                  )
                })()}

                {/* ── 2-WEEK LOOKAHEAD ── */}
                {activeTab === 'lookahead' && (() => {
                  const weekDays = []
                  const wkBase = new Date(lookaheadWeekStart + 'T12:00:00Z')
                  for (let w = 0; w < 2; w++) {
                    for (let d = 0; d < 5; d++) {
                      const day = new Date(wkBase)
                      day.setDate(wkBase.getDate() + w * 7 + d)
                      weekDays.push(day.toISOString().split('T')[0])
                    }
                  }
                  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
                  const todayStr = new Date().toISOString().split('T')[0]
                  const week2Start = new Date(wkBase); week2Start.setDate(wkBase.getDate() + 7)
                  return (
                    <div>
                      {/* Week navigation */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <button onClick={() => shiftLookaheadWeek(-1)} style={{ padding: '7px 14px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#aaa', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>← Prev</button>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: '#666', textAlign: 'center' }}>
                          {wkBase.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                          {' – '}
                          {new Date(wkBase.getTime() + 11 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}
                        </span>
                        <button onClick={() => shiftLookaheadWeek(1)} style={{ padding: '7px 14px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#aaa', fontSize: '13px', fontWeight: '700', cursor: 'pointer' }}>Next →</button>
                      </div>

                      {!lookahead ? (
                        <div style={s.card}>
                          <p style={{ color: '#666', fontSize: '14px', marginBottom: '1rem', textAlign: 'center', margin: '0 0 1rem' }}>No lookahead created for this week yet.</p>
                          <button onClick={createLookahead} style={{ ...s.btn, width: '100%', textAlign: 'center' }}>Start This Week's Lookahead</button>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: lookahead.status === 'submitted' ? '#0a2a0a' : '#1a1a0a', color: lookahead.status === 'submitted' ? '#4ade80' : '#f59e0b', border: `1px solid ${lookahead.status === 'submitted' ? '#1a4a1a' : '#3a3a0a'}` }}>
                              {lookahead.status === 'submitted' ? '✓ Submitted to PM' : 'Draft'}
                            </span>
                            {lookahead.status !== 'submitted' && (
                              <button
                                onClick={submitLookaheadFromField}
                                disabled={submittingLA || lookaheadActivities.length === 0}
                                style={{ padding: '7px 16px', background: submittingLA || lookaheadActivities.length === 0 ? '#2a2a2a' : '#e8590c', border: 'none', borderRadius: '8px', color: submittingLA || lookaheadActivities.length === 0 ? '#555' : '#fff', fontSize: '13px', fontWeight: '700', cursor: submittingLA || lookaheadActivities.length === 0 ? 'default' : 'pointer' }}
                              >
                                {submittingLA ? 'Submitting...' : 'Submit to PM'}
                              </button>
                            )}
                          </div>

                          {[0, 1].map(w => (
                            <div key={w} style={{ marginBottom: '1.25rem' }}>
                              <div style={{ fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #1a1a1a' }}>
                                Week {w + 1} — {(w === 0 ? wkBase : week2Start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                              </div>
                              {DAY_LABELS.map((dayLabel, di) => {
                                const dateStr = weekDays[w * 5 + di]
                                const dayActs = lookaheadActivities.filter(a => a.planned_date === dateStr)
                                const isToday = dateStr === todayStr
                                return (
                                  <div key={dateStr} style={{ background: '#141414', border: `1px solid ${isToday ? '#3a2200' : '#222'}`, borderRadius: '10px', padding: '12px 14px', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: dayActs.length ? '10px' : 0 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '13px', fontWeight: '700', color: isToday ? '#e8590c' : '#aaa' }}>{dayLabel}</span>
                                        <span style={{ fontSize: '12px', color: '#444' }}>{new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
                                        {isToday && <span style={{ fontSize: '10px', fontWeight: '700', color: '#e8590c', background: '#2a1200', border: '1px solid #4a2200', borderRadius: '99px', padding: '1px 6px' }}>TODAY</span>}
                                      </div>
                                      {lookahead.status !== 'submitted' && (
                                        <button onClick={() => openAddLAActivity(dateStr)} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', color: '#888', fontSize: '11px', fontWeight: '700', cursor: 'pointer', padding: '4px 10px' }}>+ Add</button>
                                      )}
                                    </div>
                                    {dayActs.map(act => {
                                      const tc = act.responsible_type === 'sub' ? { bg: '#0a1a2a', fg: '#38bdf8', bd: '#1a3a4a' } : act.responsible_type === 'other' ? { bg: '#2a1a0a', fg: '#fb923c', bd: '#4a2a1a' } : { bg: '#0a1a0a', fg: '#4ade80', bd: '#1a3a1a' }
                                      return (
                                        <div key={act.id} style={{ background: tc.bg, border: `1px solid ${tc.bd}`, borderRadius: '8px', padding: '10px 12px', marginBottom: '6px' }}>
                                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                              <div style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1', marginBottom: '4px' }}>{act.description}</div>
                                              {act.location && <div style={{ fontSize: '11px', color: '#555', marginBottom: '6px' }}>{act.location}</div>}
                                              <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '99px', background: tc.bg, color: tc.fg, border: `1px solid ${tc.bd}` }}>
                                                  {act.responsible_type === 'sub' ? (lookaheadContracts.find(c => c.id === act.sub_id)?.vendor_name || 'Sub') : act.responsible_type === 'other' ? (act.other_company_name || 'Other') : 'Own Crew'}
                                                </span>
                                                {act.manpower > 0 && <span style={{ fontSize: '10px', color: '#555', padding: '2px 7px', borderRadius: '99px', background: '#1a1a1a', border: '1px solid #2a2a2a' }}>{act.manpower} ppl</span>}
                                                {act.inspection_required && <span style={{ fontSize: '10px', color: '#f59e0b', padding: '2px 7px', borderRadius: '99px', background: '#1a1400', border: '1px solid #3a3000' }}>Inspection</span>}
                                                {act.committed && <span style={{ fontSize: '10px', color: '#4ade80', padding: '2px 7px', borderRadius: '99px', background: '#0a1a0a', border: '1px solid #1a3a1a' }}>Committed</span>}
                                                {(act.additional_companies || []).length > 0 && <span style={{ fontSize: '10px', color: '#a855f7', padding: '2px 7px', borderRadius: '99px', background: '#1a0a2a', border: '1px solid #3a1a4a' }}>+{act.additional_companies.length} co</span>}
                                              </div>
                                              {act.constraints_notes && <div style={{ fontSize: '11px', color: '#555', marginTop: '6px', fontStyle: 'italic' }}>{act.constraints_notes}</div>}
                                            </div>
                                            {lookahead.status !== 'submitted' && (
                                              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                                <button onClick={() => openEditLAActivity(act)} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '5px', color: '#777', fontSize: '11px', cursor: 'pointer', padding: '3px 8px' }}>Edit</button>
                                                <button onClick={() => deleteLAActivity(act.id)} style={{ background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: '5px', color: '#ef4444', fontSize: '11px', cursor: 'pointer', padding: '3px 8px' }}>✕</button>
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )
                })()}

                {/* ── LOOKAHEAD ACTIVITY MODAL ── */}
                {showLAModal && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9000, display: 'flex', alignItems: 'flex-end' }} onClick={e => { if (e.target === e.currentTarget) setShowLAModal(false) }}>
                    <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '760px', margin: '0 auto', padding: '1.75rem', maxHeight: '85vh', overflowY: 'auto' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#f1f1f1' }}>{editingLAActivity ? 'Edit Activity' : 'Add Activity'}</h3>
                        <button onClick={() => setShowLAModal(false)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>✕</button>
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Description *</label>
                        <input value={laForm.description || ''} onChange={e => setLaForm(f => ({ ...f, description: e.target.value }))} style={s.input} placeholder="What work is being done?" />
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Location</label>
                        <input value={laForm.location || ''} onChange={e => setLaForm(f => ({ ...f, location: e.target.value }))} style={s.input} placeholder="Area / zone on site" />
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Responsible</label>
                        <select value={laForm.responsible_type || 'own_crew'} onChange={e => setLaForm(f => ({ ...f, responsible_type: e.target.value, sub_id: '', other_company_name: '' }))} style={s.input}>
                          <option value="own_crew">Own Crew (NV)</option>
                          <option value="sub">Subcontractor</option>
                          <option value="other">Other Company</option>
                        </select>
                      </div>
                      {laForm.responsible_type === 'sub' && (
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Subcontractor</label>
                          <select value={laForm.sub_id || ''} onChange={e => setLaForm(f => ({ ...f, sub_id: e.target.value }))} style={s.input}>
                            <option value="">Select subcontractor...</option>
                            {lookaheadContracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                          </select>
                        </div>
                      )}
                      {laForm.responsible_type === 'other' && (
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Company Name</label>
                          <input value={laForm.other_company_name || ''} onChange={e => setLaForm(f => ({ ...f, other_company_name: e.target.value }))} style={s.input} placeholder="Utility, city crew, other GC, etc." />
                        </div>
                      )}
                      {(laForm.responsible_type === 'own_crew' || laForm.responsible_type === 'sub') && (
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Manpower</label>
                          <input type="number" value={laForm.manpower || ''} onChange={e => setLaForm(f => ({ ...f, manpower: e.target.value }))} style={s.input} placeholder="# of workers" min="0" />
                        </div>
                      )}
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Equipment / Notes</label>
                        <input value={laForm.equipment || ''} onChange={e => setLaForm(f => ({ ...f, equipment: e.target.value }))} style={s.input} placeholder="Equipment or materials needed" />
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Additional Companies on Site</label>
                        {(laForm.additional_companies || []).map((co, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                            <span style={{ flex: 1, fontSize: '13px', color: '#ccc', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '7px', padding: '7px 10px' }}>{co.name}{co.manpower ? ` — ${co.manpower} ppl` : ''}</span>
                            <button onClick={() => setLaForm(f => ({ ...f, additional_companies: f.additional_companies.filter((_, i) => i !== idx) }))} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '4px' }}>✕</button>
                          </div>
                        ))}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input value={newLACoName} onChange={e => setNewLACoName(e.target.value)} style={{ ...s.input, flex: 2 }} placeholder="Company name" />
                          <input type="number" value={newLACoManpower} onChange={e => setNewLACoManpower(e.target.value)} style={{ ...s.input, flex: 1 }} placeholder="# ppl" min="0" />
                          <button
                            onClick={() => { if (!newLACoName.trim()) return; setLaForm(f => ({ ...f, additional_companies: [...(f.additional_companies || []), { name: newLACoName.trim(), manpower: newLACoManpower ? parseInt(newLACoManpower) : null }] })); setNewLACoName(''); setNewLACoManpower('') }}
                            style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#aaa', fontSize: '12px', fontWeight: '700', cursor: 'pointer', padding: '0 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >+ Add</button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '1rem' }}>
                        {[
                          { key: 'inspection_required', label: 'Inspection Required' },
                          { key: 'inspection_scheduled', label: 'Inspection Scheduled' },
                          { key: 'preceding_work_complete', label: 'Preceding Work Complete' },
                          { key: 'committed', label: 'Committed' },
                        ].map(({ key, label }) => (
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={!!laForm[key]} onChange={e => setLaForm(f => ({ ...f, [key]: e.target.checked }))} style={{ accentColor: '#e8590c', width: '16px', height: '16px', flexShrink: 0 }} />
                            <span style={{ fontSize: '13px', color: '#aaa' }}>{label}</span>
                          </label>
                        ))}
                      </div>

                      <div style={{ marginBottom: '1.5rem' }}>
                        <label style={s.label}>Constraints / Notes</label>
                        <textarea value={laForm.constraints_notes || ''} onChange={e => setLaForm(f => ({ ...f, constraints_notes: e.target.value }))} style={{ ...s.input, minHeight: '70px', resize: 'vertical' }} placeholder="Blockers, dependencies, or other notes" />
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => setShowLAModal(false)} style={{ flex: 1, padding: '12px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '10px', color: '#888', fontSize: '14px', fontWeight: '700', cursor: 'pointer' }}>Cancel</button>
                        <button
                          onClick={saveLAActivity}
                          disabled={savingLA || !laForm.description}
                          style={{ flex: 2, padding: '12px', background: savingLA || !laForm.description ? '#2a2a2a' : '#e8590c', border: 'none', borderRadius: '10px', color: savingLA || !laForm.description ? '#555' : '#fff', fontSize: '14px', fontWeight: '700', cursor: savingLA || !laForm.description ? 'default' : 'pointer' }}
                        >
                          {savingLA ? 'Saving...' : editingLAActivity ? 'Update Activity' : 'Add Activity'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

          </>
        )}
      </main>

      {/* ── FLOATING CAMERA BUTTON ── */}
      {selectedJobId && !lightbox && (
        <div style={{ position: 'fixed', bottom: '24px', right: '20px', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          {fabOpen && (
            <div style={{ background: '#1c1c1c', border: '1px solid #2a2a2a', borderRadius: '14px', padding: '14px', width: '280px', boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <label style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Tag</label>
                {fabCount > 0 && <span style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '99px', padding: '2px 8px' }}>{fabCount} saved</span>}
              </div>
              {/* Tag pill picker */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
                {PHOTO_TAGS.map(t => (
                  <button key={t} type="button" onClick={() => setFabTag(prev => prev === t ? '' : t)}
                    style={{ padding: '4px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${fabTag === t ? '#e8590c' : '#2a2a2a'}`, background: fabTag === t ? '#2a1200' : '#141414', color: fabTag === t ? '#e8590c' : '#555', transition: 'all 0.1s' }}>
                    {t}
                  </button>
                ))}
              </div>
              <input value={fabCaption} onChange={e => setFabCaption(e.target.value)} placeholder="Caption (optional)" style={{ ...s.input, marginBottom: '10px' }} />
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', background: uploadingGalleryPhoto ? '#333' : '#e8590c', color: '#fff', borderRadius: '10px', fontSize: '14px', fontWeight: '700', cursor: uploadingGalleryPhoto ? 'default' : 'pointer', letterSpacing: '0.5px' }}>
                {uploadingGalleryPhoto ? 'Saving...' : fabCount > 0 ? 'Take Another' : 'Take / Choose Photo'}
                <input
                  ref={fabInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  disabled={uploadingGalleryPhoto}
                  onChange={async e => {
                    const files = Array.from(e.target.files || [])
                    if (!files.length) return
                    e.target.value = ''
                    for (const f of files) await uploadGalleryPhoto(f, fabCaption, fabTag)
                    setFabCount(n => n + files.length)
                    fabInputRef.current?.click()
                  }}
                />
              </label>
              {fabCount > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#444', textAlign: 'center' }}>Tap ✕ when done</p>
              )}
            </div>
          )}
          <button
            onClick={() => { setFabOpen(o => { if (o) { setFabCount(0); setFabTag('') } return !o }); setFabCaption('') }}
            style={{ width: '58px', height: '58px', borderRadius: '50%', background: fabOpen ? '#333' : '#e8590c', border: 'none', color: '#fff', fontSize: '24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 24px rgba(232,89,12,0.45)', transition: 'background 0.15s' }}
          >
            {fabOpen ? '✕' : IC.camera}
          </button>
        </div>
      )}

      {/* ── LIGHTBOX ── */}
      {lightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'rgba(0,0,0,0.6)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {lightbox.photos[lightbox.index]?.tag && (
                <span style={{ background: 'rgba(232,89,12,0.85)', color: '#fff', fontSize: '10px', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px' }}>
                  {lightbox.photos[lightbox.index].tag}
                </span>
              )}
              {lightbox.photos[lightbox.index]?.caption && <span style={{ color: '#f1f1f1', fontWeight: '700', fontSize: '14px' }}>{lightbox.photos[lightbox.index].caption}</span>}
              {lightbox.photos[lightbox.index]?.date && <span style={{ color: '#555', fontSize: '12px' }}>{new Date(lightbox.photos[lightbox.index].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ color: '#555', fontSize: '12px' }}>{lightbox.index + 1} / {lightbox.photos.length}</span>
              <button onClick={() => setLightbox(null)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '22px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>✕</button>
            </div>
          </div>

          {/* Main image */}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '0 60px' }}>
            {photoUrls[lightbox.photos[lightbox.index]?.path]
              ? <img src={photoUrls[lightbox.photos[lightbox.index].path]} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', userSelect: 'none' }} alt="" />
              : <div style={{ color: '#444', fontSize: '13px' }}>Loading...</div>
            }
            {lightbox.photos.length > 1 && <>
              <button onClick={() => setLightbox(l => ({ ...l, index: (l.index - 1 + l.photos.length) % l.photos.length }))} style={{ position: 'absolute', left: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: '28px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>‹</button>
              <button onClick={() => setLightbox(l => ({ ...l, index: (l.index + 1) % l.photos.length }))} style={{ position: 'absolute', right: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: '28px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>›</button>
            </>}
          </div>

          {/* Thumbnail strip */}
          {lightbox.photos.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', padding: '10px 14px', background: 'rgba(0,0,0,0.8)', overflowX: 'auto', flexShrink: 0 }}>
              {lightbox.photos.map((p, i) => (
                <button key={i} onClick={() => setLightbox(l => ({ ...l, index: i }))} style={{ flexShrink: 0, width: '52px', height: '52px', borderRadius: '6px', border: i === lightbox.index ? '2px solid #e8590c' : '2px solid transparent', overflow: 'hidden', cursor: 'pointer', padding: 0, background: '#111' }}>
                  {(photoUrls[tp(p.path)] || photoUrls[p.path])
                    ? <img src={photoUrls[tp(p.path)] || photoUrls[p.path]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" />
                    : <div style={{ width: '100%', height: '100%', background: '#1a1a1a' }} />
                  }
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
