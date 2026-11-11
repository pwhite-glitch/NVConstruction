'use client'
import React, { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { atLeastPM, isJobLimited, isOnJob, isPrincipal, homePathForRole, NOT_ASSIGNED_MESSAGE } from '../../lib/roles'
import { todayCentral } from '../../lib/central-date'
import { resolveTakenAt, insertWithGpsFallback, photoDateCentral } from '../../lib/photo-taken-at'
import { insertJobPhotoWithFallbacks } from '../../lib/photo-visibility'
import { openFile, openHtml, openStorageFile } from '../../lib/open-file'
import { dcBilledLockReason } from '../../lib/dc-guards'
import { coNumberLabel, coNumberMissingMessage } from '../../lib/co-number'
import { isPreviewActive } from '../../lib/prime-co-review'
import RfiCommentThread from '../components/RfiCommentThread'
import { amountsDiffer, packagedDrawTotal, drawAwaitingBillings, approvedCOTotal, revisedContract, bankAmount, coBudgetDeltas, budgetContractCheck, signedDcAmount, approvedDcTotal, contractCommittedForItem, committedTotalForLines, unlinkedContracts, contractRevisedValue } from '../../lib/residential-money'
import { ownerDrawFunding, pctFunded, priorDrawnByLine, buildDrawSchedule, drawFundedAmount, isDrawEditable, round2, canUseOwnerDraws } from '../../lib/owner-draws'
import ExpectedPayDateEditor from '../components/ExpectedPayDateEditor'
import { buildDrawPackageHtml, buildOwnerDrawHtml, buildChangeOrderHtml, buildBillingWaiverHtml, buildCompletionReportHtml } from '../../lib/residential-print'
import { safePageTab, wrongPageHref } from '../../lib/job-links'
import { safeFileName } from '../../lib/storage-path'
import { JOB_DOC_CATEGORIES, docCategoryLabel } from '../../lib/job-docs'
import { allocateJobBillings } from '../../lib/contract-billing'
import { billingDeleteBlock } from '../../lib/billing-fields'
import { CompanyPeoplePanel } from '../components/SubCompanyPeople'
import { isSubcontractSigned } from '../../lib/signing'
import { sameCompany } from '../../lib/company-name'
import { isBeforeTodayCentral } from '../../lib/central-date'
import { billingPaymentSummary } from '../../lib/billing-payment'
import { INSPECTION_TYPES } from '../../lib/res-inspections'
import { authFetch } from '../../lib/client-fetch'
import { fetchJson, jsonInit } from '../../lib/fetch-json'
import { uploadThenSend, putToSignedUrl, forgetUpload } from '../../lib/file-upload-client'
import { AI_PARSE_MAX_BYTES, AI_PARSE_LIMIT_PRECHECK_MESSAGE } from '../../lib/ai-parse-limits'
import DailyReportForm from '../jobdetail/DailyReportForm'
import NewPOForm from '../jobdetail/NewPOForm'
import EditPOForm from '../jobdetail/EditPOForm'
import PaymentTypeSelector from '../jobdetail/PaymentTypeSelector' // eslint-disable-line no-unused-vars -- used inside the shared PO forms
import { confirmPOEdit, editFormFromPO, RECEIVED_EDIT_WARNING, CLOSED_LOCKED_MESSAGE } from '../../lib/po-edit-guards'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

const fmt = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDate = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString() : '—'

const s = {
  page: { minHeight: '100vh', background: '#f4f6f8', color: '#111827', fontFamily: "'Inter', sans-serif", fontSize: '14px' },
  header: { background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: '1320px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '56px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoImg: { width: '32px', height: '32px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '14px', color: '#111827', letterSpacing: '0.5px' },
  logoSub: { fontSize: '11px', color: '#6b7280', letterSpacing: '1px', textTransform: 'uppercase' },
  main: { maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem' },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#6b7280', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: '1.5rem' },
  jobTitle: { fontSize: '22px', fontWeight: '700', color: '#111827', margin: '0 0 4px' },
  jobMeta: { fontSize: '13px', color: '#6b7280', margin: '0 0 1.5rem' },
  body: { padding: '0' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 16px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#374151', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' },
  input: { width: '100%', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', padding: '9px 12px', color: '#111827', fontSize: '13px', outline: 'none', boxSizing: 'border-box' },
  select: { width: '100%', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', padding: '9px 12px', color: '#111827', fontSize: '13px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', background: '#fff', border: '1px solid #d1d5db', borderRadius: '6px', padding: '9px 12px', color: '#111827', fontSize: '13px', outline: 'none', resize: 'vertical', boxSizing: 'border-box' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' },
  btn: { padding: '9px 20px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: '700', cursor: 'pointer' },
  btnSm: { padding: '6px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnGray: { padding: '9px 20px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
  btnSmGray: { padding: '6px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnGreen: { padding: '6px 14px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnRed: { padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  // Commercial key aliases so the shared PO forms (app/jobdetail/NewPOForm, EditPOForm) render unchanged.
  btnSmall: { padding: '6px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  btnSmallOrange: { padding: '6px 14px', background: '#e8590c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnSmallGreen: { padding: '6px 14px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' },
  btnSmallRed: { padding: '6px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '6px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  inlineForm: { background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px', marginBottom: '16px' },
  badge: (color) => {
    const map = { orange: ['#fff7ed','#c2410c','#fed7aa'], green: ['#f0fdf4','#15803d','#bbf7d0'], red: ['#fef2f2','#dc2626','#fecaca'], blue: ['#eff6ff','#1d4ed8','#bfdbfe'], gray: ['#f9fafb','#6b7280','#e5e7eb'], amber: ['#fefce8','#a16207','#fde68a'] }
    const [bg, fg, border] = map[color] || map.gray
    return { display: 'inline-block', padding: '2px 9px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.5px', background: bg, color: fg, border: `1px solid ${border}` }
  },
  statCard: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  statLabel: { fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' },
  statValue: (color) => ({ fontSize: '20px', fontWeight: '700', color: color || '#111827', fontFamily: 'monospace' }),
  emptyMsg: { color: '#9ca3af', fontSize: '13px', textAlign: 'center', padding: '32px 0' },
  tableRow: { display: 'grid', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' },
  successMsg: { color: '#15803d', fontSize: '13px' },
  errMsg: { color: '#dc2626', fontSize: '13px' },
}

const statusColor = { pending: 'orange', approved: 'green', rejected: 'red', active: 'green', complete: 'gray', open: 'orange', closed: 'gray', planned: 'blue', 'in-progress': 'orange', done: 'green' }
const milestoneColor = { pending: 'orange', complete: 'green', delayed: 'red' }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ordinal = n => { const t = n % 10, h = n % 100; return n + (h >= 11 && h <= 13 ? 'th' : t === 1 ? 'st' : t === 2 ? 'nd' : t === 3 ? 'rd' : 'th') }

// "Bills on the 25th of each month" / "Bills every Friday (bi-weekly)" from the
// jobs <prefix>_billing_* columns (same reading as the commercial page).
function billingScheduleLabel(job, prefix) {
  const freq = job?.[`${prefix}_billing_frequency`]
  const due = job?.[`${prefix}_billing_due`]
  if (!freq || due === null || due === undefined || due === '') return null
  const n = Number(due)
  return freq === 'monthly' ? `Bills on the ${ordinal(n)} of each month` : `Bills every ${DAYS[n] || '?'}${freq === 'biweekly' ? ' (bi-weekly)' : ''}`
}

// Frequency + first due date → due day and anchor, exactly like the commercial Details.
function BillingScheduleFields({ title, prefix, form, setForm }) {
  const fk = `${prefix}_billing_frequency`, sk = `${prefix}_billing_start`, dk = `${prefix}_billing_due`, ak = `${prefix}_billing_anchor`
  const freq = form[fk] || 'monthly'
  const label = billingScheduleLabel({ ...form, [fk]: freq }, prefix)
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
      <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#6b7280', letterSpacing: '2px', textTransform: 'uppercase' }}>{title}</p>
      <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '6px' }}>
        <div>
          <label style={s.label}>Frequency</label>
          <select style={s.select} value={freq} onChange={e => setForm(f => ({ ...f, [fk]: e.target.value, [dk]: '', [sk]: '', [ak]: '' }))}>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Bi-weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
        <div>
          <label style={s.label}>First billing due date</label>
          <input type="date" style={s.input} value={form[sk] || ''} onChange={e => {
            const v = e.target.value
            if (!v) { setForm(f => ({ ...f, [sk]: '', [ak]: '', [dk]: '' })); return }
            const [yr, mo, dy] = v.split('-').map(Number)
            setForm(f => ({ ...f, [fk]: freq, [sk]: v, [ak]: v, [dk]: freq === 'monthly' ? dy : new Date(yr, mo - 1, dy).getDay() }))
          }} />
        </div>
      </div>
      <p style={{ fontSize: '12px', color: '#4b5563', margin: 0 }}>{label || 'No schedule set.'}</p>
    </div>
  )
}

function ResidentialJobDetailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [id, setId] = useState(null)
  const [jobErrMsg, setJobErrMsg] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileLoadError, setProfileLoadError] = useState(false)
  const [notAssigned, setNotAssigned] = useState(false)
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [userRole, setUserRole] = useState(null) // effective role (Owner previewing PM/APM narrows the UI only)
  const [hideBudget, setHideBudget] = useState(false)
  const [loadErrors, setLoadErrors] = useState({}) // { area: message } — failed reads are shown, not hidden
  const [toast, setToast] = useState(null) // { ok, text }
  const [completing, setCompleting] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [contractSov, setContractSov] = useState({}) // { [subcontract_id]: subcontract_sov_lines }
  const [subCOs, setSubCOs] = useState([]) // change_orders on this job's subcontracts
  const [reviewingSubCOId, setReviewingSubCOId] = useState(null)
  const [billingLines, setBillingLines] = useState([]) // billing_sov_lines for this job (contract credit)
  const [openCompanyId, setOpenCompanyId] = useState(null)
  const [fieldData, setFieldData] = useState(null) // { reports, rfis, deliveries } — Field tab (office can add a daily report)
  const [showNewDailyReport, setShowNewDailyReport] = useState(false)
  const [dailyReportSaved, setDailyReportSaved] = useState(false)
  const [photoUrls, setPhotoUrls] = useState({})
  const [lightbox, setLightbox] = useState(null) // index into photos
  const [deletingPhoto, setDeletingPhoto] = useState(null)
  // Internal only (prompt 73): upload switch + Hide from owner / Show to owner toggle.
  const [photoInternalDraft, setPhotoInternalDraft] = useState(false)
  const [togglingPhoto, setTogglingPhoto] = useState(null)
  const [legacyDocs, setLegacyDocs] = useState([]) // job_docs (read-only bridge)
  const [docCategory, setDocCategory] = useState('plans')
  const [legacyPunch, setLegacyPunch] = useState([]) // res_punch_list (read-only; empty live)
  const [punchBusyId, setPunchBusyId] = useState(null)
  const [ownerDrawsMigrated, setOwnerDrawsMigrated] = useState(null) // migration 046 present?
  const [drawEdit, setDrawEdit] = useState(null) // { id|null, title, period_start, period_end, notes, amount_requested, lines: {budget_item_id: amount} }
  const [drawBusy, setDrawBusy] = useState(false)
  const [drawMsg, setDrawMsg] = useState('')
  const [fundingDraw, setFundingDraw] = useState(null) // { id, amount_funded, funded_date }
  const [inspectionMsg, setInspectionMsg] = useState('')
  const [inspEdit, setInspEdit] = useState(null) // { id, mode: 'result'|'reschedule'|'reinspect', result, date, notes }
  const [waiverMsg, setWaiverMsg] = useState('')
  const [punchMsg, setPunchMsg] = useState('')
  const [contactMsg, setContactMsg] = useState('')
  const [photoMsg, setPhotoMsg] = useState('')
  const [docMsg, setDocMsg] = useState('')

  // Details edit
  const [editingDetails, setEditingDetails] = useState(false)
  const [detailsForm, setDetailsForm] = useState({})
  const [savingDetails, setSavingDetails] = useState(false)
  const [detailsMsg, setDetailsMsg] = useState('')

  // Budget
  const [budgetItems, setBudgetItems] = useState([])
  const [showAddBudget, setShowAddBudget] = useState(false)
  const [newBudget, setNewBudget] = useState({ description: '', budget_amount: '', owner_amount: '', cost_code: '' })
  const [addingBudget, setAddingBudget] = useState(false)
  const [budgetError, setBudgetError] = useState('')
  const [editingBudgetId, setEditingBudgetId] = useState(null)
  const [editBudgetForm, setEditBudgetForm] = useState({})
  const [directCosts, setDirectCosts] = useState([])

  // Subs
  const [contracts, setContracts] = useState([])
  const [subDirectory, setSubDirectory] = useState([])
  const [showAddSubForm, setShowAddSubForm] = useState(false)
  const [newSubForm, setNewSubForm] = useState({ dir_id: '', company_name: '', trade: '', contract_value: '', budget_item_id: '' })
  const [addingSub, setAddingSub] = useState(false)
  const [subMsg, setSubMsg] = useState('')
  const [editingSubId, setEditingSubId] = useState(null)
  const [editSubForm, setEditSubForm] = useState({})

  // Change orders
  const [changeOrders, setChangeOrders] = useState([])
  const [showAddCO, setShowAddCO] = useState(false)
  const [newCO, setNewCO] = useState({ description: '', amount: '', nv_cost: '', notes: '', budget_item_id: '' })
  const [addingCO, setAddingCO] = useState(false)
  const [coMsg, setCOMsg] = useState('')
  const [coLinePick, setCoLinePick] = useState({}) // { [coId]: budget_item_id } picked before approve
  const [reviewingCOId, setReviewingCOId] = useState(null)
  const [inPreview, setInPreview] = useState(false) // role preview: CO review disabled (API refuses too)
  useEffect(() => { setInPreview(isPreviewActive()) }, [])
  const [openRfiThread, setOpenRfiThread] = useState(null)

  // Billing
  const [billingSubmissions, setBillingSubmissions] = useState([])
  const [drawRequests, setDrawRequests] = useState([])
  const [showCreateDraw, setShowCreateDraw] = useState(false)
  const [drawForm, setDrawForm] = useState({ title: '' })
  const [creatingDraw, setCreatingDraw] = useState(false)
  const [expandedDrawId, setExpandedDrawId] = useState(null)
  const [drawAddCostIds, setDrawAddCostIds] = useState([])
  const [savingDrawCosts, setSavingDrawCosts] = useState(false)
  const [drawAddBillingIds, setDrawAddBillingIds] = useState([])
  const [savingDrawBillings, setSavingDrawBillings] = useState(false)
  // Purchase Orders (same /api/purchase-orders route and shared forms as commercial)
  const EMPTY_PO_FORM = { vendor_name: '', description: '', budget_item_id: '', notes: '', payment_type: 'check', items: [{ uid: 0, description: '', qty: '1', unit: '', unit_price: '' }] }
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [poLoadError, setPoLoadError] = useState(false)
  const [showNewPO, setShowNewPO] = useState(false)
  const [poForm, setPOForm] = useState(EMPTY_PO_FORM)
  const [savingPO, setSavingPO] = useState(false)
  const [expandedPOId, setExpandedPOId] = useState(null)
  const [updatingPOId, setUpdatingPOId] = useState(null)
  const [editingPOId, setEditingPOId] = useState(null)
  const [editPOForm, setEditPOForm] = useState({})
  const [savingPOEdit, setSavingPOEdit] = useState(false)
  const [poFile, setPOFile] = useState(null)
  const [editPOFile, setEditPOFile] = useState(null)
  const [editingCostId, setEditingCostId] = useState(null)
  const [editCostForm, setEditCostForm] = useState({})
  const [savingEditCost, setSavingEditCost] = useState(false)
  const [billingBilling, setBillingBillingTab] = useState('submissions')
  const [showBillingForm, setShowBillingForm] = useState(false)
  const [billingForm, setBillingForm] = useState({ _contract_id: '', company_name: '', sub_id: '', amount_billed: '', retainage_pct: '10', work_description: '', billing_period: '' })
  const [addingBilling, setAddingBilling] = useState(false)
  const [billingMsg, setBillingMsg] = useState('')

  // Schedule (milestones)
  const [milestones, setMilestones] = useState([])
  const [showAddMilestone, setShowAddMilestone] = useState(false)
  const [newMilestone, setNewMilestone] = useState({ title: '', due_date: '', status: 'pending', notes: '' })
  const [addingMilestone, setAddingMilestone] = useState(false)

  // Photos
  const [photos, setPhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const photoInputRef = useRef(null)

  // Direct costs tab
  const [showDcForm, setShowDcForm] = useState(false)
  const [dcForm, setDcForm] = useState({ cost_date: todayCentral(), description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '', is_credit: false })
  const [dcFile, setDcFile] = useState(null)
  const [submittingDc, setSubmittingDc] = useState(false)
  const [dcSearch, setDcSearch] = useState('')
  const [dcStatusFilter, setDcStatusFilter] = useState('all')
  const [dcTypeFilter, setDcTypeFilter] = useState('all')
  const [updatingCostId, setUpdatingCostId] = useState(null)
  const [approvingAll, setApprovingAll] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMessages, setAiMessages] = useState([])
  const [aiInput, setAiInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [rejectingCostId, setRejectingCostId] = useState(null)
  const [costRejectNote, setCostRejectNote] = useState('')

  // Documents
  const [documents, setDocuments] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const docInputRef = useRef(null)

  // Estimate import
  const [showImportEstimate, setShowImportEstimate] = useState(false)
  const [parsedItems, setParsedItems] = useState([])
  const [selectedImportIds, setSelectedImportIds] = useState(new Set())
  const [parsingEstimate, setParsingEstimate] = useState(false)
  const [importingItems, setImportingItems] = useState(false)
  const [parseMsg, setParseMsg] = useState('')
  const estimateInputRef = useRef(null)

  // Inspections
  const [inspections, setInspections] = useState([])
  const [showAddInspection, setShowAddInspection] = useState(false)
  const [newInspection, setNewInspection] = useState({ inspection_type: 'Framing', scheduled_date: '', inspector_name: '', result: 'pending', notes: '' })
  const [addingInspection, setAddingInspection] = useState(false)

  // Lien Waivers
  const [lienWaivers, setLienWaivers] = useState([])
  const [sendingWaiverId, setSendingWaiverId] = useState(null)
  const [showAddWaiver, setShowAddWaiver] = useState(false)
  const [newWaiver, setNewWaiver] = useState({ company_name: '', subcontract_id: '', waiver_type: 'conditional', amount: '', payment_date: '', waiver_date: '', status: 'pending', notes: '' })
  const [addingWaiver, setAddingWaiver] = useState(false)

  // Owner Draw
  const [ownerDraws, setOwnerDraws] = useState([])
  const [showAddOwnerDraw, setShowAddOwnerDraw] = useState(false)
  const [newOwnerDraw, setNewOwnerDraw] = useState({ title: '', period_start: '', period_end: '', amount_requested: '', notes: '', link_draw_request_id: '' })
  const [addingOwnerDraw, setAddingOwnerDraw] = useState(false)

  // Punch List
  const [punchList, setPunchList] = useState([])
  const [showAddPunch, setShowAddPunch] = useState(false)
  const [newPunch, setNewPunch] = useState({ title: '', description: '', subcontract_id: '', assigned_company: '', due_date: '' })
  const [addingPunch, setAddingPunch] = useState(false)

  // Contacts
  const [contacts, setContacts] = useState([])
  const [showAddContact, setShowAddContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', role: '', phone: '', email: '', company: '', notes: '' })
  const [addingContact, setAddingContact] = useState(false)

  useEffect(() => {
    const jobId = searchParams.get('id')
    const tab = searchParams.get('tab')
    if (jobId) setId(jobId)
    // Unknown tab keys (e.g. a commercial-only tab) fall back to Overview, never a blank pane.
    setActiveTab(safePageTab(tab, true, 'overview'))
  }, [searchParams])

  // Keep the open tab in the URL (bookmark / refresh), like the commercial page.
  useEffect(() => {
    if (!id || typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    params.set('id', id)
    params.set('tab', activeTab)
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`
    if (next !== window.location.pathname + window.location.search + (window.location.hash || '')) window.history.replaceState(window.history.state, '', next)
  }, [id, activeTab])

  useEffect(() => { if (id) loadAll() }, [id])
  useEffect(() => { if (id && job && activeTab === 'field' && !fieldData) loadFieldData() }, [id, job, activeTab])
  useEffect(() => { if (id && job && activeTab === 'po') { loadPurchaseOrders(); loadBudget(); loadDrawRequests() } }, [id, job, activeTab])
  useEffect(() => {
    if (lightbox === null) return
    const onKey = e => {
      if (e.key === 'Escape') setLightbox(null)
      if (e.key === 'ArrowRight') setLightbox(i => (i === null ? i : Math.min(photos.length - 1, i + 1)))
      if (e.key === 'ArrowLeft') setLightbox(i => (i === null ? i : Math.max(0, i - 1)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, photos.length])

  // Record (or clear) a failed read so the page shows it instead of an empty tab.
  function noteLoad(area, error) {
    setLoadErrors(prev => {
      const next = { ...prev }
      if (error) next[area] = error.message || String(error)
      else delete next[area]
      return next
    })
  }
  function flash(ok, text) {
    setToast({ ok, text })
    setTimeout(() => setToast(t => (t && t.text === text ? null : t)), ok ? 4000 : 9000)
  }
  // fetch → { ok, data, error } with the server's error text (lib/fetch-json: status and
  // Content-Type first; a non-JSON / empty / malformed reply is an error, never {} success).
  // data is always an object so callers can read optional fields safely.
  async function api(url, opts = {}) {
    const r = await fetchJson(fetch, url, opts)
    const data = r.data && typeof r.data === 'object' ? r.data : {}
    return r.ok ? { ok: true, data } : { ok: false, data, error: r.error }
  }
  const jsonOpts = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  async function loadAll() {
    setLoading(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }

    const profileRes = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    const prof = profileRes.data
    if (!prof) { setProfileLoadError(true); setLoading(false); return }
    // Same routing as the commercial page: subs to /submit; client owners and reps to their portal.
    if (!['principal', 'pm', 'apm', 'admin', 'super'].includes(prof.role)) { router.push(homePathForRole(prof.role)); return }
    if (isPrincipal(prof.role)) localStorage.setItem('nvc_pm_session', '1')
    const devRole = localStorage.getItem('nvc_dev_role')
    const effectiveRole = (['pm', 'apm'].includes(devRole) && isPrincipal(prof.role)) ? devRole : prof.role
    setProfile({ ...prof, role: effectiveRole })
    setUserRole(effectiveRole)
    const hide = !!prof.hide_budget
    setHideBudget(hide)
    // PM/APM may only open their jobs (assignment OR pm_email); principal/admin see every job
    if (isJobLimited(effectiveRole)) {
      const access = await isOnJob(supabase, { role: effectiveRole, userId: session.user.id, email: session.user.email }, id)
      if (!access.ok) {
        setNotAssigned(true)
        if (access.error) setJobErrMsg('Could not check your access to this job: ' + (access.error.message || 'unknown error'))
        setLoading(false)
        return
      }
    }
    const jobRes = await supabase.from('jobs').select('*').eq('id', id).single()
    if (jobRes.error || !jobRes.data) {
      setJobErrMsg(`Job not found (id: ${id}) — ${jobRes.error ? jobRes.error.code + ': ' + jobRes.error.message : 'no data returned'}`)
      setLoading(false)
      return
    }
    // Commercial job opened here (old link / bookmark): send it to its own page once.
    const dest = wrongPageHref(jobRes.data, 'residential', new URLSearchParams(window.location.search).get('tab'))
    if (dest) { router.replace(dest); return }
    setJob(jobRes.data)
    setDetailsForm(jobRes.data)

    await Promise.all([
      loadBudget(hide),
      loadContracts(),
      loadSubDirectory(),
      loadChangeOrders(),
      loadSubCOs(),
      loadBillingSubmissions(),
      loadDrawRequests(),
      loadMilestones(),
      loadPhotos(),
      loadDocuments(),
      loadContacts(),
      loadDirectCosts(),
      loadInspections(),
      loadLienWaivers(),
      loadOwnerDraws(effectiveRole),
      loadPunchList(),
    ])
    setLoading(false)
  }

  async function loadBudget(hide = hideBudget) {
    // hide_budget: only what other tabs need to name a line; no Cost/Bank amounts.
    const cols = hide ? 'id, job_id, description, cost_code, sort_order' : '*'
    const { data, error } = await supabase.from('budget_items').select(cols).eq('job_id', id).order('cost_code')
    noteLoad('Budget', error)
    setBudgetItems(data || [])
  }

  async function loadContracts() {
    const { data, error } = await supabase.from('subcontracts').select('*').eq('job_id', id).order('created_at')
    noteLoad('Subcontracts', error)
    setContracts(data || [])
    const ids = (data || []).map(c => c.id)
    if (!ids.length) { setContractSov({}); return }
    const { data: lines, error: sErr } = await supabase.from('subcontract_sov_lines').select('*').in('subcontract_id', ids).order('sort_order')
    noteLoad('Subcontract SOV', sErr)
    const map = {}
    for (const l of lines || []) (map[l.subcontract_id] ||= []).push(l)
    setContractSov(map)
  }

  async function loadSubDirectory() {
    const { data, error } = await supabase.from('sub_directory').select('*').eq('status', 'approved').order('company_name')
    noteLoad('Sub directory', error)
    setSubDirectory(data || [])
  }

  async function loadChangeOrders() {
    const { data, error } = await supabase.from('prime_change_orders').select('*').eq('job_id', id).order('created_at', { ascending: false })
    noteLoad('Change orders', error)
    setChangeOrders(data || [])
  }

  // Sub change orders live on change_orders (no job_id): join through the contract.
  async function loadSubCOs() {
    const { data, error } = await supabase
      .from('change_orders')
      .select('*, subcontracts!inner(id, job_id, vendor_name)')
      .eq('subcontracts.job_id', id)
      .order('created_at', { ascending: false })
    noteLoad('Sub change orders', error)
    setSubCOs(data || [])
  }

  async function loadBillingSubmissions() {
    const { data, error } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
    noteLoad('Sub billing', error)
    setBillingSubmissions(data || [])
    // Line split per contract (same as commercial). Paged: a job can pass 1000 rows.
    const PAGE = 1000
    const all = []
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: lErr } = await supabase
        .from('billing_sov_lines')
        .select('billing_submission_id, sov_line_id, amount, subcontract_sov_lines(subcontract_id), billing_submissions!inner(job_id)')
        .eq('billing_submissions.job_id', id)
        .order('billing_submission_id')
        .order('sov_line_id')
        .range(from, from + PAGE - 1)
      if (lErr) { noteLoad('Billing lines', lErr); return }
      all.push(...(page || []))
      if (!page || page.length < PAGE) break
    }
    noteLoad('Billing lines', null)
    setBillingLines(all)
  }

  async function loadDrawRequests() {
    const r = await api(`/api/draw-requests?job_id=${encodeURIComponent(id)}`)
    noteLoad('Draw requests', r.ok ? null : r.error)
    if (r.ok) setDrawRequests(r.data.draws || [])
  }

  // ── Purchase Orders (ported from commercial; authFetch carries the Bearer requirePM needs) ──
  async function loadPurchaseOrders() {
    try {
      const r = await fetchJson(authFetch, `/api/purchase-orders?job_id=${encodeURIComponent(id)}`)
      const failed = !r.ok || !Array.isArray(r.data?.purchase_orders)
      setPoLoadError(failed)
      if (failed) noteLoad('Purchase orders', r.ok ? 'unexpected response' : r.error)
      else noteLoad('Purchase orders', null)
      setPurchaseOrders(failed ? [] : r.data.purchase_orders)
    } catch (e) {
      setPoLoadError(true)
      noteLoad('Purchase orders', e)
      setPurchaseOrders([])
    }
  }

  async function savePO(issueImmediately = false) {
    if (!poForm.vendor_name || savingPO) return
    setSavingPO(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const validItems = poForm.items.filter(i => i.description && i.unit_price)
      const payload = {
        job_id: id,
        vendor_name: poForm.vendor_name,
        description: poForm.description || null,
        budget_item_id: poForm.budget_item_id || null,
        notes: poForm.notes || null,
        payment_type: poForm.payment_type || 'check',
        status: issueImmediately ? 'issued' : 'draft',
        created_by: session?.user?.id || null,
        items: validItems.map((i, idx) => ({ description: i.description, qty: parseFloat(i.qty) || 1, unit: i.unit || null, unit_price: parseFloat(i.unit_price) || 0, sort_order: idx })),
      }
      // Attachment goes straight to Storage; the API gets only { path, uploadReceipt }.
      const r = await uploadThenSend({
        fetchFn: authFetch, putFn: fetch, file: poFile, target: 'po-attachment', context: { job_id: id },
        send: attachment => fetchJson(authFetch, '/api/purchase-orders', jsonInit('POST', attachment ? { ...payload, attachment } : payload)),
      })
      if (!r.ok) { flash(false, (r.stage === 'upload' ? 'PO attachment upload failed: ' : 'PO save failed: ') + r.error); return }
      if (r.data?.warning) alert(r.data.warning)
      setShowNewPO(false)
      setPOForm(EMPTY_PO_FORM)
      setPOFile(null)
      await loadPurchaseOrders()
    } catch (e) {
      flash(false, 'PO save failed: ' + (e.message || 'network error'))
    } finally {
      setSavingPO(false)
    }
  }

  async function updatePOStatus(poId, status) {
    setUpdatingPOId(poId)
    try {
      const r = await fetchJson(authFetch, '/api/purchase-orders', jsonInit('PUT', { id: poId, status }))
      if (!r.ok) flash(false, 'PO update failed: ' + r.error)
      else if (r.data?.warning) alert(r.data.warning)
      await loadPurchaseOrders()
    } catch (e) {
      flash(false, 'PO update failed: ' + (e.message || 'network error'))
    } finally {
      setUpdatingPOId(null)
    }
  }

  async function savePOEdit() {
    // Confirm cash-outlook / committed-cost / draw-amount effects before any write.
    const originalPO = purchaseOrders.find(p => p.id === editingPOId)
    if (savingPOEdit || !confirmPOEdit(originalPO, editPOForm, msg => window.confirm(msg))) return
    setSavingPOEdit(true)
    try {
      const validItems = editPOForm.items.filter(i => i.description && i.unit_price)
      const payload = {
        id: editingPOId,
        job_id: id,
        vendor_name: editPOForm.vendor_name,
        description: editPOForm.description || null,
        budget_item_id: editPOForm.budget_item_id || null,
        notes: editPOForm.notes || null,
        payment_type: editPOForm.payment_type || 'check',
        items: validItems.map((i, idx) => ({ description: i.description, qty: parseFloat(i.qty) || 1, unit: i.unit || null, unit_price: parseFloat(i.unit_price) || 0, sort_order: idx })),
      }
      // No new file = attachment omitted, which keeps the saved one.
      const r = await uploadThenSend({
        fetchFn: authFetch, putFn: fetch, file: editPOFile, target: 'po-attachment', context: { job_id: id, record_id: editingPOId },
        send: attachment => fetchJson(authFetch, '/api/purchase-orders', jsonInit('PUT', attachment ? { ...payload, attachment } : payload)),
      })
      if (!r.ok) { flash(false, (r.stage === 'upload' ? 'PO attachment upload failed: ' : 'PO update failed: ') + r.error); return }
      if (r.data?.warning) alert(r.data.warning)
      setEditingPOId(null)
      setEditPOFile(null)
      await loadPurchaseOrders()
    } catch (e) {
      flash(false, 'PO update failed: ' + (e.message || 'network error'))
    } finally {
      setSavingPOEdit(false)
    }
  }

  async function openPOAttachment(attachmentUrl) {
    try {
      const r = await fetchJson(authFetch, `/api/purchase-orders?sign=${encodeURIComponent(attachmentUrl)}`)
      if (r.ok && r.data?.signedUrl) window.open(r.data.signedUrl, '_blank')
      else alert('Could not open attachment: ' + (r.ok ? 'no link returned' : r.error))
    } catch (e) {
      alert('Could not open attachment: ' + (e.message || 'network error'))
    }
  }

  async function deletePO(poId) {
    if (!window.confirm('Delete this purchase order?')) return
    try {
      const r = await fetchJson(authFetch, '/api/purchase-orders', jsonInit('DELETE', { id: poId }))
      if (!r.ok) flash(false, 'PO delete failed: ' + r.error)
      await loadPurchaseOrders()
    } catch (e) {
      flash(false, 'PO delete failed: ' + (e.message || 'network error'))
    }
  }

  function startPOEdit(po) {
    setEditingPOId(po.id)
    setExpandedPOId(null)
    setShowNewPO(false)
    setEditPOForm(editFormFromPO(po))
  }

  async function loadMilestones() {
    const { data, error } = await supabase.from('milestones').select('*').eq('job_id', id).order('due_date', { ascending: true })
    noteLoad('Schedule', error)
    setMilestones(data || [])
  }

  // Shared photos: job_photos (field app / this page) + daily report photos, all in
  // the private daily-report-photos bucket through signed URLs (same as commercial).
  async function loadPhotos() {
    const [{ data: standalone, error: e1 }, { data: reports, error: e2 }] = await Promise.all([
      // select('*'): internal_only (migration 070) is read when present, absent before it.
      supabase.from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
      supabase.from('daily_reports').select('id, report_date, photos').eq('job_id', id).order('report_date', { ascending: false }),
    ])
    noteLoad('Photos', e1 || e2)
    const all = [
      ...(standalone || []).filter(p => p.storage_path).map(p => ({ key: 'p' + p.id, path: p.storage_path, caption: p.caption, date: photoDateCentral(p.taken_at || p.created_at), name: p.file_name, internal_only: p.internal_only === true })),
      ...(reports || []).flatMap(r => (Array.isArray(r.photos) ? r.photos : []).filter(p => p?.path).map((p, i) => ({ key: `r${r.id}-${i}`, path: p.path, caption: p.caption, date: r.report_date, name: p.name, fromReport: true, reportId: r.id, internal_only: p.internal_only === true }))),
    ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    setPhotos(all)
    const paths = [...new Set(all.map(p => p.path))]
    if (!paths.length) return
    const thumbs = paths.filter(p => /\.jpg$/i.test(p)).map(p => p.replace(/\.jpg$/i, '_thumb.jpg'))
    const { data: signed, error: sErr } = await supabase.storage.from('daily-report-photos').createSignedUrls([...paths, ...thumbs], 7200)
    if (sErr) noteLoad('Photo links', sErr)
    if (signed) setPhotoUrls(prev => { const u = { ...prev }; signed.forEach(d => { if (d.signedUrl) u[d.path] = d.signedUrl }); return u })
  }

  // Canonical job_documents (private job-documents bucket) + the legacy job_docs rows, read-only.
  async function loadDocuments() {
    const r = await api(`/api/job-docs?job_id=${encodeURIComponent(id)}&include=documents`)
    noteLoad('Documents', r.ok ? null : r.error)
    if (!r.ok) return
    setDocuments(r.data.documents || [])
    setLegacyDocs(r.data.data || [])
  }

  async function loadContacts() {
    const { data, error } = await supabase.from('job_contacts').select('*').eq('job_id', id).order('name')
    noteLoad('Contacts', error)
    setContacts(data || [])
  }

  // Through /api/res-inspections (service role): migration 046's browser policy is
  // office-only, and assigned supers use this tab too.
  async function loadInspections() {
    const r = await api(`/api/res-inspections?job_id=${encodeURIComponent(id)}`)
    noteLoad('Inspections', r.ok ? null : r.error)
    setInspections(r.ok ? (r.data.inspections || []) : [])
  }

  async function loadLienWaivers() {
    const { data, error } = await supabase.from('res_lien_waivers').select('*').eq('job_id', id).order('created_at', { ascending: false })
    noteLoad('Lien waivers', error)
    setLienWaivers(data || [])
  }

  async function loadOwnerDraws(role = userRole) {
    // Owner/lender draws are office money (Owner / admin / PM / APM). Supers don't load them,
    // so they don't get a "didn't load" banner; the Owner Draw tab is hidden for them.
    if (!canUseOwnerDraws(role)) { setOwnerDraws([]); return }
    const r = await api(`/api/res-owner-draws?job_id=${encodeURIComponent(id)}`)
    noteLoad('Owner draws', r.ok ? null : r.error)
    if (!r.ok) return
    setOwnerDraws(r.data.draws || [])
    setOwnerDrawsMigrated(!!r.data.migrated)
  }

  // Shared punch list (punch_list_items via /api/punch-list): the field app and sub
  // portal see the same items. res_punch_list is legacy (empty live) and read-only here.
  async function loadPunchList() {
    const r = await api(`/api/punch-list?job_id=${encodeURIComponent(id)}`)
    noteLoad('Punch list', r.ok ? null : r.error)
    if (r.ok) setPunchList(r.data.items || [])
    const { data: legacy, error } = await supabase.from('res_punch_list').select('*').eq('job_id', id).order('created_at', { ascending: false })
    if (!error) setLegacyPunch(legacy || [])
  }

  async function loadDirectCosts() {
    const r = await api(`/api/direct-costs?job_id=${encodeURIComponent(id)}`)
    noteLoad('Direct costs', r.ok ? null : r.error)
    if (r.ok) setDirectCosts(r.data.data || [])
  }

  // Read-only Field tab: what the super logs in the field app on this job.
  async function loadFieldData() {
    const [rep, rfis, del] = await Promise.all([
      supabase.from('daily_reports').select('id, report_date, work_performed, issues, photos').eq('job_id', id).order('report_date', { ascending: false }).limit(60),
      supabase.from('rfis').select('*').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('deliveries').select('id, material, vendor, status, expected_date, received_date').eq('job_id', id).order('expected_date', { ascending: true }),
    ])
    noteLoad('Field', rep.error || rfis.error || del.error)
    setFieldData({ reports: rep.data || [], rfis: rfis.data || [], deliveries: del.data || [] })
  }

  async function loadTeamMembers() {
    if (teamMembers.length) return
    const r = await api('/api/team-members')
    if (r.ok) setTeamMembers(r.data.members || [])
    else setDetailsMsg('Error: could not load the team list — ' + r.error)
  }

  // Details save goes through /api/jobs/details: allow-listed fields, checked on the
  // server (status spelling, PM is a staff login, billing schedule ranges, archive rule).
  async function saveDetails() {
    setSavingDetails(true)
    setDetailsMsg('')
    const newCV = detailsForm.contract_value !== '' && detailsForm.contract_value != null ? Number(detailsForm.contract_value) : null
    if (newCV === null && job.contract_value) {
      const confirmed = window.confirm(`Contract value will be cleared (currently $${Number(job.contract_value).toLocaleString()}). Are you sure?`)
      if (!confirmed) { setSavingDetails(false); return }
    }
    const pmChanged = (detailsForm.pm_email || '') !== (job.pm_email || '')
    if (pmChanged && job.pm_email && !window.confirm(`Change the PM from ${job.pm_email} to ${detailsForm.pm_email || 'nobody'}?\n\nJob assignments are not changed. If ${job.pm_email} only had access as the listed PM, they lose access to this job unless they are assigned.`)) { setSavingDetails(false); return }
    const fields = {}
    for (const k of ['project_name', 'job_number', 'location', 'start_date', 'owner_name', 'owner_email', 'owner_phone', 'owner_company', 'status', 'scope_notes', 'pm_email', 'permit_number', 'permit_date',
      'sub_billing_start', 'sub_billing_frequency', 'sub_billing_due', 'sub_billing_anchor', 'owner_billing_start', 'owner_billing_frequency', 'owner_billing_due', 'owner_billing_anchor']) {
      if (detailsForm[k] !== undefined) fields[k] = detailsForm[k]
    }
    fields.contract_value = newCV
    const r = await api('/api/jobs/details', jsonOpts('POST', { id, fields }))
    setSavingDetails(false)
    if (!r.ok) { setDetailsMsg('Error: ' + r.error); return } // form stays open with the user's input
    const fresh = r.data.job || job
    setJob(fresh)
    setDetailsForm(fresh)
    setEditingDetails(false)
    setDetailsMsg(r.data.unarchived ? 'Saved and unarchived (status set to Active).' : 'Saved')
    setTimeout(() => setDetailsMsg(''), 4000)
  }

  // Complete Job & Report: status → complete through the same checked save
  // (not Archive), then the residential completion report. A failed save
  // reports the failure and no report is opened.
  async function completeJob(markComplete) {
    if (markComplete && !window.confirm('Mark this job as complete and generate the completion report?\n\nThis sets Status to Complete. It does not archive the job.')) return
    setCompleting(true)
    let saveErr = null
    let saved = null
    try {
      // openHtml opens the window inside the tap (iOS), then fills it — or closes it on failure.
      const shown = await openHtml(async () => {
        if (markComplete) {
          const r = await api('/api/jobs/details', jsonOpts('POST', { id, fields: { status: 'complete' } }))
          if (!r.ok) { saveErr = r.error; return null }
          saved = r.data.job || { ...job, status: 'complete' }
        }
        return buildCompletionReportHtml({ job: saved || job, s: summaryFigures(), logoUrl: `${window.location.origin}/logo.png` })
      })
      if (saveErr) { flash(false, 'Job was NOT marked complete: ' + saveErr); return }
      if (saved) { setJob(saved); setDetailsForm(saved) }
      if (markComplete) flash(true, shown ? 'Job marked complete.' : 'Job marked complete. Allow pop-ups to see the report.')
      else if (!shown) flash(false, 'Could not open the report. Allow pop-ups for this site.')
    } finally {
      setCompleting(false)
    }
  }

  // Calls /api/budget-items and returns { ok, data }. On failure, shows the
  // server's message (including the 409 "what's attached" list) on the Budget tab.
  async function budgetApi(method, payload, failPrefix) {
    let res, data = {}
    try {
      res = await fetch('/api/budget-items', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      data = await res.json().catch(() => ({}))
    } catch (err) {
      setBudgetError(`${failPrefix}: ${err.message || 'network error'}`)
      return { ok: false, data }
    }
    if (!res.ok || data.error) {
      setBudgetError(`${failPrefix}: ${data.error || `server returned ${res.status}`}`)
      return { ok: false, data }
    }
    setBudgetError('')
    return { ok: true, data }
  }

  // '' -> null, otherwise a finite number or NaN
  const budgetNum = v => (v === '' || v === null || v === undefined) ? null : Number(v)

  async function addBudgetItem() {
    if (!newBudget.description || newBudget.budget_amount === '') return
    const cost = budgetNum(newBudget.budget_amount)
    const bank = budgetNum(newBudget.owner_amount)
    if (cost === null || !Number.isFinite(cost)) { setBudgetError('Enter a valid Cost amount.'); return }
    if (bank !== null && !Number.isFinite(bank)) { setBudgetError('Bank amount must be a number.'); return }
    setAddingBudget(true)
    const { ok } = await budgetApi('POST', {
      job_id: id, description: newBudget.description, cost_code: newBudget.cost_code || null,
      budget_amount: cost, owner_amount: bank,
    }, 'Could not add budget line')
    setAddingBudget(false)
    if (!ok) return
    await loadBudget()
    setNewBudget({ description: '', budget_amount: '', owner_amount: '', cost_code: '' })
    setShowAddBudget(false)
  }

  async function saveBudgetEdit(itemId) {
    const cost = budgetNum(editBudgetForm.budget_amount)
    const bank = budgetNum(editBudgetForm.owner_amount)
    if (cost === null || !Number.isFinite(cost)) { setBudgetError('Enter a valid Cost amount.'); return }
    if (bank !== null && !Number.isFinite(bank)) { setBudgetError('Bank amount must be a number.'); return }
    const { ok } = await budgetApi('PUT', {
      id: itemId, fields: {
        description: editBudgetForm.description, cost_code: editBudgetForm.cost_code || null,
        budget_amount: cost, owner_amount: bank,
      },
    }, 'Could not save budget line')
    if (!ok) return
    await loadBudget()
    setEditingBudgetId(null)
  }

  async function deleteBudgetItem(itemId) {
    if (!window.confirm('Delete this budget line?')) return
    const { ok } = await budgetApi('DELETE', { id: itemId }, 'Budget line not deleted')
    if (!ok) return
    setBudgetItems(items => items.filter(b => b.id !== itemId))
    await loadBudget()
  }

  async function addCO() {
    if (!newCO.description || !newCO.amount) return
    setAddingCO(true)
    setCOMsg('')
    const amount = parseFloat(newCO.amount)
    if (!Number.isFinite(amount)) { setCOMsg('Error: amount must be a number'); setAddingCO(false); return }
    // Nv cost: blank = same as the sale price (amount). Only saved when entered.
    const costText = String(newCO.nv_cost ?? '').trim()
    const nvCost = costText === '' ? null : parseFloat(costText)
    if (nvCost !== null && !Number.isFinite(nvCost)) { setCOMsg('Error: Nv cost must be a number (or leave it blank to use the sale price)'); setAddingCO(false); return }
    if (nvCost !== null && nvCost * amount < 0) { setCOMsg('Error: Nv cost must have the same sign as the amount (a credit CO has a negative cost).'); setAddingCO(false); return }
    const { data: { session: coSession } } = await supabase.auth.getSession()
    const lineId = newCO.budget_item_id || null
    const row = {
      job_id: id,
      description: newCO.description,
      amount,
      notes: newCO.notes || null,
      status: 'pending',
      budget_item_id: lineId,
      sov: lineId ? [{ budget_item_id: lineId, amount, description: newCO.description }] : null,
      created_by: coSession?.user?.id || null,
      ...(nvCost !== null ? { nv_cost: nvCost } : {}),
    }
    let { data: insertedCO, error } = await supabase.from('prime_change_orders').insert(row).select('*').single() // co_number is assigned by the database (migration 045)
    // nv_cost comes with migration 058. Until it is applied, save the CO without it
    // (Cost then moves by the sale price, as before) and say so.
    let costDropped = false
    if (error && nvCost !== null && /nv_cost/.test(error.message || '')) {
      const { nv_cost: _drop, ...withoutCost } = row
      ;({ data: insertedCO, error } = await supabase.from('prime_change_orders').insert(withoutCost).select('*').single())
      costDropped = !error
    }
    if (error) { setCOMsg('Error: ' + error.message) }
    else {
      const missing = coNumberMissingMessage(insertedCO)
      if (missing) setCOMsg(missing)
      if (costDropped) flash(false, 'Change order saved, but the Nv cost was not: the database update for it (migration 058) is not applied yet. Approving it will add the sale price to Cost.')
      await loadChangeOrders()
      setNewCO({ description: '', amount: '', nv_cost: '', notes: '', budget_item_id: '' })
      setShowAddCO(false)
    }
    setAddingCO(false)
  }

  // Approve / reject go through POST /api/prime-change-orders/review: status,
  // budget_item_id / sov and the budget-line amounts change in ONE database
  // transaction (migration 049), so a failed line, a lost connection or a second
  // click can never leave a half-applied CO. Blocked in role preview.
  // Never touches jobs.contract_value (that stays the base contract).
  async function reviewPrimeCO(co, payload, failLabel) {
    if (isPreviewActive()) { flash(false, 'This action is disabled in role preview mode.'); return }
    if (reviewingCOId) return
    setReviewingCOId(co.id)
    try {
      const r = await api('/api/prime-change-orders/review', jsonOpts('POST', { co_id: co.id, ...payload }))
      if (!r.ok) alert(`${failLabel} — nothing was changed: ${r.error}`)
    } finally {
      await Promise.all([loadChangeOrders(), loadBudget()])
      setReviewingCOId(null)
    }
  }

  // Approve: applies the CO to its budget line(s) and sets budget_applied, together.
  async function approveCO(co) {
    if (co.status !== 'pending') { alert('Only pending change orders can be approved.'); return }
    const pickedLine = co.budget_item_id || coLinePick[co.id] || ''
    const target = { ...co, budget_item_id: pickedLine || null }
    if (coBudgetDeltas(target).length === 0) { alert('Pick a budget line for this change order before approving.'); return }
    await reviewPrimeCO(co, { action: 'approve', ...(!co.budget_item_id && pickedLine ? { budget_item_id: pickedLine } : {}) }, 'Approve failed')
  }

  // Reject: a pending CO just becomes rejected. An approved CO that was applied to
  // the budget has the same deltas reversed and budget_applied cleared, together.
  async function rejectCO(co) {
    if (!['pending', 'approved'].includes(co.status)) return
    const reverse = co.status === 'approved' && co.budget_applied
    if (reverse && coBudgetDeltas(co).length === 0) { alert('Cannot reverse: this change order has no budget line recorded.'); return }
    const msg = reverse
      ? (co.nv_cost !== null && co.nv_cost !== undefined && co.nv_cost !== ''
        ? `Reject this approved change order and take it back off its budget line (Bank −$${fmt(co.amount)}, Cost −$${fmt(co.nv_cost)})?`
        : `Reject this approved change order and take $${fmt(co.amount)} back off its budget line(s)?`)
      : 'Reject this change order?'
    if (!window.confirm(msg)) return
    await reviewPrimeCO(co, { action: 'reject' }, reverse ? 'Reject failed — budget not reversed' : 'Reject failed')
  }

  // Sub change orders: same review as the commercial page (status from pending only;
  // approved ones get their SOV line server-side). They change committed cost, never
  // the homeowner contract or the budget.
  async function reviewSubCO(co, status) {
    if (co.status !== 'pending') return
    if (!window.confirm(`${status === 'approved' ? 'Approve' : 'Reject'} ${coNumberLabel(co, 'sub')} from ${co.subcontracts?.vendor_name || 'this sub'} for $${fmt(co.amount)}?`)) return
    setReviewingSubCOId(co.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const { data, error } = await supabase.from('change_orders')
        .update({ status, reviewed_by: session?.user?.id || null, reviewed_at: new Date().toISOString() })
        .eq('id', co.id).eq('status', 'pending').select('id')
      if (error) { flash(false, 'Change order not updated: ' + error.message); return }
      if (!data?.length) { flash(false, 'This change order was already handled. Refreshed.'); return }
      if (status === 'approved') {
        const r = await api('/api/sov-co-backfill', jsonOpts('POST', { subcontract_ids: [co.subcontract_id] }))
        const why = !r.ok ? r.error : (r.data.errors || []).join('; ')
        if (why) flash(false, 'Change order approved, but its SOV line could not be added to the subcontract: ' + why)
        else flash(true, 'Sub change order approved.')
      } else flash(true, 'Sub change order rejected.')
    } finally {
      await Promise.all([loadSubCOs(), loadContracts()])
      setReviewingSubCOId(null)
    }
  }

  // Homeowner change order print with signature lines. Printing changes nothing:
  // not the base contract, not the budget, not the CO status.
  function printCO(co) {
    const approvedBefore = changeOrders.filter(c => c.status === 'approved' && c.id !== co.id).reduce((a, c) => a + Number(c.amount || 0), 0)
    const html = buildChangeOrderHtml({ job, co, coLabel: coNumberLabel(co, 'prime'), baseContract: Number(job.contract_value || 0), approvedBefore, logoUrl: `${window.location.origin}/logo.png` })
    openHtml(async () => html).then(shown => { if (!shown) flash(false, 'Could not open the print window. Allow pop-ups for this site.') })
  }

  async function addSub(e) {
    e.preventDefault()
    setAddingSub(true)
    setSubMsg('')
    const dirEntry = newSubForm.dir_id ? subDirectory.find(d => d.id === newSubForm.dir_id) : null
    const company_name = dirEntry?.company_name || newSubForm.company_name
    if (!company_name) { setSubMsg('Company name required'); setAddingSub(false); return }
    try {
      const res = await fetch('/api/subcontracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: id,
          vendor_name: company_name,
          description: dirEntry?.trade || newSubForm.trade || null,
          contract_value: parseFloat(newSubForm.contract_value) || 0,
          budget_item_id: newSubForm.budget_item_id || null,
          status: 'active',
          created_by: profile?.id || null,
        }),
      })
      const result = await res.json()
      if (result.error) { setSubMsg('Error: ' + result.error); return }
      setNewSubForm({ dir_id: '', company_name: '', trade: '', contract_value: '', budget_item_id: '' })
      setShowAddSubForm(false)
      await loadContracts()
    } catch {
      setSubMsg('Network error. Please try again.')
    } finally {
      setAddingSub(false)
    }
  }

  async function saveSubEdit(contractId) {
    // PUT requires a PM session token — without it the save was rejected with 401
    const { data: { session: sSession } } = await supabase.auth.getSession()
    const res = await fetch('/api/subcontracts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sSession?.access_token}` },
      body: JSON.stringify({ id: contractId, vendor_name: editSubForm.vendor_name, description: editSubForm.description, contract_value: parseFloat(editSubForm.contract_value) || 0, budget_item_id: editSubForm.budget_item_id || null }),
    })
    const data = await res.json()
    if (data.error) { setSubMsg('Error: ' + data.error); return }
    setEditingSubId(null)
    setSubMsg('')
    await loadContracts()
  }

  async function deleteSubcontract(contractId) {
    if (!confirm('Remove this subcontractor?')) return
    const r = await api('/api/subcontracts', jsonOpts('DELETE', { id: contractId }))
    if (!r.ok) setSubMsg('Error: ' + r.error)
    await loadContracts()
  }

  async function createDraw() {
    if (creatingDraw) return
    setCreatingDraw(true)
    try {
      const title = drawForm.title || `Draw Request ${drawRequests.length + 1}`
      const res = await fetch('/api/draw-requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, title, dc_ids: [], po_ids: [], gc_ids: [] }) })
      if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to create draw'); return }
      await loadDrawRequests()
      setDrawForm({ title: '' })
      setShowCreateDraw(false)
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setCreatingDraw(false)
    }
  }

  async function updateDrawStatus(drawId, status) {
    const res = await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: drawId, status }) })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to update draw'); return }
    await loadDrawRequests()
  }

  async function deleteDraw(drawId) {
    if (!confirm('Delete this draw request?')) return
    const res = await fetch(`/api/draw-requests?id=${drawId}`, { method: 'DELETE' })
    if (!res.ok) { const j = await res.json(); alert(j.error || 'Failed to delete draw'); return }
    await loadDrawRequests()
  }

  async function submitBilling() {
    if (!billingForm.amount_billed || (!billingForm._contract_id && !billingForm.company_name)) return
    setAddingBilling(true)
    setBillingMsg('')
    try {
      const amount = parseFloat(billingForm.amount_billed) || 0
      const pct = parseFloat(billingForm.retainage_pct) || 0
      const retainage_held = pct > 0 ? +(amount * pct / 100).toFixed(2) : 0
      const body = {
        job_id: id,
        sub_id: billingForm.sub_id || null,
        company_name: billingForm.company_name || '',
        amount_billed: amount,
        retainage_held: retainage_held || null,
        retainage_pct: pct || null,
        work_description: billingForm.work_description || null,
        billing_period: billingForm.billing_period ? billingForm.billing_period + '-01' : null,
        status: 'pending',
        submitted_at: new Date().toISOString(),
      }
      const { data: { session: bSession } } = await supabase.auth.getSession()
      const r = await fetchJson(fetch, '/api/billing-entry', jsonInit('POST', body, { headers: { 'Authorization': `Bearer ${bSession?.access_token}` } }))
      if (!r.ok) { setBillingMsg('Error: ' + r.error); return }
      setBillingForm({ _contract_id: '', company_name: '', sub_id: '', amount_billed: '', retainage_pct: '10', work_description: '', billing_period: '' })
      setShowBillingForm(false)
      await loadBillingSubmissions()
    } catch {
      setBillingMsg('Network error. Please try again.')
    } finally {
      setAddingBilling(false)
    }
  }

  async function updateBillingStatus(billingId, status) {
    // Rejecting keeps the billing and needs a reason (the API requires one)
    let rejection_reason
    if (status === 'rejected') {
      rejection_reason = window.prompt('Reason for rejecting this billing (sent to the sub):')
      if (rejection_reason == null) return
      if (!rejection_reason.trim()) { alert('A rejection reason is required.'); return }
    }
    const { data: { session: bSession } } = await supabase.auth.getSession()
    const r = await fetchJson(fetch, '/api/billing-entry', jsonInit('PATCH', { id: billingId, status, ...(rejection_reason ? { rejection_reason: rejection_reason.trim() } : {}) }, { headers: { 'Authorization': `Bearer ${bSession?.access_token}` } }))
    if (!r.ok) { alert('Error: ' + r.error); return }
    const result = r.data || {}
    // Approving emails the sub and sends the lien waiver server side (billing-entry).
    if (result.emailError) alert(`Billing ${status}, but the email to the sub was not sent: ${result.emailError}`)
    if (result.waiverError) alert('Billing approved, but the lien waiver was not sent: ' + result.waiverError)
    else if (status === 'approved' && result.waiverSent) flash(true, 'Approved. Approval email and lien waiver sent to the sub.')
    if (result.untagged) flash(true, 'Rejected and taken off the draw request.')
    await Promise.all([loadBillingSubmissions(), ...(result.untagged ? [loadDrawRequests()] : [])])
  }

  // Send (or resend) the conditional lien waiver for an approved billing.
  async function sendWaiver(b) {
    if (sendingWaiverId) return
    if (b.lien_waiver_sent_at && !window.confirm(`Resend the lien waiver to ${b.company_name || 'the sub'}? One was sent ${new Date(b.lien_waiver_sent_at).toLocaleDateString()}.`)) return
    setSendingWaiverId(b.id)
    const r = await api('/api/lien-waiver', jsonOpts('POST', { submission_id: b.id, resend: true }))
    setSendingWaiverId(null)
    if (!r.ok) { flash(false, 'Lien waiver not sent: ' + r.error); return }
    flash(true, `Lien waiver emailed to ${b.company_name || 'the sub'}.`)
    await loadBillingSubmissions()
  }

  async function deleteBilling(billingId) {
    const b = billingSubmissions.find(x => x.id === billingId)
    const block = b && billingDeleteBlock(b)
    if (block) { alert(block); return }
    if (!confirm('Delete this billing submission?')) return
    const { data: { session: bSession } } = await supabase.auth.getSession()
    const r = await fetchJson(fetch, '/api/billing-entry', jsonInit('DELETE', { id: billingId }, { headers: { 'Authorization': `Bearer ${bSession?.access_token}` } }))
    if (!r.ok) { alert('Error: ' + r.error); return }
    await loadBillingSubmissions()
  }

  // Draw tagging goes through /api/draw-requests, which checks the draw is open, on this job,
  // and the cost is approved and not on another draw.
  async function patchDrawItems(drawId, items) {
    try {
      const res = await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: drawId, ...items }) })
      const j = await res.json().catch(() => ({}))
      return (!res.ok || j.error) ? (j.error || `server returned ${res.status}`) : null
    } catch (e) {
      return e.message || 'network error'
    }
  }

  async function saveDrawCosts(drawId) {
    setSavingDrawCosts(true)
    try {
      const err = await patchDrawItems(drawId, { add_dc_ids: drawAddCostIds })
      if (err) alert('Costs were not added to the draw: ' + err)
      else setDrawAddCostIds([])
      await Promise.all([loadDrawRequests(), loadDirectCosts()])
    } finally {
      setSavingDrawCosts(false)
    }
  }

  async function removeCostFromDraw(costId) {
    const cost = directCosts.find(c => c.id === costId)
    if (!cost?.draw_request_id) return
    const err = await patchDrawItems(cost.draw_request_id, { remove_dc_ids: [costId] })
    if (err) alert('Could not take the cost off the draw: ' + err)
    await Promise.all([loadDrawRequests(), loadDirectCosts()])
  }

  async function saveDrawBillings(drawId) {
    setSavingDrawBillings(true)
    try {
      const { data: { session: bSession } } = await supabase.auth.getSession()
      const results = await Promise.all(drawAddBillingIds.map(bid =>
        api('/api/billing-entry', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bSession?.access_token}` }, body: JSON.stringify({ id: bid, draw_request_id: drawId }) })
      ))
      const failed = results.filter(r => !r.ok)
      if (failed.length) alert(`${failed.length} billing(s) were not added to the draw: ` + failed.map(r => r.error).join('; '))
      setDrawAddBillingIds([])
      await Promise.all([loadDrawRequests(), loadBillingSubmissions()])
    } catch {
      alert('Failed to save billings to draw. Please try again.')
    } finally {
      setSavingDrawBillings(false)
    }
  }

  async function removeBillingFromDraw(billingId) {
    const { data: { session: bSession } } = await supabase.auth.getSession()
    const r = await api('/api/billing-entry', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bSession?.access_token}` }, body: JSON.stringify({ id: billingId, draw_request_id: null }) })
    if (!r.ok) alert('Could not take the billing off the draw: ' + r.error)
    await Promise.all([loadDrawRequests(), loadBillingSubmissions()])
  }

  // Internal draw package. Every value (sub-typed descriptions included) is escaped
  // in lib/residential-print.js before it reaches the print window.
  function printDraw(dr) {
    const html = buildDrawPackageHtml({
      job, draw: dr,
      costs: directCosts.filter(c => c.draw_request_id === dr.id),
      billings: billingSubmissions.filter(b => b.draw_request_id === dr.id),
      logoUrl: `${window.location.origin}/logo.png`,
    })
    openHtml(async () => html).then(shown => { if (!shown) flash(false, 'Could not open the print window. Allow pop-ups for this site.') })
  }

  async function addMilestone() {
    if (!newMilestone.title) return
    setAddingMilestone(true)
    const { data: { session: mSession } } = await supabase.auth.getSession()
    const status = newMilestone.status || 'pending'
    const { error: milestoneErr } = await supabase.from('milestones').insert({
      job_id: id,
      title: newMilestone.title,
      due_date: newMilestone.due_date || null,
      status,
      completed_date: status === 'complete' ? todayCentral() : null,
      notes: newMilestone.notes || null,
      created_by: mSession?.user?.id || null,
    })
    if (milestoneErr) { alert('Failed to add milestone: ' + milestoneErr.message); setAddingMilestone(false); return }
    await loadMilestones()
    setNewMilestone({ title: '', due_date: '', status: 'pending', notes: '' })
    setShowAddMilestone(false)
    setAddingMilestone(false)
  }

  async function updateMilestoneStatus(milestoneId, status) {
    const { error } = await supabase.from('milestones').update({ status, completed_date: status === 'complete' ? todayCentral() : null }).eq('id', milestoneId)
    if (error) alert('Failed to update milestone: ' + error.message)
    await loadMilestones()
  }

  async function deleteMilestone(milestoneId) {
    if (!confirm('Delete this milestone?')) return
    const { error } = await supabase.from('milestones').delete().eq('id', milestoneId)
    if (error) alert('Failed to delete milestone: ' + error.message)
    await loadMilestones()
  }

  // Upload to the shared private bucket and job_photos (same as the field app), so
  // the photo shows on every page. A failed row insert removes the just-uploaded file.
  async function uploadPhoto(e) {
    const file = e.target.files?.[0]
    if (photoInputRef.current) photoInputRef.current.value = ''
    if (!file) return
    setPhotoMsg('')
    if (!/^image\//.test(file.type || '')) { setPhotoMsg('Error: pick an image file.'); return }
    // No portal size cap (the photo goes straight to Storage); Storage's own limits still apply
    // and show up as the upload error below.
    setUploadingPhoto(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const rand = Math.random().toString(36).slice(2, 8)
      const path = `${id}/gallery/${Date.now()}-${rand}-${safeFileName(file.name)}`
      const taken = await resolveTakenAt(file)
      const { error: upErr } = await supabase.storage.from('daily-report-photos').upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upErr) { setPhotoMsg('Error: upload failed — ' + upErr.message); return }
      // internal_only true is never dropped: before migration 070 the insert is refused and
      // the uploaded file removed (no owner-visible row).
      const { error: dbErr, migrationRequired } = await insertJobPhotoWithFallbacks(extra => insertWithGpsFallback(gps => supabase.from('job_photos').insert({ job_id: id, super_id: session?.user?.id || null, storage_path: path, file_name: file.name, caption: null, ...extra, taken_at: taken.takenAt, ...gps }), taken.gps), { internal_only: photoInternalDraft })
      if (dbErr) {
        await supabase.storage.from('daily-report-photos').remove([path])
        setPhotoMsg(migrationRequired ? 'Error: ' + dbErr.message : 'Error: photo not saved — ' + dbErr.message)
        return
      }
      await loadPhotos()
    } finally {
      setUploadingPhoto(false)
    }
  }

  // Hide from owner / Show to owner — /api/photo-visibility (same gate as delete-photo).
  const canTogglePhoto = ['principal', 'pm', 'admin', 'super'].includes(userRole)
  async function togglePhotoVisibility(photo) {
    if (!photo?.path || togglingPhoto) return
    const next = !photo.internal_only
    setTogglingPhoto(photo.path)
    setPhotos(list => list.map(p => (p.key === photo.key ? { ...p, internal_only: next } : p)))
    const r = await api('/api/photo-visibility', jsonOpts('POST', { jobId: id, path: photo.path, internal_only: next, fromReport: !!photo.fromReport, reportId: photo.reportId || null }))
    setTogglingPhoto(null)
    if (!r.ok) { setPhotoMsg('Error: ' + (next ? 'hide from owner' : 'show to owner') + ' failed — ' + r.error); await loadPhotos() }
  }

  // Same guarded delete as the commercial page (/api/delete-photo checks role and job).
  async function deletePhoto(photo) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setDeletingPhoto(photo.path)
    const r = await api('/api/delete-photo', jsonOpts('POST', { path: photo.path, fromReport: !!photo.fromReport, reportId: photo.reportId || null, jobId: id }))
    setDeletingPhoto(null)
    if (!r.ok) { setPhotoMsg('Error: delete failed — ' + r.error); return }
    setLightbox(null)
    await loadPhotos()
  }

  // New documents: job_documents + private job-documents bucket through the job-scoped
  // /api/job-docs route (same records the field app and commercial page use).
  async function uploadDoc(e) {
    const file = e.target.files?.[0]
    if (docInputRef.current) docInputRef.current.value = ''
    if (!file) return
    setUploadingDoc(true)
    setDocMsg('')
    try {
      const path = `${id}/${docCategory}/${Date.now()}-${safeFileName(file.name)}`
      const urlRes = await api('/api/job-docs', jsonOpts('POST', { action: 'upload-url', path }))
      if (!urlRes.ok || !urlRes.data.signedUrl) throw new Error(urlRes.error || 'Could not get upload URL')
      const up = await putToSignedUrl(fetch, urlRes.data.signedUrl, file)
      if (!up.ok) throw new Error(up.error)
      const ins = await api('/api/job-docs', jsonOpts('POST', { action: 'insert-document', job_id: id, storage_path: path, file_name: file.name, category: docCategory }))
      if (!ins.ok) throw new Error('File uploaded but the document record was not saved: ' + ins.error)
      await loadDocuments()
    } catch (err) {
      setDocMsg('Error: ' + err.message)
    } finally {
      setUploadingDoc(false)
    }
  }

  // Called straight from the click so iOS keeps it as a user gesture
  async function openJobDoc(path) {
    let errMsg = ''
    const url = await openFile(async () => {
      const r = await api(`/api/job-docs?path=${encodeURIComponent(path)}`)
      if (!r.ok) errMsg = r.error
      return r.data?.url || null
    })
    if (!url) setDocMsg('Error: could not open document' + (errMsg ? ' — ' + errMsg : '.'))
  }

  async function deleteDoc(doc) {
    if (!window.confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return
    const r = await api(`/api/job-docs?id=${encodeURIComponent(doc.id)}`, { method: 'DELETE' })
    if (!r.ok) { setDocMsg('Error: ' + r.error); return }
    if (r.data.warning) setDocMsg('Error: ' + r.data.warning)
    await loadDocuments()
  }

  async function addContact() {
    if (!newContact.name) return
    setAddingContact(true)
    setContactMsg('')
    const { error } = await supabase.from('job_contacts').insert({ job_id: id, name: newContact.name, role: newContact.role || null, phone: newContact.phone || null, email: newContact.email || null, company: newContact.company || null, notes: newContact.notes || null })
    setAddingContact(false)
    if (error) { setContactMsg('Error: ' + error.message); return } // form stays open
    await loadContacts()
    setNewContact({ name: '', role: '', phone: '', email: '', company: '', notes: '' })
    setShowAddContact(false)
  }

  async function deleteContact(contactId) {
    if (!confirm('Remove this contact?')) return
    const { error } = await supabase.from('job_contacts').delete().eq('id', contactId)
    if (error) setContactMsg('Error: ' + error.message)
    await loadContacts()
  }

  async function submitDC(e) {
    e.preventDefault()
    if (submittingDc) return
    setSubmittingDc(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { alert('Session expired. Please refresh the page.'); setSubmittingDc(false); return }
    const rowData = {
      job_id: id,
      submitted_by: session.user.id,
      cost_date: dcForm.cost_date,
      description: dcForm.description,
      category: dcForm.category,
      amount: parseFloat(dcForm.amount),
      notes: dcForm.notes || null,
      budget_item_id: dcForm.budget_item_id || null,
      is_credit: dcForm.is_credit || false,
      // New costs go through review (Pending → Approve), same as commercial
      status: 'pending',
    }
    try {
      // Receipt goes straight to Storage; the API gets only { path, uploadReceipt }.
      const r = await uploadThenSend({
        fetchFn: authFetch, putFn: fetch, file: dcFile, target: 'direct-cost-receipt', context: { job_id: id },
        send: attachment => fetchJson(authFetch, '/api/direct-costs', jsonInit('POST', attachment ? { ...rowData, attachment } : rowData)),
      })
      if (!r.ok) { alert((r.stage === 'upload' ? 'Receipt upload failed: ' : 'Error: ') + r.error); return }
      setDcForm({ cost_date: todayCentral(), description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '', is_credit: false })
      setDcFile(null)
      setShowDcForm(false)
      await loadDirectCosts()
    } catch (err) {
      alert('Failed to save cost: ' + (err?.message || 'network error'))
    } finally {
      setSubmittingDc(false)
    }
  }

  // Status changes and review edits go through /api/dc-review (same as commercial).
  async function callDcReview(action, costId, extraFields = {}) {
    const { data: { session: rSession } } = await supabase.auth.getSession()
    const token = rSession?.access_token
    if (!token) { alert('Session expired — please reload the page.'); return { error: 'No session' } }
    // A failed request (non-2xx, non-JSON, bad JSON, network) always comes back as { error }.
    const r = await fetchJson(fetch, '/api/dc-review', jsonInit('POST', { action, id: costId, ...extraFields }, { headers: { 'Authorization': `Bearer ${token}` } }))
    return r.ok ? (r.data || {}) : { ...(r.data && typeof r.data === 'object' ? r.data : {}), error: r.error }
  }

  async function approveCost(costId) {
    const cost = directCosts.find(c => c.id === costId)
    if (!cost?.budget_item_id) { alert('Assign a budget line before approving.'); return }
    setUpdatingCostId(costId)
    const result = await callDcReview('approve', costId)
    if (result.error) alert('Approve failed: ' + result.error)
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function rejectCost(costId) {
    const rejection_reason = costRejectNote.trim()
    if (!rejection_reason) { alert('A rejection reason is required.'); return }
    setUpdatingCostId(costId)
    const result = await callDcReview('reject', costId, { rejection_reason })
    if (result.error) alert('Reject failed: ' + result.error)
    else { setRejectingCostId(null); setCostRejectNote('') }
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function unapproveCost(costId) {
    setUpdatingCostId(costId)
    const result = await callDcReview('unapprove', costId)
    if (result.error) alert('Unapprove failed: ' + result.error)
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function deleteCost(costId) {
    setUpdatingCostId(costId)
    try {
      const res = await fetch('/api/direct-costs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || j.error) alert('Delete failed: ' + (j.error || `server returned ${res.status}`))
    } catch (err) {
      alert('Delete failed: ' + (err.message || 'network error'))
    }
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function unrejectCost(costId) {
    setUpdatingCostId(costId)
    const result = await callDcReview('reopen', costId)
    if (result.error) alert('Failed: ' + result.error)
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function sendAiMessage(inputOverride) {
    const text = (inputOverride ?? aiInput).trim()
    if (!text || aiLoading) return
    const userMsg = { role: 'user', content: text }
    const next = [...aiMessages, userMsg]
    setAiMessages(next)
    setAiInput('')
    setAiLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/ask-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ job_id: id, messages: next }),
      })
      const data = await res.json()
      setAiMessages(prev => [...prev, { role: 'assistant', content: data.reply || data.error || 'No response.' }])
    } catch {
      setAiMessages(prev => [...prev, { role: 'assistant', content: 'Connection error — please try again.' }])
    }
    setAiLoading(false)
  }

  async function approveAllAssigned() {
    const toApprove = directCosts.filter(c => c.status === 'pending' && c.budget_item_id)
    if (toApprove.length === 0) return
    if (!window.confirm(`Approve ${toApprove.length} pending cost${toApprove.length !== 1 ? 's' : ''} with assigned budget lines?`)) return
    setApprovingAll(true)
    const results = await Promise.all(toApprove.map(c => callDcReview('approve', c.id).then(r => ({ c, r }))))
    const failed = results.filter(x => x.r.error)
    if (failed.length) {
      alert(`${failed.length} of ${toApprove.length} could not be approved:\n` + failed.map(x => `• ${x.c.description}: ${x.r.error}`).join('\n'))
    }
    await loadDirectCosts()
    setApprovingAll(false)
  }

  async function assignDCBudgetItem(costId, budgetItemId) {
    const result = await callDcReview('edit', costId, { budget_item_id: budgetItemId || '' })
    if (result.error) alert('Could not assign budget line: ' + result.error)
    await loadDirectCosts()
  }

  function exportDCsCSV() {
    const rows = [['Date', 'Description', 'Category', 'Amount', 'Budget Line', 'Status', 'Notes']]
    directCosts.forEach(c => {
      const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)?.description || ''
      rows.push([c.cost_date, c.description, c.category, c.amount, budgetLine, c.status, c.notes || ''])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `direct-costs-${job.job_number}.csv` })
    a.click()
  }

  // Called straight from the click so iOS keeps it as a user gesture
  async function openDCReceipt(path) {
    const url = await openFile(async () => {
      const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 300)
      return data?.signedUrl || null
    })
    if (!url) alert('Could not open receipt. The file may not be available.')
  }

  async function saveEditedCost() {
    setSavingEditCost(true)
    const result = await callDcReview('edit', editingCostId, { ...editCostForm, budget_item_id: editCostForm.budget_item_id || '' })
    setSavingEditCost(false)
    if (result.error) { alert('Save failed: ' + result.error); return }
    setEditingCostId(null)
    await loadDirectCosts()
  }

  // ── Inspections ── (res_inspections: result / scheduled_date / actual_date / notes)
  async function addInspection() {
    if (!newInspection.inspection_type) return
    setAddingInspection(true)
    setInspectionMsg('')
    const r = await api('/api/res-inspections', jsonOpts('POST', { job_id: id, inspection_type: newInspection.inspection_type, scheduled_date: newInspection.scheduled_date || null, inspector_name: newInspection.inspector_name || null, result: 'pending', notes: newInspection.notes || null }))
    setAddingInspection(false)
    if (!r.ok) { setInspectionMsg('Error: ' + r.error); return }
    await loadInspections()
    setNewInspection({ inspection_type: 'Framing', scheduled_date: '', inspector_name: '', result: 'pending', notes: '' })
    setShowAddInspection(false)
  }

  // Record a result. Passed/failed set actual_date (the day it happened); back to
  // pending clears it.
  async function saveInspectionResult(ins, result, date) {
    setInspectionMsg('')
    const update = { result, actual_date: result === 'pending' ? null : (date || todayCentral()) }
    const r = await api('/api/res-inspections', jsonOpts('PATCH', { id: ins.id, ...update }))
    if (!r.ok) { setInspectionMsg('Error: ' + r.error); return false }
    setInspEdit(null)
    await loadInspections()
    return true
  }

  // Reschedule a not-yet-done inspection: new scheduled_date, still pending, no
  // actual_date (it has not happened). The old date is kept in the notes.
  async function rescheduleInspection(ins, newDate) {
    if (!newDate) { setInspectionMsg('Error: pick the new date.'); return }
    setInspectionMsg('')
    const note = `Rescheduled from ${ins.scheduled_date ? fmtDate(ins.scheduled_date) : 'unscheduled'} on ${fmtDate(todayCentral())}.`
    const r = await api('/api/res-inspections', jsonOpts('PATCH', { id: ins.id, scheduled_date: newDate, result: 'pending', actual_date: null, notes: [ins.notes, note].filter(Boolean).join('\n') }))
    if (!r.ok) { setInspectionMsg('Error: ' + r.error); return }
    setInspEdit(null)
    await loadInspections()
  }

  // Re-inspection after a failure: a NEW pending row; the failed one keeps its result.
  async function reinspect(ins, newDate) {
    setInspectionMsg('')
    const ref = `Re-inspection of ${ins.inspection_type} that failed${ins.actual_date ? ' on ' + fmtDate(ins.actual_date) : ''} (ref ${String(ins.id).slice(0, 8)}).`
    const r = await api('/api/res-inspections', jsonOpts('POST', { job_id: id, inspection_type: ins.inspection_type, scheduled_date: newDate || null, inspector_name: ins.inspector_name || null, result: 'pending', notes: ref }))
    if (!r.ok) { setInspectionMsg('Error: ' + r.error); return }
    setInspEdit(null)
    await loadInspections()
  }

  // Optional: punch item for a failed inspection, through the shared punch API.
  async function punchFromInspection(ins) {
    if (!window.confirm(`Create a punch list item for the failed ${ins.inspection_type} inspection?`)) return
    const { data: { session } } = await supabase.auth.getSession()
    const r = await api('/api/punch-list', jsonOpts('POST', { job_id: id, title: `Fix failed ${ins.inspection_type} inspection`, description: ins.notes || null, created_by: session?.user?.id || null }))
    if (!r.ok) { setInspectionMsg('Error: punch item not created — ' + r.error); return }
    setInspectionMsg('Punch item created.')
    await loadPunchList()
  }

  async function deleteInspection(inspectionId) {
    if (!confirm('Delete this inspection?')) return
    const r = await api('/api/res-inspections', jsonOpts('DELETE', { id: inspectionId }))
    if (!r.ok) setInspectionMsg('Error: ' + r.error)
    await loadInspections()
  }

  // ── Lien Waivers ── manual log (res_lien_waivers). E-signed waivers come from billing.
  async function addLienWaiver() {
    if (!newWaiver.company_name) return
    const amt = newWaiver.amount === '' ? null : Number(newWaiver.amount)
    if (amt !== null && !Number.isFinite(amt)) { setWaiverMsg('Error: amount must be a number.'); return }
    setAddingWaiver(true)
    setWaiverMsg('')
    const { error } = await supabase.from('res_lien_waivers').insert({ job_id: id, company_name: newWaiver.company_name, subcontract_id: newWaiver.subcontract_id || null, waiver_type: newWaiver.waiver_type, amount: amt, payment_date: newWaiver.payment_date || null, waiver_date: newWaiver.waiver_date || null, status: newWaiver.status, notes: newWaiver.notes || null })
    setAddingWaiver(false)
    if (error) { setWaiverMsg('Error: ' + error.message); return }
    await loadLienWaivers()
    setNewWaiver({ company_name: '', subcontract_id: '', waiver_type: 'conditional', amount: '', payment_date: '', waiver_date: '', status: 'pending', notes: '' })
    setShowAddWaiver(false)
  }

  async function updateWaiverStatus(waiverId, status) {
    const update = { status }
    if (status === 'received') update.waiver_date = todayCentral()
    const { error } = await supabase.from('res_lien_waivers').update(update).eq('id', waiverId)
    if (error) setWaiverMsg('Error: ' + error.message)
    await loadLienWaivers()
  }

  async function deleteWaiver(waiverId) {
    if (!confirm('Delete this waiver record?')) return
    const { error } = await supabase.from('res_lien_waivers').delete().eq('id', waiverId)
    if (error) setWaiverMsg('Error: ' + error.message)
    await loadLienWaivers()
  }

  function viewBillingWaiver(b) {
    openHtml(async () => buildBillingWaiverHtml({ billing: b, job, origin: window.location.origin }))
      .then(shown => { if (!shown) flash(false, 'Could not open the waiver. Allow pop-ups for this site.') })
  }

  // ── Owner / Lender Draw ── all writes through /api/res-owner-draws (job-checked).
  function startDrawEdit(d = null) {
    setDrawMsg('')
    if (!d) {
      setDrawEdit({ id: null, title: '', period_start: '', period_end: '', notes: '', amount_requested: '', link_draw_request_id: '', lines: {} })
      return
    }
    const lines = {}
    for (const l of Array.isArray(d.schedule_lines) ? d.schedule_lines : []) lines[l.budget_item_id] = String(l.this_period)
    setDrawEdit({ id: d.id, title: d.title || '', period_start: d.period_start || '', period_end: d.period_end || '', notes: d.notes || '', amount_requested: String(d.amount_requested ?? ''), lines })
  }

  async function saveDraw() {
    if (!drawEdit) return
    const lineEntries = Object.entries(drawEdit.lines || {}).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    const hasLines = lineEntries.length > 0
    const linesTotal = round2(lineEntries.reduce((a, [, v]) => a + Number(v || 0), 0))
    const amount = hasLines ? linesTotal : Number(drawEdit.amount_requested)
    if (!Number.isFinite(amount) || (drawEdit.amount_requested === '' && !hasLines)) { setDrawMsg('Error: enter the amount requested or fill in the Bank lines.'); return }
    if (lineEntries.some(([, v]) => !Number.isFinite(Number(v)))) { setDrawMsg('Error: every line amount must be a number.'); return }
    const linked = !drawEdit.id && drawEdit.link_draw_request_id ? drawRequests.find(d => d.id === drawEdit.link_draw_request_id) : null
    if (linked && ownerDraws.some(d => d.draw_number === linked.draw_number && d.status !== 'void')) {
      if (!window.confirm(`An Owner/Lender Draw #${linked.draw_number} already exists. Create another one with the same number?`)) return
    }
    const payload = {
      title: drawEdit.title, period_start: drawEdit.period_start || null, period_end: drawEdit.period_end || null, notes: drawEdit.notes,
      amount_requested: amount,
      ...(hasLines || (drawEdit.id && ownerDraws.find(d => d.id === drawEdit.id)?.schedule_lines) ? { schedule_lines: lineEntries.map(([budget_item_id, v]) => ({ budget_item_id, this_period: Number(v) })) } : {}),
    }
    setDrawBusy(true)
    setDrawMsg('')
    const r = drawEdit.id
      ? await api('/api/res-owner-draws', jsonOpts('PATCH', { id: drawEdit.id, action: 'edit', ...payload }))
      : await api('/api/res-owner-draws', jsonOpts('POST', { job_id: id, ...payload, link_draw_request_id: drawEdit.link_draw_request_id || null }))
    setDrawBusy(false)
    if (!r.ok) { setDrawMsg('Error: ' + r.error); return } // form stays open
    setDrawEdit(null)
    await loadOwnerDraws()
  }

  async function setDrawStatus(d, status) {
    const msg = status === 'void'
      ? `Void Draw #${d.draw_number}? It stays on record as void and no longer counts toward requested or funded totals. This can't be undone.`
      : `Mark Draw #${d.draw_number} as ${status}?${status === 'submitted' ? '\n\nAfter submitting, its amount and schedule are locked.' : ''}`
    if (!window.confirm(msg)) return
    setDrawMsg('')
    const r = await api('/api/res-owner-draws', jsonOpts('PATCH', { id: d.id, action: 'status', status }))
    if (!r.ok) setDrawMsg('Error: ' + r.error)
    await loadOwnerDraws()
  }

  async function recordFunding() {
    if (!fundingDraw) return
    const amt = Number(fundingDraw.amount_funded)
    if (fundingDraw.amount_funded === '' || !Number.isFinite(amt) || amt < 0) { setDrawMsg('Error: enter the amount actually received.'); return }
    setDrawBusy(true)
    const r = await api('/api/res-owner-draws', jsonOpts('PATCH', { id: fundingDraw.id, action: 'fund', amount_funded: amt, funded_date: fundingDraw.funded_date || null }))
    setDrawBusy(false)
    if (!r.ok) { setDrawMsg('Error: ' + r.error); return }
    setFundingDraw(null)
    await loadOwnerDraws()
  }

  async function deleteOwnerDraw(d) {
    if (!confirm(`Delete draft Draw #${d.draw_number}?`)) return
    const r = await api(`/api/res-owner-draws?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' })
    if (!r.ok) setDrawMsg('Error: ' + r.error)
    await loadOwnerDraws()
  }

  // Attachments go to the private job-documents bucket under the draw's folder.
  async function attachToDraw(d, file) {
    if (!file) return
    setDrawBusy(true)
    setDrawMsg('')
    try {
      const path = `${id}/owner-draws/${d.id}/${Date.now()}-${safeFileName(file.name)}`
      const urlRes = await api('/api/job-docs', jsonOpts('POST', { action: 'upload-url', path }))
      if (!urlRes.ok || !urlRes.data.signedUrl) throw new Error(urlRes.error || 'Could not get upload URL')
      const up = await putToSignedUrl(fetch, urlRes.data.signedUrl, file)
      if (!up.ok) throw new Error(up.error)
      const r = await api('/api/res-owner-draws', jsonOpts('PATCH', { id: d.id, action: 'attach', path, name: file.name }))
      if (!r.ok) throw new Error(r.error)
      await loadOwnerDraws()
    } catch (err) {
      setDrawMsg('Error: ' + err.message)
    } finally {
      setDrawBusy(false)
    }
  }

  function drawScheduleFor(d) {
    const prior = priorDrawnByLine(ownerDraws, { excludeId: d?.id || null, drawNumber: d?.draw_number ?? null })
    const thisByLine = {}
    for (const l of Array.isArray(d?.schedule_lines) ? d.schedule_lines : []) thisByLine[l.budget_item_id] = Number(l.this_period || 0)
    // Submitted draws print the snapshot taken when saved (description / scheduled value).
    const snapshot = d && d.status !== 'draft' && Array.isArray(d.schedule_lines)
    const items = budgetItems.map(b => {
      const snap = snapshot ? d.schedule_lines.find(l => l.budget_item_id === b.id) : null
      return snap ? { ...b, description: snap.description || b.description, owner_amount: snap.scheduled_value } : b
    })
    return buildDrawSchedule(items, prior, thisByLine)
  }

  function printOwnerDraw(d) {
    const html = buildOwnerDrawHtml({ job, draw: d, schedule: drawScheduleFor(d), revised: revisedContract(job, changeOrders), logoUrl: `${window.location.origin}/logo.png` })
    openHtml(async () => html).then(shown => { if (!shown) setDrawMsg('Error: could not open the print window. Allow pop-ups for this site.') })
  }

  // ── Punch List ── shared punch_list_items through /api/punch-list
  async function addPunchItem() {
    if (!newPunch.title.trim()) return
    setAddingPunch(true)
    setPunchMsg('')
    const { data: { session } } = await supabase.auth.getSession()
    const contract = newPunch.subcontract_id ? contracts.find(c => c.id === newPunch.subcontract_id) : null
    const r = await api('/api/punch-list', jsonOpts('POST', {
      job_id: id, title: newPunch.title.trim(), description: newPunch.description || null,
      assigned_company: contract?.vendor_name || newPunch.assigned_company || null,
      assigned_sub_id: contract?.sub_id || null,
      due_date: newPunch.due_date || null, created_by: session?.user?.id || null,
    }))
    setAddingPunch(false)
    if (!r.ok) { setPunchMsg('Error: ' + r.error); return }
    await loadPunchList()
    setNewPunch({ title: '', description: '', subcontract_id: '', assigned_company: '', due_date: '' })
    setShowAddPunch(false)
  }

  async function updatePunchStatus(itemId, status) {
    setPunchBusyId(itemId)
    setPunchMsg('')
    const r = await api('/api/punch-list', jsonOpts('PATCH', { id: itemId, status }))
    setPunchBusyId(null)
    if (!r.ok) setPunchMsg('Error: ' + r.error)
    await loadPunchList()
  }

  async function deletePunchItem(itemId) {
    if (!confirm('Delete this punch list item?')) return
    const r = await api(`/api/punch-list?id=${encodeURIComponent(itemId)}`, { method: 'DELETE' })
    if (!r.ok) setPunchMsg('Error: ' + r.error)
    await loadPunchList()
  }

  async function parseEstimate(e) {
    const file = e.target.files?.[0]
    if (!file) return
    // AI parsing has its own processing limit (not a portal upload limit): say so before uploading.
    if (file.size > AI_PARSE_MAX_BYTES) { setParseMsg('Error: ' + AI_PARSE_LIMIT_PRECHECK_MESSAGE); e.target.value = ''; return }
    setParsingEstimate(true)
    setParseMsg('Uploading estimate…')
    setParsedItems([])
    setSelectedImportIds(new Set())
    try {
      // Staged straight to Storage (private, temporary); the API gets only { path, uploadReceipt }
      // and removes the staged file once parsing finishes.
      const r = await uploadThenSend({
        fetchFn: authFetch, putFn: fetch, file, target: 'parse-estimate',
        send: attachment => { setParseMsg('Parsing estimate…'); return fetchJson(authFetch, '/api/parse-estimate', jsonInit('POST', { attachment })) },
      })
      if (r.stage === 'save') forgetUpload(file) // the staged file is gone after any parse attempt
      if (!r.ok) {
        setParseMsg('Error: ' + (r.stage === 'upload' ? 'upload failed — ' : '') + r.error)
      } else {
        const items = r.data?.items || []
        setParsedItems(items)
        setSelectedImportIds(new Set(items.map((_, i) => i)))
        setParseMsg(`Found ${items.length} line items — review and import below`)
      }
    } catch (err) {
      setParseMsg('Error: ' + err.message)
    } finally {
      setParsingEstimate(false)
      e.target.value = ''
    }
  }

  async function importSelectedItems() {
    if (selectedImportIds.size === 0) return
    setImportingItems(true)
    setParseMsg('')
    const toInsert = parsedItems
      .filter((_, i) => selectedImportIds.has(i))
      .map(item => ({
        job_id: id,
        description: item.description,
        budget_amount: parseFloat(item.amount) || 0,
        cost_code: item.section || null,
      }))
    try {
      const res = await fetch('/api/budget-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toInsert),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseMsg('Import failed: ' + (data.error || 'Unknown error'))
        setImportingItems(false)
        return
      }
      await loadBudget()
      setParsedItems([])
      setSelectedImportIds(new Set())
      setShowImportEstimate(false)
      setParseMsg('')
    } catch (err) {
      setParseMsg('Import failed: ' + err.message)
    }
    setImportingItems(false)
  }

  // Figures for the completion report, from the same data as the tabs.
  function summaryFigures() {
    const f = ownerDrawFunding(ownerDraws)
    return {
      baseContract: Number(job?.contract_value || 0),
      approvedCOs: approvedCOTotal(changeOrders),
      revised: revisedContract(job, changeOrders),
      bankTotal: hideBudget ? null : budgetItems.reduce((a, b) => a + Number(bankAmount(b) || 0), 0),
      costBudget: hideBudget ? null : budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0),
      committed: committedTotalForLines(contracts, subCOs, budgetItems),
      approvedDc: approvedDcTotal(directCosts),
      approvedBilling: billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0),
      requested: f.requested,
      fundedKnown: f.fundedKnown,
      unknownFunded: f.unknownFunded,
    }
  }

  if (loading) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#6b7280' }}>Loading...</div></div>
  if (jobErrMsg && !job) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', gap: '1rem' }}>
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '16px 24px', borderRadius: '8px', fontSize: '13px', maxWidth: '500px', textAlign: 'center' }}>{jobErrMsg}</div>
      <button onClick={() => router.push('/dashboard')} style={{ padding: '10px 24px', background: '#fff', border: '1px solid #d1d5db', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }}>← Back to dashboard</button>
    </div>
  )
  if (notAssigned) return (
    <div style={{ ...s.page, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem', padding: '0 16px' }}>
      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '20px 24px', borderRadius: '8px', fontSize: '14px', maxWidth: '460px', textAlign: 'center', lineHeight: 1.5 }}>
        <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '6px' }}>{NOT_ASSIGNED_MESSAGE}</div>
        Only the PM/APM assigned to this job (or listed as its PM) can open it. Ask an Owner to assign you if you need access.
      </div>
      <button onClick={() => router.push('/dashboard')} style={{ padding: '10px 24px', background: '#f0f0f0', border: '1px solid #d1d5db', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }}>← Back to dashboard</button>
    </div>
  )
  if (!job) return <div style={{ ...s.page, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div style={{ color: '#6b7280' }}>Project not found.</div></div>

  // ── Shared figures (Overview, header KPIs, tabs and the completion report use the same ones) ──
  const approvedCOs = approvedCOTotal(changeOrders)
  const baseContract = Number(job.contract_value || 0)
  const revisedContractTotal = revisedContract(job, changeOrders)
  const budgetTotal = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
  const bankTotal = budgetItems.reduce((a, b) => a + Number(bankAmount(b) || 0), 0)
  // Only warn when there is a budget and a contract to compare
  const canCompareBudget = !hideBudget && budgetItems.length > 0 && job.contract_value != null
  // Bank vs the REVISED contract (base + approved sale prices); Cost vs base + approved
  // Nv cost (nv_cost ?? amount). Cost under the revised contract because a CO's Nv cost is
  // below its price is expected and not flagged.
  const budgetCheck = budgetContractCheck({ job, changeOrders, costTotal: budgetTotal, bankTotal })
  const costVsContract = canCompareBudget && budgetCheck.costMismatch
  const bankVsContract = canCompareBudget && budgetCheck.bankMismatch
  const hasApprovedCOs = changeOrders.some(c => c.status === 'approved')
  const BUDGET_COLS = '3fr 1fr 1fr 1fr 1fr 1fr 1fr 80px'
  // Committed = subcontracts split by budget_allocations + approved sub COs (same
  // code as commercial), summed over the lines so the card matches the rows.
  const committedTotal = committedTotalForLines(contracts, subCOs, budgetItems)
  const unlinked = unlinkedContracts(contracts)
  // Approved direct costs only, credits negative (pending / rejected excluded)
  const dcTotal = approvedDcTotal(directCosts)
  const dcOnLines = budgetItems.reduce((a, b) => a + approvedDcTotal(directCosts, b.id), 0)
  const approvedBillingTotal = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)
  const funding = ownerDrawFunding(ownerDraws)
  const fundedPct = pctFunded(funding, revisedContractTotal)
  // Owner/lender draws are office money (supers get 403 and never load them): every owner-draw
  // summary line, attention item and action is gated on the same check as the tab, so a super
  // isn't shown "$0 / no draws yet" or a button that can't open anything.
  const showOwnerDraws = canUseOwnerDraws(userRole)
  const unknownFundedShown = showOwnerDraws ? funding.unknownFunded : 0
  const lastDraw = [...ownerDraws].filter(d => d.status !== 'void').sort((a, b) => Number(b.draw_number || 0) - Number(a.draw_number || 0))[0] || null
  const pendingCosts = directCosts.filter(c => c.status === 'pending')
  const pendingPrimeCOs = changeOrders.filter(c => c.status === 'pending')
  const pendingSubCOs = subCOs.filter(c => c.status === 'pending')
  const pendingBillings = billingSubmissions.filter(b => b.status === 'pending')
  const openPunch = punchList.filter(p => p.status !== 'approved')
  const upcomingInspections = inspections.filter(i => (i.result || 'pending') === 'pending').sort((a, b) => String(a.scheduled_date || '9999').localeCompare(String(b.scheduled_date || '9999')))
  const billingAlloc = allocateJobBillings({
    contracts,
    sovLines: billingLines.filter(l => l.subcontract_sov_lines?.subcontract_id).map(l => ({ id: l.sov_line_id, subcontract_id: l.subcontract_sov_lines.subcontract_id })),
    submissions: billingSubmissions,
    billingLines,
  })
  const canPM = atLeastPM(userRole)
  // Office staff (Owner / admin / PM / APM). Supers use this page for field tabs only.
  const isOffice = ['principal', 'admin', 'pm', 'apm'].includes(userRole)
  const isOwnerRole = isPrincipal(userRole)
  const statusNorm = job.status === 'on-hold' ? 'on_hold' : job.status
  const NAV_GROUPS = [
    {
      group: 'Project',
      items: [
        { key: 'overview', label: 'Overview' },
        { key: 'details', label: 'Details' },
        { key: 'contacts', label: 'Contacts' },
        { key: 'documents', label: 'Documents' },
        { key: 'photos', label: 'Photos' },
        { key: 'schedule', label: 'Schedule' },
      ],
    },
    {
      group: 'Financials',
      items: [
        ...(!hideBudget ? [{ key: 'budget', label: 'Budget' }] : []),
        { key: 'costs', label: 'Direct Costs', badge: pendingCosts.length || null, alert: pendingCosts.length > 0 },
        { key: 'subs', label: 'Subs' },
        { key: 'po', label: 'Purchase Orders', badge: purchaseOrders.filter(p => p.status === 'issued').length || null },
        { key: 'changeorders', label: 'Change Orders', badge: (pendingPrimeCOs.length + pendingSubCOs.length) || null, alert: (pendingPrimeCOs.length + pendingSubCOs.length) > 0 },
        { key: 'billing', label: 'Sub Billing', badge: pendingBillings.length || null, alert: pendingBillings.length > 0 },
        ...(canUseOwnerDraws(userRole) ? [{ key: 'ownerdraw', label: 'Owner Draw' }] : []),
        { key: 'lienWaivers', label: 'Lien Waivers' },
      ],
    },
    {
      group: 'Field',
      items: [
        { key: 'field', label: 'Field' },
        { key: 'inspections', label: 'Inspections', badge: upcomingInspections.length || null },
        { key: 'punchlist', label: 'Punch List', badge: openPunch.length || null, alert: punchList.some(p => p.status === 'open' || p.status === 'sub_complete') },
      ],
    },
  ]
  // A tab hidden for this user (Budget with hide_budget) shows Overview instead.
  const visibleTab = NAV_GROUPS.some(g => g.items.some(i => i.key === activeTab)) ? activeTab : 'overview'

  return (
    <div style={s.page}>
      {/* STICKY HEADER */}
      <header style={s.header} className="rx-safe-top">
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>Residential</div>
            </div>
          </div>
          <button style={{ padding: '7px 16px', background: 'transparent', border: '1px solid #d1d5db', borderRadius: '8px', color: '#6b7280', cursor: 'pointer', fontSize: '13px' }} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>

      <main style={s.main} className="rx-main">
        <button style={s.backBtn} onClick={() => router.push('/dashboard?tab=residential')}>← Back to Residential</button>
        {profileLoadError && <div style={{ ...s.errMsg, marginBottom: '10px' }}>Could not load your profile — please refresh the page.</div>}
        {toast && (
          <div role="status" style={{ background: toast.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${toast.ok ? '#bbf7d0' : '#fecaca'}`, color: toast.ok ? '#15803d' : '#dc2626', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>×</button>
          </div>
        )}
        {Object.keys(loadErrors).length > 0 && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: '8px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', lineHeight: 1.5 }}>
            <strong>Some data didn't load</strong>, so those tabs may look empty: {Object.entries(loadErrors).map(([k, v]) => `${k} (${v})`).join(' · ')}
          </div>
        )}
        <div className="rx-stack-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={s.jobTitle}>#{job.job_number} — {job.project_name}</h1>
            <p style={{ ...s.jobMeta, marginBottom: '6px' }}>
              {job.owner_name ? job.owner_name + ' · ' : ''}
              {job.location ? job.location : ''}
              {job.start_date ? ' · Started ' + fmtDate(job.start_date) : ''}
              {job.permit_number ? ' · Permit ' + job.permit_number : ''}
            </p>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <span style={s.badge(statusNorm === 'complete' ? 'gray' : statusNorm === 'on_hold' ? 'amber' : 'green')}>{statusNorm === 'complete' ? 'COMPLETE' : statusNorm === 'on_hold' ? 'ON HOLD' : 'ACTIVE'}</span>
              {job.archived && <span style={s.badge('gray')}>ARCHIVED</span>}
            </div>
          </div>
          {canPM && !job.archived && (
            statusNorm !== 'complete'
              ? <button style={{ ...s.btnGreen, padding: '9px 16px', textTransform: 'uppercase', letterSpacing: '1px', opacity: completing ? 0.6 : 1 }} disabled={completing} onClick={() => completeJob(true)}>{completing ? 'Working…' : '✓ Complete Job & Report'}</button>
              : <button style={{ ...s.btnSmGray, padding: '9px 16px' }} disabled={completing} onClick={() => completeJob(false)}>{completing ? 'Working…' : 'Generate Report'}</button>
          )}
        </div>

        {/* Header KPIs — Contract is the base; Revised adds approved prime (homeowner) COs only. */}
        <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '1.5rem' }}>
          <div style={s.statCard}><div style={s.statLabel}>Contract (base)</div><div style={s.statValue()}>${fmt(baseContract)}</div></div>
          <div style={s.statCard} title="Base contract + approved homeowner change orders"><div style={s.statLabel}>Revised</div><div style={s.statValue()}>${fmt(revisedContractTotal)}</div><div style={{ fontSize: '11px', color: '#6b7280' }}>{changeOrders.filter(c => c.status === 'approved').length} approved CO{changeOrders.filter(c => c.status === 'approved').length !== 1 ? 's' : ''}</div></div>
          {!hideBudget && <div style={s.statCard} title="Sum of Bank amounts on the budget lines"><div style={s.statLabel}>Bank</div><div style={s.statValue()}>${fmt(bankTotal)}</div></div>}
          {showOwnerDraws && <>
          <div style={s.statCard} title="Owner/lender draws submitted, approved or funded (void and draft excluded)"><div style={s.statLabel}>Requested</div><div style={s.statValue()}>${fmt(funding.requested)}</div></div>
          <div style={s.statCard} title="Cash actually recorded as received on funded draws"><div style={s.statLabel}>Funded</div><div style={s.statValue('#15803d')}>${fmt(funding.fundedKnown)}</div>{funding.unknownFunded > 0 && <div style={{ fontSize: '11px', color: '#92400e' }}>+ {funding.unknownFunded} funded, amount unknown</div>}</div>
          <div style={s.statCard} title="Funded cash ÷ revised contract"><div style={s.statLabel}>% Funded</div><div style={s.statValue()}>{fundedPct === null ? '—' : fundedPct.toFixed(1) + '%'}</div><div style={{ fontSize: '11px', color: '#6b7280' }}>{fundedPct === null ? (funding.unknownFunded > 0 ? 'unknown (legacy draw)' : 'no revised contract') : 'of revised contract'}</div></div>
          </>}
        </div>

        {/* SIDEBAR + CONTENT */}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

          {/* Left sidebar nav */}
          <aside className="rx-sidebar" style={{ width: '180px', flexShrink: 0, position: 'sticky', top: '72px', maxHeight: 'calc(100vh - 92px)', overflowY: 'auto', borderRadius: '12px', padding: '12px', alignSelf: 'flex-start' }}>
            {NAV_GROUPS.map(({ group, items }) => (
              <div key={group} style={{ marginBottom: '20px' }}>
                <div className="rx-sidebar-group">{group}</div>
                {items.map(({ key, label, badge, alert }) => {
                  const active = visibleTab === key
                  return (
                    <button key={key} className={`rx-sidebar-btn${active ? ' rx-active' : ''}`} onClick={() => setActiveTab(key)}>
                      <span>{label}</span>
                      {badge ? <span className={`rx-sidebar-badge${alert ? ' rx-sidebar-badge-alert' : ''}`}>{badge}</span> : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </aside>

          {/* Main content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Mobile nav */}
            <select className="rx-mobile-nav-select" value={visibleTab} onChange={e => setActiveTab(e.target.value)} style={{ width: '100%', padding: '11px 14px', background: '#ffffff', border: '1px solid #d1d5db', borderRadius: '8px', color: '#111827', fontSize: '16px', marginBottom: '1.25rem' }}>
              {NAV_GROUPS.map(({ group, items }) => (
                <optgroup key={group} label={group}>
                  {items.map(({ key, label, badge }) => <option key={key} value={key}>{label}{badge ? ` (${badge})` : ''}</option>)}
                </optgroup>
              ))}
            </select>

      {/* BODY */}
      <div style={s.body}>

        {/* ── OVERVIEW ── */}
        {visibleTab === 'overview' && (
          <>
            <div className="rx-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div style={s.card}>
                <p style={s.cardTitle}>Financial Summary</p>
                {[
                  ['Contract (base)', '$' + fmt(baseContract)],
                  ['Approved homeowner COs', '$' + fmt(approvedCOs)],
                  ['Revised contract', '$' + fmt(revisedContractTotal)],
                  ...(!hideBudget ? [['Bank schedule total', '$' + fmt(bankTotal)], ['Cost budget', '$' + fmt(budgetTotal)]] : []),
                  ['Sub committed (incl. approved sub COs)', '$' + fmt(committedTotal)],
                  ['Approved direct costs (net of credits)', '$' + fmt(dcTotal)],
                  ['Approved sub billing', '$' + fmt(approvedBillingTotal)],
                  ...(showOwnerDraws ? [
                    ['Owner draws requested', '$' + fmt(funding.requested)],
                    ['Owner draws funded (recorded)', '$' + fmt(funding.fundedKnown) + (funding.unknownFunded ? ` + ${funding.unknownFunded} unknown` : '')],
                  ] : []),
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                    <span style={{ color: '#6b7280' }}>{k}</span><span style={{ fontFamily: 'monospace', color: '#111827', whiteSpace: 'nowrap' }}>{v}</span>
                  </div>
                ))}
                {unlinked.length > 0 && <div style={{ marginTop: '8px', fontSize: '12px', color: '#c2410c' }}>⚠ {unlinked.length} subcontract{unlinked.length !== 1 ? 's are' : ' is'} not linked to a budget line and not in Committed.</div>}
              </div>
              <div style={s.card}>
                <p style={s.cardTitle}>Needs Attention</p>
                {[
                  { n: pendingCosts.length, label: 'direct cost(s) waiting for approval', tab: 'costs' },
                  { n: pendingPrimeCOs.length, label: 'homeowner change order(s) pending', tab: 'changeorders' },
                  { n: pendingSubCOs.length, label: 'sub change order(s) pending', tab: 'changeorders' },
                  { n: pendingBillings.length, label: 'sub billing(s) pending', tab: 'billing' },
                  { n: punchList.filter(p => p.status === 'sub_complete').length, label: 'punch item(s) marked done by the sub', tab: 'punchlist' },
                  ...(showOwnerDraws ? [{ n: funding.unknownFunded, label: 'funded draw(s) with no recorded amount', tab: 'ownerdraw' }] : []),
                ].filter(x => x.n > 0).map(x => (
                  <button key={x.label} onClick={() => setActiveTab(x.tab)} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '8px 0', background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer', textAlign: 'left', fontSize: '13px', color: '#111827' }}>
                    <span><strong style={{ color: '#c2410c' }}>{x.n}</strong> {x.label}</span><span style={{ color: '#9ca3af' }}>›</span>
                  </button>
                ))}
                {pendingCosts.length + pendingPrimeCOs.length + pendingSubCOs.length + pendingBillings.length + unknownFundedShown + punchList.filter(p => p.status === 'sub_complete').length === 0 && <div style={{ fontSize: '13px', color: '#15803d' }}>Nothing waiting.</div>}
              </div>
              <div style={s.card}>
                <p style={s.cardTitle}>Upcoming Inspections</p>
                {upcomingInspections.length === 0 ? <div style={{ fontSize: '13px', color: '#9ca3af' }}>None scheduled.</div> : upcomingInspections.slice(0, 5).map(i => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                    <span>{i.inspection_type}</span><span style={{ color: '#6b7280' }}>{fmtDate(i.scheduled_date)}</span>
                  </div>
                ))}
                {job.permit_number && <div style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>Permit {job.permit_number}{job.permit_date ? ' · ' + fmtDate(job.permit_date) : ''}</div>}
              </div>
              <div style={s.card}>
                <p style={s.cardTitle}>{showOwnerDraws ? 'Punch & Last Draw' : 'Punch List'}</p>
                <div style={{ fontSize: '13px', marginBottom: '10px' }}><strong>{openPunch.length}</strong> open punch item{openPunch.length !== 1 ? 's' : ''}{punchList.length ? ` of ${punchList.length}` : ''}</div>
                {showOwnerDraws && (lastDraw ? (
                  <div style={{ fontSize: '13px' }}>
                    Draw #{lastDraw.draw_number} — {lastDraw.title} · ${fmt(lastDraw.amount_requested)} · <span style={s.badge(lastDraw.status === 'funded' ? 'green' : lastDraw.status === 'draft' ? 'gray' : 'orange')}>{lastDraw.status}</span>
                    {lastDraw.status === 'funded' && <div style={{ fontSize: '12px', color: drawFundedAmount(lastDraw) === null ? '#92400e' : '#6b7280', marginTop: '4px' }}>{drawFundedAmount(lastDraw) === null ? 'Funded amount not recorded (legacy)' : `Received $${fmt(lastDraw.amount_funded)}`}</div>}
                  </div>
                ) : <div style={{ fontSize: '13px', color: '#9ca3af' }}>No owner/lender draws yet.</div>)}
              </div>
              <div style={s.card}>
                <p style={s.cardTitle}>Key Contacts</p>
                {job.owner_name && <div style={{ fontSize: '13px', padding: '4px 0' }}><strong>{job.owner_name}</strong> <span style={{ color: '#6b7280' }}>· Homeowner{job.owner_phone ? ' · ' + job.owner_phone : ''}{job.owner_email ? ' · ' + job.owner_email : ''}</span></div>}
                {job.pm_email && <div style={{ fontSize: '13px', padding: '4px 0' }}><strong>PM</strong> <span style={{ color: '#6b7280' }}>· {job.pm_email}</span></div>}
                {contacts.slice(0, 4).map(c => <div key={c.id} style={{ fontSize: '13px', padding: '4px 0' }}><strong>{c.name}</strong> <span style={{ color: '#6b7280' }}>{c.role ? '· ' + c.role : ''}{c.phone ? ' · ' + c.phone : ''}</span></div>)}
                {!job.owner_name && !job.pm_email && contacts.length === 0 && <div style={{ fontSize: '13px', color: '#9ca3af' }}>No contacts yet.</div>}
              </div>
              <div style={s.card}>
                <p style={s.cardTitle}>Quick Actions</p>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button style={s.btnSmGray} onClick={() => { setActiveTab('costs'); setShowDcForm(true) }}>+ Log cost</button>
                  <button style={s.btnSmGray} onClick={() => { setActiveTab('changeorders'); setShowAddCO(true) }}>+ Change order</button>
                  {showOwnerDraws && <button style={s.btnSmGray} onClick={() => { setActiveTab('ownerdraw'); startDrawEdit(null) }}>+ Owner draw</button>}
                  <button style={s.btnSmGray} onClick={() => { setActiveTab('inspections'); setShowAddInspection(true) }}>+ Inspection</button>
                  <button style={s.btnSmGray} onClick={() => { setActiveTab('punchlist'); setShowAddPunch(true) }}>+ Punch item</button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── DETAILS ── */}
        {visibleTab === 'details' && (
          <>
            <div style={s.card}>
              <div className="rx-stack-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Project Details</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {detailsMsg && <span style={detailsMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{detailsMsg}</span>}
                  {editingDetails
                    ? <><button style={s.btn} onClick={saveDetails} disabled={savingDetails}>{savingDetails ? 'Saving...' : 'Save'}</button><button style={s.btnGray} onClick={() => { setEditingDetails(false); setDetailsForm(job); setDetailsMsg('') }}>Cancel</button></>
                    : ['principal', 'pm', 'apm', 'admin'].includes(userRole) && <button style={s.btnSm} onClick={() => { setEditingDetails(true); setDetailsForm({ ...job, status: statusNorm }); loadTeamMembers() }}>Edit</button>}
                </div>
              </div>

              {editingDetails ? (
                <>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Job number</label><input style={s.input} value={detailsForm.job_number || ''} onChange={e => setDetailsForm(f => ({ ...f, job_number: e.target.value }))} /></div>
                    <div><label style={s.label}>Project name</label><input style={s.input} value={detailsForm.project_name || ''} onChange={e => setDetailsForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Property address</label><input style={s.input} value={detailsForm.location || ''} onChange={e => setDetailsForm(f => ({ ...f, location: e.target.value }))} /></div>
                    <div><label style={s.label}>Contract value (base)</label><input style={s.input} type="number" value={detailsForm.contract_value ?? ''} onChange={e => setDetailsForm(f => ({ ...f, contract_value: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Start date</label><input style={s.input} type="date" value={detailsForm.start_date || ''} onChange={e => setDetailsForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                    <div><label style={s.label}>Status</label>
                      <select style={s.select} value={detailsForm.status || 'active'} disabled={!!job.archived && !isOwnerRole} onChange={e => setDetailsForm(f => ({ ...f, status: e.target.value }))}>
                        <option value="active">Active</option>
                        <option value="complete">Complete</option>
                        <option value="on_hold">On Hold</option>
                      </select>
                      {job.archived && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>{isOwnerRole ? 'Archived. Setting Status to Active unarchives it.' : 'Archived. Only an Owner can change its status.'}</div>}
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>PM contact</label>
                      <select style={s.select} value={detailsForm.pm_email || ''} onChange={e => setDetailsForm(f => ({ ...f, pm_email: e.target.value }))}>
                        <option value="">— No PM —</option>
                        {detailsForm.pm_email && !teamMembers.some(m => (m.email || '').toLowerCase() === String(detailsForm.pm_email).toLowerCase()) && <option value={detailsForm.pm_email}>{detailsForm.pm_email}</option>}
                        {teamMembers.filter(m => ['principal', 'pm', 'apm'].includes(m.role) && m.email).map(m => <option key={m.id} value={m.email}>{m.full_name || m.email} ({m.role === 'principal' ? 'OWNER' : m.role.toUpperCase()})</option>)}
                      </select>
                    </div>
                    <div className="rx-grid-2" style={s.grid2}>
                      <div><label style={s.label}>Permit number</label><input style={s.input} value={detailsForm.permit_number || ''} onChange={e => setDetailsForm(f => ({ ...f, permit_number: e.target.value }))} /></div>
                      <div><label style={s.label}>Permit date</label><input style={s.input} type="date" value={detailsForm.permit_date || ''} onChange={e => setDetailsForm(f => ({ ...f, permit_date: e.target.value }))} /></div>
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Notes</label>
                    <textarea style={{ ...s.textarea, minHeight: '60px' }} value={detailsForm.scope_notes || ''} onChange={e => setDetailsForm(f => ({ ...f, scope_notes: e.target.value }))} />
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Owner name</label><input style={s.input} value={detailsForm.owner_name || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
                    <div><label style={s.label}>Owner company / lender</label><input style={s.input} value={detailsForm.owner_company || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_company: e.target.value }))} /></div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div><label style={s.label}>Owner email</label><input style={s.input} type="email" value={detailsForm.owner_email || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
                    <div><label style={s.label}>Owner phone</label><input style={s.input} value={detailsForm.owner_phone || ''} onChange={e => setDetailsForm(f => ({ ...f, owner_phone: e.target.value }))} /></div>
                  </div>
                  <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '4px' }}>
                    <BillingScheduleFields title="Subcontractor billing" prefix="sub" form={detailsForm} setForm={setDetailsForm} />
                    <BillingScheduleFields title="Owner / lender billing" prefix="owner" form={detailsForm} setForm={setDetailsForm} />
                  </div>
                  {detailsMsg.startsWith('Error') && <div style={{ ...s.errMsg, marginTop: '8px' }}>{detailsMsg}</div>}
                </>
              ) : (
                <div className="rx-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  {[
                    ['Job Number', job.job_number],
                    ['Project Name', job.project_name],
                    ['Address', job.location],
                    ['Start Date', job.start_date ? fmtDate(job.start_date) : null],
                    ['Contract (base)', job.contract_value != null ? '$' + fmt(job.contract_value) : null],
                    ['Revised Contract', job.contract_value || approvedCOs ? '$' + fmt(revisedContractTotal) : null],
                    ['PM', job.pm_email],
                    ['Permit', job.permit_number ? job.permit_number + (job.permit_date ? ' · ' + fmtDate(job.permit_date) : '') : null],
                    ['Status', statusNorm === 'on_hold' ? 'On hold' : statusNorm + (job.archived ? ' (archived)' : '')],
                    ['Owner Name', job.owner_name],
                    ['Owner Company / Lender', job.owner_company],
                    ['Owner Email', job.owner_email],
                    ['Owner Phone', job.owner_phone],
                    ['Sub Billing', billingScheduleLabel(job, 'sub')],
                    ['Owner Billing', billingScheduleLabel(job, 'owner')],
                    ['Notes', job.scope_notes],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '3px' }}>{label}</div>
                      <div style={{ fontSize: '14px', color: val ? '#111827' : '#9ca3af', whiteSpace: label === 'Notes' ? 'pre-wrap' : undefined, wordBreak: 'break-word' }}>{val || '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── BUDGET ── */}
        {visibleTab === 'budget' && !hideBudget && (
          <>
            <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
              <div style={s.statCard}><div style={s.statLabel}>Cost Total</div><div style={s.statValue()}>${fmt(budgetTotal)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Bank Total</div><div style={s.statValue()}>${fmt(bankTotal)}</div></div>
              <div style={s.statCard} title="Subcontracts (split by allocation) + approved sub change orders"><div style={s.statLabel}>Sub Committed</div><div style={s.statValue('#1d4ed8')}>${fmt(committedTotal)}</div></div>
              <div style={s.statCard} title="Approved only; returns/credits subtract"><div style={s.statLabel}>Approved Direct Costs</div><div style={s.statValue('#e8590c')}>${fmt(dcTotal)}</div></div>
            </div>

            {unlinked.length > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' }}>
                ⚠ {unlinked.length} subcontract{unlinked.length !== 1 ? 's' : ''} not linked to any budget line and not counted in Committed: {unlinked.map(c => c.vendor_name || 'Unnamed').join(', ')}
              </div>
            )}
            {amountsDiffer(dcTotal, dcOnLines) && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' }}>
                ${fmt(dcTotal - dcOnLines)} of approved direct costs is not on a budget line, so it is in the card total but not in Spent below.
              </div>
            )}

            {(costVsContract || bankVsContract) && (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.5 }}>
                <strong>Budget doesn't match the {hasApprovedCOs ? 'revised ' : ''}contract.</strong>
                {' '}{hasApprovedCOs ? <>Revised contract is ${fmt(budgetCheck.revised)} (base ${fmt(baseContract)} + approved COs ${fmt(approvedCOs)}).</> : <>Contract value is ${fmt(baseContract)}.</>}
                {bankVsContract && <> Bank total is ${fmt(bankTotal)} ({bankTotal - budgetCheck.revised > 0 ? '+' : '−'}${fmt(Math.abs(bankTotal - budgetCheck.revised))}).</>}
                {costVsContract && <> Cost total is ${fmt(budgetTotal)}; expected cost is ${fmt(budgetCheck.expectedCost)} (base + approved COs at Nv cost) ({budgetTotal - budgetCheck.expectedCost > 0 ? '+' : '−'}${fmt(Math.abs(budgetTotal - budgetCheck.expectedCost))}).</>}
                {' '}Set Bank amounts on the lines so the bank SOV adds up to the {hasApprovedCOs ? 'revised ' : ''}contract, or correct the contract value on Details.
                {hasApprovedCOs && <> Note: change orders approved before Nv cost was tracked added their sale price to Cost.</>}
              </div>
            )}

            {budgetError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', whiteSpace: 'pre-wrap', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span>{budgetError}</span>
                <button onClick={() => setBudgetError('')} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: 0 }}>×</button>
              </div>
            )}

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Budget Lines ({budgetItems.length})</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="file" ref={estimateInputRef} accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={parseEstimate} />
                  <button style={s.btnSmGray} onClick={() => { setShowImportEstimate(v => !v); if (showImportEstimate) { setParsedItems([]); setParseMsg('') } }}>
                    {showImportEstimate ? 'Cancel Import' : '↑ Import Estimate'}
                  </button>
                  <button style={s.btnSm} onClick={() => setShowAddBudget(v => !v)}>{showAddBudget ? 'Cancel' : '+ Add Line'}</button>
                </div>
              </div>

              {showImportEstimate && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  {parsedItems.length === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-start' }}>
                      <p style={{ margin: 0, fontSize: '13px', color: '#6b7280', lineHeight: '1.5' }}>
                        Upload your PDF estimate sheet and AI will extract all line items for you to review before importing.
                      </p>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button style={s.btn} onClick={() => estimateInputRef.current?.click()} disabled={parsingEstimate}>
                          {parsingEstimate ? 'Parsing…' : 'Upload Estimate PDF'}
                        </button>
                        {parseMsg && <span style={parseMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{parseMsg}</span>}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ fontSize: '13px', color: '#6b7280' }}>{selectedImportIds.size} of {parsedItems.length} selected</span>
                          <button style={s.btnSmGray} onClick={() => setSelectedImportIds(new Set(parsedItems.map((_, i) => i)))}>All</button>
                          <button style={s.btnSmGray} onClick={() => setSelectedImportIds(new Set())}>None</button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {parseMsg && <span style={s.successMsg}>{parseMsg.split('—')[0]}</span>}
                          <button style={s.btn} onClick={importSelectedItems} disabled={importingItems || selectedImportIds.size === 0}>
                            {importingItems ? 'Importing…' : `Import ${selectedImportIds.size} Line${selectedImportIds.size !== 1 ? 's' : ''}`}
                          </button>
                          <button style={s.btnGray} onClick={() => { setParsedItems([]); setSelectedImportIds(new Set()); setParseMsg(''); estimateInputRef.current && (estimateInputRef.current.value = '') }}>Re-upload</button>
                        </div>
                      </div>
                      <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#f9fafb' }}>
                          {['', 'Description', 'Section', 'Amount'].map(h => <div key={h} style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                        </div>
                        {parsedItems.map((item, i) => (
                          <label key={i} style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center', cursor: 'pointer' }}>
                            <input type="checkbox" checked={selectedImportIds.has(i)} onChange={e => {
                              setSelectedImportIds(prev => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(i); else next.delete(i)
                                return next
                              })
                            }} />
                            <span style={{ fontSize: '13px', color: '#111827' }}>{item.description}</span>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>{item.section || '—'}</span>
                            <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(item.amount)}</span>
                          </label>
                        ))}
                        <div style={{ display: 'grid', gridTemplateColumns: '28px 3fr 1fr 1fr', gap: '10px', padding: '10px 0', marginTop: '4px', borderTop: '1px solid #e5e7eb' }}>
                          <span />
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase' }}>Selected total</span>
                          <span />
                          <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>
                            ${fmt(parsedItems.filter((_, i) => selectedImportIds.has(i)).reduce((a, x) => a + Number(x.amount || 0), 0))}
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {showAddBudget && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '10px' }}>
                    <div><label style={s.label}>Description *</label><input style={s.input} placeholder="Framing, Electrical..." value={newBudget.description} onChange={e => setNewBudget(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
                    <div><label style={s.label}>Cost *</label><input style={s.input} type="number" placeholder="0.00" value={newBudget.budget_amount} onChange={e => setNewBudget(f => ({ ...f, budget_amount: e.target.value }))} /></div>
                    <div><label style={s.label}>Bank</label><input style={s.input} type="number" placeholder="Same as Cost" value={newBudget.owner_amount} onChange={e => setNewBudget(f => ({ ...f, owner_amount: e.target.value }))} /></div>
                    <div><label style={s.label}>Cost Code</label><input style={s.input} placeholder="03-000 (optional)" value={newBudget.cost_code} onChange={e => setNewBudget(f => ({ ...f, cost_code: e.target.value }))} /></div>
                  </div>
                  <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>Cost is the internal budget. Bank is the owner/lender SOV amount; leave it blank to use the Cost amount.</div>
                  <button style={s.btn} onClick={addBudgetItem} disabled={addingBudget || !newBudget.description || newBudget.budget_amount === ''}>{addingBudget ? 'Adding...' : 'Add Budget Line'}</button>
                </div>
              )}

              {budgetItems.length === 0 ? (
                <div style={s.emptyMsg}>No budget lines yet.</div>
              ) : (
                <>
                  <div style={{ overflowX: 'auto' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: BUDGET_COLS, gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #e5e7eb', minWidth: '800px' }}>
                    {['Description', 'Code', 'Cost', 'Bank', 'Committed', 'Spent', 'Variance', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                  </div>
                  {budgetItems.map(item => {
                    const committed = contractCommittedForItem(contracts, subCOs, item.id)
                    const spent = approvedDcTotal(directCosts, item.id)
                    const budgeted = Number(item.budget_amount || 0)
                    const variance = budgeted - committed - spent
                    const over = variance < 0
                    return editingBudgetId === item.id ? (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: BUDGET_COLS, gap: '10px', padding: '8px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'center', minWidth: '800px' }}>
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} type="number" title="Cost" value={editBudgetForm.budget_amount ?? ''} onChange={e => setEditBudgetForm(f => ({ ...f, budget_amount: e.target.value }))} />
                        <input style={{ ...s.input, fontSize: '12px' }} type="number" title="Bank (blank = same as Cost)" placeholder="= Cost" value={editBudgetForm.owner_amount ?? ''} onChange={e => setEditBudgetForm(f => ({ ...f, owner_amount: e.target.value }))} />
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: '#1d4ed8' }}>${fmt(committed)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: '#e8590c' }}>${fmt(spent)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: over ? '#dc2626' : '#15803d' }}>{over ? '-' : ''}${fmt(Math.abs(variance))}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnGreen} onClick={() => saveBudgetEdit(item.id)}>Save</button>
                          <button style={s.btnSmGray} onClick={() => setEditingBudgetId(null)}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div key={item.id} style={{ display: 'grid', gridTemplateColumns: BUDGET_COLS, gap: '10px', padding: '10px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'center', minWidth: '800px', background: over ? '#fef2f2' : 'transparent' }}>
                        <span style={{ fontSize: '13px', color: '#111827' }}>{item.description}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{item.cost_code || '—'}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(item.budget_amount)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: item.owner_amount == null ? '#9ca3af' : '#111827' }} title={item.owner_amount == null ? 'Same as Cost' : undefined}>${fmt(bankAmount(item))}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: committed > 0 ? '#1d4ed8' : '#9ca3af' }}>${fmt(committed)}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', color: spent > 0 ? '#e8590c' : spent < 0 ? '#dc2626' : '#9ca3af' }}>{spent < 0 ? '−' : ''}${fmt(Math.abs(spent))}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: '700', color: over ? '#dc2626' : variance < budgeted * 0.1 ? '#f59e0b' : '#15803d' }}>
                          {over ? '-' : ''}${fmt(Math.abs(variance))}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmGray} onClick={() => { setEditingBudgetId(item.id); setEditBudgetForm(item) }}>Edit</button>
                          <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deleteBudgetItem(item.id)}>×</button>
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ display: 'grid', gridTemplateColumns: BUDGET_COLS, gap: '10px', padding: '10px 0', marginTop: '4px', borderTop: '1px solid #d1d5db', minWidth: '800px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280', textTransform: 'uppercase' }}>Total</span>
                    <span />
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(budgetTotal)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(bankTotal)}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#1d4ed8' }}>${fmt(committedTotal)}</span>
                    {(() => { const spentTotal = dcOnLines; const v = budgetTotal - committedTotal - spentTotal; return (<>
                      <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#e8590c' }}>${fmt(spentTotal)}</span>
                      <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: v < 0 ? '#dc2626' : '#15803d' }}>{v < 0 ? '-' : ''}${fmt(Math.abs(v))}</span>
                    </>) })()}
                    <span />
                  </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* ── COSTS ── */}
        {visibleTab === 'costs' && (() => {
          const approvedExpenses = directCosts.filter(c => c.status === 'approved' && !c.is_credit).reduce((a, c) => a + Number(c.amount || 0), 0)
          const approvedCredits = directCosts.filter(c => c.status === 'approved' && c.is_credit).reduce((a, c) => a + Number(c.amount || 0), 0)
          const approvedTotal = approvedExpenses - approvedCredits
          const pendingCount = directCosts.filter(c => c.status === 'pending').length
          const q = dcSearch.toLowerCase().trim()
          const visible = directCosts.filter(c => {
            if (dcStatusFilter !== 'all' && c.status !== dcStatusFilter) return false
            if (dcTypeFilter === 'credits' && !c.is_credit) return false
            if (dcTypeFilter === 'expenses' && c.is_credit) return false
            if (!q) return true
            return c.description?.toLowerCase().includes(q) || c.notes?.toLowerCase().includes(q) || String(c.amount).includes(dcSearch.trim())
          })
          return (
            <>
              <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: `repeat(${approvedCredits > 0 ? 4 : 3}, 1fr)`, gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Net Approved</div><div style={s.statValue('#15803d')}>${fmt(approvedTotal)}</div></div>
                {approvedCredits > 0 && <div style={s.statCard}><div style={s.statLabel}>Credits Applied</div><div style={s.statValue('#dc2626')}>−${fmt(approvedCredits)}</div></div>}
                <div style={s.statCard}><div style={s.statLabel}>Pending Approval</div><div style={s.statValue(pendingCount > 0 ? '#e8590c' : undefined)}>{pendingCount}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Total Entries</div><div style={s.statValue()}>{directCosts.length}</div></div>
              </div>

              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Direct Costs ({directCosts.length})</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {directCosts.filter(c => c.status === 'pending' && c.budget_item_id).length > 0 && (
                      <button style={s.btnGreen} disabled={approvingAll} onClick={approveAllAssigned}>
                        {approvingAll ? 'Approving…' : `Approve All Assigned (${directCosts.filter(c => c.status === 'pending' && c.budget_item_id).length})`}
                      </button>
                    )}
                    {directCosts.length > 0 && <button style={s.btnSmGray} onClick={exportDCsCSV}>Export CSV</button>}
                    <button style={s.btnSm} onClick={() => setShowDcForm(v => !v)}>{showDcForm ? 'Cancel' : '+ Log Cost'}</button>
                  </div>
                </div>

                {showDcForm && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <form onSubmit={submitDC}>
                      <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Date *</label>
                          <input type="date" style={s.input} required value={dcForm.cost_date} onChange={e => setDcForm(f => ({ ...f, cost_date: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Category *</label>
                          <select style={s.select} required value={dcForm.category} onChange={e => setDcForm(f => ({ ...f, category: e.target.value }))}>
                            {['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Meals/Entertainment', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={s.label}>Amount ($) *</label>
                          <input type="number" step="0.01" min="0" style={s.input} required placeholder="0.00" value={dcForm.amount} onChange={e => setDcForm(f => ({ ...f, amount: e.target.value }))} />
                        </div>
                      </div>
                      <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Description *</label>
                          <input style={s.input} required placeholder="Lumber delivery, Concrete pour..." value={dcForm.description} onChange={e => setDcForm(f => ({ ...f, description: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Budget Line</label>
                          <select style={s.select} value={dcForm.budget_item_id} onChange={e => setDcForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                            <option value="">— Unassigned —</option>
                            {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '12px' }}>
                        <div>
                          <label style={s.label}>Notes</label>
                          <input style={s.input} placeholder="Optional notes..." value={dcForm.notes} onChange={e => setDcForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Receipt (PDF / photo)</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, padding: '8px 12px' }} onChange={e => setDcFile(e.target.files?.[0] || null)} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                          <input type="checkbox" checked={dcForm.is_credit} onChange={e => setDcForm(f => ({ ...f, is_credit: e.target.checked }))} />
                          <span style={{ fontSize: '13px', color: '#dc2626', fontWeight: '600' }}>This is a return / credit (reduces job cost total)</span>
                        </label>
                      </div>
                      <button type="submit" style={s.btn} disabled={submittingDc}>{submittingDc ? 'Saving…' : 'Save Cost'}</button>
                    </form>
                  </div>
                )}

                {/* Status filter */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {[['all', 'All', directCosts.length], ['pending', 'Pending', pendingCount], ['approved', 'Approved', directCosts.filter(c => c.status === 'approved').length], ['rejected', 'Rejected', directCosts.filter(c => c.status === 'rejected').length]].map(([k, label, count]) => (
                    <button key={k} onClick={() => setDcStatusFilter(k)} style={{ padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${dcStatusFilter === k ? '#e8590c' : '#d1d5db'}`, background: dcStatusFilter === k ? '#fff7ed' : 'transparent', color: dcStatusFilter === k ? '#e8590c' : '#6b7280' }}>
                      {label} ({count})
                    </button>
                  ))}
                  <input style={{ ...s.input, width: '180px', padding: '4px 10px', fontSize: '12px', marginLeft: 'auto' }} placeholder="Search..." value={dcSearch} onChange={e => setDcSearch(e.target.value)} />
                </div>
                {/* Type filter */}
                <div style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
                  {[['all', 'All types', directCosts.length], ['expenses', 'Expenses only', directCosts.filter(c => !c.is_credit).length], ['credits', 'Returns / Credits', directCosts.filter(c => c.is_credit).length]].map(([k, label, count]) => (
                    <button key={k} onClick={() => setDcTypeFilter(k)} style={{ padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${dcTypeFilter === k ? (k === 'credits' ? '#dc2626' : '#4b5563') : '#d1d5db'}`, background: dcTypeFilter === k ? (k === 'credits' ? '#fef2f2' : '#f3f4f6') : 'transparent', color: dcTypeFilter === k ? (k === 'credits' ? '#dc2626' : '#374151') : '#6b7280' }}>
                      {label} ({count})
                    </button>
                  ))}
                </div>

                {visible.length === 0 ? (
                  <div style={s.emptyMsg}>{directCosts.length === 0 ? 'No direct costs logged yet.' : 'No costs match the current filter.'}</div>
                ) : (
                  visible.map(c => {
                    const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                    const isRejecting = rejectingCostId === c.id
                    return (
                      <div key={c.id} style={{ border: `1px solid ${c.is_credit ? '#fecdd3' : c.status === 'approved' ? '#bbf7d0' : c.status === 'rejected' ? '#fecaca' : '#e5e7eb'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>{c.description}</span>
                              <span style={s.badge('gray')}>{c.category}</span>
                              <span style={s.badge(c.status === 'approved' ? 'green' : c.status === 'rejected' ? 'red' : 'orange')}>{c.status}</span>
                              {c.is_credit && <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>Return / Credit</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>
                              {c.cost_date ? new Date(c.cost_date + 'T12:00:00').toLocaleDateString() : ''}
                              {budgetLine && ` · ${budgetLine.description}`}
                              {c.notes && ` · ${c.notes}`}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '16px', fontWeight: '800', fontFamily: 'monospace', color: c.is_credit ? '#dc2626' : undefined }}>{c.is_credit ? '−' : ''}${fmt(c.amount)}</span>
                            {c.receipt_url && (
                              <button style={s.btnSmGray} onClick={() => openDCReceipt(c.receipt_url)}>Receipt</button>
                            )}
                            {dcBilledLockReason(c) && <span title={dcBilledLockReason(c)} style={{ fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>🔒 Billed</span>}
                            <button style={{ ...s.btnSmGray, ...(dcBilledLockReason(c) ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }} disabled={!!dcBilledLockReason(c)} title={dcBilledLockReason(c) || undefined} onClick={() => { setEditingCostId(editingCostId === c.id ? null : c.id); setEditCostForm({ cost_date: c.cost_date || '', description: c.description || '', category: c.category || 'Materials', amount: c.amount || '', notes: c.notes || '', budget_item_id: c.budget_item_id || '' }) }}>Edit</button>
                            {!c.budget_item_id && (
                              <select style={{ ...s.select, width: '160px', fontSize: '12px', padding: '4px 8px' }} defaultValue="" onChange={e => assignDCBudgetItem(c.id, e.target.value)}>
                                <option value="">Assign budget line</option>
                                {budgetItems.map(b => <option key={b.id} value={b.id}>{b.description}</option>)}
                              </select>
                            )}
                            {c.status === 'pending' && (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                {!c.receipt_url && <span style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700' }}>No receipt</span>}
                                <button style={s.btnGreen} disabled={updatingCostId === c.id} onClick={() => {
                                  if (!c.budget_item_id) { alert('Assign a budget line before approving.'); return }
                                  if (!c.receipt_url && !window.confirm('This cost has no receipt attached. Approve without one?')) return
                                  approveCost(c.id)
                                }}>{c.receipt_url ? 'Approve' : 'Approve Anyway'}</button>
                                <button style={s.btnRed} onClick={() => setRejectingCostId(isRejecting ? null : c.id)}>{isRejecting ? 'Cancel' : 'Reject'}</button>
                              </div>
                            )}
                            {c.status === 'approved' && atLeastPM(profile?.role) && (
                              <button style={{ ...s.btnSmGray, color: '#dc2626', ...(dcBilledLockReason(c) ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }} disabled={updatingCostId === c.id || !!dcBilledLockReason(c)} title={dcBilledLockReason(c) || undefined} onClick={() => unapproveCost(c.id)}>Unapprove</button>
                            )}
                            {c.status === 'rejected' && ['principal', 'pm', 'apm', 'admin'].includes(profile?.role) && (
                              <button style={{ ...s.btnSmGray, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', ...(dcBilledLockReason(c) ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }} disabled={updatingCostId === c.id || !!dcBilledLockReason(c)} title={dcBilledLockReason(c) || undefined} onClick={() => unrejectCost(c.id)}>
                                {updatingCostId === c.id ? '...' : 'Undo reject'}
                              </button>
                            )}
                            {atLeastPM(profile?.role) && (
                              <button style={{ ...s.btnSmGray, color: '#dc2626', ...(dcBilledLockReason(c) ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }} disabled={updatingCostId === c.id || !!dcBilledLockReason(c)} title={dcBilledLockReason(c) || undefined} onClick={() => { if (confirm('Delete this cost?')) deleteCost(c.id) }}>Delete</button>
                            )}
                          </div>
                        </div>
                        {isRejecting && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input style={{ ...s.input, flex: 1, fontSize: '12px' }} placeholder="Rejection reason (required)" value={costRejectNote} onChange={e => setCostRejectNote(e.target.value)} autoFocus />
                            <button style={s.btnRed} disabled={updatingCostId === c.id || !costRejectNote.trim()} onClick={() => rejectCost(c.id)}>Confirm Reject</button>
                          </div>
                        )}
                        {editingCostId === c.id && (
                          <div style={{ marginTop: '12px', padding: '14px', background: '#f9fafb', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
                            <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                              <div><label style={s.label}>Date</label><input type="date" style={s.input} value={editCostForm.cost_date} onChange={e => setEditCostForm(f => ({ ...f, cost_date: e.target.value }))} /></div>
                              <div><label style={s.label}>Category</label><select style={s.select} value={editCostForm.category} onChange={e => setEditCostForm(f => ({ ...f, category: e.target.value }))}>{['Materials','Labor','Equipment','Subcontractor','Permits','Fees','Meals/Entertainment','Other'].map(cat => <option key={cat} value={cat}>{cat}</option>)}</select></div>
                              <div><label style={s.label}>Amount ($)</label><input type="number" step="0.01" min="0" style={s.input} value={editCostForm.amount} onChange={e => setEditCostForm(f => ({ ...f, amount: e.target.value }))} /></div>
                            </div>
                            <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '10px' }}>
                              <div><label style={s.label}>Description</label><input style={s.input} value={editCostForm.description} onChange={e => setEditCostForm(f => ({ ...f, description: e.target.value }))} /></div>
                              <div><label style={s.label}>Budget Line</label><select style={s.select} value={editCostForm.budget_item_id} onChange={e => setEditCostForm(f => ({ ...f, budget_item_id: e.target.value }))}><option value="">— Unassigned —</option>{budgetItems.map(b => <option key={b.id} value={b.id}>{b.description}</option>)}</select></div>
                            </div>
                            <div className="rx-grid-2" style={{ ...s.grid2 }}>
                              <div><label style={s.label}>Notes</label><input style={s.input} value={editCostForm.notes} onChange={e => setEditCostForm(f => ({ ...f, notes: e.target.value }))} /></div>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                                <button style={s.btn} onClick={saveEditedCost} disabled={savingEditCost}>{savingEditCost ? 'Saving…' : 'Save Changes'}</button>
                                <button style={s.btnSmGray} onClick={() => setEditingCostId(null)}>Cancel</button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )
        })()}

        {/* ── SUBS ── companies + contracts on this job (shared subcontracts / job assignments) */}
        {visibleTab === 'subs' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Subcontractors ({contracts.length})</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {subMsg && !showAddSubForm && <span style={subMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{subMsg}</span>}
                {canPM && <button style={s.btnSm} onClick={() => { setShowAddSubForm(v => !v); setSubMsg('') }}>{showAddSubForm ? 'Cancel' : '+ Add Sub'}</button>}
              </div>
            </div>

            {showAddSubForm && (
              <form onSubmit={addSub} style={{ ...s.inlineForm, marginBottom: '16px' }}>
                {subDirectory.length > 0 && (
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Pick from sub directory</label>
                    <select style={s.select} value={newSubForm.dir_id} onChange={e => setNewSubForm(f => ({ ...f, dir_id: e.target.value, company_name: '', trade: '' }))}>
                      <option value="">— Select company —</option>
                      {subDirectory.map(d => (
                        <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!newSubForm.dir_id && (
                  <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '12px' }}>
                    <div><label style={s.label}>Company Name *</label><input style={s.input} value={newSubForm.company_name} onChange={e => setNewSubForm(f => ({ ...f, company_name: e.target.value }))} placeholder="ABC Framing..." /></div>
                    <div><label style={s.label}>Trade / Scope</label><input style={s.input} value={newSubForm.trade} onChange={e => setNewSubForm(f => ({ ...f, trade: e.target.value }))} placeholder="Framing, Electrical..." /></div>
                  </div>
                )}
                <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '12px' }}>
                  <div>
                    <label style={s.label}>Contract Value ($)</label>
                    <input style={s.input} type="number" step="0.01" min="0" placeholder="0.00" value={newSubForm.contract_value} onChange={e => setNewSubForm(f => ({ ...f, contract_value: e.target.value }))} />
                  </div>
                  <div>
                    <label style={s.label}>Assign to Budget Line</label>
                    <select style={s.select} value={newSubForm.budget_item_id} onChange={e => setNewSubForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                      <option value="">— Unassigned —</option>
                      {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button type="submit" style={s.btn} disabled={addingSub}>{addingSub ? 'Adding…' : 'Add Subcontractor'}</button>
                  {subMsg && <span style={subMsg.startsWith('Error') ? s.errMsg : s.successMsg}>{subMsg}</span>}
                </div>
              </form>
            )}

            {unlinked.length > 0 && <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px' }}>⚠ Not linked to a budget line (not in Committed): {unlinked.map(c => c.vendor_name || 'Unnamed').join(', ')}</div>}
            {contracts.length === 0 ? (
              <div style={s.emptyMsg}>No subcontractors yet. Add a sub to get started.</div>
            ) : contracts.map(c => {
              const isEditing = editingSubId === c.id
              const signed = isSubcontractSigned(c)
              const cos = subCOs.filter(co => co.subcontract_id === c.id)
              const approvedCo = cos.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
              const revisedValue = contractRevisedValue(c, subCOs)
              const alloc = billingAlloc.byContract[c.id] || { billedApproved: 0, retainageApproved: 0, submissions: [] }
              const billed = alloc.billedApproved
              const pctBilled = revisedValue > 0 ? (billed / revisedValue) * 100 : null
              const lines = (c.budget_allocations && c.budget_allocations.length)
                ? c.budget_allocations.map(a => `${budgetItems.find(b => b.id === a.budget_item_id)?.description || 'Unknown line'} $${fmt(a.amount)}`)
                : (c.budget_item_id ? [budgetItems.find(b => b.id === c.budget_item_id)?.description || 'Unknown line'] : [])
              const dir = subDirectory.find(d => sameCompany(d.company_name, c.vendor_name))
              const coi = !dir ? null : !dir.coi_url ? { t: 'COI missing', c: 'red' } : dir.coi_expiration && isBeforeTodayCentral(dir.coi_expiration) ? { t: `COI expired ${fmtDate(dir.coi_expiration)}`, c: 'red' } : { t: dir.coi_expiration ? `COI to ${fmtDate(dir.coi_expiration)}` : 'COI on file', c: 'green' }
              const subBillings = alloc.submissions.map(x => x.submission)
              const waiversSigned = subBillings.filter(b => b.lien_waiver_signed_at).length
              const waiversOut = subBillings.filter(b => b.status === 'approved' && !b.lien_waiver_signed_at).length
              const sov = contractSov[c.id] || []
              return (
                <div key={c.id} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px 14px', marginBottom: '10px' }}>
                  {isEditing ? (
                    <div className="rx-grid-2" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '10px', alignItems: 'center' }}>
                      <input style={{ ...s.input, fontSize: '12px' }} value={editSubForm.vendor_name || ''} onChange={e => setEditSubForm(f => ({ ...f, vendor_name: e.target.value }))} />
                      <input style={{ ...s.input, fontSize: '12px' }} placeholder="Trade / scope" value={editSubForm.description || ''} onChange={e => setEditSubForm(f => ({ ...f, description: e.target.value }))} />
                      <select style={{ ...s.select, fontSize: '12px' }} value={editSubForm.budget_item_id || ''} disabled={!!(c.budget_allocations && c.budget_allocations.length)} title={c.budget_allocations?.length ? 'Split across several lines (budget_allocations)' : undefined} onChange={e => setEditSubForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                        <option value="">— None —</option>
                        {budgetItems.map(b => <option key={b.id} value={b.id}>{b.description}</option>)}
                      </select>
                      <input style={{ ...s.input, fontSize: '12px' }} type="number" disabled={signed} title={signed ? 'Signed contract: amount is locked' : undefined} value={editSubForm.contract_value ?? ''} onChange={e => setEditSubForm(f => ({ ...f, contract_value: e.target.value }))} />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button style={s.btnGreen} onClick={() => saveSubEdit(c.id)}>Save</button>
                        <button style={s.btnSmGray} onClick={() => setEditingSubId(null)}>×</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#111827' }}>{c.vendor_name || '—'}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>{c.description || '—'}{lines.length ? ' · ' + lines.join(', ') : ' · no budget line'}</div>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                            <span style={s.badge(signed ? 'green' : 'gray')}>{signed ? 'SIGNED' : (c.status || 'unsigned').toUpperCase()}</span>
                            {coi && <span style={s.badge(coi.c)}>{coi.t}</span>}
                            {waiversSigned > 0 && <span style={s.badge('green')}>{waiversSigned} waiver{waiversSigned !== 1 ? 's' : ''} signed</span>}
                            {waiversOut > 0 && <span style={s.badge('amber')}>{waiversOut} waiver{waiversOut !== 1 ? 's' : ''} outstanding</span>}
                            {c.generated_contract_path && <span style={s.badge('blue')}>Contract generated</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {c.company_id && <button style={s.btnSmGray} onClick={() => setOpenCompanyId(openCompanyId === c.id ? null : c.id)}>{openCompanyId === c.id ? 'Hide people' : 'People & access'}</button>}
                          {canPM && <button style={s.btnSmGray} onClick={() => { setEditingSubId(c.id); setEditSubForm(c) }}>Edit</button>}
                          {canPM && <button style={{ ...s.btnSmGray, color: '#dc2626', ...(signed ? { opacity: 0.45, cursor: 'not-allowed' } : {}) }} disabled={signed} title={signed ? 'Signed contracts can’t be removed' : 'Remove (refused if anything was billed or signed)'} onClick={() => deleteSubcontract(c.id)}>Remove</button>}
                        </div>
                      </div>
                      <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px', marginTop: '10px' }}>
                        {[
                          ['Contract', '$' + fmt(c.contract_value)],
                          ['Approved COs', '$' + fmt(approvedCo)],
                          ['Revised', '$' + fmt(revisedValue)],
                          ['Billed (approved)', '$' + fmt(billed)],
                          ['% Billed', pctBilled === null ? '—' : pctBilled.toFixed(0) + '%'],
                          ['Remaining', '$' + fmt(revisedValue - billed)],
                          ['Retainage', (c.retainage_pct != null ? c.retainage_pct + '% · ' : '') + '$' + fmt(alloc.retainageApproved) + ' held'],
                        ].map(([k, v]) => (
                          <div key={k} style={{ background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: '6px', padding: '6px 8px' }}>
                            <div style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{k}</div>
                            <div style={{ fontSize: '13px', fontFamily: 'monospace', color: k === 'Remaining' && revisedValue - billed < 0 ? '#dc2626' : '#111827' }}>{v}</div>
                          </div>
                        ))}
                      </div>
                      {(sov.length > 0 || cos.length > 0) && (
                        <details style={{ marginTop: '8px' }}>
                          <summary style={{ fontSize: '12px', color: '#374151', cursor: 'pointer' }}>{sov.length} SOV line{sov.length !== 1 ? 's' : ''} · {cos.length} sub CO{cos.length !== 1 ? 's' : ''}</summary>
                          <div className="rx-scroll-x" style={{ marginTop: '6px' }}>
                            {sov.map(l => <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #f3f4f6', minWidth: '320px' }}><span>{l.description}</span><span style={{ fontFamily: 'monospace' }}>${fmt(l.scheduled_value)}</span></div>)}
                            {cos.map(co => <div key={co.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12px', padding: '4px 0', borderBottom: '1px solid #f3f4f6', minWidth: '320px' }}><span>{coNumberLabel(co, 'sub')} · {co.description || '—'} · {co.status}</span><span style={{ fontFamily: 'monospace' }}>${fmt(co.amount)}</span></div>)}
                          </div>
                        </details>
                      )}
                      {openCompanyId === c.id && c.company_id && (
                        <div style={{ marginTop: '10px' }}>
                          <CompanyPeoplePanel companyId={c.company_id} companyName={c.vendor_name} jobId={id} jobLabel={job?.project_name} onChanged={loadContracts} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            {contracts.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0', borderTop: '1px solid #e5e7eb', marginTop: '4px' }}>
                <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>Committed: ${fmt(committedTotal)}</span>
              </div>
            )}
          </div>
        )}

        {/* ── CHANGE ORDERS ── */}
        {/* PURCHASE ORDERS (same route + shared forms as commercial) */}
        {visibleTab === 'po' && (() => {
          const PO_BADGE = { draft: 'gray', issued: 'amber', received: 'green', closed: 'blue' }
          const poFmt = n => '$' + fmt(n)
          const issuedPOs = purchaseOrders.filter(p => p.status === 'issued')
          const receivedPOs = purchaseOrders.filter(p => p.status === 'received')
          const totalCommitted = [...issuedPOs, ...receivedPOs].reduce((a, p) => a + Number(p.amount || 0), 0)
          return (
            <>
              <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Total POs</div><div style={s.statValue()}>{purchaseOrders.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Issued (open)</div><div style={s.statValue(issuedPOs.length > 0 ? '#d97706' : undefined)}>{issuedPOs.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Received</div><div style={s.statValue('#15803d')}>{receivedPOs.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Total committed</div><div style={s.statValue('#e8590c')}>{poFmt(totalCommitted)}</div></div>
              </div>

              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showNewPO ? '16px' : 0 }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Purchase Orders</p>
                  <button style={s.btnSmallOrange} onClick={() => { setShowNewPO(v => !v); setEditingPOId(null) }}>{showNewPO ? 'Cancel' : '+ New PO'}</button>
                </div>
                {showNewPO && (
                  <NewPOForm s={s} poForm={poForm} setPOForm={setPOForm} poFile={poFile} setPOFile={setPOFile} budgetItems={budgetItems} savingPO={savingPO} savePO={savePO} />
                )}
              </div>

              <div style={s.card}>
                {poLoadError && <div style={{ ...s.errMsg, marginBottom: '10px' }}>Purchase orders could not load — refresh to try again.</div>}
                {!poLoadError && purchaseOrders.length === 0 && <p style={{ color: '#6b7280', fontSize: '13px', margin: 0 }}>No purchase orders yet. Click "+ New PO" to create one.</p>}
                {purchaseOrders.map(po => {
                  const isExpanded = expandedPOId === po.id
                  const bi = budgetItems.find(b => b.id === po.budget_item_id)
                  const dr = po.draw_request_id ? drawRequests.find(d => d.id === po.draw_request_id) : null
                  const items = po.purchase_order_items || []
                  const busy = updatingPOId === po.id
                  if (editingPOId === po.id) {
                    return (
                      <div key={po.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <EditPOForm s={s} fmt={poFmt} po={po} editPOForm={editPOForm} setEditPOForm={setEditPOForm} editPOFile={editPOFile} setEditPOFile={setEditPOFile} budgetItems={budgetItems} savingPOEdit={savingPOEdit} savePOEdit={savePOEdit} setEditingPOId={setEditingPOId} />
                      </div>
                    )
                  }
                  return (
                    <div key={po.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', cursor: 'pointer', gap: '10px' }} onClick={() => setExpandedPOId(isExpanded ? null : po.id)}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>{po.vendor_name}</span>
                            <span style={{ fontSize: '11px', fontWeight: '700', color: '#6b7280' }}>{po.po_number}</span>
                            {po.description && <span style={{ fontSize: '12px', color: '#6b7280' }}>{po.description}</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
                            <span style={{ ...s.badge(PO_BADGE[po.status] || 'gray'), textTransform: 'uppercase' }}>{po.status}</span>
                            <span style={s.badge(po.payment_type === 'reimbursement' ? 'blue' : 'gray')}>{po.payment_type === 'reimbursement' ? 'Reimbursement' : 'Check to vendor'}</span>
                            {bi ? <span style={{ fontSize: '11px', color: '#6b7280' }}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</span> : <span style={{ fontSize: '11px', color: '#9ca3af' }}>No budget line</span>}
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>{items.length} item{items.length !== 1 ? 's' : ''}</span>
                            {dr && <span style={s.badge('blue')}>Draw #{dr.draw_number}{dr.title ? ` — ${dr.title}` : ''}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                          <span style={{ fontSize: '15px', fontWeight: '800', color: '#111827' }}>{poFmt(po.amount)}</span>
                          <span style={{ color: '#6b7280', fontSize: '14px' }}>{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ paddingBottom: '14px' }}>
                          {po.notes && <p style={{ fontSize: '13px', color: '#4b5563', marginBottom: '10px', lineHeight: 1.5 }}>{po.notes}</p>}
                          {po.attachment_url && <button style={{ ...s.btnSmGray, marginBottom: '10px' }} onClick={() => openPOAttachment(po.attachment_url)}>View Attachment</button>}
                          {items.length > 0 && (
                            <div style={{ border: '1px solid #e5e7eb', borderRadius: '6px', overflowX: 'auto' }}>
                              {items.map((i, idx) => (
                                <div key={i.id || idx} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 2fr) 50px 50px 90px 90px', gap: '0 8px', padding: '8px 12px', borderTop: idx ? '1px solid #f3f4f6' : 'none', fontSize: '13px', color: '#374151' }}>
                                  <span>{i.description}</span>
                                  <span style={{ textAlign: 'right', color: '#6b7280' }}>{Number(i.qty)}</span>
                                  <span style={{ color: '#6b7280' }}>{i.unit || '—'}</span>
                                  <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{poFmt(i.unit_price)}</span>
                                  <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: '600' }}>{poFmt(i.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {po.status === 'draft' && <>
                              <button style={{ ...s.btnSmallGreen, opacity: (busy || !po.attachment_url) ? 0.6 : 1 }} disabled={busy || !po.attachment_url} title={!po.attachment_url ? 'Attach a document before issuing' : ''} onClick={() => updatePOStatus(po.id, 'issued')}>Issue PO</button>
                              {!po.attachment_url && <span style={{ fontSize: '12px', color: '#6b7280' }}>Attachment required to issue</span>}
                              <button style={s.btnSmall} onClick={() => startPOEdit(po)}>Edit</button>
                              <button style={s.btnSmallRed} onClick={() => deletePO(po.id)}>Delete</button>
                            </>}
                            {po.status === 'issued' && <>
                              <button style={{ ...s.btnSmallGreen, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => updatePOStatus(po.id, 'received')}>Mark Received</button>
                              <button style={s.btnSmall} onClick={() => startPOEdit(po)}>Edit</button>
                              <button style={{ ...s.btnSmallRed, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => updatePOStatus(po.id, 'closed')}>Cancel PO</button>
                            </>}
                            {po.status === 'received' && <>
                              <button style={{ ...s.btnSmall, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => updatePOStatus(po.id, 'closed')}>Close PO</button>
                              <button style={s.btnSmall} onClick={() => { if (!window.confirm(RECEIVED_EDIT_WARNING)) return; startPOEdit(po) }}>Edit</button>
                            </>}
                            {po.status === 'closed' && <span style={{ fontSize: '12px', color: '#6b7280' }}>{CLOSED_LOCKED_MESSAGE}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )
        })()}

        {visibleTab === 'changeorders' && (
          <>
            <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={s.statCard}><div style={s.statLabel}>Pending COs</div><div style={s.statValue('#e8590c')}>{changeOrders.filter(c => c.status === 'pending').length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved COs</div><div style={s.statValue('#15803d')}>${fmt(approvedCOs)}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Revised Contract</div><div style={s.statValue()}>${fmt(revisedContractTotal)}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Homeowner Change Orders ({changeOrders.length})</p>
                {canPM && <button style={s.btnSm} onClick={() => setShowAddCO(v => !v)}>{showAddCO ? 'Cancel' : '+ Add CO'}</button>}
              </div>

              {showAddCO && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '10px' }}>
                    <div><label style={s.label}>Description *</label><input style={s.input} placeholder="Additional scope..." value={newCO.description} onChange={e => setNewCO(f => ({ ...f, description: e.target.value }))} autoFocus /></div>
                    <div><label style={s.label}>Amount (sale price to homeowner) *</label><input style={s.input} type="number" placeholder="0.00" value={newCO.amount} onChange={e => setNewCO(f => ({ ...f, amount: e.target.value }))} /></div>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={s.label}>Nv cost (optional)</label>
                    <input style={s.input} type="number" placeholder={newCO.amount ? `Blank = ${newCO.amount} (the sale price)` : 'Blank = the sale price'} value={newCO.nv_cost} onChange={e => setNewCO(f => ({ ...f, nv_cost: e.target.value }))} />
                    <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>What this change costs Nv. On approval the Cost budget moves by this and Bank by the sale price. If left blank, Nv cost = the sale price.</div>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={s.label}>Budget Line (required to approve)</label>
                    <select style={s.select} value={newCO.budget_item_id} onChange={e => setNewCO(f => ({ ...f, budget_item_id: e.target.value }))}>
                      <option value="">— Pick later —</option>
                      {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                    </select>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={s.label}>Notes</label>
                    <textarea style={{ ...s.textarea, minHeight: '60px' }} value={newCO.notes} onChange={e => setNewCO(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes..." />
                  </div>
                  {coMsg && <div style={s.errMsg}>{coMsg}</div>}
                  <button style={s.btn} onClick={addCO} disabled={addingCO || !newCO.description || !newCO.amount}>{addingCO ? 'Saving...' : 'Submit CO'}</button>
                </div>
              )}

              {changeOrders.length === 0 ? (
                <div style={s.emptyMsg}>No change orders yet.</div>
              ) : (
                changeOrders.map(co => {
                  const lines = coBudgetDeltas(co).map(d => budgetItems.find(b => b.id === d.budget_item_id)).filter(Boolean)
                  const needsLine = co.status === 'pending' && lines.length === 0
                  const busy = reviewingCOId === co.id || inPreview
                  return (
                  <div key={co.id} style={{ padding: '14px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}><span style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', marginRight: '8px' }}>{coNumberLabel(co, 'prime')}</span>{co.description}</div>
                        {co.notes && <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>{co.notes}</div>}
                        <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                          {co.created_at ? new Date(co.created_at).toLocaleDateString() : ''}
                          {lines.length > 0 && ` · Budget line: ${lines.map(b => b.description).join(', ')}`}
                          {co.status === 'approved' && (co.budget_applied ? ' · Applied to budget' : ' · Not applied to budget')}
                          {co.nv_cost !== null && co.nv_cost !== undefined && co.nv_cost !== '' && ` · Nv cost $${fmt(co.nv_cost)}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '16px', fontWeight: '700', fontFamily: 'monospace', color: Number(co.amount) >= 0 ? '#15803d' : '#dc2626' }}>
                          {Number(co.amount) >= 0 ? '+' : ''}${fmt(co.amount)}
                        </span>
                        <span style={s.badge(statusColor[co.status] || 'gray')}>{co.status}</span>
                        <button style={s.btnSmGray} title="Printable change order with homeowner and contractor signature lines" onClick={() => printCO(co)}>Print CO</button>
                      </div>
                    </div>
                    {co.status === 'pending' && atLeastPM(profile?.role) && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {needsLine && (
                          <select style={{ ...s.select, width: '220px', fontSize: '12px', padding: '5px 8px' }} value={coLinePick[co.id] || ''} onChange={e => setCoLinePick(p => ({ ...p, [co.id]: e.target.value }))}>
                            <option value="">Pick budget line to approve</option>
                            {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                          </select>
                        )}
                        <button style={s.btnGreen} disabled={busy || (needsLine && !coLinePick[co.id])} onClick={() => approveCO(co)}>{reviewingCOId === co.id ? '…' : 'Approve'}</button>
                        <button style={s.btnRed} disabled={busy} onClick={() => rejectCO(co)}>Reject</button>
                      </div>
                    )}
                    {co.status === 'approved' && co.budget_applied && atLeastPM(profile?.role) && (
                      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                        <button style={{ ...s.btnSmGray, color: '#dc2626' }} disabled={busy} onClick={() => rejectCO(co)}>{reviewingCOId === co.id ? '…' : 'Reject & reverse budget'}</button>
                      </div>
                    )}
                  </div>
                  )
                })
              )}
            </div>

            <div style={s.card}>
              <p style={s.cardTitle}>Sub Change Orders ({subCOs.length})</p>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '10px' }}>From subcontractors (sub portal or office). Approved ones add to that sub's committed cost; they do not change the homeowner contract.</div>
              {subCOs.length === 0 ? <div style={s.emptyMsg}>No sub change orders.</div> : subCOs.map(co => (
                <div key={co.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#111827' }}><span style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', marginRight: '8px' }}>{coNumberLabel(co, 'sub')}</span>{co.description || '—'}</div>
                    <div style={{ fontSize: '12px', color: '#6b7280' }}>{co.subcontracts?.vendor_name || '—'}{co.created_at ? ' · ' + new Date(co.created_at).toLocaleDateString() : ''}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(co.amount)}</span>
                    <span style={s.badge(statusColor[co.status] || 'gray')}>{co.status}</span>
                    {co.status === 'pending' && canPM && <>
                      <button style={s.btnGreen} disabled={reviewingSubCOId === co.id} onClick={() => reviewSubCO(co, 'approved')}>Approve</button>
                      <button style={s.btnRed} disabled={reviewingSubCOId === co.id} onClick={() => reviewSubCO(co, 'rejected')}>Reject</button>
                    </>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── BILLING ── */}
        {visibleTab === 'billing' && (
          <>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '20px' }}>
              {[['submissions', 'Sub Billing'], ['draws', 'Draw Requests']].map(([id2, label]) => (
                <button key={id2} onClick={() => setBillingBillingTab(id2)} style={{ padding: '7px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${billingBilling === id2 ? '#e8590c' : '#d1d5db'}`, background: billingBilling === id2 ? '#fff7ed' : '#fff', color: billingBilling === id2 ? '#e8590c' : '#6b7280' }}>{label}</button>
              ))}
            </div>

            {billingBilling === 'submissions' && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Sub Billing Submissions ({billingSubmissions.length})</p>
                  <button style={s.btnSm} onClick={() => { setShowBillingForm(v => !v); setBillingMsg('') }}>{showBillingForm ? 'Cancel' : '+ New Submission'}</button>
                </div>

                {showBillingForm && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div className="rx-grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Subcontractor</label>
                        <select style={s.select} value={billingForm._contract_id} onChange={e => {
                          const c = contracts.find(x => x.id === e.target.value)
                          // Retainage defaults to the contract's rate (still editable per billing)
                          setBillingForm(f => ({ ...f, _contract_id: e.target.value, sub_id: c?.sub_id || '', company_name: c?.vendor_name || f.company_name, retainage_pct: c?.retainage_pct != null ? String(c.retainage_pct) : f.retainage_pct }))
                        }}>
                          <option value="">— Select or enter below —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                        {!billingForm._contract_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Company name" value={billingForm.company_name} onChange={e => setBillingForm(f => ({ ...f, company_name: e.target.value }))} />}
                      </div>
                      <div>
                        <label style={s.label}>Billing Period</label>
                        <input type="month" style={s.input} value={billingForm.billing_period} onChange={e => setBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Amount Billed *</label>
                        <input type="number" step="0.01" style={s.input} placeholder="0.00" value={billingForm.amount_billed} onChange={e => setBillingForm(f => ({ ...f, amount_billed: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Retainage %</label>
                        <input type="number" step="0.1" style={s.input} placeholder="10" value={billingForm.retainage_pct} onChange={e => setBillingForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <label style={s.label}>Work Description</label>
                        <input style={s.input} placeholder="Framing, rough plumbing, drywall..." value={billingForm.work_description} onChange={e => setBillingForm(f => ({ ...f, work_description: e.target.value }))} />
                      </div>
                    </div>
                    {billingMsg && <div style={{ ...s.errMsg, marginBottom: '8px' }}>{billingMsg}</div>}
                    <button style={s.btn} onClick={submitBilling} disabled={addingBilling || !billingForm.amount_billed || (!billingForm._contract_id && !billingForm.company_name)}>
                      {addingBilling ? 'Submitting...' : 'Add Submission'}
                    </button>
                  </div>
                )}

                {billingSubmissions.length === 0 ? (
                  <div style={s.emptyMsg}>No billing submissions yet.</div>
                ) : (
                  billingSubmissions.map(b => {
                    const period = b.billing_period ? new Date(b.billing_period + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''
                    return (
                      <div key={b.id} style={{ padding: '12px 0', borderBottom: '1px solid #e5e7eb' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>{b.company_name}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>{period}{b.work_description ? ' · ' + b.work_description : ''}</div>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                              {b.lien_waiver_signed_at
                                ? <span style={s.badge('green')}>WAIVER SIGNED</span>
                                : b.status === 'approved' && b.lien_waiver_sent_at ? <span style={s.badge('amber')}>WAIVER SENT</span>
                                : b.status === 'approved' ? <span style={s.badge('gray')}>NO WAIVER YET</span> : null}
                              {b.lien_waiver_received && <span style={s.badge('green')}>WAIVER RECEIVED</span>}
                              {b.paid_at && <span style={s.badge('blue')}>PAID {new Date(b.paid_at).toLocaleDateString()}</span>}
                              {!b.paid_at && billingPaymentSummary(b).partial && <span style={s.badge('amber')}>PARTIAL ${billingPaymentSummary(b).paid.toLocaleString()} · ${billingPaymentSummary(b).remaining.toLocaleString()} left</span>}
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace' }}>${fmt(b.amount_billed)}</div>
                              {b.retainage_held ? <div style={{ fontSize: '11px', color: '#6b7280' }}>-${fmt(b.retainage_held)} ret.</div> : null}
                            </div>
                            <span style={s.badge(statusColor[b.status] || 'gray')}>{b.status}</span>
                            {atLeastPM(profile?.role) && b.status === 'pending' && (<>
                              <button onClick={() => updateBillingStatus(b.id, 'approved')} style={s.btnGreen}>Approve</button>
                              <button onClick={() => updateBillingStatus(b.id, 'rejected')} style={s.btnRed}>Reject</button>
                            </>)}
                            {b.doc_url && <button style={s.btnSmGray} title="Open the sub's invoice" onClick={() => openStorageFile(supabase, 'billing-docs', b.doc_url, 3600).then(u => { if (!u) alert('Could not open the invoice.') })}>📎 Invoice</button>}
                            {b.lien_waiver_signed_at && <button style={s.btnSmGray} onClick={() => viewBillingWaiver(b)}>View Waiver</button>}
                            {canPM && !billingDeleteBlock(b) && <button title="Delete this billing" onClick={() => deleteBilling(b.id)} style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '0 2px' }}>×</button>}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>Approved billing total</span>
                  <span style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'monospace', color: '#15803d' }}>${fmt(approvedBillingTotal)}</span>
                </div>
              </div>
            )}

            {billingBilling === 'draws' && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Draw Requests ({drawRequests.length})</p>
                  <button style={s.btnSm} onClick={() => setShowCreateDraw(v => !v)}>{showCreateDraw ? 'Cancel' : '+ New Draw'}</button>
                </div>

                {showCreateDraw && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={s.label}>Draw title (optional)</label>
                      <input style={s.input} placeholder={`Draw Request ${drawRequests.length + 1}`} value={drawForm.title} onChange={e => setDrawForm(f => ({ ...f, title: e.target.value }))} autoFocus />
                    </div>
                    <button style={s.btn} onClick={createDraw} disabled={creatingDraw}>{creatingDraw ? 'Creating...' : 'Create Draw'}</button>
                  </div>
                )}

                {drawRequests.length === 0 ? (
                  <div style={s.emptyMsg}>No draw requests yet.</div>
                ) : (
                  drawRequests.map(dr => {
                    const drCosts = directCosts.filter(c => c.draw_request_id === dr.id)
                    const drBillings = billingSubmissions.filter(b => b.draw_request_id === dr.id)
                    const drTotal = packagedDrawTotal(dr.id, directCosts, billingSubmissions)
                    const ownerDraw = dr.draw_number != null ? ownerDraws.find(d => d.draw_number === dr.draw_number) : null
                    const ownerMismatch = ownerDraw && amountsDiffer(ownerDraw.amount_requested, drTotal)
                    const isExpanded = expandedDrawId === dr.id
                    const undrawnCosts = directCosts.filter(c => !c.draw_request_id && !c.drawn_application_id)
                    // Only approved billings may be added (billing-entry refuses others too).
                    const undrawnBillings = billingSubmissions.filter(b => !b.draw_request_id && b.status === 'approved')
                    const drAwaiting = drawAwaitingBillings(dr.id, billingSubmissions)
                    return (
                      <div key={dr.id} style={{ marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', cursor: 'pointer' }} onClick={() => setExpandedDrawId(isExpanded ? null : dr.id)}>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#111827' }}>{dr.title}</div>
                            <div style={{ fontSize: '12px', color: '#6b7280' }}>{drCosts.length} costs · {drBillings.length - drAwaiting.length} billings · ${fmt(drTotal)}{drAwaiting.length > 0 && <span style={{ color: '#92400e' }}> · {drAwaiting.length} awaiting approval (${fmt(drAwaiting.reduce((a, b) => a + Number(b.amount_billed || 0), 0))}, not in total)</span>}</div>
                            {ownerDraw && (
                              <div style={{ fontSize: '12px', color: ownerMismatch ? '#92400e' : '#6b7280', marginTop: '2px' }}>
                                Owner/Lender Draw #{ownerDraw.draw_number} · ${fmt(ownerDraw.amount_requested)} · {ownerDraw.status}
                                {ownerMismatch && <> — ⚠ differs from packaged total by ${fmt(Math.abs(Number(ownerDraw.amount_requested || 0) - drTotal))}</>}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <span style={s.badge(dr.status === 'open' ? 'orange' : 'gray')}>{dr.status}</span>
                            <button style={s.btnSmGray} onClick={e => { e.stopPropagation(); printDraw(dr) }}>Download</button>
                            {atLeastPM(profile?.role) && (
                              <>
                                {dr.status === 'open'
                                  ? <button style={s.btnSmGray} onClick={e => { e.stopPropagation(); updateDrawStatus(dr.id, 'closed') }}>Close</button>
                                  : <button style={s.btnSmGray} onClick={e => { e.stopPropagation(); updateDrawStatus(dr.id, 'open') }}>Reopen</button>}
                                <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={e => { e.stopPropagation(); deleteDraw(dr.id) }}>Delete</button>
                              </>
                            )}
                            <span style={{ color: '#6b7280' }}>{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div style={{ padding: '0 14px 14px', borderTop: '1px solid #e5e7eb' }}>
                            <p style={{ ...s.cardTitle, marginTop: '12px' }}>Direct Costs</p>
                            {drCosts.length === 0 ? <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '10px' }}>No costs added to this draw.</div> : drCosts.map(c => (
                              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                                <span style={{ fontSize: '13px', color: '#6b7280' }}>{c.description}</span>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(c.amount)}</span>
                                  {dr.status === 'open' && <button style={{ ...s.btnSmGray, fontSize: '11px' }} onClick={() => removeCostFromDraw(c.id)}>Remove</button>}
                                </div>
                              </div>
                            ))}

                            {dr.status === 'open' && undrawnCosts.length > 0 && (
                              <>
                                <p style={{ ...s.cardTitle, marginTop: '14px' }}>Add direct costs</p>
                                {undrawnCosts.map(c => (
                                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={drawAddCostIds.includes(c.id)} onChange={e => setDrawAddCostIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(x => x !== c.id))} />
                                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{c.description}</span>
                                    <span style={{ fontSize: '13px', fontFamily: 'monospace', marginLeft: 'auto' }}>${fmt(c.amount)}</span>
                                  </label>
                                ))}
                                <button style={{ ...s.btnGreen, marginTop: '10px' }} onClick={() => saveDrawCosts(dr.id)} disabled={savingDrawCosts || drawAddCostIds.length === 0}>
                                  {savingDrawCosts ? 'Saving...' : `Add ${drawAddCostIds.length} cost${drawAddCostIds.length !== 1 ? 's' : ''}`}
                                </button>
                              </>
                            )}

                            <p style={{ ...s.cardTitle, marginTop: '16px' }}>Sub Billings</p>
                            {drBillings.length === 0 ? <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '10px' }}>No sub billings added to this draw.</div> : drBillings.map(b => (
                              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
                                <div>
                                  <span style={{ fontSize: '13px', color: '#6b7280' }}>{b.company_name}</span>
                                  {b.work_description ? <span style={{ fontSize: '11px', color: '#9ca3af', marginLeft: '8px' }}>{b.work_description}</span> : null}
                                </div>
                                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>${fmt(b.amount_billed)}</span>
                                  <span style={s.badge(statusColor[b.status] || 'gray')}>{b.status === 'pending' ? 'awaiting approval' : b.status}</span>
                                  {dr.status === 'open' && <button style={{ ...s.btnSmGray, fontSize: '11px' }} onClick={() => removeBillingFromDraw(b.id)}>Remove</button>}
                                </div>
                              </div>
                            ))}

                            {dr.status === 'open' && undrawnBillings.length > 0 && (
                              <>
                                <p style={{ ...s.cardTitle, marginTop: '14px' }}>Add sub billings</p>
                                {undrawnBillings.map(b => (
                                  <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 0', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={drawAddBillingIds.includes(b.id)} onChange={e => setDrawAddBillingIds(ids => e.target.checked ? [...ids, b.id] : ids.filter(x => x !== b.id))} />
                                    <span style={{ fontSize: '13px', color: '#6b7280' }}>{b.company_name}</span>
                                    {b.work_description ? <span style={{ fontSize: '11px', color: '#6b7280' }}>{b.work_description}</span> : null}
                                    <span style={{ fontSize: '13px', fontFamily: 'monospace', marginLeft: 'auto' }}>${fmt(b.amount_billed)}</span>
                                  </label>
                                ))}
                                <button style={{ ...s.btnGreen, marginTop: '10px' }} onClick={() => saveDrawBillings(dr.id)} disabled={savingDrawBillings || drawAddBillingIds.length === 0}>
                                  {savingDrawBillings ? 'Saving...' : `Add ${drawAddBillingIds.length} billing${drawAddBillingIds.length !== 1 ? 's' : ''}`}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </>
        )}

        {/* ── SCHEDULE ── */}
        {visibleTab === 'schedule' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Milestones ({milestones.length})</p>
              <button style={s.btnSm} onClick={() => setShowAddMilestone(v => !v)}>{showAddMilestone ? 'Cancel' : '+ Add Milestone'}</button>
            </div>

            {showAddMilestone && (
              <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Milestone *</label><input style={s.input} placeholder="Demo complete, Framing..." value={newMilestone.title} onChange={e => setNewMilestone(f => ({ ...f, title: e.target.value }))} autoFocus /></div>
                  <div><label style={s.label}>Due date</label><input style={s.input} type="date" value={newMilestone.due_date} onChange={e => setNewMilestone(f => ({ ...f, due_date: e.target.value }))} /></div>
                  <div><label style={s.label}>Status</label>
                    <select style={s.select} value={newMilestone.status} onChange={e => setNewMilestone(f => ({ ...f, status: e.target.value }))}>
                      <option value="pending">Pending</option>
                      <option value="complete">Complete</option>
                      <option value="delayed">Delayed</option>
                    </select>
                  </div>
                </div>
                <button style={s.btn} onClick={addMilestone} disabled={addingMilestone || !newMilestone.title}>{addingMilestone ? 'Adding...' : 'Add Milestone'}</button>
              </div>
            )}

            {milestones.length === 0 ? (
              <div style={s.emptyMsg}>No milestones yet. Add project milestones to track schedule.</div>
            ) : (
              <div className="rx-scroll-x">
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 100px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #e5e7eb', minWidth: '560px' }}>
                  {['Milestone', 'Due date', 'Completed', 'Status', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {milestones.map(m => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 100px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'center', minWidth: '560px' }}>
                    <span style={{ fontSize: '13px', color: '#111827' }}>{m.title}</span>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{fmtDate(m.due_date)}</span>
                    <span style={{ fontSize: '12px', color: m.completed_date ? '#15803d' : '#9ca3af' }}>{fmtDate(m.completed_date)}</span>
                    <span style={s.badge(milestoneColor[m.status || 'pending'] || 'gray')}>{m.status || 'pending'}</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {m.status !== 'complete' && <button style={s.btnGreen} onClick={() => updateMilestoneStatus(m.id, 'complete')}>Complete</button>}
                      {m.status === 'complete' && <button style={s.btnSmGray} onClick={() => updateMilestoneStatus(m.id, 'pending')}>Reset</button>}
                      <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deleteMilestone(m.id)}>×</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PHOTOS ── shared job_photos + daily report photos (private bucket, signed links) */}
        {visibleTab === 'photos' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Photos ({photos.length})</p>
              <div>
                <input type="file" ref={photoInputRef} accept="image/*" style={{ display: 'none' }} onChange={uploadPhoto} />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginRight: '10px', fontSize: '12px', color: '#4b5563', cursor: 'pointer' }} title="Internal only photos are hidden from the owner portal">
                  <input type="checkbox" checked={photoInternalDraft} onChange={e => setPhotoInternalDraft(e.target.checked)} />
                  Internal only
                </label>
                <button style={s.btnSm} onClick={() => photoInputRef.current?.click()} disabled={uploadingPhoto}>{uploadingPhoto ? 'Uploading...' : '+ Upload Photo'}</button>
              </div>
            </div>
            {photoMsg && <div style={{ ...(photoMsg.startsWith('Error') ? s.errMsg : s.successMsg), marginBottom: '10px' }}>{photoMsg}</div>}
            {photos.length === 0 ? (
              <div style={s.emptyMsg}>No photos yet. Photos from the field app and daily reports show here too.</div>
            ) : (
              <div className="rx-grid-photos" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
                {photos.map((p, i) => {
                  const thumb = photoUrls[p.path.replace(/\.jpg$/i, '_thumb.jpg')] || photoUrls[p.path]
                  return (
                    <button key={p.key} onClick={() => setLightbox(i)} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #e5e7eb', padding: 0, background: '#f9fafb', cursor: 'pointer', textAlign: 'left' }}>
                      {thumb ? <img src={thumb} alt={p.caption || p.name || 'Photo'} loading="lazy" style={{ width: '100%', height: '130px', objectFit: 'cover', display: 'block' }} /> : <div style={{ height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#9ca3af' }}>Unavailable</div>}
                      <div style={{ padding: '6px 8px', fontSize: '11px', color: '#6b7280' }}>{p.internal_only && <span title="Hidden from the owner portal" style={{ background: '#111827', color: '#fde68a', fontSize: '9px', fontWeight: '800', textTransform: 'uppercase', padding: '1px 5px', borderRadius: '3px', marginRight: '4px' }}>Internal</span>}{p.date ? fmtDate(p.date) : ''}{p.fromReport ? ' · Daily report' : ''}{p.caption ? ' · ' + p.caption : ''}</div>
                    </button>
                  )
                })}
              </div>
            )}
            {lightbox !== null && photos[lightbox] && (() => {
              const p = photos[lightbox]
              return (
                <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
                  <div onClick={e => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '80vh' }}>
                    {photoUrls[p.path] ? <img src={photoUrls[p.path]} alt={p.caption || 'Photo'} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }} /> : <div style={{ color: '#fff' }}>Photo unavailable</div>}
                  </div>
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <button style={s.btnSmGray} disabled={lightbox === 0} onClick={() => setLightbox(lightbox - 1)}>‹ Prev</button>
                    <span style={{ color: '#e5e7eb', fontSize: '12px' }}>{lightbox + 1} / {photos.length}{p.caption ? ' · ' + p.caption : ''}</span>
                    <button style={s.btnSmGray} disabled={lightbox === photos.length - 1} onClick={() => setLightbox(lightbox + 1)}>Next ›</button>
                    {p.internal_only && <span style={{ background: '#111827', color: '#fde68a', fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px' }}>Internal</span>}
                    {canTogglePhoto && <button style={s.btnSmGray} disabled={togglingPhoto === p.path} onClick={() => togglePhotoVisibility(p)}>{togglingPhoto === p.path ? 'Saving…' : p.internal_only ? 'Show to owner' : 'Hide from owner'}</button>}
                    {['principal', 'pm', 'admin'].includes(userRole) && <button style={s.btnRed} disabled={deletingPhoto === p.path} onClick={() => deletePhoto(p)}>{deletingPhoto === p.path ? 'Deleting…' : 'Delete'}</button>}
                    <button style={s.btnSmGray} onClick={() => setLightbox(null)}>Close</button>
                  </div>
                  {photoMsg && <div style={{ color: '#fecaca', fontSize: '13px', marginTop: '8px' }}>{photoMsg}</div>}
                </div>
              )
            })()}
          </div>
        )}

        {/* ── DOCUMENTS ── job_documents (shared with field app / commercial) + read-only legacy */}
        {visibleTab === 'documents' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Documents ({documents.length})</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <select style={{ ...s.select, width: 'auto' }} value={docCategory} onChange={e => setDocCategory(e.target.value)}>
                  {JOB_DOC_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                <input type="file" ref={docInputRef} style={{ display: 'none' }} onChange={uploadDoc} />
                <button style={s.btnSm} onClick={() => docInputRef.current?.click()} disabled={uploadingDoc}>{uploadingDoc ? 'Uploading...' : '+ Upload Doc'}</button>
              </div>
            </div>
            {docMsg && <div style={{ ...(docMsg.startsWith('Error') ? s.errMsg : s.successMsg), marginBottom: '10px' }}>{docMsg}</div>}
            {documents.length === 0 ? (
              <div style={s.emptyMsg}>No documents yet. Upload contracts, permits, or other project docs.</div>
            ) : (
              documents.map(doc => (
                <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#111827', wordBreak: 'break-word' }}>{doc.file_name}</div>
                    <div style={{ fontSize: '11px', color: '#6b7280' }}>{docCategoryLabel(doc.category)}{doc.uploaded_at ? ' · ' + new Date(doc.uploaded_at).toLocaleDateString() : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                    <button onClick={() => openJobDoc(doc.storage_path)} style={{ fontSize: '12px', color: '#e8590c', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>View →</button>
                    {['principal', 'pm', 'apm', 'admin'].includes(userRole) && <button onClick={() => deleteDoc(doc)} style={{ fontSize: '12px', color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Delete</button>}
                  </div>
                </div>
              ))
            )}
            {legacyDocs.length > 0 && (
              <div style={{ marginTop: '18px' }}>
                <p style={{ ...s.cardTitle, marginBottom: '6px' }}>Older documents (read-only)</p>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>Uploaded before documents were shared with the field app. Kept as they are.</div>
                {legacyDocs.map(doc => (
                  <div key={doc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', color: '#111827', wordBreak: 'break-word' }}>{doc.name}</div>
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>{doc.doc_type || 'general'}{doc.created_at ? ' · ' + new Date(doc.created_at).toLocaleDateString() : ''}</div>
                    </div>
                    {doc.url && <button onClick={() => openJobDoc(doc.url)} style={{ fontSize: '12px', color: '#e8590c', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }}>View →</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── INSPECTIONS ── */}
        {visibleTab === 'inspections' && (() => {
          const TYPES = INSPECTION_TYPES
          const resultColor = { pending: 'orange', passed: 'green', failed: 'red', rescheduled: 'blue' }
          return (
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Inspections ({inspections.length})</p>
                <button style={s.btnSm} onClick={() => setShowAddInspection(v => !v)}>{showAddInspection ? 'Cancel' : '+ Add Inspection'}</button>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '14px' }}>
                Permit: {job.permit_number ? <strong style={{ color: '#111827' }}>{job.permit_number}</strong> : 'not set'}{job.permit_date ? ' · issued ' + fmtDate(job.permit_date) : ''}
                {' · '}<button onClick={() => { setActiveTab('details'); setEditingDetails(true); setDetailsForm({ ...job, status: statusNorm }); loadTeamMembers() }} style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', padding: 0, fontSize: '12px', fontWeight: 600 }}>Edit on Details</button>
              </div>
              {inspectionMsg && <div style={{ ...(inspectionMsg.startsWith('Error') ? s.errMsg : s.successMsg), marginBottom: '10px' }}>{inspectionMsg}</div>}
              {showAddInspection && (
                <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                  <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                    <div>
                      <label style={s.label}>Inspection Type *</label>
                      <select style={s.select} value={newInspection.inspection_type} onChange={e => setNewInspection(f => ({ ...f, inspection_type: e.target.value }))}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Scheduled Date</label>
                      <input type="date" style={s.input} value={newInspection.scheduled_date} onChange={e => setNewInspection(f => ({ ...f, scheduled_date: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Inspector Name</label>
                      <input style={s.input} placeholder="City inspector..." value={newInspection.inspector_name} onChange={e => setNewInspection(f => ({ ...f, inspector_name: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ marginBottom: '10px' }}>
                    <label style={s.label}>Notes</label>
                    <input style={s.input} value={newInspection.notes} onChange={e => setNewInspection(f => ({ ...f, notes: e.target.value }))} placeholder="Notes..." />
                  </div>
                  <button style={s.btn} onClick={addInspection} disabled={addingInspection}>{addingInspection ? 'Adding...' : 'Add Inspection'}</button>
                </div>
              )}
              {inspections.length === 0 ? (
                <div style={s.emptyMsg}>No inspections yet. Track each building department inspection here.</div>
              ) : inspections.map(ins => {
                const result = ins.result || 'pending'
                const editing = inspEdit?.id === ins.id ? inspEdit : null
                return (
                  <div key={ins.id} style={{ padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{ins.inspection_type} <span style={s.badge(resultColor[result] || 'gray')}>{result}</span></div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          Scheduled {fmtDate(ins.scheduled_date)}{ins.actual_date ? ` · ${result === 'pending' ? 'Done' : result === 'passed' ? 'Passed' : 'Inspected'} ${fmtDate(ins.actual_date)}` : ''}{ins.inspector_name ? ' · ' + ins.inspector_name : ''}
                        </div>
                        {ins.notes && <div style={{ fontSize: '11px', color: '#6b7280', whiteSpace: 'pre-wrap' }}>{ins.notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        {result === 'pending' && <>
                          <button style={s.btnGreen} onClick={() => setInspEdit({ id: ins.id, mode: 'result', result: 'passed', date: todayCentral() })}>Pass</button>
                          <button style={s.btnRed} onClick={() => setInspEdit({ id: ins.id, mode: 'result', result: 'failed', date: todayCentral() })}>Fail</button>
                          <button style={s.btnSmGray} onClick={() => setInspEdit({ id: ins.id, mode: 'reschedule', date: '' })}>Reschedule</button>
                        </>}
                        {result === 'failed' && <>
                          <button style={s.btnSm} onClick={() => setInspEdit({ id: ins.id, mode: 'reinspect', date: '' })}>Re-inspect</button>
                          <button style={s.btnSmGray} onClick={() => punchFromInspection(ins)}>+ Punch item</button>
                        </>}
                        {result !== 'pending' && <button style={s.btnSmGray} onClick={() => setInspEdit({ id: ins.id, mode: 'result', result, date: ins.actual_date || todayCentral() })}>Edit result</button>}
                        {canPM && <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deleteInspection(ins.id)}>×</button>}
                      </div>
                    </div>
                    {editing && (
                      <div style={{ ...s.inlineForm, marginTop: '8px', marginBottom: 0, display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                        {editing.mode === 'result' && (
                          <div>
                            <label style={s.label}>Result</label>
                            <select style={{ ...s.select, width: 'auto' }} value={editing.result} onChange={e => setInspEdit(x => ({ ...x, result: e.target.value }))}>
                              <option value="passed">Passed</option>
                              <option value="failed">Failed</option>
                              <option value="pending">Pending (not done)</option>
                            </select>
                          </div>
                        )}
                        {!(editing.mode === 'result' && editing.result === 'pending') && (
                          <div>
                            <label style={s.label}>{editing.mode === 'result' ? 'Date inspected' : editing.mode === 'reschedule' ? 'New date' : 'Re-inspection date'}</label>
                            <input type="date" style={{ ...s.input, width: 'auto' }} value={editing.date || ''} onChange={e => setInspEdit(x => ({ ...x, date: e.target.value }))} />
                          </div>
                        )}
                        <button style={s.btn} onClick={() => editing.mode === 'result' ? saveInspectionResult(ins, editing.result, editing.date) : editing.mode === 'reschedule' ? rescheduleInspection(ins, editing.date) : reinspect(ins, editing.date)}>
                          {editing.mode === 'result' ? 'Save result' : editing.mode === 'reschedule' ? 'Reschedule' : 'Add re-inspection'}
                        </button>
                        <button style={s.btnGray} onClick={() => setInspEdit(null)}>Cancel</button>
                        {editing.mode === 'reinspect' && <div style={{ fontSize: '11px', color: '#6b7280', width: '100%' }}>Adds a new pending inspection; this failed one keeps its result.</div>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── LIEN WAIVERS ── e-signed waivers on sub billings first; manual log second */}
        {visibleTab === 'lienWaivers' && (() => {
          const approvedBillings = billingSubmissions.filter(b => b.status === 'approved')
          const signed = approvedBillings.filter(b => b.lien_waiver_signed_at)
          const sentOnly = approvedBillings.filter(b => !b.lien_waiver_signed_at && b.lien_waiver_sent_at)
          const notSent = approvedBillings.filter(b => !b.lien_waiver_signed_at && !b.lien_waiver_sent_at)
          const pendingManual = lienWaivers.filter(w => w.status === 'pending')
          return (
            <>
              <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>E-signed</div><div style={s.statValue('#15803d')}>{signed.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Sent, not signed</div><div style={s.statValue(sentOnly.length ? '#e8590c' : undefined)}>{sentOnly.length}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Manual log pending</div><div style={s.statValue(pendingManual.length ? '#e8590c' : undefined)}>{pendingManual.length}</div></div>
              </div>
              {waiverMsg && <div style={{ ...(waiverMsg.startsWith('Error') ? s.errMsg : s.successMsg), marginBottom: '10px' }}>{waiverMsg}</div>}
              <div style={s.card}>
                <p style={s.cardTitle}>Waivers on approved sub billings</p>
                {approvedBillings.length === 0 ? <div style={s.emptyMsg}>No approved sub billings yet.</div> : [...signed, ...sentOnly, ...notSent].map(b => (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{b.company_name}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>${fmt(b.amount_billed)}{b.billing_period ? ' · ' + new Date(b.billing_period + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''}{b.lien_waiver_signed_at ? ` · signed ${new Date(b.lien_waiver_signed_at).toLocaleDateString()}${b.lien_waiver_signer_name ? ' by ' + b.lien_waiver_signer_name : ''}` : b.lien_waiver_sent_at ? ` · sent ${new Date(b.lien_waiver_sent_at).toLocaleDateString()}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {b.lien_waiver_signed_at ? <span style={s.badge('green')}>E-SIGNED</span> : b.lien_waiver_sent_at ? <span style={s.badge('amber')}>SENT</span> : <span style={s.badge('gray')}>NOT SENT</span>}
                      {b.lien_waiver_received && <span style={s.badge('green')}>RECEIVED</span>}
                      {b.lien_waiver_signed_at && <button style={s.btnSmGray} onClick={() => viewBillingWaiver(b)}>View</button>}
                      {!b.lien_waiver_signed_at && isOffice && (
                        <button style={s.btnSm} disabled={!!sendingWaiverId} onClick={() => sendWaiver(b)}>
                          {sendingWaiverId === b.id ? 'Sending…' : b.lien_waiver_sent_at ? 'Resend' : 'Send waiver'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Manual waiver log ({lienWaivers.length})</p>
                  <button style={s.btnSm} onClick={() => setShowAddWaiver(v => !v)}>{showAddWaiver ? 'Cancel' : '+ Add Waiver'}</button>
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>Paper or emailed waivers you track by hand. These are records only, not e-signatures.</div>
                {showAddWaiver && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Subcontractor *</label>
                        <select style={s.select} value={newWaiver.subcontract_id} onChange={e => {
                          const c = contracts.find(x => x.id === e.target.value)
                          setNewWaiver(f => ({ ...f, subcontract_id: e.target.value, company_name: c?.vendor_name || f.company_name }))
                        }}>
                          <option value="">— Select or type below —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                        {!newWaiver.subcontract_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Company name (if not listed)" value={newWaiver.company_name} onChange={e => setNewWaiver(f => ({ ...f, company_name: e.target.value }))} />}
                      </div>
                      <div>
                        <label style={s.label}>Waiver Type</label>
                        <select style={s.select} value={newWaiver.waiver_type} onChange={e => setNewWaiver(f => ({ ...f, waiver_type: e.target.value }))}>
                          <option value="conditional">Conditional (upon payment)</option>
                          <option value="unconditional">Unconditional (payment received)</option>
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Amount ($)</label>
                        <input type="number" step="0.01" style={s.input} placeholder="0.00" value={newWaiver.amount} onChange={e => setNewWaiver(f => ({ ...f, amount: e.target.value }))} />
                      </div>
                    </div>
                    <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Payment Date</label>
                        <input type="date" style={s.input} value={newWaiver.payment_date} onChange={e => setNewWaiver(f => ({ ...f, payment_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Waiver Received Date</label>
                        <input type="date" style={s.input} value={newWaiver.waiver_date} onChange={e => setNewWaiver(f => ({ ...f, waiver_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Status</label>
                        <select style={s.select} value={newWaiver.status} onChange={e => setNewWaiver(f => ({ ...f, status: e.target.value }))}>
                          <option value="pending">Pending</option>
                          <option value="received">Received</option>
                        </select>
                      </div>
                    </div>
                    <button style={s.btn} onClick={addLienWaiver} disabled={addingWaiver || (!newWaiver.company_name && !newWaiver.subcontract_id)}>{addingWaiver ? 'Adding...' : 'Add Waiver'}</button>
                  </div>
                )}
                {lienWaivers.length === 0 ? (
                  <div style={s.emptyMsg}>No manual waivers logged.</div>
                ) : (
                  <div className="rx-scroll-x">
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #e5e7eb', minWidth: '620px' }}>
                      {['Company', 'Type', 'Amount', 'Paid', 'Received', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                    </div>
                    {lienWaivers.map(w => (
                      <div key={w.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'center', background: w.status === 'pending' ? '#fffbeb' : 'transparent', minWidth: '620px' }}>
                        <span style={{ fontSize: '13px', color: '#111827' }}>{w.company_name} <span style={{ fontSize: '10px', color: '#6b7280' }}>· manual</span></span>
                        <span style={s.badge(w.waiver_type === 'conditional' ? 'blue' : 'green')}>{w.waiver_type === 'conditional' ? 'Conditional' : 'Unconditional'}</span>
                        <span style={{ fontSize: '13px', fontFamily: 'monospace' }}>{w.amount ? '$' + fmt(w.amount) : '—'}</span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{fmtDate(w.payment_date)}</span>
                        <span style={{ fontSize: '12px', color: w.waiver_date ? '#15803d' : '#c2410c' }}>{fmtDate(w.waiver_date)}</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {w.status === 'pending' && <button style={s.btnGreen} onClick={() => updateWaiverStatus(w.id, 'received')}>Received</button>}
                          {canPM && <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deleteWaiver(w.id)}>×</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ── OWNER DRAW ── owner/lender draws against the Bank schedule (writes via /api/res-owner-draws) */}
        {visibleTab === 'ownerdraw' && (() => {
          const drawStatusColor = { draft: 'gray', submitted: 'orange', approved: 'blue', funded: 'green', void: 'red' }
          const packagedAllTotal = drawRequests.reduce((a, dr) => a + packagedDrawTotal(dr.id, directCosts, billingSubmissions), 0)
          const fundedVsPackaged = drawRequests.length > 0 && funding.unknownFunded === 0 && funding.fundedKnown > 0 && amountsDiffer(funding.fundedKnown, packagedAllTotal)
          const editing = drawEdit
          const editingRow = editing?.id ? ownerDraws.find(d => d.id === editing.id) : null
          const editSchedule = editing && !hideBudget ? buildDrawSchedule(budgetItems, priorDrawnByLine(ownerDraws, { excludeId: editing.id, drawNumber: editingRow?.draw_number ?? null }), Object.fromEntries(Object.entries(editing.lines || {}).map(([k, v]) => [k, Number(v) || 0]))) : null
          const linesEntered = editing && Object.values(editing.lines || {}).some(v => v !== '' && v !== null && v !== undefined)
          const linkedPick = editing && !editing.id && editing.link_draw_request_id ? drawRequests.find(d => d.id === editing.link_draw_request_id) : null
          return (
            <>
              {ownerDrawsMigrated === false && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.5 }}>
                  <strong>Database migration 046 is not applied yet.</strong> You can create and edit draft draws (total only), submit and approve them. Bank-line schedules, recording the amount funded, attachments and Void need the migration and will say so instead of saving.
                </div>
              )}
              <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard} title="Submitted, approved and funded draws (draft and void excluded)"><div style={s.statLabel}>Requested</div><div style={s.statValue()}>${fmt(funding.requested)}</div></div>
                <div style={s.statCard} title="Cash recorded as received"><div style={s.statLabel}>Funded (recorded)</div><div style={s.statValue('#15803d')}>${fmt(funding.fundedKnown)}</div>{funding.unknownFunded > 0 && <div style={{ fontSize: '11px', color: '#92400e' }}>{funding.unknownFunded} funded draw{funding.unknownFunded !== 1 ? 's' : ''}: amount unknown</div>}</div>
                <div style={s.statCard} title="Requested minus received, on funded draws whose amount is known"><div style={s.statLabel}>Held back / variance</div><div style={s.statValue(funding.variance > 0 ? '#c2410c' : undefined)}>${fmt(funding.variance)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>% Funded</div><div style={s.statValue()}>{fundedPct === null ? '—' : fundedPct.toFixed(1) + '%'}</div><div style={{ fontSize: '11px', color: '#6b7280' }}>{fundedPct === null ? (funding.unknownFunded ? 'unknown (legacy draw)' : 'no revised contract') : 'of revised $' + fmt(revisedContractTotal)}</div></div>
                <div style={s.statCard} title="Billing → Draw Requests (internal packages)"><div style={s.statLabel}>Packaged Draws</div><div style={s.statValue('#7c3aed')}>${fmt(packagedAllTotal)}</div></div>
              </div>
              {fundedVsPackaged && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', lineHeight: 1.5 }}>
                  <strong>Funded draws don't match packaged Draw Requests.</strong> Recorded funding ${fmt(funding.fundedKnown)}; packaged Draw Requests ${fmt(packagedAllTotal)}.
                </div>
              )}
              {drawMsg && <div style={{ background: drawMsg.startsWith('Error') ? '#fef2f2' : '#f0fdf4', border: `1px solid ${drawMsg.startsWith('Error') ? '#fecaca' : '#bbf7d0'}`, color: drawMsg.startsWith('Error') ? '#dc2626' : '#15803d', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px' }}>{drawMsg}</div>}
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Owner/Lender Draws ({ownerDraws.length})</p>
                  {!editing && <button style={s.btnSm} onClick={() => startDrawEdit(null)}>+ New Draw</button>}
                </div>

                {editing && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <p style={{ ...s.cardTitle, marginBottom: '10px' }}>{editing.id ? `Edit draft Draw #${editingRow?.draw_number ?? ''}` : 'New draw (draft)'}</p>
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: '#374151' }}>
                      For reference — approved sub billing <strong>${fmt(approvedBillingTotal)}</strong> · approved direct costs <strong>${fmt(dcTotal)}</strong>. The owner/lender request is set by you (or the Bank lines below), not copied from internal costs.
                    </div>
                    {!editing.id && drawRequests.length > 0 && (
                      <div style={{ marginBottom: '10px' }}>
                        <label style={s.label}>Use the number of a packaged Draw Request (optional)</label>
                        <select style={s.select} value={editing.link_draw_request_id || ''} onChange={e => setDrawEdit(x => ({ ...x, link_draw_request_id: e.target.value }))}>
                          <option value="">— Not linked (next draw number) —</option>
                          {drawRequests.map(dr => {
                            const taken = ownerDraws.some(d => d.draw_number === dr.draw_number && d.status !== 'void')
                            return <option key={dr.id} value={dr.id}>#{dr.draw_number} · {dr.title} · packaged ${fmt(packagedDrawTotal(dr.id, directCosts, billingSubmissions))}{taken ? ' (already has an owner draw)' : ''}</option>
                          })}
                        </select>
                        {linkedPick && <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Packaged total ${fmt(packagedDrawTotal(linkedPick.id, directCosts, billingSubmissions))} — shown for comparison only.</div>}
                      </div>
                    )}
                    <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                      <div><label style={s.label}>Draw Title</label><input style={s.input} placeholder="Draw #…" value={editing.title} onChange={e => setDrawEdit(x => ({ ...x, title: e.target.value }))} /></div>
                      <div><label style={s.label}>Period Start</label><input type="date" style={s.input} value={editing.period_start} onChange={e => setDrawEdit(x => ({ ...x, period_start: e.target.value }))} /></div>
                      <div><label style={s.label}>Period End</label><input type="date" style={s.input} value={editing.period_end} onChange={e => setDrawEdit(x => ({ ...x, period_end: e.target.value }))} /></div>
                    </div>
                    {editSchedule && budgetItems.length > 0 && (
                      <div className="rx-scroll-x" style={{ marginBottom: '10px' }}>
                        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '6px' }}>Bank schedule — fill "This draw" per line (optional). The amount requested becomes the line total.</div>
                        <table style={{ width: '100%', minWidth: '720px', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead><tr>{['Line', 'Scheduled', 'Previous', 'This draw', 'Total', '%', 'Balance'].map(h => <th key={h} style={{ textAlign: h === 'Line' ? 'left' : 'right', padding: '6px', borderBottom: '1px solid #e5e7eb', color: '#6b7280', fontSize: '10px', textTransform: 'uppercase' }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {editSchedule.rows.map(r => (
                              <tr key={r.budget_item_id}>
                                <td style={{ padding: '4px 6px', borderBottom: '1px solid #f3f4f6' }}>{r.cost_code ? r.cost_code + ' · ' : ''}{r.description}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid #f3f4f6' }}>${fmt(r.scheduled)}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid #f3f4f6' }}>${fmt(r.previous)}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}><input type="number" step="0.01" style={{ ...s.input, width: '110px', padding: '4px 6px', textAlign: 'right' }} value={editing.lines?.[r.budget_item_id] ?? ''} onChange={e => setDrawEdit(x => ({ ...x, lines: { ...(x.lines || {}), [r.budget_item_id]: e.target.value } }))} /></td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', borderBottom: '1px solid #f3f4f6' }}>${fmt(r.total)}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', borderBottom: '1px solid #f3f4f6' }}>{r.pct === null ? '—' : r.pct.toFixed(1) + '%'}</td>
                                <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: r.balance < 0 ? '#dc2626' : undefined, borderBottom: '1px solid #f3f4f6' }}>${fmt(r.balance)}</td>
                              </tr>
                            ))}
                            <tr style={{ fontWeight: 700 }}>
                              <td style={{ padding: '6px' }}>Total</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'monospace' }}>${fmt(editSchedule.totals.scheduled)}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'monospace' }}>${fmt(editSchedule.totals.previous)}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'monospace' }}>${fmt(editSchedule.totals.this_period)}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'monospace' }}>${fmt(editSchedule.totals.total)}</td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{editSchedule.totals.pct === null ? '—' : editSchedule.totals.pct.toFixed(1) + '%'}</td>
                              <td style={{ padding: '6px', textAlign: 'right', fontFamily: 'monospace' }}>${fmt(editSchedule.totals.balance)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Amount Requested ($) *</label>
                        {linesEntered
                          ? <div style={{ ...s.input, background: '#f3f4f6', fontFamily: 'monospace' }}>${fmt(editSchedule?.totals.this_period || 0)} (line total)</div>
                          : <input type="number" step="0.01" style={s.input} placeholder="0.00" value={editing.amount_requested} onChange={e => setDrawEdit(x => ({ ...x, amount_requested: e.target.value }))} />}
                      </div>
                      <div><label style={s.label}>Notes</label><input style={s.input} value={editing.notes} onChange={e => setDrawEdit(x => ({ ...x, notes: e.target.value }))} placeholder="Bank loan #, inspector contact..." /></div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={s.btn} onClick={saveDraw} disabled={drawBusy}>{drawBusy ? 'Saving…' : editing.id ? 'Save draft' : 'Create draft'}</button>
                      <button style={s.btnGray} onClick={() => { setDrawEdit(null); setDrawMsg('') }}>Cancel</button>
                    </div>
                  </div>
                )}

                {ownerDraws.length === 0 ? (
                  <div style={s.emptyMsg}>No owner draw requests yet. Create one to request funds from the construction lender or owner.</div>
                ) : (
                  ownerDraws.map(d => {
                    const linkedDR = drawRequests.find(dr => dr.draw_number != null && dr.draw_number === d.draw_number)
                    const linkedTotal = linkedDR ? packagedDrawTotal(linkedDR.id, directCosts, billingSubmissions) : null
                    const mismatch = linkedDR && d.status !== 'void' && amountsDiffer(d.amount_requested, linkedTotal)
                    const received = drawFundedAmount(d)
                    const isFunding = fundingDraw?.id === d.id
                    const attachments = Array.isArray(d.attachments) ? d.attachments : []
                    return (
                    <div key={d.id} style={{ border: `1px solid ${d.status === 'funded' ? '#bbf7d0' : d.status === 'submitted' ? '#fed7aa' : d.status === 'void' ? '#fecaca' : '#e5e7eb'}`, borderRadius: '8px', padding: '14px 16px', marginBottom: '10px', opacity: d.status === 'void' ? 0.7 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827', marginBottom: '4px', textDecoration: d.status === 'void' ? 'line-through' : 'none' }}>Draw #{d.draw_number} — {d.title}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>
                            {d.period_start && d.period_end ? `${fmtDate(d.period_start)} – ${fmtDate(d.period_end)}` : d.period_start ? `From ${fmtDate(d.period_start)}` : ''}
                            {d.submitted_date && ` · Submitted ${fmtDate(d.submitted_date)}`}
                            {d.funded_date && ` · Funded ${fmtDate(d.funded_date)}`}
                            {Array.isArray(d.schedule_lines) && d.schedule_lines.length ? ` · ${d.schedule_lines.length} Bank line${d.schedule_lines.length !== 1 ? 's' : ''}` : ''}
                            {d.notes && ` · ${d.notes}`}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '18px', fontWeight: '800', fontFamily: 'monospace', color: '#111827' }}>${fmt(d.amount_requested)}</div>
                            {d.status === 'funded' && (received === null
                              ? <div style={{ fontSize: '11px', color: '#92400e' }}>Received: unknown (not recorded)</div>
                              : <div style={{ fontSize: '11px', color: '#15803d' }}>Received ${fmt(received)}{amountsDiffer(received, d.amount_requested) ? ` · variance $${fmt(Number(d.amount_requested || 0) - received)}` : ''}</div>)}
                          </div>
                          <span style={s.badge(drawStatusColor[d.status] || 'gray')}>{d.status}</span>
                        </div>
                      </div>
                      {linkedDR && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>Packaged Draw Request: {linkedDR.title} · ${fmt(linkedTotal)}</div>}
                      {/* Owner-only planning date for the company cash outlook; does not change amounts, status or funding */}
                      {isOwnerRole && d.status !== 'void' && (
                        <div style={{ marginTop: '8px' }}>
                          <ExpectedPayDateEditor entity="res_owner_draw" id={d.id} value={d.expected_payment_date || ''} label="Expected funding"
                            onSaved={v => setOwnerDraws(prev => prev.map(x => x.id === d.id ? { ...x, expected_payment_date: v } : x))} />
                        </div>
                      )}
                      {mismatch && (
                        <div style={{ fontSize: '12px', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '6px 10px', marginTop: '6px' }}>
                          Amount requested (${fmt(d.amount_requested)}) differs from the packaged total (${fmt(linkedTotal)}) by ${fmt(Math.abs(Number(d.amount_requested || 0) - linkedTotal))}.
                        </div>
                      )}
                      {attachments.length > 0 && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {attachments.map(att => <button key={att.path} style={{ ...s.btnSmGray, fontSize: '11px' }} onClick={() => openJobDoc(att.path)}>📎 {att.name || 'Attachment'}</button>)}
                        </div>
                      )}
                      {isFunding && (
                        <div style={{ ...s.inlineForm, marginTop: '10px', marginBottom: 0, display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div><label style={s.label}>Amount received ($)</label><input type="number" step="0.01" min="0" style={{ ...s.input, width: '160px' }} value={fundingDraw.amount_funded} onChange={e => setFundingDraw(f => ({ ...f, amount_funded: e.target.value }))} autoFocus /></div>
                          <div><label style={s.label}>Date funded</label><input type="date" style={{ ...s.input, width: 'auto' }} value={fundingDraw.funded_date} onChange={e => setFundingDraw(f => ({ ...f, funded_date: e.target.value }))} /></div>
                          <button style={s.btnGreen} onClick={recordFunding} disabled={drawBusy}>{drawBusy ? 'Saving…' : 'Record funding'}</button>
                          <button style={s.btnSmGray} onClick={() => setFundingDraw(null)}>Cancel</button>
                          <div style={{ fontSize: '11px', color: '#6b7280', width: '100%' }}>Enter what the owner/lender actually paid. A partial amount is fine; the difference shows as variance.</div>
                        </div>
                      )}
                      {d.status !== 'void' && (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                          <button style={s.btnSmGray} onClick={() => printOwnerDraw(d)}>Print</button>
                          {isDrawEditable(d) && <button style={s.btnSmGray} onClick={() => startDrawEdit(d)}>Edit</button>}
                          {d.status === 'draft' && <button style={s.btnSm} onClick={() => setDrawStatus(d, 'submitted')}>Submit to Owner/Bank</button>}
                          {d.status === 'submitted' && <button style={s.btnGreen} onClick={() => setDrawStatus(d, 'approved')}>Mark Approved</button>}
                          {(d.status === 'submitted' || d.status === 'approved') && <button style={s.btnGreen} onClick={() => setFundingDraw({ id: d.id, amount_funded: String(d.amount_requested ?? ''), funded_date: todayCentral() })}>Record Funding</button>}
                          {d.status === 'funded' && received === null && <button style={s.btnSmGray} onClick={() => setFundingDraw({ id: d.id, amount_funded: '', funded_date: d.funded_date || todayCentral() })}>Record amount received</button>}
                          <label style={{ ...s.btnSmGray, display: 'inline-flex', alignItems: 'center', cursor: drawBusy ? 'wait' : 'pointer' }}>
                            📎 Attach
                            <input type="file" style={{ display: 'none' }} disabled={drawBusy} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; attachToDraw(d, f) }} />
                          </label>
                          {d.status === 'draft' && <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deleteOwnerDraw(d)}>Delete</button>}
                          {d.status !== 'draft' && d.status !== 'funded' && canPM && <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => setDrawStatus(d, 'void')}>Void</button>}
                        </div>
                      )}
                    </div>
                    )
                  })
                )}
              </div>
            </>
          )
        })()}

        {/* ── PUNCH LIST ── shared punch_list_items (field app + sub portal see the same items) */}
        {visibleTab === 'punchlist' && (() => {
          const count = st => punchList.filter(p => p.status === st).length
          const pColor = { open: 'orange', sub_complete: 'amber', approved: 'green', rejected: 'red' }
          return (
            <>
              <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
                <div style={s.statCard}><div style={s.statLabel}>Open</div><div style={s.statValue(count('open') ? '#e8590c' : undefined)}>{count('open')}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Sub says done</div><div style={s.statValue(count('sub_complete') ? '#a16207' : undefined)}>{count('sub_complete')}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Approved</div><div style={s.statValue('#15803d')}>{count('approved')}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Rejected</div><div style={s.statValue(count('rejected') ? '#dc2626' : undefined)}>{count('rejected')}</div></div>
              </div>
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Punch List ({punchList.length})</p>
                  <button style={s.btnSm} onClick={() => setShowAddPunch(v => !v)}>{showAddPunch ? 'Cancel' : '+ Add Item'}</button>
                </div>
                {punchMsg && <div style={{ ...(punchMsg.startsWith('Error') ? s.errMsg : s.successMsg), marginBottom: '10px' }}>{punchMsg}</div>}
                {showAddPunch && (
                  <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                    <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div><label style={s.label}>Title *</label><input style={s.input} autoFocus placeholder="Touch-up paint in master bedroom..." value={newPunch.title} onChange={e => setNewPunch(f => ({ ...f, title: e.target.value }))} /></div>
                      <div><label style={s.label}>Details</label><input style={s.input} value={newPunch.description} onChange={e => setNewPunch(f => ({ ...f, description: e.target.value }))} placeholder="Location, details..." /></div>
                    </div>
                    <div className="rx-grid-2" style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div>
                        <label style={s.label}>Assign to Sub</label>
                        <select style={s.select} value={newPunch.subcontract_id} onChange={e => setNewPunch(f => ({ ...f, subcontract_id: e.target.value, assigned_company: '' }))}>
                          <option value="">— Select sub or type a company —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}{c.sub_id ? '' : ' (no portal login)'}</option>)}
                        </select>
                        {!newPunch.subcontract_id && <input style={{ ...s.input, marginTop: '6px' }} placeholder="Or type a company / trade..." value={newPunch.assigned_company} onChange={e => setNewPunch(f => ({ ...f, assigned_company: e.target.value }))} />}
                      </div>
                      <div><label style={s.label}>Due Date</label><input type="date" style={s.input} value={newPunch.due_date} onChange={e => setNewPunch(f => ({ ...f, due_date: e.target.value }))} /></div>
                    </div>
                    <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '8px' }}>A sub with a portal login is notified and sees the item in the sub portal.</div>
                    <button style={s.btn} onClick={addPunchItem} disabled={addingPunch || !newPunch.title.trim()}>{addingPunch ? 'Adding...' : 'Add to Punch List'}</button>
                  </div>
                )}
                {punchList.length === 0 ? (
                  <div style={s.emptyMsg}>Punch list is clear. Items from the field app and sub portal show here too.</div>
                ) : punchList.map(p => (
                  <div key={p.id} style={{ border: `1px solid ${p.status === 'approved' ? '#bbf7d0' : p.status === 'sub_complete' ? '#fde68a' : p.status === 'rejected' ? '#fecaca' : '#e5e7eb'}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '8px', opacity: p.status === 'approved' ? 0.7 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: p.status === 'approved' ? '#6b7280' : '#111827', textDecoration: p.status === 'approved' ? 'line-through' : 'none', marginBottom: '3px' }}>{p.title}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>
                          {p.assigned_company && <span style={{ color: '#1d4ed8' }}>{p.assigned_company}</span>}
                          {p.due_date && <span style={{ color: isBeforeTodayCentral(p.due_date) && p.status !== 'approved' ? '#dc2626' : undefined }}> · Due {fmtDate(p.due_date)}</span>}
                          {p.description && <span> · {p.description}</span>}
                          {p.completed_at && <span> · Sub marked done {new Date(p.completed_at).toLocaleDateString()}</span>}
                          {p.pm_approved_at && <span style={{ color: '#15803d' }}> · Approved {new Date(p.pm_approved_at).toLocaleDateString()}</span>}
                        </div>
                        {p.pm_notes && <div style={{ fontSize: '12px', color: '#6b7280', fontStyle: 'italic' }}>PM note: {p.pm_notes}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={s.badge(pColor[p.status] || 'gray')}>{String(p.status || '').replace('_', ' ')}</span>
                        {p.status === 'sub_complete' && <>
                          <button style={s.btnGreen} disabled={punchBusyId === p.id} onClick={() => updatePunchStatus(p.id, 'approved')}>Approve</button>
                          <button style={s.btnRed} disabled={punchBusyId === p.id} onClick={() => updatePunchStatus(p.id, 'rejected')}>Reject</button>
                        </>}
                        {p.status === 'open' && <button style={s.btnGreen} disabled={punchBusyId === p.id} onClick={() => updatePunchStatus(p.id, 'approved')}>Mark Done</button>}
                        {(p.status === 'rejected' || p.status === 'approved') && <button style={s.btnSmGray} disabled={punchBusyId === p.id} onClick={() => updatePunchStatus(p.id, 'open')}>Reopen</button>}
                        {canPM && <button style={{ ...s.btnSmGray, color: '#dc2626' }} onClick={() => deletePunchItem(p.id)}>×</button>}
                      </div>
                    </div>
                  </div>
                ))}
                {legacyPunch.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <p style={{ ...s.cardTitle, marginBottom: '6px' }}>Older punch items (read-only)</p>
                    {legacyPunch.map(p => <div key={p.id} style={{ fontSize: '12px', color: '#6b7280', padding: '4px 0', borderBottom: '1px solid #f3f4f6' }}>{p.description} · {p.status}{p.assigned_to ? ' · ' + p.assigned_to : ''}</div>)}
                  </div>
                )}
              </div>
            </>
          )
        })()}

        {/* ── FIELD ── read-only: daily reports, RFIs, deliveries from the field app */}
        {visibleTab === 'field' && (
          <>
            {!fieldData ? <div style={s.emptyMsg}>Loading field activity…</div> : (
              <>
                <div className="rx-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
                  <div style={s.statCard}><div style={s.statLabel}>Daily reports</div><div style={s.statValue()}>{fieldData.reports.length}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Open RFIs</div><div style={s.statValue(fieldData.rfis.some(r => r.status === 'open') ? '#e8590c' : undefined)}>{fieldData.rfis.filter(r => r.status === 'open').length}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Deliveries pending</div><div style={s.statValue()}>{fieldData.deliveries.filter(d => !d.received_date).length}</div></div>
                </div>
                <div style={s.card}>
                  <p style={s.cardTitle}>Daily Reports</p>
                  {isOffice && !showNewDailyReport && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <button type="button" style={{ ...s.btnGreen, opacity: inPreview ? 0.5 : 1 }} disabled={inPreview} title={inPreview ? 'Disabled in role preview' : undefined} onClick={() => { setDailyReportSaved(false); setShowNewDailyReport(true) }}>+ New daily report</button>
                      {dailyReportSaved && <span style={{ fontSize: '13px', color: '#15803d', fontWeight: 600 }}>Daily report saved.</span>}
                    </div>
                  )}
                  {isOffice && showNewDailyReport && (
                    <DailyReportForm
                      jobId={id}
                      styles={{ label: s.label, input: s.input, btn: s.btn, btnGray: s.btnGray, btnSmall: s.btnSmGray }}
                      supabase={supabase}
                      authFetch={authFetch}
                      disabled={inPreview}
                      existingDates={fieldData.reports.map(r => r.report_date)}
                      onCancel={() => setShowNewDailyReport(false)}
                      onSuccess={() => { setShowNewDailyReport(false); setDailyReportSaved(true); setTimeout(() => setDailyReportSaved(false), 4000); loadFieldData() }}
                    />
                  )}
                  {fieldData.reports.length === 0 ? <div style={s.emptyMsg}>No daily reports yet.</div> : fieldData.reports.map(r => (
                    <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                      <div style={{ fontWeight: 600 }}>{fmtDate(r.report_date)}{Array.isArray(r.photos) && r.photos.length ? ` · ${r.photos.length} photo${r.photos.length !== 1 ? 's' : ''}` : ''}</div>
                      {r.work_performed && <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>{r.work_performed}</div>}
                      {r.issues && <div style={{ color: '#b91c1c', whiteSpace: 'pre-wrap' }}>Issues: {r.issues}</div>}
                    </div>
                  ))}
                </div>
                <div style={s.card}>
                  <p style={s.cardTitle}>RFIs</p>
                  {fieldData.rfis.length === 0 ? <div style={s.emptyMsg}>No RFIs.</div> : fieldData.rfis.map(r => (
                    <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}><strong>{r.number != null && <span style={{ color: '#6b7280', fontWeight: 600, marginRight: '6px' }}>RFI #{r.number}</span>}{r.title}</strong><span style={s.badge(r.status === 'open' || !r.status ? 'orange' : 'gray')}>{r.status || 'open'}</span></div>
                      {r.description && <div style={{ color: '#374151', whiteSpace: 'pre-wrap' }}>{r.description}</div>}
                      {r.response && <div style={{ color: '#15803d', whiteSpace: 'pre-wrap' }}>Response: {r.response}</div>}
                      <button type="button" onClick={() => setOpenRfiThread(openRfiThread === r.id ? null : r.id)} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '12px', padding: '4px 0 0' }}>
                        {openRfiThread === r.id ? 'Hide owner comments ▲' : 'Owner comments ▼'}
                      </button>
                      {openRfiThread === r.id && <RfiCommentThread rfiId={r.id} readOnly={inPreview} />}
                    </div>
                  ))}
                </div>
                <div style={s.card}>
                  <p style={s.cardTitle}>Deliveries</p>
                  {fieldData.deliveries.length === 0 ? <div style={s.emptyMsg}>No deliveries.</div> : fieldData.deliveries.map(d => (
                    <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid #f3f4f6', fontSize: '13px' }}>
                      <span>{d.material || '—'}{d.vendor ? ' · ' + d.vendor : ''}</span>
                      <span style={{ color: '#6b7280' }}>{d.received_date ? 'Received ' + fmtDate(d.received_date) : 'Expected ' + fmtDate(d.expected_date)}{d.status ? ' · ' + d.status : ''}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* ── CONTACTS ── */}
        {visibleTab === 'contacts' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Contacts ({contacts.length})</p>
              <button style={s.btnSm} onClick={() => setShowAddContact(v => !v)}>{showAddContact ? 'Cancel' : '+ Add Contact'}</button>
            </div>

            {contactMsg && <div style={{ ...s.errMsg, marginBottom: '10px' }}>{contactMsg}</div>}
            {showAddContact && (
              <div style={{ ...s.inlineForm, marginBottom: '16px' }}>
                <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Name *</label><input style={s.input} value={newContact.name} onChange={e => setNewContact(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
                  <div><label style={s.label}>Role</label><input style={s.input} placeholder="Architect, Inspector..." value={newContact.role} onChange={e => setNewContact(f => ({ ...f, role: e.target.value }))} /></div>
                  <div><label style={s.label}>Company</label><input style={s.input} value={newContact.company} onChange={e => setNewContact(f => ({ ...f, company: e.target.value }))} /></div>
                </div>
                <div className="rx-grid-3" style={{ ...s.grid3, marginBottom: '10px' }}>
                  <div><label style={s.label}>Phone</label><input style={s.input} value={newContact.phone} onChange={e => setNewContact(f => ({ ...f, phone: e.target.value }))} /></div>
                  <div><label style={s.label}>Email</label><input style={s.input} type="email" value={newContact.email} onChange={e => setNewContact(f => ({ ...f, email: e.target.value }))} /></div>
                  <div><label style={s.label}>Notes</label><input style={s.input} value={newContact.notes} onChange={e => setNewContact(f => ({ ...f, notes: e.target.value }))} /></div>
                </div>
                <button style={s.btn} onClick={addContact} disabled={addingContact || !newContact.name}>{addingContact ? 'Adding...' : 'Add Contact'}</button>
              </div>
            )}

            {contacts.length === 0 ? (
              <div style={s.emptyMsg}>No contacts yet. Add the owner, architect, inspector, or other key contacts.</div>
            ) : (
              <div className="rx-scroll-x">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '10px', padding: '0 0 8px', borderBottom: '1px solid #e5e7eb', minWidth: '560px' }}>
                  {['Name', 'Role', 'Phone', 'Email', ''].map(h => <div key={h} style={{ fontSize: '10px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>{h}</div>)}
                </div>
                {contacts.map(c => (
                  <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 40px', gap: '10px', padding: '10px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'center', minWidth: '560px' }}>
                    <div>
                      <div style={{ fontSize: '13px', color: '#111827' }}>{c.name}</div>
                      {c.company && <div style={{ fontSize: '11px', color: '#6b7280' }}>{c.company}</div>}
                    </div>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{c.role || '—'}</span>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{c.phone || '—'}</span>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>{c.email || '—'}</span>
                    <button style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '16px' }} onClick={() => deleteContact(c.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>{/* /body */}
          </div>{/* /content */}
        </div>{/* /sidebar+content row */}
      </main>

      {/* ── AI Job Assistant ─────────────────────────────────────────────── */}
      <button
        onClick={() => setAiOpen(o => !o)}
        title="AI Job Assistant"
        style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 1100,
          width: '52px', height: '52px', borderRadius: '50%',
          background: aiOpen ? '#1a1a2e' : '#e8590c', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)', transition: 'background 0.2s',
          color: '#fff', fontSize: '22px',
        }}
      >
        {aiOpen ? '✕' : '✦'}
      </button>

      {aiOpen && (
        <div style={{
          position: 'fixed', bottom: '88px', right: '24px', zIndex: 1099,
          width: 'min(360px, calc(100vw - 32px))', maxHeight: '520px',
          background: '#0f0f1a', border: '1px solid #2a2a3e', borderRadius: '16px',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
        }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #2a2a3e', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#e8590c', fontSize: '16px' }}>✦</span>
            <div>
              <div style={{ color: '#f1f1f1', fontWeight: 700, fontSize: '13px', lineHeight: 1 }}>AI Job Assistant</div>
              <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '2px' }}>Powered by Gemini</div>
            </div>
            {aiMessages.length > 0 && (
              <button onClick={() => setAiMessages([])} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#4b5563', fontSize: '11px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px' }}>
                Clear
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {aiMessages.length === 0 && (
              <div style={{ color: '#4b5563', fontSize: '12px', textAlign: 'center', paddingTop: '20px', lineHeight: 1.6 }}>
                Ask anything about this job — budget, costs, billing, subcontracts, or profitability.
              </div>
            )}
            {aiMessages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '88%',
                background: m.role === 'user' ? '#e8590c' : '#1e1e30',
                color: m.role === 'user' ? '#fff' : '#d1d5db',
                borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                padding: '9px 12px', fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
            ))}
            {aiLoading && (
              <div style={{ alignSelf: 'flex-start', background: '#1e1e30', borderRadius: '12px 12px 12px 2px', padding: '9px 14px', color: '#6b7280', fontSize: '13px' }}>
                Thinking…
              </div>
            )}
          </div>

          {aiMessages.length === 0 && (
            <div style={{ display: 'flex', gap: '6px', padding: '0 14px 8px', flexWrap: 'wrap' }}>
              {['What\'s the budget status?', 'Any pending costs?', 'How much have we billed?'].map(q => (
                <button key={q} onClick={() => sendAiMessage(q)}
                  style={{ background: '#1e1e30', border: '1px solid #2a2a3e', color: '#9ca3af', borderRadius: '20px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: '10px 12px', borderTop: '1px solid #2a2a3e', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <textarea
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage() } }}
              placeholder="Ask about this job…"
              rows={1}
              style={{
                flex: 1, background: '#1e1e30', border: '1px solid #2a2a3e', borderRadius: '10px',
                color: '#f1f1f1', fontSize: '13px', padding: '8px 10px', resize: 'none',
                lineHeight: 1.4, maxHeight: '80px', overflowY: 'auto', outline: 'none',
              }}
            />
            <button
              onClick={() => sendAiMessage()}
              disabled={!aiInput.trim() || aiLoading}
              style={{
                background: !aiInput.trim() || aiLoading ? '#2a2a3e' : '#e8590c',
                border: 'none', borderRadius: '10px', color: '#fff',
                cursor: !aiInput.trim() || aiLoading ? 'default' : 'pointer',
                padding: '8px 12px', fontSize: '16px', transition: 'background 0.15s', flexShrink: 0,
              }}
            >
              ↑
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ResidentialJobDetail() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', color: '#6b7280' }}>Loading...</div>}>
      <ResidentialJobDetailInner />
    </Suspense>
  )
}
