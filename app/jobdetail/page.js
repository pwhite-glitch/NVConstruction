'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { sendEmail, emailWrap } from '../../lib/email'

const s = {
  page: { minHeight: '100vh', background: '#0a0a0a' },
  header: { background: '#141414', borderBottom: '1px solid #222', padding: '0 1.5rem', position: 'sticky', top: 0, zIndex: 10 },
  headerInner: { maxWidth: '1320px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '64px' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoImg: { width: '40px', height: '40px', objectFit: 'contain' },
  logoName: { fontWeight: '700', fontSize: '15px', color: '#f1f1f1', letterSpacing: '1px' },
  logoSub: { fontSize: '11px', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' },
  main: { maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem' },
  backBtn: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#888', fontSize: '13px', cursor: 'pointer', background: 'none', border: 'none', padding: 0, marginBottom: '1.5rem' },
  card: { background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '1.75rem', marginBottom: '1.5rem' },
  cardTitle: { fontSize: '13px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginTop: 0, marginBottom: '1.25rem' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' },
  label: { display: 'block', fontSize: '11px', fontWeight: '600', color: '#666', marginBottom: '6px', letterSpacing: '1.5px', textTransform: 'uppercase' },
  input: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none' },
  textarea: { width: '100%', padding: '11px 14px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '14px', color: '#f1f1f1', boxSizing: 'border-box', outline: 'none', resize: 'vertical', minHeight: '100px' },
  btn: { padding: '11px 24px', background: '#e8590c', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnGray: { padding: '11px 24px', background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnRed: { padding: '11px 24px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmall: { padding: '7px 16px', background: '#1a1a1a', color: '#aaa', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallOrange: { padding: '7px 16px', background: '#2a1200', color: '#e8590c', border: '1px solid #4a2200', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallGreen: { padding: '7px 16px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  btnSmallRed: { padding: '7px 16px', background: '#2a0a0a', color: '#ff6b6b', border: '1px solid #5a1a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', letterSpacing: '1px', textTransform: 'uppercase' },
  jobTitle: { fontSize: '28px', fontWeight: '800', color: '#f1f1f1', margin: '0 0 4px' },
  jobMeta: { fontSize: '14px', color: '#555', margin: 0 },
  successMsg: { background: '#0a1a0a', border: '1px solid #1a4a1a', color: '#4ade80', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1.5rem' },
  errorMsg: { background: '#1a0a0a', border: '1px solid #5a1a1a', color: '#ff6b6b', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', marginBottom: '1.5rem' },
  badge: (status) => ({
    padding: '4px 14px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'active' ? '#0a1a2a' : status === 'complete' ? '#0a2a0a' : status === 'archived' ? '#1a1a1a' : '#2a2a0a',
    color: status === 'active' ? '#60a5fa' : status === 'complete' ? '#4ade80' : status === 'archived' ? '#555' : '#facc15',
    border: `1px solid ${status === 'active' ? '#1a3a5a' : status === 'complete' ? '#1a4a1a' : status === 'archived' ? '#2a2a2a' : '#4a4a0a'}`
  }),
  contractBadge: (status) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'signed' ? '#0a2a0a' : status === 'active' ? '#0a1a2a' : '#1a1a1a',
    color: status === 'signed' ? '#4ade80' : status === 'active' ? '#60a5fa' : '#888',
    border: `1px solid ${status === 'signed' ? '#1a4a1a' : status === 'active' ? '#1a3a5a' : '#2a2a2a'}`
  }),
  coBadge: (status) => ({
    padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase',
    background: status === 'approved' ? '#0a2a0a' : status === 'rejected' ? '#2a0a0a' : '#2a1200',
    color: status === 'approved' ? '#4ade80' : status === 'rejected' ? '#ff6b6b' : '#e8590c',
    border: `1px solid ${status === 'approved' ? '#1a4a1a' : status === 'rejected' ? '#5a1a1a' : '#4a2200'}`
  }),
  billingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  subRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem' },
  statLabel: { fontSize: '11px', fontWeight: '600', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '6px' },
  statValue: (accent) => ({ fontSize: '24px', fontWeight: '800', color: accent || '#f1f1f1', margin: 0 }),
  confirmBox: { background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '1.25rem', marginTop: '1rem' },
  tabRow: { display: 'flex', gap: '4px', marginBottom: '1.5rem', borderBottom: '1px solid #222', paddingBottom: '0', overflowX: 'auto' },
  tab: (active) => ({
    padding: '10px 20px', fontSize: '13px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none',
    color: active ? '#f1f1f1' : '#555', borderBottom: active ? '2px solid #e8590c' : '2px solid transparent',
    letterSpacing: '0.5px', marginBottom: '-1px', whiteSpace: 'nowrap'
  }),
  inlineForm: { background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1.25rem', marginBottom: '1rem' },
  contractRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  contractRowHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' },
  contractRowExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
  coRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' },
  budgetTableHeader: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '8px 12px 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', marginBottom: '4px', alignItems: 'center' },
  budgetTableRow: { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 1fr 60px 80px', gap: '12px', padding: '14px 12px', borderBottom: '1px solid #111', alignItems: 'center' },
  billingEntryRow: { border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  billingEntryHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: '#0f0f0f' },
  billingEntryExpanded: { borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' },
}

const emptyContract = { dir_id: '', contract_value: '', description: '', onedrive_url: '', budget_item_id: '', retainage_pct: '10', budget_allocations: [] }
const emptyCO = { subcontract_id: '', amount: '', description: '', direction: 'pm_to_sub', sov: [] }
const emptyPrimeCO = { amount: '', description: '', notes: '', sov: [] }
const emptySOVRow = { description: '', budget_item_id: '', amount: '' }
const emptyBudgetItem = { cost_code: '', description: '', budget_amount: '', owner_amount: '' }
const emptyCreateBilling = { _contract_id: '', _contract_value: '', _retainage_pct: '0', sub_id: '', company_name: '', contact_name: '', contact_info: '', amount_billed: '', pct_complete: '', work_description: '', billing_period: new Date().toISOString().slice(0, 7), draw_request_id: '', auto_approve: true }

export default function JobDetail() {
  const router = useRouter()
  const [id, setId] = useState(null)
  const [job, setJob] = useState(null)
  const [form, setForm] = useState({})
  const [subs, setSubs] = useState([])
  const [billing, setBilling] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [errMsg, setErrMsg] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [activeTab, setActiveTab] = useState('details')
  const [showBillingDates, setShowBillingDates] = useState(false)
  const [userRole, setUserRole] = useState(null)

  // Labor / employee state
  const [laborAllocations, setLaborAllocations] = useState([])
  const [allEmployees, setAllEmployees] = useState([])
  const [laborLoaded, setLaborLoaded] = useState(false)
  const [showAddLabor, setShowAddLabor] = useState(false)
  const [laborForm, setLaborForm] = useState({ employee_id: '', start_date: '', end_date: '', budget_line: '', notes: '' })
  const [savingLabor, setSavingLabor] = useState(false)
  const [laborMsg, setLaborMsg] = useState(null)


  // Contracts state
  const [contracts, setContracts] = useState([])
  const [showAddContract, setShowAddContract] = useState(false)
  const [contractForm, setContractForm] = useState(emptyContract)
  const [addingContract, setAddingContract] = useState(false)
  const [editingContract, setEditingContract] = useState(null)
  const [editContractForm, setEditContractForm] = useState({})
  const [showContractGen, setShowContractGen] = useState(false)
  const [contractGenForm, setContractGenForm] = useState({ contract_id: '', date: '', sub_name: '', sub_address: '', entity_type: 'sole proprietorship', trade: '', project_name: '', project_address: '', owner_name: '', owner_address: '', contract_amount: '', pay_pct: '100', scope_of_work: '', job_number: '', subcontract_number: '', pm_name: 'Peyton White', superintendent: 'Landon Moore' })

  // Change orders state
  const [allCOs, setAllCOs] = useState([])
  const [showAddCO, setShowAddCO] = useState(false)
  const [coForm, setCoForm] = useState(emptyCO)
  const [addingCO, setAddingCO] = useState(false)
  const [primeCOs, setPrimeCOs] = useState([])
  const [showAddPrimeCO, setShowAddPrimeCO] = useState(false)
  const [primeCOForm, setPrimeCOForm] = useState(emptyPrimeCO)
  const [addingPrimeCO, setAddingPrimeCO] = useState(false)
  const [pushCOId, setPushCOId] = useState(null)
  const [pushMarkup, setPushMarkup] = useState('')
  const [pushingToPrime, setPushingToPrime] = useState(false)
  const [expandedPrimeCOId, setExpandedPrimeCOId] = useState(null)
  const [editingPrimeCOId, setEditingPrimeCOId] = useState(null)
  const [editPrimeCOForm, setEditPrimeCOForm] = useState(emptyPrimeCO)
  const [savingPrimeCO, setSavingPrimeCO] = useState(false)
  const [expandedSubCOId, setExpandedSubCOId] = useState(null)

  // Budget state
  const [budgetItems, setBudgetItems] = useState([])
  const [showAddBudgetItem, setShowAddBudgetItem] = useState(false)
  const [budgetItemForm, setBudgetItemForm] = useState(emptyBudgetItem)
  const [addingBudgetItem, setAddingBudgetItem] = useState(false)
  const [csvUploading, setCsvUploading] = useState(false)
  const [editingBudgetItem, setEditingBudgetItem] = useState(null)
  const [editBudgetForm, setEditBudgetForm] = useState({})

  // Billing tab state
  const [billingSubmissions, setBillingSubmissions] = useState([])
  const [showCreateBilling, setShowCreateBilling] = useState(false)
  const [createBillingForm, setCreateBillingForm] = useState(emptyCreateBilling)
  const [creatingBilling, setCreatingBilling] = useState(false)
  const [createBillingError, setCreateBillingError] = useState('')
  const [createBillingFile, setCreateBillingFile] = useState(null)
  const [editingBilling, setEditingBilling] = useState(null)
  const [editBillingFile, setEditBillingFile] = useState(null)

  // Draw requests state
  const [drawRequests, setDrawRequests] = useState([])
  const [showCreateDraw, setShowCreateDraw] = useState(false)
  const [drawForm, setDrawForm] = useState({ title: '', dc_ids: [] })
  const [creatingDraw, setCreatingDraw] = useState(false)
  const [expandedDrawId, setExpandedDrawId] = useState(null)
  const [drawAddCostIds, setDrawAddCostIds] = useState([])
  const [savingDrawCosts, setSavingDrawCosts] = useState(false)
  const [editBillingForm, setEditBillingForm] = useState({})
  const [togglingNvCheck, setTogglingNvCheck] = useState(null)
  const [togglingReadyToPay, setTogglingReadyToPay] = useState(null)
  const [dcSearch, setDcSearch] = useState('')
  const [dcStatusFilter, setDcStatusFilter] = useState('all')

  // Subs tab state
  const [subDirectory, setSubDirectory] = useState([])
  const [showAssignSub, setShowAssignSub] = useState(false)
  const [assignSubForm, setAssignSubForm] = useState({ email: '', from_dir: '' })
  const [assigningSubLoading, setAssigningSubLoading] = useState(false)
  const [notifyingSubId, setNotifyingSubId] = useState(null)
  const [notifySubResult, setNotifySubResult] = useState({})

  // Field tab state
  const [fieldDailyReports, setFieldDailyReports] = useState([])
  const [fieldRfis, setFieldRfis] = useState([])
  const [fieldDeliveries, setFieldDeliveries] = useState([])
  const [fieldMilestones, setFieldMilestones] = useState([])
  const [expandedFieldReport, setExpandedFieldReport] = useState(null)
  const [expandedFieldRfi, setExpandedFieldRfi] = useState(null)
  const [fieldSubTab, setFieldSubTab] = useState('reports')
  const [respondingRfi, setRespondingRfi] = useState(null)
  const [rfiResponse, setRfiResponse] = useState('')
  const [savingRfiResponse, setSavingRfiResponse] = useState(false)
  const [milestoneForm, setMilestoneForm] = useState({ title: '', due_date: '', notes: '' })
  const [addingMilestone, setAddingMilestone] = useState(false)
  const [showMilestoneForm, setShowMilestoneForm] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState(null)
  const [editMilestoneForm, setEditMilestoneForm] = useState({})
  const [pmDeliveryForm, setPmDeliveryForm] = useState({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
  const [pmDeliveryFile, setPmDeliveryFile] = useState(null)
  const [showPmDeliveryForm, setShowPmDeliveryForm] = useState(false)
  const [submittingPmDelivery, setSubmittingPmDelivery] = useState(false)

  // Direct Costs tab state
  const [directCosts, setDirectCosts] = useState([])
  const [updatingCostId, setUpdatingCostId] = useState(null)
  const [rejectingCostId, setRejectingCostId] = useState(null)
  const [costRejectNote, setCostRejectNote] = useState('')
  const [assigningCostId, setAssigningCostId] = useState(null)
  const [showDcForm, setShowDcForm] = useState(false)
  const [dcForm, setDcForm] = useState({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
  const [dcFile, setDcFile] = useState(null)
  const [showCsvImport, setShowCsvImport] = useState(false)
  const [csvRows, setCsvRows] = useState([])
  const [importingCsv, setImportingCsv] = useState(false)
  const [submittingDc, setSubmittingDc] = useState(false)
  const [dismissedDupIds, setDismissedDupIds] = useState(() => {
    try { const s = localStorage.getItem(`dc_nodups_${id}`); return s ? new Set(JSON.parse(s)) : new Set() } catch { return new Set() }
  })

  const [billingByItem, setBillingByItem] = useState({})

  // Prime Contract tab state
  const [primeContractFile, setPrimeContractFile] = useState(null)
  const [uploadingPrimeContract, setUploadingPrimeContract] = useState(false)
  const [aiaApplications, setAiaApplications] = useState([])
  const [activeAia, setActiveAia] = useState(null)
  const [aiaLines, setAiaLines] = useState([])
  const [showNewAia, setShowNewAia] = useState(false)
  const [newAiaForm, setNewAiaForm] = useState({ app_number: '1', period_from: '', period_to: '', retainage_pct: '10', markup_pct: '0', linked_draw_request_id: '' })
  const [savingAia, setSavingAia] = useState(false)
  const [aiaLoading, setAiaLoading] = useState(false)
  const [paymentForm, setPaymentForm] = useState({ appId: null, amount: '', received_at: new Date().toISOString().split('T')[0] })
  const [savingPayment, setSavingPayment] = useState(false)
  const [periodDirectCosts, setPeriodDirectCosts] = useState([])
  const [periodBilling, setPeriodBilling] = useState([])
  const [appliedBillings, setAppliedBillings] = useState(new Set())
  const [manualMapBillingId, setManualMapBillingId] = useState(null)
  const [manualMapBudgetItemId, setManualMapBudgetItemId] = useState('')
  const [pinnedLineIds, setPinnedLineIds] = useState(new Set())

  // Contract SOV state
  const [contractSovLines, setContractSovLines] = useState({})
  const [expandedSov, setExpandedSov] = useState(null)
  const [showAddSovLine, setShowAddSovLine] = useState(null)
  const [sovLineForm, setSovLineForm] = useState({ description: '', scheduled_value: '', budget_item_id: '' })
  const [addingSovLine, setAddingSovLine] = useState(false)
  const [editingSovLine, setEditingSovLine] = useState(null)
  const [editSovLineForm, setEditSovLineForm] = useState({})
  const [billingSovData, setBillingSovData] = useState({})

  // Schedule tab state
  const [scheduleFiles, setScheduleFiles] = useState([])
  const [uploadingSchedule, setUploadingSchedule] = useState(false)
  const [parsedTasks, setParsedTasks] = useState(null)
  const [parsedFrom, setParsedFrom] = useState(null)
  const [scheduleUploadMeta, setScheduleUploadMeta] = useState({ revision: '', notes: '' })
  const [showScheduleUpload, setShowScheduleUpload] = useState(false)

  // Documents tab state
  const [jobDocs, setJobDocs] = useState([])
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docCategory, setDocCategory] = useState('plans')
  const [filterDocCategory, setFilterDocCategory] = useState('all')

  const [teamMembers, setTeamMembers] = useState([])
  const [generatingReport, setGeneratingReport] = useState(false)

  // Contacts tab state
  const [jobContacts, setJobContacts] = useState([])
  const [contactForm, setContactForm] = useState({ name: '', company: '', role: '', phone: '', email: '', notes: '' })
  const [addingContact, setAddingContact] = useState(false)
  const [savingContact, setSavingContact] = useState(false)

  // Punch list / closeout state
  const [punchItems, setPunchItems] = useState([])
  const [showAddPunch, setShowAddPunch] = useState(false)
  const [punchForm, setPunchForm] = useState({ title: '', description: '', assigned_sub_id: '', assigned_company: '', due_date: '' })
  const [savingPunch, setSavingPunch] = useState(false)
  const [updatingPunchId, setUpdatingPunchId] = useState(null)
  const [punchNotes, setPunchNotes] = useState({})

  // Retainage release state
  const [retainageReleases, setRetainageReleases] = useState([])
  const [showReleaseForm, setShowReleaseForm] = useState(false)
  const [releaseForm, setReleaseForm] = useState({ subcontract_id: '', company_name: '', amount: '', notes: '' })
  const [savingRelease, setSavingRelease] = useState(false)

  // Submittals state
  const [submittals, setSubmittals] = useState([])
  const [showAddSubmittal, setShowAddSubmittal] = useState(false)
  const [submittalForm, setSubmittalForm] = useState({ title: '', type: 'shop_drawing', spec_section: '', submitted_by_sub_id: '', submitted_by_company: '', notes: '' })
  const [savingSubmittal, setSavingSubmittal] = useState(false)
  const [expandedSubmittalId, setExpandedSubmittalId] = useState(null)
  const [submittalReviewNote, setSubmittalReviewNote] = useState({})

  // Prelim notices state
  const [prelimNotices, setPrelimNotices] = useState([])
  const [showAddPrelim, setShowAddPrelim] = useState(false)
  const [prelimForm, setPrelimForm] = useState({ from_company: '', amount_claimed: '', received_at: new Date().toISOString().split('T')[0], notes: '' })
  const [savingPrelim, setSavingPrelim] = useState(false)

  // Sub ratings state
  const [subRatings, setSubRatings] = useState([])
  const [ratingForms, setRatingForms] = useState({})
  const [savingRatingFor, setSavingRatingFor] = useState(null)
  const [showRatingFor, setShowRatingFor] = useState(null)

  // Messages state
  const [messageThreads, setMessageThreads] = useState({})
  const [messageDraft, setMessageDraft] = useState({})
  const [sendingMessageFor, setSendingMessageFor] = useState(null)
  const [expandedMessageSubId, setExpandedMessageSubId] = useState(null)

  // Field photos state
  const [fieldPhotos, setFieldPhotos] = useState([])
  const [fieldPhotoUrls, setFieldPhotoUrls] = useState({})
  const [fieldLightbox, setFieldLightbox] = useState(null)
  const [deletingFieldPhoto, setDeletingFieldPhoto] = useState(null)

  // NV Subcontracts (when NV is acting as sub on a job)
  const [nvSubcontracts, setNvSubcontracts] = useState([])
  const [nvSubForm, setNvSubForm] = useState({ gc_name: '', contract_number: '', scope_description: '', contract_value: '', status: 'active', signed_date: '', notes: '' })
  const [addingNvSub, setAddingNvSub] = useState(false)
  const [showNvSubForm, setShowNvSubForm] = useState(false)
  const [editingNvSubId, setEditingNvSubId] = useState(null)
  const [editNvSubForm, setEditNvSubForm] = useState({})
  const [savingNvSub, setSavingNvSub] = useState(false)

  // Warranty state
  const [warrantySetting, setWarrantySetting] = useState(null)
  const [warrantyOrders, setWarrantyOrders] = useState([])
  const [warrantySettingForm, setWarrantySettingForm] = useState({ start_date: '', end_date: '', coverage_notes: '' })
  const [editingWarrantySetting, setEditingWarrantySetting] = useState(false)
  const [savingWarrantySetting, setSavingWarrantySetting] = useState(false)
  const [warrantyOrderForm, setWarrantyOrderForm] = useState({ title: '', description: '', due_date: '', assigned_employee_id: '', assigned_employee_name: '', assigned_sub_id: '', assigned_company: '' })
  const [showWarrantyOrderForm, setShowWarrantyOrderForm] = useState(false)
  const [submittingWarrantyOrder, setSubmittingWarrantyOrder] = useState(false)
  const [resolvingOrder, setResolvingOrder] = useState(null)
  const [uploadingWarrantyPhoto, setUploadingWarrantyPhoto] = useState(false)

  const update = (f, v) => setForm(x => ({ ...x, [f]: v }))

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setId(params.get('id'))
    const tab = params.get('tab')
    if (tab) setActiveTab(tab)
  }, [])

  useEffect(() => {
    if (!id) return
    try {
      const stored = localStorage.getItem(`aia_pinned_${id}`)
      if (stored) setPinnedLineIds(new Set(JSON.parse(stored)))
    } catch {}
  }, [id])

  useEffect(() => {
    if (!fieldLightbox) return
    const onKey = e => { if (e.key === 'Escape') setFieldLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fieldLightbox])

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      if (prof?.role !== 'pm' && prof?.role !== 'apm') { router.push('/submit'); return }
      setUserRole(prof.role)
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', id).single()
      if (!jobData) { router.push('/dashboard'); return }
      setJob(jobData)
      setForm(jobData)
      const { data: subList } = await supabase.from('job_assignments').select('*, profiles(full_name, company_name, phone)').eq('job_id', id)
      setSubs(subList || [])
      const { data: bills } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
      setBilling(bills || [])
      const { data: initialCOs } = await supabase.from('prime_change_orders').select('*').eq('job_id', id).order('created_at', { ascending: false })
      setPrimeCOs(initialCOs || [])
      const teamRes = await fetch('/api/team-members')
      const teamJson = await teamRes.json()
      setTeamMembers(teamJson.members || [])
      setLoading(false)
    }
    load()
  }, [id, router])

  async function loadContracts() {
    const { data: summary } = await supabase.from('subcontract_summary').select('*').eq('job_id', id).order('created_at', { ascending: true })
    if (!summary) { setContracts([]); return [] }
    // Fetch budget_item_id from the base table — the view may predate this column
    const { data: raw } = await supabase.from('subcontracts').select('id, budget_item_id, budget_allocations, vendor_name, retainage_pct').eq('job_id', id)
    const merged = summary.map(c => ({
      ...c,
      budget_item_id: raw?.find(r => r.id === c.id)?.budget_item_id ?? null,
      budget_allocations: raw?.find(r => r.id === c.id)?.budget_allocations ?? [],
      vendor_name: raw?.find(r => r.id === c.id)?.vendor_name ?? null,
      retainage_pct: raw?.find(r => r.id === c.id)?.retainage_pct ?? 10,
    }))
    setContracts(merged)
    return merged
  }

  async function loadBudgetItems() {
    const { data } = await supabase.from('budget_items').select('*').eq('job_id', id).order('cost_code', { ascending: true })
    setBudgetItems(data || [])
  }

  async function loadBillingByItem() {
    const { data: latestApp } = await supabase.from('aia_applications').select('id').eq('job_id', id).order('app_number', { ascending: false }).limit(1).single()
    if (!latestApp) { setBillingByItem({}); return }
    const { data: lines } = await supabase.from('aia_application_lines').select('budget_item_id, pct_prev, pct_this_period').eq('application_id', latestApp.id)
    const map = {}
    for (const l of lines || []) {
      map[l.budget_item_id] = (parseFloat(l.pct_prev) || 0) + (parseFloat(l.pct_this_period) || 0)
    }
    setBillingByItem(map)
  }

  async function loadAllCOs() {
    const { data } = await supabase
      .from('change_orders')
      .select('*, subcontracts!inner(sub_id, description, job_id)')
      .eq('subcontracts.job_id', id)
      .order('created_at', { ascending: false })
    setAllCOs(data || [])
  }

  async function loadBillingForJob() {
    const { data } = await supabase.from('billing_submissions').select('*').eq('job_id', id).order('submitted_at', { ascending: false })
    setBillingSubmissions(data || [])
  }

  async function loadDrawRequests() {
    const res = await fetch(`/api/draw-requests?job_id=${id}`)
    const { draws } = await res.json()
    setDrawRequests(draws || [])
  }

  async function reloadSubs() {
    const { data } = await supabase.from('job_assignments').select('*, profiles(full_name, company_name, phone)').eq('job_id', id)
    setSubs(data || [])
  }

  async function loadSubDirectory() {
    const { data } = await supabase.from('sub_directory').select('*').eq('status', 'approved').order('company_name')
    setSubDirectory(data || [])
  }

  async function loadFieldData() {
    const [{ data: reports }, { data: rfis }, { data: deliveries }, { data: milestones }] = await Promise.all([
      supabase.from('daily_reports').select('*').eq('job_id', id).order('report_date', { ascending: false }),
      supabase.from('rfis').select('*').eq('job_id', id).order('created_at', { ascending: false }),
      supabase.from('deliveries').select('*').eq('job_id', id).order('expected_date', { ascending: true }),
      supabase.from('milestones').select('*').eq('job_id', id).order('due_date', { ascending: true }),
    ])
    setFieldDailyReports(reports || [])
    setFieldRfis(rfis || [])
    setFieldDeliveries(deliveries || [])
    setFieldMilestones(milestones || [])
  }

  async function respondToRfi(rfiId) {
    setSavingRfiResponse(true)
    const { data: { session } } = await supabase.auth.getSession()
    const rfi = fieldRfis.find(r => r.id === rfiId)
    await supabase.from('rfis').update({ response: rfiResponse, status: 'answered', responded_at: new Date().toISOString(), responded_by: session.user.id }).eq('id', rfiId)
    if (rfi?.super_id) {
      fetch('/api/rfi-notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'responded', super_id: rfi.super_id, title: rfi.title, response: rfiResponse }) })
    }
    setRespondingRfi(null)
    setRfiResponse('')
    await loadFieldData()
    setSavingRfiResponse(false)
  }

  async function addMilestone(e) {
    e.preventDefault()
    setAddingMilestone(true)
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('milestones').insert({ job_id: id, title: milestoneForm.title, due_date: milestoneForm.due_date || null, notes: milestoneForm.notes || null, created_by: session.user.id })
    setMilestoneForm({ title: '', due_date: '', notes: '' })
    setShowMilestoneForm(false)
    await loadFieldData()
    setAddingMilestone(false)
  }

  async function saveMilestoneEdit() {
    await supabase.from('milestones').update({ title: editMilestoneForm.title, due_date: editMilestoneForm.due_date || null, notes: editMilestoneForm.notes || null, status: editMilestoneForm.status }).eq('id', editingMilestone)
    setEditingMilestone(null)
    await loadFieldData()
  }

  async function deleteMilestone(milestoneId) {
    if (!window.confirm('Delete this milestone?')) return
    await supabase.from('milestones').delete().eq('id', milestoneId)
    await loadFieldData()
  }

  async function submitPmDelivery(e) {
    e.preventDefault()
    if (!pmDeliveryForm.material.trim()) return
    setSubmittingPmDelivery(true)
    const { data: { session } } = await supabase.auth.getSession()
    let bol_url = null
    if (pmDeliveryFile) {
      const ext = pmDeliveryFile.name.split('.').pop()
      const path = `${id}/bol/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('receipts').upload(path, pmDeliveryFile)
      if (!upErr) bol_url = path
    }
    await supabase.from('deliveries').insert({
      job_id: id,
      logged_by: session.user.id,
      material: pmDeliveryForm.material.trim(),
      vendor: pmDeliveryForm.vendor || null,
      expected_date: pmDeliveryForm.expected_date || null,
      quantity: pmDeliveryForm.quantity || null,
      notes: pmDeliveryForm.notes || null,
      status: 'pending',
      source: 'pm',
      bol_url,
    })
    setPmDeliveryForm({ material: '', vendor: '', expected_date: '', quantity: '', notes: '' })
    setPmDeliveryFile(null)
    setShowPmDeliveryForm(false)
    await loadFieldData()
    setSubmittingPmDelivery(false)
  }

  async function openBolUrl(path) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function loadDirectCosts() {
    const { data } = await supabase.from('direct_costs').select('*').eq('job_id', id).order('cost_date', { ascending: false })
    const costs = data || []
    const userIds = [...new Set(costs.map(c => c.submitted_by).filter(Boolean))]
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, email, full_name').in('id', userIds)
      const pmap = {}
      profiles?.forEach(p => { pmap[p.id] = p })
      costs.forEach(c => { c._profile = pmap[c.submitted_by] || null })
    }
    setDirectCosts(costs)
  }

  async function openDcReceiptUrl(path) {
    const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function submitDirectCostPM(e) {
    e.preventDefault()
    setSubmittingDc(true)
    const { data: { session } } = await supabase.auth.getSession()
    const rowData = {
      job_id: id, submitted_by: session.user.id,
      cost_date: dcForm.cost_date, description: dcForm.description,
      category: dcForm.category, amount: parseFloat(dcForm.amount),
      notes: dcForm.notes || null, budget_item_id: dcForm.budget_item_id || null,
      status: 'approved',
    }
    if (dcFile) {
      const formData = new FormData()
      formData.append('file', dcFile)
      formData.append('data', JSON.stringify(rowData))
      await fetch('/api/direct-costs', { method: 'POST', body: formData })
    } else {
      await fetch('/api/direct-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    }
    setDcForm({ cost_date: new Date().toISOString().split('T')[0], description: '', category: 'Materials', amount: '', notes: '', budget_item_id: '' })
    setDcFile(null)
    setShowDcForm(false)
    await loadDirectCosts()
    setSubmittingDc(false)
  }

  function parseCsvDirect(text) {
    const CATS = ['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Meals/Entertainment', 'Other']
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return []
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''))
    return lines.slice(1).map((line, i) => {
      const fields = []; let inQ = false, curr = ''
      for (const ch of line + ',') {
        if (ch === '"') inQ = !inQ
        else if (ch === ',' && !inQ) { fields.push(curr.trim()); curr = '' }
        else curr += ch
      }
      const get = k => { const idx = headers.indexOf(k); return idx >= 0 ? (fields[idx] || '').replace(/^"|"$/g, '').trim() : '' }
      const dateRaw = get('date')
      let cost_date = ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) cost_date = dateRaw
      else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateRaw)) {
        const [m, d, y] = dateRaw.split('/'); cost_date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`
      }
      const amount = parseFloat(get('amount').replace(/[$,]/g, ''))
      const description = get('description')
      const catRaw = get('category')
      const category = CATS.find(c => c.toLowerCase() === catRaw.toLowerCase()) || 'Materials'
      const notes = get('notes') || get('note') || ''
      const errors = []
      if (!cost_date) errors.push('bad date')
      if (!description) errors.push('no description')
      if (isNaN(amount) || amount <= 0) errors.push('bad amount')
      return { cost_date, description, category, amount: isNaN(amount) ? 0 : amount, notes, errors }
    }).filter(r => r.description || r.amount > 0)
  }

  async function submitCsvImport() {
    const valid = csvRows.filter(r => r.errors.length === 0)
    if (!valid.length) return
    setImportingCsv(true)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/direct-costs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid.map(r => ({
      job_id: id, submitted_by: session.user.id,
      cost_date: r.cost_date, description: r.description,
      category: r.category, amount: r.amount,
      notes: r.notes || null, budget_item_id: null, status: 'approved',
    }))) })
    setShowCsvImport(false); setCsvRows([]); setImportingCsv(false)
    await loadDirectCosts()
  }

  function downloadDcTemplate() {
    const csv = 'date,description,category,amount,notes\n06/06/2025,Lumber delivery,Materials,2500.00,\n06/07/2025,Concrete pour,Materials,8000.00,Foundation'
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'direct_costs_template.csv' })
    a.click()
  }

  async function updateCostStatus(costId, status, notes) {
    setUpdatingCostId(costId)
    if (status === 'rejected') {
      const cost = directCosts.find(c => c.id === costId)
      const superEmail = cost?._profile?.email
      if (superEmail) {
        sendEmail(superEmail, `Cost entry rejected — #${job?.job_number} ${job?.project_name}`,
          emailWrap(`
            <h2 style="color:#ff6b6b;margin:0 0 1rem">Cost entry rejected</h2>
            <p style="color:#aaa">Your direct cost entry <strong style="color:#f1f1f1">${cost.description}</strong> ($${Number(cost.amount).toLocaleString()}) on <strong style="color:#f1f1f1">#${job?.job_number} — ${job?.project_name}</strong> has been rejected.</p>
            ${notes ? `<div style="background:#1a0a0a;border:1px solid #3a1a1a;border-radius:8px;padding:14px 16px;margin-top:1rem"><p style="color:#888;font-size:11px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;font-weight:700">Reason</p><p style="color:#ff6b6b;margin:0;font-size:14px;line-height:1.6">${notes}</p></div>` : '<p style="color:#888;font-size:13px;margin:1rem 0 0">Contact NV Construction if you have questions.</p>'}
          `)
        )
      }
      await fetch('/api/direct-costs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId }) })
    } else {
      await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, status, notes: notes || null }) })
    }
    setRejectingCostId(null)
    setCostRejectNote('')
    await loadDirectCosts()
    setUpdatingCostId(null)
  }

  async function assignDcBudgetItem(costId, budgetItemId) {
    setAssigningCostId(costId)
    await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, budget_item_id: budgetItemId || null }) })
    await loadDirectCosts()
    setAssigningCostId(null)
  }

  function exportDirectCostsCSV() {
    const rows = [['Date', 'Description', 'Category', 'Amount', 'Budget Line', 'Status', 'Notes']]
    directCosts.forEach(c => {
      const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)?.description || ''
      rows.push([c.cost_date, c.description, c.category, c.amount, budgetLine, c.status, c.notes || ''])
    })
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `direct-costs-${job.job_number}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function uploadPrimeContract() {
    if (!primeContractFile) return
    setUploadingPrimeContract(true)
    const ext = primeContractFile.name.split('.').pop()
    const path = `${id}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('prime-contracts').upload(path, primeContractFile)
    if (!error) {
      await supabase.from('jobs').update({ prime_contract_url: path }).eq('id', id)
      setJob(j => ({ ...j, prime_contract_url: path }))
      setPrimeContractFile(null)
    }
    setUploadingPrimeContract(false)
  }

  async function openPrimeContractUrl() {
    const { data } = await supabase.storage.from('prime-contracts').createSignedUrl(job.prime_contract_url, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function loadAiaApplications() {
    const { data } = await supabase.from('aia_applications').select('*').eq('job_id', id).order('app_number', { ascending: false })
    setAiaApplications(data || [])
    return data || []
  }

  async function openAiaApp(app) {
    if (activeAia?.id === app.id) { setActiveAia(null); setAiaLines([]); setPeriodBilling([]); setAppliedBillings(new Set()); setPeriodDirectCosts([]); return }
    setAiaLoading(true)
    setActiveAia(app)
    setAppliedBillings(new Set())
    const monthPrefix = app.period_to ? app.period_to.slice(0, 7) + '-01' : null
    const linkedDrawId = app.linked_draw_request_id || null
    const prevApps = aiaApplications
      .filter(a => a.app_number < app.app_number)
      .sort((a, b) => a.app_number - b.app_number)
    const [{ data: lines }, { data: bills }, { data: dcs }, { data: prevAppLines }] = await Promise.all([
      supabase.from('aia_application_lines').select('*').eq('application_id', app.id),
      linkedDrawId
        ? supabase.from('billing_submissions').select('id, sub_id, company_name, amount_billed, retainage_held').eq('job_id', id).eq('status', 'approved').eq('draw_request_id', linkedDrawId)
        : monthPrefix
          ? supabase.from('billing_submissions').select('id, sub_id, company_name, amount_billed, retainage_held').eq('job_id', id).eq('status', 'approved').eq('billing_period', monthPrefix)
          : Promise.resolve({ data: [] }),
      supabase.from('direct_costs').select('*').eq('job_id', id).eq('status', 'approved').order('cost_date', { ascending: false }),
      prevApps.length > 0
        ? supabase.from('aia_application_lines').select('*').in('application_id', prevApps.map(a => a.id))
        : Promise.resolve({ data: [] }),
    ])
    // Recompute dollar_prev from scratch using actual previous app line data.
    // This fixes cases where dollar_this_period was null in older apps (stored before the column existed),
    // which caused the accumulated total to silently drop those periods.
    const r2 = n => Math.round(n * 100) / 100
    const budgetMap = Object.fromEntries(budgetItems.map(b => [b.id, r2(Number(b.owner_amount ?? b.budget_amount ?? 0))]))
    const dollarPrevByItem = {}
    for (const prevApp of prevApps) {
      const appLines = (prevAppLines || []).filter(l => l.application_id === prevApp.id)
      for (const l of appLines) {
        const bAmt = budgetMap[l.budget_item_id] || 0
        const thisAmt = l.dollar_this_period != null
          ? Number(l.dollar_this_period)
          : r2(bAmt * (parseFloat(l.pct_this_period) || 0) / 100)
        dollarPrevByItem[l.budget_item_id] = r2((dollarPrevByItem[l.budget_item_id] || 0) + thisAmt)
      }
    }
    const lineMap = Object.fromEntries((lines || []).map(l => [l.budget_item_id, l]))
    setAiaLines(budgetItems.map(b => {
      const bAmt = r2(Number(b.owner_amount ?? b.budget_amount ?? 0))
      const pctThis = parseFloat(lineMap[b.id]?.pct_this_period ?? 0)
      const savedDollar = lineMap[b.id]?.dollar_this_period
      const dollarThis = savedDollar != null ? r2(Number(savedDollar)) : r2(bAmt * pctThis / 100)
      const dollarPrev = prevApps.length > 0 ? (dollarPrevByItem[b.id] || 0) : (lineMap[b.id]?.dollar_prev != null ? r2(Number(lineMap[b.id].dollar_prev)) : null)
      return {
        budget_item_id: b.id,
        cost_code: b.cost_code,
        description: b.description,
        budget_amount: bAmt,
        pct_prev: String(lineMap[b.id]?.pct_prev ?? 0),
        dollar_prev: dollarPrev,
        pct_this: String(pctThis),
        dollar_this: dollarThis,
      }
    }))
    setPeriodBilling(bills || [])
    setPeriodDirectCosts(dcs || [])
    setAiaLoading(false)
  }

  async function applyBillingToAia(billing) {
    // Try SOV lines first: billing_sov_lines → subcontract_sov_lines → subcontracts → budget_item_id
    const { data: sovLines } = await supabase
      .from('billing_sov_lines')
      .select('amount, subcontract_sov_lines(subcontract_id, subcontracts(budget_item_id))')
      .eq('billing_submission_id', billing.id)

    const byBudgetItem = {}
    if (sovLines && sovLines.length > 0) {
      for (const l of sovLines) {
        const budgetItemId = l.subcontract_sov_lines?.subcontracts?.budget_item_id
        if (!budgetItemId) continue
        byBudgetItem[budgetItemId] = (byBudgetItem[budgetItemId] || 0) + Number(l.amount || 0)
      }
    }

    // Fall back: match by sub_id first, then company_name
    if (Object.keys(byBudgetItem).length === 0) {
      const contract = billing.sub_id
        ? contracts.find(c => c.sub_id === billing.sub_id)
        : contracts.find(c => c.vendor_name?.toLowerCase() === billing.company_name?.toLowerCase())
      if (contract?.budget_item_id) {
        byBudgetItem[contract.budget_item_id] = Number(billing.amount_billed || 0)
      }
    }

    // No automatic mapping found — open manual picker
    if (Object.keys(byBudgetItem).length === 0) {
      setManualMapBillingId(billing.id)
      setManualMapBudgetItemId('')
      return
    }

    applyAmountsToAiaLines(byBudgetItem, billing.id)
  }

  function applyAmountsToAiaLines(byBudgetItem, billingId) {
    const r2 = n => Math.round(n * 100) / 100
    const markupMultiplier = 1 + (parseFloat(activeAia?.markup_pct) || 0) / 100
    setAiaLines(lines => {
      const updated = lines.map(line => {
        const rawAmt = byBudgetItem[line.budget_item_id]
        if (!rawAmt) return line
        const addAmt = r2(rawAmt * markupMultiplier)
        const budgetAmt = Number(line.budget_amount || 0)
        if (budgetAmt === 0) return line
        const prevDollar = Number(line.dollar_this) || 0
        const newDollar = r2(prevDollar + addAmt)
        const newPct = budgetAmt > 0 ? newDollar / budgetAmt * 100 : 0
        return { ...line, dollar_this: newDollar, pct_this: String(newPct) }
      })
      return recalcPinnedLines(updated, pinnedLineIds)
    })
    setAppliedBillings(prev => new Set([...prev, billingId]))
    setManualMapBillingId(null)
    setManualMapBudgetItemId('')
  }

  function recalcPinnedLines(lines, pinnedIds) {
    if (!pinnedIds || pinnedIds.size === 0) return lines
    const unpinnedLines = lines.filter(l => !pinnedIds.has(l.budget_item_id))
    const totalSched = unpinnedLines.reduce((a, l) => a + Number(l.budget_amount || 0), 0)
    if (totalSched === 0) return lines
    const totalDone = unpinnedLines.reduce((a, l) => {
      const sched = Number(l.budget_amount || 0)
      const prevAmt = l.dollar_prev != null ? Number(l.dollar_prev) : sched * (parseFloat(l.pct_prev) || 0) / 100
      const thisDollar = l.dollar_this !== undefined ? Number(l.dollar_this) : sched * (parseFloat(l.pct_this) || 0) / 100
      return a + prevAmt + thisDollar
    }, 0)
    const overallPct = totalDone / totalSched * 100
    return lines.map(l => {
      if (!pinnedIds.has(l.budget_item_id)) return l
      const sched = Number(l.budget_amount || 0)
      const prevAmt = l.dollar_prev != null ? Number(l.dollar_prev) : sched * (parseFloat(l.pct_prev) || 0) / 100
      const prevPct = sched > 0 ? prevAmt / sched * 100 : 0
      const newThisPct = Math.max(0, Math.min(100 - prevPct, overallPct - prevPct))
      const newDollar = Math.round(Math.max(0, Math.min(sched - prevAmt, sched * overallPct / 100 - prevAmt)) * 100) / 100
      return { ...l, pct_this: String(newThisPct), dollar_this: newDollar }
    })
  }

  function togglePinLine(budgetItemId) {
    setPinnedLineIds(prev => {
      const next = new Set(prev)
      if (next.has(budgetItemId)) next.delete(budgetItemId)
      else next.add(budgetItemId)
      try { localStorage.setItem(`aia_pinned_${id}`, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  function applyBillingManual(billing) {
    if (!manualMapBudgetItemId) return
    applyAmountsToAiaLines({ [manualMapBudgetItemId]: Number(billing.amount_billed || 0) }, billing.id)
  }

  function autoCalcProRataLine(lineIndex) {
    const line = aiaLines[lineIndex]
    setAiaLines(lines => recalcPinnedLines(
      lines,
      new Set([...(pinnedLineIds || []), line.budget_item_id])
    ))
  }

  async function createAiaApplication() {
    const isDrawType = job?.billing_type === 'draw_request'
    if (!isDrawType && !newAiaForm.period_to) return
    if (isDrawType && !newAiaForm.linked_draw_request_id) return
    setSavingAia(true)
    const { data: { session } } = await supabase.auth.getSession()
    const prevApp = aiaApplications[0]
    let prevLines = []
    if (prevApp) {
      const { data: pl } = await supabase.from('aia_application_lines').select('*').eq('application_id', prevApp.id)
      prevLines = pl || []
    }
    let periodTo = null, periodFrom = null
    if (!isDrawType) {
      if (newAiaForm.period_from) {
        periodTo = newAiaForm.period_to
        periodFrom = newAiaForm.period_from
      } else {
        const [year, month] = newAiaForm.period_to.split('-').map(Number)
        periodTo = new Date(year, month, 0).toISOString().split('T')[0]
        periodFrom = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
      }
    }
    const linkedDraw = isDrawType ? drawRequests.find(d => d.id === newAiaForm.linked_draw_request_id) : null
    const { data: newApp, error } = await supabase.from('aia_applications').insert({
      job_id: id,
      app_number: parseInt(newAiaForm.app_number) || (aiaApplications.length + 1),
      period_from: periodFrom,
      period_to: periodTo,
      retainage_pct: isNaN(parseFloat(newAiaForm.retainage_pct)) ? 10 : parseFloat(newAiaForm.retainage_pct),
      markup_pct: parseFloat(newAiaForm.markup_pct) || 0,
      created_by: session.user.id,
      linked_draw_request_id: linkedDraw?.id || null,
    }).select().single()
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000); setSavingAia(false); return }
    if (budgetItems.length > 0) {
      const lineInserts = budgetItems.map(b => {
        const prevLine = prevLines.find(l => l.budget_item_id === b.id)
        const bAmt = Number(b.owner_amount ?? b.budget_amount ?? 0)
        // Use exact dollar amounts to avoid floating-point drift across apps
        const prevDollarPrev = prevLine?.dollar_prev != null ? Number(prevLine.dollar_prev) : bAmt * (parseFloat(prevLine?.pct_prev || 0) / 100)
        const prevDollarThis = prevLine?.dollar_this_period != null
          ? Number(prevLine.dollar_this_period)
          : bAmt * (parseFloat(prevLine?.pct_this_period || 0) / 100)
        const newDollarPrev = prevLine ? prevDollarPrev + prevDollarThis : 0
        const newPctPrev = bAmt > 0 ? Math.min(100, newDollarPrev / bAmt * 100) : 0
        return {
          application_id: newApp.id,
          budget_item_id: b.id,
          pct_prev: newPctPrev,
          dollar_prev: newDollarPrev,
          pct_this_period: 0,
          dollar_this_period: 0,
        }
      })
      await supabase.from('aia_application_lines').insert(lineInserts)
    }
    const updatedApps = await loadAiaApplications()
    setShowNewAia(false)
    const created = updatedApps.find(a => a.id === newApp.id) || newApp
    await openAiaApp(created)
    setSavingAia(false)
  }

  async function saveAiaLines() {
    if (!activeAia) return
    setSavingAia(true)
    await supabase.from('aia_applications').update({
      retainage_pct: parseFloat(activeAia.retainage_pct),
      markup_pct: parseFloat(activeAia.markup_pct) || 0,
      status: activeAia.status || 'draft',
      updated_at: new Date().toISOString(),
    }).eq('id', activeAia.id)
    for (const line of aiaLines) {
      const scheduled = Number(line.budget_amount || 0)
      const dollarRaw = line.dollar_this !== undefined ? Number(line.dollar_this) : null
      const dollarToSave = dollarRaw != null ? Math.round(dollarRaw * 100) / 100 : null
      const pctToSave = scheduled > 0 && dollarToSave != null
        ? dollarToSave / scheduled * 100
        : parseFloat(line.pct_this) || 0
      await supabase.from('aia_application_lines').update({
        pct_this_period: pctToSave,
        dollar_this_period: dollarToSave,
        dollar_prev: line.dollar_prev != null ? Number(line.dollar_prev) : null,
      }).eq('application_id', activeAia.id).eq('budget_item_id', line.budget_item_id)
    }
    await loadAiaApplications()
    setSavingAia(false)
  }

  async function deleteAiaApplication(appId) {
    if (!window.confirm('Delete this AIA application?')) return
    await supabase.from('aia_application_lines').delete().eq('application_id', appId)
    const { error } = await supabase.from('aia_applications').delete().eq('id', appId)
    if (error) { alert('Delete failed: ' + error.message); return }
    if (activeAia?.id === appId) { setActiveAia(null); setAiaLines([]); setPeriodBilling([]) }
    await loadAiaApplications()
  }

  async function markPaymentReceived(appId, current) {
    if (current) {
      if (!window.confirm('Unmark this payment as received?')) return
      await supabase.from('aia_applications').update({ payment_received: false, payment_received_at: null, amount_received: null }).eq('id', appId)
      await loadAiaApplications()
    } else {
      setPaymentForm({ appId, amount: '', received_at: new Date().toISOString().split('T')[0] })
    }
  }

  async function savePaymentReceived() {
    if (!paymentForm.appId || !paymentForm.amount) return
    setSavingPayment(true)
    const { error } = await supabase.from('aia_applications').update({
      payment_received: true,
      payment_received_at: paymentForm.received_at ? new Date(paymentForm.received_at + 'T12:00:00').toISOString() : new Date().toISOString(),
      amount_received: parseFloat(paymentForm.amount),
    }).eq('id', paymentForm.appId)
    setSavingPayment(false)
    if (error) { alert('Save failed: ' + error.message + '\n\nYou may need to run this SQL in Supabase:\nALTER TABLE aia_applications ADD COLUMN IF NOT EXISTS amount_received numeric;'); return }
    setPaymentForm({ appId: null, amount: '', received_at: new Date().toISOString().split('T')[0] })
    await loadAiaApplications()
  }

  async function drawDirectCost(costId, appId) {
    const cost = periodDirectCosts.find(c => c.id === costId)
    if (!cost?.budget_item_id) {
      alert('Assign a budget line to this cost in the Direct Costs tab before drawing.')
      return
    }
    const now = new Date().toISOString()
    await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, drawn_application_id: appId, drawn_at: now }) })
    setPeriodDirectCosts(prev => prev.map(c => c.id === costId ? { ...c, drawn_application_id: appId, drawn_at: now } : c))
    const markupMultiplier = 1 + (parseFloat(activeAia?.markup_pct) || 0) / 100
    const addAmt = Math.round(Number(cost.amount) * markupMultiplier * 100) / 100
    setAiaLines(lines => {
      const updated = lines.map(line => {
        if (line.budget_item_id !== cost.budget_item_id) return line
        const budgetAmt = Number(line.budget_amount || 0)
        if (budgetAmt === 0) return line
        const prevDollar = Number(line.dollar_this) || 0
        const newDollar = Math.min(budgetAmt, prevDollar + addAmt)
        const newPct = newDollar / budgetAmt * 100
        return { ...line, dollar_this: newDollar, pct_this: String(newPct) }
      })
      return recalcPinnedLines(updated, pinnedLineIds)
    })
  }

  async function undrawDirectCost(costId) {
    await fetch('/api/direct-costs', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: costId, drawn_application_id: null, drawn_at: null }) })
    setPeriodDirectCosts(prev => prev.map(c => c.id === costId ? { ...c, drawn_application_id: null, drawn_at: null } : c))
  }

  function generateAIAFromApp() {
    if (!activeAia) return
    const app = activeAia
    const retPct = Math.max(0, Math.min(100, isNaN(parseFloat(app.retainage_pct)) ? 10 : parseFloat(app.retainage_pct))) / 100
    const approvedCOsVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
    const subNvTotal = nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0)
    const baseContract = Number(job.contract_value || 0)
    const contractSumToDate = job.nv_role === 'sub'
      ? (subNvTotal > 0 ? subNvTotal : baseContract)
      : baseContract + approvedCOsVal
    const origContract = job.nv_role === 'sub' ? contractSumToDate : baseContract
    const periodDate = app.period_to ? new Date(app.period_to + 'T12:00:00').toLocaleDateString() : '—'
    const genDate = new Date().toLocaleDateString()
    const fmt = n => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const fmtSigned = n => (n < 0 ? '-' : '') + fmt(n)

    const r2 = n => Math.round(n * 100) / 100
    const sovLines = aiaLines.map((line, idx) => {
      const scheduled = r2(Number(line.budget_amount || 0))
      const prevAmt = line.dollar_prev != null ? r2(Number(line.dollar_prev)) : r2(scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100)
      const thisAmt = line.dollar_this !== undefined
        ? r2(Number(line.dollar_this))
        : r2(scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0)) / 100)
      const totalAmt = prevAmt + thisAmt
      const totalPct = scheduled > 0 ? Math.min(100, totalAmt / scheduled * 100) : 0
      const balance = scheduled - totalAmt
      return { ...line, idx: idx + 1, scheduled, prevAmt, thisAmt, totalAmt, totalPct, balance, retainage: totalAmt * retPct }
    })

    const totalScheduled = sovLines.reduce((a, l) => a + l.scheduled, 0)
    const totalPrev = sovLines.reduce((a, l) => a + l.prevAmt, 0)
    const totalThis = sovLines.reduce((a, l) => a + l.thisAmt, 0)
    const totalCompleted = sovLines.reduce((a, l) => a + l.totalAmt, 0)
    const totalRetainage = sovLines.reduce((a, l) => a + l.retainage, 0)
    const totalEarnedLessRet = totalCompleted - totalRetainage
    const prevCertificates = totalPrev * (1 - retPct)
    const currentPaymentDue = totalEarnedLessRet - prevCertificates
    const balanceToFinish = contractSumToDate - totalCompleted
    const overallPct = totalScheduled > 0 ? (totalCompleted / totalScheduled * 100).toFixed(1) : '0.0'

    if (Math.abs(totalScheduled - contractSumToDate) > 0.01) {
      const diff = contractSumToDate - totalScheduled
      const coMsg = approvedCOsVal !== 0 ? `\n\nOriginal contract: ${fmt(origContract)}\nApproved change orders: ${approvedCOsVal >= 0 ? '+' : ''}${fmtSigned(approvedCOsVal)}\nContract sum to date: ${fmt(contractSumToDate)}` : ''
      window.alert(`Cannot generate AIA — SOV total doesn't match contract sum to date.\n\nSOV total: ${fmt(totalScheduled)}\nContract sum to date: ${fmt(contractSumToDate)}\nDifference: ${diff > 0 ? '+' : ''}${fmtSigned(diff)}${coMsg}\n\nGo to the Budget tab and ${diff > 0 ? `add ${fmt(Math.abs(diff))} to one or more owner amounts` : `reduce owner amounts by ${fmt(Math.abs(diff))}`} so the totals match.`)
      return
    }

    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head>
<title>AIA G702/G703 — App #${app.app_number} — Job #${job.job_number}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11px; color: #111; padding: 24px; line-height: 1.5; }
.btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 12px; margin-bottom: 20px; margin-right: 8px; }
@media print { .btn { display: none; } }
h1 { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; border-bottom: 3px solid #111; padding-bottom: 8px; margin-bottom: 4px; }
.sub { font-size: 10px; color: #777; margin-bottom: 18px; }
.hgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
.hblock { border: 1px solid #ddd; padding: 10px 12px; border-radius: 4px; }
.hlabel { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 2px; }
.hval { font-size: 12px; font-weight: 700; }
.hsub { font-size: 10px; color: #666; margin-top: 2px; }
.stitle { font-size: 9px; text-transform: uppercase; letter-spacing: 2px; color: #666; font-weight: 700; margin: 18px 0 8px; border-bottom: 1px solid #eee; padding-bottom: 5px; }
.g702 { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
.g702 td { padding: 6px 10px; border-bottom: 1px solid #f0f0f0; }
.g702 td:first-child { color: #888; width: 28px; font-size: 10px; }
.g702 td:last-child { text-align: right; font-family: monospace; font-size: 12px; font-weight: 600; min-width: 130px; }
.g702 tr.due td { font-weight: 800; font-size: 13px; border-top: 2px solid #111; background: #f5f5f5; }
.page-break { page-break-before: always; padding-top: 24px; }
.g703 { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px; }
.g703 th { padding: 5px 7px; border: 1px solid #ccc; background: #f0f0f0; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.3px; text-align: center; line-height: 1.3; }
.g703 td { padding: 5px 7px; border: 1px solid #e8e8e8; }
.g703 td.r { text-align: right; font-family: monospace; }
.g703 td.c { text-align: center; }
.g703 td.code { font-family: monospace; font-size: 9px; color: #888; }
.g703 tr.tot td { font-weight: 700; border-top: 2px solid #111; background: #f5f5f5; }
.foot { margin-top: 24px; font-size: 9px; color: #bbb; border-top: 1px solid #eee; padding-top: 8px; }
</style></head><body>
<button class="btn" onclick="window.print()">Print / Save as PDF</button>
<button class="btn" style="background:#666" onclick="window.close()">Close</button>

<h1>Application and Certificate for Payment</h1>
<div class="sub">AIA Document G702 &nbsp;·&nbsp; Application No. ${app.app_number} &nbsp;·&nbsp; Period to: ${periodDate}</div>

<div class="hgrid">
  <div>
    <div class="hblock" style="margin-bottom:10px">
      <div class="hlabel">To Owner</div>
      <div class="hval">${job.owner_company || '—'}</div>
      ${job.owner_name ? `<div class="hsub">${job.owner_name}</div>` : ''}
    </div>
    <div class="hblock">
      <div class="hlabel">Via Architect</div>
      <div class="hval">${job.architect_name || job.architect_company || '—'}</div>
      ${job.architect_company && job.architect_name ? `<div class="hsub">${job.architect_company}</div>` : ''}
    </div>
  </div>
  <div>
    <div class="hblock" style="margin-bottom:10px">
      <div class="hlabel">From Contractor</div>
      <div class="hval">NV Construction</div>
    </div>
    <div class="hblock">
      <div class="hlabel">Project</div>
      <div class="hval">${job.project_name}</div>
      <div class="hsub">Contract No. ${job.job_number}${job.location ? ' &nbsp;·&nbsp; ' + job.location : ''}</div>
    </div>
  </div>
</div>

<div class="stitle">Contractor's Application for Payment (G702)</div>
<table class="g702">
  <tr><td>1.</td><td>Original Contract Sum</td><td>${fmt(origContract)}</td></tr>
  <tr><td>2.</td><td>Net Change by Change Orders</td><td>${approvedCOsVal >= 0 ? '+' : ''}${fmtSigned(approvedCOsVal)}</td></tr>
  <tr><td>3.</td><td>Contract Sum to Date (Line 1 ± 2)</td><td>${fmt(contractSumToDate)}</td></tr>
  <tr><td>4.</td><td>Total Completed &amp; Stored to Date (column G, G703)</td><td>${fmt(totalCompleted)}</td></tr>
  <tr><td>5.</td><td>Retainage: ${app.retainage_pct}% of Completed Work</td><td>(${fmt(totalRetainage)})</td></tr>
  <tr><td>6.</td><td>Total Earned Less Retainage (Line 4 less 5)</td><td>${fmt(totalEarnedLessRet)}</td></tr>
  <tr><td>7.</td><td>Less Previous Certificates for Payment</td><td>(${fmt(prevCertificates)})</td></tr>
  <tr class="due"><td>8.</td><td>CURRENT PAYMENT DUE</td><td>${fmtSigned(currentPaymentDue)}</td></tr>
  <tr><td>9.</td><td>Balance to Finish, Including Retainage (Line 3 less 4)</td><td>${fmtSigned(balanceToFinish)}</td></tr>
</table>

${sovLines.length > 0 ? `
<div class="page-break">
<h1>Continuation Sheet</h1>
<div class="sub">AIA Document G703 &nbsp;·&nbsp; Application No. ${app.app_number} &nbsp;·&nbsp; ${job.project_name} &nbsp;·&nbsp; Contract No. ${job.job_number} &nbsp;·&nbsp; Period to: ${periodDate}</div>
<table class="g703">
  <thead><tr>
    <th style="width:28px">A<br>No.</th>
    <th style="width:22px">B<br>Code</th>
    <th>C — Description of Work</th>
    <th>D<br>Scheduled<br>Value</th>
    <th>E<br>Work Completed<br>From Previous<br>Application</th>
    <th>F<br>Work Completed<br>This Period</th>
    <th>G<br>Total Completed<br>&amp; Stored to Date</th>
    <th>%<br>G/C</th>
    <th>H<br>Balance<br>to Finish</th>
    <th>I<br>Retainage</th>
  </tr></thead>
  <tbody>
    ${sovLines.filter(l => l.scheduled > 0).map(l => `<tr>
      <td class="c">${l.idx}</td>
      <td class="code">${l.cost_code || ''}</td>
      <td>${l.description}</td>
      <td class="r">${fmt(l.scheduled)}</td>
      <td class="r">${fmt(l.prevAmt)}</td>
      <td class="r">${fmt(l.thisAmt)}</td>
      <td class="r">${fmt(l.totalAmt)}</td>
      <td class="c">${l.totalPct.toFixed(0)}%</td>
      <td class="r">${fmtSigned(l.balance)}</td>
      <td class="r">${fmt(l.retainage)}</td>
    </tr>`).join('')}
    <tr class="tot">
      <td colspan="3">TOTALS</td>
      <td class="r">${fmt(totalScheduled)}</td>
      <td class="r">${fmt(totalPrev)}</td>
      <td class="r">${fmt(totalThis)}</td>
      <td class="r">${fmt(totalCompleted)}</td>
      <td class="c">${overallPct}%</td>
      <td class="r">${fmtSigned(balanceToFinish)}</td>
      <td class="r">${fmt(totalRetainage)}</td>
    </tr>
  </tbody>
</table>
</div>` : ''}

<div class="foot">Generated ${genDate} &nbsp;·&nbsp; NV Construction &nbsp;·&nbsp; Job #${job.job_number} — ${job.project_name}</div>
</body></html>`)
    w.document.close()
  }

  useEffect(() => {
    if (!id) return
    if (activeTab === 'details') { loadNvSubcontracts() }
    if (activeTab === 'contracts') { loadContracts(); loadBudgetItems(); loadSubDirectory() }
    if (activeTab === 'budget') { loadBudgetItems(); loadContracts(); loadDirectCosts(); loadBillingByItem(); loadPrimeCOs() }
    if (activeTab === 'changeorders') { loadContracts(); loadAllCOs(); loadPrimeCOs() }
    if (activeTab === 'billing') { loadBillingForJob(); loadContracts(); reloadSubs(); loadDrawRequests(); loadDirectCosts() }
    if (activeTab === 'subs') { loadSubDirectory() }
    if (activeTab === 'field') { loadFieldData() }
    if (activeTab === 'photos') { loadFieldPhotos() }
    if (activeTab === 'costs') { loadDirectCosts(); loadBudgetItems(); loadAiaApplications() }
    if (activeTab === 'prime') { loadBudgetItems(); loadAllCOs(); loadPrimeCOs(); loadAiaApplications(); loadContracts(); loadDrawRequests(); loadNvSubcontracts() }
    if (activeTab === 'schedule') { loadScheduleFiles() }
    if (activeTab === 'documents') { loadJobDocs() }
    if (activeTab === 'contacts') { loadJobContacts() }
    if (activeTab === 'labor' && !laborLoaded) { loadLaborData() }
    if (activeTab === 'closeout') { loadPunchItems(); loadRetainageReleases(); loadPrelimNotices() }
    if (activeTab === 'punch') { loadPunchItems(); loadContracts() }
    if (activeTab === 'retainage') { loadRetainageReleases(); loadContracts(); loadBillingForJob() }
    if (activeTab === 'submittals') { loadSubmittals(); loadContracts() }
    if (activeTab === 'prelim') { loadPrelimNotices() }
    if (activeTab === 'cashflow') { loadBillingForJob(); loadContracts(); loadDirectCosts(); loadDrawRequests(); loadAiaApplications() }
    if (activeTab === 'subs') { loadSubDirectory(); loadSubRatings() }
    if (activeTab === 'warranty') { loadWarranty(); loadContracts(); if (!laborLoaded) loadLaborData() }
  }, [activeTab, id])

  async function loadNvSubcontracts() {
    const { data } = await supabase.from('nv_subcontracts').select('*').eq('job_id', id).order('created_at', { ascending: true })
    setNvSubcontracts(data || [])
  }

  async function addNvSubcontract(e) {
    e.preventDefault()
    setAddingNvSub(true)
    const { error } = await supabase.from('nv_subcontracts').insert({
      job_id: id,
      gc_name: nvSubForm.gc_name || null,
      contract_number: nvSubForm.contract_number || null,
      scope_description: nvSubForm.scope_description || null,
      contract_value: nvSubForm.contract_value ? parseFloat(nvSubForm.contract_value) : null,
      status: nvSubForm.status || 'active',
      signed_date: nvSubForm.signed_date || null,
      notes: nvSubForm.notes || null,
    })
    setAddingNvSub(false)
    if (error) { setErrMsg('Error: ' + error.message); setTimeout(() => setErrMsg(''), 4000); return }
    setNvSubForm({ gc_name: '', contract_number: '', scope_description: '', contract_value: '', status: 'active', signed_date: '', notes: '' })
    setShowNvSubForm(false)
    await loadNvSubcontracts()
  }

  async function saveNvSubcontract(e) {
    e.preventDefault()
    setSavingNvSub(true)
    const { error } = await supabase.from('nv_subcontracts').update({
      gc_name: editNvSubForm.gc_name || null,
      contract_number: editNvSubForm.contract_number || null,
      scope_description: editNvSubForm.scope_description || null,
      contract_value: editNvSubForm.contract_value ? parseFloat(editNvSubForm.contract_value) : null,
      status: editNvSubForm.status || 'active',
      signed_date: editNvSubForm.signed_date || null,
      notes: editNvSubForm.notes || null,
    }).eq('id', editingNvSubId)
    setSavingNvSub(false)
    if (error) { setErrMsg('Error: ' + error.message); setTimeout(() => setErrMsg(''), 4000); return }
    setEditingNvSubId(null)
    await loadNvSubcontracts()
  }

  async function deleteNvSubcontract(subId) {
    if (!confirm('Delete this subcontract?')) return
    await supabase.from('nv_subcontracts').delete().eq('id', subId)
    await loadNvSubcontracts()
  }

  async function loadWarranty() {
    const [settingsRes, ordersRes] = await Promise.all([
      fetch(`/api/warranty-settings?job_id=${id}`),
      fetch(`/api/warranty-orders?job_id=${id}`)
    ])
    const { setting } = await settingsRes.json()
    const { orders } = await ordersRes.json()
    setWarrantySetting(setting || null)
    setWarrantyOrders(orders || [])
    if (setting) setWarrantySettingForm({ start_date: setting.start_date || '', end_date: setting.end_date || '', coverage_notes: setting.coverage_notes || '' })
  }


  // ── Field Photos ────────────────────────────────────────────
  function fpThumb(path) { return path?.replace(/\.jpg$/i, '_thumb.jpg') ?? null }

  async function fetchFieldPhotoUrls(paths) {
    const clean = [...new Set(paths.filter(Boolean))]
    if (!clean.length) return
    const toSign = [...new Set([...clean, ...clean.map(fpThumb).filter(Boolean)])]
    const { data } = await supabase.storage.from('daily-report-photos').createSignedUrls(toSign, 7200)
    if (data) setFieldPhotoUrls(prev => { const u = { ...prev }; data.forEach(d => { if (d.signedUrl) u[d.path] = d.signedUrl }); return u })
  }

  async function loadFieldPhotos() {
    const [{ data: standalone }, { data: reports }] = await Promise.all([
      supabase.from('job_photos').select('*').eq('job_id', id).order('taken_at', { ascending: false }),
      supabase.from('daily_reports').select('id, report_date, photos').eq('job_id', id).order('report_date', { ascending: false }),
    ])
    const all = [
      ...(standalone || []).map(p => ({ path: p.storage_path, caption: p.caption, tag: p.tag || null, date: p.taken_at?.split('T')[0], name: p.file_name })),
      ...((reports || []).flatMap(r => (r.photos || []).map(p => ({ path: p.path, caption: p.caption, tag: p.tag || null, date: r.report_date, name: p.name, fromReport: true, reportId: r.id })))),
    ].sort((a, b) => new Date(b.date) - new Date(a.date))
    setFieldPhotos(all)
    const paths = all.map(p => p.path).filter(Boolean)
    if (paths.length) fetchFieldPhotoUrls(paths)
  }

  async function deleteFieldPhoto(photo) {
    if (!window.confirm('Delete this photo? This cannot be undone.')) return
    setDeletingFieldPhoto(photo.path)
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const res = await fetch('/api/delete-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ path: photo.path, fromReport: photo.fromReport || false, reportId: photo.reportId || null, jobId: id }),
      })
      if (!res.ok) { const e = await res.json(); alert('Delete failed: ' + (e.error || 'Unknown error')); return }
      // If lightbox is open on this photo, close it
      if (fieldLightbox && fieldLightbox.photos[fieldLightbox.index]?.path === photo.path) setFieldLightbox(null)
      await loadFieldPhotos()
    } catch (err) {
      alert('Delete failed: ' + err.message)
    } finally {
      setDeletingFieldPhoto(null)
    }
  }

  // ── Sub SOV ─────────────────────────────────────────────────
  async function loadContractSov(contractId) {
    const { data: lines } = await supabase.from('subcontract_sov_lines').select('*, budget_items(id, description, cost_code)').eq('subcontract_id', contractId).order('sort_order').order('created_at')
    if (!lines || lines.length === 0) { setContractSovLines(prev => ({ ...prev, [contractId]: [] })); return }
    const lineIds = lines.map(l => l.id)
    const { data: billedData } = await supabase.from('billing_sov_lines').select('sov_line_id, amount, billing_submissions(status)').in('sov_line_id', lineIds)
    const approvedBilled = {}
    ;(billedData || []).forEach(b => {
      if (b.billing_submissions?.status === 'approved') {
        approvedBilled[b.sov_line_id] = (approvedBilled[b.sov_line_id] || 0) + Number(b.amount || 0)
      }
    })
    setContractSovLines(prev => ({ ...prev, [contractId]: lines.map(l => ({ ...l, billed_to_date: approvedBilled[l.id] || 0 })) }))
  }

  async function addSovLine(contractId) {
    if (!sovLineForm.description || !sovLineForm.scheduled_value) return
    setAddingSovLine(true)
    await supabase.from('subcontract_sov_lines').insert({
      subcontract_id: contractId,
      description: sovLineForm.description,
      scheduled_value: parseFloat(sovLineForm.scheduled_value),
      budget_item_id: sovLineForm.budget_item_id || null,
      sort_order: (contractSovLines[contractId]?.length || 0) + 1,
    })
    setSovLineForm({ description: '', scheduled_value: '', budget_item_id: '' })
    setShowAddSovLine(null)
    await loadContractSov(contractId)
    setAddingSovLine(false)
  }

  async function updateSovLine(lineId, contractId) {
    await supabase.from('subcontract_sov_lines').update({
      description: editSovLineForm.description,
      scheduled_value: parseFloat(editSovLineForm.scheduled_value),
      budget_item_id: editSovLineForm.budget_item_id || null,
    }).eq('id', lineId)
    setEditingSovLine(null)
    await loadContractSov(contractId)
  }

  async function deleteSovLine(lineId, contractId) {
    if (!window.confirm('Delete this SOV line?')) return
    await supabase.from('subcontract_sov_lines').delete().eq('id', lineId)
    await loadContractSov(contractId)
  }

  async function loadBillingSov(submissionId) {
    const { data } = await supabase.from('billing_sov_lines').select('*, subcontract_sov_lines(description, scheduled_value)').eq('billing_submission_id', submissionId)
    setBillingSovData(prev => ({ ...prev, [submissionId]: data || [] }))
  }

  // ── Schedule ────────────────────────────────────────────────
  async function loadScheduleFiles() {
    const { data } = await supabase.from('job_schedule_files').select('*').eq('job_id', id).order('uploaded_at', { ascending: false })
    setScheduleFiles(data || [])
  }

  async function uploadScheduleFile(file, meta = {}) {
    setUploadingSchedule(true)
    const path = `${id}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('schedule-files').upload(path, file)
    if (error) { alert('Upload error: ' + error.message); setUploadingSchedule(false); return }
    await supabase.from('job_schedule_files').insert({
      job_id: id, file_name: file.name, storage_path: path,
      file_type: file.name.split('.').pop().toLowerCase(),
      revision: meta.revision || null,
      notes: meta.notes || null,
    })
    if (file.name.toLowerCase().endsWith('.xml')) {
      const text = await file.text()
      const tasks = parseProjectXml(text)
      setParsedTasks(tasks)
      setParsedFrom(file.name)
    }
    await loadScheduleFiles()
    setUploadingSchedule(false)
    setShowScheduleUpload(false)
    setScheduleUploadMeta({ revision: '', notes: '' })
  }

  async function openScheduleFile(storagePath) {
    const { data } = await supabase.storage.from('schedule-files').createSignedUrl(storagePath, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteScheduleFile(fileId, storagePath) {
    if (!window.confirm('Delete this file?')) return
    await supabase.storage.from('schedule-files').remove([storagePath])
    await supabase.from('job_schedule_files').delete().eq('id', fileId)
    await loadScheduleFiles()
    if (parsedFrom && storagePath.includes(parsedFrom)) { setParsedTasks(null); setParsedFrom(null) }
  }

  async function loadJobDocs() {
    const { data } = await supabase.from('job_documents').select('*').eq('job_id', id).order('uploaded_at', { ascending: false })
    setJobDocs(data || [])
  }

  async function uploadJobDoc(file) {
    setUploadingDoc(true)
    const path = `${id}/${docCategory}/${Date.now()}-${file.name}`
    const res = await fetch('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'upload-url', path }),
    })
    const { signedUrl, error: urlErr } = await res.json()
    if (urlErr || !signedUrl) { alert('Upload error: ' + (urlErr || 'Could not get upload URL')); setUploadingDoc(false); return }
    const up = await fetch(signedUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } })
    if (!up.ok) {
      let msg = 'Upload failed'
      try { const b = await up.json(); if (b.message) msg = b.message } catch {}
      alert('Upload error: ' + msg)
      setUploadingDoc(false)
      return
    }
    await supabase.from('job_documents').insert({ job_id: id, file_name: file.name, storage_path: path, category: docCategory, uploaded_by: (await supabase.auth.getUser()).data.user?.id })
    await loadJobDocs()
    setUploadingDoc(false)
  }

  async function openJobDoc(storagePath) {
    const res = await fetch('/api/job-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'signed-url', path: storagePath }),
    })
    const { url } = await res.json()
    if (url) window.open(url, '_blank')
  }

  async function deleteJobDoc(docId, storagePath) {
    if (!window.confirm('Delete this document?')) return
    await supabase.storage.from('job-documents').remove([storagePath])
    await supabase.from('job_documents').delete().eq('id', docId)
    await loadJobDocs()
  }

  async function loadJobContacts() {
    const { data } = await supabase.from('job_contacts').select('*').eq('job_id', id).order('created_at', { ascending: true })
    setJobContacts(data || [])
  }

  async function saveContact() {
    if (!contactForm.name.trim()) return
    setSavingContact(true)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('job_contacts').insert({ ...contactForm, job_id: id, created_by: user?.id })
    setContactForm({ name: '', company: '', role: '', phone: '', email: '', notes: '' })
    setAddingContact(false)
    setSavingContact(false)
    await loadJobContacts()
  }

  async function deleteContact(contactId) {
    if (!window.confirm('Delete this contact?')) return
    await supabase.from('job_contacts').delete().eq('id', contactId)
    await loadJobContacts()
  }

  async function loadPunchItems() {
    const res = await fetch(`/api/punch-list?job_id=${id}`)
    const { items } = await res.json()
    setPunchItems(items || [])
  }

  async function loadRetainageReleases() {
    const res = await fetch(`/api/retainage-release?job_id=${id}`)
    const { releases } = await res.json()
    setRetainageReleases(releases || [])
  }

  async function loadSubmittals() {
    const res = await fetch(`/api/submittals?job_id=${id}`)
    const { submittals: data } = await res.json()
    setSubmittals(data || [])
  }

  async function loadPrelimNotices() {
    const res = await fetch(`/api/prelim-notices?job_id=${id}`)
    const { notices } = await res.json()
    setPrelimNotices(notices || [])
  }

  async function loadSubRatings() {
    const res = await fetch(`/api/sub-ratings?job_id=${id}`)
    const { ratings } = await res.json()
    setSubRatings(ratings || [])
  }

  async function loadMessages(subId) {
    const res = await fetch(`/api/messages?job_id=${id}&sub_id=${subId}`)
    const { messages } = await res.json()
    setMessageThreads(prev => ({ ...prev, [subId]: messages || [] }))
  }

  async function sendMessage(subId, senderName) {
    const msg = messageDraft[subId]?.trim()
    if (!msg) return
    setSendingMessageFor(subId)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: id, sub_id: subId, sender_id: session.user.id, sender_name: senderName || 'PM', sender_role: 'pm', message: msg }),
    })
    setMessageDraft(prev => ({ ...prev, [subId]: '' }))
    setSendingMessageFor(null)
    await loadMessages(subId)
  }

  async function addPunchItem() {
    if (!punchForm.title.trim()) return
    setSavingPunch(true)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/punch-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...punchForm, job_id: id, created_by: session.user.id, assigned_sub_id: punchForm.assigned_sub_id || null }),
    })
    setPunchForm({ title: '', description: '', assigned_sub_id: '', assigned_company: '', due_date: '' })
    setShowAddPunch(false)
    setSavingPunch(false)
    await loadPunchItems()
  }

  async function updatePunchStatus(itemId, status, notes) {
    setUpdatingPunchId(itemId)
    await fetch('/api/punch-list', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, status, pm_notes: notes }),
    })
    setUpdatingPunchId(null)
    await loadPunchItems()
  }

  async function releaseRetainage() {
    if (!releaseForm.company_name || !releaseForm.amount) return
    setSavingRelease(true)
    const { data: { session } } = await supabase.auth.getSession()
    const contract = contracts.find(c => c.id === releaseForm.subcontract_id)
    await fetch('/api/retainage-release', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...releaseForm, job_id: id, released_by: session.user.id, sub_id: contract?.sub_id || null }),
    })
    setReleaseForm({ subcontract_id: '', company_name: '', amount: '', notes: '' })
    setShowReleaseForm(false)
    setSavingRelease(false)
    await loadRetainageReleases()
  }

  async function addSubmittal() {
    if (!submittalForm.title.trim()) return
    setSavingSubmittal(true)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/submittals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...submittalForm, job_id: id, submitted_by_sub_id: submittalForm.submitted_by_sub_id || null }),
    })
    setSubmittalForm({ title: '', type: 'shop_drawing', spec_section: '', submitted_by_sub_id: '', submitted_by_company: '', notes: '' })
    setShowAddSubmittal(false)
    setSavingSubmittal(false)
    await loadSubmittals()
  }

  async function reviewSubmittal(submittalId, status) {
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/submittals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: submittalId, status, reviewer_id: session.user.id, notes: submittalReviewNote[submittalId] || undefined }),
    })
    await loadSubmittals()
  }

  async function addPrelimNotice() {
    if (!prelimForm.from_company.trim()) return
    setSavingPrelim(true)
    await fetch('/api/prelim-notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...prelimForm, job_id: id }),
    })
    setPrelimForm({ from_company: '', amount_claimed: '', received_at: new Date().toISOString().split('T')[0], notes: '' })
    setShowAddPrelim(false)
    setSavingPrelim(false)
    await loadPrelimNotices()
  }

  async function saveSubRating(subId) {
    const form = ratingForms[subId]
    if (!form?.quality) return
    setSavingRatingFor(subId)
    const { data: { session } } = await supabase.auth.getSession()
    await fetch('/api/sub-ratings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub_id: subId, job_id: id, rated_by: session.user.id, ...form }),
    })
    setSavingRatingFor(null)
    setShowRatingFor(null)
    await loadSubRatings()
  }

  async function loadLaborData() {
    const [allocRes, empRes] = await Promise.all([
      fetch(`/api/employee-allocations?job_id=${id}`).then(r => r.json()),
      fetch('/api/employees').then(r => r.json()),
    ])
    setLaborAllocations(allocRes.allocations || [])
    setAllEmployees(empRes.employees || [])
    setLaborLoaded(true)
  }

  function allocWeeks(alloc) {
    const ms = new Date(alloc.end_date) - new Date(alloc.start_date)
    return Math.max(0, Math.round(ms / (7 * 24 * 60 * 60 * 1000) * 10) / 10)
  }

  function allocWeeklyRate(alloc) {
    const e = alloc.employees
    if (!e) return 0
    return Number(e.weekly_salary || 0) + Number(e.weekly_truck || 0) + Number(e.weekly_healthcare || 0) + Number(e.weekly_taxes || 0)
  }

  function allocCost(alloc) {
    return allocWeeklyRate(alloc) * allocWeeks(alloc)
  }

  function allocDrawn(alloc) {
    const today = new Date()
    const start = new Date(alloc.start_date)
    const end = new Date(alloc.end_date)
    if (today <= start) return 0
    const totalWeeks = allocWeeks(alloc)
    const elapsedWeeks = Math.min((today - start) / (7 * 24 * 60 * 60 * 1000), totalWeeks)
    return allocWeeklyRate(alloc) * elapsedWeeks
  }

  async function saveAllocation() {
    if (!laborForm.employee_id || !laborForm.start_date || !laborForm.end_date) return
    setSavingLabor(true)
    const res = await fetch('/api/employee-allocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: laborForm.employee_id, job_id: id, start_date: laborForm.start_date, end_date: laborForm.end_date, budget_line: laborForm.budget_line || null, notes: laborForm.notes || null }),
    })
    const data = await res.json()
    if (data.error) { setLaborMsg({ text: data.error, ok: false }); setSavingLabor(false); return }
    setLaborAllocations(prev => [data.allocation, ...prev])
    setLaborForm({ employee_id: '', start_date: '', end_date: '', budget_line: '', notes: '' })
    setShowAddLabor(false)
    setLaborMsg({ text: 'Allocation saved', ok: true })
    setSavingLabor(false)
    setTimeout(() => setLaborMsg(null), 3000)
  }

  async function deleteAllocation(allocId) {
    if (!window.confirm('Remove this allocation?')) return
    await fetch(`/api/employee-allocations?id=${allocId}`, { method: 'DELETE' })
    setLaborAllocations(prev => prev.filter(a => a.id !== allocId))
  }

  function parseProjectXml(xmlText) {
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xmlText, 'application/xml')
      const taskNodes = doc.querySelectorAll('Tasks > Task')
      const tasks = []
      taskNodes.forEach(t => {
        const uid = t.querySelector('UID')?.textContent
        if (uid === '0') return
        const name = t.querySelector('Name')?.textContent || ''
        const start = t.querySelector('Start')?.textContent || ''
        const finish = t.querySelector('Finish')?.textContent || ''
        const pct = t.querySelector('PercentComplete')?.textContent || '0'
        const milestone = t.querySelector('Milestone')?.textContent === '1'
        const summary = t.querySelector('Summary')?.textContent === '1'
        if (!name) return
        tasks.push({ uid, name, start: start.slice(0, 10), finish: finish.slice(0, 10), pct: parseInt(pct, 10), milestone, summary })
      })
      return tasks
    } catch { return [] }
  }

  // ── Contracts ──────────────────────────────────────────────
  async function addContract() {
    if (!contractForm.dir_id || !contractForm.contract_value || !contractForm.description) return
    setAddingContract(true)
    const { data: { session } } = await supabase.auth.getSession()
    const dirEntry = subDirectory.find(d => d.id === contractForm.dir_id)
    const matchedSub = subs.find(s => s.sub_email?.toLowerCase() === dirEntry?.email?.toLowerCase() && s.sub_id)
    let subUserId = matchedSub?.sub_id || null
    if (!subUserId && dirEntry?.email) {
      const r = await fetch(`/api/company-members?email=${encodeURIComponent(dirEntry.email.toLowerCase())}`)
      const d = await r.json()
      subUserId = d.members?.[0]?.id || null
    }
    const validAllocs = (contractForm.budget_allocations || []).filter(a => a.budget_item_id && a.amount)
    const singleBudgetId = validAllocs.length === 1 ? validAllocs[0].budget_item_id : (contractForm.budget_item_id || null)
    const scRes = await fetch('/api/subcontracts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      job_id: id, sub_id: subUserId, vendor_name: dirEntry?.company_name || '',
      contract_value: parseFloat(contractForm.contract_value),
      description: contractForm.description || null, onedrive_url: contractForm.onedrive_url || null,
      budget_item_id: singleBudgetId, budget_allocations: validAllocs.length > 0 ? validAllocs : null,
      retainage_pct: parseFloat(contractForm.retainage_pct) || 0, created_by: session.user.id, status: 'active',
    }) })
    const scJson = await scRes.json()
    if (!scRes.ok) { setErrMsg(scJson.error || 'Failed to save contract'); setTimeout(() => setErrMsg(''), 4000) }
    else {
      setShowAddContract(false); setContractForm(emptyContract); await loadContracts()
      // Auto-assign sub to job if not already assigned
      if (dirEntry?.email) {
        const alreadyAssigned = subs.some(s => s.sub_email?.toLowerCase() === dirEntry.email.toLowerCase())
        if (!alreadyAssigned) {
          await fetch('/api/job-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, sub_email: dirEntry.email.toLowerCase(), sub_id: subUserId || null, invited_at: new Date().toISOString() }) })
          await reloadSubs()
        }
      }
      if (dirEntry?.email) {
        const firstName = dirEntry.contact_name?.split(' ')[0] || 'there'
        const contractAmt = parseFloat(contractForm.contract_value).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
        const portalUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://nv-construction-doym.vercel.app') + '/submit'
        sendEmail(dirEntry.email, `Action required: Set up your Schedule of Values — ${job?.project_name || ''}`,
          emailWrap(`
            <h2 style="color:#f1f1f1;margin:0 0 8px;font-size:18px">Hey ${firstName},</h2>
            <p style="color:#aaa;margin:0 0 16px;font-size:14px;line-height:1.6">
              Your subcontract for <strong style="color:#f1f1f1">${job?.project_name || 'the project'}</strong> has been issued
              ${contractForm.description ? `(${contractForm.description})` : ''} for <strong style="color:#e8590c">${contractAmt}</strong>.
            </p>
            <p style="color:#aaa;margin:0 0 20px;font-size:14px;line-height:1.6">
              Before you can submit billing, you need to create your <strong style="color:#f1f1f1">Schedule of Values</strong> — a breakdown of your contract into line items that you'll bill against each period.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 24px">
              <tr>
                <td style="background:#e8590c;border-radius:8px">
                  <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">Set Up My SOV</a>
                </td>
              </tr>
            </table>
            <p style="color:#555;font-size:12px;margin:0">Log in, select the project, and you'll be prompted to create your schedule before billing is available.</p>
          `)
        )
      }
    }
    setAddingContract(false)
  }

  async function updateContract() {
    const validAllocs = (editContractForm.budget_allocations || []).filter(a => a.budget_item_id && a.amount)
    const singleBudgetId = validAllocs.length === 1 ? validAllocs[0].budget_item_id : (editContractForm.budget_item_id || null)
    const scUpRes = await fetch('/api/subcontracts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      id: editingContract, contract_value: parseFloat(editContractForm.contract_value),
      description: editContractForm.description || null, onedrive_url: editContractForm.onedrive_url || null,
      budget_item_id: singleBudgetId, budget_allocations: validAllocs.length > 0 ? validAllocs : null,
      retainage_pct: parseFloat(editContractForm.retainage_pct) || 0,
    }) })
    if (!scUpRes.ok) { const j = await scUpRes.json(); setErrMsg('Save failed: ' + j.error); setTimeout(() => setErrMsg(''), 5000); return }
    setEditingContract(null)
    await loadContracts()
  }

  async function deleteContract(contractId) {
    if (!window.confirm('Delete this subcontract and all its change orders?')) return
    await fetch('/api/subcontracts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: contractId }) })
    await loadContracts()
  }

  function openContractGenerator(contract) {
    const subName = contract.vendor_name || registeredSubs.find(s => s.sub_id === contract.sub_id)?.profiles?.company_name || ''
    const yr = new Date().getFullYear().toString().slice(2)
    const idx = contracts.findIndex(c => c.id === contract.id)
    const subNo = String((idx >= 0 ? idx : contracts.length) + 1).padStart(3, '0')
    const jobNum = job?.job_number || ''
    setContractGenForm({
      contract_id: contract.id,
      date: new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }),
      sub_name: subName,
      sub_address: '',
      entity_type: 'sole proprietorship',
      trade: contract.description || '',
      project_name: job?.project_name || '',
      project_address: job?.location || '',
      owner_name: '',
      owner_address: '',
      contract_amount: String(contract.contract_value || ''),
      pay_pct: '100',
      scope_of_work: '',
      job_number: jobNum,
      subcontract_number: `${yr}-${jobNum}-${subNo}`,
      pm_name: 'Peyton White',
      superintendent: 'Landon Moore',
    })
    setShowContractGen(true)
  }

  function generateSubcontract() {
    const f = contractGenForm
    const fmt = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const subNoShort = f.subcontract_number.split('-').pop() || f.subcontract_number
    const logoUrl = (typeof window !== 'undefined' ? window.location.origin : '') + '/logo.png'
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Subcontract — ${f.sub_name}</title>
<style>
@page{size:8.5in 11in;margin:.85in 1in}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Times New Roman',serif;font-size:10.5pt;color:#000;background:#fff;line-height:1.5;width:6.5in;margin:0 auto}
.np{break-before:page;page-break-before:always}
.logo-wrap{text-align:center;margin-bottom:22px}
.logo-wrap img{height:80px;width:auto;object-fit:contain;display:inline-block}
.sub-num{font-weight:bold;border-bottom:1px solid #000;padding-bottom:4px;margin-bottom:12px}
.nv-hdr{font-size:12pt;font-weight:bold;text-decoration:underline;margin-bottom:4px}
.agreement-title{text-align:center;font-size:14pt;font-weight:bold;text-decoration:underline;margin:14px 0}
p{margin-bottom:8px;line-height:1.5;overflow-wrap:break-word}
.indent{margin-left:32px}
.num-item{margin-left:24px;margin-bottom:9px;line-height:1.5;overflow-wrap:break-word}
.gp-title{text-align:center;font-size:13pt;font-weight:bold;margin-bottom:14px}
.provision{margin-bottom:10px;line-height:1.5;text-align:left;overflow-wrap:break-word;word-break:break-word;page-break-inside:avoid}
.pnum{font-weight:bold}
.initial{display:block;text-align:right;font-size:10pt;border-top:1px solid #000;padding-top:3px;width:55px;margin-left:auto;margin-top:18px}
.sig-line{border-bottom:1px solid #000;display:inline-block;vertical-align:bottom}
.dbl{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:12px}
.footer-bar{border-top:3px solid #e8590c;margin-top:28px}
.footer-bar2{border-top:1px solid #e8590c;margin-top:4px}
.footer-addr{text-align:center;font-size:9pt;color:#444;margin-top:8px}
.bold{font-weight:bold}.ul{text-decoration:underline}.bu{font-weight:bold;text-decoration:underline}
.section-lg{font-weight:bold;font-size:12pt;margin:14px 0 6px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<!-- COVER LETTER -->
<div>
  <div class="logo-wrap"><img src="${logoUrl}" alt="NV Construction" /></div>
  <p>${f.date}</p>
  <p>${f.sub_name}<br>${f.sub_address}</p>
  <br>
  <p>Dear ${f.sub_name}:</p>
  <br>
  <p class="indent">Please carefully review paragraphs # 5 and #23 of the enclosed contract. All change orders <span class="bu">must</span> have written authorization (defined as a formal NV Construction change order or an email approval defining scope and cost) from the Project Manager before work is commenced in order to ensure you will be paid for the work. All payment requests including claims for additional work must include a formal signed NV Construction Change Order in order for your draw to be processed and paid.</p>
  <br>
  <p class="indent">While I understand that in the heat of battle, a NV Construction employee may ask you to perform work with a verbal authorization; you must get that authorization in writing before proceeding. Any work done with only a verbal agreement will result in not being paid. Also, please note in paragraph #23 that the NV superintendent is <span class="bu">not</span> authorized to approve change orders for additional work. That approval must come from the Project Manager.</p>
  <br>
  <p class="indent">I highlight these paragraphs to protect you as a subcontractor and to ensure that at the end of the job there are no surprises for any of us, including our client.</p>
  <br>
  <p class="indent"><span class="ul">We appreciate your cooperation in this matter and look forward to working with you on this project. Please acknowledge your agreement and understanding of this requirement by signing this letter in the space provided below, and then return the signed copy with your contract.</span></p>
  <br><br>
  <p>Sincerely,</p>
  <br><br>
  <p>Nishil Patel<br>CEO<br>NV Construction LLC</p>
  <br><br>
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <div style="text-align:center;width:290px"><div style="border-bottom:1px solid #000;height:24px;margin-bottom:4px"></div><div style="font-size:9pt">Subcontractor Signature</div></div>
  </div>
  <br>
  <p>Subcontract #<br>${f.subcontract_number}</p>
  <div class="footer-bar"></div><div class="footer-bar2"></div>
  <div class="footer-addr">2000 N. Eastman Road &nbsp;&bull;&nbsp; Longview, TX 75601 &nbsp;&bull;&nbsp; www.nv.construction</div>
</div>

<!-- SUBCONTRACT AGREEMENT -->
<div class="np">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="nv-hdr">NV Construction</div>
  <div class="agreement-title">SUBCONTRACT AGREEMENT</div>
  <p>THIS AGREEMENT is made and entered into on ${f.date} (the "Subcontract"), by and between <strong>NV Construction</strong>, a Texas limited partnership, 2000 N. Eastman Road Longview, Texas 75601 ("Contractor"), and ${f.sub_name}, a (sole proprietorship / partnership / corporation) of the State of Texas whose principal address is ${f.sub_address} ("Subcontractor").</p>
  <p class="indent">IN CONSIDERATION of the mutual covenants made by Contractor and Subcontractor, the parties mutually agree as follows:</p>
  <div class="num-item"><strong>1.</strong>&nbsp;&nbsp;Subcontractor agrees to furnish all labor, material, equipment, services, supplies and scaffolding and to pay all applicable federal, state, and local taxes required for the completion of the ${f.trade} work (the "Subcontract Work") for the following project (the "Project"):</div>
  <div style="text-align:center;margin:14px 0"><strong>${f.project_name}</strong><br>${f.project_address}</div>
  <div class="num-item"><strong>2.</strong>&nbsp;&nbsp;Subcontractor shall perform the Subcontract Work in accordance with the terms of the contract between Contractor and ${f.owner_name} ("Owner"), ${f.owner_address} for the construction of the Project (the "General Contract").</div>
  <div class="num-item"><strong>3.</strong>&nbsp;&nbsp;Contractor agrees to pay Subcontractor for the Subcontract Work, and Subcontractor agrees to accept therefore, the sum of <strong>${fmt(f.contract_amount)}</strong>, payment to be made in accordance with Article 2 of the attached "General Provisions."</div>
  <div class="num-item"><strong>4.</strong>&nbsp;&nbsp;The percentage of each estimate to be paid under Article 2 of the General Provisions shall be ${f.pay_pct === '100' ? 'one hundred percent (100%)' : f.pay_pct + '%'}.</div>
  <div class="num-item"><strong>5.</strong>&nbsp;&nbsp;The attached General Provisions are incorporated into and made a part of this Subcontract.</div>
  <br>
  <p style="font-size:10.5pt">IN WITNESS WHEREOF, the parties hereto have executed this agreement for themselves, their heirs, executors, successors, administrators and assigns.</p>
  <p style="margin:14px 0"><span class="bold">Job No:</span> ${f.job_number} &nbsp;&nbsp;&nbsp;&nbsp; <span class="bold">Subcontract No:</span> ${subNoShort} &nbsp;&nbsp;&nbsp;&nbsp; <span class="bold">Contract Amount:</span> ${fmt(f.contract_amount)}</p>
  <div class="dbl">
    <div>
      <p><strong>NV Construction LLC</strong></p><br>
      <p>Signature: <span class="sig-line" style="width:190px"></span></p><br>
      <p>Title: <span class="sig-line" style="width:130px"></span> &nbsp; Date: <span class="sig-line" style="width:90px"></span></p>
      <p>PM: ${f.pm_name}</p>
    </div>
    <div>
      <p><strong>SUBCONTRACTOR:</strong> ${f.sub_name}</p><br>
      <p>Signature: <span class="sig-line" style="width:190px"></span></p>
      <p style="font-size:9pt;text-align:center">(Company officer's signature)</p><br>
      <p>Title: <span class="sig-line" style="width:110px"></span> &nbsp; Date: <span class="sig-line" style="width:80px"></span></p>
      <p>Federal I.D. <span class="sig-line" style="width:120px"></span></p>
      <p>Phone #: <span class="sig-line" style="width:85px"></span> &nbsp; Fax #: <span class="sig-line" style="width:75px"></span></p>
      <p>Cell#: <span class="sig-line" style="width:125px"></span></p>
      <p>E-Mail: <span class="sig-line" style="width:140px"></span></p>
    </div>
  </div>
  <div class="initial">Initial</div>
</div>

<!-- CONTRACT DOCUMENTS & SCOPE OF WORK -->
<div class="np">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <p class="section-lg">CONTRACT DOCUMENTS:</p>
  <p>Subcontractor Proposal<br>Link to Current Plan Sheets<br>Exhibit A Attached<br>Exhibit B Attached<br>Schedule</p>
  <br>
  <p><strong>SUBMITTALS</strong><br>Provide materials and equipment per plans and specifications. No substitutions allowed. Subcontractor is responsible for any delay arising from substitution requests. Submittal documents for Owner's records to be provided via overnight delivery to NV Construction, 2000 N. Eastman Road Longview, Texas 75601 – Phone: 903-331-8895.</p>
  <p>Completion of submittal requirements in their entirety is required within one week of contract issuance. Approval of submittals within one week of receipt will be requested from Architect.</p>
  <br>
  <p><span class="bu">SUPPLIER / MATERIAL NOTIFICATION REQUIREMENTS</span><br><strong>All supplies and materials purchased for above referenced job site must be listed on the Application &amp; Certificate for Payment form. Required information must include: Name of Company (ies), phone number(s) with area code, dollar amount furnished to date, amount paid to date and materials purchased. This information MUST be provided to NV Construction before the first draw is paid.</strong></p>
  <br>
  <p><strong>CLEAN-UP</strong><br>All work is to be done with care and consideration of surrounding, customers, employees, other trades and the existing premises in general and in accordance with Landlord requirements. Park within designated areas. Follow prescribed traffic routes.</p>
  <p>Construction site to be kept broom clean and ready for public access daily as required. Construction debris shall be placed by Subcontractor in a NV Construction provided dumpster daily.</p>
  <br>
  <p><strong>SAFETY</strong><br>Subcontractor shall obey, maintain, and comply with all laws, regulations, and safety programs (collectively "Safety Standards"), including those set forth in applicable OSHA guidelines and Material Safety Data Sheets ("MSDS"). Subcontractor shall provide to NV Construction superintendent a copy of Safety Program and subcontractor shall maintain onsite all applicable MSDS for this project.</p>
  <p>Subcontractor shall defend, indemnify and hold harmless Contractor from and against any and all damages, liabilities, penalties, costs, and fees, including attorney fees, arising out of or concerning subcontractor violations, breaches, or penalties relating to the Safety Standards. Hard hats, hard sole shoes and other proper attire are to be worn during all construction. <strong>Safety program and competent person form must be onsite before first draw is paid.</strong></p>
  <br>
  <p><strong>SCHEDULE</strong><br>Time is of the essence in this project. Attend weekly site construction meetings as requested to coordinate work schedules and adjustments necessary due to project staging.</p>
  <br>
  <p class="section-lg">SCOPE OF WORK</p>
  <p style="white-space:pre-wrap">${f.scope_of_work}</p>
  <br>
  <p>* Change Orders: You must receive written authorization from the Project Manager before you begin the work.<br>* Daily broom swept clean-up of all trash &amp; debris<br>* Comply with all OSHA regulations. *PPE will be required at all times for this job<br>* Time is of the essence for this project. Complete work per schedule provided below.</p>
  <div class="initial">Initial</div>
</div>

<!-- GENERAL PROVISIONS -->
<div class="np">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <div class="gp-title">GENERAL PROVISIONS</div>
  <div class="provision"><span class="pnum">1.&nbsp;&nbsp;&nbsp;&nbsp;THE "GENERAL CONTRACT" DOCUMENTS:</span> "General Contract" as used in this Subcontract means the contract documents between Contractor and Owner, including all the provisions, general conditions, plans, drawings, specifications, and addenda. Copies of all these documents are on file at the offices of Contractor and are available for inspection by Subcontractor, subject to reasonable redaction of pricing information at Contractor's sole discretion. Insofar as the provisions of the General Contract do not conflict with the specific provisions contained in this Subcontract, they are hereby incorporated as if fully rewritten herein. In the event of a discrepancy between the General Contract and this Subcontract, this Subcontract shall govern. Subcontractor hereby assumes all duties and obligations to Contractor which Contractor has assumed toward Owner in the General Contract to the extent the duties and obligations are not in conflict with the provisions contained in this Subcontract. Subject to the foregoing qualification, Subcontractor agrees to comply with and not violate any term, covenant, or condition of the General Contract, including, but not limited to, any provisions regarding (a) nondiscrimination in employment; (b) Davis-Bacon Act; (c) Contract Work Hours Standards Act; (d) apprentices; (e) signed payroll records and payroll; (f) Copeland (Anti-Kickback) Act--non-rebate of wages; (g) withholding of funds to assure wage payments; (h) termination of subcontract; (i) Buy-American Act; (j) specifications and drawings; (k) changed conditions; (l) termination; (m) materials and workmanship; (n) inspection; (o) other contracts; (p) bonding requirements; (q) renegotiation, and (r) to the extent applicable California prevailing wage requirements. Subcontractor shall be liable for any and all damages assessed by Owner against Contractor, whether direct, actual or consequential, to the extent the damages are attributable to the performance of the Subcontract Work and/or any acts or omissions of Subcontractor in relation to this Subcontract.</div>
  <div class="provision"><span class="pnum">2.&nbsp;&nbsp;&nbsp;&nbsp;PAYMENT:</span> Payments to Subcontractor shall be made monthly in accordance with the procedures and requirements set forth in subparagraphs (1) - (8) below. Subcontractor agrees and acknowledges that Contractor may withhold monthly progress payments in whole or in part in order to protect Contractor from loss because of any breach of this Subcontract, including the items enumerated in Paragraph 15 (Failure to Perform).<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;Applications for payment shall be made bi-weekly in accordance to the Billing Calendar provided in Exhibit B. These applications are to be turned in Bi-Weekly and will be processed and paid within 7 days of the due date highlighted on Exhibit B. The check will then be available for Pickup at our main office at 2000 N. Eastman Road or will be via USPS to your home office. There will be NO EXCEPTIONS.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;If satisfactory, the estimate will be incorporated into Contractor's estimate and forwarded to Owner.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;To the extent that Owner approves Subcontractor's estimate and not later than ten days after payment to Contractor, Contractor shall pay Subcontractor the percentage of Subcontractor's estimate set out in Paragraph 4 of the Subcontract, provided that it shall not be incumbent upon Contractor to make payments in an amount that would not leave a sufficient balance to cover all obligations of Subcontractor for labor, materials, etc., previously furnished by Subcontractor under this Subcontract.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;Final payment will be paid within 15 days of acceptance of, and final payment for, the entire work by Owner, but not before delivery of executed releases or lien waivers from Subcontractor, and its subcontractors and suppliers, as required by Contractor.<br>&nbsp;&nbsp;&nbsp;&nbsp;(5)&nbsp;Title for all materials and work covered by estimates and/or requisitions for payment for which progress payments have been made shall pass to Contractor (or Owner, if the arrangements between Contractor and Owner so provide). However, passage of title shall not relieve Subcontractor from responsibility for all defective materials and work for which payments have been made, the restoration of any damaged work or the maintenance of insurance thereon if required by other provisions of this Subcontract. Nor shall it be considered a waiver of the right of Contractor or Owner to require fulfillment of all terms of this Subcontract.<br>&nbsp;&nbsp;&nbsp;&nbsp;(6)&nbsp;All progress payments and final payment pursuant to this Subcontract are contingent and subject to Owner's acceptance of all work performed by Subcontractor and, to the extent permitted by governing law, Contractor's receipt of payment from Owner for Subcontractor's work. In their negotiations, Subcontractor and Contractor have addressed the contingency that Owner may not pay Contractor for work performed by Subcontractor, and Subcontractor has agreed and does hereby agree to accept the risk of nonpayment by Owner, to the extent permitted by governing law, for whatever reason, it being specifically understood that payment by Owner to Contractor for Subcontractor's work, whether for progress payment or final payment, is a condition precedent to Contractor's liability to pay Subcontractor. Subcontractor's price of the work includes an amount for assuming this risk.<br>&nbsp;&nbsp;&nbsp;&nbsp;(7)&nbsp;Subcontractor agrees to submit to Contractor with each Application for Payment reasonable backup documentation for Subcontractor's costs, and all documents required by the construction lien laws in the state of the project, including lien waivers and sworn statements.<br>&nbsp;&nbsp;&nbsp;&nbsp;(8)&nbsp;Subcontractor agrees to submit to Contractor with each Application for Payment reasonable backup documentation for Subcontractor's costs, and all documents required by the construction lien laws in the state of the project, including lien waivers and sworn statements.</div>
  <div class="provision"><span class="pnum">3.&nbsp;&nbsp;&nbsp;&nbsp;PERFORMANCE:</span> Subcontractor agrees to perform the Subcontract Work in a careful and workmanlike manner in accordance with the best construction practices and with this Subcontract, and in strict accordance with the General Contract. Subcontractor agrees to procure materials and supplies in advance and to provide sufficient men, equipment, scaffolding and supervision to ensure that the Subcontract Work will be prosecuted diligently and coordinated with other work at the site and completed within the time allotted and in accordance with the requirements of the General Contract. Subcontractor shall have a supervisor at all times on the job site. Unless otherwise agreed upon, Subcontractor shall be responsible for all handling of its materials at the job site, including, but not limited to, hoisting, deliveries, transportation, unloading, storing and safekeeping. Subcontractor agrees to pay all freight, storage, taxes, or other incidental expenses associated with its materials. All materials stored at the job site shall be at the risk of Subcontractor unless otherwise agreed upon in writing by Contractor. Contractor assumes no responsibility or liability for materials received or stored by Subcontractor and, unless otherwise agreed in writing by Contractor, Subcontractor assumes full responsibility for loss or damage of any nature to its equipment while in use or stored at the job site. Subcontractor agrees to pay not less than the scale of wages prescribed in the General Contract, or not less than the scale prescribed by law in the event the General Contract provides no such scale. Subcontractor shall insure that all lower-tier subcontractors, suppliers and employees, at all times, are timely paid all amounts due in connection with the performance of this Subcontract, including but not limited to all wages, fringe or other benefit payments or contributions. Subcontractor shall obtain and pay for all permits, licenses and fees required for the performance of the Subcontract Work and shall comply with all applicable ordinances, statutes and regulations relating to the Subcontract Work. Subcontractor shall defend, indemnify and hold harmless Contractor from and against any claim, damages, liability, and losses arising out of Subcontractor's failure or alleged failure to comply with such ordinances, statutes or regulations. These indemnifications, defense, and hold harmless obligations include, but are not limited to, any liability or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Cal. Labor Code section 218.7. Subcontractor has satisfied himself, by his own investigation, regarding the conditions affecting the Subcontract Work to be done and materials to be furnished, and as to the meaning and intention of the General Contract.</div>
  <div class="provision"><span class="pnum">4.&nbsp;&nbsp;&nbsp;&nbsp;COMMENCEMENT AND COMPLETION OF THE WORK:</span> Time is of the essence of this Subcontract. Subcontractor agrees to supply materials, labor and equipment as necessary to commence the Subcontract Work when directed by Contractor. Subcontractor shall diligently pursue the completion of the Subcontract Work and coordinate the Subcontract Work with that being done on the project by Contractor and other trades so that the Subcontract Work or the work of others shall not be delayed or impaired by any act or omission by Subcontractor. Contractor shall have the right to decide the time or order in which the various portions of the work shall be undertaken or completed or the priority of the work of other subcontractors, and, in general, all matters representing the timely and orderly conduct of the Subcontract Work on the premises. Contractor may prepare a coordinated progress schedule, and if he does so, Subcontractor shall be required to perform the work in accordance with such schedule as it may be modified by Contractor as work progresses. Any Critical Path Method ("CPM") schedules or other schedules generated by Contractor shall become part of this Subcontract. Subcontractor shall be liable for any liquidated damages which may become due to Owner under the General Contract or any extra expenses incurred by Contractor, such as overhead and supervision, due to Subcontractor's delays. In the event Subcontractor's performance of the Subcontract Work is delayed, accelerated or interfered with, for any reason and for any period of time, by acts or omissions of Owner, Architect, Contractor, other subcontractors or third persons, Subcontractor may request an extension of time for performance of the Subcontract Work in accordance with the provisions of Paragraphs 5 and 7, it being expressly agreed that said time extension is the sole and exclusive remedy to which Subcontractor is entitled for such delay, acceleration or interference, and Subcontractor shall not be entitled to any increase in the Subcontract amount or to damages or additional compensation as a consequence of such delay, acceleration or interference, save and except to the extent that the General Contract entitles Contractor to compensation, and then only to the extent of any amounts that Contractor may, on behalf of Subcontractor, actually receive from the Owner.</div>
  <div class="provision"><span class="pnum">5.&nbsp;&nbsp;&nbsp;&nbsp;CHANGES IN THE WORK:</span> Contractor shall have the right to change the Subcontractor Work by issuing a Construction Change Directive signed by Contractor, or a Change Order signed by Contractor and Subcontractor. Should Contractor, at any time during the progress of the work, request a Change Order to change the scope of the Subcontract Work in this Subcontract, Subcontractor shall within five (5) days thereafter submit an itemized estimate reflecting any cost changes required to make the changes, it being distinctly understood and agreed, regardless from whom orders may be taken for changes in the scope of the work, that no such changes are to be made except by a subcontract Change Order issued by Contractor and then only when such order sets forth the amount of any addition or deduction and is signed by both parties thereto, or a Construction Change Directive signed by Contractor. If Subcontractor initiates a substitution, deviation or change in the work which affects the scope of the work or the Subcontract Work or causes expense to Contractor, Subcontractor shall be liable for the expenses thereof and is not entitled to an increase in the subcontract price, unless there is a Change Order executed by both parties or a Construction Change Directive executed by Contractor. Once Contractor and Subcontractor agree to a price for the changes set forth in the Construction Change Directive, they shall execute a Change Order reflecting those terms. If Contractor and Subcontractor are unable to agree on a price for the changes set forth in a Construction Change Directive, then Subcontractor shall still perform the changes in accordance with the Construction Change Directive, Contractor shall pay Subcontractor the price which Contractor believes is reasonable for the changes, and Subcontractor shall have a right to make a claim for any remaining amounts subject to the terms in Paragraph 7 of this Subcontract.</div>
  <div class="provision"><span class="pnum">6.&nbsp;&nbsp;&nbsp;&nbsp;DEFECTIVE WORK:</span> Payments otherwise due may be withheld by Contractor on account of defective work not remedied, claims filed, evidence indicating probability of filing of claims, failure of Subcontractor to make payments properly to its subcontractors or for material or labor, or a reasonable doubt that the Subcontract can be completed for the balance then unpaid. If said causes are not removed, within 72 hours after written notice, Contractor may rectify the same at Subcontractor's expense, or any other reasonable exposure to Contractor for costs, damages, or liability. If at any time Contractor determines that Subcontractor's financial condition has become such that Subcontractor may be unable to perform the Subcontract Work in accordance with its obligations under this Subcontract, Contractor shall have the right to demand and Subcontractor shall furnish satisfactory security to Contractor within 72 hours after written notice to Subcontractor, and in the event Subcontractor defaults in the furnishing of the security, Contractor shall have the option to terminate this Subcontract in which case, the rights of Contractor shall be the same as if Subcontractor had failed to perform this Subcontract in whole or in part. Contractor shall have the right to deduct from any amounts due Subcontractor under this Subcontract or any other agreement, the amount of any claim owed by Subcontractor to Contractor whether or not such claim arises out of this Subcontract. Subcontractor agrees to be bound by all the provisions of the General Contract, including but not limited to, provisions relating to quantities, measurement and payment, to change orders, extra work, variations in plans or site conditions, time extensions and claims. If any part of the Subcontract Work depends upon the work of Contractor or of any other subcontractor, Subcontractor shall inspect such other work and promptly report to Contractor any defects or inadequate performance which adversely affects Subcontractor's work. If there appear to be any variations or discrepancies in dimensions, quantities, or other matters set forth in the plans, specifications, and other portions of the General Contract, Subcontractor will promptly bring the matter to the attention of Contractor in writing. Subcontractor agrees to be bound by the terms of the General Contract with respect to such variations.</div>
  <div class="provision"><span class="pnum">7.&nbsp;&nbsp;&nbsp;&nbsp;CLAIMS AND DISPUTES:</span> All claims, including for increases in subcontract price or time, or for damages, and regardless of whether the claim is for delays, disruption, interference, differing site conditions, extras, changes, or administration of the Subcontract, which Subcontractor has or wishes to assert against Contractor must be presented in writing to Contractor not later than 10 days after Subcontractor is aware or should be aware that a claim will or does exist, even though the exact nature of the claim and the amount of the claim may not be determinable at that time. If Subcontractor fails to submit the claim in writing to Contractor within the time required in this paragraph, then Subcontractor waives the claim and any right to recover for the claim, including any damages in any way related to the claim. The nature of the claim and the amount of the claim, to the extent known at the time, must be presented to Contractor in the required writing.<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;Subject to the foregoing requirements in this Paragraph 7, should any dispute or controversy arise between Contractor and Subcontractor concerning any matter involving or arising out of the Subcontract, the following procedures shall apply. If the claim results from action or acts by Owner, including without limitation, changes ordered, interpretation of the General Contract by Owner or its authorized representative, or any dispute arising out of inaccuracies, deficiencies, discrepancies or ambiguities in the General Contract, then Subcontractor shall make all claims promptly to Contractor for additional costs, extensions of time, and damages for delays or other causes in accordance with the General Contract. Any such claims which will affect or become part of a claim which Contractor is required to make under the General Contract within a specified time period or in a specified manner shall be made in a sufficient time to permit Contractor to satisfy the requirements of the General Contract. Failure of Subcontractor to make such a timely claim shall bind Subcontractor to the same consequences as those to which Contractor is bound. Subcontractor shall be bound by all procedural provisions, administrative determinations and final judgments which are binding on Contractor as to such claims. Subcontractor shall bear the expenses, including reimbursement of Contractor's attorney fees and providing a reasonable retainer to initiate a claim against the Owner, and the burden of prosecuting and proving any such claims against Owner and shall give Contractor adequate and timely notification in writing of any such claim or dispute action it desires Contractor to make on its behalf against Owner. The terms of the dispute resolution and claims procedure contained in the General Contract shall be binding upon Subcontractor, whether or not Subcontractor records or files a mechanic's lien, stop notice or prosecutes suit thereon or against any bond posted by Contractor; and Subcontractor hereby acknowledges that this Subcontract waives, affects and impairs rights it would otherwise have in connection with such liens, stop notices and suits on said bonds.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;Subject to the foregoing requirements in this Paragraph 7, if the dispute arises out of or relates to this Subcontract and is solely between Contractor and Subcontractor, then the following dispute resolution procedure shall apply: (1) The dispute or controversy shall be submitted by one party to the other in writing; (2) the parties shall make a good faith attempt to settle such dispute; (3) if the dispute is not settled under (1) and (2), then the parties shall submit to non-binding mediation with the parties agreeing on a neutral mediator. Any disputes or controversies not resolved or settled by the parties under the previous provisions shall be submitted to binding arbitration in accordance with the Construction Industry Rules of the American Arbitration Association and any judgment upon the award by the arbitrators may be entered by any court having jurisdiction. The venue for any hearing under this arbitration provision shall be in Dallas County, Texas. Each party shall bear their own attorney and expert fees in connection with such a dispute and no other provisions of this Subcontract shall be construed otherwise.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;If the dispute between the Contractor and Subcontractor involves claims or potential disputes by, with or against other subcontractors of Contractor, then Subcontractor agrees to the consolidation of all such related claims or disputes into one consolidated arbitration proceeding with Contractor and the other subcontractors as further provided for above.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;During the pendency of any dispute under this Subcontract, whether it involves Owner or only Contractor, Subcontractor shall continue working and will proceed on any disputed items of work without waiving its claims.</div>
  <div class="provision"><span class="pnum">8.&nbsp;&nbsp;&nbsp;&nbsp;CLAIMS AGAINST SUBCONTRACTOR:</span> Subcontractor shall settle all claims of its suppliers and subcontractors for labor, materials, and/or damages resulting from the Subcontract Work or take such other action as directed by Contractor in order to hold Contractor and Owner harmless from expense and/or liability for same. In addition, If any lien or bond claim is filed or if a claim of any nature is asserted against the Owner or the Contractor on account of any obligation of the Subcontractor, the Subcontractor shall, within five (5) days thereafter, cause such lien or claim to be satisfied, discharged or bonded off at the Subcontractor's sole cost and expense. The Subcontractor's failure so to do shall constitute a default hereunder. If suit be brought to enforce any such claim, whether valid or not, Subcontractor shall, if requested by Contractor, defend any such suit at its own expense and in any event shall indemnify Contractor against any loss, damage or expenses including attorney's fees, incurred or suffered as a result thereof.</div>
  <div class="provision"><span class="pnum">9.&nbsp;&nbsp;&nbsp;&nbsp;INSURANCE AND BONDS:</span><br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;<span class="pnum">Commercial General and Umbrella Liability Insurance.</span> Subcontractor shall maintain commercial general liability (CGL) and, if necessary, commercial umbrella insurance with a limit of not less than $1,000,000 Bodily Injury and Property Damage Combined Single limit for each occurrence during the project and for a period of ten years after completion of the project. The CGL insurance shall contain a general aggregate limit which shall apply separately to this project using ISO endorsement CG2503 or a substitute providing equivalent coverage. CGL, insurance shall cover liability arising from premises, operations, independent contractors, products completed operations, personal injury and advertising injury, and contractual liability. During the period required in this paragraph to maintain a CGL policy, Contractor, Owner and any other party required under the General Contract shall be included as an additional insured under the CGL, using ISO Additional Insured Endorsement CG 2010 and CG2037 Owners, Lessees or Contractors-Completed Operations or substitutes providing equivalent coverage, and under the commercial umbrella, if any. This insurance shall apply as primary and non-contributory insurance with respect to any other insurance or self-insurance programs maintained by Contractor or Owner. Subcontractor and its insurer waive all rights against Contractor, Owner and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the commercial general liability or commercial umbrella liability insurance maintained pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;<span class="pnum">Business Auto and Umbrella Liability Insurance.</span> Subcontractor shall maintain business auto liability and, if necessary, commercial umbrella liability insurance with a limit of not less than $1,000,000 Bodily Injury and Property Damage Combined Single limit for each accident. Such insurance shall cover liability arising out of any auto (including owned, hired, and non-owned autos). Contractor, Owner and any other party required under the General Contract shall be included as an insured under the Business Auto Policy using ISO Additional Insured Endorsement CG 2010 and CG2037 Owners, Lessees or Contractors-Completed Operations or substitutes providing equivalent coverage, and under the commercial umbrella, if any. Subcontractor and its insurer waive all rights against Contractor and Owner, and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the business auto liability or commercial umbrella liability insurance obtained by Subcontractor pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;<span class="pnum">Workers Compensation Insurance.</span> Subcontractor shall maintain workers compensation and employer's liability insurance. The employer's liability limits shall not be less than $500,000 each accident for bodily injury by accident or $500,000 each employee for bodily injury by disease. Subcontractor and its insurer waive all rights against Contractor and Owner, and their agents, officers, directors and employees for recovery of damages to the extent these damages are covered by the workers compensation policy insurance obtained by Subcontractor pursuant to this Article 9.<br>&nbsp;&nbsp;&nbsp;&nbsp;(4)&nbsp;<span class="pnum">Evidence of Insurance.</span> Prior to commencing the work, Subcontractor shall furnish Contractor with a certificate(s) of insurance, executed by a duly authorized representative of each insurer, showing compliance with the insurance requirements set forth above. All certificates shall provide for 30 days written notice to Contractor prior to the cancellation or material change of any insurance referred to therein. Contractor shall have the right, but not the obligation, of prohibiting Subcontractor or any subcontractor from entering the project site until such certificates or other evidence that insurance has been placed in complete compliance with these requirements is received and approved by Contractor. Failure to maintain the required insurance may result in termination of this Subcontract at Contractor's option. If Subcontractor fails to maintain the insurance as set forth herein, Contractor shall have the right, but not the obligation, to purchase and charge Subcontractor for any costs incurred to purchase said insurance. Subcontractor shall provide certified copies of all insurance policies required above within 10 days of Contractor's written request for said copies.<br>&nbsp;&nbsp;&nbsp;&nbsp;(5)&nbsp;<span class="pnum">Subcontractors' Insurance.</span> Subcontractor shall cause each subcontractor employed by Subcontractor to purchase and maintain insurance of the type, limits and endorsements specified above. Subcontractor shall furnish copies of certificates of insurance evidencing coverage for each subcontractor.<br>&nbsp;&nbsp;&nbsp;&nbsp;(6)&nbsp;<span class="pnum">Builders' Risk Insurance.</span> To the extent that Builders' Risk insurance is carried by Contractor on the General Contract, Subcontractor may have an interest in the insurance policy; however, the provisions of this paragraph do not make it mandatory upon Contractor to carry any insurance whatsoever for the benefit of Subcontractor. Subcontractor agrees he will assume the responsibility to determine whether Builders' Risk insurance is in force. In the event Contractor should elect to carry Builders' Risk Insurance, and only in such event, Subcontractor agrees to submit immediately, for the purpose of determining values under the insurance coverage, a complete breakdown of this contract price showing materials, labor, expendable tools, supplies or any other thing or article of value, the cost of which is included in the subcontract price stated in this Subcontract, and further agrees to pay 90% of the premium applicable to such values reported by Subcontractor and if such payment is not made, authorizes Contractor to deduct such amounts from any payment due Subcontractor. Further, Subcontractor will be responsible for reimbursing Contractor for an amount equal to the percentage of this Subcontract value in relation to the total General Contract Amount to cover any deductible applicable to a Contractor-purchased Builder's Risk policy.<br>&nbsp;&nbsp;&nbsp;&nbsp;(7)&nbsp;Subcontractor is fully responsible for all loss or damage to materials delivered and stored on the job site until such materials are actually installed and/or incorporated into the job.<br>&nbsp;&nbsp;&nbsp;&nbsp;(8)&nbsp;<span class="pnum">Performance and Payment Bond.</span> Subcontractor shall provide performance and payment bonds, if required by Contractor, on a form acceptable to Contractor, prescribed by and with a surety acceptable to Contractor in the full amount of this Subcontract, for the faithful performance of this Subcontract. The premium for bonds shall be paid by Subcontractor and the cost shall be included in subcontract amount.</div>
  <div class="provision"><span class="pnum">10.&nbsp;&nbsp;&nbsp;&nbsp;</span>To the fullest extent permitted by the law, Subcontractor shall fully indemnify, defend and hold harmless Contractor, Owner, and anyone who Contractor has agreed to defend or indemnify, including their respective officers, directors, agents, subsidiaries, and employees (all such persons or entities hereinafter referred to as "Indemnitees") from and against all claims, demands, liabilities, causes of action, suits, judgments, or defense expenses (including attorney's fees) for or on account of or in any way arising out of Subcontractor's Work, fault, breaches, or negligence, for (i) the death or personal injury of any persons (including without limitation Subcontractor, its sub-subcontractors, and their respective agents, employees and invitees; (ii) damages to property of any person (including the loss or loss of use thereof) directly or indirectly connected with, attributable to, or arising from the work to be performed by Subcontractor under this subcontract; (iii) any loss or damage of whatever kind or nature directly or indirectly connected with, attributable to, or arising from the work to be performed under this Subcontract by Subcontractor, its sub-subcontractors, and their respective agents, employees, or invitees; (iv) the providing by Contractor of equipment, operators, and/or other personnel to Subcontractor, its sub-subcontractors, and their respective agents, employees and invitees; (v) in the case of Maryland contracts the costs or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Md. Code, Lab. &amp; Empl. Art. § 3-507.2(b); or (vi) in the case of California contracts the costs or damage created by the nonpayment of wages, fringe or other benefit payments, or contributions by Subcontractor or by a subcontractor at any tier working under Subcontractor or otherwise failing to comply with Cal. Labor Code 218.7; except that as provided for by California Civil Code section 2782.05, Subcontractor shall not be liable for claims of death or bodily injury to persons, injury to property, or any other loss, damage, or expense to the extent the claims arise out of, pertain to, or relate to the active negligence or willful misconduct of Contractor or such other indemnitee, or for defects in design furnished by Contractor or such other indemnitees, or to the extent the claims do not arise out of the scope of work of the Subcontractor. This indemnification provision does not negate, abridge or reduce any other rights or obligations of the persons and entities described herein with respect to indemnity. This indemnification agreement is binding on the Subcontractor, to the fullest extent permitted by law, regardless of the passive negligence, acts or omissions of any Indemnitees. <span class="ul">Further, notwithstanding the foregoing and in any and all claims against Indemnitees by any employee of Indemnitors, the indemnity obligation under this paragraph shall not be limited by any limitation on the amount or type of damages, compensation, or benefits payable by or for Subcontractor under any workers compensation act, disability benefit act, any other employee benefit act, or by any independent obligation of Subcontractor to provide a policy or policies of insurance as provided under the terms of this Subcontract. One percent (1%) of the total Subcontract price represents specific consideration for the obligations assumed by Subcontractor under the above indemnity provisions.</span> In the case of California contracts this indemnity agreement shall be interpreted so as to comply with and be enforceable under the California Civil Code including Sections 2778, 2782 and 2782.05, et seq., and any provisions that are found to be inconsistent with those sections shall be read to meet the requirements of such code sections. In the case of Maryland contracts this indemnity agreement shall be interpreted so as to comply with and be enforceable under Md. Code Ann., Cts. &amp; Jud. Proc. § 5-401, and any provisions that are found to be inconsistent with this section shall be read to meet the requirements of such code section. Indemnitees shall be entitled to receive their attorneys' fees and costs in enforcing their rights to defense and indemnification under this section.</div>
  <div class="provision"><span class="pnum">11.&nbsp;&nbsp;&nbsp;&nbsp;HAZARDOUS MATERIALS:</span> Subcontractor shall not transport to, use, generate, dispose of, or install at the Project site any Hazardous Substance, as defined in this Article, except in accordance with applicable Environmental Laws. Further, in performing the Subcontract Work, Subcontractor shall not cause any release of hazardous substance into, or contamination of, the environment, including the soil, the atmosphere, any water course of ground water, except in accordance with applicable Environmental Laws. In the event Subcontractor engages in any of the activities prohibited in this Article, to the fullest extent permitted by law, Subcontractor shall indemnify, defend and hold harmless Contractor, Owner and anyone Contractor has agreed to defend or indemnify, and all of their respective officers, agents and employees from and against any and all claims, damages, losses, causes of action, suits and liabilities of every kind, including, but not limited to, expenses of litigation, court costs, punitive damages and attorneys' fees, arising out of, incidental to or resulting from the activities prohibited in this Article.<br>&nbsp;&nbsp;&nbsp;&nbsp;(1)&nbsp;In the event Subcontractor encounters on the Project site any Hazardous Substance, or what Subcontractor reasonably believes to be a Hazardous Substance, and which is being introduced to the work, or exists on the Project, in a manner violative of any applicable Environmental Laws, Subcontractor shall immediately stop work in the area affected and report the condition to Contractor in writing. The Subcontract Work in the affected area shall not thereafter be resumed except by written authorization of Contractor if in fact a Hazardous Substance has been encountered and has not been rendered harmless. In the event Subcontractor fails to stop the Subcontract Work upon encountering a Hazardous Substance at the Project site, to the fullest extent permitted by law, Subcontractor shall indemnify, defend and hold harmless Contractor, Owner and Architect, and all of their officers, agents and employees from and against all claims, damages, losses, causes of action, suits and liabilities of every kind, including, but not limited to, expenses of litigation, court costs, punitive damages and attorneys' fees, arising out of, incidental to, or resulting from Subcontractor's failure to stop the Subcontract Work.<br>&nbsp;&nbsp;&nbsp;&nbsp;(2)&nbsp;An extension of time shall be Subcontractor's sole remedy for any delay arising out of the encountering and/or rendering harmless of any Hazardous Substance at the Project site. Contractor and Subcontractor may enter into an agreement for Subcontractor to remediate and/or render harmless the Hazardous Substance, but Subcontractor shall not be required to remediate and/or render harmless the Hazardous Substance absent such agreement. Subcontractor shall not be required to resume any work in any area affected by the Hazardous Substance until such time as the Hazardous Substance has been remediated or rendered harmless.<br>&nbsp;&nbsp;&nbsp;&nbsp;(3)&nbsp;For purpose of this Subcontract, the term "Hazardous Substance" shall mean and include, but shall not be limited to, any element, constituent, chemical, substance, compound, or mixture, which are defined in or included under or regulated by any local, state or federal law, rule ordinance, by-law or regulation pertaining to environmental regulation, contamination, clean-up or disclosure.</div>
  <div class="provision"><span class="pnum">12.&nbsp;&nbsp;&nbsp;&nbsp;GUARANTY:</span> Subcontractor warrants and guaranties that all of Subcontractor's Work and material will be furnished in a good and workmanlike manner. Subcontractor shall, before requesting final payment, provide any and all guarantees required by the General Contract. In addition to any specified guaranty required by the General Contract, Subcontractor, in signing this Subcontract, agrees at his own expense to replace or repair any faulty or defective material or workmanship within one year from the day of notice of completion of the project, or Owner's beneficial occupancy, whichever occurs first. In addition, Subcontractor shall be responsible and pay for replacement or repair of adjacent materials or work which may be damaged due to the failure of Subcontractor's material or work and/or damaged as a result of the replacement or repairs thereof.</div>
  <div class="provision"><span class="pnum">13.&nbsp;&nbsp;&nbsp;&nbsp;DIRECTION OF SUBCONTRACT WORK:</span> It is understood that Subcontractor is an independent contractor and Contractor shall have no right to direct the operations or employees of Subcontractor. Subcontractor agrees to maintain a familiarity with conditions existing over the entire project on which the work is located so that it will be aware of dangerous conditions, whether obvious or hidden, and Subcontractor agrees to warn its employees, subcontractors and suppliers of unsafe conditions on the project premises.</div>
  <div class="provision"><span class="pnum">14.&nbsp;&nbsp;&nbsp;&nbsp;FUTURE RIGHTS:</span> Any waiver or failure to assert any right, which either party has under this Subcontract, shall not constitute a continuing waiver of future rights. Rights can be waived only if expressed in writing signed by the waiving party. If any provision of this Subcontract is held invalid or unenforceable under any present or future laws, then the remainder of the subcontract shall remain in effect.</div>
  <div class="provision"><span class="pnum">15.&nbsp;&nbsp;&nbsp;&nbsp;FAILURE TO PERFORM:</span> Should Subcontractor at any time (a) fail to supply and pay a sufficient number of skilled workmen or supply a sufficient quantity of materials of proper quality; (b) fail in any respect to prosecute the work covered by this Subcontract with promptness and diligence; (c) fail to perform work of the quality required by the General Contract; (d) fail in the performance of any of the agreements herein contained; (e) in the case of California contracts, fail to provide Contractor with the payroll records and award information on behalf of itself and all lower tier subcontractors on a monthly basis pursuant to Cal. Labor Code section 218.7(f); (f) fail to make payments properly to his sub-subcontractors or for labor (including all wages, fringe or other benefit payments or contributions), materials or equipment, transportation for shipping costs, taxes, fees or any other claims arising out of the Subcontract Work; (g) have any workmen performing work covered by this Subcontract engage in a strike or other stoppage or cease to work due to picketing or other such activity; (h) file for bankruptcy or be adjudged a bankrupt, or make an assignment for the benefit of its creditors; or (i) breach this Subcontract, Contractor may, in any of such events at its option, after twenty-four (24) hours written notice to Subcontractor, provide any such labor and materials and deduct the cost thereof from any money then due or thereafter to become due Subcontractor, or, in any of such events, Contractor, may, at its option, terminate the employment of Subcontractor for the work under this Subcontract and shall have the right to enter upon the project premises and take possession, for the purpose of completing the work hereunder, of all the materials, tools, and equipment thereon, and to finish the work and provide the materials, therefor, either with its own employees or other subcontractors; and in case of such discontinuance of the employment by Contractor, Subcontractor shall not be entitled to receive any further payments under this Subcontract or otherwise, but shall nevertheless remain liable for any damages which Contractor incurs. Contractor shall be entitled to a 15% mark up for overhead on any expenses or damages incurred by Contractor as a result of Subcontractor's default. If the expenses incurred by Contractor in completing the work shall exceed the unpaid balance, Subcontractor shall pay the difference to Contractor, along with any other damages incurred by Contractor as a result of Subcontractor's default. Contractor shall have a lien upon all materials, tools, and appliances of which possession is taken in order to secure the payment thereof. Subcontractor shall be liable to Contractor for all costs and damages incurred by Contractor due to the failure of performance by Subcontractor, the failure of Subcontractor to keep the progress of work up to that of Contractor or other trades, or the failure to execute its work as directed by Contractor. Subcontractor agrees to execute any assignments necessary to make available to Contractor and Owner the rights of Subcontractor under purchase orders and subcontracts. Contractor will credit Subcontractor's account with the value of the materials and supplies so used but there will be no credit for rent on equipment. Subcontractor shall reimburse Contractor in Dallas County, Texas, to the extent that Contractor's expense, including attorneys' fees, in completing the Subcontract Work and proceeding under this Article to recover damages, exceeds the balance which would have become due to Subcontractor under this Subcontract had Subcontractor completed the Subcontract Work; if Contractor's expense is less than such amount, then Contractor will pay the difference to Subcontractor. Subcontractor hereby waives all claims against Contractor for profits, rent or equipment or other damages related to any proceeding, which Contractor institutes under this Article. The parties agree that the terms of this Article shall be binding if Contractor in good faith has made a reasonable determination that Subcontractor's performance is inadequate and that Owner or Contractor or other subcontractors may be able to perform its contractual obligations. The parties agree that such determinations are difficult to make and must be made under pressing circumstances, and agree to be bound in accordance with this Article in light of the circumstances confronting Contractor at the time such a decision is made.</div>
  <div class="provision"><span class="pnum">16.&nbsp;&nbsp;&nbsp;&nbsp;TERMINATION FOR CONVENIENCE:</span> Contractor shall have the right to terminate this Subcontract for convenience irrespective of the existence of any fault of either party. If Contractor terminates the Subcontract for convenience, then Subcontractor shall only recover actual costs for work furnished at the time of the termination for convenience. If Contractor's termination for cause is found to be improper, then the termination for cause shall be treated as a termination for convenience.</div>
  <div class="provision"><span class="pnum">17.&nbsp;&nbsp;&nbsp;&nbsp;CONNECTION TO OTHER WORK:</span> If Subcontractor deems that surfaces of work to which his work is to be applied or affixed is unsatisfactory or unsuitable, written notification of said condition shall be given to Contractor before proceeding or taking remedial action, otherwise Subcontractor shall be fully and solely responsible and liable for any and all expense, loss, or damages resulting from said condition and Contractor shall be relieved of all liability in connection therewith.</div>
  <div class="provision"><span class="pnum">18.&nbsp;&nbsp;&nbsp;&nbsp;STORAGE:</span> Subcontractor shall provide at its own expense, whatever storage, sheds, workshops and offices are necessary for the performance of this Subcontract and shall remove same and thoroughly clean the premises at the completion of his work.</div>
  <div class="provision"><span class="pnum">19.&nbsp;&nbsp;&nbsp;&nbsp;CLEANUP:</span> Subcontractor shall clean up and remove from the site as directed by Contractor all rubbish and debris resulting from his work. Also, he shall clean up to the satisfaction of the inspectors all dirt, grease, marks, etc., from walls, ceilings, floors, fixtures, etc., deposited or placed thereon as a result of the execution of this Subcontract. If Subcontractor refuses or fails to perform this cleaning as directed by Contractor, Contractor shall have the right and power to proceed with said cleaning, and Subcontractor will on demand repay to Contractor the actual cost of said labor, plus a reasonable percentage of such costs to cover supervision, insurance, overhead, etc.</div>
  <div class="provision"><span class="pnum">20.&nbsp;&nbsp;&nbsp;&nbsp;SHOP DRAWINGS AND SAMPLES:</span> Subcontractor shall furnish promptly all samples, lists, drawings, cuts, schedules, etc. required in connection with his work, but, approval of same, does not relieve him of his responsibility of complying with the requirements of the drawings and specifications. All transportation costs on samples and drawings furnished by Subcontractor shall be paid by him.</div>
  <div class="provision"><span class="pnum">21.&nbsp;&nbsp;&nbsp;&nbsp;HOISTING:</span> If Subcontractor makes use of Contractor's hoisting facilities, he shall pay for this service unless otherwise provided.</div>
  <div class="provision"><span class="pnum">22.&nbsp;&nbsp;&nbsp;&nbsp;PATENT INDEMNIFICATION:</span> Subcontractor shall defend, indemnify and hold Contractor harmless from any liability including cost and expenses and reasonable attorney's fees, for or on account of any patented or unpatented invention, article or appliance manufactured or used in the performance of this Subcontract including their use by Owner.</div>
  <div class="provision"><span class="pnum">23.&nbsp;&nbsp;&nbsp;&nbsp;NO OVERTIME:</span> No overtime will be paid by Contractor to Subcontractor unless so specifically agreed to in writing by Contractor in advance of incurring the overtime.</div>
  <div class="provision"><span class="pnum">24.&nbsp;&nbsp;&nbsp;&nbsp;LIMIT OF AUTHORITY OF CONTRACTOR'S ON-SITE SUPERINTENDENT:</span> The authority of the Contractor's on-site representative (Superintendent) to make changes to the Subcontractor's work under Paragraph 5 of this Agreement shall be limited to an amount not in excess of $0 on any individual change and shall not exceed $0 in the total aggregate of changes to this Agreement. Any changes, whether individual change orders or in the total aggregate, that are in excess of the foregoing limits must be specifically authorized in writing by the Contractor's Project Manager.</div>
  <div class="provision"><span class="pnum">25.&nbsp;&nbsp;&nbsp;&nbsp;ASSIGNMENT:</span> Subcontractor shall not assign responsibility for performance of this Subcontract or any rights, obligations, or duties of it without first obtaining the written consent of Contractor. Subcontractor may not assign or attempt to assign any funds accrued or to be accrued under this Subcontract without first obtaining the written consent of Contractor and no such assignment shall be binding on Contractor unless and until accepted in writing by Contractor. Subcontractor shall not place on the project or incorporate into the Subcontract Work any equipment of which it is not sole owner unless it obtains written permission in advance from Contractor.</div>
  <div class="provision"><span class="pnum">26.&nbsp;&nbsp;&nbsp;&nbsp;MISCELLANEOUS:</span> Waiver of any breach hereof shall not constitute a waiver of any subsequent breach of the same or any other provision hereof. The Subcontract Amount and the other provisions and terms of this Subcontract have been negotiated and agreed to by experienced, knowledgeable and consenting persons. Accordingly, in the event of any dispute over its meaning or application, this Subcontract form shall not be construed for, or against, either Subcontractor or Contractor and shall be interpreted neither more strongly for nor against either party if ambiguity exists. The headings and captions of the Articles and paragraphs of this Subcontract are not substantive or limiting and are for convenience only and are not to be considered in construing this Subcontract. This Subcontract contains the entire agreement between the parties, and all prior proposals, negotiations and agreements prior to the Subcontract Date are not included in this Subcontract and are hereby voided. This Subcontract does not create, nor does any course of conduct between the Contractor and Subcontractor, create, any contractual relationship or benefit to any third-party claimant not a party to it. The terms and conditions of this Subcontract are intended by the Parties to be in compliance with all Federal and State laws in all respects, and if any portion or provision of this Subcontract is determined judicially to be invalid or unenforceable, the Parties agree that such portion or provision shall be judicially rewritten so as to make such portion or provision valid and enforceable to the fullest extent permissible at law as if originally written in compliance thereof. In the event of partial invalidity, all other provisions are to be enforced as written and such partial invalidity shall only affect the invalid provision(s), which shall be judicially rewritten as provided herein so as to effectuate the intent of the Parties.</div>
  <div class="initial">Initial</div>
</div>

<!-- COMPETENT PERSON STATEMENT -->
<div class="np">
  <div class="sub-num">Subcontract #: ${f.subcontract_number}</div>
  <p><strong>GENERAL PROVISIONS</strong></p><br>
  <div style="text-align:center;margin-bottom:14px">
    <div style="font-style:italic;font-weight:bold;font-size:16pt;text-decoration:underline">NV Construction</div>
    <div style="font-weight:bold;font-size:13pt;text-decoration:underline;margin-top:8px">SUBCONTRACTORS COMPETENT PERSON STATEMENT</div>
  </div>
  <p>Every employer is required by law to have a competent person on the job with his employees. This person must have the necessary training or experience to comply with OSHA safety standards. The competent person could take on personal liability for any accidents that happen. The subcontractor represents the Competent Person has had sufficient training to comply with regulations. The ownership of the company he/she works for assigns the competent person. This form must be completed before they begin work on our jobsite.</p><br>
  <p style="font-style:italic;font-weight:bold;font-size:13pt;text-decoration:underline">OWNER STATEMENT:</p><br>
  <p>I <span class="sig-line" style="width:150px">&nbsp;</span>&nbsp; hereby state that I am <span class="sig-line" style="width:120px">&nbsp;</span>&nbsp; of the<br><small>&nbsp;&nbsp;&nbsp;PRINT NAME&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TITLE</small></p>
  <p><span class="sig-line" style="width:200px">&nbsp;</span>&nbsp; and that I have the authority to assign<br><small>COMPANY NAME</small></p>
  <p><span class="sig-line" style="width:200px">&nbsp;</span>&nbsp; as the competent person on this job for our company.<br><small>COMPETENT PERSON</small></p>
  <p>He has the training and experience needed to comply with OSHA safety standards for our company. He also has the authority to stop any unsafe or hazardous activities of our employees.</p><br>
  <div style="display:flex;gap:60px;margin-bottom:6px"><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>SIGNATURE</small></div><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>DATE</small></div></div><br>
  <p>Please mark the appropriate items. Our competent person is authorized such for the following:</p>
  <p>GENERAL CONSTRUCTION ________ &nbsp;&nbsp; SCAFFOLDING ________ &nbsp;&nbsp; TRENCHING ________<br>FALL PROTECTION ________ &nbsp;&nbsp; ELECTRICAL ________</p><br>
  <p style="font-style:italic;font-weight:bold;font-size:13pt;text-decoration:underline">COMPETENT PERSON STATEMENT</p><br>
  <p>I <span class="sig-line" style="width:150px">&nbsp;</span>&nbsp; hereby acknowledge that I have been authorized as competent person for my company<br><small>PRINT NAME</small></p>
  <p>for this job site. I have by training or experience the knowledge needed to identify existing and predictable hazards at the job site and to adhere to OSHA regulations. I also have the authority to take prompt corrective action to ensure the safety of our employees.</p><br>
  <div style="display:flex;gap:60px;margin-bottom:6px"><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>SIGNATURE</small></div><div style="flex:1"><div style="border-bottom:1px solid #000;height:22px"></div><small>DATE</small></div></div><br>
  <p>Please mark the appropriate items. I am the competent person authorized for the following:</p>
  <p>GENERAL CONSTRUCTION ________ &nbsp;&nbsp; SCAFFOLDING ________ &nbsp;&nbsp; TRENCHING ________</p><br>
  <p><em><span class="ul"><strong>You must complete, sign and return this form to NV Construction with your signed subcontract prior to beginning work.</strong></span></em></p>
  <p><strong>Sub-contractor is responsible for submitting site-specific program and written safety program to the NV Construction Superintendent prior to beginning work.</strong></p><br>
  <p>For NV Construction's use. &nbsp; - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</p><br>
  <p><strong><em>NV Construction Job Superintendent:</em></strong> ${f.superintendent}</p><br>
  <p><strong><em>JOB NUMBER:</em></strong> ${f.job_number} &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong><em>JOB NAME:</em></strong> ${f.project_name}</p><br>
  <p><strong>KEEP COMPLETED FORM IN JOB FOLDER</strong></p>
  <div class="initial">Initial</div>
</div>

</body></html>`
    const key = `sc_print_${Date.now()}`
    localStorage.setItem(key, html)
    window.open(`/print-subcontract.html?key=${key}`, '_blank')
  }

  // ── Change Orders ───────────────────────────────────────────
  async function addCO() {
    const sovTotal = coForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
    const finalAmount = coForm.sov.length > 0 ? sovTotal : parseFloat(coForm.amount)
    if (!coForm.subcontract_id) { setErrMsg('Select a subcontract.'); setTimeout(() => setErrMsg(''), 4000); return }
    if (!coForm.description) { setErrMsg('Description is required.'); setTimeout(() => setErrMsg(''), 4000); return }
    if (!finalAmount) { setErrMsg('Enter an amount or add SOV lines.'); setTimeout(() => setErrMsg(''), 4000); return }
    setAddingCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    const validSOV = coForm.sov.filter(r => r.description || r.budget_item_id || r.amount)
    const { error: insertErr } = await supabase.from('change_orders').insert({
      subcontract_id: coForm.subcontract_id,
      initiated_by: session.user.id,
      direction: coForm.direction,
      amount: finalAmount,
      description: coForm.description,
      status: 'pending',
      sov: validSOV.length > 0 ? validSOV : null,
    })
    if (insertErr) { setErrMsg(insertErr.message); setTimeout(() => setErrMsg(''), 6000); setAddingCO(false); return }
    // Notify sub if this is a PM-to-sub CO
    if (coForm.direction === 'pm_to_sub') {
      const { data: subcontract } = await supabase.from('subcontracts').select('vendor_name, sub_id').eq('id', coForm.subcontract_id).single()
      if (subcontract?.sub_id) {
        const { data: subProfile } = await supabase.from('profiles').select('email').eq('id', subcontract.sub_id).single()
        if (subProfile?.email) {
          const amt = parseFloat(finalAmount).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
          const portalUrl = (typeof window !== 'undefined' ? window.location.origin : 'https://nv-construction-doym.vercel.app') + '/submit'
          sendEmail(subProfile.email, `Change order requires your approval — ${job?.project_name}`,
            emailWrap(`
              <h2 style="color:#f1f1f1;margin:0 0 8px;font-size:18px">Change order for your review</h2>
              <p style="color:#aaa;margin:0 0 16px;font-size:14px;line-height:1.6">
                NV Construction has issued a change order on <strong style="color:#f1f1f1">#${job?.job_number} — ${job?.project_name}</strong> requiring your approval.
              </p>
              <p style="color:#aaa;margin:0 0 8px;font-size:14px"><strong style="color:#f1f1f1">Description:</strong> ${coForm.description}</p>
              <p style="font-size:22px;font-weight:800;color:#e8590c;margin:12px 0">${amt}</p>
              <table cellpadding="0" cellspacing="0" style="margin:20px 0 0">
                <tr><td style="background:#e8590c;border-radius:8px">
                  <a href="${portalUrl}" style="display:inline-block;padding:12px 28px;font-size:13px;font-weight:700;color:#fff;text-decoration:none;letter-spacing:1px;text-transform:uppercase">Review Change Order</a>
                </td></tr>
              </table>
            `)).catch(() => {})
        }
      }
    }
    setShowAddCO(false)
    setCoForm(emptyCO)
    await loadAllCOs()
    await loadContracts()
    setAddingCO(false)
  }

  async function reviewCO(coId, status) {
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('change_orders').update({ status, reviewed_by: session.user.id, reviewed_at: new Date().toISOString() }).eq('id', coId)
    if (status === 'approved') {
      const co = allCOs.find(c => c.id === coId)
      for (const sovItem of co?.sov || []) {
        if (!sovItem.budget_item_id || !sovItem.amount) continue
        const { data: item } = await supabase.from('budget_items').select('budget_amount').eq('id', sovItem.budget_item_id).single()
        if (item) await fetch('/api/budget-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sovItem.budget_item_id, fields: { budget_amount: Number(item.budget_amount) + Number(sovItem.amount) } }) })
      }
      await loadBudgetItems()
    }
    await loadAllCOs()
    await loadContracts()
  }

  // ── Prime Contract Change Orders ────────────────────────────
  async function loadPrimeCOs() {
    const { data } = await supabase.from('prime_change_orders').select('*, budget_items(description, cost_code)').eq('job_id', id).order('created_at', { ascending: false })
    setPrimeCOs(data || [])
  }

  async function addPrimeCO() {
    const sovTotal = primeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
    const finalAmount = primeCOForm.sov.length > 0 ? sovTotal : parseFloat(primeCOForm.amount)
    if (finalAmount == null || isNaN(finalAmount) || !primeCOForm.description) return
    setAddingPrimeCO(true)
    const { data: { session } } = await supabase.auth.getSession()
    const validSOV = primeCOForm.sov.filter(r => r.description || r.budget_item_id || r.amount)
    const { error } = await supabase.from('prime_change_orders').insert({
      job_id: id,
      description: primeCOForm.description,
      amount: finalAmount,
      notes: primeCOForm.notes || null,
      status: 'pending',
      created_by: session.user.id,
      sov: validSOV.length > 0 ? validSOV : null,
    })
    if (error) { setErrMsg(error.message); setTimeout(() => setErrMsg(''), 4000) }
    else { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO); await loadPrimeCOs() }
    setAddingPrimeCO(false)
  }

  async function reviewPrimeCO(coId, status, coAmount) {
    const { error } = await supabase.from('prime_change_orders').update({ status }).eq('id', coId)
    if (error) { alert('Error updating prime CO: ' + error.message); return }
    if (status === 'approved') {
      const co = primeCOs.find(c => c.id === coId)
      const linkedSovItems = (co?.sov || []).filter(r => r.budget_item_id && r.amount)
      for (const sovItem of linkedSovItems) {
        const { data: item } = await supabase.from('budget_items').select('budget_amount, owner_amount').eq('id', sovItem.budget_item_id).single()
        if (item) {
          const updates = { budget_amount: Number(item.budget_amount) + Number(sovItem.amount) }
          if (item.owner_amount != null) updates.owner_amount = Number(item.owner_amount) + Number(sovItem.amount)
          await fetch('/api/budget-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sovItem.budget_item_id, fields: updates }) })
        }
      }
      await loadBudgetItems()
      if (linkedSovItems.length === 0 && coAmount) {
        alert(`CO approved — contract value updated by $${Number(coAmount).toLocaleString()}.\n\nNo budget line items were linked to this CO, so your SOV total was NOT updated. Go to the Budget tab and add $${Number(coAmount).toLocaleString()} to the relevant owner amount(s) to keep the contract sum and SOV in sync.`)
      }
    }
    await loadPrimeCOs()
  }

  async function deletePrimeCO(coId) {
    if (!window.confirm('Delete this prime contract change order?')) return
    const co = primeCOs.find(c => c.id === coId)
    await supabase.from('prime_change_orders').delete().eq('id', coId)
    if (co?.status === 'approved') {
      for (const sovItem of co.sov || []) {
        if (!sovItem.budget_item_id || !sovItem.amount) continue
        const { data: item } = await supabase.from('budget_items').select('budget_amount, owner_amount').eq('id', sovItem.budget_item_id).single()
        if (item) {
          const updates = { budget_amount: Number(item.budget_amount) - Number(sovItem.amount) }
          if (item.owner_amount != null) updates.owner_amount = Number(item.owner_amount) - Number(sovItem.amount)
          await fetch('/api/budget-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sovItem.budget_item_id, fields: updates }) })
        }
      }
      await loadBudgetItems()
    }
    await loadPrimeCOs()
  }

  async function savePrimeCO() {
    setSavingPrimeCO(true)
    const co = primeCOs.find(c => c.id === editingPrimeCOId)
    const sovTotal = editPrimeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
    const newAmount = parseFloat(editPrimeCOForm.sov.length > 0 ? sovTotal : editPrimeCOForm.amount) || 0
    const validSOV = editPrimeCOForm.sov.filter(r => r.description || r.budget_item_id || r.amount)
    const { error } = await supabase.from('prime_change_orders').update({
      description: editPrimeCOForm.description,
      amount: newAmount,
      notes: editPrimeCOForm.notes || null,
      sov: validSOV.length > 0 ? validSOV : null,
    }).eq('id', editingPrimeCOId)
    setSavingPrimeCO(false)
    if (error) { setErrMsg('Save failed: ' + error.message); setTimeout(() => setErrMsg(''), 5000); return }
    setEditingPrimeCOId(null)
    await loadPrimeCOs()
  }

  async function pushSubCOToPrime(co, subName) {
    setPushingToPrime(true)
    const markupPct = parseFloat(pushMarkup) || 0
    const markedUpAmt = Math.round(Number(co.amount) * (1 + markupPct / 100) * 100) / 100
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('prime_change_orders').insert({
      job_id: id,
      description: `${subName} — ${co.description}`,
      amount: markedUpAmt,
      notes: markupPct > 0 ? `Sub amount: $${Number(co.amount).toLocaleString()} + ${markupPct}% markup` : `From sub CO: ${subName}`,
      status: 'pending',
      created_by: session.user.id,
    })
    if (error) { alert('Error: ' + error.message) }
    else { setPushCOId(null); setPushMarkup(''); await loadPrimeCOs() }
    setPushingToPrime(false)
  }

  function printPrimeCO(co, coNum) {
    const w = window.open('', '_blank')
    const date = co.created_at ? new Date(co.created_at).toLocaleDateString() : new Date().toLocaleDateString()
    const amount = Number(co.amount)
    w.document.write(`<!DOCTYPE html><html><head><title>PCO-${String(coNum).padStart(3,'0')} — Job #${job.job_number}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Arial,sans-serif;color:#111;padding:60px;font-size:13px;line-height:1.5;max-width:800px;margin:0 auto}.print-btn{padding:8px 20px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:32px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:40px;padding-bottom:20px;border-bottom:2px solid #111}.co{font-size:22px;font-weight:800}.co-sub{font-size:12px;color:#888;margin-top:2px}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:3px}.val{font-size:14px;font-weight:600}.num-lbl{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;font-weight:700}.num{font-size:28px;font-weight:800}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.amt-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}.amt{font-size:28px;font-weight:800;color:${amount>=0?'#22863a':'#cc0000'}}.scope-box{border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px}.notes{background:#f8f8f8;border-radius:8px;padding:16px;margin-bottom:32px;font-size:13px;color:#555}.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}.sig-block{border-top:1.5px solid #111;padding-top:12px}.sig-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:8px}.sig-line{height:32px;border-bottom:1px solid #ccc;margin-bottom:6px}.sig-field{font-size:12px;color:#aaa}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center}@media print{.print-btn{display:none}}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="hdr"><div><div class="co">NV Construction</div><div class="co-sub">Change Order — Prime Contract</div></div><div style="text-align:right"><div class="num-lbl">Change Order No.</div><div class="num">PCO-${String(coNum).padStart(3,'0')}</div></div></div>
<div class="grid"><div><div class="lbl">Project</div><div class="val">${job.project_name}</div></div><div><div class="lbl">Job Number</div><div class="val">#${job.job_number}</div></div><div><div class="lbl">Date</div><div class="val">${date}</div></div><div><div class="lbl">Location</div><div class="val">${job.location||'—'}</div></div>${job.owner_company||job.owner_name?`<div><div class="lbl">Owner</div><div class="val">${[job.owner_company,job.owner_name].filter(Boolean).join(' · ')}</div></div>`:''}</div>
<div class="amt-box"><div><div class="num-lbl">Change Order Amount</div><div style="font-size:12px;color:#888;margin-top:4px">Status: ${co.status}</div></div><div class="amt">${amount>=0?'+':''}$${Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
<div class="scope-box"><div class="lbl" style="margin-bottom:8px">Description of Change</div><div style="font-size:14px;line-height:1.7">${co.description}</div></div>
${co.notes?`<div class="notes"><strong style="font-size:11px;text-transform:uppercase;letter-spacing:1px">Notes:</strong><br>${co.notes}</div>`:''}
<div class="sig-grid"><div class="sig-block"><div class="sig-lbl">Owner / Authorized Representative</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div><div class="sig-block"><div class="sig-lbl">NV Construction</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div></div>
<div class="footer">NV Construction · Generated ${new Date().toLocaleDateString()} · Job #${job.job_number}</div>
</body></html>`)
    w.document.close()
  }

  function printSubCO(co, subName, scope, coNum) {
    const w = window.open('', '_blank')
    const date = co.created_at ? new Date(co.created_at).toLocaleDateString() : new Date().toLocaleDateString()
    const amount = Number(co.amount)
    const isPmToSub = co.direction === 'pm_to_sub'
    w.document.write(`<!DOCTYPE html><html><head><title>SCO-${String(coNum).padStart(3,'0')} — ${subName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Arial,sans-serif;color:#111;padding:60px;font-size:13px;line-height:1.5;max-width:800px;margin:0 auto}.print-btn{padding:8px 20px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;margin-bottom:32px}.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:2px solid #111}.co{font-size:22px;font-weight:800}.co-sub{font-size:12px;color:#888;margin-top:2px}.lbl{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:3px}.val{font-size:14px;font-weight:600}.num-lbl{font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#888;font-weight:700}.num{font-size:28px;font-weight:800}.badge{display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:${isPmToSub?'#e8f4e8':'#fff3e0'};color:${isPmToSub?'#22863a':'#e65100'};margin-bottom:20px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}.amt-box{background:#f8f8f8;border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center}.amt{font-size:28px;font-weight:800;color:${amount>=0?'#22863a':'#cc0000'}}.scope-box{border:1px solid #e0e0e0;border-radius:8px;padding:20px;margin-bottom:24px}.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px}.sig-block{border-top:1.5px solid #111;padding-top:12px}.sig-lbl{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#888;font-weight:700;margin-bottom:8px}.sig-line{height:32px;border-bottom:1px solid #ccc;margin-bottom:6px}.sig-field{font-size:12px;color:#aaa}.footer{margin-top:48px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#aaa;text-align:center}@media print{.print-btn{display:none}}</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save PDF</button>
<div class="hdr"><div><div class="co">NV Construction</div><div class="co-sub">Change Order — Subcontract</div></div><div style="text-align:right"><div class="num-lbl">Change Order No.</div><div class="num">SCO-${String(coNum).padStart(3,'0')}</div></div></div>
<div class="badge">${isPmToSub?'NV Construction → Subcontractor':'Subcontractor Request'}</div>
<div class="grid"><div><div class="lbl">Project</div><div class="val">${job.project_name}</div></div><div><div class="lbl">Job Number</div><div class="val">#${job.job_number}</div></div><div><div class="lbl">Subcontractor</div><div class="val">${subName}</div></div>${scope?`<div><div class="lbl">Contract Scope</div><div class="val">${scope}</div></div>`:''}<div><div class="lbl">Date</div><div class="val">${date}</div></div><div><div class="lbl">Location</div><div class="val">${job.location||'—'}</div></div></div>
<div class="amt-box"><div><div class="num-lbl">Change Order Amount</div><div style="font-size:12px;color:#888;margin-top:4px">Status: ${co.status}</div></div><div class="amt">${amount>=0?'+':''}$${Math.abs(amount).toLocaleString('en-US',{minimumFractionDigits:2})}</div></div>
<div class="scope-box"><div class="lbl" style="margin-bottom:8px">Description of Change</div><div style="font-size:14px;line-height:1.7">${co.description}</div></div>
<div class="sig-grid"><div class="sig-block"><div class="sig-lbl">Subcontractor — ${subName}</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div><div class="sig-block"><div class="sig-lbl">NV Construction</div><div class="sig-line"></div><div class="sig-field">Signature</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Print Name &amp; Title</div><div class="sig-line" style="margin-top:16px"></div><div class="sig-field">Date</div></div></div>
<div class="footer">NV Construction · Generated ${new Date().toLocaleDateString()} · Job #${job.job_number}</div>
</body></html>`)
    w.document.close()
  }

  // ── Budget ──────────────────────────────────────────────────
  async function saveBudgetItem(e) {
    e.preventDefault()
    setAddingBudgetItem(true)
    await fetch('/api/budget-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      job_id: id, cost_code: budgetItemForm.cost_code || null, description: budgetItemForm.description,
      budget_amount: parseFloat(budgetItemForm.budget_amount),
      owner_amount: budgetItemForm.owner_amount ? parseFloat(budgetItemForm.owner_amount) : null,
    }) })
    await loadBudgetItems()
    setShowAddBudgetItem(false)
    setBudgetItemForm(emptyBudgetItem)
    setAddingBudgetItem(false)
  }

  async function updateBudgetItem(e) {
    e.preventDefault()
    await fetch('/api/budget-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      id: editingBudgetItem, fields: {
        cost_code: editBudgetForm.cost_code || null, description: editBudgetForm.description,
        budget_amount: parseFloat(editBudgetForm.budget_amount),
        owner_amount: editBudgetForm.owner_amount ? parseFloat(editBudgetForm.owner_amount) : null,
      }
    }) })
    setEditingBudgetItem(null)
    await loadBudgetItems()
  }

  async function deleteBudgetItem(itemId) {
    if (!window.confirm('Delete this budget line?')) return
    await fetch('/api/budget-items', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: itemId }) })
    await loadBudgetItems()
  }

  async function handleCSVUpload(e) {
    const file = e.target.files[0]
    if (!file) return
    setCsvUploading(true)
    try {
      const text = await file.text()
      const lines = text.trim().split(/\r?\n/)
      const isHeader = isNaN(parseFloat(lines[0].split(',').slice(-1)[0].replace(/"/g, '')))
      const rows = []
      for (let i = isHeader ? 1 : 0; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''))
        if (cols.length >= 2 && cols[1]) {
          rows.push({ job_id: id, cost_code: cols[0] || null, description: cols[1], budget_amount: parseFloat(cols[2]) || 0 })
        }
      }
      if (rows.length > 0) { await fetch('/api/budget-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rows) }); await loadBudgetItems() }
    } catch (err) {
      setErrMsg('CSV import failed: ' + err.message)
      setTimeout(() => setErrMsg(''), 4000)
    }
    e.target.value = ''
    setCsvUploading(false)
  }

  function committedForItem(budgetItemId) {
    return contracts.reduce((total, c) => {
      const adjusted = Number(c.adjusted_contract_value || c.contract_value || 0)
      const allocs = c.budget_allocations
      if (allocs && allocs.length > 0) {
        const match = allocs.find(a => a.budget_item_id === budgetItemId)
        if (!match) return total
        // Scale the allocation proportionally by the adjusted contract value (includes approved COs)
        const totalAlloc = allocs.reduce((s, a) => s + Number(a.amount || 0), 0)
        const pct = totalAlloc > 0 ? Number(match.amount) / totalAlloc : 0
        return total + pct * adjusted
      }
      if (c.budget_item_id === budgetItemId) {
        return total + adjusted
      }
      return total
    }, 0)
  }

  async function saveForecastEac(budgetItemId, value) {
    const val = value === '' ? null : parseFloat(value)
    await fetch('/api/budget-items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: budgetItemId, fields: { forecast_eac: val } }) })
    setBudgetItems(prev => prev.map(b => b.id === budgetItemId ? { ...b, forecast_eac: val } : b))
  }

  // ── Subs ────────────────────────────────────────────────────
  async function assignSubToJob() {
    const normalEmail = (assignSubForm.from_dir
      ? subDirectory.find(d => d.id === assignSubForm.from_dir)?.email
      : assignSubForm.email.trim()
    )?.toLowerCase()
    if (!normalEmail) return
    setAssigningSubLoading(true)
    const assignRes = await fetch('/api/job-assignments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, sub_email: normalEmail }) })
    if (!assignRes.ok) {
      const assignJson = await assignRes.json()
      setErrMsg(assignRes.status === 409 ? 'This sub is already assigned to this job.' : assignJson.error || 'Assignment failed.')
      setTimeout(() => setErrMsg(''), 4000)
      setAssigningSubLoading(false)
      return
    }
    await supabase.rpc('sync_job_assignments')
    await reloadSubs()
    setShowAssignSub(false)
    setAssignSubForm({ email: '', from_dir: '' })
    setAssigningSubLoading(false)
    const invRes = await fetch('/api/invite-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: normalEmail }) })
    const invJson = await invRes.json()
    if (!invRes.ok) setErrMsg('Assigned but invite failed: ' + invJson.error)
  }

  async function removeSubFromJob(assignmentId) {
    if (!window.confirm('Remove this subcontractor from this job?')) return
    await supabase.from('job_assignments').delete().eq('id', assignmentId)
    await reloadSubs()
  }

  async function notifySubToRegister(email) {
    setNotifyingSubId(email)
    const res = await fetch('/api/invite-sub', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    const json = await res.json()
    setNotifySubResult(prev => ({ ...prev, [email]: res.ok ? 'sent' : (json.error || 'error') }))
    setNotifyingSubId(null)
  }

  async function notifyAllUnregistered() {
    const unregistered = subs.filter(a => !a.sub_id && a.sub_email)
    for (const a of unregistered) await notifySubToRegister(a.sub_email)
  }

  // ── Billing (PM-managed) ─────────────────────────────────────
  async function createBilling() {
    if (!createBillingForm.amount_billed || !createBillingForm.company_name) return
    setCreatingBilling(true)
    const now = new Date().toISOString()
    const status = createBillingForm.auto_approve ? 'approved' : 'pending'
    const amtBilled = parseFloat(createBillingForm.amount_billed) || 0
    const retPct = parseFloat(createBillingForm._retainage_pct) || 0
    const retHeld = Math.round(amtBilled * retPct / 100 * 100) / 100
    const rowData = {
      job_id: id,
      company_name: createBillingForm.company_name,
      contact_name: createBillingForm.contact_name || null,
      contact_info: createBillingForm.contact_info || null,
      amount_billed: amtBilled,
      retainage_pct: retPct,
      retainage_held: retHeld,
      pct_complete: createBillingForm.pct_complete ? parseFloat(createBillingForm.pct_complete) : null,
      work_description: createBillingForm.work_description || null,
      billing_period: createBillingForm.billing_period ? createBillingForm.billing_period + '-01' : null,
      draw_request_id: createBillingForm.draw_request_id || null,
      status,
      submitted_at: now,
      reviewed_at: status === 'approved' ? now : null,
    }
    let res, result
    if (createBillingFile) {
      const formData = new FormData()
      formData.append('file', createBillingFile)
      formData.append('data', JSON.stringify(rowData))
      res = await fetch('/api/billing-entry', { method: 'POST', body: formData })
    } else {
      res = await fetch('/api/billing-entry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rowData) })
    }
    result = await res.json()
    if (result.error) { setCreateBillingError(result.error) }
    else {
      setCreateBillingError('')
      setShowCreateBilling(false)
      setCreateBillingForm(emptyCreateBilling)
      setCreateBillingFile(null)
      await loadBillingForJob()
    }
    setCreatingBilling(false)
  }

  async function updateBillingEntry() {
    if (editBillingForm.status === 'rejected') {
      await fetch('/api/billing-entry', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editingBilling }) })
      setEditingBilling(null)
      await loadBillingForJob()
      return
    }
    const now = new Date().toISOString()
    const origAmt = parseFloat(editBillingForm.amount_billed) || 0
    const retPctRaw = parseFloat(editBillingForm.retainage_pct)
    const editRetPct = isNaN(retPctRaw) ? 0 : retPctRaw
    const patchData = {
      id: editingBilling,
      company_name: editBillingForm.company_name,
      contact_name: editBillingForm.contact_name || null,
      contact_info: editBillingForm.contact_info || null,
      retainage_pct: editRetPct,
      retainage_held: Math.round(origAmt * editRetPct / 100 * 100) / 100,
      pct_complete: editBillingForm.pct_complete ? parseFloat(editBillingForm.pct_complete) : null,
      work_description: editBillingForm.work_description || null,
      billing_period: editBillingForm.billing_period ? editBillingForm.billing_period + '-01' : null,
      status: editBillingForm.status,
      reviewed_at: editBillingForm.status !== 'pending' ? now : null,
    }
    let res
    if (editBillingFile) {
      const formData = new FormData()
      formData.append('file', editBillingFile)
      formData.append('data', JSON.stringify(patchData))
      res = await fetch('/api/billing-entry', { method: 'PATCH', body: formData })
    } else {
      res = await fetch('/api/billing-entry', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patchData) })
    }
    const result = await res.json()
    if (result.error) { alert('Save error: ' + result.error); return }
    setEditingBilling(null)
    setEditBillingFile(null)
    await loadBillingForJob()
  }

  async function deleteBillingEntry(billingId) {
    if (!window.confirm('Delete this billing submission?')) return
    await fetch('/api/billing-entry', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: billingId }) })
    await loadBillingForJob()
  }

  async function assignBillingToDraw(billingId, drawRequestId) {
    await fetch('/api/billing-entry', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: billingId, draw_request_id: drawRequestId || null }),
    })
    await loadBillingForJob()
  }

  async function toggleNvCutsCheck(billingId, current) {
    setTogglingNvCheck(billingId)
    await supabase.from('billing_submissions').update({ nv_cuts_check: !current }).eq('id', billingId)
    setTogglingNvCheck(null)
    await loadBillingForJob()
  }

  async function toggleReadyToPay(billingId, current) {
    setTogglingReadyToPay(billingId)
    await supabase.from('billing_submissions').update({ ready_to_pay: !current }).eq('id', billingId)
    setTogglingReadyToPay(null)
    await loadBillingForJob()
  }

  // ── Completion Report ────────────────────────────────────────
  async function generateCompletionReport(markComplete = false) {
    setGeneratingReport(true)
    try {
      const [
        { data: billings },
        { data: dcs },
        { data: aiaApps },
        { data: budgets },
        { data: primeCOData },
      ] = await Promise.all([
        supabase.from('billing_submissions').select('*').eq('job_id', id).eq('status', 'approved').order('company_name'),
        supabase.from('direct_costs').select('*').eq('job_id', id).eq('status', 'approved').order('cost_date'),
        supabase.from('aia_applications').select('*').eq('job_id', id).order('app_number'),
        supabase.from('budget_items').select('*').eq('job_id', id).order('cost_code'),
        supabase.from('prime_change_orders').select('*').eq('job_id', id).eq('status', 'approved'),
      ])

      if (markComplete) {
        await supabase.from('jobs').update({ status: 'complete' }).eq('id', id)
        setJob(j => ({ ...j, status: 'complete' }))
        setForm(f => ({ ...f, status: 'complete' }))
      }

      const fmt = n => '$' + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const fmtSigned = n => (n < 0 ? '-' : '') + fmt(n)
      const genDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

      const approvedCOsTotal = (primeCOData || []).reduce((a, co) => a + Number(co.amount || 0), 0)
      const subNvTotalReport = nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0)
      const baseContractReport = Number(job.contract_value || 0)
      const contractSumToDate = job.nv_role === 'sub'
        ? (subNvTotalReport > 0 ? subNvTotalReport : baseContractReport)
        : baseContractReport + approvedCOsTotal
      const origContract = job.nv_role === 'sub' ? contractSumToDate : baseContractReport

      const totalBilledAIA = (aiaApps || []).reduce((a, app) => {
        // Use last app's completed value — we'll calc from lines if needed; use billed from apps status
        return a
      }, 0)
      const receivedApps = (aiaApps || []).filter(a => a.payment_received)
      // Sum received via AIA: calculate from the apps that were payment_received
      // We'll compute received total from billing submissions as a proxy, plus direct costs
      const subCostsTotal = (billings || []).reduce((a, b) => a + Number(b.amount_billed || 0), 0)
      const dcTotal = (dcs || []).reduce((a, c) => a + Number(c.amount || 0), 0)
      const laborTotal = laborAllocations.reduce((a, al) => a + allocCost(al), 0)
      const totalCosts = subCostsTotal + dcTotal + laborTotal

      // Group subs
      const subMap = {}
      ;(billings || []).forEach(b => {
        if (!subMap[b.company_name]) subMap[b.company_name] = 0
        subMap[b.company_name] += Number(b.amount_billed || 0)
      })

      // Group direct costs by category
      const dcByCategory = {}
      ;(dcs || []).forEach(c => {
        if (!dcByCategory[c.category]) dcByCategory[c.category] = 0
        dcByCategory[c.category] += Number(c.amount || 0)
      })

      // Budget vs actual per line
      const dcByBudgetItem = {}
      ;(dcs || []).forEach(c => {
        if (c.budget_item_id) {
          if (!dcByBudgetItem[c.budget_item_id]) dcByBudgetItem[c.budget_item_id] = 0
          dcByBudgetItem[c.budget_item_id] += Number(c.amount || 0)
        }
      })
      // Sub costs by budget item — from AIA lines of the latest app
      const subByBudgetItem = {}
      if (aiaApps && aiaApps.length > 0) {
        const lastApp = aiaApps[aiaApps.length - 1]
        const { data: lastLines } = await supabase.from('aia_application_lines').select('*').eq('application_id', lastApp.id)
        ;(lastLines || []).forEach(l => {
          const bAmt = Number(budgets?.find(b => b.id === l.budget_item_id)?.owner_amount ?? budgets?.find(b => b.id === l.budget_item_id)?.budget_amount ?? 0)
          const prevAmt = bAmt * (parseFloat(l.pct_prev) || 0) / 100
          const thisAmt = bAmt * (parseFloat(l.pct_this_period) || 0) / 100
          subByBudgetItem[l.budget_item_id] = prevAmt + thisAmt
        })
      }

      // Revenue received: contract sum × % billed via last AIA app (or just use contractSumToDate if all received)
      const allReceived = receivedApps.length > 0 && receivedApps.length === (aiaApps || []).length
      const lastApp = aiaApps && aiaApps.length > 0 ? aiaApps[aiaApps.length - 1] : null
      const revenueReceived = receivedApps.reduce((a, app) => {
        // rough: pro-rate by app_number; better is to sum AIA lines
        return a
      }, 0) || contractSumToDate // fallback to contract if we can't calc
      // Use total payment received from AIA apps that are marked received — value from contractSumToDate as best estimate
      const receivedCount = receivedApps.length
      const totalApps = (aiaApps || []).length
      const grossProfit = contractSumToDate - totalCosts
      const grossMargin = contractSumToDate > 0 ? (grossProfit / contractSumToDate * 100) : 0

      const pmMember = teamMembers.find(m => m.email === job.pm_email)
      const pmName = pmMember?.full_name || job.pm_email || '—'

      const w = window.open('', '_blank')
      w.document.write(`<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<title>Job Completion Report — #${job.job_number}</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 32px 40px; max-width: 900px; margin: 0 auto; }
.print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 12px; margin-bottom: 24px; margin-right: 8px; }
@media print { .print-btn { display: none; } }
.logo-row { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
.logo-box { width: 48px; height: 48px; background: #1b2a4a; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.logo-nv { color: #e8560c; font-size: 20px; font-weight: 900; font-family: Arial Black, sans-serif; line-height: 1; }
.logo-sub { color: #fff; font-size: 5px; letter-spacing: 1.5px; margin-top: 2px; }
.logo-text { font-size: 18px; font-weight: 800; color: #111; }
.logo-sub2 { font-size: 11px; color: #888; letter-spacing: 2px; text-transform: uppercase; }
h1 { font-size: 22px; font-weight: 800; color: #111; margin-bottom: 4px; }
.meta { font-size: 12px; color: #777; margin-bottom: 6px; }
.badges { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
.badge { padding: 3px 10px; border-radius: 99px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border: 1px solid #ddd; color: #555; }
.badge-green { background: #f0fff4; color: #1a7a3a; border-color: #b2f0c8; }
.badge-orange { background: #fff8f0; color: #c45200; border-color: #ffd0a0; }
.section { margin-bottom: 28px; }
.section-title { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #888; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 14px; }
.kv { display: grid; grid-template-columns: 1fr auto; gap: 4px 24px; font-size: 12px; }
.kv .k { color: #555; }
.kv .v { text-align: right; font-family: monospace; font-weight: 600; }
.kv .total-row .k, .kv .total-row .v { font-weight: 800; font-size: 14px; color: #111; border-top: 1px solid #ccc; padding-top: 6px; margin-top: 4px; }
.kv .highlight .v { color: #1a7a3a; font-size: 15px; }
.kv .loss .v { color: #cc0000; font-size: 15px; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 28px; }
.stat-box { border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px 16px; }
.stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #999; margin-bottom: 6px; }
.stat-value { font-size: 20px; font-weight: 800; }
.stat-value.green { color: #1a7a3a; }
.stat-value.red { color: #cc0000; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th { padding: 7px 10px; border-bottom: 2px solid #111; font-size: 9.5px; text-transform: uppercase; letter-spacing: 1px; color: #555; text-align: left; }
td { padding: 8px 10px; border-bottom: 1px solid #eee; }
td.r { text-align: right; font-family: monospace; }
td.muted { color: #999; }
tr.subtotal td { font-weight: 700; border-top: 1px solid #ccc; border-bottom: none; }
tr.subtotal td.red { color: #cc0000; }
tr.subtotal td.green { color: #1a7a3a; }
.foot { margin-top: 40px; font-size: 10px; color: #bbb; border-top: 1px solid #eee; padding-top: 12px; text-align: center; }
</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<button class="print-btn" style="background:#555" onclick="window.close()">Close</button>

<div class="logo-row">
  <div class="logo-box"><div class="logo-nv">NV</div><div class="logo-sub">CONSTRUCTION</div></div>
  <div><div class="logo-text">NV Construction</div><div class="logo-sub2">Job Completion Report</div></div>
</div>

<h1>#${job.job_number} — ${job.project_name}</h1>
<p class="meta">${[job.location, job.owner_company ? 'Owner: ' + job.owner_company : '', 'PM: ' + pmName].filter(Boolean).join(' &nbsp;·&nbsp; ')}</p>
<div class="badges">
  <span class="badge badge-green">Completed</span>
  <span class="badge">Generated ${genDate}</span>
  ${job.start_date ? `<span class="badge">Started ${new Date(job.start_date + 'T12:00:00').toLocaleDateString()}</span>` : ''}
</div>

<div class="summary-grid">
  <div class="stat-box"><div class="stat-label">Contract Sum to Date</div><div class="stat-value">${fmt(contractSumToDate)}</div></div>
  <div class="stat-box"><div class="stat-label">Total Project Costs</div><div class="stat-value">${fmt(totalCosts)}</div></div>
  <div class="stat-box"><div class="stat-label">Gross Profit</div><div class="stat-value ${grossProfit >= 0 ? 'green' : 'red'}">${fmtSigned(grossProfit)}</div></div>
</div>

<div class="section">
  <div class="section-title">Revenue</div>
  <div class="kv">
    <span class="k">Original contract value</span><span class="v">${fmt(origContract)}</span>
    ${(primeCOData || []).length > 0 ? `<span class="k">Approved change orders (${(primeCOData || []).length})</span><span class="v">${approvedCOsTotal >= 0 ? '+' : ''}${fmtSigned(approvedCOsTotal)}</span>` : ''}
    <span class="k" style="font-weight:700;color:#111">Contract sum to date</span><span class="v" style="font-weight:700;color:#111;border-top:1px solid #ccc;padding-top:4px;margin-top:2px">${fmt(contractSumToDate)}</span>
    ${totalApps > 0 ? `<span class="k">AIA applications submitted</span><span class="v">${totalApps}</span>` : ''}
    ${receivedCount > 0 ? `<span class="k">Payments received</span><span class="v">${receivedCount} of ${totalApps}</span>` : ''}
  </div>
</div>

${Object.keys(subMap).length > 0 ? `
<div class="section">
  <div class="section-title">Subcontractor Costs — ${fmt(subCostsTotal)} approved</div>
  <table>
    <thead><tr><th>Company</th><th class="r">Amount Billed</th></tr></thead>
    <tbody>
      ${Object.entries(subMap).sort((a, b) => b[1] - a[1]).map(([name, amt]) => `<tr><td>${name}</td><td class="r">${fmt(amt)}</td></tr>`).join('')}
      <tr class="subtotal"><td>Total subcontractor costs</td><td class="r">${fmt(subCostsTotal)}</td></tr>
    </tbody>
  </table>
</div>` : ''}

${Object.keys(dcByCategory).length > 0 ? `
<div class="section">
  <div class="section-title">Direct Costs — ${fmt(dcTotal)} approved</div>
  <table>
    <thead><tr><th>Category</th><th class="r">Amount</th></tr></thead>
    <tbody>
      ${Object.entries(dcByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => `<tr><td>${cat}</td><td class="r">${fmt(amt)}</td></tr>`).join('')}
      <tr class="subtotal"><td>Total direct costs</td><td class="r">${fmt(dcTotal)}</td></tr>
    </tbody>
  </table>
</div>` : ''}

<div class="section">
  <div class="section-title">Performance Summary</div>
  <div class="kv">
    <span class="k">Contract sum to date (revenue)</span><span class="v">${fmt(contractSumToDate)}</span>
    <span class="k">Subcontractor costs</span><span class="v">(${fmt(subCostsTotal)})</span>
    <span class="k">Direct costs</span><span class="v">(${fmt(dcTotal)})</span>
    ${laborTotal > 0 ? `<span class="k">Labor costs</span><span class="v">(${fmt(laborTotal)})</span>` : ''}
    <span class="k total-row ${grossProfit >= 0 ? 'highlight' : 'loss'}">Gross profit</span><span class="v total-row ${grossProfit >= 0 ? 'highlight' : 'loss'}">${fmtSigned(grossProfit)}</span>
    <span class="k">Gross margin</span><span class="v">${grossMargin.toFixed(1)}%</span>
  </div>
</div>

${(budgets || []).length > 0 ? `
<div class="section">
  <div class="section-title">Budget vs Actual by Line Item</div>
  <table>
    <thead><tr>
      <th>Code</th><th>Description</th>
      <th class="r">Owner Budget</th>
      <th class="r">Sub Cost (AIA)</th>
      <th class="r">Direct Costs</th>
      <th class="r">Total Actual</th>
      <th class="r">Variance</th>
    </tr></thead>
    <tbody>
      ${(budgets || []).map(b => {
        const ownerAmt = Number(b.owner_amount ?? b.budget_amount ?? 0)
        const subAmt = subByBudgetItem[b.id] || 0
        const dcAmt = dcByBudgetItem[b.id] || 0
        const actual = subAmt + dcAmt
        const variance = ownerAmt - actual
        const over = variance < 0
        return `<tr>
          <td style="font-family:monospace;font-size:10px;color:#888">${b.cost_code || '—'}</td>
          <td>${b.description}</td>
          <td class="r">${ownerAmt > 0 ? fmt(ownerAmt) : '<span style="color:#ccc">—</span>'}</td>
          <td class="r">${subAmt > 0 ? fmt(subAmt) : '<span style="color:#ccc">—</span>'}</td>
          <td class="r">${dcAmt > 0 ? fmt(dcAmt) : '<span style="color:#ccc">—</span>'}</td>
          <td class="r">${actual > 0 ? fmt(actual) : '<span style="color:#ccc">—</span>'}</td>
          <td class="r ${over ? 'red' : ''}" style="${over ? 'color:#cc0000' : 'color:#1a7a3a'}">${ownerAmt > 0 || actual > 0 ? (over ? '-' : '+') + fmt(Math.abs(variance)) : '—'}</td>
        </tr>`
      }).join('')}
      <tr class="subtotal">
        <td></td><td>Totals</td>
        <td class="r">${fmt((budgets || []).reduce((a, b) => a + Number(b.owner_amount ?? b.budget_amount ?? 0), 0))}</td>
        <td class="r">${fmt(Object.values(subByBudgetItem).reduce((a, v) => a + v, 0))}</td>
        <td class="r">${fmt(Object.values(dcByBudgetItem).reduce((a, v) => a + v, 0))}</td>
        <td class="r">${fmt(totalCosts)}</td>
        <td class="r ${grossProfit >= 0 ? 'green' : 'red'}">${grossProfit >= 0 ? '+' : '-'}${fmt(Math.abs(grossProfit))}</td>
      </tr>
    </tbody>
  </table>
</div>` : ''}

<div class="foot">NV Construction &nbsp;·&nbsp; Job #${job.job_number} — ${job.project_name} &nbsp;·&nbsp; Generated ${genDate}</div>
</body></html>`)
      w.document.close()
    } finally {
      setGeneratingReport(false)
    }
  }

  // ── Job ─────────────────────────────────────────────────────
  async function saveJob(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('jobs').update({
      job_number: form.job_number, project_name: form.project_name, location: form.location,
      contract_value: form.contract_value ? parseFloat(form.contract_value) : null,
      markup_pct: form.markup_pct ? parseFloat(form.markup_pct) : null,
      payment_type: form.payment_type || 'nv_pays',
      billing_frequency: form.billing_frequency || 'monthly',
      billing_due_day: form.billing_due_day !== undefined && form.billing_due_day !== '' ? parseInt(form.billing_due_day) : null,
      billing_anchor_date: form.billing_frequency === 'biweekly' && form.billing_due_day !== '' && form.billing_due_day !== undefined && !form.billing_anchor_date ? (() => { const d = new Date(); const diff = (parseInt(form.billing_due_day) - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff); return d.toISOString().split('T')[0] })() : (form.billing_anchor_date || null),
      start_date: form.start_date || null, status: form.status,
      sub_billing_start: form.sub_billing_start || null,
      sub_billing_frequency: form.sub_billing_frequency || 'monthly',
      sub_billing_due: form.sub_billing_due !== '' && form.sub_billing_due !== undefined ? parseInt(form.sub_billing_due) : null,
      sub_billing_anchor: form.sub_billing_anchor || null,
      owner_billing_start: form.owner_billing_start || null,
      owner_billing_frequency: form.owner_billing_frequency || 'monthly',
      owner_billing_due: form.owner_billing_due !== '' && form.owner_billing_due !== undefined ? parseInt(form.owner_billing_due) : null,
      owner_billing_anchor: form.owner_billing_anchor || null,
      owner_company: form.owner_company, owner_name: form.owner_name, owner_email: form.owner_email, owner_phone: form.owner_phone,
      architect_name: form.architect_name, architect_company: form.architect_company, architect_email: form.architect_email,
      engineer_name: form.engineer_name, engineer_company: form.engineer_company, engineer_email: form.engineer_email,
      permit_number: form.permit_number, permit_date: form.permit_date || null, scope_notes: form.scope_notes,
      pm_email: form.pm_email || null,
      billing_type: form.billing_type || 'aia',
      nv_role: form.nv_role || 'gc',
    }).eq('id', id)
    if (error) { setErrMsg('Save failed: ' + error.message); setTimeout(() => setErrMsg(''), 5000) }
    else { setJob(j => ({ ...j, ...form })); setMsg('Job saved successfully.'); setTimeout(() => setMsg(''), 3000) }
    setSaving(false)
  }

  async function archiveJob() {
    await supabase.from('jobs').update({ archived: true, status: 'on_hold' }).eq('id', id)
    setMsg('Job archived.')
    setTimeout(() => router.push('/dashboard'), 1500)
  }

  async function deleteJob() {
    await supabase.from('job_assignments').delete().eq('job_id', id)
    await supabase.from('billing_submissions').delete().eq('job_id', id)
    await supabase.from('jobs').delete().eq('id', id)
    router.push('/dashboard')
  }

  // ── PDF exports ──────────────────────────────────────────────
  function exportContractsPDF() {
    const w = window.open('', '_blank')
    const date = new Date().toLocaleDateString()
    const rows = contracts.map(c => ({ c, subName: c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown' }))
    w.document.write(`<!DOCTYPE html><html><head>
<title>Subcontract Summary — Job #${job.job_number}</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Arial, sans-serif; color: #111; padding: 40px; font-size: 13px; line-height: 1.5; }
h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; } .meta { color: #666; margin-bottom: 28px; }
.print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 28px; }
.section-title { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #888; font-weight: 700; margin-bottom: 12px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #111; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
td { padding: 10px; border-bottom: 1px solid #eee; vertical-align: top; }
.right { text-align: right; } .over { color: #cc0000; }
.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
.generated { font-size: 11px; color: #aaa; margin-top: 40px; }
@media print { .print-btn { display: none; } }</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<h1>#${job.job_number} — ${job.project_name}</h1>
<p class="meta">${[job.location, job.start_date ? 'Started ' + new Date(job.start_date).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</p>
<div class="section-title">Subcontract Summary</div>
<table><thead><tr><th>Subcontractor</th><th>Scope</th><th class="right">Contract</th><th class="right">COs</th><th class="right">Revised</th><th class="right">Remaining</th></tr></thead>
<tbody>${rows.map(({ c, subName }) => `<tr><td>${subName}</td><td style="color:#666">${c.description || '—'}</td><td class="right">$${Number(c.contract_value).toLocaleString()}</td><td class="right">${Number(c.approved_change_orders) >= 0 ? '+' : ''}$${Number(c.approved_change_orders).toLocaleString()}</td><td class="right">$${Number(c.adjusted_contract_value).toLocaleString()}</td><td class="right ${Number(c.remaining_balance) < 0 ? 'over' : ''}">$${Number(c.remaining_balance).toLocaleString()}</td></tr>`).join('')}
<tr class="total"><td colspan="2">Total</td><td class="right">$${totalContractValue.toLocaleString()}</td><td class="right">${totalCOs >= 0 ? '+' : ''}$${Math.abs(totalCOs).toLocaleString()}</td><td class="right">$${totalRevised.toLocaleString()}</td><td></td></tr>
</tbody></table><p class="generated">Generated ${date} · NV Construction</p></body></html>`)
    w.document.close()
  }

  function exportBudgetPDF() {
    const w = window.open('', '_blank')
    const date = new Date().toLocaleDateString()
    w.document.write(`<!DOCTYPE html><html><head>
<title>Budget Report — Job #${job.job_number}</title>
<style>* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, Arial, sans-serif; color: #111; padding: 40px; font-size: 13px; line-height: 1.5; }
h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; } .meta { color: #666; margin-bottom: 28px; }
.print-btn { padding: 8px 20px; background: #111; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; margin-bottom: 28px; }
.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
.stat { padding: 14px 16px; border: 1px solid #ddd; border-radius: 8px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 800; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 8px 10px; border-bottom: 2px solid #111; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #555; }
td { padding: 10px; border-bottom: 1px solid #eee; }
.right { text-align: right; } .mono { font-family: monospace; font-size: 11px; color: #888; } .over { color: #cc0000; }
.total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
.generated { font-size: 11px; color: #aaa; margin-top: 40px; }
@media print { .print-btn { display: none; } }</style></head><body>
<button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
<h1>#${job.job_number} — ${job.project_name}</h1>
<p class="meta">${[job.location, job.start_date ? 'Started ' + new Date(job.start_date).toLocaleDateString() : ''].filter(Boolean).join(' · ')}</p>
<div class="summary">
  <div class="stat"><div class="stat-label">Total budget</div><div class="stat-value">$${totalBudget.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Committed</div><div class="stat-value">$${totalCommitted.toLocaleString()}</div></div>
  <div class="stat"><div class="stat-label">Uncommitted</div><div class="stat-value ${totalUncommitted < 0 ? 'over' : ''}">${totalUncommitted < 0 ? '-' : ''}$${Math.abs(totalUncommitted).toLocaleString()}</div></div>
</div>
<table><thead><tr><th>Code</th><th>Description</th><th class="right">Budget</th><th class="right">Committed</th><th class="right">Uncommitted</th><th class="right">% Used</th></tr></thead>
<tbody>${budgetItems.map(item => { const committed = committedForItem(item.id); const uncommitted = Number(item.budget_amount) - committed; const pct = Number(item.budget_amount) > 0 ? (committed / Number(item.budget_amount) * 100).toFixed(0) : 0; const over = uncommitted < 0; return `<tr><td class="mono">${item.cost_code || '—'}</td><td>${item.description}</td><td class="right">$${Number(item.budget_amount).toLocaleString()}</td><td class="right">$${committed.toLocaleString()}</td><td class="right ${over ? 'over' : ''}">${over ? '-' : ''}$${Math.abs(uncommitted).toLocaleString()}</td><td class="right ${over ? 'over' : ''}">${pct}%</td></tr>` }).join('')}
<tr class="total"><td></td><td>Total</td><td class="right">$${totalBudget.toLocaleString()}</td><td class="right">$${totalCommitted.toLocaleString()}</td><td class="right ${totalUncommitted < 0 ? 'over' : ''}">${totalUncommitted < 0 ? '-' : ''}$${Math.abs(totalUncommitted).toLocaleString()}</td><td class="right">${totalBudget > 0 ? ((totalCommitted / totalBudget) * 100).toFixed(0) : 0}%</td></tr>
</tbody></table><p class="generated">Generated ${date} · NV Construction</p></body></html>`)
    w.document.close()
  }

  // ── Derived values ───────────────────────────────────────────
  const totalBilled = billing.reduce((a, b) => a + (b.amount_billed || 0), 0)
  const pendingBilling = billing.filter(b => b.status === 'pending').length
  const pctContract = job?.contract_value ? ((totalBilled / job.contract_value) * 100).toFixed(1) : null
  const totalContractValue = contracts.reduce((a, c) => a + Number(c.contract_value || 0), 0)
  const totalCOs = contracts.reduce((a, c) => a + Number(c.approved_change_orders || 0), 0)
  const totalRevised = contracts.reduce((a, c) => a + Number(c.adjusted_contract_value || 0), 0)
  const totalBudget = budgetItems.reduce((a, b) => a + Number(b.budget_amount || 0), 0)
  const totalOwnerSOV = budgetItems.reduce((a, b) => a + Number(b.owner_amount ?? b.budget_amount ?? 0), 0)
  const totalMarkup = totalOwnerSOV - totalBudget
  const totalCommitted = budgetItems.reduce((a, b) => a + committedForItem(b.id), 0)
  const totalUncommitted = totalBudget - totalCommitted
  const registeredSubs = subs.filter(s => s.sub_id)
  const pendingCOs = allCOs.filter(co => co.status === 'pending').length
  const approvedCOValue = allCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
  const pendingBillingCount = billingSubmissions.filter(b => b.status === 'pending').length
  const approvedBillingTotal = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.amount_billed || 0), 0)
  const totalLaborCostLive = laborAllocations.reduce((a, al) => a + allocCost(al), 0)

  if (loading) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', color: '#555' }}>Loading...</div>

  return (
    <div style={s.page}>
      <header style={s.header}>
        <div style={s.headerInner}>
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NV Construction" style={s.logoImg} />
            <div>
              <div style={s.logoName}>NV Construction</div>
              <div style={s.logoSub}>Job Detail</div>
            </div>
          </div>
          <button style={{ padding: '7px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#888', cursor: 'pointer', fontSize: '13px' }} onClick={async () => { await supabase.auth.signOut(); router.push('/login') }}>Sign out</button>
        </div>
      </header>

      <main style={s.main} className="rx-main">
        <button style={s.backBtn} onClick={() => router.push('/dashboard')}>← Back to dashboard</button>

        {msg && <div style={s.successMsg}>{msg}</div>}
        {errMsg && <div style={s.errorMsg}>{errMsg}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <h1 style={{ ...s.jobTitle, margin: 0 }}>#{job.job_number} — {job.project_name}</h1>
              {job.nv_role === 'sub' && <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 9px', borderRadius: '99px', background: '#0a1a2a', color: '#60a5fa', border: '1px solid #1a3a5a', letterSpacing: '0.5px', textTransform: 'uppercase', flexShrink: 0 }}>Subcontractor</span>}
            </div>
            <p style={s.jobMeta}>{job.location}{job.start_date ? ' · Started ' + new Date(job.start_date).toLocaleDateString() : ''}</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {job.status !== 'complete' && !job.archived && (
              <button
                style={{ padding: '9px 18px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: generatingReport ? 'default' : 'pointer', letterSpacing: '1px', textTransform: 'uppercase', opacity: generatingReport ? 0.6 : 1 }}
                disabled={generatingReport}
                onClick={async () => {
                  if (!window.confirm('Mark this job as complete and generate the financial performance report?')) return
                  await generateCompletionReport(true)
                }}>
                {generatingReport ? 'Generating...' : '✓ Complete Job & Report'}
              </button>
            )}
            {job.status === 'complete' && (
              <button
                style={{ padding: '9px 18px', background: '#1a1a2a', color: '#a78bfa', border: '1px solid #3a1a5a', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: generatingReport ? 'default' : 'pointer', letterSpacing: '1px', textTransform: 'uppercase', opacity: generatingReport ? 0.6 : 1 }}
                disabled={generatingReport}
                onClick={() => generateCompletionReport(false)}>
                {generatingReport ? 'Generating...' : 'Generate Report'}
              </button>
            )}
            <span style={s.badge(job.archived ? 'archived' : job.status)}>{job.archived ? 'Archived' : job.status}</span>
          </div>
        </div>

        <div style={s.statRow} className="rx-stats">
          <div style={s.statCard}><div style={s.statLabel}>Total billed</div><div style={s.statValue()}>${totalBilled.toLocaleString()}</div></div>
          <div style={s.statCard}>
            <div style={s.statLabel}>Contract sum to date</div>
            {(() => {
              const isSub = job.nv_role === 'sub'
              const subTotal = nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0)
              const approvedCOs = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
              const baseVal = parseFloat(job.contract_value || 0)
              const total = isSub ? (subTotal > 0 ? subTotal : baseVal) : baseVal + approvedCOs
              const hasValue = isSub ? (subTotal > 0 || !!job.contract_value) : !!job.contract_value
              return (
                <>
                  <div style={s.statValue()}>{hasValue ? '$' + total.toLocaleString() : '—'}</div>
                  {isSub && nvSubcontracts.length > 0 && (
                    <div style={{ fontSize: '11px', color: '#555', marginTop: '3px' }}>{nvSubcontracts.length} subcontract{nvSubcontracts.length !== 1 ? 's' : ''}</div>
                  )}
                  {!isSub && approvedCOs !== 0 && (
                    <div style={{ fontSize: '11px', color: '#555', marginTop: '3px' }}>
                      ${baseVal.toLocaleString()} base + {primeCOs.filter(co => co.status === 'approved').length} CO{primeCOs.filter(co => co.status === 'approved').length !== 1 ? 's' : ''}
                    </div>
                  )}
                </>
              )
            })()}
          </div>
          <div style={s.statCard}><div style={s.statLabel}>% billed</div><div style={s.statValue('#e8590c')}>{pctContract ? pctContract + '%' : '—'}</div></div>
        </div>

        {/* ── SIDEBAR + CONTENT LAYOUT ── */}
        <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>

          {/* Left sidebar nav */}
          <aside className="rx-sidebar" style={{ width: '196px', flexShrink: 0, position: 'sticky', top: '80px', background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '12px', padding: '12px', alignSelf: 'flex-start' }}>
            {[
              {
                group: 'Project',
                items: [
                  { key: 'details', label: 'Details' },
                  { key: 'contacts', label: 'Contacts', badge: jobContacts.length || null },
                  { key: 'documents', label: 'Documents', badge: jobDocs.length || null },
                  { key: 'schedule', label: 'Schedule' },
                  { key: 'closeout', label: 'Closeout' },
                  { key: 'warranty', label: 'Warranty', badge: warrantyOrders.filter(o => o.status !== 'resolved').length || null },
                ],
              },
              {
                group: 'Financials',
                items: [
                  { key: 'budget', label: 'Budget' },
                  { key: 'changeorders', label: 'Change Orders', badge: pendingCOs > 0 ? `${pendingCOs} pending` : null, alert: pendingCOs > 0 },
                  { key: 'billing', label: 'Billing', badge: pendingBillingCount > 0 ? `${pendingBillingCount} pending` : null, alert: pendingBillingCount > 0 },
                  { key: 'costs', label: 'Direct Costs', badge: directCosts.filter(c => c.status === 'pending').length > 0 ? `${directCosts.filter(c => c.status === 'pending').length} pending` : null, alert: directCosts.filter(c => c.status === 'pending').length > 0 },
                  { key: 'prime', label: job?.nv_role === 'sub' ? 'GC Billing' : 'Prime Contract' },
                  { key: 'cashflow', label: 'Cash Flow' },
                  { key: 'retainage', label: 'Retainage' },
                  { key: 'prelim', label: 'Lien Log', badge: prelimNotices.filter(n => n.status === 'active').length > 0 ? prelimNotices.filter(n => n.status === 'active').length : null, alert: prelimNotices.filter(n => n.status === 'active').length > 0 },
                ],
              },
              {
                group: 'Field',
                items: [
                  { key: 'field', label: 'Field', badge: fieldRfis.filter(r => r.status === 'open').length > 0 ? `${fieldRfis.filter(r => r.status === 'open').length} RFI` : null, alert: fieldRfis.filter(r => r.status === 'open').length > 0 },
                  { key: 'submittals', label: 'Submittals', badge: submittals.length || null },
                  { key: 'punch', label: 'Punch List', badge: punchItems.filter(p => p.status !== 'approved').length || null, alert: punchItems.filter(p => p.status === 'open').length > 0 },
                  { key: 'photos', label: 'Site Photos', badge: fieldPhotos.length || null },
                ],
              },
              {
                group: 'Team',
                items: [
                  { key: 'subs', label: 'Subs', badge: subs.length || null },
                  { key: 'contracts', label: 'Contracts', badge: contracts.length || null },
                  ...(userRole === 'pm' ? [{ key: 'labor', label: 'Labor', badge: laborAllocations.length || null }] : []),
                ],
              },
            ].map(({ group, items }) => (
              <div key={group} style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#444', letterSpacing: '2px', textTransform: 'uppercase', padding: '0 8px', marginBottom: '4px' }}>{group}</div>
                {items.map(({ key, label, badge, alert }) => {
                  const active = activeTab === key
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        width: '100%', padding: '7px 10px', marginBottom: '1px',
                        background: active ? '#1a1a1a' : 'transparent',
                        border: 'none',
                        borderLeft: active ? '2px solid #e8590c' : '2px solid transparent',
                        borderRadius: '6px',
                        color: active ? '#f1f1f1' : '#666',
                        fontSize: '13px', fontWeight: active ? '700' : '500',
                        cursor: 'pointer', textAlign: 'left',
                        transition: 'color 0.1s',
                      }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#aaa' }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#666' }}
                    >
                      <span>{label}</span>
                      {badge ? (
                        <span style={{
                          fontSize: '10px', fontWeight: '700', padding: '2px 6px', borderRadius: '99px',
                          background: alert ? '#3a1200' : '#1a1a1a',
                          color: alert ? '#e8590c' : '#555',
                          border: `1px solid ${alert ? '#5a2200' : '#2a2a2a'}`,
                          letterSpacing: '0.3px', whiteSpace: 'nowrap',
                        }}>{badge}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))}
          </aside>

          {/* Main content area */}
          <div style={{ flex: 1, minWidth: 0 }}>

        {/* ── MOBILE SECTION NAV (hidden on desktop) ── */}
        <select className="rx-mobile-nav-select" value={activeTab} onChange={e => setActiveTab(e.target.value)} style={{ width: '100%', padding: '11px 14px', background: '#141414', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#f1f1f1', fontSize: '16px', marginBottom: '1.25rem' }}>
          <optgroup label="Project">
            <option value="details">Details</option>
            <option value="contacts">Contacts</option>
            <option value="documents">Documents</option>
            <option value="schedule">Schedule</option>
            <option value="closeout">Closeout</option>
            <option value="warranty">Warranty</option>
          </optgroup>
          <optgroup label="Financials">
            <option value="budget">Budget</option>
            <option value="changeorders">Change Orders</option>
            <option value="billing">Billing</option>
            <option value="costs">Direct Costs</option>
            <option value="prime">Prime Contract</option>
            <option value="cashflow">Cash Flow</option>
            <option value="retainage">Retainage</option>
            <option value="prelim">Lien Log</option>
          </optgroup>
          <optgroup label="Field">
            <option value="field">Field Reports</option>
            <option value="submittals">Submittals</option>
            <option value="punch">Punch List</option>
            <option value="photos">Site Photos</option>
          </optgroup>
          <optgroup label="Team">
            <option value="subs">Subs</option>
            <option value="contracts">Contracts</option>
            {userRole === 'pm' && <option value="labor">Labor</option>}
          </optgroup>
        </select>

        {/* ── DETAILS TAB ── */}
        {activeTab === 'details' && (
          <>
            <form onSubmit={saveJob}>
              <div style={s.card}>
                <p style={s.cardTitle}>Job info</p>
                <div style={{ marginBottom: '12px' }}>
                  <label style={s.label}>NV role on this job</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {[{ v: 'gc', label: 'General Contractor' }, { v: 'sub', label: 'Subcontractor' }].map(({ v, label }) => (
                      <button key={v} type="button" onClick={() => update('nv_role', v)} style={{ padding: '8px 18px', borderRadius: '6px', border: `1px solid ${(form.nv_role || 'gc') === v ? '#e8590c' : '#2a2a2a'}`, background: (form.nv_role || 'gc') === v ? '#2a1200' : '#0a0a0a', color: (form.nv_role || 'gc') === v ? '#e8590c' : '#666', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                  <div><label style={s.label}>Job number</label><input style={s.input} value={form.job_number || ''} onChange={e => update('job_number', e.target.value)} required /></div>
                  <div><label style={s.label}>Project name</label><input style={s.input} value={form.project_name || ''} onChange={e => update('project_name', e.target.value)} required /></div>
                  <div><label style={s.label}>Location</label><input style={s.input} value={form.location || ''} onChange={e => update('location', e.target.value)} /></div>
                </div>
                <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                  <div><label style={s.label}>Contract value</label><input type="number" style={s.input} value={form.contract_value || ''} onChange={e => update('contract_value', e.target.value)} /></div>
                  <div><label style={s.label}>Default markup %</label><input type="number" style={s.input} placeholder="0" value={form.markup_pct || ''} onChange={e => update('markup_pct', e.target.value)} /></div>
                  <div>
                    <label style={s.label}>Billing frequency</label>
                    <select style={s.input} value={form.billing_frequency || 'monthly'} onChange={e => update('billing_frequency', e.target.value)}>
                      <option value="monthly">Monthly</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Bi-weekly</option>
                    </select>
                  </div>
                  <div>
                    {(form.billing_frequency || 'monthly') === 'monthly' ? (
                      <>
                        <label style={s.label}>Due day of month (1–28)</label>
                        <input type="number" min="1" max="28" style={s.input} placeholder="e.g. 25" value={form.billing_due_day || ''} onChange={e => update('billing_due_day', e.target.value)} />
                      </>
                    ) : (
                      <>
                        <label style={s.label}>Due day of week</label>
                        <select style={s.input} value={form.billing_due_day ?? ''} onChange={e => { update('billing_due_day', e.target.value); update('billing_anchor_date', '') }}>
                          <option value="">Select day...</option>
                          <option value="0">Sunday</option>
                          <option value="1">Monday</option>
                          <option value="2">Tuesday</option>
                          <option value="3">Wednesday</option>
                          <option value="4">Thursday</option>
                          <option value="5">Friday</option>
                          <option value="6">Saturday</option>
                        </select>
                      </>
                    )}
                  </div>
                  <div><label style={s.label}>Start date</label><input type="date" style={s.input} value={form.start_date || ''} onChange={e => update('start_date', e.target.value)} /></div>
                  <div><label style={s.label}>Status</label>
                    <select style={s.input} value={form.status || 'active'} onChange={e => update('status', e.target.value)}>
                      <option value="active">Active</option>
                      <option value="on_hold">On hold</option>
                      <option value="complete">Complete</option>
                    </select>
                  </div>
                  <div><label style={s.label}>Who pays subs</label>
                    <select style={s.input} value={form.payment_type || 'nv_pays'} onChange={e => update('payment_type', e.target.value)}>
                      <option value="nv_pays">NV Construction pays subs</option>
                      <option value="owner_pays_direct">Owner pays subs directly</option>
                    </select>
                  </div>
                  <div><label style={s.label}>Prime billing type</label>
                    <select style={s.input} value={form.billing_type || 'aia'} onChange={e => update('billing_type', e.target.value)}>
                      <option value="aia">AIA Application for Payment (G702/G703)</option>
                      <option value="draw_request">Draw Request</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: '12px' }}><label style={s.label}>Scope notes</label><textarea style={s.textarea} value={form.scope_notes || ''} onChange={e => update('scope_notes', e.target.value)} placeholder="Project description, scope of work, special requirements..." /></div>
                <div style={{ maxWidth: '360px' }}>
                  <label style={s.label}>PM contact (for RFI &amp; billing emails)</label>
                  <select style={s.input} value={form.pm_email || ''} onChange={e => update('pm_email', e.target.value)}>
                    <option value="">— Select PM —</option>
                    {teamMembers.map(m => (
                      <option key={m.id} value={m.email}>{m.full_name || m.email} ({m.role.toUpperCase()})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showBillingDates ? '1.25rem' : 0, cursor: 'pointer' }} onClick={() => setShowBillingDates(v => !v)}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Billing schedule</p>
                  <span style={{ fontSize: '12px', color: '#555', fontWeight: '700', userSelect: 'none' }}>{showBillingDates ? '▲ Hide' : '▼ Show'}</span>
                </div>
                {showBillingDates && <>
                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>Subcontractor billing</p>
                  <div style={{ ...s.grid2, marginBottom: '8px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Frequency</label>
                      <select style={s.input} value={form.sub_billing_frequency || 'biweekly'} onChange={e => { update('sub_billing_frequency', e.target.value); update('sub_billing_due', ''); update('sub_billing_start', ''); update('sub_billing_anchor', '') }}>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>First billing due date</label>
                      <input type="date" style={s.input} value={form.sub_billing_start || ''} onChange={e => {
                        const v = e.target.value; if (!v) return
                        const [yr, mo, dy] = v.split('-').map(Number)
                        const freq = form.sub_billing_frequency || 'biweekly'
                        update('sub_billing_start', v); update('sub_billing_anchor', v)
                        update('sub_billing_due', freq === 'monthly' ? dy : new Date(yr, mo - 1, dy).getDay())
                      }} />
                    </div>
                  </div>
                  {form.sub_billing_start && form.sub_billing_due !== '' && form.sub_billing_due !== undefined && (() => {
                    const freq = form.sub_billing_frequency || 'biweekly'
                    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                    const due = Number(form.sub_billing_due)
                    const ord = n => { const s = n % 10, h = n % 100; return n + (h >= 11 && h <= 13 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th') }
                    const label = freq === 'monthly' ? `Bills on the ${ord(due)} of each month` : `Bills every ${days[due]}${freq === 'biweekly' ? ' (bi-weekly)' : ''}`
                    return <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>{label}</p>
                  })()}
                </div>
                <div style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase' }}>{(form.nv_role || 'gc') === 'sub' ? 'Our billing to GC' : 'Prime contract (owner) billing'}</p>
                  <div style={{ ...s.grid2, marginBottom: '8px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Frequency</label>
                      <select style={s.input} value={form.owner_billing_frequency || 'monthly'} onChange={e => { update('owner_billing_frequency', e.target.value); update('owner_billing_due', ''); update('owner_billing_start', ''); update('owner_billing_anchor', '') }}>
                        <option value="weekly">Weekly</option>
                        <option value="biweekly">Bi-weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>First billing due date</label>
                      <input type="date" style={s.input} value={form.owner_billing_start || ''} onChange={e => {
                        const v = e.target.value; if (!v) return
                        const [yr, mo, dy] = v.split('-').map(Number)
                        const freq = form.owner_billing_frequency || 'monthly'
                        update('owner_billing_start', v); update('owner_billing_anchor', v)
                        update('owner_billing_due', freq === 'monthly' ? dy : new Date(yr, mo - 1, dy).getDay())
                      }} />
                    </div>
                  </div>
                  {form.owner_billing_start && form.owner_billing_due !== '' && form.owner_billing_due !== undefined && (() => {
                    const freq = form.owner_billing_frequency || 'monthly'
                    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                    const due = Number(form.owner_billing_due)
                    const ord = n => { const s = n % 10, h = n % 100; return n + (h >= 11 && h <= 13 ? 'th' : s === 1 ? 'st' : s === 2 ? 'nd' : s === 3 ? 'rd' : 'th') }
                    const label = freq === 'monthly' ? `Bills on the ${ord(due)} of each month` : `Bills every ${days[due]}${freq === 'biweekly' ? ' (bi-weekly)' : ''}`
                    return <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>{label}</p>
                  })()}
                </div>
                </>}
              </div>

              <div style={s.card}>
                <p style={s.cardTitle}>{(form.nv_role || 'gc') === 'sub' ? 'General Contractor, design team & permits' : 'Owner, design team & permits'}</p>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>{(form.nv_role || 'gc') === 'sub' ? 'General Contractor' : 'Owner'}</p>
                <div style={{ ...s.grid2, marginBottom: '16px' }} className="rx-grid-2">
                  <div><label style={s.label}>Company</label><input style={s.input} value={form.owner_company || ''} onChange={e => update('owner_company', e.target.value)} /></div>
                  <div><label style={s.label}>Name</label><input style={s.input} value={form.owner_name || ''} onChange={e => update('owner_name', e.target.value)} /></div>
                  <div><label style={s.label}>Email</label><input style={s.input} value={form.owner_email || ''} onChange={e => update('owner_email', e.target.value)} /></div>
                  <div><label style={s.label}>Phone</label><input style={s.input} value={form.owner_phone || ''} onChange={e => update('owner_phone', e.target.value)} /></div>
                </div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>Architect</p>
                <div style={{ ...s.grid3, marginBottom: '16px' }} className="rx-grid-3">
                  <div><label style={s.label}>Name</label><input style={s.input} value={form.architect_name || ''} onChange={e => update('architect_name', e.target.value)} /></div>
                  <div><label style={s.label}>Company</label><input style={s.input} value={form.architect_company || ''} onChange={e => update('architect_company', e.target.value)} /></div>
                  <div><label style={s.label}>Email</label><input style={s.input} value={form.architect_email || ''} onChange={e => update('architect_email', e.target.value)} /></div>
                </div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>Engineer</p>
                <div style={{ ...s.grid3, marginBottom: '16px' }} className="rx-grid-3">
                  <div><label style={s.label}>Name</label><input style={s.input} value={form.engineer_name || ''} onChange={e => update('engineer_name', e.target.value)} /></div>
                  <div><label style={s.label}>Company</label><input style={s.input} value={form.engineer_company || ''} onChange={e => update('engineer_company', e.target.value)} /></div>
                  <div><label style={s.label}>Email</label><input style={s.input} value={form.engineer_email || ''} onChange={e => update('engineer_email', e.target.value)} /></div>
                </div>
                <p style={{ fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 10px' }}>Permits</p>
                <div style={{ ...s.grid2 }} className="rx-grid-2">
                  <div><label style={s.label}>Permit number</label><input style={s.input} value={form.permit_number || ''} onChange={e => update('permit_number', e.target.value)} /></div>
                  <div><label style={s.label}>Permit date</label><input type="date" style={s.input} value={form.permit_date || ''} onChange={e => update('permit_date', e.target.value)} /></div>
                </div>
              </div>

              {(form.billing_due_day !== undefined && form.billing_due_day !== '' && form.billing_due_day !== null) && (() => {
                const freq = form.billing_frequency || 'monthly'
                const dueDay = parseInt(form.billing_due_day)
                const today = new Date(); today.setHours(0,0,0,0)
                const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                const ord = n => n + (n===1?'st':n===2?'nd':n===3?'rd':'th')
                const dates = []
                if (freq === 'monthly') {
                  let month = today.getMonth(), year = today.getFullYear()
                  if (today.getDate() >= dueDay) { month++; if (month > 11) { month = 0; year++ } }
                  for (let i = 0; i < 12; i++) {
                    const lastDay = new Date(year, month + 1, 0).getDate()
                    dates.push(new Date(year, month, Math.min(dueDay, lastDay)))
                    month++; if (month > 11) { month = 0; year++ }
                  }
                } else if (freq === 'weekly') {
                  const diff = (dueDay - today.getDay() + 7) % 7 || 7
                  let cur = new Date(today); cur.setDate(today.getDate() + diff)
                  for (let i = 0; i < 12; i++) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 7) }
                } else if (freq === 'biweekly') {
                  const anchor = form.billing_anchor_date ? new Date(form.billing_anchor_date) : (() => { const d = new Date(today); const diff2 = (dueDay - d.getDay() + 7) % 7 || 7; d.setDate(d.getDate() + diff2); return d })()
                  anchor.setHours(0,0,0,0)
                  let cur = new Date(anchor)
                  while (cur <= today) cur.setDate(cur.getDate() + 14)
                  for (let i = 0; i < 12; i++) { dates.push(new Date(cur)); cur.setDate(cur.getDate() + 14) }
                }
                const title = freq === 'monthly' ? `Due on the ${ord(dueDay)} of each month` : freq === 'weekly' ? `Due every ${DOW[dueDay]}` : `Due every other ${DOW[dueDay]}`
                return (
                  <div style={{ ...s.card, marginBottom: '1rem' }}>
                    <p style={s.cardTitle}>Billing calendar — {title}</p>
                    <p style={{ fontSize: '12px', color: '#555', margin: '0 0 1rem' }}>Vendors receive an automatic reminder email 3 days before each due date.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                      {dates.map((d, i) => {
                        const reminder = new Date(d); reminder.setDate(d.getDate() - 3)
                        const isPast = d < today
                        const isNext = !isPast && i === 0
                        return (
                          <div key={i} style={{ background: isNext ? '#2a1200' : isPast ? '#0f0f0f' : '#141414', border: `1px solid ${isNext ? '#4a2200' : '#1e1e1e'}`, borderRadius: '8px', padding: '10px 12px' }}>
                            <p style={{ margin: 0, fontSize: '13px', fontWeight: '700', color: isNext ? '#e8590c' : isPast ? '#444' : '#f1f1f1' }}>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#555' }}>Reminder: {reminder.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              <div style={{ display: 'flex', gap: '12px', marginBottom: '1.5rem' }}>
                <button type="submit" style={{ ...s.btn, opacity: saving ? 0.6 : 1 }} disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
                <button type="button" style={s.btnGray} onClick={archiveJob}>Archive job</button>
                <button type="button" style={s.btnRed} onClick={() => setConfirmDelete(!confirmDelete)}>Delete job</button>
              </div>

              {confirmDelete && (
                <div style={s.confirmBox}>
                  <p style={{ color: '#ff6b6b', fontSize: '14px', margin: '0 0 1rem' }}>This will permanently delete the job, all billing submissions, and all sub assignments. This cannot be undone.</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={deleteJob} style={s.btnRed}>Yes, delete permanently</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} style={s.btnGray}>Cancel</button>
                  </div>
                </div>
              )}
            </form>

            {(form.nv_role || 'gc') === 'sub' && (
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>GC Awarded Subcontracts</p>
                  <button style={s.btnSmallOrange} type="button" onClick={() => setShowNvSubForm(v => !v)}>{showNvSubForm ? 'Cancel' : '+ Add scope'}</button>
                </div>
                <p style={{ fontSize: '12px', color: '#555', margin: '0 0 1rem' }}>Track each subcontract the GC has issued to NV for different scopes on this project.</p>

                {showNvSubForm && (
                  <form onSubmit={addNvSubcontract} style={{ background: '#0a0a0a', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px', marginBottom: '1rem' }}>
                    <div style={{ ...s.grid2, marginBottom: '10px' }} className="rx-grid-2">
                      <div><label style={s.label}>GC / General Contractor name</label><input style={s.input} value={nvSubForm.gc_name} onChange={e => setNvSubForm(f => ({ ...f, gc_name: e.target.value }))} placeholder="Hensel Phelps" /></div>
                      <div><label style={s.label}>Contract number</label><input style={s.input} value={nvSubForm.contract_number} onChange={e => setNvSubForm(f => ({ ...f, contract_number: e.target.value }))} placeholder="GC-2024-001" /></div>
                    </div>
                    <div style={{ marginBottom: '10px' }}><label style={s.label}>Scope of work</label><input style={s.input} required value={nvSubForm.scope_description} onChange={e => setNvSubForm(f => ({ ...f, scope_description: e.target.value }))} placeholder="Site Utilities, Concrete Foundations, etc." /></div>
                    <div style={{ ...s.grid2, marginBottom: '10px' }} className="rx-grid-2">
                      <div><label style={s.label}>Contract value</label><input type="number" style={s.input} value={nvSubForm.contract_value} onChange={e => setNvSubForm(f => ({ ...f, contract_value: e.target.value }))} placeholder="0.00" /></div>
                      <div><label style={s.label}>Signed date</label><input type="date" style={s.input} value={nvSubForm.signed_date} onChange={e => setNvSubForm(f => ({ ...f, signed_date: e.target.value }))} /></div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                      <div><label style={s.label}>Status</label>
                        <select style={s.input} value={nvSubForm.status} onChange={e => setNvSubForm(f => ({ ...f, status: e.target.value }))}>
                          <option value="pending">Pending</option>
                          <option value="active">Active</option>
                          <option value="complete">Complete</option>
                        </select>
                      </div>
                      <div><label style={s.label}>Notes</label><input style={s.input} value={nvSubForm.notes} onChange={e => setNvSubForm(f => ({ ...f, notes: e.target.value }))} /></div>
                    </div>
                    <button type="submit" style={s.btn} disabled={addingNvSub}>{addingNvSub ? 'Saving...' : 'Add subcontract'}</button>
                  </form>
                )}

                {nvSubcontracts.length === 0 && !showNvSubForm && <p style={s.emptyMsg}>No subcontracts added yet.</p>}

                {nvSubcontracts.map(sc => {
                  const statusColor = sc.status === 'active' ? '#4ade80' : sc.status === 'complete' ? '#60a5fa' : '#f59e0b'
                  return (
                    <div key={sc.id} style={{ border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px', marginBottom: '10px' }}>
                      {editingNvSubId === sc.id ? (
                        <form onSubmit={saveNvSubcontract}>
                          <div style={{ ...s.grid2, marginBottom: '10px' }} className="rx-grid-2">
                            <div><label style={s.label}>GC name</label><input style={s.input} value={editNvSubForm.gc_name || ''} onChange={e => setEditNvSubForm(f => ({ ...f, gc_name: e.target.value }))} /></div>
                            <div><label style={s.label}>Contract number</label><input style={s.input} value={editNvSubForm.contract_number || ''} onChange={e => setEditNvSubForm(f => ({ ...f, contract_number: e.target.value }))} /></div>
                          </div>
                          <div style={{ marginBottom: '10px' }}><label style={s.label}>Scope of work</label><input style={s.input} required value={editNvSubForm.scope_description || ''} onChange={e => setEditNvSubForm(f => ({ ...f, scope_description: e.target.value }))} /></div>
                          <div style={{ ...s.grid2, marginBottom: '10px' }} className="rx-grid-2">
                            <div><label style={s.label}>Contract value</label><input type="number" style={s.input} value={editNvSubForm.contract_value || ''} onChange={e => setEditNvSubForm(f => ({ ...f, contract_value: e.target.value }))} /></div>
                            <div><label style={s.label}>Signed date</label><input type="date" style={s.input} value={editNvSubForm.signed_date || ''} onChange={e => setEditNvSubForm(f => ({ ...f, signed_date: e.target.value }))} /></div>
                          </div>
                          <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                            <div><label style={s.label}>Status</label>
                              <select style={s.input} value={editNvSubForm.status || 'active'} onChange={e => setEditNvSubForm(f => ({ ...f, status: e.target.value }))}>
                                <option value="pending">Pending</option>
                                <option value="active">Active</option>
                                <option value="complete">Complete</option>
                              </select>
                            </div>
                            <div><label style={s.label}>Notes</label><input style={s.input} value={editNvSubForm.notes || ''} onChange={e => setEditNvSubForm(f => ({ ...f, notes: e.target.value }))} /></div>
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="submit" style={s.btn} disabled={savingNvSub}>{savingNvSub ? 'Saving...' : 'Save'}</button>
                            <button type="button" style={s.btnGray} onClick={() => setEditingNvSubId(null)}>Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                                <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{sc.scope_description}</span>
                                <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '99px', background: '#1a1a1a', color: statusColor, border: `1px solid ${statusColor}33`, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{sc.status}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                {sc.gc_name && <span style={{ fontSize: '12px', color: '#888' }}>{sc.gc_name}</span>}
                                {sc.contract_number && <span style={{ fontSize: '12px', color: '#666' }}>#{sc.contract_number}</span>}
                                {sc.contract_value && <span style={{ fontSize: '13px', fontWeight: '700', color: '#4ade80' }}>${Number(sc.contract_value).toLocaleString()}</span>}
                                {sc.signed_date && <span style={{ fontSize: '12px', color: '#555' }}>Signed {new Date(sc.signed_date + 'T12:00:00').toLocaleDateString()}</span>}
                              </div>
                              {sc.notes && <p style={{ fontSize: '12px', color: '#555', margin: '6px 0 0' }}>{sc.notes}</p>}
                            </div>
                            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                              <button style={s.btnSmall} type="button" onClick={() => { setEditingNvSubId(sc.id); setEditNvSubForm({ gc_name: sc.gc_name || '', contract_number: sc.contract_number || '', scope_description: sc.scope_description || '', contract_value: sc.contract_value || '', status: sc.status || 'active', signed_date: sc.signed_date || '', notes: sc.notes || '' }) }}>Edit</button>
                              <button style={s.btnSmallRed} type="button" onClick={() => deleteNvSubcontract(sc.id)}>Delete</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}

                {nvSubcontracts.length > 0 && (
                  <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#555' }}>{nvSubcontracts.length} scope{nvSubcontracts.length !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: '14px', fontWeight: '700', color: '#4ade80' }}>
                      Total: ${nvSubcontracts.filter(s => s.contract_value).reduce((a, s) => a + Number(s.contract_value), 0).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            )}

          </>
        )}

        {/* ── SUBS TAB ── */}
        {activeTab === 'subs' && (
          <>
            <div style={s.statRow} className="rx-stats">
              <div style={s.statCard}><div style={s.statLabel}>Assigned</div><div style={s.statValue()}>{subs.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Portal access</div><div style={s.statValue('#4ade80')}>{registeredSubs.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Not registered</div><div style={s.statValue(subs.length - registeredSubs.length > 0 ? '#e8590c' : undefined)}>{subs.length - registeredSubs.length}</div></div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Assigned subcontractors ({subs.length})</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {subs.some(a => !a.sub_id && a.sub_email) && (
                    <button style={s.btnSmallOrange} onClick={notifyAllUnregistered}>Notify all unregistered</button>
                  )}
                  {!showAssignSub && <button style={s.btnSmallOrange} onClick={() => { setShowAssignSub(true); loadSubDirectory() }}>+ Assign sub</button>}
                </div>
              </div>

              {showAssignSub && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Assign subcontractor to job</p>

                  {subDirectory.filter(d => !subs.some(s => s.sub_email?.toLowerCase() === d.email?.toLowerCase())).length > 0 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label style={s.label}>Pick from approved directory</label>
                      <select style={s.input} value={assignSubForm.from_dir}
                        onChange={e => setAssignSubForm({ from_dir: e.target.value, email: '' })}>
                        <option value="">— Select company —</option>
                        {subDirectory
                          .filter(d => !subs.some(s => s.sub_email?.toLowerCase() === d.email?.toLowerCase()))
                          .map(d => <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>)}
                      </select>
                    </div>
                  )}

                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>{subDirectory.length > 0 ? 'Or assign by email directly' : 'Email address'}</label>
                    <input type="email" style={s.input} placeholder="sub@company.com"
                      value={assignSubForm.email}
                      onChange={e => setAssignSubForm({ email: e.target.value, from_dir: '' })} />
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: assigningSubLoading ? 0.6 : 1 }}
                      disabled={assigningSubLoading || (!assignSubForm.from_dir && !assignSubForm.email)}
                      onClick={assignSubToJob}>
                      {assigningSubLoading ? 'Assigning...' : 'Assign & enable billing'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowAssignSub(false); setAssignSubForm({ email: '', from_dir: '' }) }}>Cancel</button>
                  </div>
                </div>
              )}

              {subs.length === 0 && !showAssignSub && (
                <p style={{ color: '#444', fontSize: '14px' }}>No subcontractors assigned yet.</p>
              )}

              {subs.map(a => {
                const dirEntry = subDirectory.find(d => d.email?.toLowerCase() === a.sub_email?.toLowerCase())
                const companyName = a.profiles?.company_name || dirEntry?.company_name || a.sub_email || 'Unknown'
                const contactName = a.profiles?.full_name || dirEntry?.contact_name
                const phone = a.profiles?.phone || dirEntry?.phone
                const address = dirEntry?.address
                const isRegistered = !!a.sub_id
                const existingRating = subRatings.find(r => r.sub_id === a.sub_id)
                const rf = ratingForms[a.sub_id] || {}
                const messages = messageThreads[a.sub_id] || []
                const isShowingRating = showRatingFor === a.sub_id
                const isShowingMessages = expandedMessageSubId === a.sub_id
                const StarRow = ({ field, label }) => (
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ ...s.label, marginBottom: '4px' }}>{label}</label>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {[1,2,3,4,5].map(n => (
                        <button key={n} onClick={() => setRatingForms(prev => ({ ...prev, [a.sub_id]: { ...rf, [field]: n } }))}
                          style={{ width: '32px', height: '32px', background: (rf[field] || 0) >= n ? '#e8590c' : '#1a1a1a', border: `1px solid ${(rf[field] || 0) >= n ? '#e8590c' : '#2a2a2a'}`, borderRadius: '6px', color: '#f1f1f1', fontSize: '16px', cursor: 'pointer' }}>★</button>
                      ))}
                    </div>
                  </div>
                )
                return (
                  <div key={a.id} style={{ ...s.contractRow, marginBottom: '8px' }}>
                    <div style={{ ...s.contractRowHeader, flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: '200px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                          <span style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1' }}>{companyName}</span>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', fontWeight: '700', background: isRegistered ? '#0a2a0a' : '#1a1a1a', color: isRegistered ? '#4ade80' : '#555', border: `1px solid ${isRegistered ? '#1a4a1a' : '#2a2a2a'}` }}>{isRegistered ? 'Registered' : 'Not registered'}</span>
                          {existingRating && (
                            <span style={{ fontSize: '12px', color: '#e8590c' }}>
                              {'★'.repeat(Math.round((existingRating.quality + existingRating.timeliness + existingRating.communication) / 3))}
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: '#555' }}>
                          {contactName && <span>{contactName}</span>}
                          {phone && <span>{phone}</span>}
                          {a.sub_email && <span>{a.sub_email}</span>}
                          {address && <span>{address}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {isRegistered && (
                          <button style={s.btnSmall} onClick={() => {
                            if (isShowingMessages) { setExpandedMessageSubId(null) }
                            else { setExpandedMessageSubId(a.sub_id); loadMessages(a.sub_id) }
                          }}>💬 Messages{messages.length > 0 ? ` (${messages.length})` : ''}</button>
                        )}
                        {isRegistered && (
                          <button style={s.btnSmall} onClick={() => {
                            if (isShowingRating) { setShowRatingFor(null) }
                            else { setShowRatingFor(a.sub_id); setRatingForms(prev => ({ ...prev, [a.sub_id]: existingRating ? { quality: existingRating.quality, timeliness: existingRating.timeliness, communication: existingRating.communication, notes: existingRating.notes || '' } : { quality: 0, timeliness: 0, communication: 0, notes: '' } })) }
                          }}>{existingRating ? 'Edit Rating' : 'Rate Sub'}</button>
                        )}
                        {!isRegistered && a.sub_email && (
                          notifySubResult[a.sub_email] === 'sent'
                            ? <span style={{ fontSize: '12px', color: '#4ade80' }}>Invite sent</span>
                            : notifySubResult[a.sub_email]
                              ? <span style={{ fontSize: '12px', color: '#ff6b6b' }}>{notifySubResult[a.sub_email]}</span>
                              : <button style={s.btnSmallOrange} disabled={notifyingSubId === a.sub_email} onClick={() => notifySubToRegister(a.sub_email)}>
                                  {notifyingSubId === a.sub_email ? 'Sending...' : 'Notify'}
                                </button>
                        )}
                        <button style={s.btnSmallRed} onClick={() => removeSubFromJob(a.id)}>Remove</button>
                      </div>
                    </div>

                    {/* Rating form */}
                    {isShowingRating && (
                      <div style={{ borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' }}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Rate {companyName}</p>
                        <StarRow field="quality" label="Quality of work" />
                        <StarRow field="timeliness" label="Timeliness" />
                        <StarRow field="communication" label="Communication" />
                        <div style={{ marginBottom: '12px' }}>
                          <label style={s.label}>Notes (optional)</label>
                          <input style={s.input} value={rf.notes || ''} onChange={e => setRatingForms(prev => ({ ...prev, [a.sub_id]: { ...rf, notes: e.target.value } }))} placeholder="Additional comments..." />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button style={{ ...s.btn, opacity: savingRatingFor === a.sub_id || !rf.quality ? 0.6 : 1 }} disabled={savingRatingFor === a.sub_id || !rf.quality} onClick={() => saveSubRating(a.sub_id)}>{savingRatingFor === a.sub_id ? 'Saving...' : 'Save Rating'}</button>
                          <button style={s.btnGray} onClick={() => setShowRatingFor(null)}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Message thread */}
                    {isShowingMessages && (
                      <div style={{ borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' }}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Messages — {companyName}</p>
                        <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {messages.length === 0 ? <p style={{ color: '#444', fontSize: '13px' }}>No messages yet.</p> : messages.map(msg => (
                            <div key={msg.id} style={{ display: 'flex', flexDirection: msg.sender_role === 'pm' ? 'row-reverse' : 'row', gap: '8px' }}>
                              <div style={{ maxWidth: '70%', background: msg.sender_role === 'pm' ? '#1a2a0a' : '#1a1a2a', border: `1px solid ${msg.sender_role === 'pm' ? '#2a4a1a' : '#2a2a4a'}`, borderRadius: '10px', padding: '8px 12px' }}>
                                <div style={{ fontSize: '11px', color: '#555', marginBottom: '3px' }}>{msg.sender_name} · {new Date(msg.created_at).toLocaleString()}</div>
                                <div style={{ fontSize: '13px', color: '#f1f1f1', lineHeight: '1.5' }}>{msg.message}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input style={{ ...s.input, flex: 1 }} value={messageDraft[a.sub_id] || ''} onChange={e => setMessageDraft(prev => ({ ...prev, [a.sub_id]: e.target.value }))} placeholder="Type a message..." onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(a.sub_id, profile?.full_name)} />
                          <button style={{ ...s.btn, padding: '11px 20px', opacity: sendingMessageFor === a.sub_id || !messageDraft[a.sub_id]?.trim() ? 0.6 : 1 }} disabled={sendingMessageFor === a.sub_id || !messageDraft[a.sub_id]?.trim()} onClick={() => sendMessage(a.sub_id, profile?.full_name)}>{sendingMessageFor === a.sub_id ? '...' : 'Send'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── BUDGET TAB ── */}
        {activeTab === 'budget' && (
          <>
            <div style={s.statRow} className="rx-stats">
              <div style={s.statCard}>
                <div style={s.statLabel}>Internal budget</div>
                <div style={s.statValue()}>${totalBudget.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>Your actual cost target</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Owner SOV total</div>
                <div style={s.statValue('#60a5fa')}>${totalOwnerSOV.toLocaleString()}</div>
                <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>What owner sees on AIA</div>
              </div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Gross profit</div>
                <div style={s.statValue(totalMarkup > 0 ? '#4ade80' : '#555')}>{totalMarkup > 0 ? '+' : ''}${totalMarkup.toLocaleString()}</div>
                {totalBudget > 0 && totalMarkup > 0 && <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '4px' }}>{((totalMarkup / totalBudget) * 100).toFixed(1)}% margin</div>}
              </div>
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Budget lines ({budgetItems.length})</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {budgetItems.length > 0 && <button style={s.btnSmall} onClick={exportBudgetPDF}>Export PDF</button>}
                  <label style={{ ...s.btnSmall, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                    {csvUploading ? 'Importing...' : 'Import CSV'}
                    <input type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleCSVUpload} disabled={csvUploading} />
                  </label>
                  <button style={s.btnSmallOrange} onClick={() => setShowAddBudgetItem(v => !v)}>
                    {showAddBudgetItem ? 'Cancel' : '+ Add line'}
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '12px', color: '#333', margin: '0 0 1.25rem' }}>CSV format: cost_code, description, amount · Header row optional</p>

              {showAddBudgetItem && (
                <form onSubmit={saveBudgetItem} style={s.inlineForm}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '12px', marginBottom: '8px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={budgetItemForm.cost_code} onChange={e => setBudgetItemForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description *</label><input style={s.input} value={budgetItemForm.description} onChange={e => setBudgetItemForm(f => ({ ...f, description: e.target.value }))} required placeholder="Concrete" /></div>
                    <div><label style={s.label}>Internal budget *</label><input type="number" step="0.01" style={s.input} value={budgetItemForm.budget_amount} onChange={e => setBudgetItemForm(f => ({ ...f, budget_amount: e.target.value }))} required placeholder="0.00" /></div>
                    <div><label style={s.label}>Owner SOV amount</label><input type="number" step="0.01" style={s.input} value={budgetItemForm.owner_amount} onChange={e => setBudgetItemForm(f => ({ ...f, owner_amount: e.target.value }))} placeholder="Leave blank = same as budget" /></div>
                  </div>
                  <p style={{ fontSize: '11px', color: '#444', margin: '0 0 10px' }}>Owner SOV is what appears on the AIA G702/G703. Leave blank to match internal budget.</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={{ ...s.btnSmallOrange, opacity: addingBudgetItem ? 0.6 : 1 }} disabled={addingBudgetItem}>{addingBudgetItem ? 'Saving...' : 'Save line'}</button>
                    <button type="button" style={s.btnSmall} onClick={() => setShowAddBudgetItem(false)}>Cancel</button>
                  </div>
                </form>
              )}

              {editingBudgetItem && (
                <form onSubmit={updateBudgetItem} style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit budget line</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div><label style={s.label}>Cost code</label><input style={s.input} value={editBudgetForm.cost_code || ''} onChange={e => setEditBudgetForm(f => ({ ...f, cost_code: e.target.value }))} placeholder="03-000" /></div>
                    <div><label style={s.label}>Description</label><input style={s.input} value={editBudgetForm.description || ''} onChange={e => setEditBudgetForm(f => ({ ...f, description: e.target.value }))} required /></div>
                    <div><label style={s.label}>Internal budget</label><input type="number" step="0.01" style={s.input} value={editBudgetForm.budget_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, budget_amount: e.target.value }))} required /></div>
                    <div><label style={s.label}>Owner SOV amount</label><input type="number" step="0.01" style={s.input} value={editBudgetForm.owner_amount || ''} onChange={e => setEditBudgetForm(f => ({ ...f, owner_amount: e.target.value }))} placeholder="Blank = same as budget" /></div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" style={s.btnSmallOrange}>Save changes</button>
                    <button type="button" style={s.btnSmall} onClick={() => setEditingBudgetItem(null)}>Cancel</button>
                  </div>
                </form>
              )}

              {/* Warn about contracts not tied to any budget line */}
              {(() => {
                const unlinked = contracts.filter(c => {
                  const hasAllocs = c.budget_allocations && c.budget_allocations.length > 0
                  return !hasAllocs && !c.budget_item_id
                })
                return unlinked.length > 0 ? (
                  <div style={{ background: '#2a1200', border: '1px solid #4a2200', borderRadius: '8px', padding: '12px 14px', marginBottom: '1rem', fontSize: '13px', color: '#e8590c' }}>
                    ⚠ {unlinked.length} contract{unlinked.length !== 1 ? 's' : ''} not linked to any budget line and not counted in committed totals:{' '}
                    <span style={{ color: '#aaa' }}>{unlinked.map(c => c.company_name || c.vendor_name || 'Unnamed').join(', ')}</span>
                    . Open each contract and assign it to a budget line.
                  </div>
                ) : null
              })()}

              {budgetItems.length === 0 && !showAddBudgetItem && (
                <p style={{ color: '#444', fontSize: '14px' }}>No budget lines yet. Import a CSV or add lines manually.</p>
              )}

              {budgetItems.length > 0 && (
                <div className="rx-scroll-x">
                  <div style={s.budgetTableHeader}>
                    <span>Description</span>
                    <span style={{ textAlign: 'right' }}>Internal</span>
                    <span style={{ textAlign: 'right' }}>Owner SOV</span>
                    <span style={{ textAlign: 'right' }}>Committed</span>
                    <span style={{ textAlign: 'right' }}>Uncommitted</span>
                    <span style={{ textAlign: 'right' }}>% Used</span>
                    <span></span>
                  </div>
                  {(() => {
                    const cosByBudgetItem = {}
                    for (const co of primeCOs) {
                      for (const sovItem of co.sov || []) {
                        if (!sovItem.budget_item_id) continue
                        if (!cosByBudgetItem[sovItem.budget_item_id]) cosByBudgetItem[sovItem.budget_item_id] = []
                        cosByBudgetItem[sovItem.budget_item_id].push({ description: co.description, amount: sovItem.amount, status: co.status })
                      }
                    }
                    return budgetItems.map(item => {
                    const committed = committedForItem(item.id)
                    const uncommitted = Number(item.budget_amount) - committed
                    const pct = Number(item.budget_amount) > 0 ? Math.min(110, (committed / Number(item.budget_amount)) * 100) : 0
                    const over = uncommitted < 0
                    const ownerAmt = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount)
                    const markup = ownerAmt - Number(item.budget_amount)
                    const rowAccent = over ? '#ff4444' : pct >= 80 ? '#e8590c' : pct >= 50 ? '#facc15' : committed > 0 ? '#4ade80' : 'transparent'
                    const itemCOs = cosByBudgetItem[item.id] || []
                    return (
                      <div key={item.id} style={{ ...s.budgetTableRow, opacity: editingBudgetItem === item.id ? 0.4 : 1, borderLeft: `3px solid ${rowAccent}`, paddingLeft: '10px' }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {item.cost_code && <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace', flexShrink: 0 }}>{item.cost_code}</span>}
                            <span style={{ fontSize: '14px', color: '#f1f1f1' }}>{item.description}</span>
                            {itemCOs.length > 0 && (
                              <span
                                title={itemCOs.map(co => `${co.status === 'approved' ? '✓' : co.status === 'pending' ? '⏳' : '✗'} ${co.description || 'CO'}: ${Number(co.amount) >= 0 ? '+' : ''}$${Math.abs(Number(co.amount)).toLocaleString()} (${co.status})`).join('\n')}
                                style={{ display: 'inline-flex', alignItems: 'center', background: '#1a1000', color: '#f59e0b', border: '1px solid #4a3000', borderRadius: '4px', padding: '1px 7px', fontSize: '10px', fontWeight: '700', letterSpacing: '0.5px', cursor: 'help', flexShrink: 0, userSelect: 'none' }}
                              >
                                CO{itemCOs.length > 1 ? ` ×${itemCOs.length}` : ''}
                              </span>
                            )}
                          </div>
                          <div style={{ height: '4px', background: '#1a1a1a', borderRadius: '2px', marginTop: '8px' }}>
                            <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: over ? '#ff6b6b' : pct > 85 ? '#e8590c' : '#4ade80', borderRadius: '2px' }} />
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: '#f1f1f1', fontWeight: '600' }}>${Number(item.budget_amount).toLocaleString()}</div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '14px', color: '#60a5fa', fontWeight: '600' }}>${ownerAmt.toLocaleString()}</div>
                          {markup !== 0 && <div style={{ fontSize: '11px', color: markup > 0 ? '#4ade80' : '#ff6b6b', marginTop: '2px' }}>{markup > 0 ? '+' : ''}{((markup / Number(item.budget_amount)) * 100).toFixed(1)}%</div>}
                        </div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: committed > 0 ? '#e8590c' : '#444', fontWeight: '600' }}>${committed.toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '14px', color: over ? '#ff6b6b' : '#4ade80', fontWeight: '600' }}>{over ? '-' : ''}${Math.abs(uncommitted).toLocaleString()}</div>
                        <div style={{ textAlign: 'right', fontSize: '13px', color: over ? '#ff6b6b' : pct > 85 ? '#e8590c' : '#555' }}>{pct.toFixed(0)}%</div>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          <button style={s.btnSmall} onClick={() => { setEditingBudgetItem(item.id); setEditBudgetForm({ cost_code: item.cost_code || '', description: item.description, budget_amount: item.budget_amount, owner_amount: item.owner_amount || '' }); setShowAddBudgetItem(false) }}>Edit</button>
                          <button style={s.btnSmallRed} onClick={() => deleteBudgetItem(item.id)}>Del</button>
                        </div>
                      </div>
                    )
                  })})()}
                </div>
              )}
            </div>

            {/* Cost to Complete Forecast */}
            {budgetItems.length > 0 && (() => {
              const forecastRows = budgetItems.map(item => {
                const spent = directCosts.filter(c => c.status === 'approved' && c.budget_item_id === item.id).reduce((a, c) => a + Number(c.amount || 0), 0)
                const contracted = committedForItem(item.id)
                const totalActual = contracted + spent
                const autoEac = totalActual > 0 ? totalActual : Number(item.budget_amount)
                const eac = item.forecast_eac != null ? Number(item.forecast_eac) : autoEac
                const revenue = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount)
                return { item, spent, contracted, autoEac, eac, revenue, variance: Number(item.budget_amount) - eac, projProfit: revenue - eac }
              })
              const T = forecastRows.reduce((acc, r) => ({
                budget: acc.budget + Number(r.item.budget_amount), revenue: acc.revenue + r.revenue,
                spent: acc.spent + r.spent, contracted: acc.contracted + r.contracted,
                eac: acc.eac + r.eac, variance: acc.variance + r.variance, projProfit: acc.projProfit + r.projProfit,
              }), { budget: 0, revenue: 0, spent: 0, contracted: 0, eac: 0, variance: 0, projProfit: 0 })
              const hdr = { fontSize: '11px', color: '#555', textAlign: 'right' }
              const col = { display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1.2fr 1fr 1fr', gap: '8px', padding: '8px 12px' }
              return (
                <div style={s.card}>
                  <p style={{ ...s.cardTitle, marginBottom: '0.5rem' }}>Cost to Complete Forecast</p>
                  <p style={{ fontSize: '12px', color: '#444', margin: '0 0 1rem' }}>EAC = Estimate at Completion. Auto-calculates as committed contracts + direct costs spent. Enter a value to override.</p>
                  <div style={{ ...s.statRow, marginBottom: '1.25rem' }} className="rx-stats">
                    <div style={s.statCard}><div style={s.statLabel}>Proj. profit</div><div style={s.statValue(T.projProfit >= 0 ? '#4ade80' : '#ff6b6b')}>{T.projProfit >= 0 ? '+' : '-'}${Math.abs(T.projProfit).toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Budget variance</div><div style={s.statValue(T.variance >= 0 ? '#4ade80' : '#ff6b6b')}>{T.variance >= 0 ? '+' : '-'}${Math.abs(T.variance).toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Direct costs spent</div><div style={s.statValue()}>${T.spent.toLocaleString()}</div></div>
                    <div style={s.statCard}><div style={s.statLabel}>Total EAC</div><div style={s.statValue()}>${T.eac.toLocaleString()}</div></div>
                  </div>
                  <div style={{ ...col, borderBottom: '1px solid #1a1a1a', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#555' }}>Description</span>
                    {['Budget', 'Revenue', 'DC Spent', 'Contracted', 'EAC override', 'Variance', 'Proj. Profit'].map(h => <span key={h} style={hdr}>{h}</span>)}
                  </div>
                  {forecastRows.map(({ item, spent, contracted, autoEac, eac, revenue, variance, projProfit }) => (
                    <div key={item.id} style={{ ...col, borderBottom: '1px solid #111', alignItems: 'center' }}>
                      <div>
                        {item.cost_code && <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{item.cost_code} · </span>}
                        <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#f1f1f1' }}>${Number(item.budget_amount).toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa' }}>${revenue.toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#aaa' }}>${spent.toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', color: '#aaa' }}>${contracted.toLocaleString()}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <input
                          type="number" step="1"
                          style={{ ...s.input, textAlign: 'right', padding: '4px 8px', fontSize: '12px', color: item.forecast_eac != null ? '#e8590c' : '#aaa' }}
                          value={item.forecast_eac != null ? String(item.forecast_eac) : String(Math.round(autoEac))}
                          onChange={e => setBudgetItems(prev => prev.map(b => b.id === item.id ? { ...b, forecast_eac: e.target.value === '' ? null : e.target.value } : b))}
                          onFocus={e => e.target.select()}
                          onBlur={e => saveForecastEac(item.id, e.target.value === '' ? '' : e.target.value)}
                        />
                        {item.forecast_eac != null && (
                          <button title="Reset to auto" onClick={() => saveForecastEac(item.id, '')} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '14px', lineHeight: 1, padding: '0 2px' }}>×</button>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: '600', color: variance >= 0 ? '#4ade80' : '#ff6b6b' }}>{variance >= 0 ? '+' : '-'}${Math.abs(variance).toLocaleString()}</div>
                      <div style={{ textAlign: 'right', fontSize: '13px', fontWeight: '600', color: projProfit >= 0 ? '#4ade80' : '#ff6b6b' }}>{projProfit >= 0 ? '+' : '-'}${Math.abs(projProfit).toLocaleString()}</div>
                    </div>
                  ))}
                  <div style={{ ...col, borderTop: '2px solid #222', marginTop: '4px' }}>
                    <span style={{ fontSize: '13px', color: '#555', fontWeight: '700' }}>TOTAL</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#f1f1f1', fontWeight: '700' }}>${T.budget.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa', fontWeight: '700' }}>${T.revenue.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#aaa', fontWeight: '700' }}>${T.spent.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#aaa', fontWeight: '700' }}>${T.contracted.toLocaleString()}</span>
                    <span />
                    <span style={{ textAlign: 'right', fontSize: '13px', fontWeight: '700', color: T.variance >= 0 ? '#4ade80' : '#ff6b6b' }}>{T.variance >= 0 ? '+' : '-'}${Math.abs(T.variance).toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', fontWeight: '700', color: T.projProfit >= 0 ? '#4ade80' : '#ff6b6b' }}>{T.projProfit >= 0 ? '+' : '-'}${Math.abs(T.projProfit).toLocaleString()}</span>
                  </div>
                </div>
              )
            })()}

            {/* ── Owner Billing vs Budget ── */}
            {budgetItems.length > 0 && (() => {
              const hasBilling = Object.keys(billingByItem).length > 0
              const rows = budgetItems.map(item => {
                const ownerSOV = item.owner_amount != null ? Number(item.owner_amount) : Number(item.budget_amount)
                const pct = billingByItem[item.id] || 0
                const billed = Math.round(ownerSOV * pct / 100 * 100) / 100
                const remaining = ownerSOV - billed
                return { item, ownerSOV, pct, billed, remaining }
              })
              const totalOwner = rows.reduce((a, r) => a + r.ownerSOV, 0)
              const totalBilledOwner = rows.reduce((a, r) => a + r.billed, 0)
              const totalRemaining = totalOwner - totalBilledOwner
              const totalPct = totalOwner > 0 ? (totalBilledOwner / totalOwner) * 100 : 0
              const colStyle = { display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 1fr 80px', gap: '12px', padding: '10px 12px', alignItems: 'center' }
              return (
                <div style={s.card}>
                  <p style={{ ...s.cardTitle, marginBottom: '0.25rem' }}>Owner Billing vs Budget</p>
                  <p style={{ fontSize: '12px', color: '#444', margin: '0 0 1rem' }}>
                    {hasBilling ? 'Based on latest AIA application.' : 'No AIA billing applications found — create one in the Prime Contract tab to track billing progress per line.'}
                  </p>

                  {/* Summary stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '1.5rem' }}>
                    {[
                      { label: 'Owner SOV Total', val: `$${totalOwner.toLocaleString()}`, color: undefined },
                      { label: 'Billed to Date', val: `$${totalBilledOwner.toLocaleString()}`, color: '#60a5fa' },
                      { label: 'Remaining to Bill', val: `$${totalRemaining.toLocaleString()}`, color: totalRemaining > 0 ? '#e8590c' : '#4ade80' },
                      { label: '% Complete', val: `${totalPct.toFixed(1)}%`, color: totalPct >= 100 ? '#4ade80' : '#f1f1f1' },
                    ].map(stat => (
                      <div key={stat.label} style={s.statCard}>
                        <div style={s.statLabel}>{stat.label}</div>
                        <div style={{ ...s.statValue(stat.color) }}>{stat.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Table */}
                  <div style={{ ...colStyle, padding: '8px 12px 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e' }}>
                    <span>Line Item</span>
                    <span style={{ textAlign: 'right' }}>Owner SOV</span>
                    <span style={{ textAlign: 'right' }}>Billed</span>
                    <span style={{ textAlign: 'right' }}>Remaining</span>
                    <span style={{ textAlign: 'right' }}>% Billed</span>
                  </div>
                  {rows.map(({ item, ownerSOV, pct, billed, remaining }) => (
                    <div key={item.id} style={{ ...colStyle, borderBottom: '1px solid #111' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          {item.cost_code && <span style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace' }}>{item.cost_code}</span>}
                          <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{item.description}</span>
                        </div>
                        <div style={{ height: '3px', background: '#1a1a1a', borderRadius: '2px', marginTop: '6px', maxWidth: '200px' }}>
                          <div style={{ height: '100%', width: Math.min(100, pct) + '%', background: pct >= 100 ? '#4ade80' : pct > 75 ? '#e8590c' : '#60a5fa', borderRadius: '2px', transition: 'width 0.3s' }} />
                        </div>
                      </div>
                      <span style={{ textAlign: 'right', fontSize: '13px', color: '#aaa' }}>${ownerSOV.toLocaleString()}</span>
                      <span style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa', fontWeight: '600' }}>${billed.toLocaleString()}</span>
                      <span style={{ textAlign: 'right', fontSize: '13px', color: remaining > 0 ? '#e8590c' : '#4ade80', fontWeight: '600' }}>${remaining.toLocaleString()}</span>
                      <span style={{ textAlign: 'right', fontSize: '13px', color: pct >= 100 ? '#4ade80' : '#f1f1f1' }}>{pct.toFixed(1)}%</span>
                    </div>
                  ))}
                  {/* Total row */}
                  <div style={{ ...colStyle, borderTop: '2px solid #222', marginTop: '2px' }}>
                    <span style={{ fontSize: '13px', color: '#555', fontWeight: '700' }}>TOTAL</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#f1f1f1', fontWeight: '700' }}>${totalOwner.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: '#60a5fa', fontWeight: '700' }}>${totalBilledOwner.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: totalRemaining > 0 ? '#e8590c' : '#4ade80', fontWeight: '700' }}>${totalRemaining.toLocaleString()}</span>
                    <span style={{ textAlign: 'right', fontSize: '13px', color: totalPct >= 100 ? '#4ade80' : '#f1f1f1', fontWeight: '700' }}>{totalPct.toFixed(1)}%</span>
                  </div>
                </div>
              )
            })()}
          </>
        )}

        {/* ── CONTRACTS TAB ── */}
        {activeTab === 'contracts' && (
          <>
            <div style={s.statRow} className="rx-stats">
              <div style={s.statCard}><div style={s.statLabel}>Subcontract value</div><div style={s.statValue()}>${totalContractValue.toLocaleString()}</div></div>
              <div style={s.statCard}>
                <div style={s.statLabel}>Approved COs</div>
                <div style={s.statValue(totalCOs >= 0 ? '#4ade80' : '#ff6b6b')}>{totalCOs >= 0 ? '+' : ''}${totalCOs.toLocaleString()}</div>
              </div>
              <div style={s.statCard}><div style={s.statLabel}>Revised total</div><div style={s.statValue('#e8590c')}>${totalRevised.toLocaleString()}</div></div>
            </div>

            {showContractGen && (
              <div style={{ ...s.card, border: '1px solid #1a3a1a', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0, color: '#4ade80' }}>Generate Subcontract</p>
                  <button style={s.btnGray} onClick={() => setShowContractGen(false)}>Close</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Date</label><input style={s.input} value={contractGenForm.date} onChange={e => setContractGenForm(f => ({ ...f, date: e.target.value }))} /></div>
                  <div><label style={s.label}>Subcontract #</label><input style={s.input} value={contractGenForm.subcontract_number} onChange={e => setContractGenForm(f => ({ ...f, subcontract_number: e.target.value }))} placeholder="26-JOBNO-001" /></div>
                  <div><label style={s.label}>PM Name</label><input style={s.input} value={contractGenForm.pm_name} onChange={e => setContractGenForm(f => ({ ...f, pm_name: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Subcontractor name</label>
                    <select style={s.input} value={contractGenForm.contract_id} onChange={e => { const c = contracts.find(x => x.id === e.target.value); if (c) openContractGenerator(c) }}>
                      <option value="">— Select —</option>
                      {contracts.map(c => { const n = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown'; return <option key={c.id} value={c.id}>{n}{c.description ? ` — ${c.description}` : ''}</option> })}
                    </select>
                  </div>
                  <div><label style={s.label}>Sub address</label><input style={s.input} value={contractGenForm.sub_address} onChange={e => setContractGenForm(f => ({ ...f, sub_address: e.target.value }))} placeholder="123 Main St, City, TX 75000" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Trade / work type</label><input style={s.input} value={contractGenForm.trade} onChange={e => setContractGenForm(f => ({ ...f, trade: e.target.value }))} placeholder="Plumbing" /></div>
                  <div><label style={s.label}>Contract amount ($)</label><input type="number" style={s.input} value={contractGenForm.contract_amount} onChange={e => setContractGenForm(f => ({ ...f, contract_amount: e.target.value }))} /></div>
                  <div><label style={s.label}>Pay % (para 4)</label><input type="number" style={s.input} value={contractGenForm.pay_pct} onChange={e => setContractGenForm(f => ({ ...f, pay_pct: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Project name</label><input style={s.input} value={contractGenForm.project_name} onChange={e => setContractGenForm(f => ({ ...f, project_name: e.target.value }))} /></div>
                  <div><label style={s.label}>Project address</label><input style={s.input} value={contractGenForm.project_address} onChange={e => setContractGenForm(f => ({ ...f, project_address: e.target.value }))} /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Owner name</label><input style={s.input} value={contractGenForm.owner_name} onChange={e => setContractGenForm(f => ({ ...f, owner_name: e.target.value }))} placeholder="Braum's Ice Cream and Dairy" /></div>
                  <div><label style={s.label}>Owner address</label><input style={s.input} value={contractGenForm.owner_address} onChange={e => setContractGenForm(f => ({ ...f, owner_address: e.target.value }))} placeholder="1420 West Loop 281, Longview TX 75603" /></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div><label style={s.label}>Job number</label><input style={s.input} value={contractGenForm.job_number} onChange={e => setContractGenForm(f => ({ ...f, job_number: e.target.value }))} /></div>
                  <div><label style={s.label}>Superintendent</label><input style={s.input} value={contractGenForm.superintendent} onChange={e => setContractGenForm(f => ({ ...f, superintendent: e.target.value }))} /></div>
                </div>
                <div style={{ marginBottom: '16px' }}>
                  <label style={s.label}>Scope of work</label>
                  <textarea style={{ ...s.input, minHeight: '140px', resize: 'vertical', fontFamily: 'inherit' }} value={contractGenForm.scope_of_work} onChange={e => setContractGenForm(f => ({ ...f, scope_of_work: e.target.value }))} placeholder="Provide all labor, equipment, and material to complete the [trade] scope per plans and specs to include but not limited to: ..." />
                </div>
                <button style={{ ...s.btn, background: '#1a3a1a', color: '#4ade80' }} onClick={generateSubcontract}>Print / Generate PDF</button>
              </div>
            )}

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Subcontracts ({contracts.length})</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {contracts.length > 0 && <button style={s.btnSmall} onClick={exportContractsPDF}>Export PDF</button>}
                  {!showAddContract && <button style={s.btnSmallOrange} onClick={() => setShowAddContract(true)}>+ Add subcontract</button>}
                </div>
              </div>

              {showAddContract && (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New subcontract</p>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Subcontractor</label>
                      <select style={s.input} value={contractForm.dir_id} onChange={e => setContractForm(f => ({ ...f, dir_id: e.target.value }))}>
                        <option value="">Select a sub...</option>
                        {subDirectory.map(d => <option key={d.id} value={d.id}>{d.company_name}{d.trade ? ` · ${d.trade}` : ''}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Contract value ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={contractForm.contract_value} onChange={e => setContractForm(f => ({ ...f, contract_value: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Retainage %</label>
                      <input type="number" min="0" max="100" step="0.5" style={s.input} placeholder="10" value={contractForm.retainage_pct} onChange={e => setContractForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '2px' }}>
                      <p style={{ fontSize: '12px', color: '#555', margin: 0 }}>
                        {contractForm.retainage_pct > 0
                          ? `${contractForm.retainage_pct}% of each billing will be withheld until project completion.`
                          : 'No retainage — full payment on each billing.'}
                      </p>
                    </div>
                  </div>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Description / scope *</label>
                    <input style={s.input} placeholder="e.g. Plumbing Rough-In, Electrical Trim-Out..." value={contractForm.description} onChange={e => setContractForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  {budgetItems.length > 0 && (() => {
                    const allocs = contractForm.budget_allocations || []
                    const totalAllocated = allocs.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                    const contractVal = parseFloat(contractForm.contract_value) || 0
                    const remaining = contractVal - totalAllocated
                    return (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <label style={s.label}>Budget allocation</label>
                          <button style={s.btnSmall} onClick={() => setContractForm(f => ({ ...f, budget_allocations: [...(f.budget_allocations || []), { budget_item_id: '', amount: '' }] }))}>+ Add line</button>
                        </div>
                        {allocs.length === 0 && (
                          <p style={{ fontSize: '12px', color: '#444', margin: '0 0 4px' }}>No allocation — click Add line to split across budget items.</p>
                        )}
                        {allocs.map((alloc, idx) => (
                          <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                            <select style={{ ...s.input, padding: '8px 10px' }} value={alloc.budget_item_id} onChange={e => {
                              const next = allocs.map((a, i) => i === idx ? { ...a, budget_item_id: e.target.value } : a)
                              setContractForm(f => ({ ...f, budget_allocations: next }))
                            }}>
                              <option value="">Select budget item...</option>
                              {budgetItems.map(item => <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.budget_amount || 0).toLocaleString()})</option>)}
                            </select>
                            <input type="number" step="0.01" placeholder="Amount" style={{ ...s.input, padding: '8px 10px', textAlign: 'right' }} value={alloc.amount} onChange={e => {
                              const next = allocs.map((a, i) => i === idx ? { ...a, amount: e.target.value } : a)
                              setContractForm(f => ({ ...f, budget_allocations: next }))
                            }} />
                            <button style={{ ...s.btnSmallRed, padding: '6px 8px' }} onClick={() => setContractForm(f => ({ ...f, budget_allocations: f.budget_allocations.filter((_, i) => i !== idx) }))}>✕</button>
                          </div>
                        ))}
                        {allocs.length > 0 && contractVal > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '8px 10px', background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '6px', marginTop: '4px' }}>
                            <span style={{ color: '#888' }}>Allocated: <strong style={{ color: '#f1f1f1' }}>${totalAllocated.toLocaleString()}</strong> of <strong style={{ color: '#f1f1f1' }}>${contractVal.toLocaleString()}</strong></span>
                            <span style={{ fontWeight: '700', color: remaining < 0 ? '#ff6b6b' : remaining === 0 ? '#4ade80' : '#e8590c' }}>
                              {remaining === 0 ? '✓ Fully allocated' : remaining > 0 ? `$${remaining.toLocaleString()} unallocated` : `$${Math.abs(remaining).toLocaleString()} over`}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={s.label}>OneDrive link (optional)</label>
                    <input style={s.input} placeholder="https://onedrive.live.com/..." value={contractForm.onedrive_url} onChange={e => setContractForm(f => ({ ...f, onedrive_url: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingContract ? 0.6 : 1 }} disabled={addingContract} onClick={addContract}>{addingContract ? 'Saving...' : 'Save contract'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddContract(false); setContractForm(emptyContract) }}>Cancel</button>
                  </div>
                </div>
              )}

              {contracts.length === 0 && !showAddContract && <p style={{ color: '#444', fontSize: '14px' }}>No subcontracts yet.</p>}

              {contracts.map(c => {
                const subName = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown sub'
                const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                const allocations = (c.budget_allocations || []).filter(a => a.budget_item_id)
                const isEditing = editingContract === c.id

                return (
                  <div key={c.id} style={s.contractRow}>
                    <div style={s.contractRowHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{subName}</span>
                        {c.description && <span style={{ fontSize: '12px', color: '#888', background: '#111', border: '1px solid #222', borderRadius: '4px', padding: '1px 7px' }}>{c.description}</span>}
                        {allocations.length > 0
                          ? allocations.map((a, i) => {
                              const item = budgetItems.find(b => b.id === a.budget_item_id)
                              if (!item) return null
                              return (
                                <span key={i} style={{ fontSize: '11px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 8px', whiteSpace: 'nowrap' }}>
                                  {item.cost_code ? `${item.cost_code} · ` : ''}{item.description}
                                  {a.amount ? <span style={{ color: '#888', marginLeft: '4px' }}>${Number(a.amount).toLocaleString()}</span> : null}
                                </span>
                              )
                            })
                          : budgetLine && <span style={{ fontSize: '11px', color: '#60a5fa', background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '4px', padding: '2px 8px' }}>{budgetLine.cost_code || budgetLine.description}</span>
                        }
                        <span style={s.contractBadge(c.status)}>{c.status}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Contract</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${Number(c.contract_value).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>COs</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: Number(c.approved_change_orders) !== 0 ? '#4ade80' : '#333' }}>
                            {Number(c.approved_change_orders) >= 0 ? '+' : ''}${Number(c.approved_change_orders).toLocaleString()}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Revised</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#e8590c' }}>${Number(c.adjusted_contract_value).toLocaleString()}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Remaining</div>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: Number(c.remaining_balance) < 0 ? '#ff6b6b' : '#aaa' }}>${Number(c.remaining_balance).toLocaleString()}</div>
                        </div>
                        {(c.retainage_pct > 0) && (
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', color: '#555', marginBottom: '2px' }}>Retainage</div>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#facc15' }}>{Number(c.retainage_pct)}%</div>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallOrange} onClick={() => {
                            if (expandedSov === c.id) { setExpandedSov(null) }
                            else { setExpandedSov(c.id); loadContractSov(c.id); setShowAddSovLine(null); setEditingSovLine(null) }
                          }}>
                            {expandedSov === c.id ? 'Hide SOV' : 'SOV'}
                          </button>
                          <button style={{ ...s.btnSmall, background: '#1a3a1a', color: '#4ade80', border: '1px solid #1a3a1a' }} onClick={() => openContractGenerator(c)}>Gen Contract</button>
                          <button style={s.btnSmall} onClick={() => { setEditingContract(isEditing ? null : c.id); setEditContractForm({ contract_value: c.contract_value, description: c.description || '', onedrive_url: c.onedrive_url || '', budget_item_id: c.budget_item_id || '', budget_allocations: c.budget_allocations || [], retainage_pct: String(c.retainage_pct ?? 10) }) }}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                          <button style={s.btnSmallRed} onClick={() => deleteContract(c.id)}>Delete</button>
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div style={s.contractRowExpanded}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit subcontract</p>
                        <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                          <div>
                            <label style={s.label}>Contract value ($)</label>
                            <input type="number" style={s.input} value={editContractForm.contract_value} onChange={e => setEditContractForm(f => ({ ...f, contract_value: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Description / scope</label>
                            <input style={s.input} value={editContractForm.description} onChange={e => setEditContractForm(f => ({ ...f, description: e.target.value }))} />
                          </div>
                        </div>
                        {budgetItems.length > 0 && (() => {
                          const allocs = editContractForm.budget_allocations || []
                          const totalAllocated = allocs.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                          const contractVal = parseFloat(editContractForm.contract_value) || 0
                          const remaining = contractVal - totalAllocated
                          return (
                            <div style={{ marginBottom: '12px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <label style={s.label}>Budget allocation</label>
                                <button style={s.btnSmall} onClick={() => setEditContractForm(f => ({ ...f, budget_allocations: [...(f.budget_allocations || []), { budget_item_id: '', amount: '' }] }))}>+ Add line</button>
                              </div>
                              {allocs.length === 0 && (
                                <p style={{ fontSize: '12px', color: '#444', margin: '0 0 4px' }}>No allocation — click Add line to split across budget items.</p>
                              )}
                              {allocs.map((alloc, idx) => (
                                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 28px', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                                  <select style={{ ...s.input, padding: '8px 10px' }} value={alloc.budget_item_id} onChange={e => {
                                    const next = allocs.map((a, i) => i === idx ? { ...a, budget_item_id: e.target.value } : a)
                                    setEditContractForm(f => ({ ...f, budget_allocations: next }))
                                  }}>
                                    <option value="">Select budget item...</option>
                                    {budgetItems.map(item => <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.budget_amount || 0).toLocaleString()})</option>)}
                                  </select>
                                  <input type="number" step="0.01" placeholder="Amount" style={{ ...s.input, padding: '8px 10px', textAlign: 'right' }} value={alloc.amount} onChange={e => {
                                    const next = allocs.map((a, i) => i === idx ? { ...a, amount: e.target.value } : a)
                                    setEditContractForm(f => ({ ...f, budget_allocations: next }))
                                  }} />
                                  <button style={{ ...s.btnSmallRed, padding: '6px 8px' }} onClick={() => setEditContractForm(f => ({ ...f, budget_allocations: f.budget_allocations.filter((_, i) => i !== idx) }))}>✕</button>
                                </div>
                              ))}
                              {allocs.length > 0 && contractVal > 0 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '8px 10px', background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '6px', marginTop: '4px' }}>
                                  <span style={{ color: '#888' }}>Allocated: <strong style={{ color: '#f1f1f1' }}>${totalAllocated.toLocaleString()}</strong> of <strong style={{ color: '#f1f1f1' }}>${contractVal.toLocaleString()}</strong></span>
                                  <span style={{ fontWeight: '700', color: remaining < 0 ? '#ff6b6b' : remaining === 0 ? '#4ade80' : '#e8590c' }}>
                                    {remaining === 0 ? '✓ Fully allocated' : remaining > 0 ? `$${remaining.toLocaleString()} unallocated` : `$${Math.abs(remaining).toLocaleString()} over`}
                                  </span>
                                </div>
                              )}
                            </div>
                          )
                        })()}
                        <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                          <div>
                            <label style={s.label}>Retainage %</label>
                            <input type="number" min="0" max="100" step="0.5" style={s.input} value={editContractForm.retainage_pct} onChange={e => setEditContractForm(f => ({ ...f, retainage_pct: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>OneDrive link</label>
                            <input style={s.input} value={editContractForm.onedrive_url} onChange={e => setEditContractForm(f => ({ ...f, onedrive_url: e.target.value }))} placeholder="https://onedrive.live.com/..." />
                          </div>
                        </div>
                        <button style={s.btnSmallOrange} onClick={updateContract}>Save changes</button>
                      </div>
                    )}

                    {c.onedrive_url && !isEditing && (
                      <div style={{ ...s.contractRowExpanded, paddingTop: '10px', paddingBottom: '10px' }}>
                        <a href={c.onedrive_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '13px', color: '#60a5fa' }}>View contract on OneDrive ↗</a>
                      </div>
                    )}

                    {expandedSov === c.id && (() => {
                      const sovs = contractSovLines[c.id]
                      const totalScheduled = (sovs || []).reduce((a, l) => a + Number(l.scheduled_value), 0)
                      const totalBilled = (sovs || []).reduce((a, l) => a + Number(l.billed_to_date || 0), 0)
                      return (
                        <div style={{ ...s.contractRowExpanded, background: '#060606' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                            <p style={{ ...s.cardTitle, margin: 0 }}>Schedule of Values{sovs ? ` (${sovs.length})` : ''}</p>
                            {showAddSovLine !== c.id && (
                              <button style={s.btnSmallOrange} onClick={() => setShowAddSovLine(c.id)}>+ Add line</button>
                            )}
                          </div>

                          {showAddSovLine === c.id && (
                            <div style={{ ...s.inlineForm, marginBottom: '0.75rem' }}>
                              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div>
                                  <label style={s.label}>Description *</label>
                                  <input style={s.input} value={sovLineForm.description} onChange={e => setSovLineForm(f => ({ ...f, description: e.target.value }))} placeholder="Mobilization, framing, drywall..." />
                                </div>
                                <div>
                                  <label style={s.label}>Scheduled value ($) *</label>
                                  <input type="number" step="0.01" style={s.input} value={sovLineForm.scheduled_value} onChange={e => setSovLineForm(f => ({ ...f, scheduled_value: e.target.value }))} placeholder="0.00" />
                                </div>
                              </div>
                              {budgetItems.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                  <label style={s.label}>Budget line item (optional)</label>
                                  <select style={s.input} value={sovLineForm.budget_item_id} onChange={e => setSovLineForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                                    <option value="">— None —</option>
                                    {budgetItems.map(item => (
                                      <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.budget_amount || 0).toLocaleString()})</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button style={{ ...s.btnSmallOrange, opacity: (addingSovLine || !sovLineForm.description || !sovLineForm.scheduled_value) ? 0.6 : 1 }}
                                  disabled={addingSovLine || !sovLineForm.description || !sovLineForm.scheduled_value}
                                  onClick={() => addSovLine(c.id)}>
                                  {addingSovLine ? 'Adding...' : 'Add line'}
                                </button>
                                <button style={s.btnSmall} onClick={() => { setShowAddSovLine(null); setSovLineForm({ description: '', scheduled_value: '', budget_item_id: '' }) }}>Cancel</button>
                              </div>
                            </div>
                          )}

                          {!sovs && <p style={{ color: '#444', fontSize: '13px' }}>Loading...</p>}
                          {sovs && sovs.length === 0 && !showAddSovLine && (
                            <p style={{ color: '#444', fontSize: '13px' }}>No SOV lines yet. Add lines to track sub's completion per scope item.</p>
                          )}

                          {sovs && sovs.length > 0 && (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                  <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                                    <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Description</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700', whiteSpace: 'nowrap' }}>Scheduled</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700', whiteSpace: 'nowrap' }}>Billed to Date</th>
                                    <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>Balance</th>
                                    <th style={{ textAlign: 'center', padding: '6px 8px', fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '700' }}>% Done</th>
                                    <th style={{ width: '90px' }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sovs.map(line => {
                                    const balance = Number(line.scheduled_value) - Number(line.billed_to_date || 0)
                                    const pct = Number(line.scheduled_value) > 0 ? (Number(line.billed_to_date || 0) / Number(line.scheduled_value)) * 100 : 0
                                    const isEditingThisLine = editingSovLine === line.id
                                    return (
                                      <tr key={line.id} style={{ borderBottom: '1px solid #111' }}>
                                        {isEditingThisLine ? (
                                          <>
                                            <td style={{ padding: '4px' }}>
                                              <input style={{ ...s.input, padding: '5px 8px', fontSize: '12px' }} value={editSovLineForm.description} onChange={e => setEditSovLineForm(f => ({ ...f, description: e.target.value }))} />
                                              {budgetItems.length > 0 && (
                                                <select style={{ ...s.input, padding: '5px 8px', fontSize: '12px', marginTop: '4px' }} value={editSovLineForm.budget_item_id || ''} onChange={e => setEditSovLineForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                                                  <option value="">— No budget item —</option>
                                                  {budgetItems.map(item => (
                                                    <option key={item.id} value={item.id}>{item.cost_code ? `${item.cost_code} · ` : ''}{item.description}</option>
                                                  ))}
                                                </select>
                                              )}
                                            </td>
                                            <td style={{ padding: '4px' }}>
                                              <input type="number" step="0.01" style={{ ...s.input, padding: '5px 8px', fontSize: '12px', width: '110px', textAlign: 'right' }} value={editSovLineForm.scheduled_value} onChange={e => setEditSovLineForm(f => ({ ...f, scheduled_value: e.target.value }))} />
                                            </td>
                                            <td colSpan="3"></td>
                                            <td style={{ padding: '4px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button style={s.btnSmallOrange} onClick={() => updateSovLine(line.id, c.id)}>Save</button>
                                                <button style={s.btnSmall} onClick={() => setEditingSovLine(null)}>✕</button>
                                              </div>
                                            </td>
                                          </>
                                        ) : (
                                          <>
                                            <td style={{ padding: '8px', color: '#ccc' }}>
                                              {line.description}
                                              {line.budget_items && (
                                                <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
                                                  {line.budget_items.cost_code ? `${line.budget_items.cost_code} · ` : ''}{line.budget_items.description}
                                                </div>
                                              )}
                                            </td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: '#f1f1f1', fontFamily: 'monospace' }}>${Number(line.scheduled_value).toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: Number(line.billed_to_date) > 0 ? '#4ade80' : '#444', fontFamily: 'monospace' }}>${Number(line.billed_to_date || 0).toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'right', color: balance < 0 ? '#ff6b6b' : '#555', fontFamily: 'monospace' }}>${balance.toLocaleString()}</td>
                                            <td style={{ padding: '8px', textAlign: 'center' }}>
                                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
                                                <span style={{ fontSize: '11px', fontWeight: '700', color: pct >= 100 ? '#4ade80' : pct > 50 ? '#e8590c' : '#555' }}>{pct.toFixed(0)}%</span>
                                                <div style={{ width: '56px', height: '3px', background: '#1a1a1a', borderRadius: '2px' }}>
                                                  <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: pct >= 100 ? '#4ade80' : '#e8590c', borderRadius: '2px' }} />
                                                </div>
                                              </div>
                                            </td>
                                            <td style={{ padding: '4px', textAlign: 'right' }}>
                                              <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                                                <button style={s.btnSmall} onClick={() => { setEditingSovLine(line.id); setEditSovLineForm({ description: line.description, scheduled_value: String(line.scheduled_value), budget_item_id: line.budget_item_id || '' }) }}>Edit</button>
                                                <button style={s.btnSmallRed} onClick={() => deleteSovLine(line.id, c.id)}>Del</button>
                                              </div>
                                            </td>
                                          </>
                                        )}
                                      </tr>
                                    )
                                  })}
                                  <tr style={{ borderTop: '2px solid #2a2a2a' }}>
                                    <td style={{ padding: '8px', color: '#888', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>Total</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: '#f1f1f1' }}>${totalScheduled.toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: '#4ade80' }}>${totalBilled.toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'right', fontFamily: 'monospace', fontWeight: '700', color: (totalScheduled - totalBilled) < 0 ? '#ff6b6b' : '#555' }}>${(totalScheduled - totalBilled).toLocaleString()}</td>
                                    <td style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#555' }}>{totalScheduled > 0 ? ((totalBilled / totalScheduled) * 100).toFixed(0) : 0}%</td>
                                    <td></td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── CHANGE ORDERS TAB ── */}
        {activeTab === 'changeorders' && (
          <>
            {(() => {
              const approvedPrimeCOVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
              const pendingPrimeCOs = primeCOs.filter(co => co.status === 'pending').length
              return (
                <div style={s.statRow} className="rx-stats">
                  <div style={s.statCard}><div style={s.statLabel}>Sub COs pending</div><div style={s.statValue(pendingCOs > 0 ? '#e8590c' : undefined)}>{pendingCOs}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Sub CO approved value</div><div style={s.statValue('#4ade80')}>{approvedCOValue >= 0 ? '+' : ''}${approvedCOValue.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Prime COs pending</div><div style={s.statValue(pendingPrimeCOs > 0 ? '#e8590c' : undefined)}>{pendingPrimeCOs}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Prime CO approved value</div><div style={s.statValue('#4ade80')}>{approvedPrimeCOVal >= 0 ? '+' : ''}${approvedPrimeCOVal.toLocaleString()}</div></div>
                </div>
              )
            })()}

            {/* Prime Contract Change Orders */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Prime Contract Change Orders ({primeCOs.length})</p>
                {!showAddPrimeCO && <button style={s.btnSmallOrange} onClick={() => { setShowAddPrimeCO(true); loadBudgetItems(); setPrimeCOForm({ ...emptyPrimeCO, sov: [{ ...emptySOVRow }] }) }}>+ Add Prime CO</button>}
              </div>

              {showAddPrimeCO && (() => {
                const sovTotal = primeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                const totalAmt = primeCOForm.sov.length > 0 ? sovTotal : (parseFloat(primeCOForm.amount) ?? 0)
                const amountEntered = primeCOForm.sov.length > 0 ? true : primeCOForm.amount !== ''
                const allLinesAssigned = primeCOForm.sov.length > 0 && primeCOForm.sov.every(r => r.budget_item_id && r.amount)
                return (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New prime contract change order</p>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Description *</label>
                      <input style={s.input} placeholder="Scope change, owner directive..." value={primeCOForm.description} onChange={e => setPrimeCOForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Notes (optional)</label>
                      <input style={s.input} placeholder="Additional notes..." value={primeCOForm.notes} onChange={e => setPrimeCOForm(f => ({ ...f, notes: e.target.value }))} />
                    </div>
                  </div>

                  <div style={{ background: '#0a1a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                      <div>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1.5px', textTransform: 'uppercase', margin: 0 }}>Budget line assignment</p>
                        <p style={{ fontSize: '11px', color: '#555', margin: '3px 0 0' }}>When approved, each line's budget and SOV owner amount update automatically.</p>
                      </div>
                      <button type="button" style={s.btnSmall} onClick={() => setPrimeCOForm(f => ({ ...f, sov: [...f.sov, { ...emptySOVRow }] }))}>+ Add line</button>
                    </div>
                    {primeCOForm.sov.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 32px', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                        <select style={{ ...s.input, borderColor: row.budget_item_id ? '#1a4a1a' : '#4a2200' }}
                          value={row.budget_item_id}
                          onChange={e => {
                            const bi = budgetItems.find(b => b.id === e.target.value)
                            setPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, budget_item_id: e.target.value, description: r.description || bi?.description || '' } : r) }))
                          }}>
                          <option value="">— Select budget line * —</option>
                          {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</option>)}
                        </select>
                        <input style={s.input} placeholder="Description (optional)" value={row.description} onChange={e => setPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, description: e.target.value } : r) }))} />
                        <input type="number" style={{ ...s.input, borderColor: row.amount ? '#1a4a1a' : '#4a2200' }} placeholder="Amount *" value={row.amount}
                          onChange={e => {
                            const newSov = primeCOForm.sov.map((r, j) => j === i ? { ...r, amount: e.target.value } : r)
                            const newTotal = newSov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                            setPrimeCOForm(f => ({ ...f, sov: newSov, amount: String(newTotal || '') }))
                          }} />
                        <button type="button" style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }} onClick={() => {
                          const newSov = primeCOForm.sov.filter((_, j) => j !== i)
                          const newTotal = newSov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                          setPrimeCOForm(f => ({ ...f, sov: newSov, amount: String(newTotal || '') }))
                        }}>×</button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #1a3a1a' }}>
                      <span style={{ fontSize: '12px', color: allLinesAssigned ? '#4ade80' : '#e8590c' }}>
                        {allLinesAssigned ? '✓ All lines assigned' : 'Assign a budget line and amount to each row'}
                      </span>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1', fontFamily: 'monospace' }}>
                        Total: ${totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: (addingPrimeCO || !primeCOForm.description || !amountEntered) ? 0.6 : 1 }}
                      disabled={addingPrimeCO || !primeCOForm.description || !amountEntered}
                      onClick={addPrimeCO}>
                      {addingPrimeCO ? 'Saving...' : 'Save Prime CO'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowAddPrimeCO(false); setPrimeCOForm(emptyPrimeCO) }}>Cancel</button>
                  </div>
                </div>
                )
              })()}

              {primeCOs.length === 0 && !showAddPrimeCO && <p style={{ color: '#444', fontSize: '14px' }}>No prime contract change orders yet.</p>}

              {primeCOs.map(co => {
                const isExpanded = expandedPrimeCOId === co.id
                const isEditing = editingPrimeCOId === co.id
                const hasSov = co.sov?.length > 0
                if (isEditing) {
                  const sovTotal = editPrimeCOForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                  const totalAmt = editPrimeCOForm.sov.length > 0 ? sovTotal : (parseFloat(editPrimeCOForm.amount) ?? 0)
                  const amountEntered = editPrimeCOForm.sov.length > 0 ? true : editPrimeCOForm.amount !== ''
                  const allLinesAssigned = editPrimeCOForm.sov.length > 0 && editPrimeCOForm.sov.every(r => r.budget_item_id && r.amount)
                  return (
                    <div key={co.id} style={{ ...s.inlineForm, border: '1px solid #2a3a2a', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <p style={{ ...s.cardTitle, margin: 0 }}>Edit prime CO</p>
                        {co.status === 'approved' && (
                          <span style={{ fontSize: '11px', color: '#f59e0b', background: '#1a1200', border: '1px solid #3a2a00', borderRadius: '6px', padding: '3px 8px' }}>
                            Approved — amount change will adjust contract value
                          </span>
                        )}
                      </div>
                      <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                        <div>
                          <label style={s.label}>Description *</label>
                          <input style={s.input} value={editPrimeCOForm.description} onChange={e => setEditPrimeCOForm(f => ({ ...f, description: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Notes (optional)</label>
                          <input style={s.input} value={editPrimeCOForm.notes || ''} onChange={e => setEditPrimeCOForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                      </div>

                      <div style={{ background: '#0a1a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                          <div>
                            <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1.5px', textTransform: 'uppercase', margin: 0 }}>Budget line assignment</p>
                            <p style={{ fontSize: '11px', color: '#555', margin: '3px 0 0' }}>When approved, each line updates budget and SOV automatically.</p>
                          </div>
                          <button type="button" style={s.btnSmall} onClick={() => setEditPrimeCOForm(f => ({ ...f, sov: [...f.sov, { ...emptySOVRow }] }))}>+ Add line</button>
                        </div>
                        {editPrimeCOForm.sov.length === 0 && (
                          <div style={{ marginBottom: '10px' }}>
                            <label style={s.label}>Total amount (no SOV lines)</label>
                            <input type="number" style={s.input} placeholder="Amount" value={editPrimeCOForm.amount}
                              onChange={e => setEditPrimeCOForm(f => ({ ...f, amount: e.target.value }))} />
                          </div>
                        )}
                        {editPrimeCOForm.sov.map((row, i) => (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 32px', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                            <select style={{ ...s.input, borderColor: row.budget_item_id ? '#1a4a1a' : '#4a2200' }}
                              value={row.budget_item_id}
                              onChange={e => {
                                const bi = budgetItems.find(b => b.id === e.target.value)
                                setEditPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, budget_item_id: e.target.value, description: r.description || bi?.description || '' } : r) }))
                              }}>
                              <option value="">— Select budget line —</option>
                              {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</option>)}
                            </select>
                            <input style={s.input} placeholder="Description" value={row.description} onChange={e => setEditPrimeCOForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, description: e.target.value } : r) }))} />
                            <input type="number" style={{ ...s.input, borderColor: row.amount ? '#1a4a1a' : '#4a2200' }} placeholder="Amount" value={row.amount}
                              onChange={e => {
                                const newSov = editPrimeCOForm.sov.map((r, j) => j === i ? { ...r, amount: e.target.value } : r)
                                const newTotal = newSov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                                setEditPrimeCOForm(f => ({ ...f, sov: newSov, amount: String(newTotal || '') }))
                              }} />
                            <button type="button" style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }} onClick={() => {
                              const newSov = editPrimeCOForm.sov.filter((_, j) => j !== i)
                              const newTotal = newSov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                              setEditPrimeCOForm(f => ({ ...f, sov: newSov, amount: String(newTotal || '') }))
                            }}>×</button>
                          </div>
                        ))}
                        {editPrimeCOForm.sov.length > 0 && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #1a3a1a' }}>
                            <span style={{ fontSize: '12px', color: allLinesAssigned ? '#4ade80' : '#e8590c' }}>
                              {allLinesAssigned ? '✓ All lines assigned' : 'Assign a budget line and amount to each row'}
                            </span>
                            <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1', fontFamily: 'monospace' }}>
                              Total: ${totalAmt.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button style={{ ...s.btn, opacity: (savingPrimeCO || !editPrimeCOForm.description || !amountEntered) ? 0.6 : 1 }}
                          disabled={savingPrimeCO || !editPrimeCOForm.description || !amountEntered}
                          onClick={savePrimeCO}>
                          {savingPrimeCO ? 'Saving...' : 'Save changes'}
                        </button>
                        <button style={s.btnGray} onClick={() => setEditingPrimeCOId(null)}>Cancel</button>
                      </div>
                    </div>
                  )
                }
                return (
                <div key={co.id} style={{ ...s.coRow, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{co.description}</span>
                        {hasSov && <span style={{ fontSize: '10px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }} onClick={() => setExpandedPrimeCOId(isExpanded ? null : co.id)}>{co.sov.length} SOV lines {isExpanded ? '▲' : '▼'}</span>}
                        <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                      </div>
                      {co.notes && <span style={{ fontSize: '13px', color: '#aaa' }}>{co.notes}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                        {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                      </span>
                      <span style={s.coBadge(co.status)}>{co.status}</span>
                      {co.status === 'pending' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={s.btnSmallGreen} onClick={() => reviewPrimeCO(co.id, 'approved', co.amount)}>Approve</button>
                          <button style={s.btnSmallRed} onClick={() => reviewPrimeCO(co.id, 'rejected', co.amount)}>Reject</button>
                        </div>
                      )}
                      <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px' }} onClick={() => {
                        loadBudgetItems()
                        setEditingPrimeCOId(co.id)
                        setExpandedPrimeCOId(null)
                        setEditPrimeCOForm({ description: co.description || '', notes: co.notes || '', amount: String(co.amount || ''), sov: co.sov?.length > 0 ? co.sov.map(r => ({ description: r.description || '', budget_item_id: r.budget_item_id || '', amount: String(r.amount || '') })) : [] })
                      }}>Edit</button>
                      <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px' }} onClick={() => { const idx = [...primeCOs].reverse().findIndex(c => c.id === co.id); printPrimeCO(co, idx + 1) }}>Print CO</button>
                      <button style={{ ...s.btnSmallRed, fontSize: '11px', padding: '2px 8px' }} onClick={() => deletePrimeCO(co.id)}>Delete</button>
                    </div>
                  </div>
                  {isExpanded && hasSov && (
                    <div style={{ marginTop: '10px', padding: '12px', background: '#0a0a0a', borderRadius: '6px', border: '1px solid #1a1a1a' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>Schedule of Values</p>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '10px', color: '#444', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                        <span>Description</span><span>Budget Line</span><span style={{ textAlign: 'right' }}>Amount</span>
                      </div>
                      {co.sov.map((item, i) => {
                        const bi = budgetItems.find(b => b.id === item.budget_item_id)
                        return (
                          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '5px 0', borderTop: '1px solid #1a1a1a' }}>
                            <span>{item.description || '—'}</span>
                            <span style={{ color: bi ? '#888' : '#555' }}>{bi ? `${bi.cost_code ? bi.cost_code + ' · ' : ''}${bi.description}` : '—'}</span>
                            <span style={{ textAlign: 'right', fontWeight: '600', color: Number(item.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>{Number(item.amount) >= 0 ? '+' : ''}${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )
                      })}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a', marginTop: '4px' }}>
                        <span style={{ fontSize: '12px', color: '#555' }}>Total:</span>
                        <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1' }}>${co.sov.reduce((a, r) => a + Number(r.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  )}
                </div>
                )
              })}
            </div>

            {/* Subcontract Change Orders */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Subcontract Change Orders ({allCOs.length})</p>
                {!showAddCO && <button style={s.btnSmallOrange} onClick={() => setShowAddCO(true)}>+ Add CO</button>}
              </div>

              {showAddCO && (() => {
                const subSovTotal = coForm.sov.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0)
                const subHasSOV = coForm.sov.length > 0
                return (
                <div style={s.inlineForm}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>New change order</p>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Subcontract</label>
                    <select style={s.input} value={coForm.subcontract_id} onChange={e => setCoForm(f => ({ ...f, subcontract_id: e.target.value }))}>
                      <option value="">Select subcontract...</option>
                      {contracts.map(c => {
                        const subName = c.vendor_name || registeredSubs.find(s => s.sub_id === c.sub_id)?.profiles?.company_name || 'Unknown'
                        return <option key={c.id} value={c.id}>{subName}{c.description ? ` — ${c.description}` : ''}</option>
                      })}
                    </select>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Direction</label>
                      <select style={s.input} value={coForm.direction} onChange={e => setCoForm(f => ({ ...f, direction: e.target.value }))}>
                        <option value="pm_to_sub">PM → Sub (add scope)</option>
                        <option value="sub_to_pm">Sub → PM (sub request)</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Description</label>
                      <input style={s.input} placeholder="Additional scope, credit..." value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                  </div>
                  {!subHasSOV && (
                    <div style={{ marginBottom: '12px', maxWidth: '220px' }}>
                      <label style={s.label}>Amount ($)</label>
                      <input type="number" style={s.input} placeholder="0.00" value={coForm.amount} onChange={e => setCoForm(f => ({ ...f, amount: e.target.value }))} />
                    </div>
                  )}
                  {/* SOV Section */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase' }}>Schedule of Values</p>
                      <button type="button" style={s.btnSmall} onClick={() => { setCoForm(f => ({ ...f, sov: [...f.sov, { ...emptySOVRow }] })); if (!budgetItems.length) loadBudgetItems() }}>+ Add Line</button>
                    </div>
                    {coForm.sov.length === 0 && <p style={{ fontSize: '12px', color: '#444', marginBottom: '8px' }}>No SOV lines — CO will use the amount above. Add lines to break down cost by budget item.</p>}
                    {coForm.sov.map((row, i) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 32px', gap: '8px', marginBottom: '6px', alignItems: 'center' }}>
                        <input style={s.input} placeholder="Description" value={row.description} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, description: e.target.value } : r) }))} />
                        <select style={s.input} value={row.budget_item_id} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, budget_item_id: e.target.value } : r) }))}>
                          <option value="">— Budget line —</option>
                          {budgetItems.map(bi => <option key={bi.id} value={bi.id}>{bi.cost_code ? `${bi.cost_code} · ` : ''}{bi.description}</option>)}
                        </select>
                        <input type="number" style={s.input} placeholder="$0.00" value={row.amount} onChange={e => setCoForm(f => ({ ...f, sov: f.sov.map((r, j) => j === i ? { ...r, amount: e.target.value } : r) }))} />
                        <button type="button" style={{ background: 'none', border: 'none', color: '#e8590c', cursor: 'pointer', fontSize: '16px', padding: '0' }} onClick={() => setCoForm(f => ({ ...f, sov: f.sov.filter((_, j) => j !== i) }))}>×</button>
                      </div>
                    ))}
                    {subHasSOV && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center', paddingTop: '6px', borderTop: '1px solid #1a1a1a' }}>
                        <span style={{ fontSize: '12px', color: '#555' }}>SOV Total:</span>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>${subSovTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: addingCO ? 0.6 : 1 }} disabled={addingCO} onClick={addCO}>{addingCO ? 'Saving...' : 'Save CO'}</button>
                    <button style={s.btnGray} onClick={() => { setShowAddCO(false); setCoForm(emptyCO) }}>Cancel</button>
                  </div>
                </div>
                )
              })()}

              {allCOs.length === 0 && !showAddCO && <p style={{ color: '#444', fontSize: '14px' }}>No change orders yet.</p>}

              {allCOs.map((co, coIdx) => {
                const subId = co.subcontracts?.sub_id
                const matchedContract = contracts.find(c => c.id === co.subcontract_id)
                const subName = matchedContract?.vendor_name || registeredSubs.find(s => s.sub_id === subId)?.profiles?.company_name || 'Unknown sub'
                const scope = co.subcontracts?.description
                const isPushing = pushCOId === co.id
                const markedUpPreview = pushMarkup !== '' ? Math.round(Number(co.amount) * (1 + parseFloat(pushMarkup || 0) / 100) * 100) / 100 : null
                const hasSov = co.sov?.length > 0
                const isSOVExpanded = expandedSubCOId === co.id
                return (
                  <div key={co.id} style={{ ...s.coRow, flexDirection: 'column', alignItems: 'stretch', gap: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: isPushing ? '10px' : 0 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '13px', fontWeight: '600', color: '#f1f1f1' }}>{subName}</span>
                          {scope && <span style={{ fontSize: '11px', color: '#555' }}>{scope}</span>}
                          <span style={{ fontSize: '11px', color: '#555' }}>{co.direction === 'pm_to_sub' ? 'PM → Sub' : 'Sub → PM'}</span>
                          {hasSov && <span style={{ fontSize: '10px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }} onClick={() => setExpandedSubCOId(isSOVExpanded ? null : co.id)}>{co.sov.length} SOV lines {isSOVExpanded ? '▲' : '▼'}</span>}
                          <span style={{ fontSize: '11px', color: '#444' }}>{new Date(co.created_at).toLocaleDateString()}</span>
                        </div>
                        <span style={{ fontSize: '13px', color: '#aaa' }}>{co.description}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        <span style={{ fontSize: '15px', fontWeight: '700', color: Number(co.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>
                          {Number(co.amount) >= 0 ? '+' : ''}${Number(co.amount).toLocaleString()}
                        </span>
                        <span style={s.coBadge(co.status)}>{co.status}</span>
                        {co.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button style={s.btnSmallGreen} onClick={() => reviewCO(co.id, 'approved')}>Approve</button>
                            <button style={s.btnSmallRed} onClick={() => reviewCO(co.id, 'rejected')}>Reject</button>
                          </div>
                        )}
                        {co.direction === 'sub_to_pm' && (
                          <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px', color: isPushing ? '#e8590c' : undefined }} onClick={() => { if (isPushing) { setPushCOId(null); setPushMarkup('') } else { setPushCOId(co.id); setPushMarkup(String(job.markup_pct || '')) } }}>
                            {isPushing ? '✕ Cancel' : '↑ Push to Prime'}
                          </button>
                        )}
                        <button style={{ ...s.btnSmall, fontSize: '11px', padding: '3px 10px' }} onClick={() => { const num = allCOs.length - coIdx; printSubCO(co, subName, scope, num) }}>Print CO</button>
                      </div>
                    </div>
                    {isPushing && (
                      <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '14px 16px', marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '10px' }}>Push to Prime Contract CO</p>
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div>
                            <label style={s.label}>Sub amount</label>
                            <div style={{ fontSize: '15px', fontWeight: '700', color: '#f1f1f1', paddingTop: '6px' }}>${Number(co.amount).toLocaleString()}</div>
                          </div>
                          <div>
                            <label style={s.label}>Markup %</label>
                            <input type="number" style={{ ...s.input, width: '90px' }} placeholder="0" value={pushMarkup} onChange={e => setPushMarkup(e.target.value)} />
                          </div>
                          {markedUpPreview != null && (
                            <div>
                              <label style={s.label}>Prime CO amount</label>
                              <div style={{ fontSize: '15px', fontWeight: '700', color: '#4ade80', paddingTop: '6px' }}>${markedUpPreview.toLocaleString()}</div>
                            </div>
                          )}
                          <button style={{ ...s.btn, opacity: pushingToPrime ? 0.6 : 1, flexShrink: 0 }} disabled={pushingToPrime} onClick={() => pushSubCOToPrime(co, subName)}>
                            {pushingToPrime ? 'Creating...' : 'Create Prime CO'}
                          </button>
                        </div>
                      </div>
                    )}
                    {isSOVExpanded && hasSov && (
                      <div style={{ marginTop: '10px', padding: '12px', background: '#0a0a0a', borderRadius: '6px', border: '1px solid #1a1a1a' }}>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>Schedule of Values</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '10px', color: '#444', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                          <span>Description</span><span>Budget Line</span><span style={{ textAlign: 'right' }}>Amount</span>
                        </div>
                        {co.sov.map((item, i) => {
                          const bi = budgetItems.find(b => b.id === item.budget_item_id)
                          return (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '5px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{item.description || '—'}</span>
                              <span style={{ color: bi ? '#888' : '#555' }}>{bi ? `${bi.cost_code ? bi.cost_code + ' · ' : ''}${bi.description}` : '—'}</span>
                              <span style={{ textAlign: 'right', fontWeight: '600', color: Number(item.amount) >= 0 ? '#4ade80' : '#ff6b6b' }}>{Number(item.amount) >= 0 ? '+' : ''}${Number(item.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )
                        })}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid #2a2a2a', marginTop: '4px' }}>
                          <span style={{ fontSize: '12px', color: '#555' }}>Total:</span>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#f1f1f1' }}>${co.sov.reduce((a, r) => a + Number(r.amount || 0), 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── BILLING TAB ── */}
        {activeTab === 'billing' && (
          <>
            <div style={s.statRow} className="rx-stats">
              <div style={s.statCard}><div style={s.statLabel}>Total submissions</div><div style={s.statValue()}>{billingSubmissions.length}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Pending review</div><div style={s.statValue(pendingBillingCount > 0 ? '#e8590c' : undefined)}>{pendingBillingCount}</div></div>
              <div style={s.statCard}><div style={s.statLabel}>Approved total</div><div style={s.statValue('#4ade80')}>${approvedBillingTotal.toLocaleString()}</div></div>
            </div>

            {/* ── DRAW REQUESTS ── */}
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Draw requests ({drawRequests.length})</p>
                {!showCreateDraw && (
                  <button style={s.btnSmallOrange} onClick={async () => { await loadDirectCosts(); setShowCreateDraw(true) }}>+ New draw</button>
                )}
              </div>

              {showCreateDraw && (() => {
                const undrawnApproved = directCosts.filter(c => c.status === 'approved' && !c.draw_request_id && !c.drawn_application_id)
                return (
                  <div style={{ ...s.inlineForm, border: '1px solid #4a2200', marginBottom: '1rem' }}>
                    <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Create new draw request</p>
                    <div style={{ marginBottom: '12px' }}>
                      <label style={s.label}>Draw title (optional)</label>
                      <input style={s.input} value={drawForm.title} onChange={e => setDrawForm(f => ({ ...f, title: e.target.value }))} placeholder={`Draw Request ${drawRequests.length + 1}`} />
                    </div>
                    {undrawnApproved.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <label style={s.label}>Tag approved direct costs to this draw</label>
                        <div style={{ background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                          {undrawnApproved.map(dc => (
                            <label key={dc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', cursor: 'pointer', borderBottom: '1px solid #111' }}>
                              <input
                                type="checkbox"
                                checked={drawForm.dc_ids.includes(dc.id)}
                                onChange={e => setDrawForm(f => ({ ...f, dc_ids: e.target.checked ? [...f.dc_ids, dc.id] : f.dc_ids.filter(x => x !== dc.id) }))}
                                style={{ accentColor: '#e8590c', width: '16px', height: '16px', flexShrink: 0 }}
                              />
                              <span style={{ fontSize: '13px', color: '#ccc', flex: 1 }}>{dc.description}</span>
                              <span style={{ fontSize: '12px', color: '#888', flexShrink: 0 }}>{dc.cost_date} · ${Number(dc.amount).toLocaleString()}</span>
                            </label>
                          ))}
                        </div>
                        {drawForm.dc_ids.length > 0 && (
                          <p style={{ fontSize: '12px', color: '#e8590c', margin: '6px 0 0' }}>{drawForm.dc_ids.length} cost{drawForm.dc_ids.length > 1 ? 's' : ''} will be tagged to this draw</p>
                        )}
                      </div>
                    )}
                    {undrawnApproved.length === 0 && (
                      <p style={{ fontSize: '13px', color: '#555', marginBottom: '12px' }}>No undrawn approved direct costs to tag.</p>
                    )}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={{ ...s.btn, opacity: creatingDraw ? 0.5 : 1 }} disabled={creatingDraw} onClick={async () => {
                        setCreatingDraw(true)
                        await fetch('/api/draw-requests', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ job_id: id, title: drawForm.title || null, dc_ids: drawForm.dc_ids }),
                        })
                        setDrawForm({ title: '', dc_ids: [] })
                        setShowCreateDraw(false)
                        await loadDrawRequests()
                        await loadDirectCosts()
                        setCreatingDraw(false)
                      }}>
                        {creatingDraw ? 'Creating...' : 'Create draw'}
                      </button>
                      <button style={s.btnGray} onClick={() => { setShowCreateDraw(false); setDrawForm({ title: '', dc_ids: [] }) }}>Cancel</button>
                    </div>
                  </div>
                )
              })()}

              {drawRequests.length === 0 && !showCreateDraw && (
                <p style={{ color: '#444', fontSize: '14px' }}>No draw requests yet. Create one to let subs bill against a specific draw.</p>
              )}
              {drawRequests.map(dr => {
                const isOpen = expandedDrawId === dr.id
                const taggedCosts = directCosts.filter(c => c.draw_request_id === dr.id)
                const undrawnCosts = directCosts.filter(c => c.status === 'approved' && !c.draw_request_id && !c.drawn_application_id)
                const drawBillings = billingSubmissions.filter(b => b.draw_request_id === dr.id)
                const taggedTotal = taggedCosts.reduce((a, c) => a + Number(c.amount || 0), 0)
                return (
                  <div key={dr.id} style={{ border: `1px solid ${dr.status === 'open' ? '#4a2200' : '#1e1e1e'}`, borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                    {/* Header row — click to expand */}
                    <div
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: dr.status === 'open' ? '#140a00' : '#0a0a0a', cursor: 'pointer' }}
                      onClick={() => { setExpandedDrawId(isOpen ? null : dr.id); setDrawAddCostIds([]) }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{dr.title}</span>
                        <span style={{ fontSize: '11px', color: dr.status === 'open' ? '#e8590c' : '#555', background: dr.status === 'open' ? '#2a1200' : '#1a1a1a', border: `1px solid ${dr.status === 'open' ? '#4a2200' : '#2a2a2a'}`, borderRadius: '99px', padding: '2px 8px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {dr.status}
                        </span>
                        <span style={{ fontSize: '11px', color: '#555' }}>{taggedCosts.length} cost{taggedCosts.length !== 1 ? 's' : ''}</span>
                        {taggedTotal > 0 && <span style={{ fontSize: '12px', color: '#e8590c', fontWeight: '700' }}>${taggedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>}
                        <span style={{ fontSize: '11px', color: '#555' }}>{drawBillings.length} billing{drawBillings.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                        {dr.status === 'open' ? (
                          <button style={s.btnSmall} onClick={async () => {
                            await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dr.id, status: 'closed' }) })
                            await loadDrawRequests()
                          }}>Close</button>
                        ) : (
                          <button style={s.btnSmall} onClick={async () => {
                            await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dr.id, status: 'open' }) })
                            await loadDrawRequests()
                          }}>Reopen</button>
                        )}
                        <button style={s.btnSmallRed} onClick={async () => {
                          if (!window.confirm('Delete this draw? Billing submissions linked to it will be unlinked.')) return
                          await fetch(`/api/draw-requests?id=${dr.id}`, { method: 'DELETE' })
                          await loadDrawRequests()
                          await loadBillingForJob()
                        }}>Delete</button>
                        <span style={{ color: '#555', fontSize: '14px', marginLeft: '4px' }}>{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded body */}
                    {isOpen && (
                      <div style={{ borderTop: `1px solid ${dr.status === 'open' ? '#2a1200' : '#1a1a1a'}`, padding: '1rem 1.25rem', background: '#080808' }}>

                        {/* Tagged direct costs */}
                        <p style={{ ...s.cardTitle, marginBottom: '0.75rem' }}>Direct costs drawn ({taggedCosts.length})</p>
                        {taggedCosts.length === 0 ? (
                          <p style={{ fontSize: '13px', color: '#444', marginBottom: '1rem' }}>No direct costs tagged to this draw yet.</p>
                        ) : (
                          <div style={{ marginBottom: '1rem' }}>
                            {taggedCosts.map(dc => (
                              <div key={dc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #111', fontSize: '13px' }}>
                                <div>
                                  <span style={{ color: '#ccc' }}>{dc.description}</span>
                                  <span style={{ color: '#555', fontSize: '11px', marginLeft: '8px' }}>{dc.cost_date} · {dc.category}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ color: '#e8590c', fontWeight: '700' }}>${Number(dc.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                  <button
                                    style={{ fontSize: '11px', padding: '3px 8px', background: '#1a0a0a', border: '1px solid #3a1a1a', color: '#ff6b6b', borderRadius: '4px', cursor: 'pointer' }}
                                    onClick={async () => {
                                      await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dr.id, remove_dc_ids: [dc.id] }) })
                                      await loadDirectCosts()
                                    }}
                                  >Remove</button>
                                </div>
                              </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 10px 0', fontSize: '13px', fontWeight: '800', color: '#e8590c' }}>
                              Total: ${taggedTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </div>
                          </div>
                        )}

                        {/* Add undrawn costs */}
                        {undrawnCosts.length > 0 && (
                          <>
                            <p style={{ ...s.cardTitle, marginBottom: '0.75rem', marginTop: '0.5rem' }}>Add direct costs to this draw</p>
                            <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '8px', marginBottom: '10px', maxHeight: '220px', overflowY: 'auto' }}>
                              {undrawnCosts.map(dc => (
                                <label key={dc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 6px', cursor: 'pointer', borderBottom: '1px solid #111' }}>
                                  <input
                                    type="checkbox"
                                    checked={drawAddCostIds.includes(dc.id)}
                                    onChange={e => setDrawAddCostIds(ids => e.target.checked ? [...ids, dc.id] : ids.filter(x => x !== dc.id))}
                                    style={{ accentColor: '#e8590c', width: '15px', height: '15px', flexShrink: 0 }}
                                  />
                                  <span style={{ fontSize: '13px', color: '#ccc', flex: 1 }}>{dc.description}</span>
                                  <span style={{ fontSize: '11px', color: '#888', flexShrink: 0 }}>{dc.cost_date}</span>
                                  <span style={{ fontSize: '12px', color: '#e8590c', fontWeight: '700', flexShrink: 0 }}>${Number(dc.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                                </label>
                              ))}
                            </div>
                            <button
                              style={{ ...s.btn, opacity: (savingDrawCosts || drawAddCostIds.length === 0) ? 0.4 : 1, marginBottom: '1rem' }}
                              disabled={savingDrawCosts || drawAddCostIds.length === 0}
                              onClick={async () => {
                                setSavingDrawCosts(true)
                                await fetch('/api/draw-requests', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: dr.id, add_dc_ids: drawAddCostIds }) })
                                setDrawAddCostIds([])
                                await loadDirectCosts()
                                setSavingDrawCosts(false)
                              }}
                            >{savingDrawCosts ? 'Saving...' : `Draw ${drawAddCostIds.length > 0 ? drawAddCostIds.length + ' ' : ''}selected cost${drawAddCostIds.length !== 1 ? 's' : ''}`}</button>
                          </>
                        )}
                        {undrawnCosts.length === 0 && (
                          <p style={{ fontSize: '12px', color: '#444', marginBottom: '1rem' }}>No undrawn approved direct costs available.</p>
                        )}

                        {/* Billing submissions for this draw */}
                        {drawBillings.length > 0 && (
                          <>
                            <p style={{ ...s.cardTitle, marginBottom: '0.75rem', marginTop: '0.25rem' }}>Billing submissions ({drawBillings.length})</p>
                            {drawBillings.map(b => (
                              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #111', fontSize: '13px' }}>
                                <div>
                                  <span style={{ color: '#ccc', fontWeight: '600' }}>{b.company_name}</span>
                                  <span style={{ color: '#555', fontSize: '11px', marginLeft: '8px' }}>{new Date(b.submitted_at).toLocaleDateString()}</span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ color: '#f1f1f1', fontWeight: '700' }}>${Number(b.amount_billed).toLocaleString()}</span>
                                  <span style={s.coBadge(b.status)}>{b.status}</span>
                                </div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Billing submissions ({billingSubmissions.length})</p>
                {!showCreateBilling && (
                  <button style={s.btnSmallOrange} onClick={() => setShowCreateBilling(true)}>+ Create billing for sub</button>
                )}
              </div>

              {showCreateBilling && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Create billing on behalf of subcontractor</p>
                  <p style={{ fontSize: '12px', color: '#555', margin: '-0.5rem 0 1rem' }}>Use when a sub emails you billing info and you want to enter and approve it directly.</p>

                  <div style={{ marginBottom: '12px' }}>
                    <label style={s.label}>Contractor on this project</label>
                    <select style={s.input} value={createBillingForm._contract_id || ''}
                      onChange={e => {
                        const val = e.target.value
                        if (!val) { setCreateBillingForm(f => ({ ...f, _contract_id: '', _contract_value: '', _retainage_pct: '0', sub_id: '', company_name: '', contact_name: '', contact_info: '' })); return }
                        if (val.startsWith('sub:')) {
                          const assignmentId = val.slice(4)
                          const assignment = subs.find(s => s.id === assignmentId)
                          setCreateBillingForm(f => ({
                            ...f,
                            _contract_id: val,
                            _contract_value: '',
                            _retainage_pct: '0',
                            sub_id: assignment?.sub_id || '',
                            company_name: assignment?.profiles?.company_name || '',
                            contact_name: assignment?.profiles?.full_name || '',
                            contact_info: assignment?.profiles?.phone || '',
                          }))
                        } else {
                          const contract = contracts.find(c => c.id === val)
                          const regSub = contract?.sub_id ? subs.find(s => s.sub_id === contract.sub_id) : null
                          setCreateBillingForm(f => ({
                            ...f,
                            _contract_id: val,
                            _contract_value: String(contract?.adjusted_contract_value || contract?.contract_value || ''),
                            _retainage_pct: String(contract?.retainage_pct ?? 0),
                            sub_id: contract?.sub_id || '',
                            company_name: contract?.vendor_name || regSub?.profiles?.company_name || '',
                            contact_name: regSub?.profiles?.full_name || '',
                            contact_info: regSub?.profiles?.phone || '',
                          }))
                        }
                      }}>
                      <option value="">— Select a contractor —</option>
                      {contracts.length > 0 && contracts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.vendor_name || 'Unknown'}{c.description ? ` — ${c.description}` : ''}
                        </option>
                      ))}
                      {subs.filter(s => s.profiles?.company_name).map(s => (
                        <option key={`sub:${s.id}`} value={`sub:${s.id}`}>
                          {s.profiles.company_name}{s.profiles.full_name ? ` — ${s.profiles.full_name}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Company name *</label>
                      <input style={s.input} value={createBillingForm.company_name} onChange={e => setCreateBillingForm(f => ({ ...f, company_name: e.target.value }))} placeholder="ABC Framing LLC" required />
                    </div>
                    <div>
                      <label style={s.label}>Contact name</label>
                      <input style={s.input} value={createBillingForm.contact_name} onChange={e => setCreateBillingForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="John Smith" />
                    </div>
                  </div>
                  <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                    <div>
                      <label style={s.label}>Contact info (phone / email)</label>
                      <input style={s.input} value={createBillingForm.contact_info} onChange={e => setCreateBillingForm(f => ({ ...f, contact_info: e.target.value }))} placeholder="555-0100" />
                    </div>
                    <div>
                      <label style={s.label}>Amount billed ($) *</label>
                      <input type="number" step="0.01" style={s.input} value={createBillingForm.amount_billed} onChange={e => {
                        const amt = parseFloat(e.target.value) || 0
                        const contractVal = parseFloat(createBillingForm._contract_value) || 0
                        const pct = contractVal > 0 ? Math.min(100, Math.round(amt / contractVal * 100)) : null
                        setCreateBillingForm(f => ({ ...f, amount_billed: e.target.value, pct_complete: pct !== null ? String(pct) : f.pct_complete }))
                      }} placeholder="0.00" required />
                      {parseFloat(createBillingForm._retainage_pct) > 0 && parseFloat(createBillingForm.amount_billed) > 0 && (() => {
                        const retHeld = Math.round(parseFloat(createBillingForm.amount_billed) * parseFloat(createBillingForm._retainage_pct) / 100 * 100) / 100
                        const net = parseFloat(createBillingForm.amount_billed) - retHeld
                        return (
                          <div style={{ fontSize: '11px', marginTop: '5px', color: '#888' }}>
                            <span style={{ color: '#facc15' }}>{createBillingForm._retainage_pct}% retainage held: ${retHeld.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            <span style={{ color: '#4ade80', marginLeft: '10px' }}>Net payment: ${net.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          </div>
                        )
                      })()}
                    </div>
                    <div>
                      <label style={s.label}>% complete</label>
                      <input type="number" min="0" max="100" style={s.input} value={createBillingForm.pct_complete} onChange={e => setCreateBillingForm(f => ({ ...f, pct_complete: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Work description</label>
                      <textarea style={{ ...s.textarea, minHeight: '80px' }} value={createBillingForm.work_description} onChange={e => setCreateBillingForm(f => ({ ...f, work_description: e.target.value }))} placeholder="Describe the work completed this billing period..." />
                      <div style={{ marginTop: '10px' }}>
                        <label style={s.label}>Attachment (PDF, image, etc.)</label>
                        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" style={{ fontSize: '13px', color: '#ccc' }} onChange={e => setCreateBillingFile(e.target.files[0] || null)} />
                        {createBillingFile && <p style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{createBillingFile.name}</p>}
                      </div>
                    </div>
                    <div>
                      <div style={{ marginBottom: '12px' }}>
                        <label style={s.label}>Retainage % (from contract)</label>
                        <input type="number" min="0" max="100" step="0.5" style={s.input} value={createBillingForm._retainage_pct} onChange={e => setCreateBillingForm(f => ({ ...f, _retainage_pct: e.target.value }))} onFocus={e => e.target.select()} placeholder="0" />
                      </div>
                      <div>
                        <label style={s.label}>Billing period</label>
                        {drawRequests.length > 0 ? (
                          <>
                            <select style={s.input} value={createBillingForm.draw_request_id} onChange={e => setCreateBillingForm(f => ({ ...f, draw_request_id: e.target.value, billing_period: '' }))}>
                              <option value="">— Select a draw —</option>
                              {drawRequests.filter(d => d.status === 'open').map(d => (
                                <option key={d.id} value={d.id}>{d.title}</option>
                              ))}
                              {drawRequests.filter(d => d.status !== 'open').length > 0 && (
                                <optgroup label="Closed draws">
                                  {drawRequests.filter(d => d.status !== 'open').map(d => (
                                    <option key={d.id} value={d.id}>{d.title} (closed)</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                            <p style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>Select which draw this billing is for</p>
                          </>
                        ) : (
                          <>
                            <input type="month" style={s.input} value={createBillingForm.billing_period} onChange={e => setCreateBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                            <p style={{ fontSize: '11px', color: '#555', marginTop: '4px' }}>Month this billing covers — used to auto-fill AIA applications</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="autoApprove" checked={createBillingForm.auto_approve} onChange={e => setCreateBillingForm(f => ({ ...f, auto_approve: e.target.checked }))} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#e8590c' }} />
                    <label htmlFor="autoApprove" style={{ fontSize: '13px', color: '#ccc', cursor: 'pointer' }}>
                      Approve immediately (skip pending queue)
                    </label>
                  </div>
                  {(!createBillingForm.company_name || !createBillingForm.amount_billed) && (
                    <p style={{ fontSize: '12px', color: '#e8590c', marginBottom: '10px' }}>
                      {!createBillingForm.company_name ? 'Select a contractor or enter a company name. ' : ''}{!createBillingForm.amount_billed ? 'Enter the amount billed.' : ''}
                    </p>
                  )}
                  {createBillingError && (
                    <p style={{ fontSize: '12px', color: '#ff6b6b', marginBottom: '10px' }}>{createBillingError}</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: (creatingBilling || !createBillingForm.company_name || !createBillingForm.amount_billed) ? 0.4 : 1 }} disabled={creatingBilling || !createBillingForm.company_name || !createBillingForm.amount_billed} onClick={createBilling}>
                      {creatingBilling ? 'Saving...' : createBillingForm.auto_approve ? 'Save & approve' : 'Save as pending'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setShowCreateBilling(false); setCreateBillingForm(emptyCreateBilling); setCreateBillingError(''); setCreateBillingFile(null) }}>Cancel</button>
                  </div>
                </div>
              )}

              {billingSubmissions.length === 0 && !showCreateBilling && (
                <p style={{ color: '#444', fontSize: '14px' }}>No billing submissions yet. Create one above or wait for subs to submit from their portal.</p>
              )}

              {billingSubmissions.map(b => {
                const isEditing = editingBilling === b.id
                const isOwnerPay = job?.payment_type === 'owner_pays_direct'
                // Cumulative % billed to date for this sub
                const matchContract = contracts.find(c => c.vendor_name?.toLowerCase() === b.company_name?.toLowerCase())
                const contractVal = Number(matchContract?.adjusted_contract_value || matchContract?.contract_value || 0)
                const companySubs = billingSubmissions
                  .filter(s => s.company_name === b.company_name && s.status !== 'rejected')
                  .sort((a, z) => new Date(a.submitted_at) - new Date(z.submitted_at))
                let cumAmt = 0
                for (const s of companySubs) {
                  cumAmt += Number(s.amount_billed || 0)
                  if (s.id === b.id) break
                }
                const cumPct = contractVal > 0 ? Math.round(cumAmt / contractVal * 1000) / 10 : null
                return (
                  <div key={b.id} style={{ ...s.billingEntryRow, opacity: isEditing ? 0.95 : 1, border: b.ready_to_pay ? '1px solid #1a4a1a' : b.nv_cuts_check ? '1px solid #4a2200' : '1px solid #1e1e1e' }}>
                    <div style={{ ...s.billingEntryHeader, background: b.ready_to_pay ? '#0a1a0a' : b.nv_cuts_check ? '#140a00' : '#0f0f0f' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{b.company_name}</span>
                          {b.contact_name && <span style={{ fontSize: '12px', color: '#555' }}>{b.contact_name}</span>}
                          <span style={s.coBadge(b.status)}>{b.status}</span>
                          {b.ready_to_pay && <span style={{ fontSize: '10px', color: '#4ade80', background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '4px', padding: '2px 7px', fontWeight: '700', letterSpacing: '0.5px' }}>READY TO PAY</span>}
                          {b.nv_cuts_check && <span style={{ fontSize: '10px', color: '#e8590c', background: '#2a1200', border: '1px solid #4a2200', borderRadius: '4px', padding: '2px 7px', fontWeight: '700', letterSpacing: '0.5px' }}>NV CUTS CHECK</span>}
                          {b.status === 'approved' && b.lien_waiver_signed_at
                            ? <span style={{ fontSize: '10px', color: '#4ade80', background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '4px', padding: '2px 7px', fontWeight: '700', letterSpacing: '0.5px' }}>WAIVER SIGNED</span>
                            : b.status === 'approved' && b.lien_waiver_sent_at
                              ? <span style={{ fontSize: '10px', color: '#facc15', background: '#2a2000', border: '1px solid #4a4a00', borderRadius: '4px', padding: '2px 7px', fontWeight: '700', letterSpacing: '0.5px' }}>WAIVER PENDING</span>
                              : null
                          }
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {new Date(b.submitted_at).toLocaleDateString()}
                          {b.draw_request_id
                            ? <span style={{ background: '#2a1200', color: '#e8590c', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px', fontWeight: '700' }}>{drawRequests.find(d => d.id === b.draw_request_id)?.title || 'Draw'}</span>
                            : b.billing_period && <span style={{ background: '#1a2a1a', color: '#4ade80', padding: '1px 6px', borderRadius: '4px', fontSize: '11px', marginLeft: '6px' }}>{new Date(b.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                          }
                          {cumPct != null ? ` · ${cumPct}% billed to date` : b.pct_complete != null ? ` · ${b.pct_complete}% complete` : ''}
                          {b.work_description ? ` · ${b.work_description.slice(0, 60)}${b.work_description.length > 60 ? '…' : ''}` : ''}
                        </div>
                        {drawRequests.length > 0 && (
                          <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '11px', color: '#444' }}>Draw:</span>
                            <select
                              value={b.draw_request_id || ''}
                              onChange={e => assignBillingToDraw(b.id, e.target.value)}
                              style={{ fontSize: '11px', padding: '3px 8px', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '6px', color: b.draw_request_id ? '#e8590c' : '#555', outline: 'none', cursor: 'pointer' }}
                            >
                              <option value="">— Unassigned —</option>
                              {drawRequests.map(d => (
                                <option key={d.id} value={d.id}>{d.title}{d.status !== 'open' ? ' (closed)' : ''}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${Number(b.amount_billed).toLocaleString()}</div>
                          {b.retainage_held > 0 && (
                            <div style={{ fontSize: '11px', marginTop: '2px' }}>
                              <span style={{ color: '#facc15' }}>Ret: ${Number(b.retainage_held).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                              <span style={{ color: '#4ade80', marginLeft: '8px' }}>Net: ${(Number(b.amount_billed) - Number(b.retainage_held)).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                          {b.status === 'approved' && (
                            <button
                              title={b.ready_to_pay ? 'Mark as not ready' : 'Mark as ready to pay'}
                              disabled={togglingReadyToPay === b.id}
                              onClick={() => toggleReadyToPay(b.id, b.ready_to_pay)}
                              style={{ fontSize: '11px', padding: '4px 10px', background: b.ready_to_pay ? '#0a2a0a' : '#1a1a1a', border: `1px solid ${b.ready_to_pay ? '#1a4a1a' : '#2a2a2a'}`, color: b.ready_to_pay ? '#4ade80' : '#888', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', opacity: togglingReadyToPay === b.id ? 0.5 : 1 }}
                            >
                              {b.ready_to_pay ? '✓ Ready to pay' : 'Mark ready to pay'}
                            </button>
                          )}
                          {isOwnerPay && (
                            <select
                              title="Flag if NV Construction needs to cut this check"
                              value={b.nv_cuts_check ? 'nv' : 'owner'}
                              disabled={togglingNvCheck === b.id}
                              onChange={e => toggleNvCutsCheck(b.id, b.nv_cuts_check)}
                              style={{ fontSize: '11px', padding: '4px 8px', background: b.nv_cuts_check ? '#2a1200' : '#1a1a1a', border: `1px solid ${b.nv_cuts_check ? '#4a2200' : '#2a2a2a'}`, color: b.nv_cuts_check ? '#e8590c' : '#555', borderRadius: '6px', cursor: 'pointer', outline: 'none' }}
                            >
                              <option value="owner">Owner pays</option>
                              <option value="nv">NV cuts check</option>
                            </select>
                          )}
                          {b.lien_waiver_signed_at && (
                            <button style={s.btnSmall} onClick={() => {
                              const amt = parseFloat(b.amount_billed || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                              const period = b.billing_period ? new Date(b.billing_period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                              const w = window.open('', '_blank')
                              w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signed Lien Waiver</title><style>body{font-family:Georgia,serif;max-width:700px;margin:40px auto;padding:0 24px;color:#000}.grid{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #ccc;border-radius:4px;overflow:hidden;margin-bottom:16px;font-size:13px}.cell{padding:10px 12px;border-bottom:1px solid #ddd}.cell:nth-child(odd){border-right:1px solid #ddd}.cell label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:1.5px;color:#888;margin-bottom:3px}.body{font-size:12px;line-height:1.8;color:#333;margin-bottom:24px;border:1px solid #ccc;padding:16px}.sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}.sig-img{max-width:200px;max-height:60px}.sig-label{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-top:4px}@media print{.no-print{display:none}}</style></head><body>
<button class="no-print" onclick="window.print()" style="margin-bottom:24px;padding:10px 20px;background:#000;color:#fff;border:none;cursor:pointer;font-size:13px;">Print / Save as PDF</button>
<p style="text-align:center;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#888;margin-bottom:8px;">Conditional Waiver and Release on Progress Payment</p>
<h1 style="text-align:center;font-size:16px;text-transform:uppercase;letter-spacing:2px;">Signed Lien Waiver</h1>
<p style="text-align:center;font-size:11px;color:#555;font-style:italic;margin-bottom:24px;">Effective upon receipt of payment in good funds</p>
<div class="grid">
<div class="cell"><label>Claimant</label><span>${b.company_name}</span></div>
<div class="cell"><label>Hiring Party</label><span>NV Construction</span></div>
<div class="cell"><label>Project</label><span>#${job?.job_number} — ${job?.project_name}</span></div>
<div class="cell"><label>Owner</label><span>${job?.owner_company || job?.owner_name || 'Project Owner'}</span></div>
<div class="cell"><label>Payment Amount</label><span style="font-size:16px;font-weight:800;">${amt}</span></div>
<div class="cell"><label>Through Date</label><span>${period}</span></div>
</div>
<div class="body">This document conditionally waives and releases any mechanic's lien, stop payment notice, or payment bond right the Claimant has for labor, services, equipment, or materials furnished through the Through Date on the Project, conditioned on receipt of the Conditional Payment Amount in good funds.</div>
<div class="sig-grid">
<div><p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Signature</p>${b.lien_waiver_signature ? `<img src="${b.lien_waiver_signature}" class="sig-img" />` : ''}<div class="sig-label">Electronic signature</div></div>
<div><p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Printed Name</p><p style="margin:4px 0;font-size:14px;font-weight:600;">${b.lien_waiver_signer_name || ''}</p><div class="sig-label">Name</div></div>
<div><p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Date Signed</p><p style="margin:4px 0;font-size:13px;">${new Date(b.lien_waiver_signed_at).toLocaleDateString()}</p><div class="sig-label">Date</div></div>
<div><p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin:0 0 6px;">Company</p><p style="margin:4px 0;font-size:13px;">${b.company_name}</p><div class="sig-label">Company</div></div>
</div></body></html>`)
                              w.document.close()
                            }}>View Waiver</button>
                          )}
                          <button style={s.btnSmallOrange} onClick={() => {
                            if (!isEditing) loadBillingSov(b.id)
                            setEditingBilling(isEditing ? null : b.id)
                            setEditBillingForm({
                              company_name: b.company_name || '',
                              contact_name: b.contact_name || '',
                              contact_info: b.contact_info || '',
                              amount_billed: b.amount_billed || '',
                              retainage_pct: b.retainage_pct ?? 0,
                              pct_complete: b.pct_complete ?? '',
                              work_description: b.work_description || '',
                              billing_period: b.billing_period ? b.billing_period.slice(0, 7) : '',
                              status: b.status,
                            })
                          }}>
                            {isEditing ? 'Cancel' : 'Edit'}
                          </button>
                          <button style={s.btnSmallRed} onClick={() => deleteBillingEntry(b.id)}>Delete</button>
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div style={s.billingEntryExpanded}>
                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Edit billing submission</p>
                        <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                          <div>
                            <label style={s.label}>Company name</label>
                            <input style={s.input} value={editBillingForm.company_name} onChange={e => setEditBillingForm(f => ({ ...f, company_name: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Contact name</label>
                            <input style={s.input} value={editBillingForm.contact_name} onChange={e => setEditBillingForm(f => ({ ...f, contact_name: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                          <div>
                            <label style={s.label}>Contact info</label>
                            <input style={s.input} value={editBillingForm.contact_info} onChange={e => setEditBillingForm(f => ({ ...f, contact_info: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Amount billed ($)</label>
                            <input type="number" step="0.01" style={{ ...s.input, color: '#888', cursor: 'default' }} value={editBillingForm.amount_billed} readOnly tabIndex={-1} />
                          </div>
                          <div>
                            <label style={s.label}>Retainage %</label>
                            <input type="number" min="0" max="100" step="0.5" style={s.input} value={editBillingForm.retainage_pct} onChange={e => setEditBillingForm(f => ({ ...f, retainage_pct: e.target.value }))} onFocus={e => e.target.select()} />
                            {parseFloat(editBillingForm.retainage_pct) > 0 && parseFloat(editBillingForm.amount_billed) > 0 && (
                              <div style={{ fontSize: '11px', marginTop: '4px', color: '#facc15' }}>
                                Held: ${Math.round(parseFloat(editBillingForm.amount_billed) * parseFloat(editBillingForm.retainage_pct) / 100 * 100) / 100}
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={s.label}>% complete</label>
                            <input type="number" min="0" max="100" style={s.input} value={editBillingForm.pct_complete} onChange={e => setEditBillingForm(f => ({ ...f, pct_complete: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ ...s.grid2, marginBottom: '12px' }} className="rx-grid-2">
                          <div>
                            <label style={s.label}>Work description</label>
                            <textarea style={{ ...s.textarea, minHeight: '80px' }} value={editBillingForm.work_description} onChange={e => setEditBillingForm(f => ({ ...f, work_description: e.target.value }))} />
                          </div>
                          <div>
                            <label style={s.label}>Billing period</label>
                            <input type="month" style={s.input} value={editBillingForm.billing_period || ''} onChange={e => setEditBillingForm(f => ({ ...f, billing_period: e.target.value }))} />
                          </div>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Attachment (PDF, image, etc.)</label>
                          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.docx" style={{ fontSize: '13px', color: '#ccc' }} onChange={e => setEditBillingFile(e.target.files[0] || null)} />
                          {editBillingFile && <p style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{editBillingFile.name}</p>}
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <label style={s.label}>Status</label>
                          <select style={s.input} value={editBillingForm.status} onChange={e => setEditBillingForm(f => ({ ...f, status: e.target.value }))}>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="rejected">Rejected</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button style={s.btnSmallOrange} onClick={updateBillingEntry}>Save changes</button>
                          <button style={s.btnSmall} onClick={() => { setEditingBilling(null); setEditBillingFile(null) }}>Cancel</button>
                        </div>
                        {billingSovData[b.id] && billingSovData[b.id].length > 0 && (
                          <div style={{ marginTop: '1.25rem', borderTop: '1px solid #1e1e1e', paddingTop: '1rem' }}>
                            <p style={{ ...s.cardTitle, marginBottom: '0.75rem' }}>Schedule of values — this submission</p>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                                  <th style={{ textAlign: 'left', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Description</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Scheduled</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>This submission</th>
                                  <th style={{ textAlign: 'right', padding: '6px 8px', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>% Complete</th>
                                </tr>
                              </thead>
                              <tbody>
                                {billingSovData[b.id].map(line => {
                                  const sched = Number(line.subcontract_sov_lines?.scheduled_value || 0)
                                  const amt = Number(line.amount || 0)
                                  const pct = sched > 0 ? (amt / sched * 100).toFixed(0) : '—'
                                  return (
                                    <tr key={line.id} style={{ borderBottom: '1px solid #111' }}>
                                      <td style={{ padding: '8px', color: '#ccc' }}>{line.subcontract_sov_lines?.description || '—'}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#888' }}>${sched.toLocaleString()}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#f1f1f1', fontWeight: '600' }}>${amt.toLocaleString()}</td>
                                      <td style={{ padding: '8px', textAlign: 'right', color: '#4ade80' }}>{pct}%</td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
        {/* ── FIELD TAB ── */}
        {activeTab === 'field' && (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', borderBottom: '1px solid #1a1a1a', paddingBottom: '0' }}>
              {['reports', 'rfis', 'deliveries', 'milestones'].map(t => (
                <button key={t} style={{ padding: '8px 16px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', background: 'none', border: 'none', color: fieldSubTab === t ? '#f1f1f1' : '#555', borderBottom: fieldSubTab === t ? '2px solid #e8590c' : '2px solid transparent', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '-1px' }}
                  onClick={() => setFieldSubTab(t)}>
                  {t === 'reports' ? `Daily Reports (${fieldDailyReports.length})` : t === 'rfis' ? `RFIs (${fieldRfis.length})` : t === 'deliveries' ? `Deliveries (${fieldDeliveries.length})` : `Milestones (${fieldMilestones.length})`}
                </button>
              ))}
            </div>

            {/* Daily Reports */}
            {fieldSubTab === 'reports' && (
              fieldDailyReports.length === 0 ? <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No daily reports submitted yet.</div>
              : fieldDailyReports.map(r => (
                <div key={r.id} style={s.billingEntryRow}>
                  <div style={s.billingEntryHeader} onClick={() => setExpandedFieldReport(expandedFieldReport === r.id ? null : r.id)}>
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{new Date(r.report_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                      {r.weather && <span style={{ fontSize: '12px', color: '#555' }}>{r.weather}</span>}
                      {r.crew_count != null && <span style={{ fontSize: '12px', color: '#555' }}>{r.crew_count} crew</span>}
                    </div>
                    <span style={{ color: '#555' }}>{expandedFieldReport === r.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedFieldReport === r.id && (
                    <div style={s.billingEntryExpanded}>
                      {/* Weather */}
                      {(r.weather || r.weather_temp) && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Weather</p>
                          <p style={{ fontSize: '13px', color: '#ccc', margin: 0 }}>
                            {[r.weather, r.weather_temp && `${r.weather_temp}°F`].filter(Boolean).join(' · ')}
                            {r.weather_delay && <span style={{ marginLeft: '8px', color: '#e8590c', fontWeight: '700', fontSize: '11px' }}>DELAY</span>}
                          </p>
                        </div>
                      )}
                      {/* Work Performed */}
                      {r.work_performed && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Work Performed</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.work_performed}</p>
                        </div>
                      )}
                      {/* Crew Log */}
                      {r.crew_log?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Crew / Manpower</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Name</span><span>Company</span><span>Trade</span><span>Hrs</span>
                          </div>
                          {r.crew_log.map((c, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{c.name || '—'}</span><span>{c.company || '—'}</span><span>{c.trade || '—'}</span><span>{c.hours || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Subcontractor Activity */}
                      {r.subcontractor_activity?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Subcontractor Activity</p>
                          {r.subcontractor_activity.map((sub, i) => (
                            <div key={i} style={{ padding: '8px 12px', background: '#0f0f0f', borderRadius: '6px', marginBottom: '6px' }}>
                              <p style={{ fontSize: '13px', color: '#f1f1f1', fontWeight: '600', margin: '0 0 4px' }}>{sub.company || '—'} {sub.trade ? `· ${sub.trade}` : ''} {sub.crew_size ? `· ${sub.crew_size} crew` : ''}</p>
                              {sub.notes && <p style={{ fontSize: '13px', color: '#888', margin: 0, whiteSpace: 'pre-wrap' }}>{sub.notes}</p>}
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Equipment */}
                      {r.equipment_log?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Equipment</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Equipment</span><span>Operator</span><span>Hrs</span>
                          </div>
                          {r.equipment_log.map((e, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{e.equipment || '—'}</span><span>{e.operator || '—'}</span><span>{e.hours || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Materials Delivered */}
                      {r.materials_delivered?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Materials Delivered</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Material</span><span>Supplier</span><span>Qty</span>
                          </div>
                          {r.materials_delivered.map((m, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{m.material || '—'}</span><span>{m.supplier || '—'}</span><span>{m.quantity || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Visitors / Inspections */}
                      {r.visitors?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Visitors / Inspections</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr', gap: '4px 12px', fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>
                            <span>Name</span><span>Company</span><span>Purpose</span>
                          </div>
                          {r.visitors.map((v, i) => (
                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr', gap: '4px 12px', fontSize: '13px', color: '#ccc', padding: '4px 0', borderTop: '1px solid #1a1a1a' }}>
                              <span>{v.name || '—'}</span><span>{v.company || '—'}</span><span>{v.purpose || '—'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Safety */}
                      {r.safety_observations && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Safety Observations</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.safety_observations}</p>
                        </div>
                      )}
                      {/* Toolbox Talk */}
                      {r.toolbox_talk && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Toolbox Talk</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.toolbox_talk}</p>
                        </div>
                      )}
                      {/* Issues / Delays */}
                      {r.issues && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#e8590c', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Issues / Delays</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{r.issues}</p>
                        </div>
                      )}
                      {/* Photos */}
                      {r.photos?.length > 0 && (
                        <div style={{ marginBottom: '1.2rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 8px' }}>Photos ({r.photos.length})</p>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {r.photos.map((ph, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#141414', border: '1px solid #222', borderRadius: '6px', padding: '5px 10px' }}>
                                <span style={{ fontSize: '12px', color: '#e8590c', cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={async () => {
                                    const { data } = await supabase.storage.from('daily-report-photos').createSignedUrl(ph.path, 3600)
                                    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
                                  }}>
                                  {ph.name || `Photo ${i + 1}`}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => deleteFieldPhoto({ path: ph.path, fromReport: true, reportId: r.id })}
                                  disabled={deletingFieldPhoto === ph.path}
                                  style={{ background: 'none', border: 'none', color: deletingFieldPhoto === ph.path ? '#555' : '#ff6b6b', cursor: 'pointer', fontSize: '13px', padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>
                                  {deletingFieldPhoto === ph.path ? '…' : '✕'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* RFIs */}
            {fieldSubTab === 'rfis' && (
              fieldRfis.length === 0 ? <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No RFIs submitted yet.</div>
              : fieldRfis.map(rfi => (
                <div key={rfi.id} style={s.billingEntryRow}>
                  <div style={s.billingEntryHeader} onClick={() => setExpandedFieldRfi(expandedFieldRfi === rfi.id ? null : rfi.id)}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{rfi.title}</span>
                        <span style={s.coBadge(rfi.status === 'answered' ? 'approved' : rfi.status === 'closed' ? 'rejected' : 'pending')}>{rfi.status}</span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#555' }}>{new Date(rfi.created_at).toLocaleDateString()}</span>
                    </div>
                    <span style={{ color: '#555' }}>{expandedFieldRfi === rfi.id ? '▲' : '▼'}</span>
                  </div>
                  {expandedFieldRfi === rfi.id && (
                    <div style={s.billingEntryExpanded}>
                      {rfi.description && <>
                        <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Details</p>
                        <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: '0 0 1rem', whiteSpace: 'pre-wrap' }}>{rfi.description}</p>
                      </>}
                      {rfi.response && (
                        <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                          <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 6px' }}>Your response</p>
                          <p style={{ fontSize: '13px', color: '#ccc', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{rfi.response}</p>
                        </div>
                      )}
                      {respondingRfi === rfi.id ? (
                        <div>
                          <label style={s.label}>Response</label>
                          <textarea rows={4} style={{ ...s.textarea, marginBottom: '10px' }} value={rfiResponse} onChange={e => setRfiResponse(e.target.value)} placeholder="Type your response..." />
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => respondToRfi(rfi.id)} disabled={savingRfiResponse || !rfiResponse} style={{ ...s.btnSmallOrange, opacity: savingRfiResponse || !rfiResponse ? 0.6 : 1 }}>{savingRfiResponse ? 'Saving...' : 'Send response'}</button>
                            <button onClick={() => { setRespondingRfi(null); setRfiResponse('') }} style={s.btnSmall}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setRespondingRfi(rfi.id); setRfiResponse(rfi.response || '') }} style={s.btnSmallOrange}>
                          {rfi.response ? 'Edit response' : 'Respond'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Deliveries */}
            {fieldSubTab === 'deliveries' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button style={s.btnSmallOrange} onClick={() => setShowPmDeliveryForm(v => !v)}>{showPmDeliveryForm ? 'Cancel' : '+ Log Expected Delivery'}</button>
                </div>
                {showPmDeliveryForm && (
                  <div style={s.inlineForm}>
                    <form onSubmit={submitPmDelivery}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }} className="rx-grid-2">
                        <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Material / Description *</label><input style={s.input} required value={pmDeliveryForm.material} onChange={e => setPmDeliveryForm(f => ({ ...f, material: e.target.value }))} placeholder="Lumber, rebar, HVAC unit..." /></div>
                        <div><label style={s.label}>Vendor / Supplier</label><input style={s.input} value={pmDeliveryForm.vendor} onChange={e => setPmDeliveryForm(f => ({ ...f, vendor: e.target.value }))} placeholder="ABC Supply Co." /></div>
                        <div><label style={s.label}>Expected Date</label><input type="date" style={s.input} value={pmDeliveryForm.expected_date} onChange={e => setPmDeliveryForm(f => ({ ...f, expected_date: e.target.value }))} /></div>
                        <div><label style={s.label}>Quantity</label><input style={s.input} value={pmDeliveryForm.quantity} onChange={e => setPmDeliveryForm(f => ({ ...f, quantity: e.target.value }))} placeholder="24 sheets, 5 tons..." /></div>
                        <div><label style={s.label}>Bill of Lading</label><input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, paddingTop: '8px' }} onChange={e => setPmDeliveryFile(e.target.files?.[0] || null)} /></div>
                      </div>
                      <div style={{ marginBottom: '12px' }}><label style={s.label}>Notes</label><input style={s.input} value={pmDeliveryForm.notes} onChange={e => setPmDeliveryForm(f => ({ ...f, notes: e.target.value }))} placeholder="Driver contact, gate code, specific location..." /></div>
                      <button type="submit" disabled={submittingPmDelivery} style={{ ...s.btnSmallOrange, opacity: submittingPmDelivery ? 0.6 : 1 }}>{submittingPmDelivery ? 'Saving...' : 'Log Delivery'}</button>
                    </form>
                  </div>
                )}
                {fieldDeliveries.length === 0 && <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No deliveries logged yet.</div>}
                {fieldDeliveries.map(d => (
                  <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 12px', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{d.material}</span>
                        <span style={s.coBadge(d.status === 'received' ? 'approved' : 'pending')}>{d.status}</span>
                        {d.source === 'pm' && <span style={{ fontSize: '10px', color: '#888', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '1px 6px', fontWeight: '700', letterSpacing: '0.5px' }}>PM</span>}
                        {d.source === 'daily_report' && <span style={{ fontSize: '10px', color: '#888', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '4px', padding: '1px 6px', fontWeight: '700', letterSpacing: '0.5px' }}>DAILY RPT</span>}
                      </div>
                      <span style={{ fontSize: '12px', color: '#555' }}>
                        {d.vendor && `${d.vendor} · `}{d.quantity && `${d.quantity} · `}
                        {d.expected_date && `Expected ${new Date(d.expected_date + 'T12:00:00').toLocaleDateString()}`}
                        {d.received_date && ` · Received ${new Date(d.received_date + 'T12:00:00').toLocaleDateString()}`}
                        {d.notes && ` · ${d.notes}`}
                      </span>
                    </div>
                    {d.bol_url && (
                      <button style={s.btnSmall} onClick={() => openBolUrl(d.bol_url)}>View BOL</button>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Milestones */}
            {fieldSubTab === 'milestones' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                  <button style={s.btnSmallOrange} onClick={() => setShowMilestoneForm(v => !v)}>{showMilestoneForm ? 'Cancel' : '+ Add milestone'}</button>
                </div>
                {showMilestoneForm && (
                  <div style={s.inlineForm}>
                    <form onSubmit={addMilestone}>
                      <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                        <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Title *</label><input style={s.input} required value={milestoneForm.title} onChange={e => setMilestoneForm(f => ({ ...f, title: e.target.value }))} placeholder="Foundation pour, framing complete..." /></div>
                        <div><label style={s.label}>Due date</label><input type="date" style={s.input} value={milestoneForm.due_date} onChange={e => setMilestoneForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                      </div>
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={milestoneForm.notes} onChange={e => setMilestoneForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                      </div>
                      <button type="submit" disabled={addingMilestone} style={{ ...s.btnSmallOrange, opacity: addingMilestone ? 0.6 : 1 }}>{addingMilestone ? 'Adding...' : 'Add milestone'}</button>
                    </form>
                  </div>
                )}
                {fieldMilestones.length === 0 && !showMilestoneForm && <div style={{ textAlign: 'center', color: '#444', fontSize: '14px', padding: '3rem 0' }}>No milestones yet.</div>}
                {fieldMilestones.map(m => (
                  <div key={m.id} style={{ padding: '14px 12px', borderBottom: '1px solid #1a1a1a' }}>
                    {editingMilestone === m.id ? (
                      <div style={s.inlineForm}>
                        <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                          <div style={{ gridColumn: 'span 2' }}><label style={s.label}>Title</label><input style={s.input} value={editMilestoneForm.title} onChange={e => setEditMilestoneForm(f => ({ ...f, title: e.target.value }))} /></div>
                          <div><label style={s.label}>Due date</label><input type="date" style={s.input} value={editMilestoneForm.due_date} onChange={e => setEditMilestoneForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                        </div>
                        <div style={{ ...s.grid2, marginBottom: '1rem' }} className="rx-grid-2">
                          <div><label style={s.label}>Notes</label><input style={s.input} value={editMilestoneForm.notes} onChange={e => setEditMilestoneForm(f => ({ ...f, notes: e.target.value }))} /></div>
                          <div>
                            <label style={s.label}>Status</label>
                            <select style={s.input} value={editMilestoneForm.status} onChange={e => setEditMilestoneForm(f => ({ ...f, status: e.target.value }))}>
                              <option value="pending">Pending</option>
                              <option value="complete">Complete</option>
                              <option value="delayed">Delayed</option>
                            </select>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={saveMilestoneEdit} style={s.btnSmallOrange}>Save</button>
                          <button onClick={() => setEditingMilestone(null)} style={s.btnSmall}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                            <span style={{ fontSize: '14px', fontWeight: '600', color: m.status === 'complete' ? '#4ade80' : '#f1f1f1' }}>{m.title}</span>
                            <span style={s.coBadge(m.status === 'complete' ? 'approved' : m.status === 'delayed' ? 'rejected' : 'pending')}>{m.status}</span>
                          </div>
                          <span style={{ fontSize: '12px', color: '#555' }}>
                            {m.due_date && `Due ${new Date(m.due_date + 'T12:00:00').toLocaleDateString()}`}
                            {m.completed_date && ` · Completed ${new Date(m.completed_date + 'T12:00:00').toLocaleDateString()}`}
                          </span>
                          {m.notes && <div style={{ fontSize: '12px', color: '#444', marginTop: '2px' }}>{m.notes}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => { setEditingMilestone(m.id); setEditMilestoneForm({ title: m.title, due_date: m.due_date || '', notes: m.notes || '', status: m.status }) }} style={s.btnSmallOrange}>Edit</button>
                          <button onClick={() => deleteMilestone(m.id)} style={s.btnSmallRed}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {/* ── DIRECT COSTS TAB ── */}
        {activeTab === 'costs' && (
          <>
            {(() => {
              const approvedTotal = directCosts.filter(c => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0)
              const pendingTotal = directCosts.filter(c => c.status === 'pending').reduce((a, c) => a + Number(c.amount || 0), 0)
              const pendingCount = directCosts.filter(c => c.status === 'pending').length
              return (
                <div style={s.statRow} className="rx-stats">
                  <div style={s.statCard}><div style={s.statLabel}>Total approved</div><div style={s.statValue('#4ade80')}>${approvedTotal.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Pending approval</div><div style={s.statValue(pendingCount > 0 ? '#e8590c' : undefined)}>${pendingTotal.toLocaleString()}</div></div>
                  <div style={s.statCard}><div style={s.statLabel}>Pending count</div><div style={s.statValue(pendingCount > 0 ? '#e8590c' : undefined)}>{pendingCount}</div></div>
                </div>
              )
            })()}

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '10px' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Direct Costs ({directCosts.length})</p>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    style={{ ...s.input, width: '200px', margin: 0, fontSize: '13px', padding: '6px 12px' }}
                    placeholder="Search description or amount..."
                    value={dcSearch}
                    onChange={e => setDcSearch(e.target.value)}
                  />
                  {directCosts.length > 0 && <button style={s.btnSmall} onClick={exportDirectCostsCSV}>Export CSV</button>}
                  <button style={s.btnSmall} onClick={() => { setShowCsvImport(v => !v); setShowDcForm(false); setCsvRows([]) }}>{showCsvImport ? 'Cancel' : 'Import CSV'}</button>
                  <button style={s.btnSmallOrange} onClick={() => { setShowDcForm(v => !v); setShowCsvImport(false) }}>{showDcForm ? 'Cancel' : '+ Log cost'}</button>
                </div>
              </div>
              {/* Status filter pills */}
              <div style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                {[
                  { key: 'all', label: 'All', count: directCosts.length },
                  { key: 'pending', label: 'Pending', count: directCosts.filter(c => c.status === 'pending').length },
                  { key: 'approved', label: 'Approved', count: directCosts.filter(c => c.status === 'approved').length },
                  { key: 'rejected', label: 'Rejected', count: directCosts.filter(c => c.status === 'rejected').length },
                ].map(f => (
                  <button
                    key={f.key}
                    onClick={() => setDcStatusFilter(f.key)}
                    style={{ padding: '4px 12px', borderRadius: '99px', fontSize: '12px', fontWeight: '700', cursor: 'pointer', border: `1px solid ${dcStatusFilter === f.key ? (f.key === 'pending' ? '#e8590c' : f.key === 'rejected' ? '#ff6b6b' : '#4ade80') : '#2a2a2a'}`, background: dcStatusFilter === f.key ? (f.key === 'pending' ? '#2a1200' : f.key === 'rejected' ? '#2a0a0a' : '#0a2a0a') : 'transparent', color: dcStatusFilter === f.key ? (f.key === 'pending' ? '#e8590c' : f.key === 'rejected' ? '#ff6b6b' : '#4ade80') : '#555' }}
                  >{f.label} ({f.count})</button>
                ))}
              </div>

              {showDcForm && (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>Log direct cost</p>
                  <form onSubmit={submitDirectCostPM}>
                    <div style={{ ...s.grid3, marginBottom: '12px' }} className="rx-grid-3">
                      <div>
                        <label style={s.label}>Date *</label>
                        <input type="date" style={s.input} required value={dcForm.cost_date} onChange={e => setDcForm(f => ({ ...f, cost_date: e.target.value }))} />
                      </div>
                      <div>
                        <label style={s.label}>Category *</label>
                        <select style={s.input} required value={dcForm.category} onChange={e => setDcForm(f => ({ ...f, category: e.target.value }))}>
                          {['Materials', 'Labor', 'Equipment', 'Subcontractor', 'Permits', 'Fees', 'Meals/Entertainment', 'Other'].map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Amount ($) *</label>
                        <input type="number" step="0.01" min="0" style={s.input} required value={dcForm.amount} onChange={e => setDcForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                      <div>
                        <label style={s.label}>Description *</label>
                        <input style={s.input} required value={dcForm.description} onChange={e => setDcForm(f => ({ ...f, description: e.target.value }))} placeholder="Lumber, concrete delivery..." />
                      </div>
                      <div>
                        <label style={s.label}>Budget line</label>
                        <select style={s.input} value={dcForm.budget_item_id} onChange={e => setDcForm(f => ({ ...f, budget_item_id: e.target.value }))}>
                          <option value="">— Unassigned —</option>
                          {budgetItems.map(b => <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Notes</label>
                        <input style={s.input} value={dcForm.notes} onChange={e => setDcForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                      </div>
                    </div>
                    <div style={{ marginBottom: '1.25rem' }}>
                      <label style={s.label}>Receipt (photo / PDF)</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ ...s.input, padding: '8px 14px' }} onChange={e => setDcFile(e.target.files[0])} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button type="submit" disabled={submittingDc} style={{ ...s.btn, opacity: submittingDc ? 0.6 : 1 }}>{submittingDc ? 'Saving...' : 'Save & approve'}</button>
                      <button type="button" style={s.btnGray} onClick={() => setShowDcForm(false)}>Cancel</button>
                    </div>
                  </form>
                </div>
              )}

              {showCsvImport && (
                <div style={{ ...s.inlineForm, border: '1px solid #1a3a1a', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ ...s.cardTitle, margin: 0 }}>Import direct costs from CSV</p>
                    <button style={s.btnSmall} onClick={downloadDcTemplate}>Download template</button>
                  </div>
                  <p style={{ fontSize: '12px', color: '#555', marginBottom: '12px' }}>Columns: <strong style={{ color: '#888' }}>date, description, category, amount, notes</strong>. Budget lines can be assigned after import. Categories: Materials, Labor, Equipment, Subcontractor, Permits, Fees, Other.</p>
                  <input type="file" accept=".csv" style={{ ...s.input, padding: '8px 14px', marginBottom: '12px' }} onChange={e => {
                    const file = e.target.files[0]; if (!file) return
                    const reader = new FileReader()
                    reader.onload = ev => setCsvRows(parseCsvDirect(ev.target.result))
                    reader.readAsText(file)
                  }} />
                  {csvRows.length > 0 && (
                    <>
                      <div style={{ overflowX: 'auto', marginBottom: '12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #222' }}>
                              {['Date','Description','Category','Amount','Notes','Status'].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: '#555', fontWeight: '600' }}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {csvRows.map((r, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #111', background: r.errors.length ? '#1a0a0a' : 'transparent' }}>
                                <td style={{ padding: '4px 8px', color: r.errors.includes('bad date') ? '#e74c3c' : '#ccc' }}>{r.cost_date || '—'}</td>
                                <td style={{ padding: '4px 8px', color: r.errors.includes('no description') ? '#e74c3c' : '#ccc' }}>{r.description || '—'}</td>
                                <td style={{ padding: '4px 8px', color: '#ccc' }}>{r.category}</td>
                                <td style={{ padding: '4px 8px', color: r.errors.includes('bad amount') ? '#e74c3c' : '#ccc' }}>{r.amount > 0 ? `$${r.amount.toLocaleString()}` : '—'}</td>
                                <td style={{ padding: '4px 8px', color: '#666' }}>{r.notes || ''}</td>
                                <td style={{ padding: '4px 8px' }}>{r.errors.length ? <span style={{ color: '#e74c3c' }}>{r.errors.join(', ')}</span> : <span style={{ color: '#4ade80' }}>OK</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <button style={{ ...s.btn, opacity: importingCsv ? 0.6 : 1 }} disabled={importingCsv || csvRows.every(r => r.errors.length > 0)} onClick={submitCsvImport}>
                          {importingCsv ? 'Importing...' : `Import ${csvRows.filter(r => !r.errors.length).length} cost${csvRows.filter(r => !r.errors.length).length !== 1 ? 's' : ''}`}
                        </button>
                        {csvRows.some(r => r.errors.length > 0) && <span style={{ fontSize: '12px', color: '#e8590c' }}>{csvRows.filter(r => r.errors.length > 0).length} row{csvRows.filter(r => r.errors.length > 0).length !== 1 ? 's' : ''} with errors will be skipped</span>}
                      </div>
                    </>
                  )}
                </div>
              )}

              {directCosts.length === 0 && !showCsvImport && (
                <p style={{ color: '#444', fontSize: '14px' }}>No direct costs logged yet. Superintendents can log costs from the field portal.</p>
              )}

              {(() => {
                const q = dcSearch.toLowerCase().trim()
                const visibleCosts = directCosts.filter(c => {
                  if (dcStatusFilter !== 'all' && c.status !== dcStatusFilter) return false
                  if (!q) return true
                  return c.description?.toLowerCase().includes(q) ||
                    String(c.amount).includes(dcSearch.trim()) ||
                    Number(c.amount).toLocaleString().includes(dcSearch.trim())
                })
                const byAmount = {}
                directCosts.forEach(c => {
                  const k = Number(c.amount).toFixed(2)
                  if (!byAmount[k]) byAmount[k] = []
                  byAmount[k].push(c.id)
                })
                const dupIds = new Set(); const dupPairs = {}
                Object.values(byAmount).forEach(ids => {
                  if (ids.length > 1) {
                    ids.forEach(id => {
                      if (!dismissedDupIds.has(id)) {
                        dupIds.add(id)
                        dupPairs[id] = ids.filter(i => i !== id && !dismissedDupIds.has(i))
                      }
                    })
                  }
                })
                const activeDupIds = new Set([...dupIds].filter(id => dupPairs[id]?.length > 0))
                const pairCount = Math.floor(activeDupIds.size / 2)
                return <>
                  {activeDupIds.size > 0 && !q && (
                    <div style={{ background: '#1a1200', border: '1px solid #4a3800', borderRadius: '6px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: '#f59e0b' }}>
                      {pairCount} possible duplicate pair{pairCount !== 1 ? 's' : ''} detected (same amount) — entries marked below.
                    </div>
                  )}
                  {visibleCosts.length === 0 && (
                    <p style={{ color: '#555', fontSize: '13px', marginBottom: '1rem' }}>No costs match{q ? ` "${dcSearch}"` : ''}{dcStatusFilter !== 'all' ? ` with status "${dcStatusFilter}"` : ''}.</p>
                  )}
                  {visibleCosts.map(c => {
                const isRejecting = rejectingCostId === c.id
                const budgetLine = budgetItems.find(b => b.id === c.budget_item_id)
                const drawnApp = c.drawn_application_id ? aiaApplications.find(a => a.id === c.drawn_application_id) : null
                const isDup = activeDupIds.has(c.id)
                return (
                  <div key={c.id} style={{ ...s.billingEntryRow, border: `1px solid ${c.drawn_application_id ? '#3a1a5a' : c.status === 'approved' ? '#1a4a1a' : c.status === 'rejected' ? '#5a1a1a' : '#1e1e1e'}` }}>
                    <div style={s.billingEntryHeader}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{c.description}</span>
                          <span style={s.coBadge('pending')}>{c.category}</span>
                          <span style={s.coBadge(c.status)}>{c.status}</span>
                          {drawnApp && (
                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', background: '#1a0a2a', color: '#c084fc', border: '1px solid #3a1a5a' }}>
                              Drawn — App #{drawnApp.app_number}
                            </span>
                          )}
                          {isDup && (() => {
                            const matches = (dupPairs[c.id] || []).map(mid => directCosts.find(x => x.id === mid)).filter(Boolean)
                            const tipText = matches.map(m => `${new Date(m.cost_date + 'T12:00:00').toLocaleDateString()} — ${m.description} — $${Number(m.amount).toLocaleString()}`).join('\n')
                            return (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                <span title={tipText} style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.5px', background: '#1a1200', color: '#f59e0b', border: '1px solid #4a3800', cursor: 'help' }}>
                                  Possible duplicate
                                </span>
                                <button
                                  title="Mark as not a duplicate"
                                  onClick={() => setDismissedDupIds(prev => {
                                    const next = new Set([...prev, c.id, ...(dupPairs[c.id] || [])])
                                    try { localStorage.setItem(`dc_nodups_${id}`, JSON.stringify([...next])) } catch {}
                                    return next
                                  })}
                                  style={{ background: 'none', border: '1px solid #4a3800', borderRadius: '99px', color: '#f59e0b', fontSize: '10px', fontWeight: '700', padding: '2px 7px', cursor: 'pointer', lineHeight: 1 }}>
                                  Not a duplicate
                                </button>
                              </span>
                            )
                          })()}
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {new Date(c.cost_date + 'T12:00:00').toLocaleDateString()}
                          {budgetLine && ` · ${budgetLine.description}`}
                          {c.notes && ` · ${c.notes}`}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '16px', fontWeight: '800', color: '#f1f1f1' }}>${Number(c.amount).toLocaleString()}</span>
                        {c.receipt_url && (
                          <button style={s.btnSmall} onClick={() => openDcReceiptUrl(c.receipt_url)}>View receipt</button>
                        )}
                        {c.status === 'pending' && (
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                              style={{ ...s.btnSmallGreen, opacity: updatingCostId === c.id ? 0.6 : 1 }}
                              disabled={updatingCostId === c.id}
                              onClick={() => updateCostStatus(c.id, 'approved', c.notes)}>
                              Approve
                            </button>
                            <button
                              style={s.btnSmallRed}
                              onClick={() => { setRejectingCostId(isRejecting ? null : c.id); setCostRejectNote('') }}>
                              {isRejecting ? 'Cancel' : 'Reject'}
                            </button>
                          </div>
                        )}
                        {c.status === 'approved' && (
                          <button style={s.btnSmallRed} onClick={() => updateCostStatus(c.id, 'rejected', c.notes)}>Undo approve</button>
                        )}
                      </div>
                    </div>

                    {isRejecting && (
                      <div style={{ ...s.billingEntryExpanded }}>
                        <label style={s.label}>Rejection note (optional)</label>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                          <input style={s.input} value={costRejectNote} onChange={e => setCostRejectNote(e.target.value)} placeholder="Reason for rejection..." />
                          <button style={{ ...s.btnSmallRed, whiteSpace: 'nowrap', opacity: updatingCostId === c.id ? 0.6 : 1 }} disabled={updatingCostId === c.id} onClick={() => updateCostStatus(c.id, 'rejected', costRejectNote)}>
                            {updatingCostId === c.id ? '...' : 'Confirm reject'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div style={{ ...s.billingEntryExpanded, display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <label style={{ ...s.label, margin: 0, whiteSpace: 'nowrap' }}>Budget line</label>
                      <select
                        style={{ ...s.input, flex: 1, opacity: assigningCostId === c.id ? 0.6 : 1 }}
                        disabled={assigningCostId === c.id}
                        value={c.budget_item_id || ''}
                        onChange={e => assignDcBudgetItem(c.id, e.target.value)}>
                        <option value="">— Unassigned —</option>
                        {budgetItems.map(b => (
                          <option key={b.id} value={b.id}>{b.cost_code ? `${b.cost_code} · ` : ''}{b.description}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}
                </>
              })()}
            </div>
          </>
        )}

        {/* ── PRIME CONTRACT TAB ── */}
        {activeTab === 'prime' && (
          <>
            <div style={s.card}>
              <p style={s.cardTitle}>Prime contract document</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                {job.prime_contract_url && (
                  <button style={s.btnSmallOrange} onClick={openPrimeContractUrl}>View prime contract PDF</button>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                  <input type="file" accept=".pdf" style={{ ...s.input, padding: '8px 14px', flex: 1 }} onChange={e => setPrimeContractFile(e.target.files[0])} />
                  <button style={{ ...s.btn, opacity: (!primeContractFile || uploadingPrimeContract) ? 0.5 : 1 }} disabled={!primeContractFile || uploadingPrimeContract} onClick={uploadPrimeContract}>
                    {uploadingPrimeContract ? 'Uploading...' : job.prime_contract_url ? 'Replace' : 'Upload'}
                  </button>
                </div>
              </div>
              {job.nv_role === 'sub' ? (
                nvSubcontracts.length > 0 && (
                  <p style={{ margin: '1rem 0 0', fontSize: '13px', color: '#555' }}>
                    GC contract total: <strong style={{ color: '#f1f1f1' }}>${nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0).toLocaleString()}</strong>
                    <span style={{ fontSize: '12px', color: '#444', marginLeft: '8px' }}>— {nvSubcontracts.length} subcontract{nvSubcontracts.length !== 1 ? 's' : ''}, manage in the Details tab</span>
                  </p>
                )
              ) : (
                job.contract_value && (
                  <p style={{ margin: '1rem 0 0', fontSize: '13px', color: '#555' }}>
                    Contract value: <strong style={{ color: '#f1f1f1' }}>${Number(job.contract_value).toLocaleString()}</strong>
                    <span style={{ fontSize: '12px', color: '#444', marginLeft: '8px' }}>— edit in the Details tab</span>
                  </p>
                )
              )}
            </div>

            {(() => {
              const isSub = job.nv_role === 'sub'
              const approvedCOsTotal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
              const subContractsTotal = nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0)
              const baseContractBanner = Number(job.contract_value || 0)
              const contractSumToDate = isSub ? (subContractsTotal > 0 ? subContractsTotal : baseContractBanner) : baseContractBanner + approvedCOsTotal
              const subUsingJobValue = isSub && subContractsTotal === 0
              const sovTotal = budgetItems.reduce((a, b) => a + Number(b.owner_amount ?? b.budget_amount ?? 0), 0)
              const diff = contractSumToDate - sovTotal
              if (Math.abs(diff) < 0.01) return null
              return (
                <div style={{ background: '#1a0800', border: '1px solid #e8590c', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                  <p style={{ margin: '0 0 10px', fontSize: '13px', fontWeight: '700', color: '#e8590c' }}>
                    Contract sum to date doesn't match your budget SOV — G703 won't balance
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 20px', fontSize: '12px', marginBottom: '10px' }}>
                    {isSub ? (
                      <>
                        <span style={{ color: '#888' }}>{subUsingJobValue ? 'Job contract value' : `GC subcontracts (${nvSubcontracts.length})`}</span>
                        <span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right' }}>${contractSumToDate.toLocaleString()}</span>
                      </>
                    ) : (
                      <>
                        <span style={{ color: '#888' }}>Original contract</span>
                        <span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right' }}>${baseContractBanner.toLocaleString()}</span>
                        {approvedCOsTotal !== 0 && <>
                          <span style={{ color: '#888' }}>Approved prime COs</span>
                          <span style={{ color: '#facc15', fontFamily: 'monospace', textAlign: 'right' }}>{approvedCOsTotal >= 0 ? '+' : '-'}${Math.abs(approvedCOsTotal).toLocaleString()}</span>
                        </>}
                      </>
                    )}
                    <span style={{ color: '#aaa', fontWeight: '700' }}>Contract sum to date</span>
                    <span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right', fontWeight: '700' }}>${contractSumToDate.toLocaleString()}</span>
                    <span style={{ color: '#888' }}>Budget / SOV total</span>
                    <span style={{ color: '#ff6b6b', fontFamily: 'monospace', textAlign: 'right' }}>${sovTotal.toLocaleString()}</span>
                    <span style={{ color: '#e8590c', fontWeight: '700' }}>Difference</span>
                    <span style={{ color: '#e8590c', fontFamily: 'monospace', textAlign: 'right', fontWeight: '700' }}>{diff > 0 ? '+' : '-'}${Math.abs(diff).toLocaleString()}</span>
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: '12px', color: '#888', lineHeight: '1.5' }}>
                    {isSub
                      ? (diff > 0
                        ? `Your contract sum is $${Math.abs(diff).toLocaleString()} more than your budget lines. Adjust owner amounts in the Budget tab to match, or add contract values to your GC subcontracts in the Details tab.`
                        : `Your budget lines total $${Math.abs(diff).toLocaleString()} more than your contract sum. Add contract values to your GC subcontracts in the Details tab, or adjust owner amounts in the Budget tab.`)
                      : (diff > 0
                        ? `Your contract sum is $${Math.abs(diff).toLocaleString()} more than your budget lines. Add that amount to one or more owner amounts in the Budget tab, or reduce the contract value in the Details tab.`
                        : `Your budget lines total $${Math.abs(diff).toLocaleString()} more than your contract sum. Reduce owner amounts in the Budget tab, or increase the contract value in the Details tab.`)}
                  </p>
                </div>
              )
            })()}

            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>
                  {job.billing_type === 'draw_request' ? `Draw Requests (${aiaApplications.length})` : `AIA Applications (${aiaApplications.length})`}
                </p>
                {!showNewAia && (
                  <button style={s.btnSmallOrange} onClick={() => {
                    setShowNewAia(true)
                    setNewAiaForm({ app_number: String(aiaApplications.length + 1), period_to: '', period_from: '', retainage_pct: '10', markup_pct: '0', linked_draw_request_id: '' })
                  }}>{job.billing_type === 'draw_request' ? '+ New draw request' : '+ New application'}</button>
                )}
              </div>

              {showNewAia && (() => {
                const isDrawType = job.billing_type === 'draw_request'
                const isBiweekly = !isDrawType && (form.owner_billing_frequency || form.billing_frequency || 'monthly') === 'biweekly'
                const canCreate = !savingAia && budgetItems.length > 0 && (isDrawType ? !!newAiaForm.linked_draw_request_id : newAiaForm.period_to && (!isBiweekly || newAiaForm.period_from))
                return (
                <div style={{ ...s.inlineForm, border: '1px solid #4a2200', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>{isDrawType ? 'New Draw Request' : 'New AIA Application'}</p>
                  <div style={{ display: 'grid', gridTemplateColumns: isDrawType ? '100px 1fr 100px 100px' : isBiweekly ? '100px 1fr 1fr 100px 100px' : '100px 1fr 100px 100px', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Draw #</label>
                      <input type="number" min="1" style={s.input} value={newAiaForm.app_number} onChange={e => setNewAiaForm(f => ({ ...f, app_number: e.target.value }))} />
                    </div>
                    {isDrawType ? (
                      <div>
                        <label style={s.label}>Link to sub draw request</label>
                        <select style={s.input} value={newAiaForm.linked_draw_request_id} onChange={e => {
                          const dr = drawRequests.find(d => d.id === e.target.value)
                          setNewAiaForm(f => ({ ...f, linked_draw_request_id: e.target.value, app_number: dr ? String(dr.draw_number) : f.app_number }))
                        }}>
                          <option value="">— Select sub draw request —</option>
                          {drawRequests.filter(d => d.status === 'open').map(d => (
                            <option key={d.id} value={d.id}>{d.title}</option>
                          ))}
                          {drawRequests.filter(d => d.status !== 'open').length > 0 && (
                            <optgroup label="Closed">
                              {drawRequests.filter(d => d.status !== 'open').map(d => (
                                <option key={d.id} value={d.id}>{d.title} (closed)</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    ) : isBiweekly ? (
                      <>
                        <div>
                          <label style={s.label}>Period from</label>
                          <input type="date" style={s.input} value={newAiaForm.period_from} onChange={e => setNewAiaForm(f => ({ ...f, period_from: e.target.value }))} />
                        </div>
                        <div>
                          <label style={s.label}>Period to</label>
                          <input type="date" style={s.input} value={newAiaForm.period_to} onChange={e => setNewAiaForm(f => ({ ...f, period_to: e.target.value }))} />
                        </div>
                      </>
                    ) : (
                      <div>
                        <label style={s.label}>Billing period</label>
                        <select style={s.input} value={newAiaForm.period_to} onChange={e => setNewAiaForm(f => ({ ...f, period_to: e.target.value }))}>
                          <option value="">Select month...</option>
                          {(() => {
                            const opts = []
                            const now = new Date()
                            for (let i = 24; i >= -6; i--) {
                              const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
                              const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                              const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                              opts.push(<option key={val} value={val}>{label}</option>)
                            }
                            return opts
                          })()}
                        </select>
                      </div>
                    )}
                    <div>
                      <label style={s.label}>Retainage %</label>
                      <input type="number" min="0" max="100" step="0.5" style={s.input} value={newAiaForm.retainage_pct} onChange={e => setNewAiaForm(f => ({ ...f, retainage_pct: e.target.value }))} onFocus={e => e.target.select()} />
                    </div>
                    <div>
                      <label style={s.label}>Markup %</label>
                      <input type="number" min="0" step="0.5" style={s.input} value={newAiaForm.markup_pct} onChange={e => setNewAiaForm(f => ({ ...f, markup_pct: e.target.value }))} placeholder="0" />
                    </div>
                  </div>
                  {aiaApplications.length > 0 && (
                    <p style={{ fontSize: '11px', color: '#555', margin: '0 0 12px' }}>
                      % complete from App #{aiaApplications[0].app_number} will auto-carry forward as "Previous" on this application.
                    </p>
                  )}
                  {budgetItems.length === 0 && (
                    <p style={{ fontSize: '12px', color: '#e8590c', margin: '0 0 12px' }}>Add budget line items in the Budget tab first — they become the G703 schedule of values.</p>
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...s.btn, opacity: canCreate ? 1 : 0.6 }}
                      disabled={!canCreate}
                      onClick={createAiaApplication}>
                      {savingAia ? 'Creating...' : 'Create application'}
                    </button>
                    <button style={s.btnGray} onClick={() => setShowNewAia(false)}>Cancel</button>
                  </div>
                </div>
                )
              })()}

              {aiaApplications.length === 0 && !showNewAia && (
                <p style={{ color: '#444', fontSize: '14px' }}>
                  {job.billing_type === 'draw_request' ? 'No draw requests yet. Create your first draw request above.' : 'No AIA applications yet. Create your first application above to get started.'}
                </p>
              )}

              {aiaApplications.map(app => {
                const isActive = activeAia?.id === app.id
                const periodLabel = app.period_from && app.period_from !== (app.period_to ? app.period_to.slice(0, 7) + '-01' : '')
                  ? `${new Date(app.period_from + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(app.period_to + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                  : app.period_to ? new Date(app.period_to + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '—'
                return (
                  <div key={app.id} style={{ ...s.billingEntryRow, border: `1px solid ${isActive ? '#4a2200' : '#1e1e1e'}` }}>
                    <div style={{ ...s.billingEntryHeader, cursor: 'pointer' }} onClick={() => openAiaApp(app)}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>
                            {job.billing_type === 'draw_request' ? `Draw #${app.app_number}` : `App #${app.app_number}`}
                          </span>
                          <span style={{ fontSize: '13px', color: '#888' }}>{periodLabel}</span>
                          <span style={s.coBadge(app.status === 'certified' ? 'approved' : app.status === 'submitted' ? 'pending' : 'pending')}>{app.status}</span>
                          {app.payment_received && (
                            <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>
                              {app.amount_received ? `$${Number(app.amount_received).toLocaleString()} received` : 'Payment Received'}
                            </span>
                          )}
                          {app.payment_received && app.payment_received_at && (
                            <span style={{ fontSize: '11px', color: '#555' }}>{new Date(app.payment_received_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          style={app.payment_received ? s.btnSmallGreen : s.btnSmall}
                          onClick={e => { e.stopPropagation(); markPaymentReceived(app.id, app.payment_received) }}>
                          {app.payment_received ? '✓ Received' : 'Record Payment'}
                        </button>
                        {isActive && (
                          <button style={s.btnSmallRed} onClick={e => { e.stopPropagation(); deleteAiaApplication(app.id) }}>Delete</button>
                        )}
                        <span style={{ color: '#555', fontSize: '14px' }}>{isActive ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {isActive && (
                      <div style={s.billingEntryExpanded}>
                        {aiaLoading ? (
                          <p style={{ color: '#444', fontSize: '14px' }}>Loading...</p>
                        ) : (
                          <>
                            <div style={{ display: 'flex', gap: '16px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                              <div>
                                <label style={s.label}>Status</label>
                                <select style={{ ...s.input, width: 'auto' }} value={activeAia.status || 'draft'} onChange={e => setActiveAia(a => ({ ...a, status: e.target.value }))}>
                                  <option value="draft">Draft</option>
                                  <option value="submitted">Submitted</option>
                                  <option value="certified">Certified</option>
                                </select>
                              </div>
                              <div>
                                <label style={s.label}>Retainage %</label>
                                <input type="number" min="0" max="100" step="0.5" style={{ ...s.input, width: '80px' }} value={activeAia.retainage_pct} onChange={e => setActiveAia(a => ({ ...a, retainage_pct: e.target.value }))} onFocus={e => e.target.select()} />
                              </div>
                              <div>
                                <label style={s.label}>Markup %</label>
                                <input type="number" min="0" step="0.5" style={{ ...s.input, width: '80px' }} value={activeAia.markup_pct || 0} onChange={e => setActiveAia(a => ({ ...a, markup_pct: e.target.value }))} placeholder="0" />
                                {parseFloat(activeAia.markup_pct) > 0 && (
                                  <p style={{ fontSize: '10px', color: '#e8590c', margin: '3px 0 0', whiteSpace: 'nowrap' }}>Applied on G703 billing</p>
                                )}
                              </div>
                            </div>

                            {periodBilling.length > 0 && (
                              <div style={{ background: '#0a1a2a', border: '1px solid #1a3a5a', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                                <p style={{ fontSize: '11px', fontWeight: '700', color: '#60a5fa', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 8px' }}>
                                  Approved billing this period — ${periodBilling.reduce((a, b) => a + Number(b.amount_billed || 0), 0).toLocaleString()} from {periodBilling.length} sub{periodBilling.length !== 1 ? 's' : ''}
                                </p>
                                {periodBilling.map((b, i) => {
                                  const applied = appliedBillings.has(b.id)
                                  const needsManual = manualMapBillingId === b.id
                                  return (
                                    <div key={i} style={{ padding: '6px 0', borderBottom: i < periodBilling.length - 1 ? '1px solid #1a3a5a' : 'none' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                          <span style={{ fontSize: '13px', color: '#aaa' }}>{b.company_name}</span>
                                          {b.retainage_held > 0 && (
                                            <span style={{ fontSize: '11px', color: '#facc15', marginLeft: '8px' }}>({Number(b.retainage_held).toLocaleString('en-US', { minimumFractionDigits: 2 })} ret.)</span>
                                          )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                          <div style={{ textAlign: 'right' }}>
                                            <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#f1f1f1' }}>${Number(b.amount_billed).toLocaleString()}</div>
                                            {parseFloat(activeAia?.markup_pct) > 0 && (
                                              <div style={{ fontSize: '10px', color: '#e8590c', marginTop: '1px' }}>
                                                +{activeAia.markup_pct}% = ${(Math.round(Number(b.amount_billed) * (1 + parseFloat(activeAia.markup_pct) / 100) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} billed
                                              </div>
                                            )}
                                          </div>
                                          <button
                                            style={{ padding: '4px 10px', background: applied ? '#0a2a0a' : '#1a2a0a', color: applied ? '#4ade80' : '#a3e635', border: `1px solid ${applied ? '#1a4a1a' : '#3a5a1a'}`, borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: applied ? 'default' : 'pointer', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}
                                            disabled={applied}
                                            onClick={() => applyBillingToAia(b)}
                                          >
                                            {applied ? '✓ Applied' : 'Apply to G703'}
                                          </button>
                                        </div>
                                      </div>
                                      {needsManual && (
                                        <div style={{ marginTop: '8px', background: '#0f1a0f', border: '1px solid #2a4a1a', borderRadius: '6px', padding: '10px' }}>
                                          <p style={{ fontSize: '11px', color: '#a3e635', margin: '0 0 8px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>No budget line linked — pick one manually</p>
                                          <p style={{ fontSize: '11px', color: '#555', margin: '0 0 8px' }}>To auto-map in future, assign a budget line item to this subcontract in the Contracts tab.</p>
                                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <select
                                              style={{ ...s.input, flex: 1, fontSize: '12px', padding: '7px 10px' }}
                                              value={manualMapBudgetItemId}
                                              onChange={e => setManualMapBudgetItemId(e.target.value)}
                                            >
                                              <option value="">— Select a budget line —</option>
                                              {budgetItems.map(item => (
                                                <option key={item.id} value={item.id}>
                                                  {item.cost_code ? `${item.cost_code} · ` : ''}{item.description} (${Number(item.owner_amount ?? item.budget_amount).toLocaleString()})
                                                </option>
                                              ))}
                                            </select>
                                            <button
                                              style={{ padding: '7px 14px', background: '#1a3a0a', color: '#a3e635', border: '1px solid #3a5a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: manualMapBudgetItemId ? 'pointer' : 'default', opacity: manualMapBudgetItemId ? 1 : 0.4, whiteSpace: 'nowrap' }}
                                              disabled={!manualMapBudgetItemId}
                                              onClick={() => applyBillingManual(b)}
                                            >
                                              Confirm
                                            </button>
                                            <button
                                              style={{ padding: '7px 12px', background: 'transparent', color: '#555', border: '1px solid #2a2a2a', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}
                                              onClick={() => { setManualMapBillingId(null); setManualMapBudgetItemId('') }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {(() => {
                              const linkedDrawId = activeAia?.linked_draw_request_id
                              const pFrom = activeAia?.period_from
                              const pTo = activeAia?.period_to
                              // Hide costs that have been drawn to an application where payment has been received
                              const isPaidOut = c => {
                                if (!c.drawn_application_id) return false
                                const drawnApp = aiaApplications.find(a => a.id === c.drawn_application_id)
                                return !!drawnApp?.payment_received
                              }
                              const thisPeriod = linkedDrawId
                                ? periodDirectCosts.filter(c => c.draw_request_id === linkedDrawId && !isPaidOut(c))
                                : periodDirectCosts.filter(c => !isPaidOut(c) && (pFrom && pTo ? c.cost_date >= pFrom && c.cost_date <= pTo : true))
                              // Other period: show all previous costs (drawn or not) unless paid out
                              const otherPeriod = linkedDrawId
                                ? periodDirectCosts.filter(c => !c.draw_request_id && !isPaidOut(c) && c.drawn_application_id !== activeAia?.id && !(pFrom && pTo && c.cost_date >= pFrom && c.cost_date <= pTo))
                                : periodDirectCosts.filter(c => !c.draw_request_id && !isPaidOut(c) && pFrom && pTo && (c.cost_date < pFrom || c.cost_date > pTo))
                              const renderCostRow = (c, i, list) => {
                                const drawnToThisApp = c.drawn_application_id === activeAia?.id
                                const drawnElsewhere = !!c.drawn_application_id && !drawnToThisApp
                                const drawnApp = c.drawn_application_id ? aiaApplications.find(a => a.id === c.drawn_application_id) : null
                                return (
                                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < list.length - 1 ? '1px solid #2a1a3a' : 'none' }}>
                                    <div>
                                      <span style={{ fontSize: '12px', color: '#888', marginRight: '8px' }}>{new Date(c.cost_date + 'T12:00:00').toLocaleDateString()}</span>
                                      <span style={{ fontSize: '13px', color: drawnElsewhere ? '#666' : '#aaa' }}>{c.description}</span>
                                      <span style={{ fontSize: '11px', color: '#555', marginLeft: '8px' }}>{c.category}</span>
                                      {drawnElsewhere && (
                                        <span style={{ fontSize: '11px', color: '#f59e0b', marginLeft: '8px', fontWeight: '700' }}>
                                          Already drawn — App #{drawnApp?.app_number || '?'}
                                        </span>
                                      )}
                                      {drawnToThisApp && (
                                        <span style={{ fontSize: '11px', color: '#c084fc', marginLeft: '8px', fontWeight: '700' }}>
                                          Drawn — App #{drawnApp?.app_number || '?'}
                                        </span>
                                      )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span style={{ fontFamily: 'monospace', fontSize: '13px', color: drawnElsewhere ? '#666' : '#f1f1f1' }}>${Number(c.amount).toLocaleString()}</span>
                                      {drawnElsewhere ? (
                                        <span style={{ padding: '4px 10px', background: '#1a1200', color: '#f59e0b', border: '1px solid #4a3000', borderRadius: '5px', fontSize: '11px', fontWeight: '700' }}>
                                          In App #{drawnApp?.app_number || '?'}
                                        </span>
                                      ) : drawnToThisApp ? (
                                        <button
                                          style={{ padding: '4px 10px', background: '#1a0a2a', color: '#c084fc', border: '1px solid #3a1a5a', borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                          onClick={() => undrawDirectCost(c.id)}>
                                          Undo draw
                                        </button>
                                      ) : (
                                        <button
                                          style={{ padding: '4px 10px', background: '#0a0a2a', color: '#a78bfa', border: '1px solid #2a1a5a', borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: 'pointer' }}
                                          onClick={() => drawDirectCost(c.id, activeAia.id)}>
                                          Draw
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                )
                              }
                              return <>
                                {thisPeriod.length > 0 && (
                                  <div style={{ background: '#100a1a', border: '1px solid #3a1a5a', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#c084fc', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 8px' }}>
                                      {linkedDrawId ? 'Direct costs — this draw' : 'Direct costs — this period'} — ${thisPeriod.reduce((a, c) => a + Number(c.amount || 0), 0).toLocaleString()} ({thisPeriod.length} item{thisPeriod.length !== 1 ? 's' : ''})
                                    </p>
                                    {thisPeriod.map((c, i) => renderCostRow(c, i, thisPeriod))}
                                  </div>
                                )}
                                {otherPeriod.length > 0 && (
                                  <div style={{ background: '#0a1a0a', border: '1px solid #1a4a1a', borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem' }}>
                                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 4px' }}>
                                      {linkedDrawId ? 'Other costs' : 'Previous period costs'} — ${otherPeriod.filter(c => !c.drawn_application_id).reduce((a, c) => a + Number(c.amount || 0), 0).toLocaleString()} undrawn · {otherPeriod.filter(c => c.drawn_application_id).length} drawn elsewhere
                                    </p>
                                    <p style={{ fontSize: '11px', color: '#555', margin: '0 0 10px' }}>Costs from outside this application period. Undrawn costs can be pulled into this billing. Costs already drawn to another application are shown for reference.</p>
                                    {otherPeriod.map((c, i) => renderCostRow(c, i, otherPeriod))}
                                  </div>
                                )}
                              </>
                            })()}

                            {aiaLines.length === 0 ? (
                              <p style={{ color: '#444', fontSize: '14px' }}>No budget line items found. Add them in the Budget tab.</p>
                            ) : (
                              <>
                                <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                    <thead>
                                      <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                                        <th style={{ textAlign: 'left', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>Description</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Scheduled</th>
                                        <th style={{ textAlign: 'center', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>% Prev</th>
                                        <th style={{ textAlign: 'center', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>This Period</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Total</th>
                                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: '10px', color: '#555', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700', whiteSpace: 'nowrap' }}>Balance</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {aiaLines.map((line, i) => {
                                        const scheduled = Math.round(Number(line.budget_amount || 0) * 100) / 100
                                        const prevAmt = line.dollar_prev != null ? Math.round(Number(line.dollar_prev) * 100) / 100 : Math.round(scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0))) / 100
                                        const thisAmt = line.dollar_this !== undefined
                                          ? Math.round(Number(line.dollar_this) * 100) / 100
                                          : Math.round(scheduled * Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0))) / 100
                                        const total = prevAmt + thisAmt
                                        const balance = scheduled - total
                                        const isPinnedRow = pinnedLineIds.has(line.budget_item_id)
                                        return (
                                          <tr key={line.budget_item_id} style={{ borderBottom: '1px solid #111', background: isPinnedRow ? '#1a0e00' : 'transparent' }}>
                                            <td style={{ padding: '10px', color: '#ccc' }}>
                                              {line.cost_code && <span style={{ fontSize: '10px', color: '#555', marginRight: '8px', fontFamily: 'monospace' }}>{line.cost_code}</span>}
                                              {line.description}
                                              {isPinnedRow && <span style={{ fontSize: '10px', color: '#e8590c', marginLeft: '8px', fontWeight: '700', letterSpacing: '1px' }}>AUTO</span>}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: '#f1f1f1', fontFamily: 'monospace' }}>${Number(scheduled).toLocaleString()}</td>
                                            <td style={{ padding: '10px', textAlign: 'center', color: '#555', fontFamily: 'monospace', fontSize: '12px' }}>
                                              {parseFloat(line.pct_prev) || 0}%
                                            </td>
                                            <td style={{ padding: '6px 8px' }}>
                                              {(() => {
                                                const isPinned = pinnedLineIds.has(line.budget_item_id)
                                                const dollarVal = line.dollar_this !== undefined ? Number(line.dollar_this) : (scheduled > 0 ? scheduled * (parseFloat(line.pct_this) || 0) / 100 : 0)
                                                const pctDisplay = scheduled > 0 && dollarVal ? Number((dollarVal / scheduled * 100).toFixed(6)) : (parseFloat(line.pct_this) ? Number(parseFloat(line.pct_this).toFixed(6)) : '')
                                                return (
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', background: '#0a0a0a', border: '1px solid #2a2a2a', borderRadius: '8px', overflow: 'hidden', opacity: isPinned ? 0.5 : 1 }}>
                                                      <span style={{ padding: '0 6px', fontSize: '11px', color: '#555', borderRight: '1px solid #2a2a2a' }}>$</span>
                                                      <input type="number" min="0" step="0.01"
                                                        style={{ background: 'transparent', border: 'none', outline: 'none', color: '#f1f1f1', fontSize: '12px', padding: '6px 6px', width: '90px', textAlign: 'right' }}
                                                        value={dollarVal || ''}
                                                        readOnly={isPinned}
                                                        placeholder="0"
                                                        onChange={e => {
                                                          if (scheduled === 0) return
                                                          const newDollar = Math.round(Math.max(0, parseFloat(e.target.value) || 0) * 100) / 100
                                                          const newPct = newDollar / scheduled * 100
                                                          setAiaLines(v => {
                                                            const updated = v.map((l, idx) => idx === i ? { ...l, dollar_this: newDollar, pct_this: String(newPct) } : l)
                                                            return recalcPinnedLines(updated, pinnedLineIds)
                                                          })
                                                        }} />
                                                      <span style={{ padding: '0 6px', fontSize: '11px', color: '#333', borderLeft: '1px solid #2a2a2a', borderRight: '1px solid #2a2a2a' }}>%</span>
                                                      <input type="number" min="0" max="100" step="0.1"
                                                        style={{ background: 'transparent', border: 'none', outline: 'none', color: '#aaa', fontSize: '12px', padding: '6px 6px', width: '54px', textAlign: 'center' }}
                                                        value={pctDisplay}
                                                        readOnly={isPinned}
                                                        placeholder="0"
                                                        onChange={e => setAiaLines(v => {
                                                          const updated = v.map((l, idx) => {
                                                            if (idx !== i) return l
                                                            const pct = parseFloat(e.target.value) || 0
                                                            const sched = Number(l.budget_amount || 0)
                                                            return { ...l, pct_this: e.target.value, dollar_this: Math.round(sched * pct) / 100 }
                                                          })
                                                          return recalcPinnedLines(updated, pinnedLineIds)
                                                        })} />
                                                    </div>
                                                    {!isPinned && (
                                                      <button
                                                        title="One-time: set to weighted average % of all other lines"
                                                        onClick={() => autoCalcProRataLine(i)}
                                                        style={{ padding: '5px 7px', background: '#1a1a2a', color: '#60a5fa', border: '1px solid #1a3a5a', borderRadius: '5px', fontSize: '11px', fontWeight: '700', cursor: 'pointer', flexShrink: 0 }}
                                                      >≈%</button>
                                                    )}
                                                    <button
                                                      title={isPinned ? 'Pinned — auto-calculates. Click to unpin.' : 'Pin: always auto-calculate to match overall % complete'}
                                                      onClick={() => togglePinLine(line.budget_item_id)}
                                                      style={{ padding: '5px 7px', background: isPinned ? '#2a1800' : '#111', color: isPinned ? '#e8590c' : '#444', border: `1px solid ${isPinned ? '#4a2800' : '#2a2a2a'}`, borderRadius: '5px', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}
                                                    >📌</button>
                                                  </div>
                                                )
                                              })()}
                                            </td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: total > 0 ? '#4ade80' : '#555', fontFamily: 'monospace' }}>${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                            <td style={{ padding: '10px', textAlign: 'right', color: balance < 0 ? '#ff6b6b' : '#555', fontFamily: 'monospace' }}>${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                          </tr>
                                        )
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                {(() => {
                                  const retPct = Math.max(0, Math.min(100, isNaN(parseFloat(activeAia.retainage_pct)) ? 10 : parseFloat(activeAia.retainage_pct))) / 100
                                  const approvedCOsVal = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
                                  const subNvTotalAia = nvSubcontracts.reduce((a, s) => a + Number(s.contract_value || 0), 0)
                                  const isSubAia = job.nv_role === 'sub'
                                  const baseContractAia = Number(job.contract_value || 0)
                                  const contractSumToDate = isSubAia ? (subNvTotalAia > 0 ? subNvTotalAia : baseContractAia) : baseContractAia + approvedCOsVal
                                  const totalSov = aiaLines.reduce((a, l) => a + Number(l.budget_amount || 0), 0)
                                  const sovMismatch = Math.abs(totalSov - contractSumToDate) > 0.01
                                  const r2 = n => Math.round(n * 100) / 100
                                  const totalCompleted = aiaLines.reduce((a, line) => {
                                    const sv = r2(Number(line.budget_amount || 0))
                                    const prevAmt = line.dollar_prev != null ? r2(Number(line.dollar_prev)) : r2(sv * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100)
                                    const thisAmt = line.dollar_this !== undefined
                                      ? r2(Number(line.dollar_this))
                                      : r2(sv * Math.min(100, Math.max(0, parseFloat(line.pct_this) || 0)) / 100)
                                    return a + prevAmt + thisAmt
                                  }, 0)
                                  const totalRetainage = r2(totalCompleted * retPct)
                                  const totalPrevCompleted = aiaLines.reduce((a, line) => {
                                    const sv = r2(Number(line.budget_amount || 0))
                                    return a + (line.dollar_prev != null ? r2(Number(line.dollar_prev)) : r2(sv * Math.min(100, Math.max(0, parseFloat(line.pct_prev) || 0)) / 100))
                                  }, 0)
                                  const earnedLessRet = totalCompleted - totalRetainage
                                  const prevCerts = totalPrevCompleted * (1 - retPct)
                                  const currentDue = earnedLessRet - prevCerts
                                  return (
                                    <>
                                      {sovMismatch && (() => {
                                        const diff = contractSumToDate - totalSov
                                        const approvedCOsHere = primeCOs.filter(co => co.status === 'approved').reduce((a, co) => a + Number(co.amount || 0), 0)
                                        return (
                                        <div style={{ background: '#2a1200', border: '1px solid #e8590c', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
                                          <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#e8590c', fontWeight: '700' }}>
                                            SOV total doesn't match contract sum to date — G703 won't balance
                                          </p>
                                          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 16px', fontSize: '12px', marginBottom: '8px' }}>
                                            {isSubAia ? (
                                              <><span style={{ color: '#888' }}>Contract sum</span><span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right' }}>${contractSumToDate.toLocaleString()}</span></>
                                            ) : (
                                              <>
                                                <span style={{ color: '#888' }}>Original contract</span><span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right' }}>${baseContractAia.toLocaleString()}</span>
                                                {approvedCOsHere !== 0 && <><span style={{ color: '#888' }}>Approved COs</span><span style={{ color: '#facc15', fontFamily: 'monospace', textAlign: 'right' }}>{approvedCOsHere >= 0 ? '+' : '-'}${Math.abs(approvedCOsHere).toLocaleString()}</span></>}
                                              </>
                                            )}
                                            <span style={{ color: '#aaa', fontWeight: '700' }}>Contract sum to date</span><span style={{ color: '#f1f1f1', fontFamily: 'monospace', textAlign: 'right', fontWeight: '700' }}>${contractSumToDate.toLocaleString()}</span>
                                            <span style={{ color: '#888' }}>SOV total (G703)</span><span style={{ color: '#ff6b6b', fontFamily: 'monospace', textAlign: 'right' }}>${totalSov.toLocaleString()}</span>
                                            <span style={{ color: '#e8590c', fontWeight: '700' }}>Difference to fix</span><span style={{ color: '#e8590c', fontFamily: 'monospace', textAlign: 'right', fontWeight: '700' }}>{diff > 0 ? '+' : '-'}${Math.abs(diff).toLocaleString()}</span>
                                          </div>
                                          <p style={{ margin: 0, fontSize: '12px', color: '#888' }}>
                                            {isSubAia
                                              ? (diff > 0
                                                ? `Add $${Math.abs(diff).toLocaleString()} to owner amounts in the Budget tab, or reduce GC subcontract values in the Details tab.`
                                                : `Add contract values to your GC subcontracts in the Details tab, or reduce owner amounts in the Budget tab by $${Math.abs(diff).toLocaleString()}.`)
                                              : (diff > 0
                                                ? `Add $${Math.abs(diff).toLocaleString()} to one or more owner amounts in the Budget tab.`
                                                : `Reduce owner amounts by $${Math.abs(diff).toLocaleString()} in the Budget tab.`)}
                                          </p>
                                        </div>
                                        )
                                      })()}
                                      <div style={{ background: '#0f0f0f', border: `1px solid ${sovMismatch ? '#5a1a1a' : '#2a2a2a'}`, borderRadius: '8px', padding: '1.25rem', marginBottom: '1.25rem' }}>
                                        <p style={{ ...s.cardTitle, marginBottom: '1rem' }}>G702 Summary</p>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: '13px' }}>
                                          <span style={{ color: '#555' }}>Contract sum to date</span><span style={{ color: '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${contractSumToDate.toLocaleString()}</span>
                                          <span style={{ color: '#555' }}>SOV total (G703)</span><span style={{ color: sovMismatch ? '#ff6b6b' : '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${totalSov.toLocaleString()}</span>
                                          <span style={{ color: '#555' }}>Total completed</span><span style={{ color: '#f1f1f1', textAlign: 'right', fontFamily: 'monospace' }}>${totalCompleted.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                          <span style={{ color: '#555' }}>Retainage ({activeAia.retainage_pct}%)</span><span style={{ color: '#555', textAlign: 'right', fontFamily: 'monospace' }}>(${totalRetainage.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                                          <span style={{ color: '#555' }}>Less previous certificates</span><span style={{ color: '#555', textAlign: 'right', fontFamily: 'monospace' }}>(${prevCerts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                                          <span style={{ color: '#f1f1f1', fontWeight: '700' }}>Current payment due</span><span style={{ color: '#e8590c', textAlign: 'right', fontFamily: 'monospace', fontWeight: '800', fontSize: '15px' }}>${currentDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      </div>
                                    </>
                                  )
                                })()}

                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button style={{ ...s.btn, opacity: savingAia ? 0.6 : 1 }} disabled={savingAia} onClick={saveAiaLines}>{savingAia ? 'Saving...' : 'Save application'}</button>
                                  <button style={s.btnGray} onClick={generateAIAFromApp}>Generate AIA G702/G703</button>
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── PAYMENT RECEIVED MODAL ── */}
        {paymentForm.appId && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
            <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '28px', width: '100%', maxWidth: '400px' }}>
              <p style={{ margin: '0 0 1.25rem', fontSize: '16px', fontWeight: '700', color: '#f1f1f1' }}>Record Payment Received</p>
              <div style={{ marginBottom: '12px' }}>
                <label style={s.label}>Amount received ($)</label>
                <input type="number" step="0.01" min="0" autoFocus style={s.input} value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={s.label}>Date received</label>
                <input type="date" style={s.input} value={paymentForm.received_at} onChange={e => setPaymentForm(f => ({ ...f, received_at: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button style={{ ...s.btn, opacity: savingPayment || !paymentForm.amount ? 0.5 : 1 }} disabled={savingPayment || !paymentForm.amount} onClick={savePaymentReceived}>
                  {savingPayment ? 'Saving...' : 'Save payment'}
                </button>
                <button style={s.btnGray} onClick={() => setPaymentForm({ appId: null, amount: '', received_at: new Date().toISOString().split('T')[0] })}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {activeTab === 'schedule' && (
          <>
            <div style={s.card}>
              <p style={s.cardTitle}>Project Schedule</p>
              <p style={{ fontSize: '13px', color: '#666', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                Upload Microsoft Project files (.mpp, .xml), PDFs, or Excel schedules. XML exports from MS Project will be parsed to show task progress.
              </p>
              {!showScheduleUpload ? (
                <button style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '10px 20px', background: '#2a1200', color: '#e8590c', border: '1px solid #4a2200', borderRadius: '8px', fontSize: '12px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', cursor: 'pointer' }}
                  onClick={() => setShowScheduleUpload(true)}>
                  + Upload Schedule File
                </button>
              ) : (
                <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '8px', padding: '1rem', maxWidth: '480px' }}>
                  <p style={{ margin: '0 0 12px', fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Upload schedule</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <label style={s.label}>Revision #</label>
                      <input style={s.input} placeholder="Rev 3" value={scheduleUploadMeta.revision} onChange={e => setScheduleUploadMeta(m => ({ ...m, revision: e.target.value }))} />
                    </div>
                    <div>
                      <label style={s.label}>Notes (optional)</label>
                      <input style={s.input} placeholder="Updated critical path..." value={scheduleUploadMeta.notes} onChange={e => setScheduleUploadMeta(m => ({ ...m, notes: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '9px 18px', background: uploadingSchedule ? '#111' : '#2a1200', color: uploadingSchedule ? '#555' : '#e8590c', border: '1px solid #4a2200', borderRadius: '8px', fontSize: '12px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase', cursor: uploadingSchedule ? 'not-allowed' : 'pointer' }}>
                      {uploadingSchedule ? 'Uploading...' : 'Select File'}
                      <input type="file" accept=".mpp,.xml,.pdf,.xlsx,.xls,.csv" style={{ display: 'none' }} disabled={uploadingSchedule}
                        onChange={e => { if (e.target.files?.[0]) uploadScheduleFile(e.target.files[0], scheduleUploadMeta); e.target.value = '' }} />
                    </label>
                    <button style={{ padding: '9px 16px', background: 'none', border: '1px solid #2a2a2a', borderRadius: '8px', color: '#555', fontSize: '12px', cursor: 'pointer' }} onClick={() => { setShowScheduleUpload(false); setScheduleUploadMeta({ revision: '', notes: '' }) }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {scheduleFiles.length > 0 && (
              <div style={s.card}>
                <p style={s.cardTitle}>Uploaded Files</p>
                {scheduleFiles.map(f => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', color: '#f1f1f1' }}>{f.file_name}</span>
                        {f.revision && <span style={{ padding: '2px 8px', background: '#1a2a1a', color: '#4ade80', borderRadius: '4px', fontSize: '11px', fontWeight: '700' }}>{f.revision}</span>}
                        {f.file_type && <span style={{ padding: '2px 8px', background: '#1a1a2a', color: '#60a5fa', borderRadius: '4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>{f.file_type}</span>}
                        <span style={{ fontSize: '12px', color: '#555' }}>{new Date(f.uploaded_at).toLocaleDateString()}</span>
                      </div>
                      {f.notes && <div style={{ fontSize: '12px', color: '#666', marginTop: '3px' }}>{f.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {f.file_type === 'xml' && (
                        <button style={s.btnSmallOrange} onClick={async () => {
                          const { data } = await supabase.storage.from('schedule-files').createSignedUrl(f.storage_path, 3600)
                          if (data?.signedUrl) {
                            const res = await fetch(data.signedUrl)
                            const text = await res.text()
                            const tasks = parseProjectXml(text)
                            setParsedTasks(tasks)
                            setParsedFrom(f.file_name)
                          }
                        }}>Parse Tasks</button>
                      )}
                      <button style={s.btnSmall} onClick={() => openScheduleFile(f.storage_path)}>Open</button>
                      <button style={s.btnSmallRed} onClick={() => deleteScheduleFile(f.id, f.storage_path)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {parsedTasks && parsedTasks.length > 0 && (() => {
              const today = new Date().toISOString().slice(0, 10)
              const upcoming = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct < 100 && t.finish >= today)
              const overdue = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct < 100 && t.finish < today)
              const inProgress = parsedTasks.filter(t => !t.summary && !t.milestone && t.pct > 0 && t.pct < 100)
              return (
                <>
                  <div style={{ ...s.card, marginBottom: '1rem' }}>
                    <p style={s.cardTitle}>What's Next — from {parsedFrom}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#e8590c' }}>{inProgress.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>In Progress</div>
                      </div>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#60a5fa' }}>{upcoming.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Upcoming</div>
                      </div>
                      <div style={{ background: '#0f0f0f', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: '#ff6b6b' }}>{overdue.length}</div>
                        <div style={{ fontSize: '11px', color: '#555', fontWeight: '700', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Overdue</div>
                      </div>
                    </div>

                    {overdue.length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#ff6b6b', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px' }}>Overdue</p>
                        {overdue.map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#1a0a0a', border: '1px solid #5a1a1a', borderRadius: '6px', marginBottom: '6px' }}>
                            <div>
                              <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                              <span style={{ fontSize: '12px', color: '#ff6b6b', marginLeft: '10px' }}>Due {t.finish}</span>
                            </div>
                            <span style={{ fontSize: '12px', color: '#ff6b6b', fontWeight: '700' }}>{t.pct}%</span>
                          </div>
                        ))}
                      </>
                    )}

                    {inProgress.length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#e8590c', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', marginTop: overdue.length > 0 ? '1rem' : 0 }}>In Progress</p>
                        {inProgress.map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: '6px', marginBottom: '6px' }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                                <span style={{ fontSize: '12px', color: '#e8590c', fontWeight: '700' }}>{t.pct}%</span>
                              </div>
                              <div style={{ background: '#1a1a1a', borderRadius: '4px', height: '4px' }}>
                                <div style={{ background: '#e8590c', borderRadius: '4px', height: '4px', width: `${t.pct}%` }} />
                              </div>
                              <span style={{ fontSize: '11px', color: '#555' }}>{t.start} → {t.finish}</span>
                            </div>
                          </div>
                        ))}
                      </>
                    )}

                    {upcoming.filter(t => !inProgress.find(ip => ip.uid === t.uid)).length > 0 && (
                      <>
                        <p style={{ fontSize: '12px', fontWeight: '700', color: '#60a5fa', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '8px', marginTop: (overdue.length > 0 || inProgress.length > 0) ? '1rem' : 0 }}>Upcoming (next 30 days)</p>
                        {upcoming.filter(t => !inProgress.find(ip => ip.uid === t.uid)).filter(t => t.start <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).slice(0, 10).map(t => (
                          <div key={t.uid} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#0a0a1a', border: '1px solid #1a2a3a', borderRadius: '6px', marginBottom: '6px' }}>
                            <span style={{ fontSize: '13px', color: '#f1f1f1' }}>{t.name}</span>
                            <span style={{ fontSize: '12px', color: '#60a5fa' }}>{t.start} → {t.finish}</span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>

                  <div style={s.card}>
                    <p style={s.cardTitle}>All Tasks ({parsedTasks.filter(t => !t.summary).length})</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 80px', gap: '8px', padding: '6px 0 10px', fontSize: '11px', fontWeight: '700', color: '#444', letterSpacing: '1.5px', textTransform: 'uppercase', borderBottom: '1px solid #1e1e1e', marginBottom: '4px' }}>
                      <span>Task</span><span>Start</span><span>Finish</span><span style={{ textAlign: 'right' }}>Complete</span>
                    </div>
                    {parsedTasks.filter(t => !t.summary).map(t => {
                      const isOverdue = t.pct < 100 && t.finish < today
                      const isInProg = t.pct > 0 && t.pct < 100
                      return (
                        <div key={t.uid} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr 80px', gap: '8px', padding: '10px 0', borderBottom: '1px solid #111', alignItems: 'center' }}>
                          <div>
                            <span style={{ fontSize: '13px', color: isOverdue ? '#ff6b6b' : '#f1f1f1' }}>{t.milestone ? '◆ ' : ''}{t.name}</span>
                          </div>
                          <span style={{ fontSize: '12px', color: '#555' }}>{t.start}</span>
                          <span style={{ fontSize: '12px', color: isOverdue ? '#ff6b6b' : '#555' }}>{t.finish}</span>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '12px', fontWeight: '700', color: t.pct === 100 ? '#4ade80' : isOverdue ? '#ff6b6b' : isInProg ? '#e8590c' : '#555' }}>{t.pct}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}

            {scheduleFiles.length === 0 && (
              <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: '#555', margin: 0 }}>No schedule files uploaded yet. Upload an MS Project XML export to see task progress here.</p>
              </div>
            )}
          </>
        )}

        {/* ── DOCUMENTS TAB ── */}
        {activeTab === 'documents' && (
          <>
            <div style={s.card}>
              <p style={s.cardTitle}>Project Documents</p>
              <p style={{ fontSize: '13px', color: '#666', marginTop: '-0.75rem', marginBottom: '1.25rem' }}>
                Upload plans, geotech reports, permits, soil reports, and other project documents.
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
                      <span style={{ fontSize: '14px', color: '#f1f1f1' }}>📄 {d.file_name}</span>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
                        <span style={{ padding: '2px 8px', background: '#1a1200', color: '#e8590c', border: '1px solid #3a2200', borderRadius: '4px', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase' }}>
                          {d.category === 'geotech' ? 'Geotech' : d.category === 'plans' ? 'Plans' : d.category === 'permits' ? 'Permits' : d.category === 'specs' ? 'Specs' : 'Other'}
                        </span>
                        <span style={{ fontSize: '12px', color: '#555' }}>{new Date(d.uploaded_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={s.btnSmall} onClick={() => openJobDoc(d.storage_path)}>Open</button>
                      <button style={s.btnSmallRed} onClick={() => deleteJobDoc(d.id, d.storage_path)}>Delete</button>
                    </div>
                  </div>
                ))}
                {jobDocs.filter(d => filterDocCategory === 'all' || d.category === filterDocCategory).length === 0 && (
                  <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>No documents in this category.</p>
                )}
              </div>
            )}

            {jobDocs.length === 0 && (
              <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: '#555', margin: 0 }}>No documents uploaded yet. Select a category and upload to get started.</p>
              </div>
            )}
          </>
        )}

        {/* ── CONTACTS TAB ── */}
        {activeTab === 'contacts' && (
          <>
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: addingContact ? '1.5rem' : 0 }}>
                <p style={{ ...s.cardTitle, marginBottom: 0 }}>Project Contacts</p>
                {!addingContact && (
                  <button style={s.btnSmallOrange} onClick={() => setAddingContact(true)}>+ Add Contact</button>
                )}
              </div>
              {addingContact && (
                <div style={{ borderTop: '1px solid #1e1e1e', paddingTop: '1.5rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }} className="rx-grid-2">
                    <div>
                      <label style={s.label}>Name *</label>
                      <input style={s.input} value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Smith" />
                    </div>
                    <div>
                      <label style={s.label}>Company / Organization</label>
                      <input style={s.input} value={contactForm.company} onChange={e => setContactForm(f => ({ ...f, company: e.target.value }))} placeholder="City of San Diego" />
                    </div>
                    <div>
                      <label style={s.label}>Role</label>
                      <select style={s.input} value={contactForm.role} onChange={e => setContactForm(f => ({ ...f, role: e.target.value }))}>
                        <option value="">Select role...</option>
                        <option value="City Inspector">City Inspector</option>
                        <option value="Structural Engineer">Structural Engineer</option>
                        <option value="Architect">Architect</option>
                        <option value="Geotechnical Engineer">Geotechnical Engineer</option>
                        <option value="Owner / Owner Rep">Owner / Owner Rep</option>
                        <option value="Utility Contact">Utility Contact</option>
                        <option value="Civil Engineer">Civil Engineer</option>
                        <option value="MEP Engineer">MEP Engineer</option>
                        <option value="Lender / Bank">Lender / Bank</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={s.label}>Phone</label>
                      <input style={s.input} value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} placeholder="(619) 555-0100" />
                    </div>
                    <div>
                      <label style={s.label}>Email</label>
                      <input style={s.input} type="email" value={contactForm.email} onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@city.gov" />
                    </div>
                    <div>
                      <label style={s.label}>Notes</label>
                      <input style={s.input} value={contactForm.notes} onChange={e => setContactForm(f => ({ ...f, notes: e.target.value }))} placeholder="Inspection hours, permit #, etc." />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button style={{ ...s.btn, opacity: savingContact ? 0.6 : 1 }} disabled={savingContact || !contactForm.name.trim()} onClick={saveContact}>
                      {savingContact ? 'Saving...' : 'Save Contact'}
                    </button>
                    <button style={s.btnGray} onClick={() => { setAddingContact(false); setContactForm({ name: '', company: '', role: '', phone: '', email: '', notes: '' }) }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {jobContacts.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }} className="rx-grid-2">
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
                    <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: c.notes ? '12px' : 0 }}>
                      {c.phone && (
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Phone</p>
                          <a href={`tel:${c.phone}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{c.phone}</a>
                        </div>
                      )}
                      {c.email && (
                        <div>
                          <p style={{ margin: '0 0 2px', fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Email</p>
                          <a href={`mailto:${c.email}`} style={{ fontSize: '14px', color: '#60a5fa', textDecoration: 'none' }}>{c.email}</a>
                        </div>
                      )}
                    </div>
                    {c.notes && <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#666', lineHeight: '1.5' }}>{c.notes}</p>}
                    <button style={{ ...s.btnSmallRed, marginTop: '12px' }} onClick={() => deleteContact(c.id)}>Remove</button>
                  </div>
                ))}
              </div>
            )}

            {jobContacts.length === 0 && !addingContact && (
              <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: '#555', margin: 0 }}>No contacts yet. Add city inspectors, engineers, owner reps, and other project contacts.</p>
              </div>
            )}
          </>
        )}

        {/* ── LABOR TAB ── */}
        {activeTab === 'labor' && userRole === 'pm' && (() => {
          const fmtD = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          const totalLaborCost = laborAllocations.reduce((a, al) => a + allocCost(al), 0)
          const totalDrawn = laborAllocations.reduce((a, al) => a + allocDrawn(al), 0)
          const activeEmployees = allEmployees.filter(e => e.active)
          return (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={s.cardTitle}>Labor Allocations</h2>
                  <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>Assign employees to this job by date range. Cost accrues weekly based on their rate.</p>
                </div>
                {activeEmployees.length > 0 && (
                  <button style={s.btnSmallOrange} onClick={() => setShowAddLabor(v => !v)}>{showAddLabor ? 'Cancel' : '+ Add Allocation'}</button>
                )}
              </div>

              {laborMsg && <div style={{ padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '13px', background: laborMsg.ok ? '#0a2a0a' : '#2a0a0a', color: laborMsg.ok ? '#4ade80' : '#ff6b6b', border: `1px solid ${laborMsg.ok ? '#1a4a1a' : '#5a1a1a'}` }}>{laborMsg.text}</div>}

              {activeEmployees.length === 0 && (
                <div style={{ ...s.card, textAlign: 'center', padding: '3rem', marginBottom: '1rem' }}>
                  <p style={{ color: '#555', margin: 0 }}>No employees on file. Add employees in the Employees tab of the dashboard first.</p>
                </div>
              )}

              {showAddLabor && (
                <div style={{ ...s.card, marginBottom: '1.5rem', border: '1px solid #2a1a00' }}>
                  <p style={s.cardTitle}>New Allocation</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                    <div>
                      <label style={s.label}>Employee *</label>
                      <select style={s.input} value={laborForm.employee_id} onChange={e => setLaborForm(f => ({ ...f, employee_id: e.target.value }))}>
                        <option value="">Select employee…</option>
                        {activeEmployees.map(e => {
                          const wk = Number(e.weekly_salary || 0) + Number(e.weekly_truck || 0) + Number(e.weekly_healthcare || 0) + Number(e.weekly_taxes || 0)
                          return <option key={e.id} value={e.id}>{e.name}{e.title ? ` — ${e.title}` : ''} · {fmtD(wk)}/wk</option>
                        })}
                      </select>
                    </div>
                    <div><label style={s.label}>Start date *</label><input type="date" style={s.input} value={laborForm.start_date} onChange={e => setLaborForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                    <div><label style={s.label}>End date *</label><input type="date" style={s.input} value={laborForm.end_date} onChange={e => setLaborForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr', gap: '12px', marginBottom: '16px' }}>
                    <div><label style={s.label}>Budget line</label><input style={s.input} value={laborForm.budget_line} onChange={e => setLaborForm(f => ({ ...f, budget_line: e.target.value }))} placeholder="e.g. General Conditions — Superintendent" /></div>
                    <div><label style={s.label}>Notes</label><input style={s.input} value={laborForm.notes} onChange={e => setLaborForm(f => ({ ...f, notes: e.target.value }))} placeholder="optional" /></div>
                  </div>
                  {laborForm.employee_id && laborForm.start_date && laborForm.end_date && (() => {
                    const emp = activeEmployees.find(e => e.id === laborForm.employee_id)
                    if (!emp) return null
                    const wk = Number(emp.weekly_salary || 0) + Number(emp.weekly_truck || 0) + Number(emp.weekly_healthcare || 0) + Number(emp.weekly_taxes || 0)
                    const ms = new Date(laborForm.end_date) - new Date(laborForm.start_date)
                    const weeks = Math.max(0, Math.round(ms / (7 * 24 * 60 * 60 * 1000) * 10) / 10)
                    const total = wk * weeks
                    return <p style={{ fontSize: '12px', color: '#888', marginBottom: '12px' }}>{weeks} week{weeks !== 1 ? 's' : ''} × <strong style={{ color: '#f1f1f1' }}>{fmtD(wk)}/wk</strong> = <strong style={{ color: '#e8590c' }}>{fmtD(total)}</strong> total allocation</p>
                  })()}
                  <button style={{ ...s.btnSmallOrange, opacity: savingLabor ? 0.6 : 1 }} onClick={saveAllocation} disabled={savingLabor}>{savingLabor ? 'Saving…' : 'Save Allocation'}</button>
                </div>
              )}

              {laborAllocations.length > 0 && (
                <div style={s.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <p style={{ ...s.cardTitle, margin: 0 }}>Allocations ({laborAllocations.length})</p>
                    <div style={{ display: 'flex', gap: '1.5rem' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Drawn to date</div>
                        <div style={{ fontSize: '20px', fontWeight: '800', color: '#4ade80' }}>{fmtD(totalDrawn)}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px' }}>Total allocated</div>
                        <div style={{ fontSize: '20px', fontWeight: '800', color: '#e8590c' }}>{fmtD(totalLaborCost)}</div>
                      </div>
                    </div>
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Employee</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Type</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Period</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Weeks</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Weekly rate</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Drawn</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Total</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', color: '#555', fontSize: '11px', fontWeight: '700', letterSpacing: '1px', textTransform: 'uppercase' }}>Budget line</th>
                          <th style={{ padding: '8px 12px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {laborAllocations.map(al => {
                          const e = al.employees
                          if (!e) return null
                          const wk = allocWeeklyRate(al)
                          const weeks = allocWeeks(al)
                          const total = allocCost(al)
                          const drawn = allocDrawn(al)
                          const remaining = total - drawn
                          const pctDrawn = total > 0 ? (drawn / total * 100) : 0
                          return (
                            <tr key={al.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                              <td style={{ padding: '10px 12px', color: '#f1f1f1', fontWeight: '600' }}>{e.name}{e.title ? <span style={{ fontWeight: '400', color: '#666', marginLeft: '6px' }}>{e.title}</span> : null}</td>
                              <td style={{ padding: '10px 12px' }}>
                                <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '11px', fontWeight: '700', background: e.type === 'w2' ? '#0a1e2a' : '#1a1a0a', color: e.type === 'w2' ? '#60a5fa' : '#facc15', border: `1px solid ${e.type === 'w2' ? '#1a3a5a' : '#3a3a1a'}` }}>{e.type === 'w2' ? 'W-2' : '1099'}</span>
                              </td>
                              <td style={{ padding: '10px 12px', color: '#888', fontSize: '12px' }}>
                                {new Date(al.start_date + 'T12:00:00').toLocaleDateString()} – {new Date(al.end_date + 'T12:00:00').toLocaleDateString()}
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: '#f1f1f1' }}>{weeks}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: '#888' }}>{fmtD(wk)}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                                <div style={{ color: '#4ade80', fontWeight: '700' }}>{fmtD(drawn)}</div>
                                <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{pctDrawn.toFixed(0)}% · {fmtD(remaining)} left</div>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: '#e8590c', fontWeight: '700' }}>{fmtD(total)}</td>
                              <td style={{ padding: '10px 12px', color: '#666', fontSize: '12px' }}>{al.budget_line || '—'}</td>
                              <td style={{ padding: '10px 12px' }}>
                                <button style={s.btnSmallRed} onClick={() => deleteAllocation(al.id)}>Remove</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #222' }}>
                          <td colSpan={5} style={{ padding: '10px 12px', color: '#555', fontSize: '12px' }}>Total</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4ade80', fontWeight: '800' }}>{fmtD(totalDrawn)}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#e8590c', fontWeight: '800', fontSize: '15px' }}>{fmtD(totalLaborCost)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {laborAllocations.length === 0 && activeEmployees.length > 0 && !showAddLabor && (
                <div style={{ ...s.card, textAlign: 'center', padding: '3rem' }}>
                  <p style={{ color: '#555', margin: 0 }}>No labor allocated to this job yet.</p>
                </div>
              )}
            </>
          )
        })()}

        {/* ── SUBMITTALS TAB ── */}
        {activeTab === 'submittals' && (() => {
          const statusColor = { submitted: '#60a5fa', under_review: '#facc15', approved: '#4ade80', rejected: '#ff6b6b', resubmit: '#e8590c' }
          return (
            <div style={s.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <p style={{ ...s.cardTitle, margin: 0 }}>Submittal Log ({submittals.length})</p>
                <button style={s.btnSmallOrange} onClick={() => setShowAddSubmittal(v => !v)}>{showAddSubmittal ? 'Cancel' : '+ Add Submittal'}</button>
              </div>

              {showAddSubmittal && (
                <div style={s.inlineForm}>
                  <div style={{ ...s.grid2, marginBottom: '10px' }}>
                    <div><label style={s.label}>Title *</label><input style={s.input} value={submittalForm.title} onChange={e => setSubmittalForm(f => ({ ...f, title: e.target.value }))} placeholder="Shop drawing title or description" /></div>
                    <div><label style={s.label}>Type</label>
                      <select style={s.input} value={submittalForm.type} onChange={e => setSubmittalForm(f => ({ ...f, type: e.target.value }))}>
                        <option value="shop_drawing">Shop Drawing</option>
                        <option value="product_data">Product Data</option>
                        <option value="sample">Sample</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ ...s.grid2, marginBottom: '10px' }}>
                    <div><label style={s.label}>Spec Section</label><input style={s.input} value={submittalForm.spec_section} onChange={e => setSubmittalForm(f => ({ ...f, spec_section: e.target.value }))} placeholder="e.g. 03 30 00" /></div>
                    <div><label style={s.label}>Submitted by</label>
                      <select style={s.input} value={submittalForm.submitted_by_sub_id} onChange={e => {
                        const sub = subs.find(s => s.sub_id === e.target.value)
                        setSubmittalForm(f => ({ ...f, submitted_by_sub_id: e.target.value, submitted_by_company: sub?.company_name || '' }))
                      }}>
                        <option value="">— Select sub (optional) —</option>
                        {subs.filter(s => s.sub_id).map(s => <option key={s.sub_id} value={s.sub_id}>{s.company_name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: '10px' }}><label style={s.label}>Notes</label><input style={s.input} value={submittalForm.notes} onChange={e => setSubmittalForm(f => ({ ...f, notes: e.target.value }))} /></div>
                  <button style={{ ...s.btn, opacity: savingSubmittal || !submittalForm.title ? 0.6 : 1 }} disabled={savingSubmittal || !submittalForm.title} onClick={addSubmittal}>{savingSubmittal ? 'Saving...' : 'Add Submittal'}</button>
                </div>
              )}

              {submittals.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No submittals yet.</p> : submittals.map(sub => {
                const isExp = expandedSubmittalId === sub.id
                const color = statusColor[sub.status] || '#888'
                return (
                  <div key={sub.id} style={{ border: '1px solid #1e1e1e', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#0f0f0f', cursor: 'pointer' }} onClick={() => setExpandedSubmittalId(isExp ? null : sub.id)}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>#{sub.number}</span>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{sub.title}</span>
                          <span style={{ fontSize: '11px', fontWeight: '700', color: color, background: color + '22', border: `1px solid ${color}44`, borderRadius: '4px', padding: '1px 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{sub.status.replace('_', ' ')}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#555' }}>
                          {sub.type.replace('_', ' ')} {sub.spec_section ? `· §${sub.spec_section}` : ''} {sub.submitted_by_company ? `· ${sub.submitted_by_company}` : ''} · {new Date(sub.submitted_at).toLocaleDateString()}
                        </div>
                      </div>
                      <span style={{ color: '#555' }}>{isExp ? '▲' : '▼'}</span>
                    </div>
                    {isExp && (
                      <div style={{ borderTop: '1px solid #1e1e1e', padding: '1rem 1.25rem', background: '#080808' }}>
                        {sub.notes && <p style={{ fontSize: '13px', color: '#888', margin: '0 0 1rem' }}>{sub.notes}</p>}
                        <div style={{ marginBottom: '10px' }}>
                          <label style={s.label}>Review note</label>
                          <input style={s.input} value={submittalReviewNote[sub.id] || ''} onChange={e => setSubmittalReviewNote(prev => ({ ...prev, [sub.id]: e.target.value }))} placeholder="Optional note to subcontractor..." />
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {['under_review', 'approved', 'rejected', 'resubmit'].map(st => (
                            <button key={st} onClick={() => reviewSubmittal(sub.id, st)}
                              style={{ padding: '7px 14px', background: sub.status === st ? statusColor[st] + '33' : '#1a1a1a', border: `1px solid ${sub.status === st ? statusColor[st] : '#2a2a2a'}`, borderRadius: '6px', color: sub.status === st ? statusColor[st] : '#888', fontSize: '12px', fontWeight: '700', cursor: 'pointer', textTransform: 'capitalize' }}>
                              {st.replace('_', ' ')}
                            </button>
                          ))}
                          <button style={s.btnSmallRed} onClick={async () => { await fetch(`/api/submittals?id=${sub.id}`, { method: 'DELETE' }); await loadSubmittals() }}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* ── LIEN / PRELIM NOTICES TAB ── */}
        {activeTab === 'prelim' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Preliminary Notices & Lien Log ({prelimNotices.length})</p>
              <button style={s.btnSmallOrange} onClick={() => setShowAddPrelim(v => !v)}>{showAddPrelim ? 'Cancel' : '+ Add Notice'}</button>
            </div>

            {showAddPrelim && (
              <div style={s.inlineForm}>
                <div style={{ ...s.grid2, marginBottom: '10px' }}>
                  <div><label style={s.label}>From company *</label><input style={s.input} value={prelimForm.from_company} onChange={e => setPrelimForm(f => ({ ...f, from_company: e.target.value }))} placeholder="Company name" /></div>
                  <div><label style={s.label}>Amount claimed</label><input type="number" step="0.01" style={s.input} value={prelimForm.amount_claimed} onChange={e => setPrelimForm(f => ({ ...f, amount_claimed: e.target.value }))} placeholder="0.00" /></div>
                </div>
                <div style={{ ...s.grid2, marginBottom: '10px' }}>
                  <div><label style={s.label}>Date received</label><input type="date" style={s.input} value={prelimForm.received_at} onChange={e => setPrelimForm(f => ({ ...f, received_at: e.target.value }))} /></div>
                  <div><label style={s.label}>Notes</label><input style={s.input} value={prelimForm.notes} onChange={e => setPrelimForm(f => ({ ...f, notes: e.target.value }))} /></div>
                </div>
                <button style={{ ...s.btn, opacity: savingPrelim || !prelimForm.from_company ? 0.6 : 1 }} disabled={savingPrelim || !prelimForm.from_company} onClick={addPrelimNotice}>{savingPrelim ? 'Saving...' : 'Add Notice'}</button>
              </div>
            )}

            {prelimNotices.filter(n => n.status === 'active').length > 0 && (
              <div style={{ background: '#2a0a0a', border: '1px solid #5a1a1a', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem', fontSize: '13px', color: '#ff6b6b' }}>
                ⚠ {prelimNotices.filter(n => n.status === 'active').length} active lien notice{prelimNotices.filter(n => n.status === 'active').length > 1 ? 's' : ''} on this job. Ensure waivers are obtained before final payment.
              </div>
            )}

            {prelimNotices.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No preliminary notices recorded.</p> : prelimNotices.map(notice => (
              <div key={notice.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid #1a1a1a', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{notice.from_company}</span>
                    <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase',
                      color: notice.status === 'active' ? '#ff6b6b' : '#4ade80',
                      background: notice.status === 'active' ? '#2a0a0a' : '#0a2a0a',
                      border: `1px solid ${notice.status === 'active' ? '#5a1a1a' : '#1a4a1a'}` }}>{notice.status}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#555' }}>Received {new Date(notice.received_at + 'T00:00:00').toLocaleDateString()}{notice.notes ? ` · ${notice.notes}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {notice.amount_claimed && <span style={{ fontSize: '15px', fontWeight: '700', color: '#ff6b6b' }}>${Number(notice.amount_claimed).toLocaleString()}</span>}
                  {notice.status === 'active' && (
                    <button style={s.btnSmallGreen} onClick={async () => { await fetch('/api/prelim-notices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: notice.id, status: 'released' }) }); await loadPrelimNotices() }}>Mark Released</button>
                  )}
                  <button style={s.btnSmallRed} onClick={async () => { await fetch(`/api/prelim-notices?id=${notice.id}`, { method: 'DELETE' }); await loadPrelimNotices() }}>Del</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── CASH FLOW TAB ── */}
        {activeTab === 'cashflow' && (() => {
          const fmt = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
          const fmtSigned = (n) => n === 0 ? '$0' : n > 0 ? `+$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

          // Cash IN: payments received from owner via AIA / draw request applications
          const cashInByMonth = {}
          const receivedNoAmount = aiaApplications.filter(a => a.payment_received && !a.amount_received)
          aiaApplications.filter(a => a.payment_received && a.amount_received).forEach(a => {
            const key = (a.payment_received_at || a.period_to || '').slice(0, 7)
            if (key) cashInByMonth[key] = (cashInByMonth[key] || 0) + Number(a.amount_received)
          })

          // Cash OUT: approved sub billings
          const subPayByMonth = {}
          billingSubmissions.filter(b => b.status === 'approved').forEach(b => {
            const key = b.billing_period ? b.billing_period.slice(0, 7) : (b.submitted_at ? b.submitted_at.slice(0, 7) : 'unknown')
            subPayByMonth[key] = (subPayByMonth[key] || 0) + Number(b.amount_billed || 0)
          })

          // Cash OUT: approved direct costs
          const dcByMonth = {}
          directCosts.filter(c => c.status === 'approved').forEach(c => {
            const key = (c.cost_date || c.created_at || '').slice(0, 7)
            dcByMonth[key] = (dcByMonth[key] || 0) + Number(c.amount || 0)
          })

          const allMonths = [...new Set([...Object.keys(cashInByMonth), ...Object.keys(subPayByMonth), ...Object.keys(dcByMonth)])].filter(k => k && k !== 'unknown').sort()
          const totalIn = Object.values(cashInByMonth).reduce((a, v) => a + v, 0)
          const totalSubPay = Object.values(subPayByMonth).reduce((a, v) => a + v, 0)
          const totalDC = Object.values(dcByMonth).reduce((a, v) => a + v, 0)
          const totalOut = totalSubPay + totalDC
          const netCashFlow = totalIn - totalOut
          const retainageHeld = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.retainage_held || 0), 0)
          const retainageReleased = retainageReleases.reduce((a, r) => a + Number(r.amount || 0), 0)

          return (
            <>
              <div style={{ ...s.statRow, gridTemplateColumns: 'repeat(5, 1fr)' }} className="rx-stats">
                <div style={s.statCard}><div style={s.statLabel}>Cash in (received)</div><div style={s.statValue('#4ade80')}>{fmt(totalIn)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Sub billings out</div><div style={s.statValue('#e8590c')}>{fmt(totalSubPay)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Direct costs out</div><div style={s.statValue()}>{fmt(totalDC)}</div></div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Net cash flow</div>
                  <div style={s.statValue(netCashFlow >= 0 ? '#4ade80' : '#ff6b6b')}>{fmtSigned(netCashFlow)}</div>
                </div>
                <div style={s.statCard}><div style={s.statLabel}>Retainage held</div><div style={s.statValue('#facc15')}>{fmt(retainageHeld - retainageReleased)}</div><div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>{fmt(retainageReleased)} released</div></div>
              </div>

              {receivedNoAmount.length > 0 && (
                <div style={{ background: '#2a1200', border: '1px solid #5a2800', borderRadius: '8px', padding: '12px 16px', marginBottom: '1.25rem', fontSize: '13px', color: '#e8590c' }}>
                  <strong>{receivedNoAmount.length} {receivedNoAmount.length === 1 ? 'application is' : 'applications are'} marked received but have no dollar amount.</strong>
                  {' '}Go to the <strong style={{ color: '#f1f1f1' }}>Prime Contract</strong> tab, click <strong style={{ color: '#f1f1f1' }}>Record Payment</strong> on each one, and enter the amount — or run this SQL migration first if amounts aren't saving:
                  <code style={{ display: 'block', marginTop: '8px', padding: '8px 10px', background: '#1a0a00', borderRadius: '6px', fontSize: '12px', color: '#aaa', userSelect: 'all' }}>
                    ALTER TABLE aia_applications ADD COLUMN IF NOT EXISTS amount_received numeric;
                  </code>
                </div>
              )}
              {totalIn === 0 && receivedNoAmount.length === 0 && (
                <div style={{ background: '#1a1200', border: '1px solid #3a2800', borderRadius: '8px', padding: '12px 16px', marginBottom: '1.25rem', fontSize: '13px', color: '#888' }}>
                  No payments recorded from the owner yet. Use the <strong style={{ color: '#f1f1f1' }}>Prime Contract</strong> tab to record payments received on each {job.billing_type === 'draw_request' ? 'draw request' : 'AIA application'}.
                </div>
              )}

              <div style={s.card}>
                <p style={s.cardTitle}>Monthly cash flow</p>
                {allMonths.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No approved billing, direct costs, or payments yet.</p> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                        {['Month', 'Cash in', 'Sub billings', 'Direct costs', 'Total out', 'Net'].map(h => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Month' ? 'left' : 'right', color: '#555', fontSize: '11px', letterSpacing: '1px', textTransform: 'uppercase', fontWeight: '700' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        let running = 0
                        return allMonths.map(m => {
                          const inflow = cashInByMonth[m] || 0
                          const sub = subPayByMonth[m] || 0
                          const dc = dcByMonth[m] || 0
                          const out = sub + dc
                          const net = inflow - out
                          running += net
                          return (
                            <tr key={m} style={{ borderBottom: '1px solid #111' }}>
                              <td style={{ padding: '10px 12px', color: '#f1f1f1', fontWeight: '600' }}>{new Date(m + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: inflow > 0 ? '#4ade80' : '#444' }}>{fmt(inflow)}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: sub > 0 ? '#e8590c' : '#444' }}>{fmt(sub)}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: dc > 0 ? '#aaa' : '#444' }}>{fmt(dc)}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', color: out > 0 ? '#ff6b6b' : '#444' }}>{fmt(out)}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700', color: net >= 0 ? '#4ade80' : '#ff6b6b' }}>{fmtSigned(net)}</td>
                            </tr>
                          )
                        })
                      })()}
                      <tr style={{ borderTop: '2px solid #222' }}>
                        <td style={{ padding: '10px 12px', color: '#555', fontWeight: '700' }}>Total</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#4ade80', fontWeight: '700' }}>{fmt(totalIn)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#e8590c', fontWeight: '700' }}>{fmt(totalSubPay)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '700' }}>{fmt(totalDC)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ff6b6b', fontWeight: '700' }}>{fmt(totalOut)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: '800', fontSize: '15px', color: netCashFlow >= 0 ? '#4ade80' : '#ff6b6b' }}>{fmtSigned(netCashFlow)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>

              {aiaApplications.length > 0 && (
                <div style={s.card}>
                  <p style={s.cardTitle}>{job.billing_type === 'draw_request' ? 'Draw Requests — Payment Status' : 'AIA Applications — Payment Status'}</p>
                  {aiaApplications.map(a => (
                    <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #111', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <div style={{ fontSize: '14px', color: '#f1f1f1', fontWeight: '600' }}>
                          {job.billing_type === 'draw_request' ? `Draw #${a.app_number}` : `App #${a.app_number}`}
                          {a.period_to && <span style={{ fontSize: '12px', color: '#555', marginLeft: '8px' }}>{new Date(a.period_to + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {a.payment_received && a.amount_received && (
                          <span style={{ fontSize: '15px', fontWeight: '700', color: '#4ade80' }}>{fmt(a.amount_received)}</span>
                        )}
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 10px', borderRadius: '99px', textTransform: 'uppercase',
                          color: a.payment_received ? '#4ade80' : '#e8590c',
                          background: a.payment_received ? '#0a2a0a' : '#2a1200',
                          border: `1px solid ${a.payment_received ? '#1a4a1a' : '#4a2200'}` }}>
                          {a.payment_received ? 'Received' : 'Pending'}
                        </span>
                        {a.payment_received_at && <span style={{ fontSize: '11px', color: '#555' }}>{new Date(a.payment_received_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )
        })()}

        {/* ── CLOSEOUT TAB ── */}
        {activeTab === 'closeout' && (() => {
          const openItems = punchItems.filter(p => p.status === 'open')
          const subComplete = punchItems.filter(p => p.status === 'sub_complete')
          const approved = punchItems.filter(p => p.status === 'approved')
          const totalRetainageHeld = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.retainage_held || 0), 0)
          const totalReleased = retainageReleases.reduce((a, r) => a + Number(r.amount || 0), 0)
          const retainageBalance = totalRetainageHeld - totalReleased
          const activeNotices = prelimNotices.filter(n => n.status === 'active')
          const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          const allClear = openItems.length === 0 && subComplete.length === 0 && retainageBalance <= 0 && activeNotices.length === 0

          return (
            <>
              {allClear ? (
                <div style={{ background: '#0a2a0a', border: '1px solid #1a4a1a', borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', marginBottom: '8px' }}>✓</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#4ade80' }}>Project ready to close</div>
                  <div style={{ fontSize: '13px', color: '#4ade80', opacity: 0.7, marginTop: '4px' }}>All punch items approved, retainage released, and no active lien notices.</div>
                </div>
              ) : (
                <div style={{ background: '#2a1200', border: '1px solid #4a2200', borderRadius: '10px', padding: '1.25rem', marginBottom: '1.5rem', fontSize: '13px', color: '#e8590c' }}>
                  <strong>Project not yet ready to close.</strong> Resolve the items below.
                </div>
              )}

              <div style={{ ...s.statRow, gridTemplateColumns: 'repeat(4, 1fr)' }} className="rx-stats">
                <div style={s.statCard}>
                  <div style={s.statLabel}>Open punch items</div>
                  <div style={s.statValue(openItems.length ? '#e8590c' : '#4ade80')}>{openItems.length}</div>
                  {subComplete.length > 0 && <div style={{ fontSize: '12px', color: '#facc15', marginTop: '4px' }}>{subComplete.length} awaiting approval</div>}
                  {openItems.length === 0 && subComplete.length === 0 && <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '4px' }}>All clear</div>}
                </div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Retainage balance</div>
                  <div style={s.statValue(retainageBalance > 0 ? '#facc15' : '#4ade80')}>{fmt(retainageBalance)}</div>
                  <div style={{ fontSize: '12px', color: '#555', marginTop: '4px' }}>{fmt(totalReleased)} released</div>
                </div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Active lien notices</div>
                  <div style={s.statValue(activeNotices.length ? '#ff6b6b' : '#4ade80')}>{activeNotices.length}</div>
                  {activeNotices.length === 0 && <div style={{ fontSize: '12px', color: '#4ade80', marginTop: '4px' }}>Clear</div>}
                </div>
                <div style={s.statCard}>
                  <div style={s.statLabel}>Punch approved</div>
                  <div style={s.statValue('#4ade80')}>{approved.length} / {punchItems.length}</div>
                </div>
              </div>

              <div style={s.card}>
                <p style={s.cardTitle}>Closeout checklist</p>
                {[
                  { label: 'All punch list items approved', done: openItems.length === 0 && subComplete.length === 0, action: 'punch', actionLabel: 'View Punch List' },
                  { label: 'Retainage fully released', done: retainageBalance <= 0, action: 'retainage', actionLabel: 'View Retainage' },
                  { label: 'No active lien notices', done: activeNotices.length === 0, action: 'prelim', actionLabel: 'View Lien Log' },
                  { label: 'All sub billing approved', done: billingSubmissions.every(b => b.status !== 'pending'), action: 'billing', actionLabel: 'View Billing' },
                ].map(item => (
                  <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '16px' }}>{item.done ? '✓' : '○'}</span>
                      <span style={{ fontSize: '14px', color: item.done ? '#4ade80' : '#aaa', textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.7 : 1 }}>{item.label}</span>
                    </div>
                    {!item.done && (
                      <button style={s.btnSmall} onClick={() => setActiveTab(item.action)}>{item.actionLabel}</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )
        })()}

        {/* ── PUNCH LIST TAB ── */}
        {activeTab === 'punch' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <p style={{ ...s.cardTitle, margin: 0 }}>Punch List ({punchItems.length})</p>
              <button style={s.btnSmallOrange} onClick={() => setShowAddPunch(v => !v)}>{showAddPunch ? 'Cancel' : '+ Add Item'}</button>
            </div>

            {showAddPunch && (
              <div style={s.inlineForm}>
                <div style={{ ...s.grid2, marginBottom: '10px' }}>
                  <div><label style={s.label}>Title *</label><input style={s.input} value={punchForm.title} onChange={e => setPunchForm(f => ({ ...f, title: e.target.value }))} placeholder="What needs to be done" /></div>
                  <div><label style={s.label}>Assign to sub</label>
                    <select style={s.input} value={punchForm.assigned_sub_id} onChange={e => {
                      const sub = subs.find(s => s.sub_id === e.target.value)
                      setPunchForm(f => ({ ...f, assigned_sub_id: e.target.value, assigned_company: sub?.company_name || '' }))
                    }}>
                      <option value="">— Not assigned —</option>
                      {subs.filter(s => s.sub_id).map(s => <option key={s.sub_id} value={s.sub_id}>{s.company_name}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ ...s.grid2, marginBottom: '10px' }}>
                  <div><label style={s.label}>Description</label><input style={s.input} value={punchForm.description} onChange={e => setPunchForm(f => ({ ...f, description: e.target.value }))} /></div>
                  <div><label style={s.label}>Due date</label><input type="date" style={s.input} value={punchForm.due_date} onChange={e => setPunchForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                </div>
                <button style={{ ...s.btn, opacity: savingPunch || !punchForm.title ? 0.6 : 1 }} disabled={savingPunch || !punchForm.title} onClick={addPunchItem}>{savingPunch ? 'Adding...' : 'Add Item'}</button>
              </div>
            )}

            {punchItems.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No punch list items yet.</p> : punchItems.map(item => {
              const statusColor = { open: '#e8590c', sub_complete: '#facc15', approved: '#4ade80', rejected: '#ff6b6b' }
              const color = statusColor[item.status] || '#888'
              return (
                <div key={item.id} style={{ padding: '14px 0', borderBottom: '1px solid #1a1a1a' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{item.title}</span>
                        <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase', color, background: color + '22', border: `1px solid ${color}44` }}>{item.status.replace('_', ' ')}</span>
                        {item.assigned_company && <span style={{ fontSize: '12px', color: '#555' }}>{item.assigned_company}</span>}
                        {item.due_date && <span style={{ fontSize: '11px', color: new Date(item.due_date) < new Date() && item.status !== 'approved' ? '#ff6b6b' : '#555' }}>Due {new Date(item.due_date + 'T00:00:00').toLocaleDateString()}</span>}
                      </div>
                      {item.description && <p style={{ margin: 0, fontSize: '13px', color: '#666' }}>{item.description}</p>}
                      {item.pm_notes && <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888', fontStyle: 'italic' }}>PM note: {item.pm_notes}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                      {item.status === 'sub_complete' && (
                        <>
                          <button style={s.btnSmallGreen} disabled={updatingPunchId === item.id} onClick={() => updatePunchStatus(item.id, 'approved', punchNotes[item.id])}>Approve</button>
                          <button style={s.btnSmallRed} disabled={updatingPunchId === item.id} onClick={() => updatePunchStatus(item.id, 'rejected', punchNotes[item.id])}>Reject</button>
                        </>
                      )}
                      {item.status === 'open' && (
                        <button style={s.btnSmall} disabled={updatingPunchId === item.id} onClick={() => updatePunchStatus(item.id, 'approved', '')}>Mark Done</button>
                      )}
                      {item.status === 'rejected' && (
                        <button style={s.btnSmall} disabled={updatingPunchId === item.id} onClick={() => updatePunchStatus(item.id, 'open', '')}>Reopen</button>
                      )}
                      <button style={s.btnSmallRed} onClick={async () => { await fetch(`/api/punch-list?id=${item.id}`, { method: 'DELETE' }); await loadPunchItems() }}>Del</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── RETAINAGE TAB ── */}
        {activeTab === 'retainage' && (() => {
          const totalRetainageHeld = billingSubmissions.filter(b => b.status === 'approved').reduce((a, b) => a + Number(b.retainage_held || 0), 0)
          const totalReleased = retainageReleases.reduce((a, r) => a + Number(r.amount || 0), 0)
          const retainageBalance = totalRetainageHeld - totalReleased
          const fmt = n => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
          return (
            <>
              <div style={{ ...s.statRow, gridTemplateColumns: 'repeat(3, 1fr)' }} className="rx-stats">
                <div style={s.statCard}><div style={s.statLabel}>Total held</div><div style={s.statValue('#facc15')}>{fmt(totalRetainageHeld)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Released</div><div style={s.statValue('#4ade80')}>{fmt(totalReleased)}</div></div>
                <div style={s.statCard}><div style={s.statLabel}>Balance remaining</div><div style={s.statValue(retainageBalance > 0 ? '#facc15' : '#4ade80')}>{fmt(retainageBalance)}</div></div>
              </div>

              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Retainage Releases</p>
                  <button style={s.btnSmallOrange} onClick={() => setShowReleaseForm(v => !v)}>{showReleaseForm ? 'Cancel' : '+ Record Release'}</button>
                </div>

                {showReleaseForm && (
                  <div style={s.inlineForm}>
                    <div style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div><label style={s.label}>Subcontract</label>
                        <select style={s.input} value={releaseForm.subcontract_id} onChange={e => {
                          const c = contracts.find(c => c.id === e.target.value)
                          setReleaseForm(f => ({ ...f, subcontract_id: e.target.value, company_name: c?.vendor_name || '' }))
                        }}>
                          <option value="">— Select subcontract —</option>
                          {contracts.map(c => <option key={c.id} value={c.id}>{c.vendor_name}</option>)}
                        </select>
                      </div>
                      <div><label style={s.label}>Company (if no contract)</label><input style={s.input} value={releaseForm.company_name} onChange={e => setReleaseForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Vendor name" /></div>
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div><label style={s.label}>Release amount *</label><input type="number" step="0.01" style={s.input} value={releaseForm.amount} onChange={e => setReleaseForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
                      <div><label style={s.label}>Notes</label><input style={s.input} value={releaseForm.notes} onChange={e => setReleaseForm(f => ({ ...f, notes: e.target.value }))} /></div>
                    </div>
                    <button style={{ ...s.btn, opacity: savingRelease || !releaseForm.amount || !releaseForm.company_name ? 0.6 : 1 }} disabled={savingRelease || !releaseForm.amount || !releaseForm.company_name} onClick={releaseRetainage}>{savingRelease ? 'Releasing...' : 'Release Retainage'}</button>
                  </div>
                )}

                {retainageReleases.length === 0 ? <p style={{ color: '#444', fontSize: '14px' }}>No retainage releases recorded yet.</p> : retainageReleases.map(r => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid #1a1a1a' }}>
                    <div>
                      <div style={{ fontSize: '14px', fontWeight: '600', color: '#f1f1f1' }}>{r.company_name}</div>
                      <div style={{ fontSize: '12px', color: '#555' }}>{new Date(r.released_at).toLocaleDateString()}{r.notes ? ` · ${r.notes}` : ''}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '15px', fontWeight: '700', color: '#4ade80' }}>{fmt(r.amount)}</span>
                      <button style={s.btnSmallRed} onClick={async () => { await fetch(`/api/retainage-release?id=${r.id}`, { method: 'DELETE' }); await loadRetainageReleases() }}>Del</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        })()}

        {/* ── WARRANTY TAB ── */}
        {activeTab === 'warranty' && (() => {
          const openOrders = warrantyOrders.filter(o => o.status !== 'resolved')
          const resolvedOrders = warrantyOrders.filter(o => o.status === 'resolved')
          return (
            <>
              {/* Warranty Period */}
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Warranty Period</p>
                  {!editingWarrantySetting && (
                    <button style={s.btnSmallOrange} onClick={() => { setEditingWarrantySetting(true); if (warrantySetting) setWarrantySettingForm({ start_date: warrantySetting.start_date || '', end_date: warrantySetting.end_date || '', coverage_notes: warrantySetting.coverage_notes || '' }) }}>
                      {warrantySetting ? 'Edit' : 'Set Period'}
                    </button>
                  )}
                </div>
                {editingWarrantySetting ? (
                  <>
                    <div style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div><label style={s.label}>Start Date</label><input type="date" style={s.input} value={warrantySettingForm.start_date} onChange={e => setWarrantySettingForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                      <div><label style={s.label}>End Date</label><input type="date" style={s.input} value={warrantySettingForm.end_date} onChange={e => setWarrantySettingForm(f => ({ ...f, end_date: e.target.value }))} /></div>
                    </div>
                    <div style={{ marginBottom: '1rem' }}>
                      <label style={s.label}>Coverage Notes</label>
                      <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={warrantySettingForm.coverage_notes} onChange={e => setWarrantySettingForm(f => ({ ...f, coverage_notes: e.target.value }))} placeholder="1-year workmanship, manufacturer warranties, exclusions..." />
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button style={{ ...s.btnSmallOrange, opacity: savingWarrantySetting ? 0.6 : 1 }} disabled={savingWarrantySetting} onClick={async () => {
                        setSavingWarrantySetting(true)
                        const res = await fetch('/api/warranty-settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, ...warrantySettingForm }) })
                        const { setting } = await res.json()
                        setWarrantySetting(setting)
                        setEditingWarrantySetting(false)
                        setSavingWarrantySetting(false)
                      }}>{savingWarrantySetting ? 'Saving...' : 'Save'}</button>
                      <button style={s.btnSmall} onClick={() => setEditingWarrantySetting(false)}>Cancel</button>
                    </div>
                  </>
                ) : warrantySetting ? (
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {warrantySetting.start_date && (
                      <div>
                        <p style={{ ...s.label, margin: '0 0 4px' }}>Start</p>
                        <p style={{ margin: 0, fontSize: '15px', color: '#f1f1f1', fontWeight: '600' }}>{new Date(warrantySetting.start_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      </div>
                    )}
                    {warrantySetting.end_date && (() => {
                      const daysLeft = Math.ceil((new Date(warrantySetting.end_date + 'T12:00:00') - new Date()) / 86400000)
                      return (
                        <div>
                          <p style={{ ...s.label, margin: '0 0 4px' }}>Expires</p>
                          <p style={{ margin: 0, fontSize: '15px', fontWeight: '600', color: daysLeft < 0 ? '#ff6b6b' : daysLeft < 30 ? '#facc15' : '#4ade80' }}>{new Date(warrantySetting.end_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                          <p style={{ margin: '2px 0 0', fontSize: '12px', color: daysLeft < 0 ? '#ff6b6b' : '#555' }}>{daysLeft < 0 ? 'Expired' : `${daysLeft} days remaining`}</p>
                        </div>
                      )
                    })()}
                    {warrantySetting.coverage_notes && (
                      <div style={{ flex: 1 }}>
                        <p style={{ ...s.label, margin: '0 0 4px' }}>Coverage</p>
                        <p style={{ margin: 0, fontSize: '13px', color: '#aaa', lineHeight: '1.6' }}>{warrantySetting.coverage_notes}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p style={{ color: '#555', fontSize: '13px', margin: 0 }}>No warranty period set. Click "Set Period" to configure.</p>
                )}
              </div>

              {/* Work Orders */}
              <div style={s.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <p style={{ ...s.cardTitle, margin: 0 }}>Work Orders ({warrantyOrders.length})</p>
                  <button style={s.btnSmallOrange} onClick={() => setShowWarrantyOrderForm(v => !v)}>{showWarrantyOrderForm ? 'Cancel' : '+ New Order'}</button>
                </div>

                {showWarrantyOrderForm && (
                  <div style={s.inlineForm}>
                    <div style={{ ...s.grid2, marginBottom: '10px' }}>
                      <div><label style={s.label}>Title *</label><input style={s.input} value={warrantyOrderForm.title} onChange={e => setWarrantyOrderForm(f => ({ ...f, title: e.target.value }))} placeholder="Leaking faucet in unit 3..." /></div>
                      <div><label style={s.label}>Due Date</label><input type="date" style={s.input} value={warrantyOrderForm.due_date} onChange={e => setWarrantyOrderForm(f => ({ ...f, due_date: e.target.value }))} /></div>
                    </div>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={s.label}>Description</label>
                      <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={warrantyOrderForm.description} onChange={e => setWarrantyOrderForm(f => ({ ...f, description: e.target.value }))} placeholder="Details about the issue..." />
                    </div>
                    <div style={{ ...s.grid2, marginBottom: '12px' }}>
                      <div>
                        <label style={s.label}>Assign to employee</label>
                        <select style={s.input} value={warrantyOrderForm.assigned_employee_id} onChange={e => {
                          const emp = allEmployees.find(em => em.id === e.target.value)
                          setWarrantyOrderForm(f => ({ ...f, assigned_employee_id: e.target.value, assigned_employee_name: emp?.full_name || emp?.name || '' }))
                        }}>
                          <option value="">— None —</option>
                          {allEmployees.filter(e => e.active).map(emp => <option key={emp.id} value={emp.id}>{emp.full_name || emp.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={s.label}>Assign to subcontractor</label>
                        <select style={s.input} value={warrantyOrderForm.assigned_sub_id} onChange={e => {
                          const sub = subs.find(s => s.sub_id === e.target.value)
                          setWarrantyOrderForm(f => ({ ...f, assigned_sub_id: e.target.value, assigned_company: sub?.company_name || '' }))
                        }}>
                          <option value="">— None —</option>
                          {subs.filter(s => s.sub_id).map(s => <option key={s.sub_id} value={s.sub_id}>{s.company_name}</option>)}
                        </select>
                      </div>
                    </div>
                    <button style={{ ...s.btnSmallOrange, opacity: submittingWarrantyOrder || !warrantyOrderForm.title ? 0.6 : 1 }} disabled={submittingWarrantyOrder || !warrantyOrderForm.title} onClick={async () => {
                      setSubmittingWarrantyOrder(true)
                      await fetch('/api/warranty-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: id, ...warrantyOrderForm }) })
                      setWarrantyOrderForm({ title: '', description: '', due_date: '', assigned_employee_id: '', assigned_employee_name: '', assigned_sub_id: '', assigned_company: '' })
                      setShowWarrantyOrderForm(false)
                      await loadWarranty()
                      setSubmittingWarrantyOrder(false)
                    }}>{submittingWarrantyOrder ? 'Adding...' : 'Create Order'}</button>
                  </div>
                )}

                {warrantyOrders.length === 0 && <p style={{ color: '#444', fontSize: '14px' }}>No warranty orders yet.</p>}

                {openOrders.length > 0 && (
                  <>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 8px' }}>Open ({openOrders.length})</p>
                    {openOrders.map(order => (
                      <div key={order.id} style={{ padding: '14px 0', borderBottom: '1px solid #1a1a1a' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '14px', fontWeight: '700', color: '#f1f1f1' }}>{order.title}</span>
                              <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', background: order.status === 'in_progress' ? '#1a1200' : '#1a1a1a', color: order.status === 'in_progress' ? '#facc15' : '#888', border: `1px solid ${order.status === 'in_progress' ? '#4a4400' : '#2a2a2a'}` }}>
                                {order.status === 'in_progress' ? 'In Progress' : 'Open'}
                              </span>
                            </div>
                            {(order.assigned_employee_name || order.assigned_company) && (
                              <div style={{ fontSize: '12px', color: '#555', marginBottom: '2px' }}>
                                {order.assigned_employee_name && `Employee: ${order.assigned_employee_name}`}
                                {order.assigned_employee_name && order.assigned_company && ' · '}
                                {order.assigned_company && `Sub: ${order.assigned_company}`}
                              </div>
                            )}
                            {order.due_date && <div style={{ fontSize: '12px', color: new Date(order.due_date + 'T12:00:00') < new Date() ? '#ff6b6b' : '#555' }}>Due {new Date(order.due_date + 'T12:00:00').toLocaleDateString()}</div>}
                            {order.description && <div style={{ fontSize: '12px', color: '#444', marginTop: '4px' }}>{order.description}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            {order.status === 'open' && (
                              <button style={s.btnSmall} onClick={async () => { await fetch('/api/warranty-orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: order.id, status: 'in_progress' }) }); loadWarranty() }}>Start</button>
                            )}
                            <button style={s.btnSmallGreen} onClick={() => setResolvingOrder({ id: order.id, is_billable: false, billable_amount: '', resolution_notes: '', photos: [] })}>Resolve</button>
                            <button style={s.btnSmallRed} onClick={async () => { if (!confirm('Delete this warranty order?')) return; await fetch(`/api/warranty-orders?id=${order.id}`, { method: 'DELETE' }); loadWarranty() }}>Del</button>
                          </div>
                        </div>

                        {/* Inline resolution form */}
                        {resolvingOrder?.id === order.id && (
                          <div style={{ ...s.inlineForm, marginTop: '12px', border: '1px solid #1a4a1a' }}>
                            <p style={{ fontSize: '11px', fontWeight: '700', color: '#4ade80', letterSpacing: '1.5px', textTransform: 'uppercase', margin: '0 0 12px' }}>Resolve work order</p>
                            <div style={{ marginBottom: '10px' }}>
                              <label style={s.label}>Resolution notes</label>
                              <textarea rows={2} style={{ ...s.input, resize: 'vertical' }} value={resolvingOrder.resolution_notes} onChange={e => setResolvingOrder(r => ({ ...r, resolution_notes: e.target.value }))} placeholder="Describe what was done to resolve this..." />
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              <label style={s.label}>Completion photos * (at least one required)</label>
                              {resolvingOrder.photos.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                  {resolvingOrder.photos.map((p, i) => (
                                    <div key={i} style={{ background: '#0f0f0f', border: '1px solid #1a4a1a', borderRadius: '6px', padding: '6px 10px', fontSize: '12px', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      📷 {p.name}
                                      <button type="button" onClick={() => setResolvingOrder(r => ({ ...r, photos: r.photos.filter((_, j) => j !== i) }))} style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '14px', padding: 0 }}>×</button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', background: uploadingWarrantyPhoto ? '#111' : '#0a1a0a', color: uploadingWarrantyPhoto ? '#555' : '#4ade80', border: '1px solid #1a4a1a', borderRadius: '6px', fontSize: '11px', fontWeight: '700', cursor: uploadingWarrantyPhoto ? 'not-allowed' : 'pointer', letterSpacing: '1px', textTransform: 'uppercase' }}>
                                {uploadingWarrantyPhoto ? 'Uploading...' : '+ Add Photo'}
                                <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploadingWarrantyPhoto} onChange={async e => {
                                  const file = e.target.files?.[0]; if (!file) return
                                  setUploadingWarrantyPhoto(true)
                                  const path = `${id}/${order.id}/${Date.now()}-${file.name}`
                                  const { error } = await supabase.storage.from('warranty-photos').upload(path, file)
                                  if (!error) setResolvingOrder(r => ({ ...r, photos: [...r.photos, { path, name: file.name }] }))
                                  else alert('Upload failed: ' + error.message)
                                  setUploadingWarrantyPhoto(false)
                                  e.target.value = ''
                                }} />
                              </label>
                              {resolvingOrder.photos.length === 0 && <p style={{ margin: '6px 0 0', fontSize: '11px', color: '#555' }}>Photos are required before marking resolved.</p>}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '14px', flexWrap: 'wrap' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                <input type="checkbox" checked={resolvingOrder.is_billable} onChange={e => setResolvingOrder(r => ({ ...r, is_billable: e.target.checked }))} style={{ width: '16px', height: '16px' }} />
                                <span style={{ fontSize: '13px', color: '#aaa', fontWeight: '600' }}>This item is billable to the owner</span>
                              </label>
                              {resolvingOrder.is_billable && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '12px', color: '#555' }}>Amount ($)</span>
                                  <input type="number" step="0.01" min="0" style={{ ...s.input, width: '140px' }} value={resolvingOrder.billable_amount} onChange={e => setResolvingOrder(r => ({ ...r, billable_amount: e.target.value }))} placeholder="0.00" />
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                style={{ ...s.btnSmallGreen, opacity: resolvingOrder.photos.length === 0 ? 0.4 : 1 }}
                                disabled={resolvingOrder.photos.length === 0}
                                onClick={async () => {
                                  await fetch('/api/warranty-orders', {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      id: resolvingOrder.id,
                                      status: 'resolved',
                                      photos: resolvingOrder.photos,
                                      resolution_notes: resolvingOrder.resolution_notes || null,
                                      is_billable: resolvingOrder.is_billable,
                                      billable_amount: resolvingOrder.is_billable && resolvingOrder.billable_amount ? parseFloat(resolvingOrder.billable_amount) : null,
                                    })
                                  })
                                  setResolvingOrder(null)
                                  loadWarranty()
                                }}
                              >Mark Resolved &amp; Notify Owner</button>
                              <button style={s.btnSmall} onClick={() => setResolvingOrder(null)}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}

                {resolvedOrders.length > 0 && (
                  <>
                    <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '1.5px', textTransform: 'uppercase', margin: `${openOrders.length > 0 ? '1.5rem' : '0'} 0 8px` }}>Resolved ({resolvedOrders.length})</p>
                    {resolvedOrders.map(order => (
                      <div key={order.id} style={{ padding: '14px 0', borderBottom: '1px solid #1a1a1a', opacity: 0.75 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '14px', fontWeight: '700', color: '#aaa', textDecoration: 'line-through' }}>{order.title}</span>
                          <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', background: '#0a2a0a', color: '#4ade80', border: '1px solid #1a4a1a' }}>Resolved</span>
                          {order.is_billable && <span style={{ padding: '2px 8px', borderRadius: '99px', fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', background: '#1a1200', color: '#facc15', border: '1px solid #4a4400' }}>Billable{order.billable_amount ? ` · $${Number(order.billable_amount).toLocaleString()}` : ''}</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: '#444', marginTop: '3px' }}>
                          {order.resolved_at && `Resolved ${new Date(order.resolved_at).toLocaleDateString()}`}
                          {order.photos?.length > 0 && ` · ${order.photos.length} photo${order.photos.length !== 1 ? 's' : ''} on file`}
                        </div>
                        {order.resolution_notes && <div style={{ fontSize: '12px', color: '#555', marginTop: '3px' }}>{order.resolution_notes}</div>}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </>
          )
        })()}

        {/* ── SITE PHOTOS TAB ── */}
        {activeTab === 'photos' && (() => {
          const byDate = fieldPhotos.reduce((acc, p) => { const d = p.date || 'Unknown'; (acc[d] = acc[d] || []).push(p); return acc }, {})
          const dates = Object.keys(byDate).sort((a, b) => new Date(b) - new Date(a))
          return (
            <>
              {fieldPhotos.length === 0 ? (
                <div style={{ background: '#141414', border: '1px solid #222', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#555', fontSize: '14px' }}>
                  No field photos yet. Photos taken by the superintendent will appear here once uploaded.
                </div>
              ) : (
                <>
                  <p style={{ fontSize: '13px', color: '#555', margin: '0 0 1.25rem' }}>{fieldPhotos.length} photo{fieldPhotos.length !== 1 ? 's' : ''} — gallery uploads + daily reports</p>
                  {dates.map(date => (
                    <div key={date} style={{ marginBottom: '1.5rem' }}>
                      <p style={{ fontSize: '11px', fontWeight: '700', color: '#555', letterSpacing: '2px', textTransform: 'uppercase', margin: '0 0 10px' }}>
                        {date !== 'Unknown' ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown Date'}
                        <span style={{ color: '#333', marginLeft: '8px' }}>{byDate[date].length} photo{byDate[date].length !== 1 ? 's' : ''}</span>
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }} className="rx-grid-photos">
                        {byDate[date].map((p, i) => (
                          <div key={i} style={{ aspectRatio: '1', background: '#0f0f0f', overflow: 'hidden', borderRadius: '4px', position: 'relative', cursor: 'pointer' }} onClick={() => setFieldLightbox({ photos: fieldPhotos, index: fieldPhotos.indexOf(p) })}>
                            {(fieldPhotoUrls[fpThumb(p.path)] || fieldPhotoUrls[p.path])
                              ? <img src={fieldPhotoUrls[fpThumb(p.path)] || fieldPhotoUrls[p.path]} loading="lazy" decoding="async" onError={e => { const full = fieldPhotoUrls[p.path]; if (full && e.target.src !== full) e.target.src = full }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt={p.name} />
                              : <div style={{ width: '100%', height: '100%', background: '#141414', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: '10px' }}>...</div>
                            }
                            {p.tag && <div style={{ position: 'absolute', top: '4px', left: '4px', background: 'rgba(232,89,12,0.85)', color: '#fff', fontSize: '8px', fontWeight: '800', letterSpacing: '0.5px', textTransform: 'uppercase', padding: '2px 5px', borderRadius: '3px', lineHeight: '1.3', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.tag}</div>}
                            {p.caption && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '16px 4px 4px', fontSize: '9px', color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption}</div>}
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); deleteFieldPhoto(p) }}
                              style={{ position: 'absolute', top: '4px', right: '4px', width: '22px', height: '22px', background: 'rgba(0,0,0,0.75)', border: 'none', borderRadius: '50%', color: deletingFieldPhoto === p.path ? '#888' : '#ff6b6b', fontSize: '12px', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                              {deletingFieldPhoto === p.path ? '…' : '✕'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </>
          )
        })()}

          </div>{/* end content area */}
        </div>{/* end sidebar + content flex */}

      </main>

      {/* ── FIELD PHOTOS LIGHTBOX ── */}
      {fieldLightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.97)', zIndex: 9999, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', background: 'rgba(0,0,0,0.6)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {fieldLightbox.photos[fieldLightbox.index]?.tag && <span style={{ background: 'rgba(232,89,12,0.85)', color: '#fff', fontSize: '10px', fontWeight: '800', letterSpacing: '1px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px' }}>{fieldLightbox.photos[fieldLightbox.index].tag}</span>}
              {fieldLightbox.photos[fieldLightbox.index]?.caption && <span style={{ color: '#f1f1f1', fontWeight: '700', fontSize: '14px' }}>{fieldLightbox.photos[fieldLightbox.index].caption}</span>}
              {fieldLightbox.photos[fieldLightbox.index]?.date && <span style={{ color: '#555', fontSize: '12px' }}>{new Date(fieldLightbox.photos[fieldLightbox.index].date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
              {fieldLightbox.photos[fieldLightbox.index]?.fromReport && <span style={{ color: '#444', fontSize: '11px' }}>· Daily report</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ color: '#555', fontSize: '12px' }}>{fieldLightbox.index + 1} / {fieldLightbox.photos.length}</span>
              <button
                onClick={() => deleteFieldPhoto(fieldLightbox.photos[fieldLightbox.index])}
                disabled={deletingFieldPhoto === fieldLightbox.photos[fieldLightbox.index]?.path}
                style={{ padding: '6px 14px', background: 'rgba(90,10,10,0.8)', border: '1px solid #5a1a1a', borderRadius: '6px', color: deletingFieldPhoto === fieldLightbox.photos[fieldLightbox.index]?.path ? '#888' : '#ff6b6b', fontSize: '12px', fontWeight: '700', cursor: 'pointer', letterSpacing: '0.5px' }}>
                {deletingFieldPhoto === fieldLightbox.photos[fieldLightbox.index]?.path ? 'Deleting...' : 'Delete'}
              </button>
              <button onClick={() => setFieldLightbox(null)} style={{ background: 'none', border: 'none', color: '#888', fontSize: '22px', cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>✕</button>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '0 60px' }}>
            {fieldPhotoUrls[fieldLightbox.photos[fieldLightbox.index]?.path]
              ? <img src={fieldPhotoUrls[fieldLightbox.photos[fieldLightbox.index].path]} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: '4px', userSelect: 'none' }} alt="" />
              : <div style={{ color: '#444', fontSize: '13px' }}>Loading...</div>
            }
            {fieldLightbox.photos.length > 1 && <>
              <button onClick={() => setFieldLightbox(l => ({ ...l, index: (l.index - 1 + l.photos.length) % l.photos.length }))} style={{ position: 'absolute', left: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: '28px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>‹</button>
              <button onClick={() => setFieldLightbox(l => ({ ...l, index: (l.index + 1) % l.photos.length }))} style={{ position: 'absolute', right: '8px', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', fontSize: '28px', width: '44px', height: '44px', borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>›</button>
            </>}
          </div>
          {fieldLightbox.photos.length > 1 && (
            <div style={{ display: 'flex', gap: '4px', padding: '10px 14px', background: 'rgba(0,0,0,0.8)', overflowX: 'auto', flexShrink: 0 }}>
              {fieldLightbox.photos.map((p, i) => (
                <button key={i} onClick={() => setFieldLightbox(l => ({ ...l, index: i }))} style={{ flexShrink: 0, width: '52px', height: '52px', borderRadius: '6px', border: i === fieldLightbox.index ? '2px solid #e8590c' : '2px solid transparent', overflow: 'hidden', cursor: 'pointer', padding: 0, background: '#111' }}>
                  {(fieldPhotoUrls[fpThumb(p.path)] || fieldPhotoUrls[p.path])
                    ? <img src={fieldPhotoUrls[fpThumb(p.path)] || fieldPhotoUrls[p.path]} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} alt="" />
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
